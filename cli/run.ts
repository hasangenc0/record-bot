import fs from "node:fs";
import path from "node:path";
import {
	CLI_USAGE,
	type CliCommand,
	type MuxCliCommand,
	type RecordCliCommand,
} from "./args.ts";
import { composeStyledVideo } from "./compose.ts";
import { startCursorLog, stopCursorLog } from "./cursorLog.ts";
import { formatCaptureSources, toPublicCaptureSource } from "./format.ts";
import { muxVoiceover } from "./mux.ts";
import { existingSidecarPaths, moveRecordingToOutput } from "./outputPaths.ts";
import { readCliVersion } from "./paths.ts";
import { stagingVideoPath, startRecording, stopRecording } from "./record.ts";
import { resolveCaptureSource } from "./resolveSource.ts";
import { cliSchema } from "./schema.ts";
import { loadSkillPlaybook } from "./skill.ts";
import { listCaptureSources } from "./sources.ts";
import { rawOutputPathFor, styleSummary } from "./style.ts";
import { installF5Tts } from "./ttsSetup.ts";
import type { CaptureSource } from "./types.ts";
import { generateVoiceover, huggingfaceTlsEnv, resolveVoiceoverHelper } from "./voiceover.ts";

function writeLine(stream: NodeJS.WritableStream, value: string) {
	stream.write(`${value}\n`);
}

function fail(message: string, json: boolean, extra?: Record<string, unknown>) {
	if (json) {
		writeLine(process.stdout, JSON.stringify({ ok: false, error: message, ...extra }));
	} else {
		writeLine(process.stderr, `record-bot: ${message}`);
	}
	return 1;
}

function ok(message: string, json: boolean, payload: Record<string, unknown>) {
	if (json) {
		writeLine(process.stdout, JSON.stringify({ ok: true, ...payload }));
	} else {
		writeLine(process.stdout, message);
	}
	return 0;
}

function defaultOutputPath() {
	return path.resolve(process.cwd(), `recording-${Date.now()}.mp4`);
}

function defaultMuxOutputPath() {
	return path.resolve(process.cwd(), `mux-${Date.now()}.mp4`);
}

function cursorLogPathFor(videoPath: string) {
	const parsed = path.parse(videoPath);
	return path.join(parsed.dir, `${parsed.name}.cursor.jsonl`);
}

function formatRecordStatus(
	source: CaptureSource,
	outputPath: string,
	rawPath: string,
	command: RecordCliCommand,
) {
	const parts = [`Recording ${source.sourceType} "${source.name}"`];
	if (command.style.enabled) {
		parts.push(`Styled output: ${outputPath}`);
		parts.push(`Raw output: ${rawPath}`);
	} else {
		parts.push(`Output: ${outputPath}`);
	}
	if (command.durationSeconds) {
		parts.push(`Duration: ${command.durationSeconds}s`);
	} else {
		parts.push("Press Ctrl+C to stop");
	}
	if (command.mic) {
		parts.push("Microphone: on");
	}
	if (command.systemAudio) {
		parts.push("System audio: on");
	}
	if (command.style.enabled) {
		const summary = styleSummary(command.style);
		const crop = summary.crop ? `, crop ${summary.crop}` : "";
		parts.push(
			`Style: padding ${summary.padding}px, background ${summary.background}, zoom ${summary.zoom}, cursor ${summary.cursor ? "on" : "off"}, ${summary.size}${crop}`,
		);
	}
	return parts.join("\n");
}

function resolveStyleBackground(command: RecordCliCommand): string | null {
	if (!command.style.enabled || command.style.background.type !== "image") {
		return null;
	}
	const resolved = path.resolve(command.style.background.path);
	if (!fs.existsSync(resolved)) {
		return `Background image not found: ${command.style.background.path}`;
	}
	command.style.background = { type: "image", path: resolved };
	return null;
}

async function runRecord(command: RecordCliCommand): Promise<number> {
	const wantsWindow = Boolean(command.window || command.windowId);
	const sources = await listCaptureSources({ screens: true, windows: wantsWindow });
	const resolved = resolveCaptureSource(sources, command);
	if ("error" in resolved) {
		return fail(resolved.error, command.json);
	}

	const backgroundError = resolveStyleBackground(command);
	if (backgroundError) {
		return fail(backgroundError, command.json);
	}

	const outputPath = command.output ? path.resolve(command.output) : defaultOutputPath();
	const rawPath = command.style.enabled
		? path.resolve(command.rawOutput ? command.rawOutput : rawOutputPathFor(outputPath))
		: outputPath;
	if (command.style.enabled && path.resolve(outputPath) === path.resolve(rawPath)) {
		return fail("--raw-output must be different from -o", command.json);
	}

	const stagingPath = await stagingVideoPath();
	const startedAt = Date.now();
	const started = await startRecording(resolved, stagingPath, {
		mic: command.mic,
		systemAudio: command.systemAudio,
		micDevice: command.micDevice,
	});
	if (!started.success) {
		return fail(started.message ?? started.error ?? "Failed to start recording", command.json, {
			details: started.error,
		});
	}

	const cursorSession = command.style.enabled
		? await startCursorLog(resolved, cursorLogPathFor(stagingPath))
		: null;
	if (command.style.enabled && !cursorSession && !command.json) {
		writeLine(
			process.stderr,
			"Cursor tracker unavailable; styled output will keep padding and background without auto-zoom.",
		);
	}

	if (!command.json) {
		writeLine(process.stderr, formatRecordStatus(resolved, outputPath, rawPath, command));
	}

	let stopPromise: ReturnType<typeof stopRecording> | null = null;
	let notifyStopped: (() => void) | null = null;
	const stoppedSignal = new Promise<void>((resolve) => {
		notifyStopped = resolve;
	});

	const stopOnce = () => {
		if (!stopPromise) {
			if (!command.json) {
				writeLine(process.stderr, "Stopping recording...");
			}
			stopPromise = stopRecording().finally(() => {
				notifyStopped?.();
			});
		}
		return stopPromise;
	};

	const onSignal = () => {
		void stopOnce();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	let durationTimer: NodeJS.Timeout | null = null;
	if (command.durationSeconds) {
		durationTimer = setTimeout(
			() => {
				void stopOnce();
			},
			Math.round(command.durationSeconds * 1000),
		);
	}

	try {
		await stoppedSignal;
		const stopped = await stopOnce();
		await stopCursorLog(cursorSession);
		if (!stopped.success || !stopped.path) {
			return fail(
				stopped.message ?? stopped.error ?? "Failed to stop recording",
				command.json,
				{
					details: stopped.error,
				},
			);
		}

		const savedRawPath = await moveRecordingToOutput(stopped.path, rawPath);
		const sidecars = await existingSidecarPaths(savedRawPath);
		if (!command.style.enabled) {
			return ok(`Saved ${savedRawPath}`, command.json, {
				path: savedRawPath,
				sidecars,
				durationMs: Date.now() - startedAt,
				source: toPublicCaptureSource(resolved),
			});
		}

		if (!command.json) {
			writeLine(process.stderr, "Composing styled video...");
		}
		try {
			await composeStyledVideo({
				rawPath: savedRawPath,
				outputPath,
				cursorLogPath: cursorLogPathFor(savedRawPath),
				source: resolved,
				style: command.style,
			});
		} catch (error) {
			return fail(error instanceof Error ? error.message : String(error), command.json, {
				rawPath: savedRawPath,
				sidecars,
			});
		}

		return ok(`Saved ${outputPath}`, command.json, {
			path: outputPath,
			rawPath: savedRawPath,
			sidecars,
			durationMs: Date.now() - startedAt,
			source: toPublicCaptureSource(resolved),
			style: styleSummary(command.style),
		});
	} finally {
		if (durationTimer) {
			clearTimeout(durationTimer);
		}
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
}

async function runMux(command: MuxCliCommand): Promise<number> {
	const outputPath = command.output ? path.resolve(command.output) : defaultMuxOutputPath();
	try {
		if (!command.json) {
			writeLine(process.stderr, "Muxing audio onto video...");
		}
		const result = await muxVoiceover({
			videoPath: command.video,
			audioPath: command.audio,
			outputPath,
			delayMs: Math.round(command.delaySeconds * 1000),
			durationMs: command.durationSeconds
				? Math.round(command.durationSeconds * 1000)
				: undefined,
		});
		return ok(`Saved ${result.path}`, command.json, result);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error), command.json);
	}
}

export async function runCli(command: CliCommand): Promise<number> {
	switch (command.command) {
		case "help":
			writeLine(process.stdout, CLI_USAGE.trimEnd());
			return 0;
		case "version":
			writeLine(process.stdout, readCliVersion());
			return 0;
		case "error":
			return fail(command.message, command.json);
		case "sources": {
			const sources = await listCaptureSources({
				screens: command.screens,
				windows: command.windows,
			});
			if (command.json) {
				writeLine(
					process.stdout,
					JSON.stringify({
						ok: true,
						sources: sources.map(toPublicCaptureSource),
					}),
				);
				return 0;
			}
			writeLine(process.stdout, formatCaptureSources(sources));
			return 0;
		}
		case "record":
			return runRecord(command);
		case "voiceover":
			try {
				if (!command.json) {
					writeLine(process.stderr, "Generating F5-TTS voiceover...");
				}
				const result = await generateVoiceover(command);
				return ok(`Saved ${result.path}`, command.json, result);
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error), command.json);
			}
		case "install-tts":
			try {
				const helperPath = resolveVoiceoverHelper();
				if (!helperPath) {
					throw new Error(
						"F5-TTS helper missing from this install (python/voiceover.py). Keep python/ next to the record-bot binary.",
					);
				}
				const result = await installF5Tts({
					requirementsPath: path.join(path.dirname(helperPath), "requirements.txt"),
					skipWeights: command.skipWeights,
					env: {
						...process.env,
						...huggingfaceTlsEnv(),
						PYTORCH_ENABLE_MPS_FALLBACK: "1",
					},
				});
				const message = result.reused
					? `F5-TTS already installed (${result.pythonPath})`
					: `Installed F5-TTS (${result.pythonPath})`;
				return ok(message, command.json, result);
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error), command.json);
			}
		case "mux":
			return runMux(command);
		case "skill":
			try {
				const playbook = loadSkillPlaybook();
				if (command.json) {
					writeLine(
						process.stdout,
						JSON.stringify({
							ok: true,
							name: "record-bot",
							skill: playbook.skill,
							pitfalls: playbook.pitfalls,
							path: playbook.skillPath,
						}),
					);
					return 0;
				}
				writeLine(process.stdout, playbook.skill.trimEnd());
				return 0;
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error), command.json);
			}
		case "schema":
			writeLine(process.stdout, JSON.stringify(cliSchema(readCliVersion())));
			return 0;
		default: {
			const exhaustive: never = command;
			return fail(`Unhandled command ${JSON.stringify(exhaustive)}`, false);
		}
	}
}
