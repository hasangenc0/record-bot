import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { userDataDir } from "./paths.ts";

export const UV_VERSION = "0.12.13";
export const TTS_PYTHON_VERSION = "3.12";
export const MISSING_F5TTS =
	"F5-TTS is not installed. Set RECORD_BOT_F5TTS_PYTHON to a Python interpreter that has f5-tts.";

const MARKER_NAME = ".record-bot-requirements";
const LOCK_NAME = ".install-lock";

export type TtsLog = (message: string) => void;

export type TtsCommandRunner = (
	command: string,
	args: string[],
	options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<void>;

function defaultLog(message: string) {
	process.stderr.write(`${message}\n`);
}

export function venvPython(root: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === "win32") {
		return path.join(root, ".venv", "Scripts", "python.exe");
	}
	return path.join(root, ".venv", "bin", "python");
}

export function managedTtsRoot(
	env: NodeJS.ProcessEnv = process.env,
	dataDir: string = userDataDir(),
): string {
	const override = env.RECORD_BOT_TTS_DIR?.trim();
	if (override) {
		return path.resolve(override);
	}
	return path.join(dataDir, "tts");
}

export function managedVenvPython(
	ttsRoot: string = managedTtsRoot(),
	platform: NodeJS.Platform = process.platform,
): string {
	return venvPython(ttsRoot, platform);
}

export function uvBinaryName(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "uv.exe" : "uv";
}

export function uvArtifactName(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string {
	if (platform === "darwin" && arch === "arm64") {
		return "uv-aarch64-apple-darwin.tar.gz";
	}
	if (platform === "darwin") {
		return "uv-x86_64-apple-darwin.tar.gz";
	}
	if (platform === "linux" && arch === "arm64") {
		return "uv-aarch64-unknown-linux-gnu.tar.gz";
	}
	if (platform === "linux") {
		return "uv-x86_64-unknown-linux-gnu.tar.gz";
	}
	if (platform === "win32" && arch === "arm64") {
		return "uv-aarch64-pc-windows-msvc.zip";
	}
	if (platform === "win32") {
		return "uv-x86_64-pc-windows-msvc.zip";
	}
	throw new Error(`F5-TTS auto-install is not supported on ${platform}-${arch}.`);
}

export function uvDownloadUrl(
	version: string = UV_VERSION,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): string {
	return `https://github.com/astral-sh/uv/releases/download/${version}/${uvArtifactName(platform, arch)}`;
}

export function requirementsFingerprint(contents: string): string {
	return contents.replace(/\r\n/g, "\n").trim();
}

export function isManagedInstallCurrent(ttsRoot: string, fingerprint: string): boolean {
	const markerPath = path.join(ttsRoot, MARKER_NAME);
	if (!existsSync(managedVenvPython(ttsRoot)) || !existsSync(markerPath)) {
		return false;
	}
	try {
		return readFileSync(markerPath, "utf8").trim() === fingerprint;
	} catch {
		return false;
	}
}

export function commandOnPath(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const finder = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(finder, [name], { encoding: "utf8", env, windowsHide: true });
	if (result.status !== 0) {
		return null;
	}
	const first = (result.stdout || "")
		.trim()
		.split(/\r?\n/)
		.find((line) => line.trim());
	return first || null;
}

export function defaultCommandRunner(): TtsCommandRunner {
	return (command, args, options) =>
		new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: options?.cwd,
				env: options?.env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			child.stdout?.on("data", (chunk: string | Buffer) => {
				process.stderr.write(chunk);
			});
			child.stderr?.on("data", (chunk: string | Buffer) => {
				process.stderr.write(chunk);
			});
			child.on("error", reject);
			child.on("close", (code) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "unknown"}`));
			});
		});
}

async function withInstallLock(ttsRoot: string, run: () => Promise<void>): Promise<void> {
	mkdirSync(ttsRoot, { recursive: true });
	const lockDir = path.join(ttsRoot, LOCK_NAME);
	const started = Date.now();
	while (true) {
		try {
			mkdirSync(lockDir);
			break;
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code !== "EEXIST") {
				throw error;
			}
			if (Date.now() - started > 30 * 60 * 1000) {
				throw new Error("Timed out waiting for another F5-TTS install to finish.");
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	try {
		await run();
	} finally {
		rmSync(lockDir, { recursive: true, force: true });
	}
}

function findFileNamed(root: string, name: string): string | null {
	if (!existsSync(root)) {
		return null;
	}
	const direct = path.join(root, name);
	if (existsSync(direct)) {
		return direct;
	}
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const child = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const nested = findFileNamed(child, name);
			if (nested) {
				return nested;
			}
		} else if (entry.name === name) {
			return child;
		}
	}
	return null;
}

async function extractArchive(archive: string, dest: string): Promise<void> {
	mkdirSync(dest, { recursive: true });
	await defaultCommandRunner()("tar", ["-xf", archive, "-C", dest]);
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await fetch(url, {
		headers: { "User-Agent": "record-bot" },
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) {
		throw new Error(`Download failed (${response.status}): ${url}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	mkdirSync(path.dirname(dest), { recursive: true });
	writeFileSync(dest, bytes);
}

export async function resolveUvBinary(
	env: NodeJS.ProcessEnv = process.env,
	log: TtsLog = defaultLog,
	dataDir: string = userDataDir(),
): Promise<string> {
	const fromEnv = env.RECORD_BOT_UV?.trim();
	if (fromEnv && existsSync(fromEnv)) {
		return path.resolve(fromEnv);
	}
	const onPath = commandOnPath("uv", env);
	if (onPath) {
		return onPath;
	}
	const cached = path.join(dataDir, "bin", uvBinaryName());
	if (existsSync(cached)) {
		return cached;
	}

	const url = uvDownloadUrl();
	log(`Downloading uv ${UV_VERSION} (used once to install F5-TTS)...`);
	const staging = mkdtempSync(path.join(os.tmpdir(), "record-bot-uv-"));
	try {
		const archive = path.join(staging, uvArtifactName());
		await downloadFile(url, archive);
		const extracted = path.join(staging, "out");
		await extractArchive(archive, extracted);
		const found = findFileNamed(extracted, uvBinaryName());
		if (!found) {
			throw new Error(`uv binary missing from ${url}`);
		}
		mkdirSync(path.dirname(cached), { recursive: true });
		copyFileSync(found, cached);
		if (process.platform !== "win32") {
			chmodSync(cached, 0o755);
		}
		return cached;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

async function installManagedF5Tts(options: {
	ttsRoot: string;
	pythonPath: string;
	requirementsPath: string;
	fingerprint: string;
	env: NodeJS.ProcessEnv;
	log: TtsLog;
	run: TtsCommandRunner;
	dataDir: string;
}): Promise<void> {
	const uv = await resolveUvBinary(options.env, options.log, options.dataDir);
	options.log(
		`Installing F5-TTS into ${options.ttsRoot} (first voiceover only; Python + PyTorch + TTS).`,
	);
	const venvDir = path.join(options.ttsRoot, ".venv");
	if (!existsSync(options.pythonPath)) {
		await options.run(uv, ["venv", "--python", TTS_PYTHON_VERSION, venvDir], {
			env: options.env,
		});
	}
	if (!existsSync(options.requirementsPath)) {
		throw new Error(
			`F5-TTS requirements missing (${options.requirementsPath}). Keep python/ next to the record-bot binary.`,
		);
	}
	await options.run(
		uv,
		["pip", "install", "--python", options.pythonPath, "-r", options.requirementsPath],
		{ env: options.env },
	);
	writeFileSync(path.join(options.ttsRoot, MARKER_NAME), `${options.fingerprint}\n`);
	options.log("F5-TTS is ready. First synthesis also downloads model weights (~1.3GB).");
}

function skipInstall(env: NodeJS.ProcessEnv): boolean {
	const raw = env.RECORD_BOT_F5TTS_SKIP_INSTALL?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

export async function ensureF5TtsPython(options?: {
	env?: NodeJS.ProcessEnv;
	log?: TtsLog;
	run?: TtsCommandRunner;
	requirementsPath?: string;
	dataDir?: string;
}): Promise<string> {
	const env = options?.env ?? process.env;
	const log = options?.log ?? defaultLog;
	const run = options?.run ?? defaultCommandRunner();
	const dataDir = options?.dataDir ?? userDataDir();
	if (skipInstall(env)) {
		throw new Error(MISSING_F5TTS);
	}

	const ttsRoot = managedTtsRoot(env, dataDir);
	const pythonPath = managedVenvPython(ttsRoot);
	const requirementsPath = options?.requirementsPath;
	if (!requirementsPath || !existsSync(requirementsPath)) {
		throw new Error("F5-TTS requirements missing. Keep python/ next to the record-bot binary.");
	}
	const fingerprint = requirementsFingerprint(readFileSync(requirementsPath, "utf8"));

	if (isManagedInstallCurrent(ttsRoot, fingerprint)) {
		return pythonPath;
	}

	try {
		await withInstallLock(ttsRoot, async () => {
			if (isManagedInstallCurrent(ttsRoot, fingerprint)) {
				return;
			}
			await installManagedF5Tts({
				ttsRoot,
				pythonPath,
				requirementsPath,
				fingerprint,
				env,
				log,
				run,
				dataDir,
			});
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === MISSING_F5TTS || message.startsWith("Timed out waiting")) {
			throw error;
		}
		throw new Error(
			`Could not install F5-TTS (${message}). Check the network, or set RECORD_BOT_F5TTS_PYTHON to a Python that has f5-tts.`,
		);
	}

	if (!existsSync(pythonPath)) {
		throw new Error(MISSING_F5TTS);
	}
	return pythonPath;
}

const WEIGHTS_MARKER = ".record-bot-weights";
const WEIGHTS_ID = "F5TTS_v1_Base";

export type F5TtsInstallResult = {
	pythonPath: string;
	ttsDir: string;
	reused: boolean;
	weights: boolean;
};

export function isWeightsPrefetched(ttsRoot: string): boolean {
	const markerPath = path.join(ttsRoot, WEIGHTS_MARKER);
	if (!existsSync(markerPath)) {
		return false;
	}
	try {
		return readFileSync(markerPath, "utf8").trim() === WEIGHTS_ID;
	} catch {
		return false;
	}
}

export async function installF5Tts(options: {
	requirementsPath: string;
	skipWeights?: boolean;
	env?: NodeJS.ProcessEnv;
	log?: TtsLog;
	run?: TtsCommandRunner;
	dataDir?: string;
}): Promise<F5TtsInstallResult> {
	const env = options.env ?? process.env;
	const log = options.log ?? defaultLog;
	const run = options.run ?? defaultCommandRunner();
	const dataDir = options.dataDir ?? userDataDir();
	const ttsDir = managedTtsRoot(env, dataDir);
	const fingerprint = requirementsFingerprint(readFileSync(options.requirementsPath, "utf8"));
	const reused = isManagedInstallCurrent(ttsDir, fingerprint);
	const pythonPath = await ensureF5TtsPython({
		env,
		log,
		run,
		dataDir,
		requirementsPath: options.requirementsPath,
	});
	let weights = isWeightsPrefetched(ttsDir);
	if (!options.skipWeights && !weights) {
		log("Downloading F5-TTS model weights (~1.3GB)...");
		await run(pythonPath, ["-c", "from f5_tts.api import F5TTS; F5TTS()"], { env });
		writeFileSync(path.join(ttsDir, WEIGHTS_MARKER), `${WEIGHTS_ID}\n`);
		weights = true;
	}
	return { pythonPath, ttsDir, reused, weights };
}
