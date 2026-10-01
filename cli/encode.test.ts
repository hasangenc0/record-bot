import { describe, expect, it } from "vitest";
import { CAPTURE_VIDEO_ARGS, STYLE_VIDEO_ARGS } from "./encode.ts";

describe("encode settings", () => {
	it("captures with a low CRF so the styled pass has a clean source", () => {
		expect(CAPTURE_VIDEO_ARGS).toContain("superfast");
		expect(CAPTURE_VIDEO_ARGS).toContain("12");
	});

	it("styles screen content with animation tune and a slower preset", () => {
		expect(STYLE_VIDEO_ARGS).toContain("medium");
		expect(STYLE_VIDEO_ARGS).toContain("animation");
		expect(STYLE_VIDEO_ARGS).toContain("15");
	});
});
