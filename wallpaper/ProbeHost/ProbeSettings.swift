import Foundation

struct ProbeOption: Codable {
    let id: String
    let en: String
    let sv: String
}

struct ProbeOptions: Codable {
    let cities: [ProbeOption]
    let themes: [ProbeOption]
    let variants: [ProbeOption]

    static func load(from bundle: Bundle) throws -> ProbeOptions {
        guard let url = bundle.url(forResource: "options", withExtension: "json") else {
            throw ProbeSettingsError.optionsMissing
        }
        return try JSONDecoder().decode(ProbeOptions.self, from: Data(contentsOf: url))
    }
}

enum ProbeSettingsError: LocalizedError {
    case optionsMissing, invalidSelection, containerMissing

    var errorDescription: String? {
        switch self {
        case .optionsMissing: return "Valen för bakgrunden saknas."
        case .invalidSelection: return "Bakgrundens sparade val är ogiltiga."
        case .containerMissing: return "Öppna Bakgrundsbild i Systeminställningar och försök igen."
        }
    }
}

struct ProbeSettings: Codable, Equatable {
    var city: String = "stockholm"
    var theme: String = "paper"
    var variant: String = ""

    func valid(in options: ProbeOptions) -> Bool {
        options.cities.contains { $0.id == city }
            && options.themes.contains { $0.id == theme }
            && (variant.isEmpty || options.variants.contains { $0.id == variant })
    }

    static func load(from url: URL, options: ProbeOptions) throws -> ProbeSettings {
        guard FileManager.default.fileExists(atPath: url.path) else { return ProbeSettings() }
        let value = try JSONDecoder().decode(ProbeSettings.self, from: Data(contentsOf: url))
        guard value.valid(in: options) else { throw ProbeSettingsError.invalidSelection }
        return value
    }

    func save(to url: URL, options: ProbeOptions) throws {
        guard valid(in: options) else { throw ProbeSettingsError.invalidSelection }
        guard FileManager.default.fileExists(atPath: url.deletingLastPathComponent().path) else {
            throw ProbeSettingsError.containerMissing
        }
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }

    var script: String {
        let data = (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
        return "window.lidscapeSaverOptions = Object.assign({quality:'high'}, \(String(decoding: data, as: UTF8.self)));"
    }
}

// Bridge the common group store to the scene's existing option types.
extension ProbeOptions {
    var sharedCatalog: WallpaperSettingsCatalog {
        WallpaperSettingsCatalog(cities: Set(cities.map(\.id)), themes: Set(themes.map(\.id)), variants: Set(variants.map(\.id)))
    }

    var sharedStore: WallpaperSharedSettingsStore {
        .appGroup(WallpaperSharedSettingsStore.groupIdentifier, catalog: sharedCatalog)
    }
}

extension ProbeSettings {
    init(shared: WallpaperSharedSettings) {
        self.init(city: shared.city, theme: shared.theme, variant: shared.variant)
    }

    var shared: WallpaperSharedSettings {
        WallpaperSharedSettings(city: city, theme: theme, variant: variant)
    }
}
