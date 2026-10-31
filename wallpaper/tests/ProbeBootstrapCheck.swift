import Foundation
import Darwin

func extensionLog(_ message: String) {}

final class RefreshRunCount: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func increment() { lock.lock(); value += 1; lock.unlock() }
    func read() -> Int { lock.lock(); defer { lock.unlock() }; return value }
}

@main
struct ProbeBootstrapCheck {
    static let first = "00000000-0000-4000-8000-000000000001"
    static let second = "00000000-0000-4000-8000-000000000002"
    static let third = "00000000-0000-4000-8000-000000000003"
    static let content = "A2643CE4-826D-44D6-9B9F-D87CC004A16D"

    static func assignment(_ id: String, title: String = "Default", revision: UInt64 = 1) throws -> DisplayWallpaperAssignment {
        let entry = DisplayPlaylistEntry(contentUUID: content, kind: .metalScene,
            resourcePath: "scene.json", posterPath: "poster.png", title: title, durationSeconds: 0)
        return try DisplayWallpaperAssignment(displayUUID: id, entries: [entry], assignmentRevision: revision)
    }

    static func update(_ docs: URL, _ id: String, prefs: Data = Data("defaults".utf8)) throws {
        try ProbeBootstrap.withStateLock(docs: docs) {
            try ProbeBootstrap.writeStateLocked(docs: docs, defaults: [id: try assignment(id)], prefsData: prefs)
        }
    }

    static func manifest(_ docs: URL) throws -> WallpaperAssignmentManifest {
        try JSONDecoder().decode(WallpaperAssignmentManifest.self,
            from: Data(contentsOf: docs.appendingPathComponent("driftwood-assignments.json")))
    }

    static func checkFile(_ url: URL, equals expected: Data, _ message: String) throws {
        let actual = try Data(contentsOf: url)
        precondition(actual == expected, message)
    }

    static func main() throws {
        let args = CommandLine.arguments
        if args.count == 4 && args[1] == "child" {
            try update(URL(fileURLWithPath: args[2], isDirectory: true), args[3])
            return
        }
        let root = args.count == 3 && args[1] == "root"
            ? URL(fileURLWithPath: args[2], isDirectory: true)
            : FileManager.default.temporaryDirectory
        let docs = root.appendingPathComponent("lidscape-bootstrap-check-\(UUID())")
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: docs) }
        let manifestURL = docs.appendingPathComponent("driftwood-assignments.json")
        let prefsURL = docs.appendingPathComponent("driftwood-prefs.json")

        try update(docs, first)
        let original = try WallpaperAssignmentManifest(revision: 4, assignments: [first: assignment(first, title: "Custom", revision: 4)])
        try JSONEncoder().encode(original).write(to: manifestURL, options: .atomic)
        let customizedPrefs = Data("custom settings".utf8)
        try customizedPrefs.write(to: prefsURL, options: .atomic)
        let originalBytes = try Data(contentsOf: manifestURL)
        try update(docs, first)
        try checkFile(manifestURL, equals: originalBytes, "Restart changed an existing manifest")
        try checkFile(prefsURL, equals: customizedPrefs, "Restart changed existing preferences")

        try update(docs, second)
        let merged = try manifest(docs)
        precondition(merged.revision == 5 && merged.assignments[first] == original.assignments[first], "Existing display changed")
        precondition(merged.assignments[second]?.assignmentRevision == 5, "New display revision is incorrect")
        try merged.validate(successorTo: original)

        let bad = Data("not json".utf8)
        try bad.write(to: manifestURL, options: .atomic)
        do {
            try update(docs, first)
            fatalError("A corrupt manifest must fail")
        } catch {}
        try checkFile(manifestURL, equals: bad, "A corrupt manifest was overwritten")
        try checkFile(prefsURL, equals: customizedPrefs, "A corrupt manifest changed preferences")

        try JSONEncoder().encode(original).write(to: manifestURL, options: .atomic)
        let executable = URL(fileURLWithPath: args[0])
        let children = [second, third].map { id in
            let process = Process()
            process.executableURL = executable
            process.arguments = ["child", docs.path, id]
            return process
        }
        for child in children { try child.run() }
        for child in children {
            child.waitUntilExit()
            precondition(child.terminationStatus == 0, "A concurrent writer failed")
        }
        // Listing hides disconnected displays without changing their saved assignment.
        let retained = try manifest(docs)
        let slots = [first, second, third]
        let oneVisible = ProbeChoiceMapping.visibleDisplays(slots, active: Set([first]))
        precondition(oneVisible == [first], "Disconnected displays must not appear in Settings")
        let reconnected = ProbeChoiceMapping.visibleDisplays(slots, active: Set([first, second]))
        precondition(reconnected == [first, second], "A reconnected display must appear again")
        let afterListing = try manifest(docs)
        precondition(afterListing == retained, "Listing displays must not change saved assignments")
        precondition(ProbeChoiceMapping.activeDisplays(current: nil, previous: nil).isEmpty,
                     "An unknown display list must not expose stale choices")
        precondition(ProbeChoiceMapping.activeDisplays(current: nil, previous: Set([first])) == Set([first]),
                     "A failed query must retain the last verified display list")
        precondition(ProbeChoiceMapping.activeDisplays(current: Set([second]), previous: Set([first])) == Set([second]),
                     "A successful query must replace the previous display list")

        let concurrent = try manifest(docs)
        precondition(concurrent.revision == 6 && concurrent.assignments.count == 3, "Concurrent writers lost a display")
        precondition(concurrent.assignments[first] == original.assignments[first], "Concurrent writers changed an existing display")
        try checkFile(prefsURL, equals: customizedPrefs, "Concurrent writers changed preferences")

        // Timeout and completion may race, but Settings must receive one reply.
        let replies = DispatchSemaphore(value: 0)
        let reply = SettingsRefreshReply { replies.signal() }
        DispatchQueue.concurrentPerform(iterations: 20) { _ in reply.finish() }
        precondition(replies.wait(timeout: .now()) == .success, "A Settings reply is required")
        precondition(replies.wait(timeout: .now()) == .timedOut, "Settings must not receive duplicate replies")

        // Multiple Settings requests share one refresh, including after reply timeouts.
        let coordinator = SettingsRefreshCoordinator()
        var joins: [(generation: UUID, token: UUID, start: Bool)] = []
        for _ in 0..<24 { joins.append(coordinator.join(SettingsRefreshReply {})) }
        precondition(joins.filter(\.start).count == 1, "Concurrent requests must share a refresh")
        let firstGeneration = joins[0].generation
        precondition(joins.allSatisfy { $0.generation == firstGeneration }, "Requests must share the same generation")
        for join in joins { coordinator.timeout(generation: join.generation, token: join.token) }
        let later = coordinator.join(SettingsRefreshReply {})
        precondition(!later.start && later.generation == firstGeneration,
                     "Timeouts must not queue another refresh while work is still active")
        coordinator.complete(generation: firstGeneration)
        let next = coordinator.join(SettingsRefreshReply {})
        precondition(next.start && next.generation != firstGeneration, "Completed work must permit a new refresh")
        coordinator.complete(generation: firstGeneration)
        precondition(coordinator.isCurrent(next.generation), "A late old completion must not clear the new refresh")
        coordinator.complete(generation: next.generation)

        // A Settings refresh must not wait for another bootstrap writer.
        let lockPath = docs.appendingPathComponent(".lidscape-bootstrap.lock").path
        let heldFD = open(lockPath, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        precondition(heldFD >= 0 && flock(heldFD, LOCK_EX) == 0, "Could not hold the test lock")
        let unavailable: Bool? = try ProbeBootstrap.withStateLockIfAvailable(docs: docs) { true }
        precondition(unavailable == nil, "A busy bootstrap lock must be skipped")
        flock(heldFD, LOCK_UN)
        close(heldFD)
        let available: Bool? = try ProbeBootstrap.withStateLockIfAvailable(docs: docs) { true }
        precondition(available == true, "An available bootstrap lock must run the refresh")

        // Refreshing for a new screen must retain choices for disconnected screens.
        let hotplug = docs.appendingPathComponent("hotplug", isDirectory: true)
        let scene = hotplug.appendingPathComponent("probe-content/Pulse.driftwoodscene", isDirectory: true)
        try FileManager.default.createDirectory(at: scene, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: scene.appendingPathComponent("scene.json"))
        func refresh(_ screens: [(displayUUID: String, displayName: String)]) throws {
            try ProbeBootstrap.withStateLock(docs: hotplug) {
                let defaults = try ProbeBootstrap.ensureDisplaySlots(docs: hotplug, scene: scene, displays: screens)
                try ProbeBootstrap.writeStateLocked(docs: hotplug, defaults: defaults, prefsData: customizedPrefs)
            }
        }
        try refresh([(first, "First")])
        let firstSlot = hotplug.appendingPathComponent("display-slots/\(first)/slot.json")
        let firstSlotData = try Data(contentsOf: firstSlot)
        let customized = try WallpaperAssignmentManifest(revision: 2,
            assignments: [first: assignment(first, title: "Saved", revision: 2)])
        try JSONEncoder().encode(customized).write(to: hotplug.appendingPathComponent("driftwood-assignments.json"), options: .atomic)
        try refresh([(second, "Second")])
        let afterConnect = try manifest(hotplug)
        precondition(afterConnect.assignments[first] == customized.assignments[first], "Disconnected screen lost its saved assignment")
        precondition(afterConnect.assignments[second] != nil, "A new screen was not added")
        try checkFile(firstSlot, equals: firstSlotData, "Disconnected screen lost its choice")
        try refresh([(first, "First"), (second, "Second")])
        let afterReconnect = try manifest(hotplug)
        precondition(afterReconnect == afterConnect, "Reconnecting changed saved assignments")
        try checkFile(firstSlot, equals: firstSlotData, "Reconnecting changed the stable choice")
        try checkFile(hotplug.appendingPathComponent("driftwood-prefs.json"), equals: customizedPrefs,
                      "Display changes altered preferences")

        // Refresh real names without changing choice identity, unrelated fields,
        // or the saved metadata of a disconnected screen.
        let secondSlot = hotplug.appendingPathComponent("display-slots/\(second)/slot.json")
        let secondSlotData = try Data(contentsOf: secondSlot)
        var firstMetadata = try JSONSerialization.jsonObject(with: Data(contentsOf: firstSlot)) as! [String: Any]
        let originalChoice = firstMetadata["choiceID"] as? String
        let originalAnchor = firstMetadata["anchorPath"] as? String
        firstMetadata["displayName"] = "Lidscape (Display 1)"
        firstMetadata["customField"] = "keep"
        try JSONSerialization.data(withJSONObject: firstMetadata).write(to: firstSlot)
        try ProbeBootstrap.refreshDisplayNames(docs: hotplug, names: [first: "Built-in Retina Display"])
        let renamed = try JSONSerialization.jsonObject(with: Data(contentsOf: firstSlot)) as! [String: Any]
        precondition(renamed["displayName"] as? String == "Lidscape (Built-in Retina Display)", "Existing slot name did not refresh")
        precondition(renamed["choiceID"] as? String == originalChoice && renamed["anchorPath"] as? String == originalAnchor,
                     "A name refresh must not change choice identity")
        precondition(renamed["customField"] as? String == "keep", "A name refresh discarded slot metadata")
        try checkFile(secondSlot, equals: secondSlotData, "A disconnected screen's slot changed")
        let renamedBytes = try Data(contentsOf: firstSlot)
        try ProbeBootstrap.refreshDisplayNames(docs: hotplug, names: [first: "  "])
        try checkFile(firstSlot, equals: renamedBytes, "An empty name replaced an existing name")

        // A busy writer must not drop the update or allow an older name to win.
        let nameLock = open(hotplug.appendingPathComponent(".lidscape-bootstrap.lock").path, O_RDWR)
        precondition(nameLock >= 0 && flock(nameLock, LOCK_EX) == 0, "Could not hold the name refresh lock")
        let nameStarted = DispatchSemaphore(value: 0)
        let latestFinished = DispatchSemaphore(value: 0)
        let runs = RefreshRunCount()
        let names = DisplayNameRefreshCoordinator { target, values in
            runs.increment()
            nameStarted.signal()
            do {
                try ProbeBootstrap.withStateLock(docs: target) {
                    try ProbeBootstrap.refreshDisplayNames(docs: target, names: values)
                }
            } catch {
                fatalError("Name refresh failed: \(error)")
            }
            if values[first] == "Latest" { latestFinished.signal() }
        }
        names.submit(docs: hotplug, names: [first: "Old"])
        precondition(nameStarted.wait(timeout: .now() + 5) == .success, "Name refresh did not start")
        for index in 0..<100 { names.submit(docs: hotplug, names: [first: "Queued \(index)"]) }
        names.submit(docs: hotplug, names: [first: "Latest"])
        flock(nameLock, LOCK_UN)
        close(nameLock)
        precondition(latestFinished.wait(timeout: .now() + 5) == .success, "Latest name was not written after lock release")
        let latest = try JSONSerialization.jsonObject(with: Data(contentsOf: firstSlot)) as! [String: Any]
        precondition(latest["displayName"] as? String == "Lidscape (Latest)", "An older name replaced the latest name")
        precondition(runs.read() == 2, "Repeated updates while locked must be coalesced")
        try checkFile(secondSlot, equals: secondSlotData, "Queued refresh changed a disconnected screen")

        let outside = docs.appendingPathComponent("outside-slot.json")
        try Data("outside".utf8).write(to: outside)
        let linkedDir = hotplug.appendingPathComponent("display-slots/\(third)", isDirectory: true)
        try FileManager.default.createDirectory(at: linkedDir, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: linkedDir.appendingPathComponent("slot.json"), withDestinationURL: outside)
        try ProbeBootstrap.refreshDisplayNames(docs: hotplug, names: [third: "External screen"])
        try checkFile(outside, equals: Data("outside".utf8), "A name refresh followed a slot symlink")

        let fourth = "00000000-0000-4000-8000-000000000004"
        let outsideDirectory = docs.appendingPathComponent("outside-display", isDirectory: true)
        try FileManager.default.createDirectory(at: outsideDirectory, withIntermediateDirectories: true)
        let outsideMetadata = try JSONSerialization.data(withJSONObject: ["displayUUID": fourth, "displayName": "Before"])
        try outsideMetadata.write(to: outsideDirectory.appendingPathComponent("slot.json"))
        try FileManager.default.createSymbolicLink(at: hotplug.appendingPathComponent("display-slots/\(fourth)"), withDestinationURL: outsideDirectory)
        try ProbeBootstrap.refreshDisplayNames(docs: hotplug, names: [fourth: "External screen"])
        try checkFile(outsideDirectory.appendingPathComponent("slot.json"), equals: outsideMetadata,
                      "A name refresh followed a display directory symlink")

        let linkedRoot = docs.appendingPathComponent("linked-root", isDirectory: true)
        let externalSlots = docs.appendingPathComponent("external-slots", isDirectory: true)
        let externalDisplay = externalSlots.appendingPathComponent(fourth, isDirectory: true)
        try FileManager.default.createDirectory(at: linkedRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: externalDisplay, withIntermediateDirectories: true)
        try outsideMetadata.write(to: externalDisplay.appendingPathComponent("slot.json"))
        try FileManager.default.createSymbolicLink(at: linkedRoot.appendingPathComponent("display-slots"), withDestinationURL: externalSlots)
        try ProbeBootstrap.refreshDisplayNames(docs: linkedRoot, names: [fourth: "External screen"])
        try checkFile(externalDisplay.appendingPathComponent("slot.json"), equals: outsideMetadata,
                      "A name refresh followed a slots root symlink")

        let secondMetadata = try JSONSerialization.jsonObject(with: Data(contentsOf: secondSlot)) as! [String: Any]
        let secondChoice = secondMetadata["choiceID"] as? String
        try ProbeBootstrap.refreshDisplayNames(docs: hotplug, names: [first: "Built-in Retina Display", second: "Studio Display"])
        let firstActive = try JSONSerialization.jsonObject(with: Data(contentsOf: firstSlot)) as! [String: Any]
        let secondActive = try JSONSerialization.jsonObject(with: Data(contentsOf: secondSlot)) as! [String: Any]
        precondition(firstActive["displayName"] as? String == "Lidscape (Built-in Retina Display)" &&
                     secondActive["displayName"] as? String == "Lidscape (Studio Display)",
                     "Both connected screen names must refresh")
        precondition(secondActive["choiceID"] as? String == secondChoice, "Refreshing both screens changed a choice ID")
        let afterNameRefresh = try manifest(hotplug)
        precondition(afterNameRefresh == afterReconnect, "Refreshing names changed saved assignments")

        let existing = docs.appendingPathComponent("existing")
        try Data("original".utf8).write(to: existing)
        try ProbeBootstrap.createIfMissing(Data("replacement".utf8), at: existing)
        try checkFile(existing, equals: Data("original".utf8), "Create replaced an existing file")
        let symlink = docs.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: existing)
        try ProbeBootstrap.createIfMissing(Data("replacement".utf8), at: symlink)
        try checkFile(existing, equals: Data("original".utf8), "Create followed an existing link")
        precondition(ProbeBootstrap.slotName(screenName: "Built-in Retina Display", index: 1) == "Lidscape (Built-in Retina Display)", "Slot name ignored the screen name")
        precondition(ProbeBootstrap.slotName(screenName: "  ", index: 1) == "Lidscape (Display 2)", "Blank screen name has no fallback")
        precondition(ProbeBootstrap.slotName(screenName: nil, index: 0) == "Lidscape (Display 1)", "Missing screen name has no fallback")
        let slot = docs.appendingPathComponent("slot.json")
        try Data("{\"displayName\":\"Lidscape (Display 2)\"}".utf8).write(to: slot)
        try ProbeBootstrap.replaceFile(Data("{\"displayName\":\"Lidscape (Studio)\"}".utf8), at: slot)
        try checkFile(slot, equals: Data("{\"displayName\":\"Lidscape (Studio)\"}".utf8), "Slot refresh kept the old name")
        print("Wallpaper bootstrap: OK")
    }
}
