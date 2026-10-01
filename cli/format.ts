import type { CaptureSource } from "./types.ts";

function pad(value: string, width: number) {
	if (value.length >= width) {
		return value;
	}
	return `${value}${" ".repeat(width - value.length)}`;
}

export function formatCaptureSources(sources: CaptureSource[]): string {
	const screens = sources.filter((source) => source.sourceType === "screen");
	const windows = sources.filter((source) => source.sourceType === "window");
	const lines: string[] = [];

	if (screens.length > 0) {
		lines.push("Screens");
		lines.push(`${pad("#", 4)}  ${pad("DISPLAY ID", 12)}  NAME`);
		screens.forEach((source, index) => {
			lines.push(
				`${pad(String(index + 1), 4)}  ${pad(source.displayId || source.id, 12)}  ${source.name}`,
			);
		});
	}

	if (windows.length > 0) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push("Windows");
		const idWidth = Math.max(10, ...windows.map((source) => source.id.length));
		lines.push(`${pad("ID", idWidth)}  NAME`);
		for (const source of windows) {
			lines.push(`${pad(source.id, idWidth)}  ${source.name}`);
		}
	}

	if (lines.length === 0) {
		return "No capture sources found.";
	}

	return lines.join("\n");
}

export function toPublicCaptureSource(source: CaptureSource) {
	return {
		id: source.id,
		name: source.name,
		displayId: source.displayId ?? null,
		sourceType: source.sourceType,
		appName: source.appName ?? null,
		windowTitle: source.windowTitle ?? null,
		bundleId: source.bundleId ?? null,
	};
}
