import CryptoKit
import Foundation

/// Send one Settings reply even if timeout and refresh finish together.
final class SettingsRefreshReply: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: (@Sendable () -> Void)?

    init(_ callback: @escaping @Sendable () -> Void) { pending = callback }

    func finish() {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            let result = pending
            pending = nil
            return result
        }
        callback?()
    }
}

/// Share one refresh until its work completes, even if individual replies time out.
final class SettingsRefreshCoordinator: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UUID?
    private var replies: [UUID: SettingsRefreshReply] = [:]

    func join(_ reply: SettingsRefreshReply) -> (generation: UUID, token: UUID, start: Bool) {
        lock.withLock {
            let start = generation == nil
            let current = generation ?? UUID()
            generation = current
            let token = UUID()
            replies[token] = reply
            return (current, token, start)
        }
    }

    func timeout(generation: UUID, token: UUID) {
        let reply = lock.withLock { () -> SettingsRefreshReply? in
            guard self.generation == generation else { return nil }
            return replies.removeValue(forKey: token)
        }
        reply?.finish()
    }

    func complete(generation: UUID) {
        let pending = lock.withLock { () -> [SettingsRefreshReply] in
            guard self.generation == generation else { return [] }
            self.generation = nil
            let pending = Array(replies.values)
            replies.removeAll()
            return pending
        }
        pending.forEach { $0.finish() }
    }

    func isCurrent(_ generation: UUID) -> Bool {
        lock.withLock { self.generation == generation }
    }
}

enum ProbeChoiceMapping {
    static func choiceID(forDisplay displayUUID: String) -> String {
        let seed = "se.sandstream.lidscape.wallpaper.choice:" + displayUUID.uppercased()
        var bytes = Array(SHA256.hash(data: Data(seed.utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])).uuidString
    }

    /// Prefer a fresh display list; otherwise use the last verified list.
    static func activeDisplays(current: Set<String>?, previous: Set<String>?) -> Set<String> {
        current ?? previous ?? []
    }

    /// Filter only the Settings list. Stored choices and assignments remain untouched.
    static func visibleDisplays(_ displayUUIDs: [String], active: Set<String>) -> [String] {
        displayUUIDs.filter { active.contains($0) }
    }

    static func displayUUID(forChoice choiceID: String, slots: [(choiceID: String, displayUUID: String)]) -> String? {
        guard let canonicalChoiceID = UUID(uuidString: choiceID)?.uuidString else { return nil }
        let matches = slots.filter { $0.choiceID == canonicalChoiceID }
        guard matches.count == 1 else { return nil }
        return matches[0].displayUUID
    }
}
