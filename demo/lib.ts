import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEMO_WINDOW_TITLE = "Harbor";

export type DemoArgs = {
	output: string;
	voiceover: boolean;
	// undefined = use the scenario's own window title (macOS window capture).
	windowTitle?: string;
	scenario: string;
	list: boolean;
};

export type PublicSource = {
	id: string;
	name: string;
	displayId: string | null;
	sourceType: "screen" | "window";
	appName: string | null;
	windowTitle: string | null;
	bundleId: string | null;
};

export function demoRoot(fromUrl: string = import.meta.url): string {
	return path.dirname(fileURLToPath(fromUrl));
}

export function repoRoot(fromUrl: string = import.meta.url): string {
	return path.resolve(demoRoot(fromUrl), "..");
}

export function recordBotArgv(args: string[], root: string = repoRoot()): string[] {
	return [path.join(root, "cli", "index.ts"), ...args];
}

export function warpMouseArgv(
	x: number,
	y: number,
	steps = 24,
	root: string = demoRoot(),
): string[] {
	return [path.join(root, "warp_mouse.py"), String(x), String(y), String(steps)];
}

export type CssChromeMetrics = {
	screenX: number;
	screenY: number;
	outerWidth: number;
	outerHeight: number;
	innerWidth: number;
	innerHeight: number;
	devicePixelRatio?: number;
};

export type CssBoxScreenMetrics = CssChromeMetrics & {
	box: { x: number; y: number; width: number; height: number };
};

function deviceScale(metrics: CssChromeMetrics): number {
	return typeof metrics.devicePixelRatio === "number" && metrics.devicePixelRatio > 0
		? metrics.devicePixelRatio
		: 1;
}

function chromeInset(metrics: CssChromeMetrics): { left: number; top: number } {
	return {
		left: Math.max(0, metrics.outerWidth - metrics.innerWidth) / 2,
		top: Math.max(0, metrics.outerHeight - metrics.innerHeight),
	};
}

export function cssBoxToScreenPoint(metrics: CssBoxScreenMetrics): { x: number; y: number } {
	const dpr = deviceScale(metrics);
	const chrome = chromeInset(metrics);
	return {
		x: (metrics.screenX + chrome.left + metrics.box.x + metrics.box.width / 2) * dpr,
		y: (metrics.screenY + chrome.top + metrics.box.y + metrics.box.height / 2) * dpr,
	};
}

export function physicalToCssPoint(
	metrics: CssChromeMetrics,
	point: { x: number; y: number },
): { x: number; y: number } {
	const dpr = deviceScale(metrics);
	const chrome = chromeInset(metrics);
	return {
		x: point.x / dpr - metrics.screenX - chrome.left,
		y: point.y / dpr - metrics.screenY - chrome.top,
	};
}

export function clickMouseArgv(root: string = demoRoot()): string[] {
	return [path.join(root, "warp_mouse.py"), "click"];
}

export function mouseButtonArgv(action: "down" | "up", root: string = demoRoot()): string[] {
	return [path.join(root, "warp_mouse.py"), action];
}

export function interpolateMousePath(
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps = 24,
): { x: number; y: number }[] {
	const count = Math.max(1, Math.round(steps));
	const points: { x: number; y: number }[] = [];
	for (let index = 1; index <= count; index += 1) {
		const mix = index / count;
		const ease = mix * mix * (3 - 2 * mix);
		points.push({
			x: Math.round(from.x + (to.x - from.x) * ease),
			y: Math.round(from.y + (to.y - from.y) * ease),
		});
	}
	return points;
}

export function nodeTypeStripArgs(args: string[]): string[] {
	const major = Number.parseInt(process.versions.node, 10);
	if (Number.isFinite(major) && major < 24) {
		return ["--experimental-strip-types", ...args];
	}
	return args;
}

function parseXdotoolLocation(stdout: string): { x: number; y: number } | null {
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
		return null;
	}
	return { x, y };
}

export async function linuxMouseLocation(): Promise<{ x: number; y: number } | null> {
	try {
		const { stdout } = await execFileAsync("xdotool", ["getmouselocation", "--shell"], {
			timeout: 1000,
		});
		return parseXdotoolLocation(stdout);
	} catch {
		return null;
	}
}

const CLICK_HOLD_MS = 90;
const WARP_STEP_SLEEP = "0.012";

// Build the eased path as a single chained `xdotool` invocation instead of one
// spawn per step. Spawning xdotool ~24 times per move cost 1-2s of process
// overhead on the CPU-only recorder (laggy pointer, dead pauses); one spawn with
// interleaved `sleep`s keeps the pointer travelling over time so the 60Hz cursor
// log still samples a smooth trajectory. The trailing `mousemove --sync` lands
// exactly on the target, and `--sync` does not block when no movement is needed.
export function buildWarpArgs(
	origin: { x: number; y: number },
	target: { x: number; y: number },
	steps: number,
): string[] {
	const args: string[] = [];
	let last = origin;
	for (const point of interpolateMousePath(origin, target, steps)) {
		if (point.x === last.x && point.y === last.y) {
			continue;
		}
		if (args.length > 0) {
			args.push("sleep", WARP_STEP_SLEEP);
		}
		args.push("mousemove", "--sync", String(point.x), String(point.y));
		last = point;
	}
	return args;
}

async function warpLinuxMouse(x: number, y: number, steps: number): Promise<void> {
	const target = { x: Math.round(x), y: Math.round(y) };
	const origin = (await linuxMouseLocation()) ?? target;
	const args = buildWarpArgs(origin, target, steps);
	if (args.length === 0) {
		return;
	}
	try {
		await execFileAsync("xdotool", args, { timeout: 8000 });
	} catch {
		// Best effort; move-button clicks verify the result and retry if the
		// pointer fell short, so a dropped warp cannot silently mis-click.
	}
}

const DRAG_PRESS_HOLD = "0.09";
const DRAG_STEP_SLEEP = "0.02";
const DRAG_RELEASE_HOLD = "0.09";

// One chained xdotool invocation for a press-drag-release: reposition at the
// start, press the left button, travel the eased path, then release.
//
// Critically, NO `mousemove --sync` anywhere. `--sync` blocks until a
// pointer-motion event is confirmed, but the caller has already warped the
// pointer onto `origin`, so a `--sync` move to that same coordinate waits for a
// motion that never fires and stalls until the process timeout (8s per drag) —
// the button press and travel after it never run, so the canvas stays blank.
// Plain `mousemove` executes immediately; sleeps pace the travel into genuine
// drag motion, and the press/release holds let the canvas register the gesture.
export function buildDragArgs(
	origin: { x: number; y: number },
	target: { x: number; y: number },
	steps: number,
): string[] {
	const args = [
		"mousemove",
		String(origin.x),
		String(origin.y),
		"mousedown",
		"1",
		"sleep",
		DRAG_PRESS_HOLD,
	];
	let last = origin;
	for (const point of interpolateMousePath(origin, target, steps)) {
		if (point.x === last.x && point.y === last.y) {
			continue;
		}
		args.push("mousemove", String(point.x), String(point.y), "sleep", DRAG_STEP_SLEEP);
		last = point;
	}
	args.push("sleep", DRAG_RELEASE_HOLD, "mouseup", "1");
	return args;
}

async function dragLinuxMouse(
	from: { x: number; y: number },
	to: { x: number; y: number },
	steps: number,
): Promise<void> {
	const origin = { x: Math.round(from.x), y: Math.round(from.y) };
	const target = { x: Math.round(to.x), y: Math.round(to.y) };
	const args = buildDragArgs(origin, target, steps);
	const started = Date.now();
	try {
		await execFileAsync("xdotool", args, { timeout: 8000 });
		if (process.env.RECORD_BOT_DEMO_DEBUG) {
			process.stderr.write(
				`drag ${origin.x},${origin.y}->${target.x},${target.y} tokens=${args.length} in ${Date.now() - started}ms\n`,
			);
		}
	} catch (error) {
		// Best effort; a dropped drag just leaves the canvas unchanged.
		if (process.env.RECORD_BOT_DEMO_DEBUG) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`drag failed after ${Date.now() - started}ms: ${message}\n`);
		}
	}
}

// Press-drag-release with the real OS pointer. On Linux this is one xdotool
// invocation; on macOS it sequences the CGEvent helper (move, down, move, up).
export async function dragOsMouse(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	steps = 24,
): Promise<void> {
	if (process.platform === "linux") {
		return dragLinuxMouse({ x: fromX, y: fromY }, { x: toX, y: toY }, steps);
	}
	if (process.platform !== "darwin") {
		return;
	}
	await runDarwinMouse(warpMouseArgv(fromX, fromY, steps));
	await runDarwinMouse(mouseButtonArgv("down"));
	await runDarwinMouse(warpMouseArgv(toX, toY, steps));
	await runDarwinMouse(mouseButtonArgv("up"));
}

function runDarwinMouse(argv: string[]): Promise<void> {
	return new Promise((resolve) => {
		const child = spawn("/usr/bin/python3", argv, {
			stdio: ["ignore", "ignore", "ignore"],
		});
		const finish = () => {
			resolve();
		};
		child.once("error", finish);
		child.once("close", finish);
	});
}

export function warpOsMouse(x: number, y: number, steps = 24): Promise<void> {
	if (process.platform === "linux") {
		return warpLinuxMouse(Math.round(x), Math.round(y), steps);
	}
	if (process.platform !== "darwin") {
		return Promise.resolve();
	}
	return runDarwinMouse(warpMouseArgv(x, y, steps));
}

export async function clickOsMouse(): Promise<void> {
	if (process.platform === "linux") {
		try {
			await execFileAsync("xdotool", ["mousedown", "1"], { timeout: 1000 });
			await sleep(CLICK_HOLD_MS);
		} finally {
			try {
				await execFileAsync("xdotool", ["mouseup", "1"], { timeout: 1000 });
			} catch {
				/* ignore */
			}
		}
		return;
	}
	if (process.platform !== "darwin") {
		return;
	}
	await runDarwinMouse(clickMouseArgv());
}

export function parseDemoArgs(
	argv: string[],
	defaults: { outDir: string; scenario: string },
): DemoArgs | { error: string } {
	let output: string | null = null;
	let voiceover = true;
	let windowTitle: string | undefined;
	let scenario = defaults.scenario;
	let list = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--no-voiceover") {
			voiceover = false;
			continue;
		}
		if (arg === "--list") {
			list = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			return { error: "help" };
		}
		const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (
			flag === "--output" ||
			flag === "-o" ||
			flag === "--window-title" ||
			flag === "--scenario" ||
			flag === "-s"
		) {
			const inline = arg.slice(flag.length);
			let value: string;
			if (inline.startsWith("=")) {
				value = inline.slice(1);
			} else {
				value = argv[index + 1] ?? "";
				index += 1;
			}
			if (!value || value.startsWith("-")) {
				return { error: `${flag} requires a value` };
			}
			if (flag === "--window-title") {
				windowTitle = value;
				continue;
			}
			if (flag === "--scenario" || flag === "-s") {
				scenario = value;
				continue;
			}
			output = value;
			continue;
		}
		return { error: `Unknown option "${arg}".` };
	}

	const resolvedOutput = output
		? path.resolve(output)
		: path.resolve(defaults.outDir, `${scenario}.mp4`);
	return { output: resolvedOutput, voiceover, windowTitle, scenario, list };
}

export function parseCliJson(stdout: string): Record<string, unknown> {
	const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
	if (!line) {
		throw new Error("record-bot printed no JSON");
	}
	try {
		return JSON.parse(line) as Record<string, unknown>;
	} catch {
		throw new Error(`record-bot printed invalid JSON: ${line}`);
	}
}

export function findDemoWindow(
	sources: PublicSource[],
	needle: string = DEMO_WINDOW_TITLE,
): PublicSource | null {
	const windows = sources.filter((source) => source.sourceType === "window");
	const match = needle.trim().toLowerCase();
	const hits = windows.filter((source) => {
		const haystacks = [source.name, source.appName, source.windowTitle];
		return haystacks.some((value) => (value ?? "").toLowerCase().includes(match));
	});
	const exact = hits.filter((source) => {
		const haystacks = [source.name, source.appName, source.windowTitle];
		return haystacks.some((value) => (value ?? "").trim().toLowerCase() === match);
	});
	if (exact.length === 1) {
		return exact[0];
	}
	if (hits.length === 1) {
		return hits[0];
	}
	return exact[0] ?? hits[0] ?? null;
}

export function runRecordBot(
	args: string[],
	options?: { cwd?: string; root?: string },
): Promise<{ code: number; stdout: string; json: Record<string, unknown> }> {
	const argv = recordBotArgv(args, options?.root);
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, nodeTypeStripArgs(argv), {
			cwd: options?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.pipe(process.stderr);
		child.once("error", reject);
		child.once("close", (code) => {
			try {
				resolve({
					code: code ?? 1,
					stdout,
					json: parseCliJson(stdout),
				});
			} catch (error) {
				reject(error);
			}
		});
	});
}

export function spawnRecordBot(
	args: string[],
	options?: { cwd?: string; root?: string },
): ChildProcessWithoutNullStreams {
	const child = spawn(process.execPath, nodeTypeStripArgs(recordBotArgv(args, options?.root)), {
		cwd: options?.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stderr.pipe(process.stderr);
	return child;
}

export function waitForCliJson(
	child: ChildProcessWithoutNullStreams,
): Promise<{ code: number; stdout: string; json: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			try {
				resolve({
					code: code ?? 1,
					stdout,
					json: parseCliJson(stdout),
				});
			} catch (error) {
				reject(error);
			}
		});
	});
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
