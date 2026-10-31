import AppKit
import CoreGraphics
import ColorSync
import Darwin
import Foundation

enum SettingsDisplayPreparation {
    case ready(Data)
    case busy
    case failed
}

/// Serialize name writes outside the render queue. While a write waits for the
/// file lock, retain only the latest pending names for each documents directory.
/// Each extension process has its own coordinator, so write order across
/// processes is not guaranteed. Settings reads current names from AppKit;
/// stored names are a fallback.
final class DisplayNameRefreshCoordinator: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "se.sandstream.lidscape.display-name-refresh")
    private let work: @Sendable (URL, [String: String]) -> Void
    private var pending: [URL: [String: String]] = [:]
    private var running = false

    init(work: @escaping @Sendable (URL, [String: String]) -> Void) {
        self.work = work
    }

    func submit(docs: URL, names: [String: String]) {
        lock.lock()
        pending[docs] = names
        guard !running else { lock.unlock(); return }
        running = true
        lock.unlock()
        queue.async { self.drain() }
    }

    private func drain() {
        while true {
            lock.lock()
            guard let (docs, names) = pending.first else {
                running = false
                lock.unlock()
                return
            }
            pending.removeValue(forKey: docs)
            lock.unlock()
            work(docs, names)
        }
    }
}

enum ProbeBootstrap {
    private static let displayNameRefresh = DisplayNameRefreshCoordinator { docs, names in
        do {
            try withStateLock(docs: docs) {
                try refreshDisplayNames(docs: docs, names: names)
            }
        } catch {
            extensionLog("Display name refresh failed: \(error.localizedDescription)")
        }
    }

    static func prepare() {
        let docs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents", isDirectory: true)
        do {
            try writeProbe(docs: docs, bundle: .main)
            scheduleDisplayNameRefresh(docs: docs)
        }
        catch { extensionLog("Probe setup failed: \(error.localizedDescription)") }
    }

    /// Refresh a Settings list without waiting for another bootstrap writer.
    /// Report a busy writer so the Settings refresh can retry without blocking.
    static func prepareForSettings() -> SettingsDisplayPreparation {
        let docs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
            let result: SettingsDisplayPreparation = try withStateLockIfAvailable(docs: docs) {
                let manifest = docs.appendingPathComponent("driftwood-assignments.json")
                try writeProbeLocked(docs: docs, bundle: .main)
                return .ready(try Data(contentsOf: manifest))
            } ?? .busy
            scheduleDisplayNameRefresh(docs: docs)
            return result
        } catch {
            extensionLog("Settings display refresh failed: \(error.localizedDescription)")
            return .failed
        }
    }

    static func writeProbe(docs: URL, bundle: Bundle) throws {
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        try withStateLock(docs: docs) {
            try writeProbeLocked(docs: docs, bundle: bundle)
        }
    }

    private static func writeProbeLocked(docs: URL, bundle: Bundle) throws {
        let files = FileManager.default
        let content = docs.appendingPathComponent("probe-content", isDirectory: true)
        try files.createDirectory(at: content, withIntermediateDirectories: true)
        guard let sourceScene = bundle.url(forResource: "Pulse", withExtension: "driftwoodscene"),
              let sourcePoster = bundle.url(forResource: "poster", withExtension: "png") else {
            throw NSError(domain: "LidscapeWallpaperProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bundled probe assets are missing."])
        }
        let scene = content.appendingPathComponent("Pulse.driftwoodscene", isDirectory: true)
        let poster = content.appendingPathComponent("poster.png")
        if !files.fileExists(atPath: scene.path) { try files.copyItem(at: sourceScene, to: scene) }
        // This path belongs to the probe. Refresh it when a newer build supplies a poster.
        let posterData = try Data(contentsOf: sourcePoster)
        if (try? Data(contentsOf: poster)) != posterData {
            try posterData.write(to: poster, options: .atomic)
        }
        _ = try MetalScenePackage.load(from: scene)

        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            throw NSError(domain: "LidscapeWallpaperProbe", code: 2, userInfo: [NSLocalizedDescriptionKey: "No active display found."])
        }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else {
            throw NSError(domain: "LidscapeWallpaperProbe", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot list displays."])
        }
        let screens: [(displayUUID: String, displayName: String)] = displays.prefix(Int(count)).enumerated().compactMap { index, display in
            guard let uuid = CGDisplayCreateUUIDFromDisplayID(display)?.takeRetainedValue(),
                  let raw = CFUUIDCreateString(nil, uuid),
                  let displayUUID = WallpaperDisplayUUID.normalized(raw as String) else { return nil }
            return (displayUUID, "Lidscape (Display \(index + 1))")
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let assignments = try ensureDisplaySlots(docs: docs, scene: scene, displays: screens)
        guard !assignments.isEmpty else { throw NSError(domain: "LidscapeWallpaperProbe", code: 4) }
        let prefs: [String: Any] = ["userPaused": false, "alwaysPauseDesktop": false, "pauseWhenOccluded": false,
            "desktopOccluded": false, "pauseOnBattery": false, "playbackRate": 1.0, "quality": "auto", "nativeWallpaper": true]
        let prefsData = try JSONSerialization.data(withJSONObject: prefs, options: [.sortedKeys])
        try writeStateLocked(docs: docs, defaults: assignments, prefsData: prefsData, encoder: encoder)
        extensionLog("Lidscape test: prepared \(assignments.count) display choices")
    }

    /// Create missing screen choices while preserving every existing choice.
    static func ensureDisplaySlots(
        docs: URL, scene: URL, displays: [(displayUUID: String, displayName: String)]
    ) throws -> [String: DisplayWallpaperAssignment] {
        let files = FileManager.default
        let slots = docs.appendingPathComponent("display-slots", isDirectory: true)
        var assignments: [String: DisplayWallpaperAssignment] = [:]
        for display in displays {
            let displayUUID = display.displayUUID
            guard WallpaperDisplayUUID.normalized(displayUUID) == displayUUID else { continue }
            let directory = slots.appendingPathComponent(displayUUID, isDirectory: true)
            try files.createDirectory(at: directory, withIntermediateDirectories: true)
            let anchor = directory.appendingPathComponent("anchor.driftwoodscene", isDirectory: true)
            if !files.fileExists(atPath: anchor.path) { try files.copyItem(at: scene, to: anchor) }
            let slot: [String: String] = ["displayUUID": displayUUID, "choiceID": ProbeChoiceMapping.choiceID(forDisplay: displayUUID),
                "displayName": display.displayName, "anchorPath": "anchor.driftwoodscene/scene.json"]
            let slotData = try JSONSerialization.data(withJSONObject: slot, options: [.sortedKeys])
            try createIfMissing(slotData, at: directory.appendingPathComponent("slot.json"))
            let entry = DisplayPlaylistEntry(contentUUID: "A2643CE4-826D-44D6-9B9F-D87CC004A16D", kind: .metalScene,
                resourcePath: "probe-content/Pulse.driftwoodscene/scene.json", posterPath: "probe-content/poster.png",
                title: "Lidscape", durationSeconds: 0)
            assignments[displayUUID] = try DisplayWallpaperAssignment(displayUUID: displayUUID, entries: [entry], assignmentRevision: 1)
        }
        return assignments
    }

    static func slotName(screenName: String?, index: Int) -> String {
        let name = screenName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "Lidscape (\(name.isEmpty ? "Display \(index + 1)" : name))"
    }

    /// AppKit screen metadata belongs on the main actor. Disk access runs separately.
    private static func scheduleDisplayNameRefresh(docs: URL) {
        Task { @MainActor in
            var names: [String: String] = [:]
            for screen in NSScreen.screens {
                guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
                      let uuid = CGDisplayCreateUUIDFromDisplayID(number.uint32Value)?.takeRetainedValue(),
                      let raw = CFUUIDCreateString(nil, uuid),
                      let id = WallpaperDisplayUUID.normalized(raw as String) else { continue }
                names[id] = screen.localizedName
            }
            let capturedNames = names
            guard !capturedNames.isEmpty else { return }
            displayNameRefresh.submit(docs: docs, names: capturedNames)
        }
    }

    /// Update only connected screens whose real name is available. Preserve all
    /// other slot metadata and do not follow slot or directory symlinks.
    static func refreshDisplayNames(docs: URL, names: [String: String]) throws {
        let files = FileManager.default
        let slots = docs.appendingPathComponent("display-slots", isDirectory: true)
        guard (try? files.attributesOfItem(atPath: slots.path)[.type] as? FileAttributeType) == .typeDirectory else { return }
        for (id, rawName) in names {
            let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, WallpaperDisplayUUID.normalized(id) == id else { continue }
            let directory = slots.appendingPathComponent(id, isDirectory: true)
            let slot = directory.appendingPathComponent("slot.json")
            guard (try? files.attributesOfItem(atPath: directory.path)[.type] as? FileAttributeType) == .typeDirectory,
                  (try? files.attributesOfItem(atPath: slot.path)[.type] as? FileAttributeType) == .typeRegular,
                  let data = try? Data(contentsOf: slot),
                  var metadata = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  metadata["displayUUID"] as? String == id else { continue }
            let label = slotName(screenName: name, index: 0)
            guard metadata["displayName"] as? String != label else { continue }
            metadata["displayName"] = label
            try replaceFile(try JSONSerialization.data(withJSONObject: metadata, options: [.sortedKeys]), at: slot)
        }
    }

    static func replaceFile(_ data: Data, at destination: URL) throws {
        try data.write(to: destination, options: .atomic)
    }

    // All writers that add assignments must hold this lock for the read and write.
    static func withStateLock<T>(docs: URL, _ body: () throws -> T) throws -> T {
        let path = docs.appendingPathComponent(".lidscape-bootstrap.lock").path
        let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }

    /// Skip the refresh when another process is already writing.
    static func withStateLockIfAvailable<T>(docs: URL, _ body: () throws -> T) throws -> T? {
        let path = docs.appendingPathComponent(".lidscape-bootstrap.lock").path
        let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(fd) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            if errno == EWOULDBLOCK || errno == EAGAIN { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }

    // Linking a completed temporary file installs it atomically without replacing
    // a file created by another process. Foundation cannot combine .atomic and
    // .withoutOverwriting.
    static func createIfMissing(_ data: Data, at destination: URL) throws {
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".lidscape-\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try data.write(to: temporary)
        guard link(temporary.path, destination.path) == 0 else {
            if errno == EEXIST { return }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
    }

    static func writeStateLocked(docs: URL, defaults: [String: DisplayWallpaperAssignment],
                                 prefsData: Data, encoder: JSONEncoder = JSONEncoder()) throws {
        let manifestURL = docs.appendingPathComponent("driftwood-assignments.json")
        let prefsURL = docs.appendingPathComponent("driftwood-prefs.json")
        let initial = try WallpaperAssignmentManifest(revision: 1, assignments: defaults)
        try createIfMissing(try encoder.encode(initial), at: manifestURL)
        let existing = try JSONDecoder().decode(WallpaperAssignmentManifest.self, from: Data(contentsOf: manifestURL))
        let missing = defaults.filter { existing.assignments[$0.key] == nil }
        if !missing.isEmpty {
            guard existing.revision < UInt64.max else {
                throw WallpaperAssignmentValidationError.invalidManifestRevision(existing.revision)
            }
            let revision = existing.revision + 1
            var assignments = existing.assignments
            for (id, value) in missing {
                assignments[id] = try DisplayWallpaperAssignment(displayUUID: value.displayUUID,
                    playlistID: value.playlistID, mode: value.mode, entries: value.entries,
                    assignmentRevision: revision)
            }
            let merged = try WallpaperAssignmentManifest(revision: revision, assignments: assignments)
            try merged.validate(successorTo: existing)
            try encoder.encode(merged).write(to: manifestURL, options: .atomic)
        }
        try createIfMissing(prefsData, at: prefsURL)
    }
}
