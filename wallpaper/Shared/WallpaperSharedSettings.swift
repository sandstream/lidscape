import Foundation

/// The wallpaper has its own choices, separate from the screen saver.
struct WallpaperSharedSettings: Codable, Equatable {
    var city: String
    var theme: String
    var variant: String

    static let standard = WallpaperSharedSettings(city: "stockholm", theme: "paper", variant: "")
}

/// The host generates these identifiers from the same catalog as the scene.
struct WallpaperSettingsCatalog {
    let cities: Set<String>
    let themes: Set<String>
    let variants: Set<String>

    func contains(_ settings: WallpaperSharedSettings) -> Bool {
        cities.contains(settings.city)
            && themes.contains(settings.theme)
            && (settings.variant.isEmpty || variants.contains(settings.variant))
    }
}

enum WallpaperSharedSettingsError: LocalizedError, Equatable {
    case groupUnavailable
    case invalidSelection

    var errorDescription: String? {
        switch self {
        case .groupUnavailable:
            return "The shared wallpaper settings are unavailable."
        case .invalidSelection:
            return "The wallpaper settings contain an invalid selection."
        }
    }
}

/// Host and extension must use the same signed App Group entitlement.
/// The resolver is injectable so failures and file handling can be tested.
struct WallpaperSharedSettingsStore {
    static let groupIdentifier = "VDE8E369XE.se.sandstream.lidscape.wallpaper"
    static let filename = "wallpaper-settings.json"
    private let catalog: WallpaperSettingsCatalog
    private let resolveContainer: () -> URL?

    init(catalog: WallpaperSettingsCatalog, resolveContainer: @escaping () -> URL?) {
        self.catalog = catalog
        self.resolveContainer = resolveContainer
    }

    static func appGroup(_ identifier: String, catalog: WallpaperSettingsCatalog) -> Self {
        Self(catalog: catalog) {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
        }
    }

    func load() throws -> WallpaperSharedSettings {
        let url = try settingsURL()
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            let defaults = WallpaperSharedSettings.standard
            guard catalog.contains(defaults) else { throw WallpaperSharedSettingsError.invalidSelection }
            return defaults
        }
        let value = try JSONDecoder().decode(WallpaperSharedSettings.self, from: data)
        guard catalog.contains(value) else { throw WallpaperSharedSettingsError.invalidSelection }
        return value
    }

    func save(_ value: WallpaperSharedSettings) throws {
        guard catalog.contains(value) else { throw WallpaperSharedSettingsError.invalidSelection }
        let url = try settingsURL()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(value).write(to: url, options: .atomic)
    }

    private func settingsURL() throws -> URL {
        guard let base = resolveContainer(), base.isFileURL else {
            throw WallpaperSharedSettingsError.groupUnavailable
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: base.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw WallpaperSharedSettingsError.groupUnavailable
        }
        return base.appendingPathComponent(Self.filename, isDirectory: false)
    }
}
