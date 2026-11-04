import AppKit

enum WallpaperRegistration {
    static let extensionID = "se.sandstream.lidscape.wallpaper.extension"

    static func containsExpectedExtension(_ output: String, path: String) -> Bool {
        output.split(separator: "\n").contains { line in
            let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard fields.count >= 4 else { return false }
            let identity = fields[0].trimmingCharacters(in: .whitespaces)
            guard !identity.hasPrefix("-") else { return false }
            let enabledIdentity = identity.hasPrefix("+")
                ? String(identity.dropFirst()).trimmingCharacters(in: .whitespaces)
                : identity
            return enabledIdentity.hasPrefix(extensionID + "(") && String(fields.last!) == path
        }
    }

    // This mode checks discovery only. It does not claim that the wallpaper is selected.
    static func waitForDiscovery(bundleURL: URL) -> Int32 {
        let path = bundleURL.appendingPathComponent("Contents/Extensions/LidscapeWallpaperExtension.appex")
            .standardizedFileURL.path
        let deadline = Date().addingTimeInterval(10)
        repeat {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/pluginkit")
            task.arguments = ["-m", "-A", "-D", "-v", "-i", extensionID]
            let output = Pipe()
            task.standardOutput = output
            task.standardError = FileHandle.nullDevice
            do {
                try task.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                task.waitUntilExit()
                if task.terminationStatus == 0,
                   let text = String(data: data, encoding: .utf8),
                   containsExpectedExtension(text, path: path) { return 0 }
            } catch {
                FileHandle.standardError.write(Data("Cannot check wallpaper extension registration.\n".utf8))
                return 1
            }
            Thread.sleep(forTimeInterval: 0.2)
        } while Date() < deadline
        FileHandle.standardError.write(Data("Wallpaper extension was not discovered.\n".utf8))
        return 1
    }
}

@main
final class ProbeApp: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private let city = NSPopUpButton()
    private let theme = NSPopUpButton()
    private let variant = NSPopUpButton()
    private let status = NSTextField(wrappingLabelWithString: "")
    private var options: ProbeOptions?

    static func main() {
        if CommandLine.arguments.dropFirst().contains("--register-only") {
            exit(WallpaperRegistration.waitForDiscovery(bundleURL: Bundle.main.bundleURL))
        }
        let app = NSApplication.shared
        let delegate = ProbeApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        withExtendedLifetime(delegate) {}
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 510, height: 340),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Lidscape bakgrund"
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Lidscape som bakgrund")
        title.font = NSFont.boldSystemFont(ofSize: 18)
        stack.addArrangedSubview(title)
        let rows = NSGridView(views: [
            [NSTextField(labelWithString: "Stad"), city],
            [NSTextField(labelWithString: "Tema"), theme],
            [NSTextField(labelWithString: "Variant"), variant],
        ])
        rows.rowSpacing = 8
        rows.columnSpacing = 14
        stack.addArrangedSubview(rows)
        let buttons = NSStackView()
        buttons.spacing = 10
        buttons.addArrangedSubview(NSButton(title: "Spara", target: self, action: #selector(save)))
        buttons.addArrangedSubview(NSButton(title: "Öppna Bakgrundsbild", target: self, action: #selector(openSettings)))
        stack.addArrangedSubview(buttons)
        status.textColor = .secondaryLabelColor
        stack.addArrangedSubview(status)
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 22),
        ])
        self.window = window
        loadChoices()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func addChoices(_ choices: [ProbeOption], to control: NSPopUpButton) {
        for option in choices {
            control.addItem(withTitle: option.sv)
            control.lastItem?.representedObject = option.id
        }
    }

    private func select(_ id: String, in control: NSPopUpButton) {
        if let item = control.itemArray.first(where: { $0.representedObject as? String == id }) {
            control.select(item)
        }
    }

    private func selected(_ control: NSPopUpButton) -> String {
        control.selectedItem?.representedObject as? String ?? ""
    }

    private func loadChoices() {
        do {
            let extensionURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Extensions/LidscapeWallpaperExtension.appex")
            guard let extensionBundle = Bundle(url: extensionURL) else { throw ProbeSettingsError.optionsMissing }
            let options = try ProbeOptions.load(from: extensionBundle)
            self.options = options
            addChoices(options.cities, to: city)
            addChoices(options.themes, to: theme)
            variant.addItem(withTitle: "Ingen")
            variant.lastItem?.representedObject = ""
            addChoices(options.variants, to: variant)
            let settings: ProbeSettings
            do { settings = ProbeSettings(shared: try options.sharedStore.load()) }
            catch {
                settings = ProbeSettings()
                status.stringValue = "Kunde inte läsa sparade val: \(error.localizedDescription) Välj nya och spara."
            }
            select(settings.city, in: city)
            select(settings.theme, in: theme)
            select(settings.variant, in: variant)
        } catch {
            status.stringValue = "Kunde inte läsa valen: \(error.localizedDescription)"
        }
    }

    @objc private func save() {
        do {
            guard let options else { throw ProbeSettingsError.optionsMissing }
            let settings = ProbeSettings(city: selected(city), theme: selected(theme),
                                         variant: selected(variant))
            try options.sharedStore.save(settings.shared)
            status.stringValue = "Bakgrundens inställningar är sparade."
        } catch { status.stringValue = "Kunde inte spara: \(error.localizedDescription)" }
    }

    @objc private func openSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension") else { return }
        NSWorkspace.shared.open(url)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
