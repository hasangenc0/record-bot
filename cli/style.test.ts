import { describe, expect, it } from "vitest";
import {
	clampCropToVideo,
	defaultStyleOptions,
	ffmpegColor,
	parseBackgroundValue,
	parseCanvasSize,
	parseCropValue,
	parseZoomMode,
	rawOutputPathFor,
} from "./style.ts";

describe("style parsers", () => {
	it("parses zoom, size, and background values", () => {
		expect(parseZoomMode("auto")).toEqual({ type: "auto", maxZoom: 1.7 });
		expect(parseZoomMode("off")).toEqual({ type: "off" });
		expect(parseZoomMode("2")).toEqual({ type: "auto", maxZoom: 2 });
		expect(parseZoomMode("nope")).toBeNull();
		expect(parseCanvasSize("1280x720")).toEqual({ width: 1280, height: 720 });
		expect(parseCanvasSize("nope")).toBeNull();
		expect(parseBackgroundValue("#abc")).toEqual({ type: "color", color: "aabbcc" });
		expect(parseBackgroundValue("/tmp/wall.jpg")).toEqual({
			type: "image",
			path: "/tmp/wall.jpg",
		});
		expect(ffmpegColor("#1a1a24")).toBe("0x1a1a24");
		expect(parseCropValue("100, 80, 1280, 720")).toEqual({
			x: 100,
			y: 80,
			width: 1280,
			height: 720,
		});
		expect(parseCropValue("1280x720+100+80")).toEqual({
			x: 100,
			y: 80,
			width: 1280,
			height: 720,
		});
		expect(parseCropValue("8,8,8,8")).toBeNull();
		expect(clampCropToVideo({ x: 40, y: 20, width: 4000, height: 4000 }, 1920, 1080)).toEqual({
			x: 40,
			y: 20,
			width: 1880,
			height: 1060,
		});
	});

	it("derives a sibling raw path", () => {
		expect(rawOutputPathFor("/tmp/demo.mp4")).toBe("/tmp/demo.raw.mp4");
		expect(rawOutputPathFor("/tmp/demo.mp4", "/tmp/keep.mp4")).toBe("/tmp/keep.mp4");
		expect(defaultStyleOptions().enabled).toBe(true);
	});
});
