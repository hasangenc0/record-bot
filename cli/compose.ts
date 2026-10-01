import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { clickRingDrawing } from "./cursorDraw.ts";
import type { CursorKind } from "./cursorKind.ts";
import { buildCursorPng, cursorHotspot } from "./cursorPng.ts";
import { STYLE_VIDEO_ARGS } from "./encode.ts";
import { ffmpegPath } from "./ffmpeg.ts";
import { even, ffmpegColor, resolveComposeCrop, type StyleOptions } from "./style.ts";
import type { CaptureSource } from "./types.ts";
import { probeVideo, type VideoInfo } from "./videoInfo.ts";
import {
	buildZoomFrames,
	mergeZoomSegments,
	offsetFramesIntoCrop,
	parseCursorLog,
	pixelScaleForCursor,
	type ZoomFrame,
	zoomSegmentAt,
} from "./zoom.ts";

export type ComposeInput = {
	rawPath: string;
	outputPath: string;
	cursorLogPath?: string;
	source: CaptureSource;
	style: StyleOptions;
};

export type ContentBox = {
	width: number;
	height: number;
	x: number;
	y: number;
};

export function contentBoxFor(
	canvasWidth: number,
	canvasHeight: number,
	padding: number,
	videoWidth: number,
	videoHeight: number,
): ContentBox {
	const maxWidth = Math.max(2, canvasWidth - padding * 2);
	const maxHeight = Math.max(2, canvasHeight - padding * 2);
	const scale = Math.min(
		maxWidth / Math.max(1, videoWidth),
		maxHeight / Math.max(1, videoHeight),
	);
	const width = even(videoWidth * scale);
	const height = even(videoHeight * scale);
	return {
		width,
		height,
		x: even((canvasWidth - width) / 2),
		y: even((canvasHeight - height) / 2),
	};
}

export function cursorSizeFor(box: ContentBox): number {
	return even(Math.min(96, Math.max(32, (44 * box.width) / 1280)));
}

export function canvasCursorPosition(
	frame: ZoomFrame,
	box: ContentBox,
	cursorSize: number,
	kind: CursorKind = frame.cursor,
): { x: number; y: number; clickX: number; clickY: number } {
	const hotspot = cursorHotspot(kind, cursorSize);
	const scale = box.width / Math.max(1, frame.cropW);
	const clickX = box.x + (frame.cursorX - frame.cropX) * scale;
	const clickY = box.y + (frame.cursorY - frame.cropY) * scale;
	return {
		x: Math.round(clickX - hotspot.x),
		y: Math.round(clickY - hotspot.y),
		clickX: Math.round(clickX),
		clickY: Math.round(clickY),
	};
}

function assTime(seconds: number): string {
	const centiseconds = Math.max(0, Math.round(seconds * 100));
	const hours = Math.floor(centiseconds / 360000);
	const minutes = Math.floor((centiseconds % 360000) / 6000);
	const secs = Math.floor((centiseconds % 6000) / 100);
	const cs = centiseconds % 100;
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function overlayName(kind: CursorKind): "arrow" | "pointer" | "ibeam" {
	if (kind === "text") {
		return "ibeam";
	}
	return kind;
}

/**
 * Cursor overlay refresh rate. Kept independent of (and higher than) the zoom
 * SAMPLE_FPS so the pointer moves every output frame instead of holding for
 * several, which is what made motion look laggy.
 */
const OVERLAY_FPS = 60;

export function buildCursorSendCmd(options: {
	frames: ZoomFrame[];
	box: ContentBox;
	cursorSize: number;
	duration: number;
}): string {
	const size = Math.max(18, options.cursorSize);
	const frames = options.frames;
	if (frames.length === 0) {
		return "\n";
	}
	const segments = mergeZoomSegments(frames, options.duration);
	const names = ["arrow", "pointer", "ibeam"] as const;
	const lines: string[] = [];
	const steps = Math.max(1, Math.round(options.duration * OVERLAY_FPS));
	let frameIndex = 0;
	let previousKey = "";
	for (let step = 0; step <= steps; step += 1) {
		const t = Math.min(options.duration, step / OVERLAY_FPS);
		while (frameIndex + 1 < frames.length && frames[frameIndex + 1].t <= t) {
			frameIndex += 1;
		}
		const from = frames[frameIndex];
		const to = frames[frameIndex + 1] ?? from;
		const span = to.t - from.t;
		const mix = span > 1e-6 ? Math.min(1, Math.max(0, (t - from.t) / span)) : 0;
		const segment = zoomSegmentAt(segments, t);
		const mapped = {
			...from,
			cursorX: from.cursorX + (to.cursorX - from.cursorX) * mix,
			cursorY: from.cursorY + (to.cursorY - from.cursorY) * mix,
			cropX: segment?.cropX ?? from.cropX,
			cropY: segment?.cropY ?? from.cropY,
			cropW: segment?.cropW ?? from.cropW,
			cropH: segment?.cropH ?? from.cropH,
		};
		// Hold the kind from the sample at/just before t (nearest-earlier).
		const kind = from.cursor;
		const pos = canvasCursorPosition(mapped, options.box, size, kind);
		const active = overlayName(kind);
		const key = `${active}:${pos.x}:${pos.y}`;
		if (key === previousKey) {
			continue;
		}
		previousKey = key;
		const parts: string[] = [];
		for (const name of names) {
			if (name === active) {
				parts.push(`overlay@${name} x ${pos.x}`, `overlay@${name} y ${pos.y}`);
			} else {
				parts.push(`overlay@${name} x -4096`, `overlay@${name} y -4096`);
			}
		}
		lines.push(`${t.toFixed(3)} ${parts.join(", ")};`);
	}
	return `${lines.join("\n")}\n`;
}

export function buildCursorAss(options: {
	frames: ZoomFrame[];
	box: ContentBox;
	cursorSize: number;
	duration: number;
	canvasWidth: number;
	canvasHeight: number;
}): string {
	const events: string[] = [];
	const size = Math.max(18, options.cursorSize);
	const segments = mergeZoomSegments(options.frames, options.duration);
	for (let index = 0; index < options.frames.length; index += 1) {
		const frame = options.frames[index];
		const next = options.frames[index + 1];
		const end = next ? next.t : options.duration;
		if (end - frame.t < 0.01 || frame.buttons <= 0) {
			continue;
		}
		const segment = zoomSegmentAt(segments, frame.t);
		const mapped = {
			...frame,
			cropX: segment?.cropX ?? frame.cropX,
			cropY: segment?.cropY ?? frame.cropY,
			cropW: segment?.cropW ?? frame.cropW,
			cropH: segment?.cropH ?? frame.cropH,
		};
		const pos = canvasCursorPosition(mapped, options.box, size, frame.cursor);
		const radius = Math.round(size * 0.28);
		events.push(
			`Dialogue: 0,${assTime(frame.t)},${assTime(end)},Click,,0,0,0,,{\\an5\\pos(${pos.clickX},${pos.clickY})\\bord2\\shad0\\1a&HFF&\\3c&H00FFFFFF&\\p1}${clickRingDrawing(radius)}`,
		);
	}
	return `[Script Info]
ScriptType: v4.00+
PlayResX: ${options.canvasWidth}
PlayResY: ${options.canvasHeight}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Click,Arial,20,&H00C8C8C8,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

export function buildZoomFilterScript(options: {
	segments: ReturnType<typeof mergeZoomSegments>;
	box: ContentBox;
	style: StyleOptions;
	drawCursor: boolean;
	assFile: string;
	cmdFile: string;
	bgIndex: number;
	cursorSize: number;
	arrowIndex: number;
	pointerIndex: number;
	ibeamIndex: number;
}): string {
	const parts: string[] = [canvasFilter(options.style, options.bgIndex)];
	if (options.segments.length === 0) {
		parts.push(
			`[0:v]scale=${options.box.width}:${options.box.height}:flags=lanczos,setsar=1[vid]`,
		);
	} else if (options.segments.length === 1) {
		const segment = options.segments[0];
		parts.push(
			`[0:v]crop=${segment.cropW}:${segment.cropH}:${segment.cropX}:${segment.cropY},scale=${options.box.width}:${options.box.height}:flags=lanczos,setsar=1[vid]`,
		);
	} else {
		const labels: string[] = [];
		for (const [index, segment] of options.segments.entries()) {
			const label = `v${index}`;
			labels.push(`[${label}]`);
			parts.push(
				`[0:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS,crop=${segment.cropW}:${segment.cropH}:${segment.cropX}:${segment.cropY},scale=${options.box.width}:${options.box.height}:flags=lanczos,setsar=1[${label}]`,
			);
		}
		parts.push(`${labels.join("")}concat=n=${options.segments.length}:v=1:a=0[vid]`);
	}
	if (options.drawCursor) {
		const size = Math.max(18, options.cursorSize);
		parts.push(
			`[canvas][vid]overlay=${options.box.x}:${options.box.y}[base]`,
			`[${options.arrowIndex}:v]format=rgba,scale=${size}:${size}:flags=bilinear[arrow]`,
			`[${options.pointerIndex}:v]format=rgba,scale=${size}:${size}:flags=bilinear[pointer]`,
			`[${options.ibeamIndex}:v]format=rgba,scale=${size}:${size}:flags=bilinear[ibeam]`,
			`[base]sendcmd=f=${options.cmdFile}[cmd]`,
			`[cmd][arrow]overlay@arrow=x=-4096:y=-4096:eval=frame:format=auto[oa]`,
			`[oa][pointer]overlay@pointer=x=-4096:y=-4096:eval=frame:format=auto[op]`,
			`[op][ibeam]overlay@ibeam=x=-4096:y=-4096:eval=frame:format=auto[oc]`,
			`[oc]ass='${options.assFile}'[styled]`,
		);
	} else {
		parts.push(`[canvas][vid]overlay=${options.box.x}:${options.box.y}[styled]`);
	}
	return `${parts.join(";\n")}\n`;
}

function backgroundArgs(style: StyleOptions, duration: number): string[] {
	if (style.background.type === "image") {
		return ["-loop", "1", "-framerate", "60", "-i", style.background.path];
	}
	if (style.background.type === "color") {
		return [
			"-f",
			"lavfi",
			"-i",
			`color=c=${ffmpegColor(style.background.color)}:s=${style.canvasWidth}x${style.canvasHeight}:r=60:d=${Math.max(duration, 0.1).toFixed(3)}`,
		];
	}
	const exhaustive: never = style.background;
	return exhaustive;
}

function canvasFilter(style: StyleOptions, bgIndex: number): string {
	if (style.background.type === "image") {
		return `[${bgIndex}:v]scale=${style.canvasWidth}:${style.canvasHeight}:force_original_aspect_ratio=increase,crop=${style.canvasWidth}:${style.canvasHeight},setsar=1[canvas]`;
	}
	if (style.background.type === "color") {
		return `[${bgIndex}:v]setsar=1[canvas]`;
	}
	const exhaustive: never = style.background;
	return exhaustive;
}

async function runFfmpeg(args: string[], cwd: string) {
	const ffmpegBin = ffmpegPath();
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegBin, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		const append = (chunk: Buffer) => {
			output += chunk.toString();
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			const tail = output.trim().split("\n").slice(-16).join("\n");
			reject(new Error(tail || `FFmpeg exited with code ${code ?? "unknown"}`));
		});
	});
}

export async function loadCursorSamples(cursorLogPath: string | undefined) {
	if (!cursorLogPath) {
		return [];
	}
	try {
		const text = await fs.readFile(cursorLogPath, "utf8");
		return parseCursorLog(text);
	} catch {
		return [];
	}
}

export function zoomFramesForCompose(options: {
	samples: ReturnType<typeof parseCursorLog>;
	source: CaptureSource;
	video: VideoInfo;
	style: StyleOptions;
}) {
	const scale = pixelScaleForCursor(
		options.samples,
		options.source,
		options.video.width,
		options.video.height,
	);
	const crop = resolveComposeCrop(
		options.style.crop,
		options.video.width,
		options.video.height,
	);
	const localSamples = options.samples.map((sample) => ({
		...sample,
		x: sample.x * scale - crop.x,
		y: sample.y * scale - crop.y,
	}));
	const zoomEnabled = options.style.zoom.type === "auto" && localSamples.length > 0;
	const maxZoom = options.style.zoom.type === "auto" ? options.style.zoom.maxZoom : 1;
	const frames = buildZoomFrames({
		samples: localSamples,
		sourceWidth: crop.width,
		sourceHeight: crop.height,
		duration: options.video.duration,
		maxZoom,
		enabled: zoomEnabled,
	});
	return offsetFramesIntoCrop(frames, crop);
}

export async function composeStyledVideo(input: ComposeInput): Promise<void> {
	const video = await probeVideo(input.rawPath);
	const samples = await loadCursorSamples(input.cursorLogPath);
	const frames = zoomFramesForCompose({
		samples,
		source: input.source,
		video,
		style: input.style,
	});
	const crop = resolveComposeCrop(input.style.crop, video.width, video.height);
	const box = contentBoxFor(
		input.style.canvasWidth,
		input.style.canvasHeight,
		input.style.padding,
		crop.width,
		crop.height,
	);
	const drawCursor = input.style.cursor && samples.length > 0;
	const cursorSize = cursorSizeFor(box);
	const workDir = path.dirname(input.outputPath);
	await fs.mkdir(workDir, { recursive: true });

	const stem = path.parse(input.outputPath).name;
	const scriptFile = `${stem}.filter`;
	const assFile = `${stem}.ass`;
	const cmdFile = `${stem}.cmd`;
	const scriptPath = path.join(workDir, scriptFile);
	const assPath = path.join(workDir, assFile);
	const cmdPath = path.join(workDir, cmdFile);
	const arrowPath = path.join(workDir, `${stem}-arrow.png`);
	const pointerPath = path.join(workDir, `${stem}-pointer.png`);
	const ibeamPath = path.join(workDir, `${stem}-ibeam.png`);
	const segments = mergeZoomSegments(frames, video.duration);
	const extraFiles = [scriptPath, assPath, cmdPath, arrowPath, pointerPath, ibeamPath];

	if (drawCursor) {
		await fs.writeFile(
			assPath,
			buildCursorAss({
				frames,
				box,
				cursorSize,
				duration: video.duration,
				canvasWidth: input.style.canvasWidth,
				canvasHeight: input.style.canvasHeight,
			}),
		);
		await fs.writeFile(
			cmdPath,
			buildCursorSendCmd({
				frames,
				box,
				cursorSize,
				duration: video.duration,
			}),
		);
		await fs.writeFile(arrowPath, buildCursorPng("arrow"));
		await fs.writeFile(pointerPath, buildCursorPng("pointer"));
		await fs.writeFile(ibeamPath, buildCursorPng("text"));
	}
	await fs.writeFile(
		scriptPath,
		buildZoomFilterScript({
			segments,
			box,
			style: input.style,
			drawCursor,
			assFile,
			cmdFile,
			bgIndex: 1,
			cursorSize,
			arrowIndex: 2,
			pointerIndex: 3,
			ibeamIndex: 4,
		}),
	);

	const command = ["-y", "-i", input.rawPath, ...backgroundArgs(input.style, video.duration)];
	if (drawCursor) {
		command.push(
			"-loop",
			"1",
			"-framerate",
			"60",
			"-i",
			arrowPath,
			"-loop",
			"1",
			"-framerate",
			"60",
			"-i",
			pointerPath,
			"-loop",
			"1",
			"-framerate",
			"60",
			"-i",
			ibeamPath,
		);
	}
	command.push(
		"-filter_complex_script",
		scriptPath,
		"-map",
		"[styled]",
		"-t",
		video.duration.toFixed(3),
	);
	if (video.hasAudio) {
		command.push("-map", "0:a", "-c:a", "aac", "-b:a", "192k");
	} else {
		command.push("-an");
	}
	command.push(...STYLE_VIDEO_ARGS, input.outputPath);

	try {
		await runFfmpeg(command, workDir);
	} finally {
		await Promise.all(extraFiles.map((file) => fs.rm(file, { force: true })));
	}
}
