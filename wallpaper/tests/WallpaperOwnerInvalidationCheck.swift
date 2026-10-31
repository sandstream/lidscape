import Foundation
import QuartzCore

enum PlaybackPolicy: Equatable, Sendable { case full, paused }
final class WallpaperRenderer: @unchecked Sendable { let debugID = 1 }
final class WallpaperSurface: @unchecked Sendable {
    var renderer: WallpaperRenderer?
    private(set) var pauses = 0
    func refreshVideoSource(_ url: URL) {}
    func applyPolicy(_ policy: PlaybackPolicy, animated: Bool = false) { if policy == .paused { pauses += 1 } }
    func settle() {}
    func stop() {}
    func invalidate(_ completion: @escaping @Sendable () -> Void) { completion() }
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
enum RenderQueue { static let serial = DispatchQueue(label: "test.wallpaper.owner") }
func traceLog(_ message: String) {}
func extensionLog(_ message: String) {}

@main
struct WallpaperOwnerInvalidationCheck {
    static func main() {
        let state = WallpaperState.shared
        let uuid = UUID()
        let key = DisplayKey(displayID: 55, surfaceUUID: uuid)
        let firstOwner = UUID()
        let secondOwner = UUID()
        let surface = WallpaperSurface()
        state.installContext(ActiveWallpaper(caContext: NSObject(), contextId: 99,
            rootLayer: CALayer(), surface: surface, displayID: 55, isPreview: false,
            acquisitionOwner: firstOwner), for: key)
        state.registerWallpaperID(uuid, key: key)
        precondition(state.isHosted(key, by: firstOwner))
        _ = state.restoreHosting(for: key, owner: secondOwner)
        precondition(state.resolveWallpaperKey(uuid) == key)
        precondition(!state.pauseUnhostedSurface(for: key, owner: firstOwner), "a stale owner must not pause the current owner's surface")
        precondition(state.isHosted(key, by: secondOwner) && surface.pauses == 0)
        precondition(state.resolveWallpaperKey(uuid) == key)
        precondition(!state.pauseUnhostedSurface(for: key, owner: UUID()))
        precondition(state.pauseUnhostedSurface(for: key, owner: secondOwner))
        precondition(!state.isHosted(key, by: secondOwner) && surface.pauses == 1)
        precondition(!state.pauseUnhostedSurface(for: key, owner: secondOwner))
        precondition(state.restoreHosting(for: key, owner: firstOwner))
        precondition(!state.pauseUnhostedSurface(for: key, owner: secondOwner))
        precondition(state.isHosted(key, by: firstOwner) && surface.pauses == 1)
        precondition(state.pauseUnhostedSurface(for: key, owner: firstOwner))
        precondition(surface.pauses == 2)
        print("Wallpaper owner invalidation: OK")
    }
}
