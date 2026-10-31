import Foundation

let reloadEntered = DispatchSemaphore(value: 0)
let reloadRelease = DispatchSemaphore(value: 0)
let reloadFinished = DispatchSemaphore(value: 0)
let lifecycleBlocked = DispatchSemaphore(value: 0)
let lifecycleRelease = DispatchSemaphore(value: 0)

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
        .ready(Data("{\"revision\":2}".utf8))
    }
}

final class SnapshotInvalidator: @unchecked Sendable {
    func invalidateSnapshots() {}
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
        print("Display refresh ordering and preserved choices: OK")
    }
}
