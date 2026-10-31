import AppKit
import Foundation

/// Build a fully-populated WallpaperSettingsViewModelsXPC using Codable shims.
/// macOS gets one permanent choice per display; Driftwood changes the content
/// behind that choice through the assignment manifest.
func buildSettingsViewModelsXPC() async -> AnyObject? {
    let bundleID = Bundle.main.bundleIdentifier ?? "se.sandstream.lidscape.wallpaper.extension"
    let groupID = GroupID(id: "se.sandstream.lidscape.wallpaper.display-wallpapers")
    // With native wallpaper turned off in Driftwood, offering these choices in Wallpaper
    // Settings would invite the user to select a provider the app has stopped driving.
    let slots = WallpaperPrefs.shared.nativeWallpaperEnabled
        ? WallpaperAssignmentStore.shared.settingsSlots()
        : []

    let screenNames = await MainActor.run { currentWallpaperDisplayNames() }
    let labels = wallpaperDisplayLabels(
        slots.map { WallpaperDisplayLabelInput(displayUUID: $0.displayUUID, fallback: $0.displayName) },
        screenNames: screenNames
    )

    var items = [SettingsItem]()

    for (index, slot) in slots.enumerated() {
        let displayName = labels[slot.displayUUID] ?? slot.displayName
        let choiceID = ChoiceID(
            id: slot.choiceID,
            descriptor: ChoiceIDDescriptor(
                provider: ChoiceProviderID(rawValue: bundleID),
                identifier: slot.choiceID,
                files: [slot.anchorURL],
                configuration: Data(slot.choiceID.utf8),
            ),
        )

        let assignment = slot.assignment
        let title = assignment?.title ?? "Managed by Driftwood"
        let kind = assignment?.kind
        guard let thumbnailURL = slot.thumbnailURL else { continue }
        let thumbnail = Thumbnail.image(url: thumbnailURL)

        let choiceDescriptor = ChoiceDescriptor(
            id: choiceID,
            provider: ChoiceProviderID(rawValue: bundleID),
            identifier: slot.choiceID,
            name: displayName,
            localizedDescription: assignment?.isPlaylist == true
                ? "Playlist \u{2014} now playing \(title)"
                : "Currently playing \(title)",
            thumbnail: thumbnail,
            isDownloaded: true,
            options: [],
        )

        let item = SettingsItem(
            id: choiceID,
            localizedName: displayName,
            thumbnail: thumbnail,
            choice: choiceDescriptor,
            contentBadge: kind == .metalScene ? .dynamic : .video,
            showInTopLevel: true,
            sortOrder: index,
            // Wallpaper Settings currently crashes its own extension host while
            // dispatching this private removal action. Driftwood's library UI is
            // the authoritative, safe place to delete managed media.
            disposability: .none,
        )
        items.append(item)
    }

    let group = SettingsGroup(
        id: groupID,
        items: items,
        localizedName: "Lidscape",
        disposability: .none,
        sortOrder: -100,
        sortID: GroupSortID(id: "com.apple.wallpaper.aerials"),
        allChoiceID: nil,
        shouldHideItemLabels: false,
        contextMenu: nil,
        thumbnail: nil,
    )

    let viewModel = SettingsViewModel(
        groups: [group],
        refreshPolicy: .default,
        isModificationDisabled: false,
    )

    let viewModels = SettingsViewModels(
        desktop: viewModel,
        screenSaver: nil,
    )

    return remapToRealXPC(viewModels)
}

/// Fallback: create a WallpaperSettingsViewModelsXPC with empty groups.
func makeEmptyGroupsResponse() -> AnyObject? {
    let emptyViewModels = SettingsViewModels(
        desktop: SettingsViewModel(
            groups: [],
            refreshPolicy: .default,
            isModificationDisabled: false,
        ),
        screenSaver: nil,
    )
    return remapToRealXPC(emptyViewModels)
}

/// Archive via ShimViewModelsXPC, remap class name on unarchive to the real XPC type.
///
/// Secure coding cannot be required here: the whole point is to archive our own
/// `ShimViewModelsXPC` and decode it back as the private `WallpaperSettingsViewModelsXPC`
/// via `setClass(_:forClassName:)`, a substitution secure coding is designed to
/// forbid. This is safe because the archive is never persisted or received over
/// any boundary — it is produced and consumed in-process within this one function
/// from values we just constructed, so there is no untrusted input to defend
/// against. The decoded object is handed straight back to WallpaperAgent.
private func remapToRealXPC(_ viewModels: SettingsViewModels) -> AnyObject? {
    let shimXPC = ShimViewModelsXPC(value: viewModels)

    let data: Data
    do {
        data = try NSKeyedArchiver.archivedData(withRootObject: shimXPC, requiringSecureCoding: false)
    } catch {
        extensionLog("  [Remap] Archive failed: \(error)")
        return nil
    }

    guard let realClass = objc_getClass("WallpaperSettingsViewModelsXPC") as? AnyClass else {
        extensionLog("  [Remap] WallpaperSettingsViewModelsXPC class not found")
        return nil
    }

    guard let unarchiver = try? NSKeyedUnarchiver(forReadingFrom: data) else {
        extensionLog("  [Remap] Failed to create unarchiver")
        return nil
    }
    unarchiver.requiresSecureCoding = false
    unarchiver.decodingFailurePolicy = .setErrorAndReturn
    unarchiver.setClass(realClass, forClassName: "ShimViewModelsXPC")

    let result = unarchiver.decodeObject(forKey: NSKeyedArchiveRootObjectKey)
    if let error = unarchiver.error {
        extensionLog("  [Remap] Unarchive error: \(error)")
    }
    unarchiver.finishDecoding()

    if result == nil {
        extensionLog("  [Remap] Decoded result is nil")
    }
    return result as AnyObject?
}
