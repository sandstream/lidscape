import Foundation

final class HandoffClock: @unchecked Sendable {
    var pending: [@Sendable () -> Void] = []
    var replacementGeneration = UUID()
    var retireCount = 0
}

@main
struct WallpaperRetirementTicketsCheck {
    static func main() {
        let tickets = WallpaperRetirementTickets<String>()
        let first = tickets.begin("surface")
        precondition(tickets.matches("surface", first))
        tickets.cancel("surface")
        let second = tickets.begin("surface")
        precondition(!tickets.consume("surface", first))
        precondition(tickets.matches("surface", second))
        precondition(tickets.consume("surface", second))
        precondition(!tickets.consume("surface", second))
        precondition(tickets.keys.isEmpty)

        let clock = HandoffClock()
        let old = tickets.begin("surface")
        let expectedReplacement = clock.replacementGeneration
        tickets.afterHandoff(
            "surface", ticket: old,
            schedule: { clock.pending.append($0) },
            replacementIsReady: { clock.replacementGeneration == expectedReplacement },
            retire: { clock.retireCount += 1 }
        )
        tickets.cancel("surface")
        let current = tickets.begin("surface")
        clock.pending[0]()
        precondition(clock.retireCount == 0 && tickets.matches("surface", current))

        tickets.afterHandoff(
            "surface", ticket: current,
            schedule: { clock.pending.append($0) },
            replacementIsReady: { clock.replacementGeneration == expectedReplacement },
            retire: { clock.retireCount += 1 }
        )
        clock.replacementGeneration = UUID()
        clock.pending[1]()
        precondition(clock.retireCount == 0 && tickets.matches("surface", current))

        let replacement = clock.replacementGeneration
        tickets.afterHandoff(
            "surface", ticket: current,
            schedule: { clock.pending.append($0) },
            replacementIsReady: { clock.replacementGeneration == replacement },
            retire: { clock.retireCount += 1 }
        )
        clock.pending[2]()
        clock.pending[2]()
        precondition(clock.retireCount == 1 && tickets.ticket(for: "surface") == nil)

        let reentrant = tickets.begin("surface")
        tickets.afterHandoff(
            "surface", ticket: reentrant,
            schedule: { clock.pending.append($0) },
            replacementIsReady: { true },
            retire: { _ = tickets.begin("surface") }
        )
        clock.pending[3]()
        let later = tickets.ticket(for: "surface")
        clock.pending[3]()
        precondition(later != nil && tickets.ticket(for: "surface") == later)
        print("Retirement tickets reject stale and duplicate callbacks: OK")
    }
}
