import AppKit
import Foundation

// Renders the real macOS system cursors (arrow, pointing hand, I-beam) into
// square RGBA PNGs plus a manifest of hotspots. record-bot overlays these
// sprites in post instead of hand-drawing cursor shapes.
//
// Usage: export-cursors [outputDir] [size]
//   outputDir defaults to assets/cursors
//   size defaults to 128 (px, square master used for bilinear scaling)

// Standard system cursors (arrow, I-beam) only populate their images once
// AppKit is initialised; a plain CLI otherwise sees empty NSImages.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let arguments = CommandLine.arguments
let outputDir = arguments.count > 1 ? arguments[1] : "assets/cursors"
let size = arguments.count > 2 ? (Int(arguments[2]) ?? 128) : 128

let cursors: [(name: String, cursor: NSCursor)] = [
	("arrow", .arrow),
	("pointer", .pointingHand),
	("text", .iBeam),
]

// Uniform points->pixels factor so every cursor keeps its real relative size.
// The largest cursor is scaled to fill the master canvas.
let maxDimension = cursors
	.map { max($0.cursor.image.size.width, $0.cursor.image.size.height) }
	.max() ?? 32
let factor = CGFloat(size) / maxDimension

struct Entry {
	let name: String
	let file: String
	let hotspotX: Int
	let hotspotY: Int
}

func renderPng(_ image: NSImage, into pixels: Int) -> Data? {
	guard
		let rep = NSBitmapImageRep(
			bitmapDataPlanes: nil,
			pixelsWide: pixels,
			pixelsHigh: pixels,
			bitsPerSample: 8,
			samplesPerPixel: 4,
			hasAlpha: true,
			isPlanar: false,
			colorSpaceName: .calibratedRGB,
			bytesPerRow: 0,
			bitsPerPixel: 0
		)
	else {
		return nil
	}
	rep.size = NSSize(width: pixels, height: pixels)
	NSGraphicsContext.saveGraphicsState()
	guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
		NSGraphicsContext.restoreGraphicsState()
		return nil
	}
	NSGraphicsContext.current = context
	context.imageInterpolation = .high
	// The bitmap origin is bottom-left; draw the cursor anchored to the top-left
	// so hotspots computed in top-left space line up.
	let drawWidth = image.size.width * factor
	let drawHeight = image.size.height * factor
	let rect = NSRect(
		x: 0,
		y: CGFloat(pixels) - drawHeight,
		width: drawWidth,
		height: drawHeight
	)
	image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1.0)
	context.flushGraphics()
	NSGraphicsContext.restoreGraphicsState()
	return rep.representation(using: .png, properties: [:])
}

let manager = FileManager.default
try? manager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

var entries: [Entry] = []
for item in cursors {
	guard let data = renderPng(item.cursor.image, into: size) else {
		fputs("Failed to render \(item.name)\n", stderr)
		exit(1)
	}
	let file = "\(item.name).png"
	let path = (outputDir as NSString).appendingPathComponent(file)
	do {
		try data.write(to: URL(fileURLWithPath: path))
	} catch {
		fputs("Failed to write \(path): \(error)\n", stderr)
		exit(1)
	}
	let hotspot = item.cursor.hotSpot
	entries.append(
		Entry(
			name: item.name,
			file: file,
			hotspotX: Int((hotspot.x * factor).rounded()),
			hotspotY: Int((hotspot.y * factor).rounded())
		)
	)
	print("wrote \(path) hotspot=(\(Int((hotspot.x * factor).rounded())),\(Int((hotspot.y * factor).rounded())))")
}

var json = "{\n"
json += "  \"_notice\": \"Regenerated from the local macOS system cursors via `make cursors`. Redistributors should regenerate or substitute an open-licensed cursor set.\",\n"
json += "  \"size\": \(size),\n"
json += "  \"cursors\": {\n"
for (index, entry) in entries.enumerated() {
	let comma = index == entries.count - 1 ? "" : ","
	json += "    \"\(entry.name)\": { \"file\": \"\(entry.file)\", \"hotspot\": { \"x\": \(entry.hotspotX), \"y\": \(entry.hotspotY) } }\(comma)\n"
}
json += "  }\n"
json += "}\n"

let manifestPath = (outputDir as NSString).appendingPathComponent("cursors.json")
do {
	try json.write(to: URL(fileURLWithPath: manifestPath), atomically: true, encoding: .utf8)
	print("wrote \(manifestPath)")
} catch {
	fputs("Failed to write manifest: \(error)\n", stderr)
	exit(1)
}
