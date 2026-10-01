import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.ts";
import {
	f5TtsPythonPath,
	huggingfaceTlsEnv,
	voiceoverHelperArgs,
	voiceoverHelperPath,
} from "./voiceover.ts";

describe("parseCliArgs voiceover", () => {
	it("parses text, voice sample, and generation flags", () => {
		expect(
			parseCliArgs([
				"voiceover",
				"--text",
				"Hello from record-bot.",
				"--ref-audio",
				"voice.wav",
				"--ref-text",
				"This is my voice.",
				"-o",
				"out.wav",
				"--speed",
				"1.1",
				"--seed",
				"7",
				"--nfe-step",
				"16",
				"--remove-silence",
				"--json",
			]),
		).toEqual({
			command: "voiceover",
			json: true,
			text: "Hello from record-bot.",
			textFile: undefined,
			refAudio: "voice.wav",
			refText: "This is my voice.",
			output: "out.wav",
			model: "F5TTS_v1_Base",
			speed: 1.1,
			seed: 7,
			nfeStep: 16,
			removeSilence: true,
		});
	});

	it("requires text and rejects bad flags", () => {
		expect(parseCliArgs(["voiceover", "-o", "out.wav"])).toEqual({
			command: "error",
			message: "voiceover requires --text or --text-file.",
			json: false,
		});
		expect(parseCliArgs(["voiceover", "--speed", "0"])).toEqual({
			command: "error",
			message: "--speed must be a number from 0.5 to 2",
			json: false,
		});
		expect(parseCliArgs(["voiceover", "--nope"])).toEqual({
			command: "error",
			message: 'Unknown option "--nope" for voiceover. Run record-bot --help.',
			json: false,
		});
	});
});

describe("voiceover helper", () => {
	it("builds F5-TTS helper argv", () => {
		expect(
			voiceoverHelperArgs(
				{
					command: "voiceover",
					json: true,
					text: "Hi",
					output: "out.wav",
					model: "F5TTS_v1_Base",
					speed: 1,
					removeSilence: false,
				},
				"/tmp/out.wav",
			),
		).toEqual([
			"-o",
			"/tmp/out.wav",
			"--model",
			"F5TTS_v1_Base",
			"--speed",
			"1",
			"--text",
			"Hi",
		]);
	});

	it("resolves RECORD_BOT_F5TTS_PYTHON before the repo venv", () => {
		const python = f5TtsPythonPath({ RECORD_BOT_F5TTS_PYTHON: process.execPath }, [
			"/missing-root",
		]);
		expect(python).toBe(path.resolve(process.execPath));
		expect(f5TtsPythonPath({}, ["/missing-root"])).toBeNull();
		expect(voiceoverHelperPath("/repo")).toBe(path.join("/repo", "python", "voiceover.py"));
		expect(
			huggingfaceTlsEnv({
				NODE_EXTRA_CA_CERTS: process.execPath,
			}),
		).toEqual({
			SSL_CERT_FILE: process.execPath,
			REQUESTS_CA_BUNDLE: process.execPath,
			CURL_CA_BUNDLE: process.execPath,
		});
	});
});
