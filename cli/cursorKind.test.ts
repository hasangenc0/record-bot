import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clickRingDrawing } from "./cursorDraw.ts";
import {
	cursorHintPath,
	cursorKindForSelector,
	normalizeCursorKind,
	parseCursorHint,
	writeCursorHint,
} from "./cursorKind.ts";
import { buildCursorPng, cursorHotspot } from "./cursorPng.ts";

describe("normalizeCursorKind", () => {
	it("maps CSS and OS names", () => {
		expect(normalizeCursorKind("pointingHand")).toBe("pointer");
		expect(normalizeCursorKind("i-beam")).toBe("text");
		expect(normalizeCursorKind("default")).toBe("arrow");
		expect(normalizeCursorKind("none")).toBe("arrow");
	});
});

describe("cursorKindForSelector", () => {
	it("uses text for inputs and pointer for buttons", () => {
		expect(cursorKindForSelector("[data-testid='search']")).toBe("text");
		expect(cursorKindForSelector("[data-testid='task-title']")).toBe("text");
		expect(cursorKindForSelector("[data-testid='card-design-review'] [data-move]")).toBe(
			"pointer",
		);
		expect(cursorKindForSelector("[data-testid='board']")).toBe("arrow");
	});
});

describe("cursorHint", () => {
	const previous = process.env.RECORD_BOT_CURSOR_HINT;

	afterEach(() => {
		if (previous === undefined) {
			delete process.env.RECORD_BOT_CURSOR_HINT;
		} else {
			process.env.RECORD_BOT_CURSOR_HINT = previous;
		}
	});

	it("round-trips JSON onto disk", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "record-bot-hint-"));
		process.env.RECORD_BOT_CURSOR_HINT = path.join(dir, "hint.json");
		await writeCursorHint({ cursor: "pointer", buttons: 1 });
		expect(parseCursorHint(await readFile(cursorHintPath(), "utf8"))).toEqual({
			cursor: "pointer",
			buttons: 1,
		});
	});
});

describe("cursor sprites", () => {
	it("keeps the arrow hotspot near the tip", () => {
		expect(cursorHotspot("arrow", 32).x).toBeLessThan(10);
		expect(cursorHotspot("arrow", 32).y).toBeLessThan(10);
		const png = buildCursorPng("arrow");
		expect(png[0]).toBe(137);
		expect(png.readUInt32BE(16)).toBe(128);
	});

	it("centers the I-beam and points the hand at its fingertip", () => {
		const text = cursorHotspot("text", 32);
		expect(text.x).toBeGreaterThan(4);
		expect(text.x).toBeLessThan(16);
		expect(text.y).toBeGreaterThan(4);
		expect(text.y).toBeLessThan(16);
		const pointer = cursorHotspot("pointer", 32);
		expect(pointer.y).toBeLessThan(12);
		expect(pointer.x).toBeGreaterThan(6);
		expect(pointer.x).toBeLessThan(16);
		expect(
			buildCursorPng("pointer").subarray(0, 8).equals(buildCursorPng("arrow").subarray(0, 8)),
		).toBe(true);
		expect(clickRingDrawing(12)).toContain("m 12 0");
	});
});
