import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nativeHelperPath } from "./paths.ts";
import type { CaptureSource } from "./types.ts";

const execFileAsync = promisify(execFile);

const FALLBACK_SCREEN = { width: 1920, height: 1080 };

export function parseDisplaySize(
	value: string | undefined,
): { width: number; height: number } | null {
	const match = String(value ?? "")
		.trim()
		.match(/^(\d+)\s*x\s*(\d+)$/i);
	if (!match) {
		return null;
	}
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
		return null;
	}
	return { width: Math.round(width), height: Math.round(height) };
}

export function parseXdpyinfoDimensions(
	stdout: string,
): { width: number; height: number } | null {
	const match = stdout.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/i);
	if (!match) {
		return null;
	}
	return parseDisplaySize(`${match[1]}x${match[2]}`);
}

async function linuxScreenSize(): Promise<{ width: number; height: number }> {
	const fromEnv = parseDisplaySize(process.env.RECORD_BOT_DISPLAY_SIZE);
	try {
		const { stdout } = await execFileAsync("xdpyinfo", [], { timeout: 2000 });
		return parseXdpyinfoDimensions(stdout) ?? fromEnv ?? FALLBACK_SCREEN;
	} catch {
		return fromEnv ?? FALLBACK_SCREEN;
	}
}

type NativeWindowEntry = {
	id: string;
	name: string;
	displayId?: string;
	app?: string;
	title?: string;
	bundle?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

type NativeScreenEntry = {
	id: string;
	name: string;
	displayId?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

function asWindows(entries: NativeWindowEntry[]): CaptureSource[] {
	return entries.map((entry) => ({
		id: entry.id,
		name: entry.name,
		displayId: entry.displayId,
		sourceType: "window" as const,
		appName: entry.app,
		windowTitle: entry.title,
		bundleId: entry.bundle,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		height: entry.height,
	}));
}

function asScreens(entries: NativeScreenEntry[]): CaptureSource[] {
	return entries.map((entry) => ({
		id: entry.id,
		name: entry.name,
		displayId: entry.displayId ?? entry.id.replace(/^screen:/, ""),
		sourceType: "screen" as const,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		height: entry.height,
	}));
}

async function listMacSources(): Promise<CaptureSource[]> {
	const binaryPath = nativeHelperPath("sources");
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 30000,
		maxBuffer: 10 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as
		| NativeWindowEntry[]
		| { screens?: NativeScreenEntry[]; windows?: NativeWindowEntry[] };

	if (Array.isArray(parsed)) {
		return asWindows(parsed);
	}

	return [...asScreens(parsed.screens ?? []), ...asWindows(parsed.windows ?? [])];
}

async function listLinuxSources(): Promise<CaptureSource[]> {
	const size = await linuxScreenSize();
	const screens: CaptureSource[] = [
		{
			id: "screen:0",
			name: "Screen 1 (Primary)",
			displayId: "0",
			sourceType: "screen",
			x: 0,
			y: 0,
			width: size.width,
			height: size.height,
		},
	];
	try {
		const { stdout } = await execFileAsync("wmctrl", ["-lG"], { timeout: 2000 });
		const windows = stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.flatMap((line) => {
				const match = line.match(
					/^(0x[0-9a-f]+)\s+\S+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s+(.*)$/i,
				);
				if (!match) {
					return [];
				}
				const id = Number.parseInt(match[1], 16);
				return [
					{
						id: `window:${id}`,
						name: match[6],
						sourceType: "window" as const,
						windowTitle: match[6],
						x: Number(match[2]),
						y: Number(match[3]),
						width: Number(match[4]),
						height: Number(match[5]),
					},
				];
			});
		return [...screens, ...windows];
	} catch {
		return screens;
	}
}

function listWindowsSources(): CaptureSource[] {
	return [
		{
			id: "screen:0",
			name: "Screen 1 (Primary)",
			displayId: "0",
			sourceType: "screen",
		},
	];
}

export async function listCaptureSources(options?: {
	screens?: boolean;
	windows?: boolean;
}): Promise<CaptureSource[]> {
	const includeScreens = options?.screens ?? true;
	const includeWindows = options?.windows ?? true;
	const sources =
		process.platform === "darwin"
			? await listMacSources()
			: process.platform === "linux"
				? await listLinuxSources()
				: listWindowsSources();
	return sources.filter((source) => {
		if (source.sourceType === "screen") {
			return includeScreens;
		}
		return includeWindows;
	});
}
