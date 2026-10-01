import { describe, expect, it } from "vitest";
import { resolveCaptureSource } from "./resolveSource.ts";
import type { CaptureSource } from "./types.ts";

const screens: CaptureSource[] = [
	{
		id: "screen:1",
		name: "Screen 1 (Primary)",
		displayId: "1",
		sourceType: "screen",
	},
	{
		id: "screen:2",
		name: "Screen 2",
		displayId: "2",
		sourceType: "screen",
	},
];

const windows: CaptureSource[] = [
	{
		id: "window:11",
		name: "Safari — GitHub",
		appName: "Safari",
		windowTitle: "GitHub",
		sourceType: "window",
	},
	{
		id: "window:22",
		name: "Code — record-bot",
		appName: "Code",
		windowTitle: "record-bot",
		sourceType: "window",
	},
];

describe("resolveCaptureSource", () => {
	it("defaults to the primary screen", () => {
		expect(resolveCaptureSource([...screens, ...windows], {})).toEqual(screens[0]);
	});

	it("selects screens by 1-based index or display id", () => {
		expect(resolveCaptureSource(screens, { screen: 2 })).toEqual(screens[1]);
		expect(resolveCaptureSource(screens, { displayId: "2" })).toEqual(screens[1]);
	});

	it("matches windows by substring and requires an id when several match", () => {
		expect(resolveCaptureSource(windows, { window: "safari" })).toEqual(windows[0]);
		expect(resolveCaptureSource(windows, { windowId: "22" })).toEqual(windows[1]);
		const ambiguous = resolveCaptureSource(
			[
				...windows,
				{
					id: "window:33",
					name: "Safari — Docs",
					appName: "Safari",
					windowTitle: "Docs",
					sourceType: "window",
				},
			],
			{ window: "Safari" },
		);
		expect(ambiguous).toMatchObject({
			error: expect.stringContaining("Multiple windows match"),
		});
	});
});
