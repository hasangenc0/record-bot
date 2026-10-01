import AppKit
import CoreGraphics
import Foundation

struct CursorLogConfig: Codable {
	let outputPath: String
	let originX: Double
	let originY: Double
	let width: Double
	let height: Double
}

private let startedAt = Date()
private let writeQueue = DispatchQueue(label: "record-bot.cursor")
private var running = true
private var fileHandle: FileHandle?

private func localPoint(mouse: NSPoint, config: CursorLogConfig) -> (x: Double, y: Double) {
	// NSEvent is Cocoa (Y up). SCWindow.frame / this config is CoreGraphics (Y down).
	let cgY = CGDisplayBounds(CGMainDisplayID()).height - mouse.y
	return (mouse.x - config.originX, cgY - config.originY)
}

struct CursorSample: Codable {
	let t: Double
	let x: Double
	let y: Double
	let buttons: Int
	let cursor: String
}

private func cursorKind() -> String {
	let current = NSCursor.current
	if current == NSCursor.pointingHand {
		return "pointer"
	}
	if current == NSCursor.iBeam || current == NSCursor.iBeamCursorForVerticalLayout {
		return "text"
	}
	return "arrow"
}

private func readHint() -> (cursor: String, buttons: Int)? {
	guard let path = ProcessInfo.processInfo.environment["RECORD_BOT_CURSOR_HINT"], !path.isEmpty else {
		return nil
	}
	guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
		return nil
	}
	let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
	guard let data = trimmed.data(using: .utf8),
	      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
	else {
		return nil
	}
	let cursor = object["cursor"] as? String ?? "arrow"
	let buttons: Int
	if let value = object["buttons"] as? Int {
		buttons = value
	} else if let value = object["buttons"] as? Double {
		buttons = Int(value)
	} else {
		buttons = 0
	}
	return (cursor, buttons)
}

private func appendSample(config: CursorLogConfig) {
	guard let fileHandle else {
		return
	}
	let mouse = NSEvent.mouseLocation
	let point = localPoint(mouse: mouse, config: config)
	let hinted = readHint()
	let sample = CursorSample(
		t: Date().timeIntervalSince(startedAt),
		x: point.x,
		y: point.y,
		buttons: max(Int(NSEvent.pressedMouseButtons), hinted?.buttons ?? 0),
		cursor: hinted?.cursor ?? cursorKind()
	)
	guard var data = try? JSONEncoder().encode(sample) else {
		return
	}
	data.append(contentsOf: [0x0A])
	writeQueue.sync {
		fileHandle.write(data)
	}
}

private func stop() {
	running = false
	writeQueue.sync {
		try? fileHandle?.synchronize()
		try? fileHandle?.close()
		fileHandle = nil
	}
}

guard CommandLine.arguments.count >= 2 else {
	fputs("Missing config JSON\n", stderr)
	fflush(stderr)
	exit(1)
}

guard let configData = CommandLine.arguments[1].data(using: .utf8) else {
	fputs("Invalid config JSON\n", stderr)
	fflush(stderr)
	exit(1)
}

let config: CursorLogConfig
do {
	config = try JSONDecoder().decode(CursorLogConfig.self, from: configData)
} catch {
	fputs("Invalid config JSON: \(error.localizedDescription)\n", stderr)
	fflush(stderr)
	exit(1)
}

FileManager.default.createFile(atPath: config.outputPath, contents: nil)
guard let handle = FileHandle(forWritingAtPath: config.outputPath) else {
	fputs("Unable to write \(config.outputPath)\n", stderr)
	fflush(stderr)
	exit(1)
}

fileHandle = handle

let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
timer.schedule(deadline: .now(), repeating: .milliseconds(16), leeway: .milliseconds(2))
timer.setEventHandler {
	guard running else {
		return
	}
	appendSample(config: config)
}
timer.resume()

DispatchQueue.global(qos: .utility).async {
	while let input = readLine(strippingNewline: true)?.lowercased() {
		if input == "stop" {
			stop()
			break
		}
	}
}

print("Cursor log started")
fflush(stdout)

while running {
	RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}

timer.cancel()
stop()
print("Cursor log stopped")
fflush(stdout)
