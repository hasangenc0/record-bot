import type { DemoContext, Scenario } from "../engine.ts";

// Excalidraw is a login-free 2D-canvas whiteboard. Its toolbar buttons carry
// stable, locale-independent data-testids, and the drawing surface is a plain
// <canvas>, so we select a tool by test id and then drag with the real OS
// pointer to sketch. 2D canvas (not WebGL) keeps it crisp on the CPU-only VM.
const CANVAS = "canvas";

function tool(name: string): string {
	return `[data-testid="toolbar-${name}"]`;
}

async function sceneCount(ctx: DemoContext): Promise<number> {
	return ctx.page.evaluate(() => {
		try {
			const raw = localStorage.getItem("excalidraw");
			return raw ? (JSON.parse(raw) as unknown[]).length : -1;
		} catch {
			return -2;
		}
	});
}

function debug(message: string) {
	if (process.env.RECORD_BOT_DEMO_DEBUG) {
		process.stderr.write(`${message}\n`);
	}
}

async function draw(
	ctx: DemoContext,
	name: string,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	const started = Date.now();
	await ctx.moveAndClick(tool(name));
	await ctx.sleep(120);
	await ctx.drag(from, to);
	await ctx.sleep(400);
	debug(
		`draw ${name} ${from.x},${from.y}->${to.x},${to.y} scene=${await sceneCount(ctx)} in ${Date.now() - started}ms`,
	);
}

export const excalidraw: Scenario = {
	name: "excalidraw",
	description: "Live Excalidraw whiteboard: sketch a rectangle, an ellipse, and connect them.",
	windowTitle: "Chromium",
	target: { kind: "url", url: "https://excalidraw.com" },
	voiceover: {
		text:
			"This is Excalidraw, a whiteboard on the web. record-bot tracks the cursor as I pick a tool " +
			"and sketch a shape, draw an ellipse beside it, and link the two with an arrow, so every " +
			"stroke reads clearly in the recording.",
	},
	async ready(ctx) {
		await ctx.locator(CANVAS).first().waitFor({ state: "visible", timeout: 20000 });
		await ctx.locator(tool("rectangle")).waitFor({ state: "visible", timeout: 20000 });
	},
	async run(ctx) {
		const vp = await ctx.viewportSize();
		const cx = Math.round(vp.width / 2);
		const cy = Math.round(vp.height / 2);
		debug(`excalidraw viewport=${vp.width}x${vp.height} center=${cx},${cy}`);
		await ctx.sleep(1200);

		// Rectangle on the left of centre (clear of the left properties panel).
		await draw(ctx, "rectangle", { x: cx - 260, y: cy - 90 }, { x: cx - 40, y: cy + 70 });
		// Ellipse to the right.
		await draw(ctx, "ellipse", { x: cx + 60, y: cy - 80 }, { x: cx + 280, y: cy + 80 });
		// Arrow linking the rectangle to the ellipse.
		await draw(ctx, "arrow", { x: cx - 40, y: cy }, { x: cx + 60, y: cy });

		// Fail loudly if the drags did not register, rather than shipping a blank
		// canvas: the OS drag is the fragile part of this demo.
		const elements = await sceneCount(ctx);
		debug(`excalidraw final scene elements=${elements}`);
		if (elements < 3) {
			throw new Error(`Excalidraw drew ${elements} elements; expected 3 shapes on the canvas`);
		}

		await ctx.sleep(1400);
	},
};
