import {
	defaultStyleOptions,
	parseBackgroundValue,
	parseCanvasSize,
	parseCropValue,
	parseZoomMode,
	type StyleOptions,
} from "./style.ts";

export type SourcesCliCommand = {
	command: "sources";
	json: boolean;
	screens: boolean;
	windows: boolean;
};

export type RecordCliCommand = {
	command: "record";
	json: boolean;
	screen?: number;
	displayId?: string;
	window?: string;
	windowId?: string;
	output?: string;
	rawOutput?: string;
	mic: boolean;
	systemAudio: boolean;
	micDevice?: string;
	durationSeconds?: number;
	style: StyleOptions;
};

export type VoiceoverCliCommand = {
	command: "voiceover";
	json: boolean;
	text?: string;
	textFile?: string;
	refAudio?: string;
	refText?: string;
	output?: string;
	model: string;
	speed: number;
	seed?: number;
	nfeStep?: number;
	removeSilence: boolean;
};

export type MuxCliCommand = {
	command: "mux";
	json: boolean;
	video: string;
	audio: string;
	output?: string;
	delaySeconds: number;
	durationSeconds?: number;
};

export type SchemaCliCommand = {
	command: "schema";
	json: boolean;
};

export type SkillCliCommand = {
	command: "skill";
	json: boolean;
};

export type InstallTtsCliCommand = {
	command: "install-tts";
	json: boolean;
	skipWeights: boolean;
};

export type HelpCliCommand = {
	command: "help";
};

export type VersionCliCommand = {
	command: "version";
};

export type ErrorCliCommand = {
	command: "error";
	message: string;
	json: boolean;
};

export type CliCommand =
	| SourcesCliCommand
	| RecordCliCommand
	| VoiceoverCliCommand
	| MuxCliCommand
	| SchemaCliCommand
	| SkillCliCommand
	| InstallTtsCliCommand
	| HelpCliCommand
	| VersionCliCommand
	| ErrorCliCommand;

const HELP_FLAGS = new Set(["-h", "--help", "help"]);
const VERSION_FLAGS = new Set(["-v", "--version", "version"]);

export const CLI_USAGE = `record-bot — headless screen recorder for scripts and agents

Usage:
  record-bot sources [options]
  record-bot record [options]
  record-bot voiceover [options]
  record-bot install-tts [--json]
  record-bot mux [options]
  record-bot skill [--json]
  record-bot schema [--json]
  record-bot --help
  record-bot --version

List capture targets:
  record-bot sources --json
  record-bot sources --screens
  record-bot sources --windows

Record:
  record-bot record --screen 1 -o demo.mp4 --duration 10 --json
  record-bot record --window Safari --mic --system-audio --duration 30
  record-bot record --screen 1 -o demo.mp4 --duration 10 --background wall.jpg --padding 96 --crop 120,80,1280,720

Voiceover (F5-TTS):
  record-bot voiceover --text "Hello from record-bot." -o /tmp/vo.wav --json
  record-bot voiceover --text-file script.txt --ref-audio voice.wav --ref-text "Transcript of the sample." -o /tmp/vo.wav --json
  record-bot install-tts --json

Mux:
  record-bot mux --video demo.mp4 --audio vo.wav -o demo.narrated.mp4 --json
  record-bot mux --video demo.mp4 --audio vo.wav -o out.mp4 --delay 500ms --json

Agent playbook:
  record-bot skill --json

Machine-readable catalog:
  record-bot schema --json

Sources options:
  --screens          List displays only
  --windows          List windows only
  --json             Print one JSON object to stdout

Record options:
  --screen <n>       1-based screen number from \`record-bot sources\`
  --display-id <id>  Raw display id
  --window <name>    Match a window by app or title (substring)
  --window-id <id>   Raw window id (with or without the window: prefix)
  -o, --output <path>
                     Styled MP4 path (default: ./recording-<timestamp>.mp4)
  --raw-output <path>
                     Raw capture path (default: <output>.raw.mp4)
  --mic              Capture the microphone
  --system-audio     Capture system audio
  --mic-device <id>  Microphone device id or label
  -d, --duration <seconds>
                     Stop after N seconds (also accepts 10s, 1m)
  --json             Print one JSON object to stdout
  --no-style         Write only the raw capture to -o
  --background <color|path>
                     Canvas fill (#1a1a24) or image path
  --padding <px>     Margin around the capture (default 80)
  --zoom <auto|off|n>
                     Cursor-follow zoom (default auto, max 1.7)
  --cursor / --no-cursor
                     Overlay a pointer (default on)
  --size <WxH>       Styled canvas (default 1920x1080)
  --crop <x,y,w,h>   Keep only this rectangle of the raw capture (pixels)
                     Also accepts WxH+X+Y. Ignored with --no-style.

Voiceover options:
  --text <words>     Words to speak
  --text-file <path> Read words from a UTF-8 file (overrides --text)
  --ref-audio <path> Voice sample WAV (default: bundled English example)
  --ref-text <words> Transcript of --ref-audio. Empty runs ASR.
  -o, --output <path>
                     WAV path (default: ./voiceover-<timestamp>.wav)
  --model <name>     F5TTS_v1_Base (default), F5TTS_Base, or E2TTS_Base
  --speed <n>        Speaking rate from 0.5 to 2 (default 1)
  --seed <n>         Reproducible generation seed
  --nfe-step <n>     Denoising steps, 4 to 128 (default 32)
  --remove-silence   Trim long silences from the WAV
  --json             Print one JSON object to stdout

Mux options:
  --video <path>     Recorded MP4 (usually the styled file)
  --audio <path>     Voiceover WAV (or other audio)
  -o, --output <path>
                     Muxed MP4 (default: ./mux-<timestamp>.mp4)
  --delay <duration> Silence before the audio (0.5, 500ms, 1s)
  -d, --duration <duration>
                     Output length. Default is delay plus audio length.
  --json             Print one JSON object to stdout

Install-tts options:
  --json             Print one JSON object to stdout
  --skip-weights     Install the Python env only; skip the ~1.3GB model download

Skill options:
  --json             Print the playbook as one JSON object (skill + pitfalls)

Schema options:
  --json             Accepted; schema always prints one JSON object

Agents should pass --json and --duration. Read the playbook with record-bot skill --json. Logs go to stderr.
Stop an open-ended recording with Ctrl+C.
First voiceover installs F5-TTS if needed, then downloads model weights (~1.3GB).
Preinstall in a VM with record-bot install-tts.
`;

export function parseDurationSeconds(
	raw: string,
	options?: { allowZero?: boolean },
): number | null {
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}

	const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
	if (!match) {
		return null;
	}

	const value = Number(match[1]);
	if (!Number.isFinite(value) || value < 0) {
		return null;
	}
	if (value === 0 && !options?.allowZero) {
		return null;
	}

	const unit = match[2] ?? "s";
	if (unit === "ms") {
		return value / 1000;
	}
	if (unit === "m") {
		return value * 60;
	}
	return value;
}

function readOptionValue(
	args: string[],
	index: number,
	flag: string,
): { value: string; nextIndex: number } | { error: string } {
	const inline = args[index].slice(flag.length);
	if (inline.startsWith("=")) {
		const value = inline.slice(1);
		if (!value) {
			return { error: `${flag} requires a value` };
		}
		return { value, nextIndex: index };
	}

	const value = args[index + 1];
	if (value === undefined || value.startsWith("-")) {
		return { error: `${flag} requires a value` };
	}
	return { value, nextIndex: index + 1 };
}

function asError(message: string, json = false): ErrorCliCommand {
	return { command: "error", message, json };
}

export function parseCliArgs(argv: string[]): CliCommand {
	const args = argv.filter((arg) => arg !== "--");
	const first = args[0];
	if (!first || HELP_FLAGS.has(first)) {
		return { command: "help" };
	}

	if (VERSION_FLAGS.has(first)) {
		return { command: "version" };
	}

	const commandName = args[0];
	const wantsJson = args.includes("--json");
	if (
		commandName !== "sources" &&
		commandName !== "record" &&
		commandName !== "list" &&
		commandName !== "schema" &&
		commandName !== "voiceover" &&
		commandName !== "mux" &&
		commandName !== "skill" &&
		commandName !== "install-tts" &&
		commandName !== "tts"
	) {
		return asError(`Unknown command "${commandName}". Run record-bot --help.`, wantsJson);
	}

	const rest = args.slice(1);
	if (commandName === "schema") {
		return parseSchemaArgs(rest);
	}
	if (commandName === "skill") {
		return parseSkillArgs(rest);
	}
	if (commandName === "install-tts" || commandName === "tts") {
		return parseInstallTtsArgs(rest);
	}
	if (commandName === "sources" || commandName === "list") {
		return parseSourcesArgs(rest);
	}
	if (commandName === "voiceover") {
		return parseVoiceoverArgs(rest);
	}
	if (commandName === "mux") {
		return parseMuxArgs(rest);
	}
	return parseRecordArgs(rest);
}

function parseSourcesArgs(args: string[]): CliCommand {
	let json = false;
	let screens = false;
	let windows = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--screens") {
			screens = true;
			continue;
		}
		if (arg === "--windows") {
			windows = true;
			continue;
		}
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		return asError(
			`Unknown option "${arg}" for sources. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}

	if (!screens && !windows) {
		screens = true;
		windows = true;
	}

	return { command: "sources", json, screens, windows };
}

const DEFAULT_VOICEOVER_MODEL = "F5TTS_v1_Base";

function parseVoiceoverArgs(args: string[]): CliCommand {
	let json = false;
	let text: string | undefined;
	let textFile: string | undefined;
	let refAudio: string | undefined;
	let refText: string | undefined;
	let output: string | undefined;
	let model = DEFAULT_VOICEOVER_MODEL;
	let speed = 1;
	let seed: number | undefined;
	let nfeStep: number | undefined;
	let removeSilence = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--remove-silence") {
			removeSilence = true;
			continue;
		}

		const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (
			flag === "--text" ||
			flag === "--text-file" ||
			flag === "--ref-audio" ||
			flag === "--ref-text" ||
			flag === "--output" ||
			flag === "-o" ||
			flag === "--model" ||
			flag === "--speed" ||
			flag === "--seed" ||
			flag === "--nfe-step"
		) {
			const result = readOptionValue(args, index, flag);
			if ("error" in result) {
				return asError(result.error, json || args.includes("--json"));
			}
			index = result.nextIndex;
			const value = result.value;
			const jsonMode = json || args.includes("--json");

			if (flag === "--text") {
				text = value;
				continue;
			}
			if (flag === "--text-file") {
				textFile = value;
				continue;
			}
			if (flag === "--ref-audio") {
				refAudio = value;
				continue;
			}
			if (flag === "--ref-text") {
				refText = value;
				continue;
			}
			if (flag === "--output" || flag === "-o") {
				output = value;
				continue;
			}
			if (flag === "--model") {
				if (!value.trim()) {
					return asError("--model requires a value", jsonMode);
				}
				model = value;
				continue;
			}
			if (flag === "--speed") {
				const parsed = Number(value);
				if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 2) {
					return asError("--speed must be a number from 0.5 to 2", jsonMode);
				}
				speed = parsed;
				continue;
			}
			if (flag === "--seed") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0) {
					return asError("--seed must be a non-negative integer", jsonMode);
				}
				seed = parsed;
				continue;
			}
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 4 || parsed > 128) {
				return asError("--nfe-step must be an integer from 4 to 128", jsonMode);
			}
			nfeStep = parsed;
			continue;
		}

		return asError(
			`Unknown option "${arg}" for voiceover. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}

	if (!text && !textFile) {
		return asError(
			"voiceover requires --text or --text-file.",
			json || args.includes("--json"),
		);
	}

	return {
		command: "voiceover",
		json,
		text,
		textFile,
		refAudio,
		refText,
		output,
		model,
		speed,
		seed,
		nfeStep,
		removeSilence,
	};
}

function parseMuxArgs(args: string[]): CliCommand {
	let json = false;
	let video: string | undefined;
	let audio: string | undefined;
	let output: string | undefined;
	let delaySeconds = 0;
	let durationSeconds: number | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		if (arg === "--json") {
			json = true;
			continue;
		}

		const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (
			flag === "--video" ||
			flag === "--audio" ||
			flag === "--output" ||
			flag === "-o" ||
			flag === "--delay" ||
			flag === "--duration" ||
			flag === "-d"
		) {
			const result = readOptionValue(args, index, flag);
			if ("error" in result) {
				return asError(result.error, json || args.includes("--json"));
			}
			index = result.nextIndex;
			const value = result.value;
			const jsonMode = json || args.includes("--json");

			if (flag === "--video") {
				video = value;
				continue;
			}
			if (flag === "--audio") {
				audio = value;
				continue;
			}
			if (flag === "--output" || flag === "-o") {
				output = value;
				continue;
			}
			if (flag === "--delay") {
				const parsed = parseDurationSeconds(value, { allowZero: true });
				if (parsed === null) {
					return asError("--delay must be a duration, e.g. 0.5, 500ms, or 1s", jsonMode);
				}
				delaySeconds = parsed;
				continue;
			}
			const duration = parseDurationSeconds(value);
			if (duration === null) {
				return asError("--duration must be seconds, e.g. 30, 10s, or 1m", jsonMode);
			}
			durationSeconds = duration;
			continue;
		}

		return asError(
			`Unknown option "${arg}" for mux. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}

	const jsonMode = json || args.includes("--json");
	if (!video) {
		return asError("mux requires --video.", jsonMode);
	}
	if (!audio) {
		return asError("mux requires --audio.", jsonMode);
	}
	if (durationSeconds !== undefined && durationSeconds <= delaySeconds) {
		return asError("--duration must be longer than --delay.", jsonMode);
	}

	return {
		command: "mux",
		json,
		video,
		audio,
		output,
		delaySeconds,
		durationSeconds,
	};
}

function parseSchemaArgs(args: string[]): CliCommand {
	for (const arg of args) {
		if (arg === "--json") {
			continue;
		}
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		return asError(`Unknown option "${arg}" for schema. Run record-bot --help.`, true);
	}
	return { command: "schema", json: true };
}

function parseSkillArgs(args: string[]): CliCommand {
	let json = false;
	for (const arg of args) {
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		return asError(
			`Unknown option "${arg}" for skill. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}
	return { command: "skill", json };
}

function parseInstallTtsArgs(args: string[]): CliCommand {
	let json = false;
	let skipWeights = false;
	for (const arg of args) {
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--skip-weights") {
			skipWeights = true;
			continue;
		}
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		return asError(
			`Unknown option "${arg}" for install-tts. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}
	return { command: "install-tts", json, skipWeights };
}

function parseRecordArgs(args: string[]): CliCommand {
	let json = false;
	let screen: number | undefined;
	let displayId: string | undefined;
	let windowName: string | undefined;
	let windowId: string | undefined;
	let output: string | undefined;
	let rawOutput: string | undefined;
	let mic = false;
	let systemAudio = false;
	let micDevice: string | undefined;
	let durationSeconds: number | undefined;
	const style = defaultStyleOptions();

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (HELP_FLAGS.has(arg)) {
			return { command: "help" };
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--mic") {
			mic = true;
			continue;
		}
		if (arg === "--system-audio") {
			systemAudio = true;
			continue;
		}
		if (arg === "--styled") {
			style.enabled = true;
			continue;
		}
		if (arg === "--no-style") {
			style.enabled = false;
			continue;
		}
		if (arg === "--cursor") {
			style.cursor = true;
			continue;
		}
		if (arg === "--no-cursor") {
			style.cursor = false;
			continue;
		}

		const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		if (
			flag === "--screen" ||
			flag === "--display-id" ||
			flag === "--window" ||
			flag === "--window-id" ||
			flag === "--output" ||
			flag === "-o" ||
			flag === "--raw-output" ||
			flag === "--mic-device" ||
			flag === "--duration" ||
			flag === "-d" ||
			flag === "--background" ||
			flag === "--padding" ||
			flag === "--zoom" ||
			flag === "--size" ||
			flag === "--crop"
		) {
			const result = readOptionValue(args, index, flag);
			if ("error" in result) {
				return asError(result.error, json || args.includes("--json"));
			}
			index = result.nextIndex;
			const value = result.value;
			const jsonMode = json || args.includes("--json");

			if (flag === "--screen") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 1) {
					return asError("--screen must be a 1-based screen number", jsonMode);
				}
				screen = parsed;
				continue;
			}
			if (flag === "--display-id") {
				displayId = value;
				continue;
			}
			if (flag === "--window") {
				windowName = value;
				continue;
			}
			if (flag === "--window-id") {
				windowId = value;
				continue;
			}
			if (flag === "--output" || flag === "-o") {
				output = value;
				continue;
			}
			if (flag === "--raw-output") {
				rawOutput = value;
				continue;
			}
			if (flag === "--mic-device") {
				micDevice = value;
				mic = true;
				continue;
			}
			if (flag === "--background") {
				const parsed = parseBackgroundValue(value);
				if ("error" in parsed) {
					return asError(parsed.error, jsonMode);
				}
				style.background = parsed;
				continue;
			}
			if (flag === "--padding") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0 || parsed > 600) {
					return asError("--padding must be an integer from 0 to 600", jsonMode);
				}
				style.padding = parsed;
				continue;
			}
			if (flag === "--zoom") {
				const parsed = parseZoomMode(value);
				if (!parsed) {
					return asError("--zoom must be auto, off, or a number from 1 to 4", jsonMode);
				}
				style.zoom = parsed;
				continue;
			}
			if (flag === "--size") {
				const parsed = parseCanvasSize(value);
				if (!parsed) {
					return asError("--size must look like 1920x1080", jsonMode);
				}
				style.canvasWidth = parsed.width;
				style.canvasHeight = parsed.height;
				continue;
			}
			if (flag === "--crop") {
				const parsed = parseCropValue(value);
				if (!parsed) {
					return asError(
						"--crop must be x,y,w,h or WxH+X+Y with width and height at least 16",
						jsonMode,
					);
				}
				style.crop = parsed;
				continue;
			}
			const duration = parseDurationSeconds(value);
			if (duration === null) {
				return asError("--duration must be seconds, e.g. 30, 10s, or 1m", jsonMode);
			}
			durationSeconds = duration;
			continue;
		}

		return asError(
			`Unknown option "${arg}" for record. Run record-bot --help.`,
			json || args.includes("--json"),
		);
	}

	return {
		command: "record",
		json,
		screen,
		displayId,
		window: windowName,
		windowId,
		output,
		rawOutput,
		mic,
		systemAudio,
		micDevice,
		durationSeconds,
		style,
	};
}

export function getCliArgv(
	argv: string[] = process.argv,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const fromEnv = env.RECORD_BOT_CLI?.trim();
	if (fromEnv) {
		return splitCliEnv(fromEnv);
	}
	return argv.slice(2).filter((arg) => arg !== "--");
}

export function splitCliEnv(value: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (quote) {
			if (char === quote) {
				quote = null;
				continue;
			}
			current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (current) {
		tokens.push(current);
	}
	return tokens;
}
