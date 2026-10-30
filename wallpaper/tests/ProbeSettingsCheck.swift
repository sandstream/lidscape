import Foundation

@main
struct ProbeSettingsCheck {
    static func main() throws {
        let optionsURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let options = try JSONDecoder().decode(ProbeOptions.self, from: Data(contentsOf: optionsURL))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("lidscape-wallpaper-settings-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let wallpaper = directory.appendingPathComponent("wallpaper.json")
        let saver = directory.appendingPathComponent("saver.json")
        let originalSaver = Data("unchanged".utf8)
        try originalSaver.write(to: saver)
        let selected = ProbeSettings(city: "stockholm", theme: "miniature", variant: "christmas")
        guard selected.valid(in: options) else { fatalError("Christmas options are missing") }
        try selected.save(to: wallpaper, options: options)
        let restored = try ProbeSettings.load(from: wallpaper, options: options)
        guard restored == selected else { fatalError("Settings did not persist") }
        guard !selected.script.contains("\"view\"") else { fatalError("View choice remains in scene options") }
        let legacy = Data("{\"city\":\"stockholm\",\"theme\":\"miniature\",\"variant\":\"christmas\",\"view\":\"map\"}".utf8)
        try legacy.write(to: wallpaper)
        guard try ProbeSettings.load(from: wallpaper, options: options) == selected else { fatalError("Legacy map settings were not preserved") }
        guard try Data(contentsOf: saver) == originalSaver else { fatalError("Screen saver settings changed") }
        let before = try Data(contentsOf: wallpaper)
        var invalid = selected
        invalid.city = "not-a-city"
        do { try invalid.save(to: wallpaper, options: options); fatalError("Invalid city was saved") }
        catch ProbeSettingsError.invalidSelection {}
        guard try Data(contentsOf: wallpaper) == before else { fatalError("Invalid save changed settings") }
        try Data("{}".utf8).write(to: wallpaper)
        do { _ = try ProbeSettings.load(from: wallpaper, options: options); fatalError("Invalid file was accepted") }
        catch is DecodingError {}
        let missing = directory.appendingPathComponent("missing/file.json")
        do { try selected.save(to: missing, options: options); fatalError("Missing container was accepted") }
        catch ProbeSettingsError.containerMissing {}
        guard selected.script.contains("christmas"), selected.script.contains("quality:'high'") else { fatalError("Scene options missing") }
        print("Wallpaper settings: OK")
    }
}
