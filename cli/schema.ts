import {
	DEFAULT_BACKGROUND_COLOR,
	DEFAULT_CANVAS_HEIGHT,
	DEFAULT_CANVAS_WIDTH,
	DEFAULT_MAX_ZOOM,
	DEFAULT_PADDING,
} from "./style.ts";

export type SchemaValueType = "boolean" | "integer" | "number" | "string";

export type SchemaFlag = {
	name: string;
	aliases?: string[];
	type: SchemaValueType;
	format?: string;
	value?: string;
	required: boolean;
	default?: string | number | boolean | null;
	enum?: Array<string | number>;
	minimum?: number;
	maximum?: number;
	pattern?: string;
	description: string;
	examples?: string[];
};

export type SchemaJsonShape = {
	description: string;
	properties: Record<string, unknown>;
};

export type SchemaCommand = {
	name: string;
	aliases?: string[];
	description: string;
	usage: string[];
	flags: SchemaFlag[];
	success: SchemaJsonShape;
	failure: SchemaJsonShape;
};

export type CliSchema = {
	ok: true;
	name: "record-bot";
	version: string;
	contract: {
		exit: { success: 0; failure: 1 };
		stdout: string;
		stderr: string;
		json: string;
		signals: string[];
		env: SchemaFlag[];
	};
	types: Record<string, unknown>;
	commands: SchemaCommand[];
};

const JSON_FLAG: SchemaFlag = {
	name: "--json",
	type: "boolean",
	required: false,
	default: false,
	description: "Print exactly one JSON object to stdout. Logs go to stderr.",
};

const SOURCE_OBJECT = {
	type: "object",
	properties: {
		id: { type: "string", examples: ["screen:1", "window:123"] },
		name: { type: "string" },
		displayId: { type: ["string", "null"] },
		sourceType: { enum: ["screen", "window"] },
		appName: { type: ["string", "null"] },
		windowTitle: { type: ["string", "null"] },
		bundleId: { type: ["string", "null"] },
	},
	required: ["id", "name", "displayId", "sourceType", "appName", "windowTitle", "bundleId"],
};

const STYLE_SUMMARY = {
	type: "object",
	properties: {
		padding: { type: "integer" },
		background: { type: "string", description: "Hex color like #1a1a24, or an image path" },
		zoom: { type: "string", examples: ["off", "auto:1.7"] },
		cursor: { type: "boolean" },
		size: { type: "string", examples: ["1920x1080"] },
		crop: {
			type: ["string", "null"],
			description: "x,y,w,h when --crop was set",
			examples: ["120,80,1280,720"],
		},
	},
	required: ["padding", "background", "zoom", "cursor", "size", "crop"],
};

const FAILURE_SHAPE: SchemaJsonShape = {
	description: "Failure. Exit code 1. One JSON object when --json.",
	properties: {
		ok: { const: false },
		error: { type: "string" },
		details: { type: "string" },
		rawPath: {
			type: "string",
			description: "Present when capture succeeded but compose failed",
		},
		sidecars: { type: "array", items: { type: "string" } },
	},
};

function sourcesCommand(): SchemaCommand {
	return {
		name: "sources",
		aliases: ["list"],
		description: "List screens and windows that record can target.",
		usage: [
			"record-bot sources --json",
			"record-bot sources --screens",
			"record-bot sources --windows",
		],
		flags: [
			JSON_FLAG,
			{
				name: "--screens",
				type: "boolean",
				required: false,
				default: true,
				description:
					"Include screens. If neither --screens nor --windows is passed, both are listed.",
			},
			{
				name: "--windows",
				type: "boolean",
				required: false,
				default: true,
				description:
					"Include windows. If neither --screens nor --windows is passed, both are listed.",
			},
		],
		success: {
			description: "Exit 0. With --json, one object on stdout.",
			properties: {
				ok: { const: true },
				sources: { type: "array", items: SOURCE_OBJECT },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function recordCommand(): SchemaCommand {
	return {
		name: "record",
		description:
			"Capture a screen or window. By default -o is a styled MP4; the raw file is saved beside it.",
		usage: [
			"record-bot record --screen 1 -o /tmp/demo.mp4 --duration 10 --json",
			"record-bot record --window Safari --window-id 123 -o /tmp/demo.mp4 --duration 30 --json",
			"record-bot record --screen 1 -o /tmp/demo.mp4 --duration 10 --no-style --json",
		],
		flags: [
			JSON_FLAG,
			{
				name: "--screen",
				type: "integer",
				value: "<n>",
				required: false,
				minimum: 1,
				description: "1-based screen index from `record-bot sources` (screens only).",
				examples: ["1"],
			},
			{
				name: "--display-id",
				type: "string",
				format: "display-id",
				value: "<id>",
				required: false,
				description: "Raw display id from sources[].displayId.",
			},
			{
				name: "--window",
				type: "string",
				value: "<name>",
				required: false,
				description:
					"Substring match on window app or title. If several match, pass --window-id.",
			},
			{
				name: "--window-id",
				type: "string",
				format: "window-id",
				value: "<id>",
				required: false,
				description: "Raw window id, with or without the window: prefix.",
				examples: ["123", "window:123"],
			},
			{
				name: "--output",
				aliases: ["-o"],
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description:
					"Styled MP4 path, or the raw capture when --no-style. Default ./recording-<timestamp>.mp4. Agents should pass an absolute path.",
			},
			{
				name: "--raw-output",
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description:
					"Raw capture path. Default is <output> with .raw inserted before the extension.",
			},
			{
				name: "--duration",
				aliases: ["-d"],
				type: "string",
				format: "duration",
				value: "<duration>",
				required: false,
				pattern: "^(\\d+(\\.\\d+)?)(ms|[sm])?$",
				description:
					"Stop after this long. Bare numbers are seconds. Also 10s, 500ms, or 1m. Agents should always pass this unless they send SIGINT/SIGTERM.",
				examples: ["10", "10s", "500ms", "1m"],
			},
			{
				name: "--mic",
				type: "boolean",
				required: false,
				default: false,
				description: "Capture the microphone. Audio is a sidecar next to the raw MP4.",
			},
			{
				name: "--system-audio",
				type: "boolean",
				required: false,
				default: false,
				description: "Capture system audio (macOS). Audio is a sidecar next to the raw MP4.",
			},
			{
				name: "--mic-device",
				type: "string",
				value: "<id>",
				required: false,
				description: "Microphone device id or label. Implies --mic.",
			},
			{
				name: "--no-style",
				type: "boolean",
				required: false,
				default: false,
				description:
					"Skip compose. -o is the raw capture. Crop, zoom, padding, and cursor are ignored.",
			},
			{
				name: "--styled",
				type: "boolean",
				required: false,
				default: true,
				description: "Compose a styled MP4 (the default). Opposite of --no-style.",
			},
			{
				name: "--background",
				type: "string",
				format: "color-or-path",
				value: "<color|path>",
				required: false,
				default: `#${DEFAULT_BACKGROUND_COLOR}`,
				description: "Canvas fill: #hex, black, white, or an image path.",
				examples: ["#1a1a24", "black", "/tmp/wall.jpg"],
			},
			{
				name: "--padding",
				type: "integer",
				value: "<px>",
				required: false,
				default: DEFAULT_PADDING,
				minimum: 0,
				maximum: 600,
				description: "Margin in pixels around the capture on the styled canvas.",
			},
			{
				name: "--zoom",
				type: "string",
				value: "<auto|off|n>",
				required: false,
				default: "auto",
				description: `Cursor-follow zoom. auto uses max ${DEFAULT_MAX_ZOOM}. A number from 1 to 4 sets the max (1 means off).`,
				examples: ["auto", "off", "1.7", "2"],
			},
			{
				name: "--cursor",
				type: "boolean",
				required: false,
				default: true,
				description: "Draw a pointer on the styled video.",
			},
			{
				name: "--no-cursor",
				type: "boolean",
				required: false,
				default: false,
				description: "Do not draw a pointer. Overrides --cursor.",
			},
			{
				name: "--size",
				type: "string",
				format: "size",
				value: "<WxH>",
				required: false,
				default: `${DEFAULT_CANVAS_WIDTH}x${DEFAULT_CANVAS_HEIGHT}`,
				pattern: "^\\d+x\\d+$",
				description: "Styled canvas size. Minimum 16x16.",
				examples: ["1920x1080", "1280x720"],
			},
			{
				name: "--crop",
				type: "string",
				format: "crop",
				value: "<x,y,w,h>",
				required: false,
				default: null,
				pattern: "^(\\d+,\\d+,\\d+,\\d+|\\d+x\\d+\\+\\d+\\+\\d+)$",
				description:
					"Keep this rectangle of the raw capture in the styled MP4. Pixels: x,y,w,h or WxH+X+Y. Width and height at least 16. Clamped to the frame. Ignored with --no-style.",
				examples: ["120,80,1280,720", "1280x720+120+80"],
			},
		],
		success: {
			description:
				"Exit 0. With --json, one object. path is the styled file unless --no-style, in which case path is the raw capture.",
			properties: {
				ok: { const: true },
				path: { type: "string", format: "path" },
				rawPath: {
					type: "string",
					format: "path",
					description: "Unstyled capture. Omitted when --no-style (path is the raw file).",
				},
				sidecars: {
					type: "array",
					items: { type: "string", format: "path" },
					description: "Audio and cursor logs next to the raw file.",
				},
				durationMs: { type: "integer", minimum: 0 },
				source: SOURCE_OBJECT,
				style: STYLE_SUMMARY,
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function voiceoverCommand(): SchemaCommand {
	return {
		name: "voiceover",
		description:
			"Generate a WAV voiceover with F5-TTS. First run installs the TTS environment if needed. Uses a bundled English voice unless --ref-audio is set.",
		usage: [
			'record-bot voiceover --text "Hello from record-bot." -o /tmp/vo.wav --json',
			'record-bot voiceover --text-file script.txt --ref-audio voice.wav --ref-text "Transcript of the sample." -o /tmp/vo.wav --json',
		],
		flags: [
			JSON_FLAG,
			{
				name: "--text",
				type: "string",
				value: "<words>",
				required: false,
				description: "Words to speak. Required unless --text-file is set.",
			},
			{
				name: "--text-file",
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description: "UTF-8 file of words to speak. Overrides --text.",
			},
			{
				name: "--ref-audio",
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description:
					"Voice sample, ideally a clean mono clip under 12s with a short silence at the end. Defaults to the bundled English example.",
			},
			{
				name: "--ref-text",
				type: "string",
				value: "<words>",
				required: false,
				description:
					"Exact transcript of --ref-audio. Empty string runs ASR (extra memory). The bundled sample uses a known transcript.",
			},
			{
				name: "--output",
				aliases: ["-o"],
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description:
					"WAV path. Default ./voiceover-<timestamp>.wav. Agents should pass an absolute path.",
			},
			{
				name: "--model",
				type: "string",
				value: "<name>",
				required: false,
				default: "F5TTS_v1_Base",
				description: "F5-TTS checkpoint name.",
				examples: ["F5TTS_v1_Base", "F5TTS_Base", "E2TTS_Base"],
			},
			{
				name: "--speed",
				type: "number",
				value: "<n>",
				required: false,
				default: 1,
				minimum: 0.5,
				maximum: 2,
				description: "Speaking rate.",
			},
			{
				name: "--seed",
				type: "integer",
				value: "<n>",
				required: false,
				minimum: 0,
				description: "Reproducible generation seed.",
			},
			{
				name: "--nfe-step",
				type: "integer",
				value: "<n>",
				required: false,
				default: 32,
				minimum: 4,
				maximum: 128,
				description: "Denoising steps. Higher is slower and often clearer.",
			},
			{
				name: "--remove-silence",
				type: "boolean",
				required: false,
				default: false,
				description: "Trim long silences from the generated WAV.",
			},
		],
		success: {
			description: "Exit 0. With --json, one object on stdout.",
			properties: {
				ok: { const: true },
				path: { type: "string", format: "path" },
				sampleRate: { type: "integer" },
				durationMs: { type: "integer", minimum: 0 },
				model: { type: "string" },
				device: { type: "string", examples: ["mps", "cuda", "cpu"] },
				seed: { type: "integer" },
				refAudio: { type: "string", format: "path" },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function muxCommand(): SchemaCommand {
	return {
		name: "mux",
		description:
			"Overlay audio (usually a voiceover WAV) onto a recorded MP4. Default length is delay plus audio duration; shorter video is padded by cloning the last frame.",
		usage: [
			"record-bot mux --video /tmp/demo.mp4 --audio /tmp/vo.wav -o /tmp/demo.narrated.mp4 --json",
			"record-bot mux --video /tmp/demo.mp4 --audio /tmp/vo.wav -o /tmp/out.mp4 --delay 500ms --json",
		],
		flags: [
			JSON_FLAG,
			{
				name: "--video",
				type: "string",
				format: "path",
				value: "<path>",
				required: true,
				description: "Recorded MP4, usually the styled file from record.",
			},
			{
				name: "--audio",
				type: "string",
				format: "path",
				value: "<path>",
				required: true,
				description: "Audio to overlay, usually the WAV from voiceover.",
			},
			{
				name: "--output",
				aliases: ["-o"],
				type: "string",
				format: "path",
				value: "<path>",
				required: false,
				description:
					"Muxed MP4 path. Default ./mux-<timestamp>.mp4. Agents should pass an absolute path.",
			},
			{
				name: "--delay",
				type: "string",
				format: "duration",
				value: "<duration>",
				required: false,
				default: 0,
				pattern: "^(\\d+(\\.\\d+)?)(ms|[sm])?$",
				description:
					"Silence before the audio starts. Bare numbers are seconds. Also 500ms or 0.5s.",
				examples: ["0.5", "500ms", "1s"],
			},
			{
				name: "--duration",
				aliases: ["-d"],
				type: "string",
				format: "duration",
				value: "<duration>",
				required: false,
				pattern: "^(\\d+(\\.\\d+)?)(ms|[sm])?$",
				description:
					"Output length. Default is --delay plus the audio duration. Must be longer than --delay.",
				examples: ["15", "15s", "15510ms"],
			},
		],
		success: {
			description: "Exit 0. With --json, one object on stdout.",
			properties: {
				ok: { const: true },
				path: { type: "string", format: "path" },
				videoPath: { type: "string", format: "path" },
				audioPath: { type: "string", format: "path" },
				delayMs: { type: "integer", minimum: 0 },
				durationMs: { type: "integer", minimum: 0 },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function installTtsCommand(): SchemaCommand {
	return {
		name: "install-tts",
		aliases: ["tts"],
		description:
			"Install F5-TTS into the user data directory. Use this to preinstall on a VM or image; voiceover also installs on first use. Downloads model weights unless --skip-weights.",
		usage: ["record-bot install-tts --json", "record-bot install-tts --skip-weights --json"],
		flags: [
			JSON_FLAG,
			{
				name: "--skip-weights",
				type: "boolean",
				required: false,
				default: false,
				description: "Install the Python env only; do not download the ~1.3GB model.",
			},
		],
		success: {
			description: "Exit 0. With --json, one object on stdout.",
			properties: {
				ok: { const: true },
				pythonPath: { type: "string", format: "path" },
				ttsDir: { type: "string", format: "path" },
				reused: { type: "boolean", description: "true if the env was already installed" },
				weights: { type: "boolean", description: "true if default model weights are present" },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function skillCommand(): SchemaCommand {
	return {
		name: "skill",
		description:
			"Print the agent playbook shipped with this install. Agents should run this before record, voiceover, or mux.",
		usage: ["record-bot skill --json", "record-bot skill"],
		flags: [JSON_FLAG],
		success: {
			description: "Exit 0. With --json, one object on stdout.",
			properties: {
				ok: { const: true },
				name: { const: "record-bot" },
				skill: { type: "string", description: "SKILL.md markdown" },
				pitfalls: { type: "string", description: "Extra failure notes, markdown" },
				path: { type: "string", format: "path" },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

function schemaCommand(): SchemaCommand {
	return {
		name: "schema",
		description: "Print this catalog. Always one JSON object on stdout; --json is optional.",
		usage: ["record-bot schema --json", "record-bot schema"],
		flags: [
			{
				...JSON_FLAG,
				default: true,
				description: "Accepted and recommended. schema always prints JSON.",
			},
		],
		success: {
			description: "Exit 0. This document.",
			properties: {
				ok: { const: true },
				name: { const: "record-bot" },
				version: { type: "string" },
				contract: { type: "object" },
				types: { type: "object" },
				commands: { type: "array" },
			},
		},
		failure: FAILURE_SHAPE,
	};
}

export function cliSchema(version: string): CliSchema {
	return {
		ok: true,
		name: "record-bot",
		version,
		contract: {
			exit: { success: 0, failure: 1 },
			stdout: "Results only. With --json (and for schema), exactly one JSON object.",
			stderr: "Logs and human status. Do not parse stderr.",
			json: "Pass --json. Agents should run `record-bot skill --json` then `record-bot schema --json`. Pass --duration and an absolute -o for record, an absolute -o for voiceover, and --video/--audio with an absolute -o for mux.",
			signals: ["SIGINT", "SIGTERM"],
			env: [
				{
					name: "RECORD_BOT_CLI",
					type: "string",
					required: false,
					description: "If set, used as the full argv instead of process arguments.",
					examples: ["record --screen 1 -o /tmp/demo.mp4 --duration 10 --json"],
				},
				{
					name: "RECORD_BOT_ROOT",
					type: "string",
					format: "path",
					required: false,
					description:
						"Install root that contains helpers/, skills/, and python/ next to the binary.",
				},
				{
					name: "RECORD_BOT_FFMPEG",
					type: "string",
					format: "path",
					required: false,
					description: "Absolute path to an ffmpeg binary.",
				},
				{
					name: "RECORD_BOT_F5TTS_PYTHON",
					type: "string",
					format: "path",
					required: false,
					description:
						"Optional. Python with f5-tts. If unset, record-bot installs F5-TTS into the user data directory on first voiceover.",
				},
				{
					name: "RECORD_BOT_TTS_DIR",
					type: "string",
					format: "path",
					required: false,
					description: "Directory for the managed F5-TTS virtualenv. Default: <user-data>/tts.",
				},
				{
					name: "RECORD_BOT_SSL_CERT_FILE",
					type: "string",
					format: "path",
					required: false,
					description:
						"CA bundle for F5-TTS model downloads. Also honors SSL_CERT_FILE, REQUESTS_CA_BUNDLE, and NODE_EXTRA_CA_CERTS.",
				},
			],
		},
		types: {
			source: SOURCE_OBJECT,
			style: STYLE_SUMMARY,
			crop: {
				type: "string",
				description: "Raw-video pixels as x,y,w,h or WxH+X+Y",
			},
			duration: {
				type: "string",
				description: "Seconds, or a number with ms, s, or m suffix",
			},
		},
		commands: [
			sourcesCommand(),
			recordCommand(),
			voiceoverCommand(),
			installTtsCommand(),
			muxCommand(),
			skillCommand(),
			schemaCommand(),
		],
	};
}

export function schemaFlagNames(commandName: string): string[] {
	const command = cliSchema("0").commands.find((entry) => entry.name === commandName);
	if (!command) {
		return [];
	}
	return command.flags.flatMap((flag) => [flag.name, ...(flag.aliases ?? [])]);
}
