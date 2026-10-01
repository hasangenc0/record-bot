import { describe, expect, it } from "vitest";
import { parseDisplaySize, parseXdpyinfoDimensions } from "./sources.ts";

describe("parseDisplaySize", () => {
	it("reads WIDTHxHEIGHT", () => {
		expect(parseDisplaySize("3840x2160")).toEqual({ width: 3840, height: 2160 });
		expect(parseDisplaySize(" 1920 x 1080 ")).toEqual({ width: 1920, height: 1080 });
		expect(parseDisplaySize("0x0")).toBeNull();
		expect(parseDisplaySize(undefined)).toBeNull();
	});
});

describe("parseXdpyinfoDimensions", () => {
	it("reads the Xvfb screen size", () => {
		expect(
			parseXdpyinfoDimensions(`
screen #0:
  dimensions:    3840x2160 pixels (1016x572 millimeters)
  resolution:    96x96 dots per inch
`),
		).toEqual({ width: 3840, height: 2160 });
	});
});
