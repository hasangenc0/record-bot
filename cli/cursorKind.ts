import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CURSOR_KINDS = ["arrow", "pointer", "text"] as const;

export type CursorKind = (typeof CURSOR_KINDS)[number];

export type CursorHint = {
	cursor: CursorKind;
	buttons: number;
};

export function normalizeCursorKind(value: unknown): CursorKind {
	const raw = String(value ?? "")
		.trim()
		.toLowerCase();
	if (
		raw === "pointer" ||
		raw === "hand" ||
		raw === "pointinghand" ||
		raw === "pointing-hand"
	) {
		return "pointer";
	}
	if (
		raw === "text" ||
		raw === "ibeam" ||
		raw === "i-beam" ||
		raw === "i_beam" ||
		raw === "input"
	) {
		return "text";
	}
	return "arrow";
}

export function cursorKindForSelector(selector: string): CursorKind {
	if (/search|task-title|input|textarea|contenteditable/i.test(selector)) {
		return "text";
	}
	if (/button|task|move|submit|card|new-task/i.test(selector)) {
		return "pointer";
	}
	return "arrow";
}

export function cursorHintPath(): string {
	const override = process.env.RECORD_BOT_CURSOR_HINT?.trim();
	if (override) {
		return path.resolve(override);
	}
	return path.join(os.tmpdir(), "record-bot-cursor-hint");
}

export function parseCursorHint(text: string): CursorHint {
	const trimmed = text.trim();
	if (!trimmed) {
		return { cursor: "arrow", buttons: 0 };
	}
	try {
		const parsed = JSON.parse(trimmed) as Partial<CursorHint>;
		return {
			cursor: normalizeCursorKind(parsed.cursor),
			buttons: Number(parsed.buttons) > 0 ? 1 : 0,
		};
	} catch {
		const [kind, buttons] = trimmed.split(/\s+/);
		return {
			cursor: normalizeCursorKind(kind),
			buttons: buttons === "1" ? 1 : 0,
		};
	}
}

export async function writeCursorHint(hint: CursorHint): Promise<void> {
	await fs.writeFile(cursorHintPath(), `${JSON.stringify(hint)}\n`);
}
