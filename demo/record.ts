import path from "node:path";
import { runDemo } from "./engine.ts";
import { type DemoArgs, parseDemoArgs, repoRoot } from "./lib.ts";
import { DEFAULT_SCENARIO, getScenario, listScenarios } from "./scenarios/index.ts";

const DEMO_USAGE = `record-bot demo — Playwright walkthroughs recorded with record-bot

Usage:
  npm run demo -- [options]
  node demo/record.ts [options]

Options:
  -s, --scenario <name>   Which demo to record (default: ${DEFAULT_SCENARIO})
  --list                  List available scenarios and exit
  -o, --output <path>     Final MP4 (default: demo/out/<scenario>.mp4)
  --no-voiceover          Skip F5-TTS and mux video only
  --window-title <name>   Capture window match (macOS; default: scenario's)
`;

function writeErr(message: string) {
	process.stderr.write(`${message}\n`);
}

function printScenarios() {
	process.stdout.write("Available scenarios:\n");
	for (const scenario of listScenarios()) {
		process.stdout.write(`  ${scenario.name.padEnd(10)} ${scenario.description}\n`);
	}
}

async function main(): Promise<number> {
	const root = repoRoot();
	const parsed = parseDemoArgs(process.argv.slice(2), {
		outDir: path.join(root, "demo", "out"),
		scenario: DEFAULT_SCENARIO,
	});
	if ("error" in parsed) {
		if (parsed.error === "help") {
			process.stdout.write(DEMO_USAGE);
			return 0;
		}
		writeErr(`record-bot demo: ${parsed.error}`);
		return 1;
	}

	const args: DemoArgs = parsed;
	if (args.list) {
		printScenarios();
		return 0;
	}

	const scenario = getScenario(args.scenario);
	if (!scenario) {
		writeErr(
			`record-bot demo: unknown scenario "${args.scenario}". Run with --list to see options.`,
		);
		return 1;
	}

	return runDemo(scenario, {
		output: args.output,
		voiceover: args.voiceover,
		windowTitle: args.windowTitle,
	});
}

try {
	process.exit(await main());
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	writeErr(message);
	if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
		writeErr("Install Chromium first: npx playwright install chromium");
	}
	process.exit(1);
}
