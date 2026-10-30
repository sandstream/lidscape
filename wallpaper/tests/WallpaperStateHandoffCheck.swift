import Foundation
import QuartzCore

enum PlaybackPolicy: Equatable, Sendable { case full, paused }
final class WallpaperRenderer: @unchecked Sendable { let debugID = 1 }
final class WallpaperSurface: @unchecked Sendable {
    var renderer: WallpaperRenderer?
    var stopCount = 0
    func refreshVideoSource(_ url: URL) {}
    func applyPolicy(_ policy: PlaybackPolicy, animated: Bool = false) {}
    func settle() {}
    func stop() { stopCount += 1 }
}
final class VideoLibrary: @unchecked Sendable {
    static let shared = VideoLibrary()
    func scan() {}
    func videoURL(for id: String) -> URL? { nil }
}
final class WallpaperPrefs: @unchecked Sendable {
    static let shared = WallpaperPrefs()
    func refreshActiveState() {}
}
enum RenderQueue { static let serial = DispatchQueue(label: "test.wallpaper.state") }
func traceLog(_ message: String) {}
func extensionLog(_ message: String) {}
final class TestRemoteContext: NSObject, @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    @objc func invalidate() { lock.lock(); calls += 1; lock.unlock() }
    var invalidations: Int { lock.lock(); defer { lock.unlock() }; return calls }
}

@main
struct WallpaperStateHandoffCheck {
    static func main() {
        let state = WallpaperState.shared
        let oldKey = DisplayKey(displayID: 42, surfaceUUID: UUID())
        let replacementKey = DisplayKey(displayID: 42, surfaceUUID: UUID())
        let oldSurface = WallpaperSurface()
        let replacementSurface = WallpaperSurface()
        let oldContext = TestRemoteContext()
        let replacementContext = TestRemoteContext()
        let owner = UUID()
        state.installContext(ActiveWallpaper(caContext: oldContext, contextId: 1, rootLayer: CALayer(), surface: oldSurface, displayID: 42, isPreview: false, acquisitionOwner: owner), for: oldKey)
        state.installContext(ActiveWallpaper(caContext: replacementContext, contextId: 2, rootLayer: CALayer(), surface: replacementSurface, displayID: 42, isPreview: false, acquisitionOwner: owner), for: replacementKey)
        precondition(!state.markReady(for: replacementKey, surface: oldSurface))
        precondition(state.markReady(for: replacementKey, surface: replacementSurface))
        precondition(state.pauseUnhostedSurface(for: oldKey, owner: owner))
        let lateKey = DisplayKey(displayID: 42, surfaceUUID: UUID())
        let lateSurface = WallpaperSurface()
        state.installContext(ActiveWallpaper(caContext: TestRemoteContext(), contextId: 6, rootLayer: CALayer(), surface: lateSurface, displayID: 42, isPreview: false, acquisitionOwner: owner), for: lateKey)
        precondition(state.pauseUnhostedSurface(for: lateKey, owner: owner))
        precondition(state.markReady(for: lateKey, surface: lateSurface), "the first frame may arrive while unhosted")
        precondition(state.restoreHosting(for: lateKey, owner: owner))
        precondition(state.readyReplacements(for: oldKey).contains { $0.0 == lateKey })
        precondition(state.pauseUnhostedSurface(for: lateKey, owner: owner))
        let previewKey = DisplayKey(displayID: 42, surfaceUUID: UUID())
        let previewSurface = WallpaperSurface()
        state.installContext(ActiveWallpaper(caContext: TestRemoteContext(), contextId: 4, rootLayer: CALayer(), surface: previewSurface, displayID: 42, isPreview: true, acquisitionOwner: owner), for: previewKey)
        precondition(state.markReady(for: previewKey, surface: previewSurface))
        precondition(!state.readyReplacements(for: oldKey).contains { $0.0 == previewKey })
        let otherKey = DisplayKey(displayID: 43, surfaceUUID: UUID())
        let otherSurface = WallpaperSurface()
        state.installContext(ActiveWallpaper(caContext: TestRemoteContext(), contextId: 5, rootLayer: CALayer(), surface: otherSurface, displayID: 43, isPreview: false, acquisitionOwner: owner), for: otherKey)
        precondition(state.markReady(for: otherKey, surface: otherSurface))
        precondition(!state.readyReplacements(for: oldKey).contains { $0.0 == otherKey })
        let generation = state.readyReplacements(for: oldKey).first!.1
        precondition(state.isReadyReplacement(replacementKey, generation: generation, for: oldKey))
        precondition(state.pauseUnhostedSurface(for: replacementKey, owner: owner))
        precondition(state.restoreHosting(for: replacementKey, owner: owner))
        precondition(!state.isReadyReplacement(replacementKey, generation: generation, for: oldKey))
        precondition(state.restoreHosting(for: oldKey, owner: owner))
        precondition(state.readyReplacements(for: oldKey).isEmpty)
        precondition(state.pauseUnhostedSurface(for: oldKey, owner: owner))
        precondition(state.tearDownContext(for: oldKey))
        precondition(oldSurface.stopCount == 1 && oldContext.invalidations == 1)
        let newerSurface = WallpaperSurface()
        let newerContext = TestRemoteContext()
        state.installContext(ActiveWallpaper(caContext: newerContext, contextId: 3, rootLayer: CALayer(), surface: newerSurface, displayID: 42, isPreview: false, acquisitionOwner: owner), for: oldKey)
        precondition(!state.markReady(for: oldKey, surface: oldSurface), "a stale first frame cannot mark the new surface ready")
        precondition(state.context(for: oldKey)?.isReady == false)
        precondition(oldContext.invalidations == 1 && newerContext.invalidations == 0)
        precondition(state.context(for: oldKey)?.surface === newerSurface)
        print("WallpaperState handoff generations and teardown: OK")
    }
}
