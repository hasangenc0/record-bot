import { describe, expect, it } from "vitest";
import { muxArgs } from "./mux.ts";

describe("muxArgs", () => {
	it("copies video when the output already fits", () => {
		expect(
			muxArgs({
				videoPath: "/tmp/a.styled.mp4",
				audioPath: "/tmp/a.wav",
				outputPath: "/tmp/a.mp4",
				durationMs: 10_000,
				videoDurationMs: 12_000,
			}),
		).toEqual([
			"-y",
			"-i",
			"/tmp/a.styled.mp4",
			"-i",
			"/tmp/a.wav",
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-movflags",
			"+faststart",
			"-t",
			"10.000",
			"/tmp/a.mp4",
		]);
	});

	it("delays audio and pads a short video", () => {
		const args = muxArgs({
			videoPath: "/tmp/a.styled.mp4",
			audioPath: "/tmp/a.wav",
			outputPath: "/tmp/a.mp4",
			delayMs: 500,
			durationMs: 15_000,
			videoDurationMs: 12_000,
		});
		expect(args).toContain(
			"[0:v]tpad=stop_mode=clone:stop_duration=3.000[v];[1:a]adelay=500:all=1,asetpts=PTS-STARTPTS[a]",
		);
		expect(args).toContain("[v]");
		expect(args).toContain("[a]");
		expect(args).toContain("libx264");
		expect(args).toContain("animation");
		expect(args).toContain("15.000");
	});
});
