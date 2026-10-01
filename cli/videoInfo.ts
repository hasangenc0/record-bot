import { spawn } from "node:child_process";
import { ffmpegPath } from "./ffmpeg.ts";

export type VideoInfo = {
	width: number;
	height: number;
	duration: number;
	fps: number;
	hasAudio: boolean;
};

export function parseFfmpegDuration(raw: string): number | null {
	const match = raw.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
	if (!match) {
		return null;
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}
	return hours * 3600 + minutes * 60 + seconds;
}

function parseVideoStream(raw: string): { width: number; height: number; fps: number } | null {
	const size = raw.match(/Stream #\d+:\d+.+:\s*Video:[\s\S]*?(\d{2,5})x(\d{2,5})/);
	if (!size) {
		return null;
	}
	const width = Number(size[1]);
	const height = Number(size[2]);
	const rate = raw.match(/(\d+(?:\.\d+)?)\s*(?:fps|tbr)/);
	const fps = rate ? Number(rate[1]) : 60;
	if (![width, height, fps].every((value) => Number.isFinite(value) && value > 0)) {
		return null;
	}
	return { width, height, fps };
}

export function parseFfmpegProbeOutput(output: string): VideoInfo | null {
	const duration = parseFfmpegDuration(output);
	const video = parseVideoStream(output);
	if (duration === null || !video) {
		return null;
	}
	return {
		...video,
		duration,
		hasAudio: /Stream #\d+:\d+.+:\s*Audio:/.test(output),
	};
}

async function ffmpegIdentify(filePath: string): Promise<string> {
	const ffmpegBin = ffmpegPath();
	return new Promise((resolve, reject) => {
		const child = spawn(ffmpegBin, ["-hide_banner", "-i", filePath], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let buffer = "";
		const append = (chunk: Buffer) => {
			buffer += chunk.toString();
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.once("error", reject);
		child.once("close", () => resolve(buffer));
	});
}

export async function probeVideo(filePath: string): Promise<VideoInfo> {
	const parsed = parseFfmpegProbeOutput(await ffmpegIdentify(filePath));
	if (!parsed) {
		throw new Error(`Unable to probe video: ${filePath}`);
	}
	return parsed;
}

export async function probeDuration(filePath: string): Promise<number> {
	const duration = parseFfmpegDuration(await ffmpegIdentify(filePath));
	if (duration === null) {
		throw new Error(`Unable to probe duration: ${filePath}`);
	}
	return duration;
}
