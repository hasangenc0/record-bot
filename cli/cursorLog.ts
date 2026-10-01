import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cursorHintPath, parseCursorHint } from "./cursorKind.ts";
import { nativeHelperPath } from "./paths.ts";
import type { CaptureSource } from "./types.ts";

const execFileAsync = promisify(execFile);

export type CursorLogSession = {
	process: ChildProcessWithoutNullStreams | NodeJS.Timeout;
	outputPath: string;
	kind: "native" | "poll";
};

function originForSource(source: CaptureSource) {
	return {
		originX: source.x ?? 0,
		originY: source.y ?? 0,
		width: Math.max(1, source.width ?? 1),
		height: Math.max(1, source.height ?? 1),
	};
}

async function startNativeCursorLog(
	source: CaptureSource,
	outputPath: string,
): Promise<CursorLogSession> {
	const helperPath = nativeHelperPath("cursor");
	const origin = originForSource(source);
	const child = spawn(
		helperPath,
		[
			JSON.stringify({
				outputPath,
				originX: origin.originX,
				originY: origin.originY,
				width: origin.width,
				height: origin.height,
			}),
		],
		{
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for cursor log"));
		}, 4000);
		let buffer = "";
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			if (buffer.includes("Cursor log started")) {
				cleanup();
				resolve();
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			cleanup();
			reject(new Error(`Cursor helper exited before start (code ${code ?? "unknown"})`));
		};
		const cleanup = () => {
			clearTimeout(timer);
			child.stdout.off("data", onData);
			child.off("error", onError);
			child.off("exit", onExit);
		};
		child.stdout.on("data", onData);
		child.once("error", onError);
		child.once("exit", onExit);
	});
	return { process: child, outputPath, kind: "native" };
}

function appendCursorLine(outputPath: string, sample: Record<string, number | string>) {
	void fs.appendFile(outputPath, `${JSON.stringify(sample)}\n`);
}

function readCursorHint() {
	if (!process.env.RECORD_BOT_CURSOR_HINT?.trim()) {
		return { cursor: "arrow" as const, buttons: 0 };
	}
	try {
		return parseCursorHint(readFileSync(cursorHintPath(), "utf8"));
	} catch {
		return { cursor: "arrow" as const, buttons: 0 };
	}
}

async function startLinuxCursorLog(
	source: CaptureSource,
	outputPath: string,
): Promise<CursorLogSession | null> {
	try {
		await execFileAsync("xdotool", ["getmouselocation"], { timeout: 1000 });
	} catch {
		return null;
	}
	await fs.writeFile(outputPath, "");
	const origin = originForSource(source);
	const startedAt = Date.now();
	const timer = setInterval(() => {
		execFile("xdotool", ["getmouselocation", "--shell"], (error, stdout) => {
			if (error) {
				return;
			}
			const parsed: Record<string, string> = {};
			for (const line of stdout.split("\n")) {
				const [key, value] = line.split("=");
				if (key && value) {
					parsed[key] = value.trim();
				}
			}
			const x = Number(parsed.X);
			const y = Number(parsed.Y);
			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				return;
			}
			const hint = readCursorHint();
			appendCursorLine(outputPath, {
				t: (Date.now() - startedAt) / 1000,
				x: x - origin.originX,
				y: y - origin.originY,
				buttons: hint.buttons,
				cursor: hint.cursor,
			});
		});
	}, 16);
	return { process: timer, outputPath, kind: "poll" };
}

async function startWindowsCursorLog(
	source: CaptureSource,
	outputPath: string,
): Promise<CursorLogSession | null> {
	const origin = originForSource(source);
	const script = `
Add-Type -AssemblyName System.Windows.Forms
$out = ${JSON.stringify(outputPath)}
$originX = ${origin.originX}
$originY = ${origin.originY}
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($true) {
  $p = [System.Windows.Forms.Cursor]::Position
  $t = $sw.Elapsed.TotalSeconds
  $line = '{"t":' + $t.ToString('0.000') + ',"x":' + ($p.X - $originX) + ',"y":' + ($p.Y - $originY) + ',"buttons":0}'
  Add-Content -Path $out -Value $line -Encoding utf8
  Start-Sleep -Milliseconds 16
}
`;
	await fs.writeFile(outputPath, "");
	const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	return { process: child, outputPath, kind: "native" };
}

export async function startCursorLog(
	source: CaptureSource,
	outputPath: string,
): Promise<CursorLogSession | null> {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	try {
		if (process.platform === "darwin") {
			return await startNativeCursorLog(source, outputPath);
		}
		if (process.platform === "linux") {
			return await startLinuxCursorLog(source, outputPath);
		}
		if (process.platform === "win32") {
			return await startWindowsCursorLog(source, outputPath);
		}
	} catch {
		return null;
	}
	return null;
}

export async function stopCursorLog(session: CursorLogSession | null) {
	if (!session) {
		return;
	}
	if (session.kind === "poll") {
		clearInterval(session.process as NodeJS.Timeout);
		return;
	}
	const child = session.process as ChildProcessWithoutNullStreams;
	if (child.exitCode !== null || child.signalCode) {
		return;
	}
	try {
		child.stdin.write("stop\n");
	} catch {
		try {
			child.kill("SIGTERM");
		} catch {
			/* ignore */
		}
		return;
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			try {
				child.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			resolve();
		}, 1500);
		child.once("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}
