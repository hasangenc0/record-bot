import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

struct CaptureConfig: Codable {
	var fps: Int?
	var display: UInt32?
	var window: UInt32?
	var out: String
	var sys: Bool?
	var mic: Bool?
	var sysFile: String?
	var micId: String?
	var micFile: String?
}

enum CaptureFailure: Error, CustomStringConvertible {
	case badArguments
	case badJSON(String)
	case timedOut
	case noDisplay
	case noWindow
	case writer(String)
	case microphoneDenied

	var description: String {
		switch self {
		case .badArguments:
			return "Usage: capture '<json>'"
		case let .badJSON(detail):
			return "Invalid config JSON: \(detail)"
		case .timedOut:
			return "Screen Recording permission timed out. Grant access to this process and retry."
		case .noDisplay:
			return "No matching display."
		case .noWindow:
			return "No matching window."
		case let .writer(detail):
			return detail
		case .microphoneDenied:
			return "Microphone access denied."
		}
	}
}

final class StopFlag: @unchecked Sendable {
	private let lock = NSLock()
	private var stopped = false

	func requestStop() {
		lock.lock()
		stopped = true
		lock.unlock()
	}

	func isStopped() -> Bool {
		lock.lock()
		defer { lock.unlock() }
		return stopped
	}
}

func even(_ value: Int) -> Int {
	max(2, value - (value % 2))
}

func shareableContent(timeoutSeconds: TimeInterval) async throws -> SCShareableContent {
	try await withThrowingTaskGroup(of: SCShareableContent.self) { group in
		group.addTask {
			try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		}
		group.addTask {
			let ns = UInt64(timeoutSeconds * 1_000_000_000)
			try await Task.sleep(nanoseconds: ns)
			throw CaptureFailure.timedOut
		}
		guard let content = try await group.next() else {
			throw CaptureFailure.timedOut
		}
		group.cancelAll()
		return content
	}
}

func displayScale(_ display: SCDisplay?) -> CGFloat {
	if let display {
		return CGFloat(display.width) / max(display.frame.width, 1)
	}
	let main = CGMainDisplayID()
	let bounds = CGDisplayBounds(main)
	if let mode = CGDisplayCopyDisplayMode(main) {
		let pixelWidth = CGFloat(mode.pixelWidth)
		if pixelWidth > 0, bounds.width > 0 {
			return pixelWidth / bounds.width
		}
	}
	return 2
}

func pickFilter(config: CaptureConfig, content: SCShareableContent) throws -> (SCContentFilter, Int, Int) {
	if let windowId = config.window {
		guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
			throw CaptureFailure.noWindow
		}
		let display = content.displays.first { candidate in
			candidate.frame.intersects(window.frame)
		} ?? content.displays.first
		let scale = displayScale(display)
		let width = even(Int((window.frame.width * scale).rounded()))
		let height = even(Int((window.frame.height * scale).rounded()))
		return (SCContentFilter(desktopIndependentWindow: window), width, height)
	}

	let display: SCDisplay?
	if let displayId = config.display {
		display = content.displays.first(where: { $0.displayID == displayId })
	} else {
		display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first
	}
	guard let display else {
		throw CaptureFailure.noDisplay
	}
	return (
		SCContentFilter(display: display, excludingWindows: []),
		even(display.width),
		even(display.height),
	)
}

func makeVideoWriter(url: URL, width: Int, height: Int, fps: Int) throws -> (AVAssetWriter, AVAssetWriterInput) {
	if FileManager.default.fileExists(atPath: url.path) {
		try FileManager.default.removeItem(at: url)
	}
	let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
	let input = AVAssetWriterInput(
		mediaType: .video,
		outputSettings: [
			AVVideoCodecKey: AVVideoCodecType.h264,
			AVVideoWidthKey: width,
			AVVideoHeightKey: height,
			AVVideoCompressionPropertiesKey: [
				AVVideoAverageBitRateKey: max(2_000_000, width * height * 4),
				AVVideoExpectedSourceFrameRateKey: fps,
			],
		],
	)
	input.expectsMediaDataInRealTime = true
	guard writer.canAdd(input) else {
		throw CaptureFailure.writer("Unable to add video track.")
	}
	writer.add(input)
	return (writer, input)
}

func makeAudioWriter(url: URL) throws -> (AVAssetWriter, AVAssetWriterInput) {
	if FileManager.default.fileExists(atPath: url.path) {
		try FileManager.default.removeItem(at: url)
	}
	let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
	let input = AVAssetWriterInput(
		mediaType: .audio,
		outputSettings: [
			AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
			AVSampleRateKey: 48_000,
			AVNumberOfChannelsKey: 2,
			AVEncoderBitRateKey: 192_000,
		],
	)
	input.expectsMediaDataInRealTime = true
	guard writer.canAdd(input) else {
		throw CaptureFailure.writer("Unable to add system audio track.")
	}
	writer.add(input)
	return (writer, input)
}

func retimed(_ sampleBuffer: CMSampleBuffer, at time: CMTime) -> CMSampleBuffer? {
	var timing = CMSampleTimingInfo(
		duration: CMSampleBufferGetDuration(sampleBuffer),
		presentationTimeStamp: time,
		decodeTimeStamp: .invalid,
	)
	var copy: CMSampleBuffer?
	CMSampleBufferCreateCopyWithNewTiming(
		allocator: kCFAllocatorDefault,
		sampleBuffer: sampleBuffer,
		sampleTimingEntryCount: 1,
		sampleTimingArray: &timing,
		sampleBufferOut: &copy,
	)
	return copy
}

final class StreamWriter: NSObject, SCStreamOutput, SCStreamDelegate {
	let videoWriter: AVAssetWriter
	let videoInput: AVAssetWriterInput
	let adaptor: AVAssetWriterInputPixelBufferAdaptor
	var systemWriter: AVAssetWriter?
	var systemInput: AVAssetWriterInput?
	let stopFlag: StopFlag
	private var sessionStarted = false
	private var frames = 0

	init(
		videoWriter: AVAssetWriter,
		videoInput: AVAssetWriterInput,
		systemWriter: AVAssetWriter?,
		systemInput: AVAssetWriterInput?,
		stopFlag: StopFlag,
		width: Int,
		height: Int
	) {
		self.videoWriter = videoWriter
		self.videoInput = videoInput
		self.systemWriter = systemWriter
		self.systemInput = systemInput
		self.stopFlag = stopFlag
		self.adaptor = AVAssetWriterInputPixelBufferAdaptor(
			assetWriterInput: videoInput,
			sourcePixelBufferAttributes: [
				kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
				kCVPixelBufferWidthKey as String: width,
				kCVPixelBufferHeightKey as String: height,
			],
		)
		super.init()
	}

	func startWriters() throws {
		guard videoWriter.startWriting() else {
			throw CaptureFailure.writer(videoWriter.error?.localizedDescription ?? "Unable to start the video writer.")
		}
		if let systemWriter, !systemWriter.startWriting() {
			throw CaptureFailure.writer(systemWriter.error?.localizedDescription ?? "Unable to start the audio writer.")
		}
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
		guard CMSampleBufferIsValid(sampleBuffer) else {
			return
		}
		let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
		if !sessionStarted {
			sessionStarted = true
			videoWriter.startSession(atSourceTime: time)
			systemWriter?.startSession(atSourceTime: time)
		}
		switch outputType {
		case .screen:
			guard videoInput.isReadyForMoreMediaData,
			      let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
			else {
				return
			}
			if adaptor.append(imageBuffer, withPresentationTime: time) {
				frames += 1
			}
		case .audio:
			guard let systemInput, systemInput.isReadyForMoreMediaData,
			      let copy = retimed(sampleBuffer, at: time)
			else {
				return
			}
			_ = systemInput.append(copy)
		default:
			break
		}
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		fputs("Capture stream stopped: \(error.localizedDescription)\n", stderr)
		stopFlag.requestStop()
	}

	var capturedFrames: Int { frames }
}

func startMicrophone(url: URL) throws -> AVAudioRecorder {
	if FileManager.default.fileExists(atPath: url.path) {
		try FileManager.default.removeItem(at: url)
	}
	let recorder = try AVAudioRecorder(
		url: url,
		settings: [
			AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
			AVSampleRateKey: 48_000,
			AVNumberOfChannelsKey: 1,
			AVEncoderBitRateKey: 128_000,
		],
	)
	guard recorder.record() else {
		throw CaptureFailure.writer("Unable to start microphone recorder.")
	}
	return recorder
}

func requestMicrophone() async -> Bool {
	await withCheckedContinuation { continuation in
		AVCaptureDevice.requestAccess(for: .audio) { granted in
			continuation.resume(returning: granted)
		}
	}
}

var signalSources: [DispatchSourceSignal] = []

func listenForStop(flag: StopFlag) {
	DispatchQueue.global(qos: .utility).async {
		while let line = readLine(strippingNewline: true) {
			if line.lowercased() == "stop" {
				flag.requestStop()
				return
			}
		}
		flag.requestStop()
	}
	for value in [SIGINT, SIGTERM] {
		signal(value, SIG_IGN)
		let source = DispatchSource.makeSignalSource(signal: value, queue: .global(qos: .utility))
		source.setEventHandler {
			flag.requestStop()
		}
		source.resume()
		signalSources.append(source)
	}
}

func runCapture(_ config: CaptureConfig) async throws {
	_ = CGMainDisplayID()
	let fps = max(1, config.fps ?? 60)
	let content = try await shareableContent(timeoutSeconds: 10)
	let (filter, width, height) = try pickFilter(config: config, content: content)
	let outputURL = URL(fileURLWithPath: config.out)
	try FileManager.default.createDirectory(
		at: outputURL.deletingLastPathComponent(),
		withIntermediateDirectories: true,
	)

	let wantsSystem = config.sys == true
	let wantsMic = config.mic == true
	var micRecorder: AVAudioRecorder?
	if wantsMic {
		guard await requestMicrophone() else {
			throw CaptureFailure.microphoneDenied
		}
		guard let micPath = config.micFile else {
			throw CaptureFailure.writer("micFile is required when microphone capture is on.")
		}
		micRecorder = try startMicrophone(url: URL(fileURLWithPath: micPath))
	}

	let (videoWriter, videoInput) = try makeVideoWriter(url: outputURL, width: width, height: height, fps: fps)
	var systemWriter: AVAssetWriter?
	var systemInput: AVAssetWriterInput?
	if wantsSystem {
		guard let systemPath = config.sysFile else {
			throw CaptureFailure.writer("sysFile is required when system audio capture is on.")
		}
		let audio = try makeAudioWriter(url: URL(fileURLWithPath: systemPath))
		systemWriter = audio.0
		systemInput = audio.1
	}

	let stopFlag = StopFlag()
	let writer = StreamWriter(
		videoWriter: videoWriter,
		videoInput: videoInput,
		systemWriter: systemWriter,
		systemInput: systemInput,
		stopFlag: stopFlag,
		width: width,
		height: height
	)
	try writer.startWriters()

	let streamConfig = SCStreamConfiguration()
	streamConfig.width = width
	streamConfig.height = height
	streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
	streamConfig.showsCursor = false
	streamConfig.queueDepth = 8
	streamConfig.pixelFormat = kCVPixelFormatType_32BGRA
	if wantsSystem {
		streamConfig.capturesAudio = true
		if #available(macOS 13.0, *) {
			streamConfig.excludesCurrentProcessAudio = true
		}
	}

	let stream = SCStream(filter: filter, configuration: streamConfig, delegate: writer)
	let videoQueue = DispatchQueue(label: "record-bot.capture.video")
	try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: videoQueue)
	if wantsSystem {
		try stream.addStreamOutput(writer, type: .audio, sampleHandlerQueue: DispatchQueue(label: "record-bot.capture.audio"))
	}

	listenForStop(flag: stopFlag)
	try await stream.startCapture()
	print("ready")
	fflush(stdout)

	while !stopFlag.isStopped() {
		try await Task.sleep(nanoseconds: 50_000_000)
	}

	micRecorder?.stop()
	do {
		try await stream.stopCapture()
	} catch {
		if writer.capturedFrames == 0 {
			throw error
		}
	}
	videoInput.markAsFinished()
	writer.systemInput?.markAsFinished()
	await videoWriter.finishWriting()
	await systemWriter?.finishWriting()

	if writer.capturedFrames == 0 {
		throw CaptureFailure.writer("No video frames were captured.")
	}
	if videoWriter.status == .failed {
		throw CaptureFailure.writer(videoWriter.error?.localizedDescription ?? "Video writer failed.")
	}
	print("wrote \(outputURL.path)")
	fflush(stdout)
}

func loadConfig() throws -> CaptureConfig {
	guard CommandLine.arguments.count >= 2 else {
		throw CaptureFailure.badArguments
	}
	guard let data = CommandLine.arguments[1].data(using: .utf8) else {
		throw CaptureFailure.badJSON("argument is not UTF-8")
	}
	do {
		return try JSONDecoder().decode(CaptureConfig.self, from: data)
	} catch {
		throw CaptureFailure.badJSON(error.localizedDescription)
	}
}

let semaphore = DispatchSemaphore(value: 0)
Task {
	do {
		try await runCapture(loadConfig())
		semaphore.signal()
	} catch {
		let message = (error as? CaptureFailure)?.description ?? error.localizedDescription
		fputs("\(message)\n", stderr)
		fflush(stderr)
		exit(1)
	}
}

semaphore.wait()
