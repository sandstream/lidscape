import AVFoundation
import CoreGraphics
import Foundation
import QuartzCore

// Exercise the real surface and layer deck with controllable frame production.
enum WallpaperContentKind { case video, metalScene }
enum PlaybackPolicy { case full }
enum RenderQuality { case auto }
struct MetalScenePackage { let contentHash: String }

final class TestState: @unchecked Sendable {
    private let lock = NSLock()
    private var started: [MetalSceneRenderer] = []
    private var responses: [String: Bool] = [:]
    func record(_ renderer: MetalSceneRenderer) { lock.lock(); defer { lock.unlock() }; started.append(renderer) }
    func renderers() -> [MetalSceneRenderer] { lock.lock(); defer { lock.unlock() }; return started }
    func response(_ label: String, _ success: Bool) { lock.lock(); defer { lock.unlock() }; responses[label] = success }
    func result(_ label: String) -> Bool? { lock.lock(); defer { lock.unlock() }; return responses[label] }
}
let testState = TestState()

final class MetalSceneRenderer: @unchecked Sendable {
    let displayLayer: AVSampleBufferDisplayLayer
    let debugID: Int
    private var firstFrame: (@Sendable (Bool) -> Void)?
    private let lock = NSLock()
    init(_ layer: AVSampleBufferDisplayLayer, id: Int) { displayLayer = layer; debugID = id }
    static func create(rootLayer: CALayer, package: MetalScenePackage, reusingDisplayLayer: AVSampleBufferDisplayLayer) throws -> MetalSceneRenderer {
        MetalSceneRenderer(reusingDisplayLayer, id: Int(package.contentHash)!)
    }
    func start(onFirstFrameProcessed: (@Sendable (Bool) -> Void)?, requiresVisibleRendering: Bool) {
        lock.lock(); firstFrame = onFirstFrameProcessed; lock.unlock()
        testState.record(self)
    }
    func complete(_ success: Bool) { lock.lock(); let callback = firstFrame; firstFrame = nil; lock.unlock(); callback?(success) }
    func stop(preservingDisplayLayer: Bool) {}
    func setPlaybackRate(_ rate: Double) {}
    func setQuality(_ quality: RenderQuality) {}
    func applyPolicy(_ policy: PlaybackPolicy, animated: Bool) {}
    func resize(to size: CGSize) {}
    func snapshot() -> CGImage? { nil }
}

final class VideoRenderer: @unchecked Sendable {
    var variantSelector: (@Sendable (PlaybackPolicy, CGSize) -> URL)?
    static func create(rootLayer: CALayer, videoURL: URL, stillImage: CGImage?, initialPolicy: PlaybackPolicy, reusingDisplayLayer: AVSampleBufferDisplayLayer) async throws -> VideoRenderer { VideoRenderer() }
    func refreshSource(fallback: URL) {}
}

enum WallpaperRenderer: @unchecked Sendable {
    case video(VideoRenderer), metalScene(MetalSceneRenderer)
    var debugID: Int { if case .metalScene(let renderer) = self { return renderer.debugID }; return 0 }
    var displayLayer: AVSampleBufferDisplayLayer { if case .metalScene(let renderer) = self { return renderer.displayLayer }; fatalError() }
    func updateVariantSelector(_ selector: (@Sendable (PlaybackPolicy, CGSize) -> URL)?) {}
    func start(onFirstFrameProcessed: (@Sendable (Bool) -> Void)?, requiresVisibleRendering: Bool) {
        if case .metalScene(let renderer) = self { renderer.start(onFirstFrameProcessed: onFirstFrameProcessed, requiresVisibleRendering: requiresVisibleRendering) }
    }
    func stop(preservingDisplayLayer: Bool) { if case .metalScene(let renderer) = self { renderer.stop(preservingDisplayLayer: preservingDisplayLayer) } }
    func setPlaybackRate(_ rate: Double) {}
    func setQuality(_ quality: RenderQuality) {}
    func applyPolicy(_ policy: PlaybackPolicy, animated: Bool = false) {}
    func resize(to size: CGSize) {}
    func snapshot() -> CGImage? { nil }
}
func renderLog(_ message: String) {}
func renderTrace(_ message: String) {}

func eventually(_ message: String, _ condition: @escaping @Sendable () -> Bool) async {
    for _ in 0..<300 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    fatalError("Timed out: \(message)")
}

func onRenderQueue(_ action: @escaping @Sendable () -> Void) async {
    await withCheckedContinuation { continuation in
        RenderQueue.serial.async { action(); continuation.resume() }
    }
}

func content(_ id: Int) -> WallpaperContent {
    WallpaperContent(id: "\(id)", kind: .metalScene, resourceURL: URL(fileURLWithPath: "/\(id)"), metalPackage: MetalScenePackage(contentHash: "\(id)"))
}

@main struct WallpaperSurfaceOrderingCheck {
    static func main() async {
        let holder = SurfaceHolder()
        await onRenderQueue {
            let surface = WallpaperSurface(rootLayer: CALayer())
            surface.animatesContentChanges = { false }
            holder.surface = surface
            surface.setContent(content(1)) { testState.response("first", (try? $0.get()) != nil) }
        }
        await eventually("first renderer", { testState.renderers().count == 1 })
        let first = testState.renderers()[0]
        first.complete(true)
        await eventually("first frame", { testState.result("first") == true })

        // A failed replacement must leave the active layer in place and allow the
        // queued request to use the other layer.
        await onRenderQueue {
            holder.surface!.setContent(content(2)) { testState.response("failed", (try? $0.get()) != nil) }
        }
        await eventually("second renderer", { testState.renderers().count == 2 })
        let failed = testState.renderers()[1]
        precondition(failed.displayLayer !== first.displayLayer, "The replacement reused the active layer")
        await onRenderQueue {
            holder.surface!.setContent(content(3)) { testState.response("queued", (try? $0.get()) != nil) }
        }
        failed.complete(false)
        await eventually("failed completion", { testState.result("failed") == false })
        await eventually("queued renderer", { testState.renderers().count == 3 })
        let queued = testState.renderers()[2]
        precondition(queued.displayLayer === failed.displayLayer, "The abandoned layer was not reused")
        queued.complete(true)
        await eventually("queued frame", { testState.result("queued") == true })

        // The retired first layer becomes the next target. A stop invalidates a
        // replacement that has not delivered its first frame.
        await onRenderQueue {
            holder.surface!.setContent(content(4)) { testState.response("stopped", (try? $0.get()) != nil) }
        }
        await eventually("next renderer", { testState.renderers().count == 4 })
        let stopped = testState.renderers()[3]
        precondition(stopped.displayLayer === first.displayLayer, "The retired layer was not reused")
        await onRenderQueue { holder.surface!.stop() }
        stopped.complete(true)
        await eventually("stopped completion", { testState.result("stopped") == false })

        await onRenderQueue {
            holder.surface!.setContent(content(5)) { testState.response("restart", (try? $0.get()) != nil) }
        }
        await eventually("restart renderer", { testState.renderers().count == 5 })
        let restart = testState.renderers()[4]
        restart.complete(true)
        await eventually("restart frame", { testState.result("restart") == true })
        print("Wallpaper surface operation ordering: OK")
    }
}
final class SurfaceHolder: @unchecked Sendable { var surface: WallpaperSurface? }
