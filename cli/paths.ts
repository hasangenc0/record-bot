import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolvePackageRoot(): string {
	try {
		return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	} catch {
		return path.dirname(process.execPath);
	}
}

const PACKAGE_ROOT = resolvePackageRoot();

export function packageRoot(): string {
	return PACKAGE_ROOT;
}

function helpersDir(root: string): string {
	return path.join(root, "helpers");
}

function hasHelpers(root: string): boolean {
	return existsSync(helpersDir(root));
}

export function resolveInstallRoot(
	envRoot: string | undefined,
	executablePath: string,
): string {
	const trimmed = envRoot?.trim();
	if (trimmed) {
		return path.resolve(trimmed);
	}
	try {
		const realDir = path.dirname(realpathSync(executablePath));
		if (hasHelpers(realDir)) {
			return realDir;
		}
	} catch {
		// execPath may not exist in tests
	}
	const execDir = path.dirname(executablePath);
	if (hasHelpers(execDir)) {
		return execDir;
	}
	return PACKAGE_ROOT;
}

export function installRoot(): string {
	return resolveInstallRoot(process.env.RECORD_BOT_ROOT, process.execPath);
}

export function getNativeArchTag(platform: NodeJS.Platform = process.platform): string {
	if (platform === "darwin") {
		return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}
	if (platform === "win32") {
		return process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	}
	if (platform === "linux") {
		return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
	}
	return `${platform}-${process.arch}`;
}

export function userDataDir(): string {
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "record-bot");
	}
	if (process.platform === "win32") {
		return path.join(
			process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
			"record-bot",
		);
	}
	return path.join(
		process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
		"record-bot",
	);
}

export function recordingsDir(): string {
	return path.join(userDataDir(), "recordings");
}

export function packagedHelperPath(binaryName: string): string | null {
	const candidate = path.join(helpersDir(installRoot()), binaryName);
	return existsSync(candidate) ? candidate : null;
}

export function nativeHelperPath(binaryName: string): string {
	const packaged = packagedHelperPath(binaryName);
	if (packaged) {
		return packaged;
	}
	const helperPath = path.join(PACKAGE_ROOT, "native", "bin", getNativeArchTag(), binaryName);
	if (!existsSync(helperPath)) {
		throw new Error(
			`Native helper missing: ${helperPath}. Keep helpers/ next to the record-bot binary, or run make capture.`,
		);
	}
	return helperPath;
}

export function readCliVersion(): string {
	for (const root of [installRoot(), PACKAGE_ROOT]) {
		const pkgPath = path.join(root, "package.json");
		if (!existsSync(pkgPath)) {
			continue;
		}
		try {
			const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
			if (parsed.version) {
				return parsed.version;
			}
		} catch {}
	}
	return "0.0.0";
}

export function parseWindowId(sourceId?: string): number | null {
	if (!sourceId) {
		return null;
	}
	const match = sourceId.match(/^window:(\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}
