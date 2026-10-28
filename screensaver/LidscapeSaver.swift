import AppKit
import ScreenSaver
import WebKit
import os

private struct SaverSettings: Codable {
    let city: String
    let theme: String
    let variant: String
    let view: String
}

private struct SaverOption: Decodable {
    let id: String
    let en: String
    let sv: String

    func name(swedish: Bool) -> String { swedish ? sv : en }
}

private struct SaverOptions: Decodable {
    let cities: [SaverOption]
    let themes: [SaverOption]
    let variants: [SaverOption]
}

private let saverBundleID = "se.sandstream.lidscape.screensaver"
private let oldSaverBundleID = "se.sandstream.lidscape.saver"
private let saverLog = Logger(subsystem: saverBundleID, category: "screen-saver")

@objc(LidscapeSaverView)
final class LidscapeSaverView: ScreenSaverView, WKNavigationDelegate {
    private lazy var saverDefaults = ScreenSaverDefaults(forModuleWithName: saverBundleID)
    private lazy var thumbnail: NSImage? = {
        guard let url = Bundle(for: Self.self).url(forResource: "thumbnail", withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }()
    private var webView: WKWebView?
    private var fallbackView: NSImageView?
    private var bridge: Process?
    private var settingsSheet: NSWindow?
    private var viewChoice: NSPopUpButton?
    private var cityChoice: NSPopUpButton?
    private var themeChoice: NSPopUpButton?
    private var variantChoice: NSPopUpButton?
    private var settingsError: NSTextField?
    private var swedish: Bool { Locale.preferredLanguages.first?.hasPrefix("sv") == true }

    override var hasConfigureSheet: Bool { true }

    override var configureSheet: NSWindow? {
        let options = loadOptions()
        let current = loadSettings()
        let sheet = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 300),
            styleMask: [.titled], backing: .buffered, defer: false
        )
        sheet.title = swedish ? "Lidscape: skärmsläckare" : "Lidscape screen saver"
        let content = NSView(frame: sheet.contentRect(forFrameRect: sheet.frame))
        sheet.contentView = content

        let view = choice([
            SaverOption(id: "city", en: "City", sv: "Stad"),
            SaverOption(id: "map", en: "World map", sv: "Världskarta"),
        ], selected: current.view)
        let city = choice(options.cities, selected: current.city)
        let theme = choice(options.themes, selected: current.theme)
        let variant = choice(
            [SaverOption(id: "", en: "None", sv: "Ingen")] + options.variants,
            selected: current.variant
        )
        view.target = self
        view.action = #selector(viewChanged)
        viewChoice = view
        cityChoice = city
        themeChoice = theme
        variantChoice = variant

        let rows: [(String, NSPopUpButton)] = [
            (swedish ? "Bild" : "Picture", view),
            (swedish ? "Stad" : "City", city),
            (swedish ? "Tema" : "Theme", theme),
            (swedish ? "Variant" : "Variant", variant),
        ]
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        for (title, popup) in rows {
            let label = NSTextField(labelWithString: title)
            label.alignment = .right
            label.widthAnchor.constraint(equalToConstant: 85).isActive = true
            popup.widthAnchor.constraint(equalToConstant: 250).isActive = true
            let row = NSStackView(views: [label, popup])
            row.orientation = .horizontal
            row.spacing = 12
            stack.addArrangedSubview(row)
        }
        let error = NSTextField(labelWithString: "")
        error.textColor = .systemRed
        error.lineBreakMode = .byWordWrapping
        error.maximumNumberOfLines = 2
        stack.addArrangedSubview(error)
        settingsError = error

        let cancel = NSButton(title: swedish ? "Avbryt" : "Cancel", target: self, action: #selector(closeConfiguration))
        cancel.keyEquivalent = "\u{1b}"
        let save = NSButton(title: swedish ? "Spara" : "Save", target: self, action: #selector(saveConfiguration))
        save.keyEquivalent = "\r"
        let actions = NSStackView(views: [cancel, save])
        actions.orientation = .horizontal
        actions.spacing = 10
        actions.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(actions)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.widthAnchor.constraint(equalToConstant: 347),
            actions.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -25),
            actions.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -22),
        ])
        settingsSheet = sheet
        viewChanged()
        return sheet
    }

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        wantsLayer = true
        layer?.backgroundColor = NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    private var showsThumbnail: Bool { isPreview || min(bounds.width, bounds.height) < 400 }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).setFill()
        dirtyRect.fill()
        if showsThumbnail {
            thumbnail?.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
        }
    }

    override func startAnimation() {
        super.startAnimation()
        saverLog.debug("start preview=\(self.isPreview) size=\(self.bounds.width)x\(self.bounds.height) thumbnail=\(self.showsThumbnail) visible=\(self.window?.occlusionState.contains(.visible) == true)")
        guard fallbackView == nil else { return }
        let fallback = NSImageView(frame: bounds)
        fallback.image = thumbnail
        fallback.imageScaling = .scaleAxesIndependently
        fallback.autoresizingMask = [.width, .height]
        addSubview(fallback)
        fallbackView = fallback
        if showsThumbnail {
            return
        }
        let bundle = Bundle(for: Self.self)
        guard let resources = bundle.resourceURL,
              let page = bundle.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            NSLog("Lidscape saver: bundled page is missing")
            return
        }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let settings = loadSettings()
        let options: [String: String] = [
            "city": settings.city,
            "theme": settings.theme,
            "variant": settings.variant,
            "view": settings.view,
            "quality": isPreview ? "low" : "high",
        ]
        if let data = try? JSONSerialization.data(withJSONObject: options),
           let json = String(data: data, encoding: .utf8) {
            let script = WKUserScript(source: "window.lidscapeSaverOptions = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            configuration.userContentController.addUserScript(script)
        }
        let view = WKWebView(frame: bounds, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.underPageBackgroundColor = NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1)
        addSubview(view)
        webView = view
        addSubview(fallback, positioned: .above, relativeTo: view)
        updateFallback()
        view.loadFileURL(page, allowingReadAccessTo: resources)
        if !isPreview { startBridge(resources: resources) }
    }

    override func animateOneFrame() {
        super.animateOneFrame()
        updateFallback()
    }

    private func updateFallback() {
        let shouldShow = showsThumbnail || window?.occlusionState.contains(.visible) != true
        if fallbackView?.isHidden != !shouldShow {
            saverLog.debug("fallback visible=\(shouldShow) windowVisible=\(self.window?.occlusionState.contains(.visible) == true)")
            fallbackView?.isHidden = !shouldShow
        }
    }

    override func stopAnimation() {
        fallbackView?.removeFromSuperview()
        fallbackView = nil
        webView?.evaluateJavaScript("window.lidscapeSaver?.stop()") { _, _ in }
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        if bridge?.isRunning == true { bridge?.terminate() }
        bridge = nil
        super.stopAnimation()
    }

    private func loadSettings() -> SaverSettings {
        let fallback = SaverSettings(city: "stockholm", theme: "paper", variant: "", view: "city")
        let saved = saverDefaults?.string(forKey: "settingsJSON")
            ?? ScreenSaverDefaults(forModuleWithName: oldSaverBundleID)?.string(forKey: "settingsJSON")
        if let saved,
           let data = saved.data(using: .utf8),
           let settings = try? JSONDecoder().decode(SaverSettings.self, from: data) {
            return settings
        }
        return fallback
    }

    private func loadOptions() -> SaverOptions {
        let fallback = SaverOptions(
            cities: [SaverOption(id: "stockholm", en: "Stockholm", sv: "Stockholm")],
            themes: [SaverOption(id: "paper", en: "Paper", sv: "Papper")],
            variants: []
        )
        guard let url = Bundle(for: Self.self).url(forResource: "options", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return fallback }
        return (try? JSONDecoder().decode(SaverOptions.self, from: data)) ?? fallback
    }

    private func choice(_ options: [SaverOption], selected: String) -> NSPopUpButton {
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        for (index, option) in options.enumerated() {
            popup.addItem(withTitle: option.name(swedish: swedish))
            popup.item(at: index)?.representedObject = option.id
            if option.id == selected { popup.selectItem(at: index) }
        }
        return popup
    }

    private func selected(_ popup: NSPopUpButton?) -> String {
        popup?.selectedItem?.representedObject as? String ?? ""
    }

    @objc private func viewChanged() {
        let cityIsVisible = selected(viewChoice) == "city"
        cityChoice?.isEnabled = cityIsVisible
        variantChoice?.isEnabled = cityIsVisible
    }

    @objc private func closeConfiguration() {
        guard let sheet = settingsSheet else { return }
        sheet.sheetParent?.endSheet(sheet)
        sheet.orderOut(nil)
        settingsSheet = nil
    }

    @objc private func saveConfiguration() {
        guard let defaults = saverDefaults else {
            settingsError?.stringValue = swedish ? "Kan inte öppna skärmsläckarens inställningar." : "Cannot open screen saver settings."
            return
        }
        let settings = SaverSettings(
            city: selected(cityChoice), theme: selected(themeChoice),
            variant: selected(variantChoice), view: selected(viewChoice)
        )
        do {
            let data = try JSONEncoder().encode(settings)
            guard let value = String(data: data, encoding: .utf8) else { return }
            defaults.set(value, forKey: "settingsJSON")
            guard defaults.synchronize() else {
                settingsError?.stringValue = swedish ? "Inställningarna kunde inte sparas." : "The settings could not be saved."
                return
            }
            closeConfiguration()
        } catch {
            settingsError?.stringValue = error.localizedDescription
        }
    }

    private func startBridge(resources: URL) {
        let binary = resources.appendingPathComponent("lid-bridge")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else { return }
        let process = Process()
        process.executableURL = binary
        do {
            try process.run()
            bridge = process
        } catch {
            NSLog("Lidscape saver: lid bridge did not start: %@", error.localizedDescription)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Lidscape saver: page did not load: %@", error.localizedDescription)
    }
}
