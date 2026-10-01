/** Shared x264 settings. Capture must keep up with 60 fps; compose is offline. */

export const CAPTURE_VIDEO_ARGS = [
	"-c:v",
	"libx264",
	"-preset",
	"superfast",
	"-crf",
	"12",
	"-pix_fmt",
	"yuv420p",
] as const;

export const STYLE_VIDEO_ARGS = [
	"-c:v",
	"libx264",
	"-preset",
	"medium",
	"-tune",
	"animation",
	"-crf",
	"15",
	"-pix_fmt",
	"yuv420p",
	"-movflags",
	"+faststart",
] as const;
