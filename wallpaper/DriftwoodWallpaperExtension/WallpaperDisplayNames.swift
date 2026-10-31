import AppKit
import CoreGraphics
import Foundation

struct WallpaperDisplayLabelInput: Sendable {
    let displayUUID: String
    let fallback: String
}

/// Read AppKit screen information on the main actor. The result contains only
/// value types and can be passed back to the asynchronous settings provider.
@MainActor
func currentWallpaperDisplayNames() -> [String: String] {
    var names: [String: String] = [:]
    for screen in NSScreen.screens {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              let uuid = CGDisplayCreateUUIDFromDisplayID(number.uint32Value)?.takeRetainedValue(),
              let value = CFUUIDCreateString(nil, uuid),
              let displayUUID = WallpaperDisplayUUID.normalized(value as String) else { continue }
        names[displayUUID] = screen.localizedName
    }
    return names
}

/// Keep permanent choice IDs separate from their current visible labels.
/// Distinguish colliding labels using a stable order of display UUIDs.
func wallpaperDisplayLabels(
    _ slots: [WallpaperDisplayLabelInput],
    screenNames: [String: String]
) -> [String: String] {
    func key(_ label: String) -> String {
        label.folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    var groups: [String: [String]] = [:]
    var bases: [String: String] = [:]
    for slot in slots {
        let name = screenNames[slot.displayUUID]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let fallback = slot.fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = name.isEmpty ? (fallback.isEmpty ? "Lidscape (Display)" : fallback) : "Lidscape (\(name))"
        bases[slot.displayUUID] = base
        groups[key(base), default: []].append(slot.displayUUID)
    }

    var result: [String: String] = [:]
    var used = Set<String>()
    for slot in slots.sorted(by: { $0.displayUUID < $1.displayUUID }) {
        guard let base = bases[slot.displayUUID] else { continue }
        let peers = (groups[key(base)] ?? []).sorted()
        var suffix = peers.count > 1 ? (peers.firstIndex(of: slot.displayUUID) ?? 0) + 1 : 0
        var label = suffix == 0 ? base : "\(base) [\(suffix)]"
        while used.contains(key(label)) {
            suffix = max(suffix + 1, 2)
            label = "\(base) [\(suffix)]"
        }
        result[slot.displayUUID] = label
        used.insert(key(label))
    }
    return result
}
