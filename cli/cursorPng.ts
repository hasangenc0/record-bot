import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CursorKind } from "./cursorKind.ts";

type Hotspot = { x: number; y: number };

type CursorManifest = {
	size: number;
	cursors: Record<CursorKind, { file: string; hotspot: Hotspot }>;
};

function assetsDir(): string {
	try {
		return path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"assets",
			"cursors",
		);
	} catch {
		return path.resolve("assets", "cursors");
	}
}

function loadManifest(): CursorManifest {
	const manifestPath = path.join(assetsDir(), "cursors.json");
	const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as CursorManifest;
	if (!parsed.size || !parsed.cursors) {
		throw new Error(`Invalid cursor manifest at ${manifestPath}`);
	}
	return parsed;
}

const MANIFEST = loadManifest();

/** Square master sprite size (px). Sprites are bilinear-scaled to any overlay size. */
export const CURSOR_PNG_SIZE = MANIFEST.size;

function entryFor(kind: CursorKind): { file: string; hotspot: Hotspot } {
	return MANIFEST.cursors[kind] ?? MANIFEST.cursors.arrow;
}

const pngCache = new Map<CursorKind, Buffer>();

export function buildCursorPng(kind: CursorKind = "arrow"): Buffer {
	const cached = pngCache.get(kind);
	if (cached) {
		return cached;
	}
	const entry = entryFor(kind);
	const file = path.join(assetsDir(), entry.file);
	if (!existsSync(file)) {
		throw new Error(
			`Cursor asset missing: ${file}. Run \`make cursors\` on macOS to regenerate the sprite set.`,
		);
	}
	const bytes = readFileSync(file);
	pngCache.set(kind, bytes);
	return bytes;
}

/** Hotspot for the sprite scaled to a given overlay size, in that size's pixel space. */
export function cursorHotspot(kind: CursorKind, size: number): Hotspot {
	const { hotspot } = entryFor(kind);
	const scale = size / MANIFEST.size;
	return {
		x: Math.round(hotspot.x * scale),
		y: Math.round(hotspot.y * scale),
	};
}
