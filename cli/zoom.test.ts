import { describe, expect, it } from "vitest";
import {
	buildCursorAss,
	buildCursorSendCmd,
	canvasCursorPosition,
	contentBoxFor,
	cursorSizeFor,
	zoomFramesForCompose,
} from "./compose.ts";
import { buildCursorPng } from "./cursorPng.ts";
import { defaultStyleOptions } from "./style.ts";
import { parseFfmpegProbeOutput } from "./videoInfo.ts";
import { buildZoomFrames, mergeZoomSegments, parseCursorLog } from "./zoom.ts";

describe("parseCursorLog", () => {
	it("skips junk and keeps numeric samples", () => {
		const samples = parseCursorLog(`
{"t":0,"x":10,"y":20,"buttons":0}
not json
{"t":0.5,"x":40,"y":80,"buttons":1,"cursor":"pointer"}
`);
		expect(samples).toEqual([
			{ t: 0, x: 10, y: 20, buttons: 0, cursor: "arrow" },
			{ t: 0.5, x: 40, y: 80, buttons: 1, cursor: "pointer" },
		]);
	});
});

describe("buildZoomFrames", () => {
	it("stays at full frame when the cursor is idle", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 50, y: 50, buttons: 0 },
				{ t: 1, x: 51, y: 50, buttons: 0 },
			],
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 1,
			maxZoom: 1.8,
			enabled: true,
		});
		expect(frames.length).toBeGreaterThan(10);
		expect(frames[frames.length - 1]?.zoom).toBeCloseTo(1, 1);
		expect(frames[frames.length - 1]?.cropW).toBeCloseTo(1000, 0);
	});

	it("zooms in around a moving cursor", () => {
		const samples = [
			{ t: 0, x: 400, y: 240, buttons: 1 },
			...Array.from({ length: 16 }, (_, index) => ({
				t: 0.1 + index * 0.05,
				x: 400 + (index % 4) * 18,
				y: 240 + (index % 3) * 14,
				buttons: 0,
			})),
		];
		const frames = buildZoomFrames({
			samples,
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 1,
			maxZoom: 1.8,
			enabled: true,
		});
		const peak = Math.max(...frames.map((frame) => frame.zoom));
		expect(peak).toBeGreaterThan(1.3);
		const lastMoving = frames.find((frame) => frame.t >= 0.6);
		expect(lastMoving).toBeTruthy();
		expect(lastMoving?.cropW).toBeLessThan(1000);
	});

	it("does not zoom in until a long approach settles", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 80, y: 70, buttons: 0 },
				{ t: 0.12, x: 90, y: 80, buttons: 0 },
				{ t: 0.28, x: 280, y: 220, buttons: 0 },
				{ t: 0.42, x: 620, y: 390, buttons: 0 },
				{ t: 0.55, x: 780, y: 480, buttons: 0 },
				{ t: 1.1, x: 782, y: 481, buttons: 0 },
			],
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 1.2,
			maxZoom: 1.8,
			enabled: true,
		});
		const midFlight = frames.find((frame) => frame.t >= 0.3 && frame.t <= 0.4);
		const settled = frames.find((frame) => frame.t >= 1);
		expect(midFlight?.zoom ?? 1).toBeLessThan(1.15);
		expect(settled?.zoom).toBeGreaterThan(1.3);
	});

	it("keeps zoom while the cursor rests after a click", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 400, y: 240, buttons: 1 },
				{ t: 0.08, x: 400, y: 240, buttons: 0 },
				{ t: 2.4, x: 401, y: 241, buttons: 0 },
			],
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 2.4,
			maxZoom: 1.8,
			enabled: true,
		});
		const later = frames.find((frame) => frame.t >= 2);
		expect(later?.zoom).toBeGreaterThan(1.4);
	});

	it("stays zoomed for a nearby follow-up click", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 220, y: 180, buttons: 1 },
				{ t: 0.4, x: 220, y: 180, buttons: 0 },
				{ t: 1.1, x: 300, y: 250, buttons: 1 },
				{ t: 1.6, x: 300, y: 250, buttons: 0 },
			],
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 1.8,
			maxZoom: 1.8,
			enabled: true,
		});
		const mid = frames.find((frame) => frame.t >= 0.9 && frame.t <= 1.05);
		const after = frames.find((frame) => frame.t >= 1.5);
		expect(mid?.zoom).toBeGreaterThan(1.3);
		expect(after?.zoom).toBeGreaterThan(1.3);
	});

	it("pans to follow the cursor while traveling instead of zooming out", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 120, y: 100, buttons: 1 },
				{ t: 0.3, x: 120, y: 100, buttons: 0 },
				{ t: 0.55, x: 160, y: 130, buttons: 0 },
				{ t: 0.7, x: 480, y: 360, buttons: 0 },
				{ t: 0.85, x: 820, y: 500, buttons: 0 },
				{ t: 1.2, x: 840, y: 510, buttons: 1 },
			],
			sourceWidth: 1000,
			sourceHeight: 600,
			duration: 1.3,
			maxZoom: 1.8,
			enabled: true,
		});
		const zoomedIn = frames.find((frame) => frame.t >= 0.35 && frame.t <= 0.5);
		const traveling = frames.find((frame) => frame.t >= 0.9 && frame.t <= 1.05);
		// Stays zoomed while crossing the frame (no pull-out to full frame)...
		expect(zoomedIn?.zoom).toBeGreaterThan(1.3);
		expect(traveling?.zoom).toBeGreaterThan(1.3);
		expect(traveling?.cropW).toBeLessThan(1000);
		// ...and the view pans toward the travel destination.
		expect(traveling?.cropX ?? 0).toBeGreaterThan(zoomedIn?.cropX ?? 0);
	});

	it("does not zoom when disabled", () => {
		const frames = buildZoomFrames({
			samples: [
				{ t: 0, x: 0, y: 0, buttons: 1 },
				{ t: 0.2, x: 400, y: 200, buttons: 1 },
			],
			sourceWidth: 800,
			sourceHeight: 600,
			duration: 0.4,
			maxZoom: 2,
			enabled: false,
		});
		expect(frames.every((frame) => frame.zoom === 1)).toBe(true);
	});
});

describe("compose helpers", () => {
	it("maps a 2x capture cursor onto the 1080p canvas", () => {
		const frames = zoomFramesForCompose({
			samples: [{ t: 0, x: 1680, y: 900, buttons: 0 }],
			source: {
				id: "window:1",
				name: "Harbor",
				sourceType: "window",
				width: 3360,
				height: 1800,
			},
			video: { width: 3360, height: 1800, duration: 0.2, fps: 60, hasAudio: false },
			style: {
				...defaultStyleOptions(),
				zoom: { type: "off" },
				padding: 40,
			},
		});
		const box = contentBoxFor(1920, 1080, 40, 3360, 1800);
		const pos = canvasCursorPosition(frames[0], box, 32);
		expect(pos.x).toBeGreaterThan(box.x + box.width / 2 - 16);
		expect(pos.x).toBeLessThan(box.x + box.width / 2 + 4);
		expect(pos.y).toBeGreaterThan(box.y + box.height / 2 - 16);
		expect(pos.y).toBeLessThan(box.y + box.height / 2 + 4);
	});

	it("fits the capture inside padding", () => {
		const box = contentBoxFor(1920, 1080, 80, 3024, 1964);
		expect(box.width).toBeLessThanOrEqual(1760);
		expect(box.height).toBeLessThanOrEqual(920);
		expect(box.x).toBeGreaterThanOrEqual(80);
		expect(box.y).toBeGreaterThanOrEqual(80);
		expect(cursorSizeFor(box)).toBeGreaterThanOrEqual(24);
	});

	it("writes zoom segments and a moving cursor overlay", () => {
		const frames = zoomFramesForCompose({
			samples: [
				{ t: 0, x: 200, y: 150, buttons: 1 },
				{ t: 0.15, x: 260, y: 180, buttons: 0 },
			],
			source: {
				id: "screen:1",
				name: "Screen",
				sourceType: "screen",
				width: 1000,
				height: 600,
			},
			video: { width: 2000, height: 1200, duration: 0.4, fps: 60, hasAudio: false },
			style: defaultStyleOptions(),
		});
		const box = contentBoxFor(1920, 1080, 80, 2000, 1200);
		const segments = mergeZoomSegments(frames, 0.4);
		expect(segments.length).toBeGreaterThan(0);
		expect(segments.some((segment) => segment.cropW < 2000)).toBe(true);
		const ass = buildCursorAss({
			frames,
			box,
			cursorSize: 32,
			duration: 0.4,
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		expect(ass).toContain("\\pos(");
		expect(ass).toContain("Dialogue:");
	});

	it("draws a click ring and a pointing-hand cursor", () => {
		const frames = zoomFramesForCompose({
			samples: [
				{ t: 0, x: 200, y: 150, buttons: 1, cursor: "pointer" },
				{ t: 0.2, x: 200, y: 150, buttons: 0, cursor: "text" },
			],
			source: {
				id: "screen:1",
				name: "Screen",
				sourceType: "screen",
				width: 1000,
				height: 600,
			},
			video: { width: 1000, height: 600, duration: 0.3, fps: 60, hasAudio: false },
			style: defaultStyleOptions(),
		});
		const box = contentBoxFor(1920, 1080, 80, 1000, 600);
		const ass = buildCursorAss({
			frames,
			box,
			cursorSize: 32,
			duration: 0.3,
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		const cmd = buildCursorSendCmd({
			frames,
			box,
			cursorSize: 32,
			duration: 0.3,
		});
		expect(ass).toContain("Style: Click");
		expect(ass).toContain("\\1a&HFF&");
		expect(cmd).toContain("overlay@pointer x ");
		expect(cmd).toContain("overlay@ibeam x ");
		expect(cmd).toContain("overlay@arrow x -4096");
	});

	it("keeps compose crops inside --crop", () => {
		const frames = zoomFramesForCompose({
			samples: [
				{ t: 0, x: 250, y: 150, buttons: 0 },
				{ t: 0.2, x: 400, y: 180, buttons: 1 },
			],
			source: {
				id: "screen:1",
				name: "Screen",
				sourceType: "screen",
				width: 1000,
				height: 600,
			},
			video: { width: 2000, height: 1200, duration: 0.4, fps: 60, hasAudio: false },
			style: {
				...defaultStyleOptions(),
				zoom: { type: "off" },
				crop: { x: 200, y: 100, width: 800, height: 400 },
			},
		});
		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame.cropX).toBeGreaterThanOrEqual(200);
			expect(frame.cropY).toBeGreaterThanOrEqual(100);
			expect(frame.cropX + frame.cropW).toBeLessThanOrEqual(1000);
			expect(frame.cropY + frame.cropH).toBeLessThanOrEqual(500);
		}
		const box = contentBoxFor(1920, 1080, 80, 800, 400);
		expect(box.width / box.height).toBeCloseTo(2, 1);
	});
});

describe("buildCursorPng", () => {
	it("writes a PNG signature", () => {
		const png = buildCursorPng();
		expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
			true,
		);
	});

	it("ships distinct sprites per cursor kind", () => {
		expect(buildCursorPng("pointer").equals(buildCursorPng("arrow"))).toBe(false);
		expect(buildCursorPng("text").equals(buildCursorPng("arrow"))).toBe(false);
	});
});

describe("cursor overlay smoothness", () => {
	it("emits interpolated positions at ~60fps while moving", () => {
		const frames = zoomFramesForCompose({
			samples: [
				{ t: 0, x: 100, y: 100, buttons: 0, cursor: "arrow" },
				{ t: 0.5, x: 500, y: 400, buttons: 0, cursor: "arrow" },
			],
			source: {
				id: "screen:1",
				name: "Screen",
				sourceType: "screen",
				width: 1000,
				height: 600,
			},
			video: { width: 1000, height: 600, duration: 0.5, fps: 60, hasAudio: false },
			style: defaultStyleOptions(),
		});
		const box = contentBoxFor(1920, 1080, 40, 1000, 600);
		const cmd = buildCursorSendCmd({ frames, box, cursorSize: 40, duration: 0.5 });
		const lines = cmd.trim().split("\n").filter(Boolean);
		// 0.5s of continuous motion should yield far more than the 30fps zoom rate.
		expect(lines.length).toBeGreaterThan(25);
		expect(cmd).toContain("0.017 ");
	});
});

describe("parseFfmpegProbeOutput", () => {
	it("reads duration, size, fps, and audio", () => {
		const info = parseFfmpegProbeOutput(`
Input #0, mov, from 'demo.mp4':
  Duration: 00:00:10.05, start: 0.000000, bitrate: 8000 kb/s
    Stream #0:0[0x1]: Video: h264 (High), yuv420p, 1920x1080, 60 fps, 60 tbr
    Stream #0:1[0x2]: Audio: aac (LC), 48000 Hz, stereo
`);
		expect(info).toEqual({
			width: 1920,
			height: 1080,
			fps: 60,
			duration: 10.05,
			hasAudio: true,
		});
	});
});
