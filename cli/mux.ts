import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STYLE_VIDEO_ARGS } from "./encode.ts";
import { ffmpegPath } from "./ffmpeg.ts";
import { probeDuration, probeVideo } from "./videoInfo.ts";

export type MuxInput = {
	videoPath: string;
	audioPath: string;
	outputPath: string;
	delayMs?: number;
	durationMs: number;
	videoDurationMs: number;
};

export type MuxResult = {
	path: string;
	videoPath: string;
	audioPath: string;
	delayMs: number;
	durationMs: number;
};

function formatSeconds(ms: number): string {
	return (Math.max(0, ms) / 1000).toFixed(3);
}

export function muxArgs(input: MuxInput): string[] {
	const delayMs = Math.max(0, Math.round(input.delayMs ?? 0));
	const durationMs = Math.max(1, Math.round(input.durationMs));
	const padMs = Math.max(0, durationMs - Math.round(input.videoDurationMs));
	const filters: string[] = [];
	if (padMs > 0) {
		filters.push(`[0:v]tpad=stop_mode=clone:stop_duration=${formatSeconds(padMs)}[v]`);
	}
	if (delayMs > 0) {
		filters.push(`[1:a]adelay=${delayMs}:all=1,asetpts=PTS-STARTPTS[a]`);
	}

	const args = ["-y", "-i", input.videoPath, "-i", input.audioPath];
	if (filters.length > 0) {
		args.push("-filter_complex", filters.join(";"));
	}
	args.push("-map", padMs > 0 ? "[v]" : "0:v:0", "-map", delayMs > 0 ? "[a]" : "1:a:0");
	if (padMs > 0) {
		args.push(...STYLE_VIDEO_ARGS);
	} else {
		args.push("-c:v", "copy");
	}
	args.push(
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		"-t",
		formatSeconds(durationMs),
		input.outputPath,
	);
	return args;
}

async function runFfmpeg(args: string[]): Promise<void> {
	const ffmpegBin = ffmpegPath();
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
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

export async function muxVoiceover(input: {
	videoPath: string;
	audioPath: string;
	outputPath: string;
	delayMs?: number;
	durationMs?: number;
}): Promise<MuxResult> {
	const videoPath = path.resolve(input.videoPath);
	const audioPath = path.resolve(input.audioPath);
	const outputPath = path.resolve(input.outputPath);
	if (!fs.existsSync(videoPath)) {
		throw new Error(`Video not found: ${input.videoPath}`);
	}
	if (!fs.existsSync(audioPath)) {
		throw new Error(`Audio not found: ${input.audioPath}`);
	}
	if (outputPath === videoPath || outputPath === audioPath) {
		throw new Error("-o must be different from --video and --audio");
	}

	const delayMs = Math.max(0, Math.round(input.delayMs ?? 0));
	const video = await probeVideo(videoPath);
	const audioSeconds = await probeDuration(audioPath);
	const durationMs =
		input.durationMs && input.durationMs > 0
			? Math.round(input.durationMs)
			: delayMs + Math.round(audioSeconds * 1000);
	if (durationMs <= delayMs) {
		throw new Error("mux duration must be longer than --delay");
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	await runFfmpeg(
		muxArgs({
			videoPath,
			audioPath,
			outputPath,
			delayMs,
			durationMs,
			videoDurationMs: Math.round(video.duration * 1000),
		}),
	);
	return { path: outputPath, videoPath, audioPath, delayMs, durationMs };
}
