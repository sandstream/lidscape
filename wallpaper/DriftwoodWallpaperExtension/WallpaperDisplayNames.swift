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

/// Keep the permanent choice IDs separate from their current visible labels.
/// Distinguish identical model names using a stable order of display UUIDs.
func wallpaperDisplayLabels(
    _ slots: [WallpaperDisplayLabelInput],
    screenNames: [String: String]
) -> [String: String] {
    var groups: [String: [String]] = [:]
    var usableNames: [String: String] = [:]
    for slot in slots {
        guard let raw = screenNames[slot.displayUUID] else { continue }
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { continue }
        usableNames[slot.displayUUID] = name
        let key = name.folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        groups[key, default: []].append(slot.displayUUID)
    }

    var result: [String: String] = [:]
    for slot in slots {
        guard let name = usableNames[slot.displayUUID] else {
            result[slot.displayUUID] = slot.fallback
            continue
        }
        let key = name.folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let peers = (groups[key] ?? []).sorted()
        if peers.count > 1, let position = peers.firstIndex(of: slot.displayUUID) {
            result[slot.displayUUID] = "Lidscape (\(name), \(position + 1))"
        } else {
            result[slot.displayUUID] = "Lidscape (\(name))"
        }
    }
    return result
}
