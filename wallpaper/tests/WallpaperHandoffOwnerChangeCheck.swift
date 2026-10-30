import Foundation
import QuartzCore

@main
struct WallpaperHandoffOwnerChangeCheck {
    static func main() {
        let state = WallpaperState.shared
        let oldKey = DisplayKey(displayID: 56, surfaceUUID: UUID())
        let nextKey = DisplayKey(displayID: 56, surfaceUUID: UUID())
        let firstOwner = UUID()
        let nextOwner = UUID()
        let oldSurface = WallpaperSurface()
        let nextSurface = WallpaperSurface()
        state.installContext(ActiveWallpaper(caContext: NSObject(), contextId: 1, rootLayer: CALayer(), surface: oldSurface, displayID: 56, isPreview: false, acquisitionOwner: firstOwner), for: oldKey)
        state.installContext(ActiveWallpaper(caContext: NSObject(), contextId: 2, rootLayer: CALayer(), surface: nextSurface, displayID: 56, isPreview: false, acquisitionOwner: firstOwner), for: nextKey)
        precondition(state.markReady(for: nextKey, surface: nextSurface))
        precondition(state.pauseUnhostedSurface(for: oldKey, owner: firstOwner))
        let oldGeneration = state.readyReplacements(for: oldKey).first!.1
        let oldTimer = { state.isReadyReplacement(nextKey, generation: oldGeneration, for: oldKey) }
        precondition(oldTimer())
        _ = state.restoreHosting(for: nextKey, owner: nextOwner)
        precondition(!oldTimer(), "the old owner's pending timer must not retire the prior surface after takeover")
        let newGeneration = state.readyReplacements(for: oldKey).first!.1
        precondition(newGeneration != oldGeneration)
        precondition(state.isReadyReplacement(nextKey, generation: newGeneration, for: oldKey))
        _ = state.restoreHosting(for: nextKey, owner: nextOwner)
        precondition(state.isReadyReplacement(nextKey, generation: newGeneration, for: oldKey))
        print("Wallpaper handoff owner change: OK")
    }
}
