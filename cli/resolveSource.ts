import type { RecordCliCommand } from "./args.ts";
import type { CaptureSource } from "./types.ts";

export type ResolveCaptureSourceError = {
	error: string;
};

export function normalizeWindowId(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("window:")) {
		return trimmed;
	}
	return `window:${trimmed}`;
}

function normalizeMatch(value: string | undefined): string {
	return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveCaptureSource(
	sources: CaptureSource[],
	options: Pick<RecordCliCommand, "screen" | "displayId" | "window" | "windowId">,
): CaptureSource | ResolveCaptureSourceError {
	const screens = sources.filter((source) => source.sourceType === "screen");
	const windows = sources.filter((source) => source.sourceType === "window");

	if (options.windowId) {
		const windowId = normalizeWindowId(options.windowId);
		const match = windows.find(
			(source) =>
				source.id === windowId ||
				source.id.startsWith(`${windowId}:`) ||
				source.id === options.windowId,
		);
		if (!match) {
			return { error: `No window found with id ${options.windowId}` };
		}
		return match;
	}

	if (options.window) {
		const needle = normalizeMatch(options.window);
		const matches = windows.filter((source) => {
			const haystacks = [source.name, source.appName, source.windowTitle];
			return haystacks.some((value) => normalizeMatch(value).includes(needle));
		});
		if (matches.length === 0) {
			return { error: `No window matching "${options.window}"` };
		}
		const exact = matches.filter((source) => {
			const haystacks = [source.name, source.appName, source.windowTitle];
			return haystacks.some((value) => normalizeMatch(value) === needle);
		});
		if (exact.length === 1) {
			return exact[0];
		}
		if (matches.length === 1) {
			return matches[0];
		}
		const listed = matches
			.slice(0, 8)
			.map((source) => `  ${source.id}  ${source.name}`)
			.join("\n");
		return {
			error: `Multiple windows match "${options.window}". Pass --window-id with one of:\n${listed}`,
		};
	}

	if (options.displayId) {
		const displayId = String(options.displayId);
		const match = screens.find(
			(source) => source.displayId === displayId || source.id === displayId,
		);
		if (!match) {
			return { error: `No screen found with display id ${options.displayId}` };
		}
		return match;
	}

	if (options.screen !== undefined) {
		const match = screens[options.screen - 1];
		if (!match) {
			return {
				error: `Screen ${options.screen} not found. ${screens.length} screen(s) available.`,
			};
		}
		return match;
	}

	const primary =
		screens.find((source) => /primary/i.test(source.name)) ?? screens[0] ?? sources[0];
	if (!primary) {
		return { error: "No capture sources available." };
	}
	return primary;
}
