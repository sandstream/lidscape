import CoreGraphics

enum PointerGeometry {
    private static let layerPrefix = "lidscape-display-"

    static func layerName(displayID: UInt32) -> String {
        layerPrefix + String(displayID)
    }

    static func displayID(layerName: String?) -> UInt32? {
        guard let layerName, layerName.hasPrefix(layerPrefix) else { return nil }
        return UInt32(layerName.dropFirst(layerPrefix.count))
    }

    // AppKit screen coordinates have their origin at the bottom left. The scene
    // uses a top-left origin and is cropped to fill the display.
    static func normalizedPosition(_ point: CGPoint, display: CGRect, scene: CGSize) -> CGPoint? {
        guard point.x.isFinite, point.y.isFinite,
              display.origin.x.isFinite, display.origin.y.isFinite,
              display.width.isFinite, display.height.isFinite,
              scene.width.isFinite, scene.height.isFinite,
              display.width > 0, display.height > 0, scene.width > 0, scene.height > 0,
              display.contains(point) else { return nil }
        let scale = max(display.width / scene.width, display.height / scene.height)
        let cropX = (scene.width * scale - display.width) / 2
        let cropY = (scene.height * scale - display.height) / 2
        let x = (point.x - display.minX + cropX) / scale / scene.width
        let y = (display.maxY - point.y + cropY) / scale / scene.height
        guard x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y) else { return nil }
        return CGPoint(x: x, y: y)
    }
}
