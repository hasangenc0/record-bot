import type { DemoContext, Scenario } from "../engine.ts";

// A popular, stable, login-free public repo. The walkthrough only touches the
// repository nav tabs (Code / Issues / Pull requests), which are the most
// durable part of GitHub's DOM, so the demo stays deterministic on the headless
// recorder even as list contents change day to day. Use the canonical URL
// (react/react) so the landing page does not flash through a redirect.
const REPO_URL = "https://github.com/react/react";

function repoNav(ctx: DemoContext) {
	return ctx.page.locator('nav[aria-label="Repository"]');
}

function tab(ctx: DemoContext, name: RegExp) {
	return repoNav(ctx).getByRole("link", { name }).first();
}

// GitHub shows a cookie-consent dialog in some regions. Dismiss it with a
// Playwright click (no OS pointer) before recording so it never covers the nav.
async function dismissConsent(ctx: DemoContext) {
	for (const label of ["Accept all", "Reject all", "Accept"]) {
		const button = ctx.page.getByRole("button", { name: label }).first();
		try {
			if (await button.isVisible({ timeout: 500 })) {
				await button.click({ timeout: 1500 });
				return;
			}
		} catch {
			/* no banner in this region */
		}
	}
}

export const github: Scenario = {
	name: "github",
	description: "Live tour of a public GitHub repo: browse code, issues, and pull requests.",
	// macOS records the browser window; match the Chromium app rather than the
	// (changing) page title. Linux records the whole screen and ignores this.
	windowTitle: "Chromium",
	target: { kind: "url", url: REPO_URL },
	voiceover: {
		text:
			"This is the React repository on GitHub. record-bot follows the cursor as I browse the " +
			"source, open the issues, and review the pull requests, capturing every click in crisp, " +
			"zoomed-in detail.",
	},
	async ready(ctx) {
		await dismissConsent(ctx);
		await repoNav(ctx).waitFor({ state: "visible", timeout: 20000 });
		await tab(ctx, /Issues/).waitFor({ state: "visible", timeout: 20000 });
	},
	async run(ctx) {
		// Repo root path (e.g. "/react/react"), captured before navigating so the
		// return-to-Code wait works regardless of which owner GitHub redirects to.
		const repoPath = new URL(ctx.page.url()).pathname.replace(/\/$/, "");

		// Hold on the repository landing page (header + file tree + README).
		await ctx.sleep(2000);

		await ctx.moveAndClick(tab(ctx, /Issues/));
		await ctx.page.waitForURL(/\/issues(\/|\?|$)/, { timeout: 20000 });
		await ctx.page.locator("main").waitFor({ state: "visible" });
		await ctx.sleep(1800);

		await ctx.moveAndClick(tab(ctx, /Pull requests/));
		await ctx.page.waitForURL(/\/pulls(\/|\?|$)/, { timeout: 20000 });
		await ctx.page.locator("main").waitFor({ state: "visible" });
		await ctx.sleep(1800);

		await ctx.moveAndClick(tab(ctx, /^Code/));
		await ctx.page.waitForURL((url) => url.pathname.replace(/\/$/, "") === repoPath, {
			timeout: 20000,
		});
		await ctx.page.locator("main").waitFor({ state: "visible" });
		await ctx.sleep(1600);
	},
};
