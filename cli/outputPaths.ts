import fs from "node:fs/promises";
import path from "node:path";

const RECORDING_SIDECAR_SUFFIXES = [
	".system.m4a",
	".mic.m4a",
	".system.wav",
	".mic.wav",
	".cursor.jsonl",
] as const;

export function sidecarPathsForVideo(videoPath: string): string[] {
	const parsed = path.parse(videoPath);
	const stem = path.join(parsed.dir, parsed.name);
	return RECORDING_SIDECAR_SUFFIXES.map((suffix) => `${stem}${suffix}`);
}

export async function moveFileWithOverwrite(sourcePath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	await fs.rm(destinationPath, { force: true });
	try {
		await fs.rename(sourcePath, destinationPath);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "EXDEV") {
			throw error;
		}
		await fs.copyFile(sourcePath, destinationPath);
		await fs.unlink(sourcePath);
	}
}

async function pathExists(filePath: string) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function existingSidecarPaths(videoPath: string): Promise<string[]> {
	const found: string[] = [];
	for (const sidecar of sidecarPathsForVideo(videoPath)) {
		if (await pathExists(sidecar)) {
			found.push(sidecar);
		}
	}
	return found;
}

export async function moveRecordingToOutput(sourcePath: string, outputPath: string) {
	const resolvedOutput = path.resolve(outputPath);
	if (path.resolve(sourcePath) === resolvedOutput) {
		return resolvedOutput;
	}
	await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
	const sourceSidecars = sidecarPathsForVideo(sourcePath);
	const destinationSidecars = sidecarPathsForVideo(resolvedOutput);
	await moveFileWithOverwrite(sourcePath, resolvedOutput);
	for (const [index, sourceSidecar] of sourceSidecars.entries()) {
		const destinationSidecar = destinationSidecars[index];
		if (destinationSidecar && (await pathExists(sourceSidecar))) {
			await moveFileWithOverwrite(sourceSidecar, destinationSidecar);
		}
	}
	return resolvedOutput;
}
