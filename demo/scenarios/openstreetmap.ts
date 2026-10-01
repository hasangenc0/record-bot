import type { Locator } from "playwright";
import type { DemoContext, Scenario } from "../engine.ts";

// OpenStreetMap is a login-free, consent-free map app. Tiles are raster images
// (not WebGL), so they render crisply under the recorder's software GL, and the
// search flow is entirely element-driven, which keeps the tour deterministic.
// Qualify the query so the top hit is the Paris landmark, not a same-named
// mountain peak that Nominatim otherwise ranks first.
const PLACE = "Eiffel Tower, Paris, France";

// The page renders two #query inputs (header + panel); target whichever is
// actually visible at the recording viewport.
function searchInput(ctx: DemoContext): Locator {
	return ctx.page.locator("#query:visible").first();
}

export const openstreetmap: Scenario = {
	name: "osm",
	description: "Live OpenStreetMap: search a landmark and pan the map to it.",
	windowTitle: "Chromium",
	target: { kind: "url", url: "https://www.openstreetmap.org" },
	voiceover: {
		text:
			"This is OpenStreetMap. record-bot follows the cursor as I search for the Eiffel Tower and " +
			"open it on the map, keeping the pointer sharp and every click legible as the map pans in.",
	},
	async ready(ctx) {
		await searchInput(ctx).waitFor({ state: "visible", timeout: 20000 });
	},
	async run(ctx) {
		await ctx.sleep(1400);

		await ctx.moveAndType(searchInput(ctx), PLACE, 55);
		await ctx.sleep(200);
		await ctx.page.keyboard.press("Enter");

		const firstResult = ctx.page.locator(".search_results_entry a").first();
		await firstResult.waitFor({ state: "visible", timeout: 20000 });
		await ctx.sleep(1200);

		await ctx.moveAndClick(firstResult);
		// The map recentres and zooms onto the selected object.
		await ctx.page
			.waitForURL(/\/(way|node|relation)\//, { timeout: 20000 })
			.catch(() => undefined);
		// Wait for tiles to actually paint so the final hold isn't a blank pane.
		await ctx.page
			.locator(".leaflet-tile-loaded")
			.first()
			.waitFor({ state: "visible", timeout: 15000 })
			.catch(() => undefined);
		await ctx.sleep(2600);
	},
};
