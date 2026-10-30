import AVFoundation
import Foundation
import QuartzCore

final class AcquireProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [(Bool, Bool)] = []
    func reply(_ value: Any?, _ error: (any Error)?) {
        lock.lock(); responses.append((value != nil, error != nil)); lock.unlock()
    }
    var snapshot: [(Bool, Bool)] { lock.lock(); defer { lock.unlock() }; return responses }
}

@main
struct WallpaperRealSurfaceAcquireCheck {
    static func main() async {
        let state = WallpaperState.shared
        let key = DisplayKey(displayID: 66, surfaceUUID: UUID())
        let owner = UUID()
        let probe = AcquireProbe()
        await onRenderQueue {
            let root = CALayer()
            let surface = WallpaperSurface(rootLayer: root)
            let context = NSObject()
            state.installContext(ActiveWallpaper(caContext: context, contextId: 123,
                rootLayer: root, surface: surface, displayID: 66, isPreview: false,
                acquisitionOwner: owner), for: key)
            let gate = WallpaperAcquireReply(state: state, key: key, surface: surface,
                context: context, contextID: 123, owner: owner, replyObject: NSObject(),
                reply: { value, error in probe.reply(value, error) })
            surface.setContent(content(1)) { _ in gate.complete() }
        }
        await eventually("renderer creation", { testState.renderers().count == 1 })
        let renderer = testState.renderers()[0]
        await onRenderQueue { precondition(state.tearDownContext(for: key)) }
        guard probe.snapshot.count == 1 else {
            print("FAIL: surface teardown did not finish the pending acquire")
            exit(1)
        }
        precondition(!probe.snapshot[0].0 && probe.snapshot[0].1,
            "the real surface cancellation must send one error")
        renderer.complete(true)
        try? await Task.sleep(nanoseconds: 100_000_000)
        precondition(probe.snapshot.count == 1, "a late frame must not send a second reply")
        print("Real surface cancellation sends exactly one acquire error: OK")
    }
}
