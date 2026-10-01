import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { installRoot, packageRoot } from "./paths.ts";

export type SkillPlaybook = {
	skill: string;
	pitfalls: string;
	skillPath: string;
};

export function skillPlaybookDir(
	roots: string[] = [installRoot(), packageRoot()],
): string | null {
	const seen = new Set<string>();
	for (const root of roots) {
		if (seen.has(root)) {
			continue;
		}
		seen.add(root);
		const dir = path.join(root, "skills", "record-bot");
		if (existsSync(path.join(dir, "SKILL.md"))) {
			return dir;
		}
	}
	return null;
}

export function loadSkillPlaybook(
	roots: string[] = [installRoot(), packageRoot()],
): SkillPlaybook {
	const dir = skillPlaybookDir(roots);
	if (!dir) {
		throw new Error(
			"Playbook missing from this install (skills/record-bot/SKILL.md). Keep skills/ next to the record-bot binary.",
		);
	}
	const skillPath = path.join(dir, "SKILL.md");
	const pitfallsPath = path.join(dir, "references", "pitfalls.md");
	return {
		skill: readFileSync(skillPath, "utf8"),
		pitfalls: existsSync(pitfallsPath) ? readFileSync(pitfallsPath, "utf8") : "",
		skillPath,
	};
}
