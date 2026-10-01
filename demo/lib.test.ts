import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildDragArgs,
	buildWarpArgs,
	clickMouseArgv,
	cssBoxToScreenPoint,
	findDemoWindow,
	interpolateMousePath,
	mouseButtonArgv,
	parseCliJson,
	parseDemoArgs,
	physicalToCssPoint,
	recordBotArgv,
	repoRoot,
	warpMouseArgv,
} from "./lib.ts";

describe("parseDemoArgs", () => {
	const defaults = { outDir: "demo/out", scenario: "harbor" };

	it("defaults output to the scenario name and keeps voiceover on", () => {
		expect(parseDemoArgs([], defaults)).toEqual({
			output: path.resolve("demo/out", "harbor.mp4"),
			voiceover: true,
			windowTitle: undefined,
			scenario: "harbor",
			list: false,
		});
	});

	it("selects a scenario and derives its default output", () => {
		expect(parseDemoArgs(["--scenario", "github"], defaults)).toEqual({
			output: path.resolve("demo/out", "github.mp4"),
			voiceover: true,
			windowTitle: undefined,
			scenario: "github",
			list: false,
		});
	});

	it("accepts an explicit output, --no-voiceover, and a custom window title", () => {
		expect(
			parseDemoArgs(
				["-o", "/tmp/a.mp4", "--no-voiceover", "--window-title", "Chromium"],
				defaults,
			),
		).toEqual({
			output: path.resolve("/tmp/a.mp4"),
			voiceover: false,
			windowTitle: "Chromium",
			scenario: "harbor",
			list: false,
		});
	});

	it("flags --list", () => {
		const parsed = parseDemoArgs(["--list"], defaults);
		expect("error" in parsed ? null : parsed.list).toBe(true);
	});

	it("rejects unknown flags", () => {
		expect(parseDemoArgs(["--nope"], defaults)).toEqual({
			error: 'Unknown option "--nope".',
		});
	});
});

describe("parseCliJson", () => {
	it("reads the last JSON object from stdout", () => {
		expect(parseCliJson('{"ok":false}\n{"ok":true,"path":"/tmp/a.mp4"}\n')).toEqual({
			ok: true,
			path: "/tmp/a.mp4",
		});
	});

	it("fails when stdout is empty", () => {
		expect(() => parseCliJson("  \n")).toThrow(/no JSON/);
	});
});

describe("findDemoWindow", () => {
	const windows = [
		{
			id: "window:1",
			name: "Terminal — zsh",
			displayId: "1",
			sourceType: "window" as const,
			appName: "Terminal",
			windowTitle: "zsh",
			bundleId: "com.apple.Terminal",
		},
		{
			id: "window:9",
			name: "Chromium — Harbor",
			displayId: "1",
			sourceType: "window" as const,
			appName: "Chromium",
			windowTitle: "Harbor",
			bundleId: "org.chromium.Chromium",
		},
	];

	it("prefers an exact title match", () => {
		expect(findDemoWindow(windows)?.id).toBe("window:9");
		expect(findDemoWindow(windows, "Harbor")?.windowTitle).toBe("Harbor");
	});

	it("returns null when nothing matches", () => {
		expect(findDemoWindow(windows, "Safari")).toBeNull();
	});
});

describe("recordBotArgv", () => {
	it("points at the repo CLI entry", () => {
		const root = repoRoot();
		expect(recordBotArgv(["sources", "--json"], root)).toEqual([
			path.join(root, "cli", "index.ts"),
			"sources",
			"--json",
		]);
	});
});

describe("warpMouseArgv", () => {
	it("points at the demo mouse helper", () => {
		const root = path.join(repoRoot(), "demo");
		expect(warpMouseArgv(120, 80, 12, root)).toEqual([
			path.join(root, "warp_mouse.py"),
			"120",
			"80",
			"12",
		]);
		expect(clickMouseArgv(root)).toEqual([path.join(root, "warp_mouse.py"), "click"]);
	});
});

describe("interpolateMousePath", () => {
	it("ends on the target without wrapping", () => {
		const pathPoints = interpolateMousePath({ x: 40, y: 80 }, { x: 400, y: 240 }, 12);
		expect(pathPoints.at(-1)).toEqual({ x: 400, y: 240 });
		expect(pathPoints[0]?.x).toBeGreaterThanOrEqual(40);
		expect(Math.max(...pathPoints.map((point) => point.x))).toBe(400);
		expect(Math.max(...pathPoints.map((point) => point.y))).toBe(240);
	});
});

describe("buildWarpArgs", () => {
	it("chains the whole path into one invocation ending on the target", () => {
		const args = buildWarpArgs({ x: 40, y: 80 }, { x: 400, y: 240 }, 12);
		// One xdotool spawn: several mousemove steps separated by sleeps.
		expect(args.filter((token) => token === "mousemove").length).toBeGreaterThan(4);
		expect(args.filter((token) => token === "sleep").length).toBeGreaterThan(3);
		expect(args.slice(-4)).toEqual(["mousemove", "--sync", "400", "240"]);
	});

	it("emits nothing when the pointer is already at the target", () => {
		expect(buildWarpArgs({ x: 200, y: 150 }, { x: 200, y: 150 }, 24)).toEqual([]);
	});

	it("drops no-op steps so no move repeats the previous position", () => {
		const args = buildWarpArgs({ x: 100, y: 100 }, { x: 103, y: 100 }, 24);
		const points: string[] = [];
		for (let i = 0; i < args.length; i += 1) {
			if (args[i] === "mousemove") {
				points.push(`${args[i + 2]},${args[i + 3]}`);
			}
		}
		expect(new Set(points).size).toBe(points.length);
	});
});

describe("buildWarpArgs", () => {
	it("chains the whole path into one invocation and lands on the target", () => {
		const args = buildWarpArgs({ x: 40, y: 80 }, { x: 400, y: 240 }, 12);
		// Exactly one mousemove per distinct point, separated by sleeps.
		const moves = args.filter((token) => token === "mousemove").length;
		const sleeps = args.filter((token) => token === "sleep").length;
		expect(moves).toBeGreaterThan(1);
		expect(sleeps).toBe(moves - 1);
		expect(args.slice(-4)).toEqual(["mousemove", "--sync", "400", "240"]);
	});

	it("emits nothing when the pointer is already on the target", () => {
		expect(buildWarpArgs({ x: 200, y: 150 }, { x: 200, y: 150 }, 24)).toEqual([]);
	});

	it("drops duplicate integer steps so no move is a no-op", () => {
		const args = buildWarpArgs({ x: 100, y: 100 }, { x: 103, y: 100 }, 24);
		const coords: string[] = [];
		for (let i = 0; i < args.length; i += 1) {
			if (args[i] === "mousemove") {
				coords.push(`${args[i + 2]},${args[i + 3]}`);
			}
		}
		expect(new Set(coords).size).toBe(coords.length);
	});
});

describe("buildDragArgs", () => {
	it("presses at the origin, travels the eased path, and releases at the target", () => {
		const args = buildDragArgs({ x: 40, y: 80 }, { x: 400, y: 240 }, 12);
		// Reposition at the start (plain mousemove) then hold the button.
		expect(args.slice(0, 5)).toEqual(["mousemove", "40", "80", "mousedown", "1"]);
		expect(args.slice(-2)).toEqual(["mouseup", "1"]);
		// No --sync anywhere: a --sync move to the already-current pointer position
		// hangs until the process timeout.
		expect(args).not.toContain("--sync");
		// The path lands on the target.
		expect(args.join(" ")).toContain("mousemove 400 240");
		expect(args.filter((token) => token === "mousemove").length).toBeGreaterThan(2);
	});
});

describe("mouseButtonArgv", () => {
	it("targets the mouse helper with down/up", () => {
		const root = path.join(repoRoot(), "demo");
		expect(mouseButtonArgv("down", root)).toEqual([path.join(root, "warp_mouse.py"), "down"]);
		expect(mouseButtonArgv("up", root)).toEqual([path.join(root, "warp_mouse.py"), "up"]);
	});
});

describe("cssBoxToScreenPoint", () => {
	const metrics = {
		screenX: 80,
		screenY: 80,
		outerWidth: 1680,
		outerHeight: 980,
		innerWidth: 1680,
		innerHeight: 900,
		box: { x: 200, y: 40, width: 120, height: 32 },
	};

	it("keeps CSS coordinates at 1x", () => {
		expect(cssBoxToScreenPoint(metrics)).toEqual({ x: 340, y: 216 });
	});

	it("scales CSS coordinates to physical pixels at 2x", () => {
		expect(cssBoxToScreenPoint({ ...metrics, devicePixelRatio: 2 })).toEqual({
			x: 680,
			y: 432,
		});
	});

	it("inverts physical pixels back to CSS", () => {
		const hidpi = { ...metrics, devicePixelRatio: 2 };
		const physical = cssBoxToScreenPoint(hidpi);
		expect(physicalToCssPoint(hidpi, physical)).toEqual({
			x: metrics.box.x + metrics.box.width / 2,
			y: metrics.box.y + metrics.box.height / 2,
		});
	});
});

describe("Harbor app", () => {
	it("exposes the walkthrough selectors", () => {
		const html = fs.readFileSync(path.join(repoRoot(), "demo", "app", "index.html"), "utf8");
		for (const marker of [
			'data-testid="board"',
			'data-testid="search"',
			'placeholder="Search tasks"',
			'data-testid="new-task"',
			'data-testid="task-title"',
			'data-testid="submit-task"',
			'id: "design-review"',
			"matchesSearch",
			"<title>Harbor</title>",
		]) {
			expect(html).toContain(marker);
		}
	});

	it("ships a canvas backdrop for styled record", () => {
		expect(fs.existsSync(path.join(repoRoot(), "demo", "background.png"))).toBe(true);
	});

	it("mentions search and marking a task done", () => {
		const script = fs.readFileSync(path.join(repoRoot(), "demo", "script.txt"), "utf8");
		expect(script).toMatch(/search tasks/i);
		expect(script).toMatch(/mark Design review done/);
		expect(script).not.toMatch(/Done column/);
		expect(script).not.toMatch(/to Done/);
	});

	it("uses real CSS cursors instead of hiding the pointer", () => {
		const html = fs.readFileSync(path.join(repoRoot(), "demo", "app", "index.html"), "utf8");
		expect(html).not.toMatch(/cursor:\s*none/);
		expect(html).toContain("cursor: pointer");
		expect(html).toContain("cursor: text");
	});

	it("drives the OS pointer and records the Linux screen", () => {
		const engine = fs.readFileSync(path.join(repoRoot(), "demo", "engine.ts"), "utf8");
		const harborScenario = fs.readFileSync(
			path.join(repoRoot(), "demo", "scenarios", "harbor.ts"),
			"utf8",
		);
		const source = `${engine}\n${harborScenario}`;
		expect(harborScenario).toContain("ControlOrMeta+A");
		expect(source).not.toMatch(/press\("Meta\+A"\)/);
		expect(source).not.toContain("page.mouse");
		expect(source).not.toContain("linuxFrameOffset");
		expect(engine).toContain("RECORD_BOT_DEMO_HIDPI");
		expect(engine).toContain("--force-device-scale-factor=2");
		expect(engine).toContain("--kiosk");
		expect(engine).toContain('--screen", "1"');
		expect(engine).toContain("clickOsMouse");
		expect(engine).toContain("elementFromPoint");
		expect(engine).toContain("getComputedStyle");
		expect(engine).toContain("moveAndType");
	});
});

describe("scenarios", () => {
	it("registers all four demos", () => {
		const source = fs.readFileSync(
			path.join(repoRoot(), "demo", "scenarios", "index.ts"),
			"utf8",
		);
		for (const name of ["harbor", "github", "excalidraw", "osm"]) {
			expect(source).toContain(name);
		}
	});

	it("keeps the harbor demo local and the live demos on real URLs", () => {
		const read = (file: string) =>
			fs.readFileSync(path.join(repoRoot(), "demo", "scenarios", file), "utf8");
		const harborScenario = read("harbor.ts");
		const githubScenario = read("github.ts");
		const excalidrawScenario = read("excalidraw.ts");
		const osmScenario = read("openstreetmap.ts");

		expect(harborScenario).toContain('kind: "local"');

		expect(githubScenario).toContain('kind: "url"');
		expect(githubScenario).toContain("github.com");
		// The tour only leans on the durable repository nav, not list contents.
		expect(githubScenario).toContain('nav[aria-label="Repository"]');
		expect(githubScenario).toContain("waitForURL");

		// Excalidraw drives the canvas via stable toolbar test ids + OS drag.
		expect(excalidrawScenario).toContain("excalidraw.com");
		expect(excalidrawScenario).toContain("toolbar-");
		expect(excalidrawScenario).toContain("ctx.drag");

		expect(osmScenario).toContain("openstreetmap.org");
		expect(osmScenario).toContain("#query");
	});
});
