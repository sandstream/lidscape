import Foundation

/// Finishes one asynchronous acquire on the lifecycle queue.
final class WallpaperAcquireReply: @unchecked Sendable {
    private let state: WallpaperState
    private let key: DisplayKey
    private weak var surface: WallpaperSurface?
    private weak var context: AnyObject?
    private let contextID: UInt32
    private let owner: UUID
    private let hostingGeneration: UUID?
    private let replyObject: AnyObject
    private let lock = NSLock()
    private var reply: (@Sendable (Any?, (any Error)?) -> Void)?

    init(state: WallpaperState, key: DisplayKey, surface: WallpaperSurface,
         context: AnyObject, contextID: UInt32, owner: UUID, replyObject: AnyObject,
         reply: @escaping @Sendable (Any?, (any Error)?) -> Void) {
        self.state = state
        self.key = key
        self.surface = surface
        self.context = context
        self.contextID = contextID
        self.owner = owner
        self.hostingGeneration = state.context(for: key)?.hostingGeneration
        self.replyObject = replyObject
        self.reply = reply
    }

    @discardableResult
    func complete(beforeReply: () -> Void = {}, afterReply: () -> Void = {}) -> Bool {
        dispatchPrecondition(condition: .onQueue(RenderQueue.serial))
        lock.lock()
        let callback = reply
        reply = nil
        lock.unlock()
        guard let callback else { return false }
        defer { afterReply() }
        if surfaceIsCurrent() { beforeReply() }
        guard contextIsCurrent() else {
            callback(nil, NSError(domain: "DriftwoodWallpaperExtension", code: 5,
                                  userInfo: [NSLocalizedDescriptionKey: "The wallpaper acquisition was cancelled."]))
            return false
        }
        callback(replyObject, nil)
        return true
    }

    private func surfaceIsCurrent() -> Bool {
        guard let surface, let context, let current = state.context(for: key) else { return false }
        return current.surface === surface && current.caContext === context && current.contextId == contextID
    }

    private func contextIsCurrent() -> Bool {
        guard let surface, let context, let current = state.context(for: key), current.isHosted else { return false }
        return current.acquisitionOwner == owner && current.hostingGeneration == hostingGeneration
            && current.surface === surface
            && current.caContext === context && current.contextId == contextID
    }
}
