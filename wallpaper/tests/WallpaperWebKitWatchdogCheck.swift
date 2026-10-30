import AppKit
import AVFoundation
import Foundation

// The real renderer is compiled unchanged. These stubs prevent the test from
// opening the hardware sensor or reading or writing the user's settings.
struct MetalScenePackage {}
enum RenderQuality {}
struct TestSharedSettings {}
struct TestSharedStore {
    func load() throws -> TestSharedSettings { TestSharedSettings() }
}
struct ProbeOptions {
    static func load(from bundle: Bundle) throws -> Self { Self() }
    var sharedStore: TestSharedStore { TestSharedStore() }
}
struct ProbeSettings: Equatable {
    init() {}
    init(shared: TestSharedSettings) {}
    var script: String {
        let mode = ProcessInfo.processInfo.environment["LIDSCAPE_WATCHDOG_TEST_MODE"] ?? "recover"
        return "window.lidscapeWatchdogTestMode = '\(mode)';"
    }
}
@MainActor final class ProbeLidSensor {
    static let shared = ProbeLidSensor()
    let angle: Int? = nil
    func subscribe() -> UUID { UUID() }
    func unsubscribe(_ token: UUID) {}
}
final class TestEvents: @unchecked Sendable {
    static let shared = TestEvents()
    private let lock = NSLock()
    private var values: [String] = []
    func append(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
    func count(_ fragment: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return values.filter { $0.contains(fragment) }.count
    }
    func clear() { lock.lock(); values.removeAll(); lock.unlock() }
}
func renderLog(_ value: String) { TestEvents.shared.append(value); print(value); fflush(stdout) }

@main
struct WallpaperWebKitWatchdogCheck {
    @MainActor static func wait(_ timeout: TimeInterval, until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        return condition()
    }

    @MainActor static func color(_ image: CGImage?, channel: Int) -> CGFloat {
        guard let image, let bitmap = NSBitmapImageRep(cgImage: image).colorAt(x: 10, y: 10)?.usingColorSpace(.deviceRGB) else { return 0 }
        return channel == 0 ? bitmap.redComponent : channel == 1 ? bitmap.greenComponent : bitmap.blueComponent
    }

    @MainActor static func assertOffscreen() {
        let screens = NSScreen.screens.map(\.frame)
        precondition(!screens.isEmpty, "No screens are available for the offscreen safety check")
        for window in NSApp.windows where window.isVisible {
            precondition(!screens.contains(where: { $0.intersects(window.frame) }), "A test window appeared on a display")
        }
    }

    @MainActor static func start() throws -> MetalSceneRenderer {
        assertOffscreen()
        let root = CALayer()
        root.bounds = CGRect(x: 0, y: 0, width: 1280, height: 720)
        let layer = AVSampleBufferDisplayLayer()
        let renderer = try MetalSceneRenderer.create(rootLayer: root, package: MetalScenePackage(), reusingDisplayLayer: layer)
        let first = TestFirstFrame()
        renderer.start(onFirstFrameProcessed: { ok in first.set(ok) })
        precondition(wait(8) { first.value != nil }, "The first frame timed out")
        precondition(first.value == true, "The first frame failed")
        assertOffscreen()
        return renderer
    }

    @MainActor static func main() throws {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        setenv("LIDSCAPE_WATCHDOG_TEST_MODE", "recover", 1)
        let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")!
        let original = try String(contentsOf: page, encoding: .utf8)
        let renderer = try start()
        precondition(color(renderer.snapshot(), channel: 0) > 0.7, "The first frame was not red")
        let live = original.replacingOccurrences(of: "const liveAfterReload = false", with: "const liveAfterReload = true")
        precondition(live != original, "The test page has no reload marker")
        try live.write(to: page, atomically: true, encoding: .utf8)
        precondition(wait(9) { TestEvents.shared.count("Stale frame; reloading page") >= 1 }, "The stalled page was not reloaded")
        precondition(wait(8) { color(renderer.snapshot(), channel: 1) > 0.7 }, "A fresh green frame did not arrive after reload")
        assertOffscreen()
        let reloads = TestEvents.shared.count("Stale frame; reloading page")
        renderer.applyPolicy(.paused)
        precondition(wait(1) { TestEvents.shared.count("Stopped after") == 0 }, "Renderer stopped unexpectedly")
        _ = wait(3) { false }
        precondition(TestEvents.shared.count("Stale frame; reloading page") == reloads, "The watchdog reloaded while paused")
        renderer.applyPolicy(.full)
        precondition(wait(6) { color(renderer.snapshot(), channel: 2) > 0.7 }, "A fresh blue frame did not arrive after resume")
        renderer.stop()
        precondition(wait(3) { TestEvents.shared.count("Stopped after") >= 1 }, "Renderer did not stop")
        assertOffscreen()
        precondition(NSApp.windows.allSatisfy { !$0.isVisible }, "An offscreen test window remains visible")

        TestEvents.shared.clear()
        setenv("LIDSCAPE_WATCHDOG_TEST_MODE", "always-stall", 1)
        let limited = try start()
        precondition(wait(18) { TestEvents.shared.count("Frame recovery stopped after three attempts") == 1 }, "The retry limit was not reported")
        precondition(TestEvents.shared.count("Stale frame; reloading page") == 3, "The retry limit was not three")
        _ = wait(3.5) { false }
        precondition(TestEvents.shared.count("Stale frame; reloading page") == 3, "An extra reload followed exhaustion")
        precondition(TestEvents.shared.count("Frame recovery stopped after three attempts") == 1, "Exhaustion was reported repeatedly")
        limited.stop()
        precondition(wait(3) { TestEvents.shared.count("Stopped after") >= 1 }, "Renderer did not stop")
        assertOffscreen()
        precondition(NSApp.windows.allSatisfy { !$0.isVisible }, "An offscreen test window remains visible")
        print("Real offscreen WebKit frame watchdog: OK")
    }
}

final class TestFirstFrame: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Bool?
    var value: Bool? { lock.lock(); defer { lock.unlock() }; return stored }
    func set(_ value: Bool) { lock.lock(); stored = value; lock.unlock() }
}
