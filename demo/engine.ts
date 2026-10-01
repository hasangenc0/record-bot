import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import {
	type CursorKind,
	cursorHintPath,
	normalizeCursorKind,
	writeCursorHint,
} from "../cli/cursorKind.ts";
import {
	clickOsMouse,
	cssBoxToScreenPoint,
	dragOsMouse,
	findDemoWindow,
	linuxMouseLocation,
	type PublicSource,
	physicalToCssPoint,
	repoRoot,
	runRecordBot,
	sleep,
	spawnRecordBot,
	waitForCliJson,
	warpOsMouse,
} from "./lib.ts";

const RECORD_SETTLE_MS = 500;

// Where a scenario points the recorder. `local` serves a static directory over
// HTTP (the Harbor board); `url` navigates to a live site (GitHub, etc.).
export type ScenarioTarget = { kind: "local"; appDir: string } | { kind: "url"; url: string };

// A single demo. Everything app-specific lives here; the engine stays generic.
export type Scenario = {
	// CLI id, e.g. "harbor" or "github".
	name: string;
	// One-line summary for `--list`.
	description: string;
	// macOS window-capture match (substring of app/window title). On Linux the
	// whole screen is recorded so this is only used to find the browser window.
	windowTitle: string;
	target: ScenarioTarget;
	// Optional narration. `text` is spoken as-is; `textFile` reads an absolute
	// path. Ignored when the run is invoked with voiceover disabled.
	voiceover?: { text?: string; textFile?: string };
	// Block until the page is ready to drive (selectors present, banners gone).
	ready: (ctx: DemoContext) => Promise<void>;
	// The choreographed walkthrough.
	run: (ctx: DemoContext) => Promise<void>;
};

// The toolkit every scenario drives the page with. These wrap the real OS
// pointer (xdotool / CGEvent), cursor-kind hinting, and eased motion so each
// demo reads as a short, declarative script.
export type DemoContext = {
	page: Page;
	sleep: (ms: number) => Promise<void>;
	locator: (target: string | Locator) => Locator;
	moveTo: (target: string | Locator) => Promise<Locator>;
	moveAndClick: (target: string | Locator) => Promise<void>;
	moveAndType: (target: string | Locator, text: string, delay?: number) => Promise<void>;
	clickAtPointer: () => Promise<void>;
	refreshCursorHint: () => Promise<void>;
	// Canvas helpers: coordinates are CSS pixels relative to the viewport.
	viewportSize: () => Promise<{ width: number; height: number }>;
	moveToPoint: (cssX: number, cssY: number) => Promise<void>;
	drag: (from: { x: number; y: number }, to: { x: number; y: number }) => Promise<void>;
};

export type RunOptions = {
	output: string;
	voiceover: boolean;
	// Overrides the scenario's macOS window match when set.
	windowTitle?: string;
};

function writeErr(message: string) {
	process.stderr.write(`${message}\n`);
}

function cliError(payload: Record<string, unknown>): string {
	const error = String(payload.error ?? "record failed");
	const details = payload.details;
	if (typeof details === "string" && details.trim() && details !== error) {
		return `${error}: ${details}`;
	}
	return error;
}

function serveApp(appDir: string): Promise<{ url: string; close: () => Promise<void> }> {
	const root = path.resolve(appDir);
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const relative = url.pathname === "/" ? "index.html" : url.pathname;
		const resolved = path.resolve(root, `.${path.sep}${relative}`);
		if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
			res.writeHead(403).end();
			return;
		}
		fs.readFile(resolved, (error, data) => {
			if (error) {
				res.writeHead(404).end("not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(data);
		});
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}/`,
				close: () =>
					new Promise((done, fail) => {
						server.close((error) => {
							if (error) {
								fail(error);
								return;
							}
							done();
						});
					}),
			});
		});
	});
}

async function screenCenter(locator: Locator): Promise<{ x: number; y: number } | null> {
	const metrics = await locator.evaluate((el: HTMLElement) => {
		const box = el.getBoundingClientRect();
		if (box.width < 1 || box.height < 1) {
			return null;
		}
		return {
			screenX: window.screenX,
			screenY: window.screenY,
			outerWidth: window.outerWidth,
			outerHeight: window.outerHeight,
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			box: { x: box.x, y: box.y, width: box.width, height: box.height },
			devicePixelRatio: window.devicePixelRatio || 1,
		};
	});
	if (!metrics) {
		return null;
	}
	return cssBoxToScreenPoint(metrics);
}

async function stableScreenCenter(locator: Locator): Promise<{ x: number; y: number } | null> {
	let last: { x: number; y: number } | null = null;
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const next = await screenCenter(locator);
		if (last && next && Math.abs(next.x - last.x) < 1.5 && Math.abs(next.y - last.y) < 1.5) {
			return next;
		}
		last = next;
		await sleep(40);
	}
	return last;
}

function recordArgs(styledPath: string, background: string, windowId?: string): string[] {
	const args = [
		"record",
		"-o",
		styledPath,
		"--json",
		"--zoom",
		"auto",
		"--cursor",
		"--padding",
		"40",
		"--background",
		background,
	];
	if (windowId) {
		args.splice(1, 0, "--window-id", windowId);
	} else {
		args.splice(1, 0, "--screen", "1");
	}
	return args;
}

async function waitForDemoWindow(title: string, timeoutMs = 15000): Promise<PublicSource> {
	const deadline = Date.now() + timeoutMs;
	let lastNames: string[] = [];
	while (Date.now() < deadline) {
		const listed = await runRecordBot(["sources", "--json", "--windows"]);
		if (listed.json.ok !== true) {
			throw new Error(String(listed.json.error ?? "sources failed"));
		}
		const sources = listed.json.sources as PublicSource[];
		lastNames = sources.map((source) => source.name);
		const match = findDemoWindow(sources, title);
		if (match) {
			return match;
		}
		await sleep(400);
	}
	const hint = lastNames.slice(0, 12).join("\n  ");
	throw new Error(
		`No window matching "${title}" after ${timeoutMs}ms.${hint ? `\nVisible windows:\n  ${hint}` : ""}`,
	);
}

async function generateVoiceover(wavPath: string, scriptPath: string): Promise<number> {
	writeErr("Generating F5-TTS voiceover...");
	const result = await runRecordBot([
		"voiceover",
		"--text-file",
		scriptPath,
		"-o",
		wavPath,
		"--seed",
		"7",
		"--nfe-step",
		"16",
		"--speed",
		"0.9",
		"--json",
	]);
	if (result.json.ok !== true) {
		throw new Error(String(result.json.error ?? "voiceover failed"));
	}
	return Number(result.json.durationMs) || 0;
}

// Resolve the narration into a script file path, materialising inline text into
// a temp file. Returns null when the scenario has no narration.
function resolveVoiceoverScript(scenario: Scenario, outDir: string): string | null {
	const vo = scenario.voiceover;
	if (!vo) {
		return null;
	}
	if (vo.textFile) {
		return vo.textFile;
	}
	if (vo.text?.trim()) {
		const scriptPath = path.join(outDir, `${scenario.name}.script.txt`);
		fs.writeFileSync(scriptPath, `${vo.text.trim()}\n`);
		return scriptPath;
	}
	return null;
}

// Cursor-kind + button state shared across the context helpers. Polled against
// the live pointer position so the overlay shows pointer/text/arrow correctly.
type CursorState = { kind: CursorKind; buttons: number };

function buildContext(page: Page, state: CursorState): DemoContext {
	const resolve = (target: string | Locator): Locator =>
		typeof target === "string" ? page.locator(target) : target;

	async function refreshCursorHint() {
		if (!process.env.RECORD_BOT_CURSOR_HINT) {
			return;
		}
		try {
			const loc = await linuxMouseLocation();
			if (!loc) {
				return;
			}
			const metrics = await page.evaluate(() => ({
				screenX: window.screenX,
				screenY: window.screenY,
				outerWidth: window.outerWidth,
				outerHeight: window.outerHeight,
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio || 1,
			}));
			const css = physicalToCssPoint(metrics, loc);
			const cssName = await page.evaluate(({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				if (!el) {
					return "default";
				}
				return getComputedStyle(el).cursor;
			}, css);
			state.kind = normalizeCursorKind(cssName);
			await writeCursorHint({ cursor: state.kind, buttons: state.buttons });
		} catch {
			/* page closed */
		}
	}

	async function clickAtPointer() {
		state.buttons = 1;
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			await writeCursorHint({ cursor: state.kind, buttons: 1 });
		}
		await clickOsMouse();
		state.buttons = 0;
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			await writeCursorHint({ cursor: state.kind, buttons: 0 });
		}
	}

	async function moveTo(target: string | Locator): Promise<Locator> {
		const locator = resolve(target);
		await locator.waitFor({ state: "visible" });
		await locator.scrollIntoViewIfNeeded();
		const screen = await stableScreenCenter(locator);
		if (screen) {
			await warpOsMouse(screen.x, screen.y);
		}
		await sleep(160);
		await refreshCursorHint();
		return locator;
	}

	async function moveAndClick(target: string | Locator) {
		await moveTo(target);
		await sleep(80);
		await clickAtPointer();
		await sleep(140);
	}

	async function moveAndType(target: string | Locator, text: string, delay = 40) {
		const locator = await moveTo(target);
		await sleep(80);
		await clickAtPointer();
		await sleep(80);
		await locator.pressSequentially(text, { delay });
	}

	async function viewportSize() {
		return page.evaluate(() => ({
			width: window.innerWidth,
			height: window.innerHeight,
		}));
	}

	// Convert a CSS-pixel viewport coordinate into an absolute screen point,
	// reusing the same chrome-inset + devicePixelRatio maths as element targets.
	async function screenPointFromCss(cssX: number, cssY: number) {
		const metrics = await page.evaluate(() => ({
			screenX: window.screenX,
			screenY: window.screenY,
			outerWidth: window.outerWidth,
			outerHeight: window.outerHeight,
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			devicePixelRatio: window.devicePixelRatio || 1,
		}));
		return cssBoxToScreenPoint({ ...metrics, box: { x: cssX, y: cssY, width: 0, height: 0 } });
	}

	async function moveToPoint(cssX: number, cssY: number) {
		const screen = await screenPointFromCss(cssX, cssY);
		await warpOsMouse(screen.x, screen.y);
		await sleep(160);
		await refreshCursorHint();
	}

	async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
		const start = await screenPointFromCss(from.x, from.y);
		const end = await screenPointFromCss(to.x, to.y);
		await moveToPoint(from.x, from.y);
		await sleep(80);
		state.buttons = 1;
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			await writeCursorHint({ cursor: state.kind, buttons: 1 });
		}
		await dragOsMouse(start.x, start.y, end.x, end.y);
		state.buttons = 0;
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			await writeCursorHint({ cursor: state.kind, buttons: 0 });
		}
		await sleep(140);
		await refreshCursorHint();
	}

	return {
		page,
		sleep,
		locator: resolve,
		moveTo,
		moveAndClick,
		moveAndType,
		clickAtPointer,
		refreshCursorHint,
		viewportSize,
		moveToPoint,
		drag,
	};
}

function startCursorPoll(context: DemoContext): () => void {
	let busy = false;
	const timer = setInterval(() => {
		if (busy || !process.env.RECORD_BOT_CURSOR_HINT) {
			return;
		}
		busy = true;
		void context.refreshCursorHint().finally(() => {
			busy = false;
		});
	}, 50);
	return () => {
		clearInterval(timer);
	};
}

function chromiumArgsFor(): string[] {
	const args = ["--disable-infobars"];
	if (process.platform === "linux") {
		args.push(
			"--kiosk",
			"--start-fullscreen",
			"--window-position=0,0",
			"--no-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
		);
		if (process.env.RECORD_BOT_DEMO_HIDPI === "1") {
			args.push("--force-device-scale-factor=2", "--window-size=1920,1080");
		}
	} else if (process.env.RECORD_BOT_DEMO_HIDPI === "1") {
		args.push(
			"--force-device-scale-factor=2",
			"--window-size=1680,900",
			"--window-position=80,80",
		);
	} else {
		args.push("--window-size=1600,820", "--window-position=40,40");
	}
	return args;
}

// Drive one scenario end to end: optional voiceover, launch Chromium, point it
// at the target, record with record-bot while the walkthrough runs, then mux.
export async function runDemo(scenario: Scenario, options: RunOptions): Promise<number> {
	const root = repoRoot();
	const outDir = path.dirname(options.output);
	fs.mkdirSync(outDir, { recursive: true });
	if (process.platform === "linux") {
		process.env.RECORD_BOT_CURSOR_HINT = path.join(
			os.tmpdir(),
			`record-bot-cursor-hint-${process.pid}`,
		);
	}

	const scriptPath = options.voiceover ? resolveVoiceoverScript(scenario, outDir) : null;
	const useVoiceover = Boolean(scriptPath);
	const wavPath = path.join(outDir, `${scenario.name}.wav`);
	const styledPath = useVoiceover
		? path.join(outDir, `${path.parse(options.output).name}.styled.mp4`)
		: options.output;
	const background = path.join(root, "demo", "background.png");
	const windowTitle = options.windowTitle ?? scenario.windowTitle;

	const server =
		scenario.target.kind === "local" ? await serveApp(scenario.target.appDir) : null;
	const targetUrl =
		scenario.target.kind === "local" ? (server as { url: string }).url : scenario.target.url;

	let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
	let recorder: ReturnType<typeof spawnRecordBot> | null = null;
	let recorderDone: ReturnType<typeof waitForCliJson> | null = null;
	let stopCursorPoll: (() => void) | null = null;
	let voiceMs = 0;

	try {
		if (useVoiceover && scriptPath) {
			voiceMs = await generateVoiceover(wavPath, scriptPath);
			writeErr(`Voiceover ${Math.round(voiceMs / 100) / 10}s`);
		}
		browser = await chromium.launch({
			headless: false,
			args: chromiumArgsFor(),
			ignoreDefaultArgs: process.platform === "linux" ? ["--enable-automation"] : undefined,
		});
		const browserContext = await browser.newContext({ viewport: null });
		const page = await browserContext.newPage();
		const context = buildContext(page, { kind: "arrow", buttons: 0 });
		writeErr(`Opening ${targetUrl}`);
		await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
		await context.refreshCursorHint();
		await scenario.ready(context);
		await page.bringToFront();
		await sleep(600);
		stopCursorPoll = startCursorPoll(context);
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			await writeCursorHint({ cursor: "arrow", buttons: 0 });
		}

		const recordCommand =
			process.platform === "linux"
				? recordArgs(styledPath, background)
				: recordArgs(styledPath, background, (await waitForDemoWindow(windowTitle)).id);
		writeErr(
			process.platform === "linux" ? "Recording screen 1" : `Recording window ${windowTitle}`,
		);
		recorder = spawnRecordBot(recordCommand);
		recorderDone = waitForCliJson(recorder);
		await sleep(RECORD_SETTLE_MS);
		if (recorder.exitCode !== null) {
			const recorded = await recorderDone;
			writeErr(cliError(recorded.json));
			return 1;
		}
		const started = Date.now();
		await scenario.run(context);
		const elapsed = Date.now() - started;
		const recordedMs = RECORD_SETTLE_MS + elapsed;
		const neededMs = useVoiceover ? voiceMs + 800 : recordedMs + 600;
		if (neededMs > recordedMs) {
			await sleep(neededMs - recordedMs);
		}
		recorder.kill("SIGTERM");
		const recorded = await recorderDone;
		recorder = null;
		if (recorded.json.ok !== true) {
			writeErr(cliError(recorded.json));
			return 1;
		}
		await browser.close().catch(() => undefined);
		browser = null;
		if (!useVoiceover) {
			writeErr(`Saved ${options.output}`);
			return 0;
		}
		writeErr("Muxing voiceover onto styled MP4...");
		const muxed = await runRecordBot([
			"mux",
			"--video",
			styledPath,
			"--audio",
			wavPath,
			"-o",
			options.output,
			"--json",
		]);
		if (muxed.json.ok !== true) {
			writeErr(cliError(muxed.json));
			return 1;
		}
		writeErr(`Saved ${options.output}`);
		return 0;
	} finally {
		stopCursorPoll?.();
		if (recorder && recorderDone) {
			recorder.kill("SIGTERM");
			await recorderDone.catch(() => undefined);
		}
		await browser?.close().catch(() => undefined);
		await server?.close().catch(() => undefined);
		if (process.env.RECORD_BOT_CURSOR_HINT) {
			fs.rmSync(cursorHintPath(), { force: true });
		}
	}
}
