import path from "node:path";
import type { DemoContext, Scenario } from "../engine.ts";
import { repoRoot } from "../lib.ts";

const INTRO_HOLD_MS = 2000;

async function cardColumn(ctx: DemoContext, cardTestId: string): Promise<string | null> {
	return ctx.page.evaluate((id) => {
		const card = document.querySelector(`[data-testid="${id}"]`);
		return card?.closest("[data-column]")?.getAttribute("data-column") ?? null;
	}, cardTestId);
}

// The OS click lands wherever the warped pointer stopped, so a dropped warp step
// can leave it just off the Move button and the click silently no-ops. Confirm
// the card actually advanced a column and re-aim if it did not.
async function moveCard(ctx: DemoContext, cardTestId: string) {
	const selector = `[data-testid='${cardTestId}'] [data-move]`;
	const before = await cardColumn(ctx, cardTestId);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await ctx.moveAndClick(selector);
		for (let poll = 0; poll < 10; poll += 1) {
			const now = await cardColumn(ctx, cardTestId);
			if (now && now !== before) {
				return;
			}
			await ctx.sleep(60);
		}
	}
	throw new Error(
		`Move click never advanced ${cardTestId} out of the ${before ?? "unknown"} column`,
	);
}

async function clearSearch(ctx: DemoContext) {
	await ctx.moveAndClick("[data-testid='search']");
	const search = ctx.page.locator("[data-testid='search']");
	await search.press("ControlOrMeta+A");
	await ctx.sleep(80);
	await search.press("Backspace");
	if ((await search.inputValue()) !== "") {
		await search.fill("");
	}
}

export const harbor: Scenario = {
	name: "harbor",
	description: "Local Harbor task board: search, add a task, move cards across columns.",
	windowTitle: "Harbor",
	target: { kind: "local", appDir: path.join(repoRoot(), "demo", "app") },
	voiceover: { textFile: path.join(repoRoot(), "demo", "script.txt") },
	async ready(ctx) {
		await ctx.page.waitForFunction(() => document.title === "Harbor");
		await ctx.page.locator("[data-testid='board']").waitFor({ state: "visible" });
	},
	async run(ctx) {
		await ctx.sleep(INTRO_HOLD_MS);
		await ctx.moveAndClick("[data-testid='search']");
		await ctx.sleep(180);
		await ctx.page.locator("[data-testid='search']").pressSequentially("Design", {
			delay: 55,
		});
		await ctx.sleep(450);
		await clearSearch(ctx);
		await ctx.sleep(220);
		await ctx.moveAndClick("[data-testid='new-task']");
		await ctx.page.locator("[data-testid='task-title']").waitFor({ state: "visible" });
		await ctx.sleep(220);
		await ctx.moveAndType("[data-testid='task-title']", "Ship launch checklist", 36);
		await ctx.sleep(180);
		await ctx.moveAndClick("[data-testid='submit-task']");
		await ctx.page.locator("[data-testid='new-task-form']").waitFor({ state: "hidden" });
		await ctx.page
			.locator("[data-testid='card-ship-launch-checklist']")
			.waitFor({ state: "visible" });
		await ctx.sleep(400);
		await moveCard(ctx, "card-ship-launch-checklist");
		await ctx.sleep(600);
		await moveCard(ctx, "card-design-review");
		await ctx.sleep(900);
	},
};
