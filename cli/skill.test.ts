import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageRoot } from "./paths.ts";
import { loadSkillPlaybook, skillPlaybookDir } from "./skill.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "record-bot-skill-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("loadSkillPlaybook", () => {
	it("loads the playbook shipped with this package", () => {
		const playbook = loadSkillPlaybook([packageRoot()]);
		expect(playbook.skill.startsWith("---\nname: record-bot\n")).toBe(true);
		expect(playbook.skill).toContain("record-bot schema --json");
		expect(playbook.skill).toContain("real OS pointer");
		expect(playbook.skill).toContain("rawPath");
		expect(playbook.skill).toContain("RECORD_BOT_F5TTS_PYTHON");
		expect(playbook.skill).toContain("record-bot install-tts --json");
		expect(playbook.skill).not.toMatch(/this repo|npm run cli|make f5-tts/i);
		expect(playbook.pitfalls).toContain("OS pointer");
		expect(playbook.pitfalls).not.toMatch(/this repo|npm run cli|make f5-tts/i);
		expect(playbook.skillPath).toBe(
			path.join(packageRoot(), "skills", "record-bot", "SKILL.md"),
		);
	});

	it("reads SKILL.md and pitfalls from the first root that has them", () => {
		const root = tempDir();
		const dir = path.join(root, "skills", "record-bot", "references");
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(root, "skills", "record-bot", "SKILL.md"), "# skill\n");
		writeFileSync(path.join(dir, "pitfalls.md"), "# pitfalls\n");
		expect(skillPlaybookDir([root])).toBe(path.join(root, "skills", "record-bot"));
		expect(loadSkillPlaybook([root])).toEqual({
			skill: "# skill\n",
			pitfalls: "# pitfalls\n",
			skillPath: path.join(root, "skills", "record-bot", "SKILL.md"),
		});
	});

	it("throws when the install has no playbook", () => {
		expect(() => loadSkillPlaybook([tempDir()])).toThrow(/Playbook missing from this install/);
	});
});
