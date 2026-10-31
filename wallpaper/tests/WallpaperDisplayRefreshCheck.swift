import Foundation

let reloadEntered = DispatchSemaphore(value: 0)
let reloadRelease = DispatchSemaphore(value: 0)
let reloadFinished = DispatchSemaphore(value: 0)
let lifecycleBlocked = DispatchSemaphore(value: 0)
let lifecycleRelease = DispatchSemaphore(value: 0)


final class Counters: @unchecked Sendable {
    let lock = NSLock()
    var bootstrap = 0
    var reload = 0
    func incBootstrap() { lock.lock(); bootstrap += 1; lock.unlock() }
    func incReload() { lock.lock(); reload += 1; lock.unlock() }
    func snapshot() -> (Int, Int) { lock.lock(); defer { lock.unlock() }; return (bootstrap, reload) }
}
let counts = Counters()

enum Lifecycle {
    static let queue = DispatchQueue(label: "se.sandstream.lidscape.tests.lifecycle")
}

struct WallpaperAssignmentManifest: Codable, Equatable {
    let revision: Int
}

enum Preparation {
    case ready(Data)
    case busy
    case failed
}

enum ProbeBootstrap {
    static func prepareForSettings() -> Preparation {
        counts.incBootstrap()
        return .ready(Data("{\"revision\":2}".utf8))
    }
}

final class SnapshotInvalidator: @unchecked Sendable {
    func invalidateSnapshots() { counts.incReload() }
}

enum WallpaperSnapshotInvalidator {
    static let shared = SnapshotInvalidator()
}

struct Assignment {
    let posterURL: URL?
}

struct DisplayWallpaperSlot {
    let displayUUID: String
    let choiceID: String
    let displayName: String
    let anchorURL: URL
    let thumbnailURL: URL?
    let assignment: Assignment?
}

struct DisplaySlotMetadata: Decodable {
    let displayUUID: String
    let choiceID: String
    let displayName: String
    let anchorPath: String
}

enum WallpaperDisplayUUID {
    static func normalized(_ value: String) -> String? {
        UUID(uuidString: value)?.uuidString
    }
}

enum PathSafety {
    static func contained(_ url: URL, in parent: URL) -> Bool {
        url.standardizedFileURL.path.hasPrefix(parent.standardizedFileURL.path + "/")
    }
}

struct State {
    var manifest: WallpaperAssignmentManifest?
    var lastActiveDisplayUUIDs: Set<String>?
}

final class StateLock: @unchecked Sendable {
    private let mutex = NSLock()
    private var state = State(manifest: WallpaperAssignmentManifest(revision: 1))

    func withLock<T>(_ body: (inout State) -> T) -> T {
        mutex.lock()
        defer { mutex.unlock() }
        return body(&state)
    }
}

@main
struct WallpaperDisplayRefreshCheck {
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let a = "00000000-0000-4000-8000-000000000001"
        let b = "00000000-0000-4000-8000-000000000002"
        for id in [a, b] {
            let directory = root.appendingPathComponent("display-slots/" + id)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data("{}".utf8).write(to: directory.appendingPathComponent("scene.json"))
            let metadata = ["displayUUID": id, "choiceID": id, "displayName": id, "anchorPath": "scene.json"]
            try JSONSerialization.data(withJSONObject: metadata).write(to: directory.appendingPathComponent("slot.json"))
        }

        let store = Store(root, current: [a, b], ready: [a])
        precondition(store.visibleSettingsSlots().map(\.displayUUID) == [a], "Existing choice must stay visible during reload")
        store.ready.insert(b)
        precondition(Set(store.visibleSettingsSlots().map(\.displayUUID)) == Set([a, b]))
        store.current = nil
        precondition(Set(store.visibleSettingsSlots().map(\.displayUUID)) == Set([a, b]), "Use the last verified displays if a query fails")
        store.current = [a]
        precondition(store.visibleSettingsSlots().map(\.displayUUID) == [a])
        store.current = [a, b]
        precondition(Set(store.visibleSettingsSlots().map(\.displayUUID)) == Set([a, b]), "A reconnected choice must return")
        precondition(store.settingsSlots().count == 2, "A disconnected choice must remain stored")

        let normal = Store(root, current: [a], ready: [a])
        normal.pauseReload = true
        let normalDone = DispatchSemaphore(value: 0)
        Task.detached { await normal.refreshConnectedDisplayChoices(); normalDone.signal() }
        precondition(reloadEntered.wait(timeout: .now() + 5) == .success, "Reload did not start")
        let early = normalDone.wait(timeout: .now() + 0.2) == .success
        reloadRelease.signal()
        precondition(normalDone.wait(timeout: .now() + 3) == .success, "Normal refresh did not finish")
        precondition(!early && normal.lock.withLock({ $0.manifest?.revision }) == 2, "Normal response preceded reload")
        precondition(reloadFinished.wait(timeout: .now() + 3) == .success)

        Lifecycle.queue.async { lifecycleBlocked.signal(); lifecycleRelease.wait() }
        precondition(lifecycleBlocked.wait(timeout: .now() + 5) == .success)
        let blocked = Store(root, current: [a], ready: [a])
        let blockedDone = DispatchSemaphore(value: 0)
        Task.detached { await blocked.refreshConnectedDisplayChoices(); blockedDone.signal() }
        let responsive = blockedDone.wait(timeout: .now() + 2.5) == .success
        lifecycleRelease.signal()
        precondition(responsive, "A busy lifecycle queue must not block Settings indefinitely")
        precondition(reloadFinished.wait(timeout: .now() + 5) == .success, "Queued reload must run after the queue resumes")
        let before = counts.snapshot()
        let many = Store(root, current: [a], ready: [a])
        let held = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let responses = DispatchSemaphore(value: 0)
        Lifecycle.queue.async { held.signal(); release.wait() }
        precondition(held.wait(timeout: .now() + 5) == .success)
        let n = 24
        for _ in 0..<n { Task.detached { await many.refreshConnectedDisplayChoices(); responses.signal() } }
        for _ in 0..<n { precondition(responses.wait(timeout: .now() + 3) == .success) }
        for _ in 0..<3 {
            for _ in 0..<n { Task.detached { await many.refreshConnectedDisplayChoices(); responses.signal() } }
            for _ in 0..<n { precondition(responses.wait(timeout: .now() + 3) == .success) }
        }
        let calls = counts.snapshot().0 - before.0
        release.signal()
        let completed = DispatchSemaphore(value: 0)
        Lifecycle.queue.async { completed.signal() }
        precondition(completed.wait(timeout: .now() + 5) == .success)
        let reloads = counts.snapshot().1 - before.1
        print("Four waves of \(n) requests: \(calls) bootstrap call, \(reloads) reload")
        precondition(calls == 1 && reloads == 1, "Concurrent requests must share bootstrap and reload")
        many.lock.withLock { $0.manifest = WallpaperAssignmentManifest(revision: 1) }
        Task.detached { await many.refreshConnectedDisplayChoices(); responses.signal() }
        precondition(responses.wait(timeout: .now() + 3) == .success)
        let after = counts.snapshot()
        precondition(after.0 - before.0 == 2 && after.1 - before.1 == 2, "A new refresh must start after the stalled operation finishes")
        print("Four waves completed within timeout, then a fresh refresh succeeded")

        print("Display refresh ordering and preserved choices: OK")
    }
}
