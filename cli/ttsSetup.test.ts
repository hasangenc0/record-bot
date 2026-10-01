import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageRoot } from "./paths.ts";
import {
	ensureF5TtsPython,
	installF5Tts,
	isManagedInstallCurrent,
	isWeightsPrefetched,
	MISSING_F5TTS,
	managedTtsRoot,
	managedVenvPython,
	requirementsFingerprint,
	TTS_PYTHON_VERSION,
	UV_VERSION,
	uvArtifactName,
	uvDownloadUrl,
	venvPython,
} from "./ttsSetup.ts";
import { resolveVoiceoverHelper, voiceoverHelperPath } from "./voiceover.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "record-bot-tts-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("uv download target", () => {
	it("picks the GitHub release asset for this OS", () => {
		expect(uvArtifactName("darwin", "arm64")).toBe("uv-aarch64-apple-darwin.tar.gz");
		expect(uvArtifactName("darwin", "x64")).toBe("uv-x86_64-apple-darwin.tar.gz");
		expect(uvArtifactName("linux", "x64")).toBe("uv-x86_64-unknown-linux-gnu.tar.gz");
		expect(uvArtifactName("win32", "x64")).toBe("uv-x86_64-pc-windows-msvc.zip");
		expect(uvDownloadUrl("0.12.13", "darwin", "arm64")).toBe(
			"https://github.com/astral-sh/uv/releases/download/0.12.13/uv-aarch64-apple-darwin.tar.gz",
		);
		expect(UV_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(TTS_PYTHON_VERSION).toBe("3.12");
	});
});

describe("managed F5-TTS install", () => {
	it("stores the venv under RECORD_BOT_TTS_DIR", () => {
		const root = tempDir();
		expect(managedTtsRoot({ RECORD_BOT_TTS_DIR: root })).toBe(root);
		expect(managedVenvPython(root)).toBe(venvPython(root));
	});

	it("treats a matching marker plus python as current", () => {
		const root = tempDir();
		const fingerprint = requirementsFingerprint("f5-tts==1.1.22\n");
		expect(isManagedInstallCurrent(root, fingerprint)).toBe(false);
		mkdirSync(path.dirname(managedVenvPython(root)), { recursive: true });
		writeFileSync(managedVenvPython(root), "");
		writeFileSync(path.join(root, ".record-bot-requirements"), `${fingerprint}\n`);
		expect(isManagedInstallCurrent(root, fingerprint)).toBe(true);
		expect(isManagedInstallCurrent(root, "other")).toBe(false);
	});

	it("skips auto-install when RECORD_BOT_F5TTS_SKIP_INSTALL is set", async () => {
		await expect(
			ensureF5TtsPython({
				env: { RECORD_BOT_F5TTS_SKIP_INSTALL: "1" },
				requirementsPath: path.join(packageRoot(), "python", "requirements.txt"),
				log: () => {},
			}),
		).rejects.toThrow(MISSING_F5TTS);
	});

	it("creates the managed venv with uv when nothing is installed", async () => {
		const root = tempDir();
		const ttsRoot = path.join(root, "tts");
		const uv = path.join(root, "uv-fake");
		const requirementsPath = path.join(root, "requirements.txt");
		writeFileSync(uv, "");
		writeFileSync(requirementsPath, "f5-tts==1.1.22\n");
		const calls: string[][] = [];
		const python = await ensureF5TtsPython({
			env: {
				RECORD_BOT_TTS_DIR: ttsRoot,
				RECORD_BOT_UV: uv,
			},
			dataDir: root,
			requirementsPath,
			log: () => {},
			run: async (_command, args) => {
				calls.push(args);
				if (args[0] === "venv") {
					mkdirSync(path.dirname(managedVenvPython(ttsRoot)), { recursive: true });
					writeFileSync(managedVenvPython(ttsRoot), "");
				}
			},
		});
		expect(python).toBe(managedVenvPython(ttsRoot));
		expect(calls[0]?.[0]).toBe("venv");
		expect(calls[0]).toContain("--python");
		expect(calls[0]).toContain("3.12");
		expect(calls[1]?.[0]).toBe("pip");
		expect(isManagedInstallCurrent(ttsRoot, requirementsFingerprint("f5-tts==1.1.22\n"))).toBe(
			true,
		);
	});

	it("reuses a current managed install without calling uv", async () => {
		const root = tempDir();
		const requirementsPath = path.join(root, "req.txt");
		writeFileSync(requirementsPath, "f5-tts==1.1.22\n");
		const fingerprint = requirementsFingerprint("f5-tts==1.1.22\n");
		mkdirSync(path.dirname(managedVenvPython(root)), { recursive: true });
		writeFileSync(managedVenvPython(root), "");
		writeFileSync(path.join(root, ".record-bot-requirements"), `${fingerprint}\n`);
		const python = await ensureF5TtsPython({
			env: { RECORD_BOT_TTS_DIR: root },
			requirementsPath,
			run: async () => {
				throw new Error("uv should not run");
			},
			log: () => {},
		});
		expect(python).toBe(managedVenvPython(root));
	});

	it("install-tts skips weight download when asked", async () => {
		const root = tempDir();
		const requirementsPath = path.join(root, "req.txt");
		writeFileSync(requirementsPath, "f5-tts==1.1.22\n");
		const fingerprint = requirementsFingerprint("f5-tts==1.1.22\n");
		mkdirSync(path.dirname(managedVenvPython(root)), { recursive: true });
		writeFileSync(managedVenvPython(root), "");
		writeFileSync(path.join(root, ".record-bot-requirements"), `${fingerprint}\n`);
		const result = await installF5Tts({
			env: { RECORD_BOT_TTS_DIR: root },
			requirementsPath,
			skipWeights: true,
			run: async () => {
				throw new Error("uv should not run");
			},
			log: () => {},
		});
		expect(result).toEqual({
			pythonPath: managedVenvPython(root),
			ttsDir: root,
			reused: true,
			weights: false,
		});
	});

	it("install-tts prefetches weights after the env is ready", async () => {
		const root = tempDir();
		const requirementsPath = path.join(root, "req.txt");
		writeFileSync(requirementsPath, "f5-tts==1.1.22\n");
		const fingerprint = requirementsFingerprint("f5-tts==1.1.22\n");
		mkdirSync(path.dirname(managedVenvPython(root)), { recursive: true });
		writeFileSync(managedVenvPython(root), "");
		writeFileSync(path.join(root, ".record-bot-requirements"), `${fingerprint}\n`);
		const calls: string[][] = [];
		const result = await installF5Tts({
			env: { RECORD_BOT_TTS_DIR: root },
			requirementsPath,
			run: async (_command, args) => {
				calls.push(args);
			},
			log: () => {},
		});
		expect(calls).toEqual([["-c", "from f5_tts.api import F5TTS; F5TTS()"]]);
		expect(result.reused).toBe(true);
		expect(result.weights).toBe(true);
		expect(isWeightsPrefetched(root)).toBe(true);
	});
});

describe("voiceover helper path", () => {
	it("finds python/voiceover.py from the package root", () => {
		expect(resolveVoiceoverHelper([packageRoot()])).toBe(voiceoverHelperPath(packageRoot()));
		expect(resolveVoiceoverHelper([tempDir()])).toBeNull();
	});
});
