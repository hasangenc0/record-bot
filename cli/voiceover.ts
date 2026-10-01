import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { VoiceoverCliCommand } from "./args.ts";
import { ffmpegPath } from "./ffmpeg.ts";
import { installRoot, packageRoot } from "./paths.ts";
import { ensureF5TtsPython, MISSING_F5TTS, venvPython } from "./ttsSetup.ts";

export { MISSING_F5TTS };

export type VoiceoverResult = {
	path: string;
	sampleRate: number;
	durationMs: number;
	model: string;
	device: string;
	seed: number;
	refAudio: string;
};

export function f5TtsPythonPath(
	env: NodeJS.ProcessEnv = process.env,
	roots: string[] = [installRoot(), packageRoot()],
): string | null {
	const fromEnv = env.RECORD_BOT_F5TTS_PYTHON?.trim();
	if (fromEnv && existsSync(fromEnv)) {
		return path.resolve(fromEnv);
	}
	const seen = new Set<string>();
	for (const root of roots) {
		const candidate = venvPython(root);
		if (seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function ffmpegLibraryDir(): string | null {
	const candidates: string[] = [];
	try {
		const binDir = path.dirname(ffmpegPath());
		candidates.push(
			path.resolve(binDir, "..", "opt", "ffmpeg", "lib"),
			path.resolve(binDir, "..", "lib"),
		);
	} catch {
		// ffmpeg may be missing in some test environments
	}
	candidates.push("/opt/homebrew/opt/ffmpeg/lib", "/usr/local/opt/ffmpeg/lib");
	for (const dir of candidates) {
		if (
			existsSync(path.join(dir, "libavutil.dylib")) ||
			existsSync(path.join(dir, "libavutil.so"))
		) {
			return dir;
		}
	}
	return null;
}

function withFfmpegLibraryPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const libDir = env.RECORD_BOT_FFMPEG_LIB?.trim() || ffmpegLibraryDir();
	if (!libDir) {
		return env;
	}
	const keys =
		process.platform === "darwin"
			? ["DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"]
			: ["LD_LIBRARY_PATH"];
	const next = { ...env };
	for (const key of keys) {
		const current = next[key];
		next[key] = current ? `${libDir}${path.delimiter}${current}` : libDir;
	}
	return next;
}

export function huggingfaceTlsEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const cert =
		env.RECORD_BOT_SSL_CERT_FILE?.trim() ||
		env.SSL_CERT_FILE?.trim() ||
		env.REQUESTS_CA_BUNDLE?.trim() ||
		env.NODE_EXTRA_CA_CERTS?.trim();
	if (!cert || !existsSync(cert)) {
		return {};
	}
	return {
		SSL_CERT_FILE: cert,
		REQUESTS_CA_BUNDLE: cert,
		CURL_CA_BUNDLE: cert,
	};
}

export function voiceoverHelperPath(root: string = packageRoot()): string {
	return path.join(root, "python", "voiceover.py");
}

export function resolveVoiceoverHelper(
	roots: string[] = [installRoot(), packageRoot()],
): string | null {
	const seen = new Set<string>();
	for (const root of roots) {
		if (seen.has(root)) {
			continue;
		}
		seen.add(root);
		const candidate = voiceoverHelperPath(root);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function voiceoverHelperArgs(
	command: VoiceoverCliCommand,
	outputPath: string,
): string[] {
	const args = ["-o", outputPath, "--model", command.model, "--speed", String(command.speed)];
	if (command.textFile) {
		args.push("--text-file", command.textFile);
	} else if (command.text) {
		args.push("--text", command.text);
	}
	if (command.refAudio) {
		args.push("--ref-audio", command.refAudio);
	}
	if (command.refText !== undefined) {
		args.push("--ref-text", command.refText);
	}
	if (command.seed !== undefined) {
		args.push("--seed", String(command.seed));
	}
	if (command.nfeStep !== undefined) {
		args.push("--nfe-step", String(command.nfeStep));
	}
	if (command.removeSilence) {
		args.push("--remove-silence");
	}
	return args;
}

function defaultVoiceoverPath() {
	return path.resolve(process.cwd(), `voiceover-${Date.now()}.wav`);
}

function parseHelperPayload(stdout: string): Record<string, unknown> {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new Error("F5-TTS helper printed no JSON");
	}
	const lastLine = trimmed.split(/\r?\n/).filter(Boolean).at(-1) ?? trimmed;
	try {
		return JSON.parse(lastLine) as Record<string, unknown>;
	} catch {
		throw new Error(`F5-TTS helper printed invalid JSON: ${lastLine}`);
	}
}

function asVoiceoverResult(payload: Record<string, unknown>): VoiceoverResult {
	const outputPath = payload.path;
	if (typeof outputPath !== "string" || !outputPath) {
		throw new Error("F5-TTS helper omitted path");
	}
	return {
		path: outputPath,
		sampleRate: Number(payload.sampleRate) || 0,
		durationMs: Number(payload.durationMs) || 0,
		model: typeof payload.model === "string" ? payload.model : "F5TTS_v1_Base",
		device: typeof payload.device === "string" ? payload.device : "unknown",
		seed: Number(payload.seed) || 0,
		refAudio: typeof payload.refAudio === "string" ? payload.refAudio : "",
	};
}

export async function generateVoiceover(
	command: VoiceoverCliCommand,
	options?: {
		pythonPath?: string | null;
		helperPath?: string;
		outputPath?: string;
		env?: NodeJS.ProcessEnv;
	},
): Promise<VoiceoverResult> {
	const helperPath = options?.helperPath ?? resolveVoiceoverHelper();
	if (!helperPath || !existsSync(helperPath)) {
		throw new Error(
			"F5-TTS helper missing from this install (python/voiceover.py). Keep python/ next to the record-bot binary.",
		);
	}
	let pythonPath: string | null;
	if (options && "pythonPath" in options) {
		pythonPath = options.pythonPath ?? null;
	} else {
		pythonPath = f5TtsPythonPath(options?.env);
		if (!pythonPath) {
			pythonPath = await ensureF5TtsPython({
				env: options?.env,
				requirementsPath: path.join(path.dirname(helperPath), "requirements.txt"),
			});
		}
	}
	if (!pythonPath) {
		throw new Error(MISSING_F5TTS);
	}
	if (command.refAudio && !existsSync(path.resolve(command.refAudio))) {
		throw new Error(`Reference audio not found: ${command.refAudio}`);
	}
	if (command.textFile && !existsSync(path.resolve(command.textFile))) {
		throw new Error(`Text file not found: ${command.textFile}`);
	}

	const outputPath = path.resolve(
		options?.outputPath ?? command.output ?? defaultVoiceoverPath(),
	);
	const childEnv = withFfmpegLibraryPath({
		...(options?.env ?? process.env),
		...huggingfaceTlsEnv(options?.env ?? process.env),
		PYTORCH_ENABLE_MPS_FALLBACK: "1",
	});

	return new Promise((resolve, reject) => {
		const child = spawn(pythonPath, [helperPath, ...voiceoverHelperArgs(command, outputPath)], {
			env: childEnv,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			process.stderr.write(chunk);
		});
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		const onSignal = () => {
			child.kill("SIGTERM");
		};
		const cleanup = () => {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
		};
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);
		child.on("close", (code) => {
			cleanup();
			try {
				const payload = parseHelperPayload(stdout);
				if (payload.ok !== true) {
					const message =
						typeof payload.error === "string" ? payload.error : "F5-TTS voiceover failed";
					reject(new Error(message));
					return;
				}
				if (code !== 0) {
					reject(new Error(`F5-TTS helper exited ${code ?? "unknown"}`));
					return;
				}
				resolve(asVoiceoverResult(payload));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}
