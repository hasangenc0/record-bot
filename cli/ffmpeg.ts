import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { packagedHelperPath } from "./paths.ts";

const requireHere = createRequire(import.meta.url);

function firstExisting(candidates: Array<string | null | undefined>): string | null {
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function fromPathEnv(): string | null {
	try {
		const command = process.platform === "win32" ? "where.exe" : "/usr/bin/which";
		const printed = execFileSync(command, ["ffmpeg"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		});
		return (
			printed
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean) ?? null
		);
	} catch {
		return null;
	}
}

function fromNpmPackage(): string | null {
	try {
		const loaded = requireHere("ffmpeg-static");
		if (typeof loaded === "string") {
			return loaded;
		}
	} catch {
		return null;
	}
	return null;
}

export function ffmpegPath(): string {
	const found = firstExisting([
		process.env.RECORD_BOT_FFMPEG?.trim(),
		packagedHelperPath(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
		fromNpmPackage(),
		fromPathEnv(),
	]);
	if (found) {
		return path.resolve(found);
	}
	throw new Error("ffmpeg not found (helpers/, ffmpeg-static, or PATH)");
}
