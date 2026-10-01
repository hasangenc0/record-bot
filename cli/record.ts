import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { CAPTURE_VIDEO_ARGS } from "./encode.ts";
import { ffmpegPath } from "./ffmpeg.ts";
import { nativeHelperPath, parseWindowId, recordingsDir } from "./paths.ts";
import type { CaptureSource, RecordingResult } from "./types.ts";

export type RecordOptions = {
	mic?: boolean;
	systemAudio?: boolean;
	micDevice?: string;
};

type CaptureBackend = "native" | "ffmpeg";

type ActiveSession = {
	backend: CaptureBackend;
	process: ChildProcessWithoutNullStreams;
	outputPath: string;
	outputBuffer: string;
};

let activeSession: ActiveSession | null = null;

function attachOutput(child: ChildProcessWithoutNullStreams, session: ActiveSession) {
	const append = (chunk: Buffer) => {
		session.outputBuffer += chunk.toString();
	};
	child.stdout.on("data", append);
	child.stderr.on("data", append);
}

function waitForMarker(
	session: ActiveSession,
	marker: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = session.process;
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for: ${marker}`));
		}, timeoutMs);

		const check = () => {
			if (session.outputBuffer.includes(marker)) {
				cleanup();
				resolve();
			}
		};
		const onData = () => check();
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					session.outputBuffer.trim() ||
						`Capture helper exited before ${marker} (code ${code ?? "unknown"})`,
				),
			);
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
		check();
	});
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number | null> {
	if (child.exitCode !== null || child.signalCode) {
		return Promise.resolve(child.exitCode);
	}
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code));
	});
}

async function startMacRecording(
	source: CaptureSource,
	outputPath: string,
	options: RecordOptions,
): Promise<void> {
	const helperPath = nativeHelperPath("capture");
	const dir = path.dirname(outputPath);
	const videoStem = path.join(dir, path.parse(outputPath).name);
	const sys = Boolean(options.systemAudio);
	const mic = Boolean(options.mic);
	const config: Record<string, unknown> = {
		fps: 60,
		out: outputPath,
		sys,
		mic,
	};
	if (sys) {
		config.sysFile = `${videoStem}.system.m4a`;
	}
	if (mic) {
		config.micFile = `${videoStem}.mic.m4a`;
		if (options.micDevice) {
			config.micId = options.micDevice;
		}
	}
	const windowId = parseWindowId(source.id);
	if (windowId && source.sourceType === "window") {
		config.window = windowId;
	} else {
		const displayId = Number(source.displayId);
		if (Number.isFinite(displayId) && displayId > 0) {
			config.display = displayId;
		}
	}

	const child = spawn(helperPath, [JSON.stringify(config)], {
		cwd: dir,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const session: ActiveSession = {
		backend: "native",
		process: child,
		outputPath,
		outputBuffer: "",
	};
	attachOutput(child, session);
	activeSession = session;
	try {
		await waitForMarker(session, "ready", 12000);
	} catch (error) {
		activeSession = null;
		throw new Error(
			session.outputBuffer.trim() || (error instanceof Error ? error.message : String(error)),
		);
	}
}

async function startFfmpegRecording(source: CaptureSource, outputPath: string): Promise<void> {
	const ffmpegBin = ffmpegPath();
	const displayEnv = process.env.DISPLAY || ":0.0";
	const width = Math.max(2, Math.round(source.width ?? 1920));
	const height = Math.max(2, Math.round(source.height ?? 1080));
	const x = Math.round(source.x ?? 0);
	const y = Math.round(source.y ?? 0);
	const args =
		process.platform === "linux"
			? [
					"-y",
					"-f",
					"x11grab",
					"-framerate",
					"60",
					"-draw_mouse",
					"0",
					"-video_size",
					`${width}x${height}`,
					"-i",
					`${displayEnv}+${x},${y}`,
					"-an",
					...CAPTURE_VIDEO_ARGS,
					outputPath,
				]
			: [
					"-y",
					"-f",
					"gdigrab",
					"-framerate",
					"60",
					"-draw_mouse",
					"0",
					"-i",
					"desktop",
					"-an",
					...CAPTURE_VIDEO_ARGS,
					outputPath,
				];

	const child = spawn(ffmpegBin, args, {
		cwd: path.dirname(outputPath),
		stdio: ["pipe", "pipe", "pipe"],
	});
	const session: ActiveSession = {
		backend: "ffmpeg",
		process: child,
		outputPath,
		outputBuffer: "",
	};
	attachOutput(child, session);
	activeSession = session;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => resolve(), 1500);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`FFmpeg exited before recording started (code ${code ?? "unknown"})`));
		});
	});
}

export async function startRecording(
	source: CaptureSource,
	outputPath: string,
	options: RecordOptions = {},
): Promise<RecordingResult> {
	if (activeSession) {
		return { success: false, message: "A recording is already active." };
	}
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	try {
		if (process.platform === "darwin") {
			await startMacRecording(source, outputPath, options);
		} else {
			await startFfmpegRecording(source, outputPath);
		}
		return { success: true, path: outputPath };
	} catch (error) {
		activeSession = null;
		return {
			success: false,
			message: "Failed to start recording",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function stopRecording(): Promise<RecordingResult> {
	if (!activeSession) {
		return { success: false, message: "No recording is active." };
	}
	const session = activeSession;
	try {
		if (session.backend === "ffmpeg") {
			session.process.stdin.write("q\n");
		} else {
			session.process.stdin.write("stop\n");
		}
		const code = await waitForClose(session.process);
		activeSession = null;
		const helperPath = session.outputBuffer.match(/^wrote (.+)$/m)?.[1]?.trim();
		if (code !== 0 && code !== null && !helperPath) {
			return {
				success: false,
				message: session.outputBuffer.trim() || `Capture helper exited with code ${code}`,
			};
		}
		return { success: true, path: helperPath ?? session.outputPath };
	} catch (error) {
		activeSession = null;
		try {
			session.process.kill();
		} catch {
			/* ignore */
		}
		return {
			success: false,
			message: "Failed to stop recording",
			error: error instanceof Error ? error.message : String(error),
			path: session.outputPath,
		};
	}
}

export async function stagingVideoPath(): Promise<string> {
	const dir = recordingsDir();
	await fs.mkdir(dir, { recursive: true });
	return path.join(dir, `recording-${Date.now()}.mp4`);
}
