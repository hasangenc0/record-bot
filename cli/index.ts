import { getCliArgv, parseCliArgs } from "./args.ts";
import { runCli } from "./run.ts";

function redirectConsoleToStderr() {
	const write = (...args: unknown[]) => {
		const line = args
			.map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
			.join(" ");
		process.stderr.write(`${line}\n`);
	};
	console.log = write;
	console.info = write;
	console.debug = write;
	console.warn = write;
}

redirectConsoleToStderr();

const exitCode = await runCli(parseCliArgs(getCliArgv()));
process.exit(exitCode);
