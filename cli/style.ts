export type ZoomMode = { type: "off" } | { type: "auto"; maxZoom: number };

export type Background = { type: "color"; color: string } | { type: "image"; path: string };

export type CropRegion = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type StyleOptions = {
	enabled: boolean;
	padding: number;
	background: Background;
	zoom: ZoomMode;
	cursor: boolean;
	canvasWidth: number;
	canvasHeight: number;
	crop: CropRegion | null;
};

export const DEFAULT_BACKGROUND_COLOR = "1a1a24";
export const DEFAULT_PADDING = 80;
export const DEFAULT_MAX_ZOOM = 1.7;
export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;

export function defaultStyleOptions(): StyleOptions {
	return {
		enabled: true,
		padding: DEFAULT_PADDING,
		background: { type: "color", color: DEFAULT_BACKGROUND_COLOR },
		zoom: { type: "auto", maxZoom: DEFAULT_MAX_ZOOM },
		cursor: true,
		canvasWidth: DEFAULT_CANVAS_WIDTH,
		canvasHeight: DEFAULT_CANVAS_HEIGHT,
		crop: null,
	};
}

export function parseCropValue(raw: string): CropRegion | null {
	const trimmed = raw.trim();
	const csv = trimmed.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
	if (csv) {
		return cropFromNumbers(csv[1], csv[2], csv[3], csv[4]);
	}
	const geometry = trimmed.match(/^(\d+)\s*[xX]\s*(\d+)\s*\+(\d+)\s*\+(\d+)$/);
	if (geometry) {
		return cropFromNumbers(geometry[3], geometry[4], geometry[1], geometry[2]);
	}
	return null;
}

function cropFromNumbers(
	xRaw: string,
	yRaw: string,
	widthRaw: string,
	heightRaw: string,
): CropRegion | null {
	const x = Number(xRaw);
	const y = Number(yRaw);
	const width = Number(widthRaw);
	const height = Number(heightRaw);
	if (
		!Number.isInteger(x) ||
		!Number.isInteger(y) ||
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		x < 0 ||
		y < 0 ||
		width < 16 ||
		height < 16
	) {
		return null;
	}
	return { x, y, width, height };
}

export function clampCropToVideo(
	crop: CropRegion,
	videoWidth: number,
	videoHeight: number,
): CropRegion {
	const maxX = Math.max(0, evenOrigin(videoWidth) - 16);
	const maxY = Math.max(0, evenOrigin(videoHeight) - 16);
	const x = Math.min(evenOrigin(crop.x), maxX);
	const y = Math.min(evenOrigin(crop.y), maxY);
	const width = even(Math.min(crop.width, videoWidth - x));
	const height = even(Math.min(crop.height, videoHeight - y));
	return { x, y, width, height };
}

export function resolveComposeCrop(
	crop: CropRegion | null,
	videoWidth: number,
	videoHeight: number,
): CropRegion {
	if (!crop) {
		return {
			x: 0,
			y: 0,
			width: even(videoWidth),
			height: even(videoHeight),
		};
	}
	return clampCropToVideo(crop, videoWidth, videoHeight);
}

export function parseCanvasSize(raw: string): { width: number; height: number } | null {
	const match = raw.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
	if (!match) {
		return null;
	}
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
		return null;
	}
	return { width, height };
}

export function parseZoomMode(raw: string): ZoomMode | null {
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === "off" || trimmed === "none" || trimmed === "0") {
		return { type: "off" };
	}
	if (trimmed === "auto" || trimmed === "on") {
		return { type: "auto", maxZoom: DEFAULT_MAX_ZOOM };
	}
	const value = Number(trimmed);
	if (!Number.isFinite(value) || value < 1 || value > 4) {
		return null;
	}
	if (value === 1) {
		return { type: "off" };
	}
	return { type: "auto", maxZoom: value };
}

export function parseBackgroundValue(raw: string): Background | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { error: "--background requires a color or image path" };
	}
	if (looksLikeColor(trimmed)) {
		return { type: "color", color: normalizeHexColor(trimmed) };
	}
	return { type: "image", path: trimmed };
}

export function looksLikeColor(raw: string): boolean {
	const value = raw.trim().toLowerCase();
	if (value === "black" || value === "white") {
		return true;
	}
	return /^(#|0x)?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

export function normalizeHexColor(raw: string): string {
	const value = raw.trim().toLowerCase();
	if (value === "black") {
		return "000000";
	}
	if (value === "white") {
		return "ffffff";
	}
	const hex = value.replace(/^#/, "").replace(/^0x/, "");
	if (hex.length === 3) {
		return hex
			.split("")
			.map((part) => `${part}${part}`)
			.join("");
	}
	if (hex.length === 8) {
		return hex.slice(0, 6);
	}
	return hex;
}

export function ffmpegColor(color: string): string {
	return `0x${normalizeHexColor(color)}`;
}

export function even(value: number): number {
	if (!Number.isFinite(value)) {
		return 2;
	}
	return Math.max(2, Math.round(value) & ~1);
}

export function evenOrigin(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.round(value) & ~1;
}

export function rawOutputPathFor(styledPath: string, explicit?: string): string {
	if (explicit) {
		return explicit;
	}
	const lastDot = styledPath.lastIndexOf(".");
	if (lastDot <= 0) {
		return `${styledPath}.raw`;
	}
	return `${styledPath.slice(0, lastDot)}.raw${styledPath.slice(lastDot)}`;
}

function zoomLabel(zoom: StyleOptions["zoom"]): string {
	switch (zoom.type) {
		case "off":
			return "off";
		case "auto":
			return `auto:${zoom.maxZoom}`;
		default: {
			const exhaustive: never = zoom;
			return exhaustive;
		}
	}
}

function backgroundLabel(background: StyleOptions["background"]): string {
	switch (background.type) {
		case "color":
			return `#${background.color}`;
		case "image":
			return background.path;
		default: {
			const exhaustive: never = background;
			return exhaustive;
		}
	}
}

function cropLabel(crop: CropRegion | null): string | null {
	if (!crop) {
		return null;
	}
	return `${crop.x},${crop.y},${crop.width},${crop.height}`;
}

export function styleSummary(style: StyleOptions) {
	return {
		padding: style.padding,
		background: backgroundLabel(style.background),
		zoom: zoomLabel(style.zoom),
		cursor: style.cursor,
		size: `${style.canvasWidth}x${style.canvasHeight}`,
		crop: cropLabel(style.crop),
	};
}
