export type CaptureSource = {
	id: string;
	name: string;
	displayId?: string;
	sourceType: "screen" | "window";
	appName?: string;
	windowTitle?: string;
	bundleId?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type RecordingResult = {
	success: boolean;
	path?: string;
	message?: string;
	error?: string;
};
