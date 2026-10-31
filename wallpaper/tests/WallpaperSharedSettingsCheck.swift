import Foundation

@main
struct WallpaperSharedSettingsCheck {
    static func main() throws {
        let manager = FileManager.default
        let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("lidscape-shared-settings-\(UUID().uuidString)", isDirectory: true)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }

        let catalog = WallpaperSettingsCatalog(cities: ["stockholm"], themes: ["paper", "miniature"], variants: ["christmas"])
        let store = WallpaperSharedSettingsStore(catalog: catalog) { root }
        let defaults = try store.load()
        precondition(defaults == .standard)

        let saved = WallpaperSharedSettings(city: "stockholm", theme: "miniature", variant: "christmas")
        try store.save(saved)
        let secondStore = WallpaperSharedSettingsStore(catalog: catalog) { root }
        let readBack = try secondStore.load()
        precondition(readBack == saved)

        let target = root.appendingPathComponent(WallpaperSharedSettingsStore.filename)
        try Data(#"{"city":"stockholm","theme":"miniature","variant":"christmas","view":"map"}"#.utf8).write(to: target)
        let legacy = try store.load()
        precondition(legacy == saved)
        try store.save(saved)
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as! [String: String]
        precondition(object["view"] == nil)

        do {
            try store.save(WallpaperSharedSettings(city: "invalid", theme: "paper", variant: ""))
            fatalError("Invalid choices must be rejected")
        } catch WallpaperSharedSettingsError.invalidSelection {}
        let afterRejectedSave = try store.load()
        precondition(afterRejectedSave == saved)

        try Data(#"{"city":"stockholm","theme":"paper","variant":"invalid"}"#.utf8).write(to: target)
        do {
            _ = try store.load()
            fatalError("Invalid stored choices must be rejected")
        } catch WallpaperSharedSettingsError.invalidSelection {}
        try Data("not json".utf8).write(to: target)
        do {
            _ = try store.load()
            fatalError("Corrupt data must not be treated as missing")
        } catch is DecodingError {}

        let unavailable = WallpaperSharedSettingsStore(catalog: catalog) { nil }
        do {
            _ = try unavailable.load()
            fatalError("A missing group must be reported")
        } catch WallpaperSharedSettingsError.groupUnavailable {}
        do {
            try unavailable.save(saved)
            fatalError("A missing group must be reported")
        } catch WallpaperSharedSettingsError.groupUnavailable {}

        let badURL = WallpaperSharedSettingsStore(catalog: catalog) { URL(string: "https://example.invalid") }
        do {
            _ = try badURL.load()
            fatalError("A non-file group URL must be rejected")
        } catch WallpaperSharedSettingsError.groupUnavailable {}

        let missingDirectory = WallpaperSharedSettingsStore(catalog: catalog) {
            root.appendingPathComponent("missing", isDirectory: true)
        }
        do {
            _ = try missingDirectory.load()
            fatalError("A missing group directory must be reported")
        } catch WallpaperSharedSettingsError.groupUnavailable {}
        do {
            try missingDirectory.save(saved)
            fatalError("A missing group directory must be reported")
        } catch WallpaperSharedSettingsError.groupUnavailable {}

        print("Wallpaper shared settings: OK")
    }
}
