import path from "node:path";
import { describe, expect, it } from "vitest";
import { sidecarPathsForVideo } from "./outputPaths.ts";

describe("sidecarPathsForVideo", () => {
	it("keeps companion audio next to the video stem", () => {
		const videoPath = path.join("/tmp", "demo.mp4");
		expect(sidecarPathsForVideo(videoPath)).toEqual([
			path.join("/tmp", "demo.system.m4a"),
			path.join("/tmp", "demo.mic.m4a"),
			path.join("/tmp", "demo.system.wav"),
			path.join("/tmp", "demo.mic.wav"),
			path.join("/tmp", "demo.cursor.jsonl"),
		]);
	});
});
