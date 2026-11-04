import Foundation

/// Access only from the lifecycle queue. A ticket identifies one unhosted interval.
final class WallpaperRetirementTickets<Key: Hashable & Sendable>: @unchecked Sendable {
    private var pending: [Key: UUID] = [:]

    var keys: [Key] { Array(pending.keys) }

    func begin(_ key: Key) -> UUID {
        let ticket = UUID()
        pending[key] = ticket
        return ticket
    }

    func matches(_ key: Key, _ ticket: UUID) -> Bool {
        pending[key] == ticket
    }

    func consume(_ key: Key, _ ticket: UUID) -> Bool {
        guard matches(key, ticket) else { return false }
        pending.removeValue(forKey: key)
        return true
    }

    func cancel(_ key: Key) {
        pending.removeValue(forKey: key)
    }

    func ticket(for key: Key) -> UUID? { pending[key] }

    func afterHandoff(
        _ key: Key,
        ticket: UUID,
        schedule: @Sendable (@escaping @Sendable () -> Void) -> Void,
        replacementIsReady: @escaping @Sendable () -> Bool,
        retire: @escaping @Sendable () -> Void
    ) {
        schedule { [self] in
            guard matches(key, ticket), replacementIsReady(), consume(key, ticket) else { return }
            retire()
        }
    }
}
