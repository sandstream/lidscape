import Foundation
import QuartzCore

final class ReplyProbe: @unchecked Sendable {
    var values: [(Any?, (any Error)?)] = []
    func record(_ value: Any?, _ error: (any Error)?) { values.append((value, error)) }
}

@main
struct WallpaperAcquireCancellationCheck {
    static func main() {
        RenderQueue.serial.sync {
            let state = WallpaperState.shared
            let key = DisplayKey(displayID: 66, surfaceUUID: UUID())
            let owner = UUID()
            let surface = WallpaperSurface()
            let context = TestRemoteContext()
            let oldReply = NSObject()
            state.installContext(ActiveWallpaper(caContext: context, contextId: 123,
                rootLayer: CALayer(), surface: surface, displayID: 66, isPreview: false,
                acquisitionOwner: owner), for: key)
            let cancelled = ReplyProbe()
            let gate = WallpaperAcquireReply(state: state, key: key, surface: surface,
                context: context, contextID: 123, owner: owner, replyObject: oldReply,
                reply: cancelled.record)
            surface.onStop = { gate.complete(); gate.complete() }
            precondition(state.tearDownContext(for: key))
            precondition(context.invalidations == 1, "live teardown invalidates the context after stop")
            precondition(cancelled.values.count == 1)
            precondition(cancelled.values[0].0 == nil && cancelled.values[0].1 != nil,
                "a removed context must receive one error, never a successful stale reply")

            let newSurface = WallpaperSurface()
            let newContext = TestRemoteContext()
            let newReply = NSObject()
            state.installContext(ActiveWallpaper(caContext: newContext, contextId: 123,
                rootLayer: CALayer(), surface: newSurface, displayID: 66, isPreview: false,
                acquisitionOwner: owner), for: key)
            gate.complete()
            precondition(cancelled.values.count == 1, "late completion cannot send another reply")
            let valid = ReplyProbe()
            let validGate = WallpaperAcquireReply(state: state, key: key, surface: newSurface,
                context: newContext, contextID: 123, owner: owner, replyObject: newReply,
                reply: valid.record)
            precondition(validGate.complete())
            precondition(!validGate.complete())
            precondition(valid.values.count == 1 && (valid.values[0].0 as AnyObject?) === newReply && valid.values[0].1 == nil)

            let replaced = ReplyProbe()
            let replacedGate = WallpaperAcquireReply(state: state, key: key, surface: newSurface,
                context: newContext, contextID: 123, owner: owner, replyObject: newReply,
                reply: replaced.record)
            newSurface.renderer = WallpaperRenderer()
            let nextOwner = UUID()
            _ = state.restoreHosting(for: key, owner: nextOwner)
            var readySignals = 0
            var assignmentApplied = false
            precondition(!replacedGate.complete(beforeReply: {
                assignmentApplied = state.acceptAssignment(contentID: "city", assignmentRevision: 7,
                    for: key, rendererID: 1)
            }, afterReply: {
                if state.markReady(for: key, surface: newSurface) { readySignals += 1 }
            }))
            precondition(replaced.values.count == 1 && replaced.values[0].0 == nil && replaced.values[0].1 != nil)
            if !assignmentApplied || readySignals != 1 {
                print("FAIL: the new owner did not receive the surface readiness and assignment")
                exit(1)
            }
            precondition(state.context(for: key)?.assignmentRevision == 7)
            _ = replacedGate.complete(afterReply: { readySignals += 1 })
            precondition(readySignals == 1, "duplicate completion cannot repeat the readiness signal")

            let reusedKey = ReplyProbe()
            let reusedGate = WallpaperAcquireReply(state: state, key: key, surface: newSurface,
                context: newContext, contextID: 123, owner: nextOwner, replyObject: newReply,
                reply: reusedKey.record)
            let newerSurface = WallpaperSurface()
            let newerContext = TestRemoteContext()
            state.installContext(ActiveWallpaper(caContext: newerContext, contextId: 123,
                rootLayer: CALayer(), surface: newerSurface, displayID: 66, isPreview: false,
                acquisitionOwner: nextOwner), for: key)
            precondition(!reusedGate.complete(beforeReply: {
                preconditionFailure("an old surface cannot update a replacement")
            }))
            precondition(reusedKey.values.count == 1 && reusedKey.values[0].0 == nil && reusedKey.values[0].1 != nil)

            let reconnected = ReplyProbe()
            let reconnectGate = WallpaperAcquireReply(state: state, key: key, surface: newerSurface,
                context: newerContext, contextID: 123, owner: nextOwner, replyObject: newReply,
                reply: reconnected.record)
            precondition(state.pauseUnhostedSurface(for: key, owner: nextOwner))
            precondition(state.restoreHosting(for: key, owner: nextOwner))
            precondition(!reconnectGate.complete(), "a reconnect must not revive an old acquisition")
            precondition(reconnected.values.count == 1 && reconnected.values[0].0 == nil && reconnected.values[0].1 != nil)

            let reentrant = ReplyProbe()
            let reentrantGate = WallpaperAcquireReply(state: state, key: key, surface: newerSurface,
                context: newerContext, contextID: 123, owner: nextOwner, replyObject: newReply,
                reply: reentrant.record)
            precondition(!reentrantGate.complete(beforeReply: { precondition(state.tearDownContext(for: key)) }))
            precondition(reentrant.values.count == 1 && reentrant.values[0].0 == nil && reentrant.values[0].1 != nil)

            weak var releasedSurface: WallpaperSurface?
            weak var releasedContext: TestRemoteContext?
            let detached = ReplyProbe()
            var detachedGate: WallpaperAcquireReply!
            do {
                let oldSurface = WallpaperSurface()
                let oldContext = TestRemoteContext()
                releasedSurface = oldSurface
                releasedContext = oldContext
                state.installContext(ActiveWallpaper(caContext: oldContext, contextId: 10,
                    rootLayer: CALayer(), surface: oldSurface, displayID: 66, isPreview: false,
                    acquisitionOwner: owner), for: key)
                detachedGate = WallpaperAcquireReply(state: state, key: key, surface: oldSurface,
                    context: oldContext, contextID: 10, owner: owner, replyObject: NSObject(),
                    reply: detached.record)
                state.installContext(ActiveWallpaper(caContext: TestRemoteContext(), contextId: 11,
                    rootLayer: CALayer(), surface: WallpaperSurface(), displayID: 66, isPreview: false,
                    acquisitionOwner: owner), for: key)
            }
            precondition(releasedSurface == nil && releasedContext == nil,
                "a pending reply must not retain a detached surface or context")
            precondition(!detachedGate.complete())
            precondition(detached.values.count == 1 && detached.values[0].0 == nil && detached.values[0].1 != nil)
        }
        print("Acquire replies preserve owner and context after cancellation: OK")
    }
}
