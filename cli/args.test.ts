import { describe, expect, it } from "vitest";
import { getCliArgv, parseCliArgs, parseDurationSeconds, splitCliEnv } from "./args.ts";
import { defaultStyleOptions } from "./style.ts";

describe("parseDurationSeconds", () => {
	it("parses bare seconds, s, m, and ms suffixes", () => {
		expect(parseDurationSeconds("30")).toBe(30);
		expect(parseDurationSeconds("10s")).toBe(10);
		expect(parseDurationSeconds("1.5m")).toBe(90);
		expect(parseDurationSeconds("500ms")).toBe(0.5);
		expect(parseDurationSeconds("0")).toBeNull();
		expect(parseDurationSeconds("0", { allowZero: true })).toBe(0);
		expect(parseDurationSeconds("nope")).toBeNull();
	});
});

describe("parseCliArgs", () => {
	it("prints help when no command is given", () => {
		expect(parseCliArgs([])).toEqual({ command: "help" });
		expect(parseCliArgs(["--help"])).toEqual({ command: "help" });
	});

	it("parses sources filters", () => {
		expect(parseCliArgs(["sources"])).toEqual({
			command: "sources",
			json: false,
			screens: true,
			windows: true,
		});
		expect(parseCliArgs(["list", "--windows", "--json"])).toEqual({
			command: "sources",
			json: true,
			screens: false,
			windows: true,
		});
	});

	it("parses record options", () => {
		expect(
			parseCliArgs([
				"record",
				"--screen",
				"2",
				"--window",
				"Safari",
				"--mic",
				"--system-audio",
				"--duration",
				"1m",
				"-o",
				"out.mp4",
			]),
		).toEqual({
			command: "record",
			json: false,
			screen: 2,
			displayId: undefined,
			window: "Safari",
			windowId: undefined,
			output: "out.mp4",
			rawOutput: undefined,
			mic: true,
			systemAudio: true,
			micDevice: undefined,
			durationSeconds: 60,
			style: defaultStyleOptions(),
		});
	});

	it("parses styled export flags", () => {
		const parsed = parseCliArgs([
			"record",
			"--no-cursor",
			"--padding",
			"48",
			"--zoom",
			"2",
			"--size",
			"1280x720",
			"--background",
			"#112233",
			"--crop",
			"100,80,1280,720",
			"--raw-output",
			"raw.mp4",
		]);
		expect(parsed).toMatchObject({
			command: "record",
			rawOutput: "raw.mp4",
			style: {
				enabled: true,
				padding: 48,
				cursor: false,
				canvasWidth: 1280,
				canvasHeight: 720,
				background: { type: "color", color: "112233" },
				zoom: { type: "auto", maxZoom: 2 },
				crop: { x: 100, y: 80, width: 1280, height: 720 },
			},
		});
	});

	it("rejects unknown commands and flags", () => {
		expect(parseCliArgs(["edit"])).toEqual({
			command: "error",
			message: 'Unknown command "edit". Run record-bot --help.',
			json: false,
		});
		expect(parseCliArgs(["record", "--zoom"])).toEqual({
			command: "error",
			message: "--zoom requires a value",
			json: false,
		});
		expect(parseCliArgs(["record", "--crop", "nope"])).toEqual({
			command: "error",
			message: "--crop must be x,y,w,h or WxH+X+Y with width and height at least 16",
			json: false,
		});
		expect(parseCliArgs(["record", "--no-style"])).toMatchObject({
			command: "record",
			style: { enabled: false },
		});
		expect(parseCliArgs(["edit", "--json"])).toEqual({
			command: "error",
			message: 'Unknown command "edit". Run record-bot --help.',
			json: true,
		});
	});

	it("parses mux options", () => {
		expect(
			parseCliArgs([
				"mux",
				"--video",
				"demo.mp4",
				"--audio",
				"vo.wav",
				"-o",
				"out.mp4",
				"--delay",
				"500ms",
				"--json",
			]),
		).toEqual({
			command: "mux",
			json: true,
			video: "demo.mp4",
			audio: "vo.wav",
			output: "out.mp4",
			delaySeconds: 0.5,
			durationSeconds: undefined,
		});
	});

	it("requires mux inputs and rejects a duration shorter than delay", () => {
		expect(parseCliArgs(["mux", "--audio", "vo.wav"])).toEqual({
			command: "error",
			message: "mux requires --video.",
			json: false,
		});
		expect(parseCliArgs(["mux", "--video", "demo.mp4", "--json"])).toEqual({
			command: "error",
			message: "mux requires --audio.",
			json: true,
		});
		expect(
			parseCliArgs([
				"mux",
				"--video",
				"demo.mp4",
				"--audio",
				"vo.wav",
				"--delay",
				"1s",
				"--duration",
				"500ms",
			]),
		).toEqual({
			command: "error",
			message: "--duration must be longer than --delay.",
			json: false,
		});
	});

	it("parses skill", () => {
		expect(parseCliArgs(["skill"])).toEqual({ command: "skill", json: false });
		expect(parseCliArgs(["skill", "--json"])).toEqual({ command: "skill", json: true });
		expect(parseCliArgs(["skill", "--nope"])).toEqual({
			command: "error",
			message: 'Unknown option "--nope" for skill. Run record-bot --help.',
			json: false,
		});
	});

	it("parses install-tts", () => {
		expect(parseCliArgs(["install-tts"])).toEqual({
			command: "install-tts",
			json: false,
			skipWeights: false,
		});
		expect(parseCliArgs(["tts", "--json", "--skip-weights"])).toEqual({
			command: "install-tts",
			json: true,
			skipWeights: true,
		});
		expect(parseCliArgs(["install-tts", "--nope"])).toEqual({
			command: "error",
			message: 'Unknown option "--nope" for install-tts. Run record-bot --help.',
			json: false,
		});
	});
});

describe("getCliArgv", () => {
	it("prefers RECORD_BOT_CLI and reads Node argv after the script path", () => {
		expect(splitCliEnv(`record --window "Google Chrome" -o out.mp4`)).toEqual([
			"record",
			"--window",
			"Google Chrome",
			"-o",
			"out.mp4",
		]);
		expect(getCliArgv(["node", "dist/index.js", "sources", "--json"], {})).toEqual([
			"sources",
			"--json",
		]);
		expect(
			getCliArgv(["node", "dist/index.js", "sources"], {
				RECORD_BOT_CLI: "record --screen 1",
			}),
		).toEqual(["record", "--screen", "1"]);
	});
});
