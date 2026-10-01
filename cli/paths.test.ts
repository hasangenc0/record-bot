import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeHelperPath, packageRoot, readCliVersion, resolveInstallRoot } from "./paths.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "record-bot-paths-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	delete process.env.RECORD_BOT_ROOT;
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("resolveInstallRoot", () => {
	it("uses RECORD_BOT_ROOT when set", () => {
		const root = tempDir();
		expect(resolveInstallRoot(root, "/usr/bin/node")).toBe(root);
	});

	it("uses the directory next to the executable when helpers/ exists", () => {
		const root = tempDir();
		mkdirSync(path.join(root, "helpers"));
		const binary = path.join(root, "record-bot");
		writeFileSync(binary, "");
		expect(resolveInstallRoot(undefined, binary)).toBe(realpathSync(root));
	});

	it("falls back to the package root for a normal Node process", () => {
		expect(resolveInstallRoot(undefined, process.execPath)).toBe(packageRoot());
	});
});

describe("nativeHelperPath", () => {
	it("resolves helpers from RECORD_BOT_ROOT before native/bin", () => {
		const root = tempDir();
		mkdirSync(path.join(root, "helpers"));
		const helper = path.join(root, "helpers", "sources");
		writeFileSync(helper, "");
		process.env.RECORD_BOT_ROOT = root;
		expect(nativeHelperPath("sources")).toBe(helper);
	});
});

describe("readCliVersion", () => {
	it("reads package.json next to RECORD_BOT_ROOT", () => {
		const root = tempDir();
		writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
		process.env.RECORD_BOT_ROOT = root;
		expect(readCliVersion()).toBe("9.9.9");
	});
});
