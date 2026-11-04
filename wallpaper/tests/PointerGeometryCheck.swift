import CoreGraphics
import Foundation

@main
struct PointerGeometryCheck {
    static func main() {
        let scene = CGSize(width: 1280, height: 720)
        func check(_ point: CGPoint, _ display: CGRect, _ expected: CGPoint) {
            guard let actual = PointerGeometry.normalizedPosition(point, display: display, scene: scene),
                  abs(actual.x - expected.x) < 0.000001,
                  abs(actual.y - expected.y) < 0.000001 else {
                fatalError("Unexpected mapping for \(point): expected \(expected)")
            }
        }
        let normal = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        check(CGPoint(x: 960, y: 540), normal, CGPoint(x: 0.5, y: 0.5))
        check(CGPoint(x: 0, y: 900), normal, CGPoint(x: 0, y: 1.0 / 6.0))
        let portrait = CGRect(x: -1440, y: 100, width: 1440, height: 900)
        check(CGPoint(x: -720, y: 550), portrait, CGPoint(x: 0.5, y: 0.5))
        check(CGPoint(x: -1440, y: 820), portrait, CGPoint(x: 0.05, y: 0.2))
        let wide = CGRect(x: 20, y: -400, width: 2560, height: 1080)
        check(CGPoint(x: 1300, y: 140), wide, CGPoint(x: 0.5, y: 0.5))
        check(CGPoint(x: 20, y: 500), wide, CGPoint(x: 0, y: 0.25))
        guard PointerGeometry.normalizedPosition(CGPoint(x: 3000, y: 100), display: normal, scene: scene) == nil,
              PointerGeometry.normalizedPosition(.zero, display: .zero, scene: scene) == nil,
              PointerGeometry.normalizedPosition(.zero, display: normal, scene: .zero) == nil,
              PointerGeometry.normalizedPosition(CGPoint(x: CGFloat.nan, y: 0), display: normal, scene: scene) == nil,
              PointerGeometry.displayID(layerName: PointerGeometry.layerName(displayID: 42)) == 42,
              PointerGeometry.displayID(layerName: nil) == nil,
              PointerGeometry.displayID(layerName: "lidscape-display-invalid") == nil else {
            fatalError("Invalid geometry or display identifier was accepted")
        }
        print("Wallpaper pointer geometry: OK")
    }
}
