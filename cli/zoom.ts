import { type CursorKind, normalizeCursorKind } from "./cursorKind.ts";
import { type CropRegion, even } from "./style.ts";

export type CursorSample = {
	t: number;
	x: number;
	y: number;
	buttons: number;
	cursor?: CursorKind;
};

export type ZoomFrame = {
	t: number;
	cropX: number;
	cropY: number;
	cropW: number;
	cropH: number;
	zoom: number;
	cursorX: number;
	cursorY: number;
	buttons: number;
	cursor: CursorKind;
};

const SAMPLE_FPS = 30;
const MOVE_THRESHOLD = 12;
const SETTLE_SECONDS = 0.22;
const TRAVEL_FRACTION = 0.34;
const ZOOM_IN_RATE = 0.16;
const ZOOM_OUT_RATE = 0.055;
const CENTER_ACTIVE_RATE = 0.22;
const CENTER_TRAVEL_RATE = 0.16;
const CENTER_IDLE_RATE = 0.07;
const FULL_FRAME_ZOOM = 1.02;

function clamp(value: number, min: number, max: number) {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

function interpolateSample(samples: CursorSample[], t: number): CursorSample {
	if (samples.length === 0) {
		return { t, x: 0, y: 0, buttons: 0, cursor: "arrow" };
	}
	if (t <= samples[0].t) {
		return { ...samples[0], t };
	}
	const last = samples[samples.length - 1];
	if (t >= last.t) {
		return { ...last, t };
	}
	let index = 1;
	while (index < samples.length && samples[index].t < t) {
		index += 1;
	}
	const next = samples[index];
	const prev = samples[index - 1];
	const span = next.t - prev.t;
	const mix = span <= 0 ? 0 : (t - prev.t) / span;
	return {
		t,
		x: prev.x + (next.x - prev.x) * mix,
		y: prev.y + (next.y - prev.y) * mix,
		buttons: mix < 0.5 ? prev.buttons : next.buttons,
		cursor: mix < 0.5 ? (prev.cursor ?? "arrow") : (next.cursor ?? "arrow"),
	};
}

export function parseCursorLog(text: string): CursorSample[] {
	const samples: CursorSample[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as Partial<CursorSample>;
			if (
				typeof parsed.t !== "number" ||
				typeof parsed.x !== "number" ||
				typeof parsed.y !== "number"
			) {
				continue;
			}
			samples.push({
				t: parsed.t,
				x: parsed.x,
				y: parsed.y,
				buttons: typeof parsed.buttons === "number" ? parsed.buttons : 0,
				cursor: normalizeCursorKind(parsed.cursor),
			});
		} catch {}
	}
	samples.sort((left, right) => left.t - right.t);
	return samples;
}

export function buildZoomFrames(options: {
	samples: CursorSample[];
	sourceWidth: number;
	sourceHeight: number;
	duration: number;
	maxZoom: number;
	enabled: boolean;
}): ZoomFrame[] {
	const sourceWidth = Math.max(2, options.sourceWidth);
	const sourceHeight = Math.max(2, options.sourceHeight);
	const duration = Math.max(options.duration, 1 / SAMPLE_FPS);
	const frameCount = Math.max(1, Math.round(duration * SAMPLE_FPS) + 1);
	const samples = options.samples;
	const frames: ZoomFrame[] = [];
	let zoom = 1;
	let centerX = sourceWidth / 2;
	let centerY = sourceHeight / 2;
	let lastX = samples[0]?.x ?? centerX;
	let lastY = samples[0]?.y ?? centerY;
	let focusX = lastX;
	let focusY = lastY;
	let hasFocus = false;
	let traveling = false;
	let stillSeconds = 0;
	const travelLimit = TRAVEL_FRACTION * Math.min(sourceWidth, sourceHeight);

	for (let index = 0; index < frameCount; index += 1) {
		const t = index / SAMPLE_FPS;
		if (t > duration) {
			break;
		}
		const sample =
			samples.length > 0
				? interpolateSample(samples, t)
				: { t, x: centerX, y: centerY, buttons: 0, cursor: "arrow" as const };
		const step = Math.hypot(sample.x - lastX, sample.y - lastY);
		const fromFocus = Math.hypot(sample.x - focusX, sample.y - focusY);
		const moving = step >= MOVE_THRESHOLD || sample.buttons > 0;
		lastX = sample.x;
		lastY = sample.y;

		if (moving && fromFocus >= travelLimit) {
			traveling = true;
			stillSeconds = 0;
		} else if (moving) {
			stillSeconds = 0;
			if (sample.buttons > 0) {
				hasFocus = true;
			}
		} else {
			stillSeconds += 1 / SAMPLE_FPS;
			if (stillSeconds >= SETTLE_SECONDS) {
				if (traveling) {
					hasFocus = true;
				}
				traveling = false;
				focusX = sample.x;
				focusY = sample.y;
			}
		}

		// Travelling between targets pans the zoomed view to follow the cursor
		// instead of pulling out to full frame and back in, so a target-to-target
		// move reads as a smooth camera pan rather than a jarring zoom pulse.
		let targetZoom: number;
		let targetX: number;
		let targetY: number;
		let centerRate: number;
		if (traveling) {
			targetZoom = zoom;
			targetX = sample.x;
			targetY = sample.y;
			centerRate = CENTER_TRAVEL_RATE;
		} else if (options.enabled && hasFocus) {
			targetZoom = options.maxZoom;
			targetX = sample.x;
			targetY = sample.y;
			centerRate = CENTER_ACTIVE_RATE;
		} else {
			targetZoom = 1;
			targetX = sourceWidth / 2;
			targetY = sourceHeight / 2;
			centerRate = CENTER_IDLE_RATE;
		}
		const zoomRate = targetZoom > zoom ? ZOOM_IN_RATE : ZOOM_OUT_RATE;
		zoom += (targetZoom - zoom) * zoomRate;
		if (zoom < FULL_FRAME_ZOOM && targetZoom <= 1) {
			zoom = 1;
		}
		centerX += (targetX - centerX) * centerRate;
		centerY += (targetY - centerY) * centerRate;

		const cropW = sourceWidth / zoom;
		const cropH = sourceHeight / zoom;
		const cropX = clamp(centerX - cropW / 2, 0, Math.max(0, sourceWidth - cropW));
		const cropY = clamp(centerY - cropH / 2, 0, Math.max(0, sourceHeight - cropH));

		frames.push({
			t,
			cropX,
			cropY,
			cropW,
			cropH,
			zoom,
			cursorX: sample.x,
			cursorY: sample.y,
			buttons: sample.buttons,
			cursor: sample.cursor ?? "arrow",
		});
	}

	return frames;
}

export type ZoomSegment = {
	start: number;
	end: number;
	cropX: number;
	cropY: number;
	cropW: number;
	cropH: number;
};

export function mergeZoomSegments(frames: ZoomFrame[], duration: number): ZoomSegment[] {
	if (frames.length === 0) {
		return [];
	}
	const segments: ZoomSegment[] = [];
	let start = frames[0].t;
	let cropX = frames[0].cropX;
	let cropY = frames[0].cropY;
	let cropW = frames[0].cropW;
	let cropH = frames[0].cropH;
	for (let index = 1; index < frames.length; index += 1) {
		const frame = frames[index];
		const same =
			Math.abs(frame.cropX - cropX) <= 8 &&
			Math.abs(frame.cropY - cropY) <= 8 &&
			Math.abs(frame.cropW - cropW) <= 8 &&
			Math.abs(frame.cropH - cropH) <= 8;
		if (same) {
			continue;
		}
		segments.push({
			start,
			end: frame.t,
			cropX,
			cropY,
			cropW,
			cropH,
		});
		start = frame.t;
		cropX = frame.cropX;
		cropY = frame.cropY;
		cropW = frame.cropW;
		cropH = frame.cropH;
	}
	segments.push({
		start,
		end: Math.max(duration, start + 0.01),
		cropX,
		cropY,
		cropW,
		cropH,
	});
	return segments;
}

export function zoomSegmentAt(segments: ZoomSegment[], t: number): ZoomSegment | undefined {
	for (const segment of segments) {
		if (t >= segment.start && t < segment.end) {
			return segment;
		}
	}
	return segments.at(-1);
}

export function pixelScaleForCursor(
	samples: CursorSample[],
	source: { width?: number; height?: number },
	videoWidth: number,
	videoHeight: number,
): number {
	if (source.width && source.width > 1) {
		return videoWidth / source.width;
	}
	const maxX = Math.max(0, ...samples.map((sample) => sample.x));
	const maxY = Math.max(0, ...samples.map((sample) => sample.y));
	for (const scale of [2, 3, 1]) {
		if (maxX <= videoWidth / scale + 80 && maxY <= videoHeight / scale + 80) {
			return scale;
		}
	}
	return 1;
}

export function mapFrameToVideoPixels(
	frame: ZoomFrame,
	sourceWidth: number,
	sourceHeight: number,
	videoWidth: number,
	videoHeight: number,
): ZoomFrame {
	const scaleX = videoWidth / Math.max(1, sourceWidth);
	const scaleY = videoHeight / Math.max(1, sourceHeight);
	const cropW = even(Math.min(videoWidth, frame.cropW * scaleX));
	const cropH = even(Math.min(videoHeight, frame.cropH * scaleY));
	const cropX = even(clamp(frame.cropX * scaleX, 0, videoWidth - cropW));
	const cropY = even(clamp(frame.cropY * scaleY, 0, videoHeight - cropH));
	if (frame.zoom < 1.02) {
		return {
			...frame,
			cropX: 0,
			cropY: 0,
			cropW: even(videoWidth),
			cropH: even(videoHeight),
			cursorX: frame.cursorX * scaleX,
			cursorY: frame.cursorY * scaleY,
		};
	}
	return {
		...frame,
		cropX,
		cropY,
		cropW,
		cropH,
		cursorX: frame.cursorX * scaleX,
		cursorY: frame.cursorY * scaleY,
	};
}

export function offsetFramesIntoCrop(frames: ZoomFrame[], crop: CropRegion): ZoomFrame[] {
	return frames.map((frame) => {
		const cropW = even(Math.min(crop.width, frame.cropW));
		const cropH = even(Math.min(crop.height, frame.cropH));
		const cropX = even(clamp(crop.x + frame.cropX, crop.x, crop.x + crop.width - cropW));
		const cropY = even(clamp(crop.y + frame.cropY, crop.y, crop.y + crop.height - cropH));
		return {
			...frame,
			cropX,
			cropY,
			cropW,
			cropH,
			cursorX: crop.x + frame.cursorX,
			cursorY: crop.y + frame.cursorY,
		};
	});
}
