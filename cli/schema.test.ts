import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.ts";
import { cliSchema, schemaFlagNames } from "./schema.ts";

describe("cliSchema", () => {
	it("lists commands, typed flags, defaults, and JSON shapes", () => {
		const schema = cliSchema("9.9.9");
		expect(schema).toMatchObject({
			ok: true,
			name: "record-bot",
			version: "9.9.9",
		});
		expect(schema.commands.map((command) => command.name)).toEqual([
			"sources",
			"record",
			"voiceover",
			"install-tts",
			"mux",
			"skill",
			"schema",
		]);
		const record = schema.commands.find((command) => command.name === "record");
		expect(record?.flags.some((flag) => flag.name === "--crop" && flag.format === "crop")).toBe(
			true,
		);
		expect(record?.flags.find((flag) => flag.name === "--padding")?.default).toBe(80);
		expect(record?.success.properties).toHaveProperty("path");
		expect(record?.success.properties).toHaveProperty("style");
		expect(schema.contract.exit).toEqual({ success: 0, failure: 1 });
		expect(schema.contract.json).toContain("record-bot skill --json");
	});

	it("covers the flags the parser accepts", () => {
		expect(schemaFlagNames("sources").sort()).toEqual(
			["--json", "--screens", "--windows"].sort(),
		);
		expect(schemaFlagNames("record")).toEqual(
			expect.arrayContaining([
				"--json",
				"--screen",
				"--display-id",
				"--window",
				"--window-id",
				"--output",
				"-o",
				"--raw-output",
				"--duration",
				"-d",
				"--mic",
				"--system-audio",
				"--mic-device",
				"--no-style",
				"--styled",
				"--background",
				"--padding",
				"--zoom",
				"--cursor",
				"--no-cursor",
				"--size",
				"--crop",
			]),
		);
		expect(schemaFlagNames("voiceover")).toEqual(
			expect.arrayContaining([
				"--json",
				"--text",
				"--text-file",
				"--ref-audio",
				"--ref-text",
				"--output",
				"-o",
				"--model",
				"--speed",
				"--seed",
				"--nfe-step",
				"--remove-silence",
			]),
		);
		expect(schemaFlagNames("mux")).toEqual(
			expect.arrayContaining([
				"--json",
				"--video",
				"--audio",
				"--output",
				"-o",
				"--delay",
				"--duration",
				"-d",
			]),
		);
		expect(schemaFlagNames("skill")).toEqual(["--json"]);
		expect(schemaFlagNames("install-tts")).toEqual(["--json", "--skip-weights"]);
	});
});

describe("parseCliArgs schema", () => {
	it("treats schema as always-json", () => {
		expect(parseCliArgs(["schema"])).toEqual({ command: "schema", json: true });
		expect(parseCliArgs(["schema", "--json"])).toEqual({ command: "schema", json: true });
		expect(parseCliArgs(["schema", "--nope"])).toEqual({
			command: "error",
			message: 'Unknown option "--nope" for schema. Run record-bot --help.',
			json: true,
		});
	});
});
