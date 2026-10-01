import CoreGraphics
import Foundation
import ScreenCaptureKit

struct ScreenEntry: Codable {
	let id: String
	let name: String
	let displayId: String
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

struct WindowEntry: Codable {
	let id: String
	let name: String
	let displayId: String
	let app: String?
	let title: String?
	let bundle: String?
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

struct SourceList: Codable {
	let screens: [ScreenEntry]
	let windows: [WindowEntry]
}

enum ListFailure: Error {
	case timedOut
}

func shareableContent(timeoutSeconds: TimeInterval) async throws -> SCShareableContent {
	try await withThrowingTaskGroup(of: SCShareableContent.self) { group in
		group.addTask {
			try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		}
		group.addTask {
			try await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
			throw ListFailure.timedOut
		}
		guard let content = try await group.next() else {
			throw ListFailure.timedOut
		}
		group.cancelAll()
		return content
	}
}

func cleaned(_ value: String?) -> String? {
	guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
		return nil
	}
	return trimmed
}

func listSources() async throws -> SourceList {
	_ = CGMainDisplayID()
	let content = try await shareableContent(timeoutSeconds: 10)
	let mainId = CGMainDisplayID()
	let screens = content.displays
		.sorted { lhs, rhs in
			if lhs.frame.minX != rhs.frame.minX {
				return lhs.frame.minX < rhs.frame.minX
			}
			return lhs.frame.minY < rhs.frame.minY
		}
		.enumerated()
		.map { index, display in
			let primary = display.displayID == mainId
			return ScreenEntry(
				id: "screen:\(display.displayID)",
				name: primary ? "Screen \(index + 1) (Primary)" : "Screen \(index + 1)",
				displayId: String(display.displayID),
				x: display.frame.minX,
				y: display.frame.minY,
				width: display.frame.width,
				height: display.frame.height,
			)
		}

	let ignoredBundles: Set<String> = [
		"com.apple.dock",
		"com.apple.controlcenter",
		"com.apple.WindowManager",
	]

	let windows = content.windows.compactMap { window -> WindowEntry? in
		guard window.windowLayer == 0, window.frame.width >= 64, window.frame.height >= 64 else {
			return nil
		}
		let app = cleaned(window.owningApplication?.applicationName)
		let title = cleaned(window.title)
		let bundle = cleaned(window.owningApplication?.bundleIdentifier)
		if let bundle, ignoredBundles.contains(bundle) {
			return nil
		}
		guard app != nil || title != nil else {
			return nil
		}
		let display = content.displays.first { $0.frame.intersects(window.frame) }
		let label: String
		if let app, let title {
			label = "\(app) — \(title)"
		} else {
			label = title ?? app ?? "Window"
		}
		return WindowEntry(
			id: "window:\(window.windowID)",
			name: label,
			displayId: display.map { String($0.displayID) } ?? "",
			app: app,
			title: title ?? app,
			bundle: bundle,
			x: window.frame.minX,
			y: window.frame.minY,
			width: window.frame.width,
			height: window.frame.height,
		)
	}
	.sorted { lhs, rhs in
		let left = lhs.app ?? lhs.name
		let right = rhs.app ?? rhs.name
		if left.caseInsensitiveCompare(right) != .orderedSame {
			return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
		}
		return (lhs.title ?? lhs.name).localizedCaseInsensitiveCompare(rhs.title ?? rhs.name) ==
			.orderedAscending
	}

	return SourceList(screens: screens, windows: windows)
}

let semaphore = DispatchSemaphore(value: 0)
Task {
	do {
		let list = try await listSources()
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys]
		let data = try encoder.encode(list)
		FileHandle.standardOutput.write(data)
		semaphore.signal()
	} catch {
		let message = error is ListFailure ? "Screen Recording permission timed out." : error.localizedDescription
		fputs("\(message)\n", stderr)
		fflush(stderr)
		exit(1)
	}
}

semaphore.wait()
