import AppKit
import ScreenSaver
import WebKit
import os

private struct SaverSettings: Codable {
    let city: String
    let theme: String
    let variant: String
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
private var sensorLaunchRequestedAt: Date?
private let sensorLaunchRetryInterval: TimeInterval = 5

private struct PageRetryState {
    private(set) var delay: TimeInterval = 1
    private var generation = 0
    private var pending = false

    mutating func schedule() -> (generation: Int, delay: TimeInterval)? {
        guard !pending else { return nil }
        pending = true
        generation += 1
        let result = (generation, delay)
        delay = min(delay * 2, 30)
        return result
    }

    mutating func begin(generation: Int) -> Bool {
        guard pending, generation == self.generation else { return false }
        pending = false
        return true
    }

    mutating func cancel() {
        pending = false
        generation += 1
    }

    mutating func markHealthy() { delay = 1 }
}

private final class WeakFrameHandler: NSObject, WKScriptMessageHandler {
    weak var receiver: WKScriptMessageHandler?

    init(receiver: WKScriptMessageHandler) {
        self.receiver = receiver
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        receiver?.userContentController(userContentController, didReceive: message)
    }
}

@objc(LidscapeSaverView)
final class LidscapeSaverView: ScreenSaverView, WKNavigationDelegate, WKScriptMessageHandler {
    private lazy var saverDefaults = ScreenSaverDefaults(forModuleWithName: saverBundleID)
    private var poster: NSImage?
    private var webView: WKWebView?
    private var fallbackView: NSImageView?
    private var fallbackTimer: Timer?
    private var animationActive = false
    private var lastRenderSeen: Date?
    private var renderStartedAt: Date?
    private var pageRetry = PageRetryState()
    private var pageURL: URL?
    private var resourcesURL: URL?
    private var sensorSession: URLSession?
    private var sensorTask: URLSessionWebSocketTask?
    private var sensorHeartbeatTimer: Timer?
    private var sensorRetryDelay = 0.25
    private var sensorActive = false
    private var sensorHelperURL: URL?
    private var lastLidAngle: Int?
    private var settingsSheet: NSWindow?
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

        let city = choice(options.cities, selected: current.city)
        let theme = choice(options.themes, selected: current.theme)
        let variant = choice(
            [SaverOption(id: "", en: "None", sv: "Ingen")] + options.variants,
            selected: current.variant
        )
        cityChoice = city
        themeChoice = theme
        variantChoice = variant

        let rows: [(String, NSPopUpButton)] = [
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
        return sheet
    }

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        wantsLayer = true
        layer?.backgroundColor = NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).cgColor
        layer?.contentsGravity = .resize
        refreshPoster()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    private var showsThumbnail: Bool { isPreview || min(bounds.width, bounds.height) < 400 }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).setFill()
        dirtyRect.fill()
        poster?.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
    }

    override func startAnimation() {
        super.startAnimation()
        animationActive = true
        refreshPoster()
        if fallbackTimer == nil {
            let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.updateFallback() }
            timer.tolerance = 0.05
            RunLoop.main.add(timer, forMode: .common)
            fallbackTimer = timer
        }
        saverLog.debug("start preview=\(self.isPreview) size=\(self.bounds.width)x\(self.bounds.height)")
        if let fallbackView {
            fallbackView.removeFromSuperview()
            addSubview(fallbackView, positioned: .above, relativeTo: webView)
            fallbackView.needsDisplay = true
        } else {
            let fallback = NSImageView(frame: bounds)
            fallback.image = poster
            fallback.imageScaling = .scaleAxesIndependently
            fallback.autoresizingMask = [.width, .height]
            addSubview(fallback)
            fallbackView = fallback
        }
        startLiveSceneIfNeeded()
        updateFallback()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        guard animationActive else { return }
        startLiveSceneIfNeeded()
        updateFallback()
    }

    private func startLiveSceneIfNeeded() {
        guard animationActive, !showsThumbnail, webView == nil, let fallback = fallbackView else { return }
        let bundle = Bundle(for: Self.self)
        guard let resources = bundle.resourceURL,
              let page = bundle.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            NSLog("Lidscape saver: bundled page is missing")
            return
        }
        pageURL = page
        resourcesURL = resources
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(WeakFrameHandler(receiver: self), name: "lidscapeFrame")
        let settings = loadSettings()
        let options: [String: String] = [
            "city": settings.city,
            "theme": settings.theme,
            "variant": settings.variant,
            "quality": isPreview ? "low" : "high",
        ]
        if let data = try? JSONSerialization.data(withJSONObject: options),
           let json = String(data: data, encoding: .utf8) {
            let script = WKUserScript(source: "window.lidscapeSaverOptions = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true)
            configuration.userContentController.addUserScript(script)
        }
        let view = WKWebView(frame: bounds, configuration: configuration)
        // macOS can mark the screen saver window as occluded while it is visible.
        let occlusion = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if view.responds(to: occlusion) {
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(view.method(for: occlusion), to: Setter.self)(view, occlusion, false)
        } else {
            saverLog.warning("WebKit window occlusion override is unavailable")
        }
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.underPageBackgroundColor = NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1)
        webView = view
        addSubview(view)
        addSubview(fallback, positioned: .above, relativeTo: view)
        updateFallback()
        view.loadFileURL(page, allowingReadAccessTo: resources)
        if !isPreview { startSensor(resources: resources) }
    }

    override func animateOneFrame() {
        super.animateOneFrame()
        updateFallback()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "lidscapeFrame", let webView, message.webView === webView else { return }
        let now = Date()
        if lastRenderSeen == nil { saverLog.notice("first rendered frame") }
        if lastRenderSeen.map({ now.timeIntervalSince($0) < 0.75 }) != true {
            renderStartedAt = now
        }
        lastRenderSeen = now
        if let started = renderStartedAt, now.timeIntervalSince(started) >= 10 { pageRetry.markHealthy() }
        updateFallback()
    }

    private func updateFallback() {
        let now = Date()
        let isLive = lastRenderSeen.map { now.timeIntervalSince($0) < 0.75 } == true
            && renderStartedAt.map { now.timeIntervalSince($0) >= 1 } == true
        let shouldShow = showsThumbnail || !isLive
        if fallbackView?.isHidden != !shouldShow {
            saverLog.debug("fallback visible=\(shouldShow)")
            fallbackView?.isHidden = !shouldShow
        }
    }

    override func stopAnimation() {
        animationActive = false
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        lastRenderSeen = nil
        renderStartedAt = nil
        pageRetry.cancel()
        pageRetry.markHealthy()
        pageURL = nil
        resourcesURL = nil
        fallbackView?.removeFromSuperview()
        fallbackView = nil
        webView?.evaluateJavaScript("window.lidscapeSaver?.stop()") { _, _ in }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "lidscapeFrame")
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        sensorActive = false
        sensorHeartbeatTimer?.invalidate()
        sensorHeartbeatTimer = nil
        sensorTask?.cancel(with: .goingAway, reason: nil)
        sensorTask = nil
        sensorSession?.invalidateAndCancel()
        sensorSession = nil
        sensorHelperURL = nil
        lastLidAngle = nil
        super.stopAnimation()
    }

    private func loadSettings() -> SaverSettings {
        let fallback = SaverSettings(city: "stockholm", theme: "paper", variant: "")
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
            variant: selected(variantChoice)
        )
        do {
            let data = try JSONEncoder().encode(settings)
            guard let value = String(data: data, encoding: .utf8) else { return }
            defaults.set(value, forKey: "settingsJSON")
            guard defaults.synchronize() else {
                settingsError?.stringValue = swedish ? "Inställningarna kunde inte sparas." : "The settings could not be saved."
                return
            }
            refreshPoster()
            closeConfiguration()
        } catch {
            settingsError?.stringValue = error.localizedDescription
        }
    }

    private func refreshPoster() {
        let settings = loadSettings()
        let options = loadOptions()
        let themeIsValid = options.themes.contains { $0.id == settings.theme }
        let cityIsValid = options.cities.contains { $0.id == settings.city }
        let variantIsValid = settings.variant.isEmpty || options.variants.contains { $0.id == settings.variant }
        var name = "poster"
        if themeIsValid && cityIsValid && variantIsValid {
            let variant = settings.variant.isEmpty ? "none" : settings.variant
            name = "poster-city-\(settings.city)-\(settings.theme)-\(variant)"
        }
        let bundle = Bundle(for: Self.self)
        let url = bundle.url(forResource: name, withExtension: "png")
            ?? bundle.url(forResource: "poster", withExtension: "png")
        poster = url.flatMap { NSImage(contentsOf: $0) }
        layer?.contents = poster?.cgImage(forProposedRect: nil, context: nil, hints: nil)
        fallbackView?.image = poster
        needsDisplay = true
    }

    private func startSensor(resources: URL) {
        sensorActive = true
        sensorRetryDelay = 0.25
        sensorHelperURL = resources.appendingPathComponent("Lidscape Sensor.app")
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            self?.sensorTask?.send(.string("keepalive")) { _ in }
        }
        RunLoop.main.add(timer, forMode: .common)
        sensorHeartbeatTimer = timer
        connectSensor()
    }

    private func requestSensorLaunch(now: Date = Date()) {
        guard let helper = sensorHelperURL,
              FileManager.default.fileExists(atPath: helper.path) else { return }
        if let last = sensorLaunchRequestedAt {
            let elapsed = now.timeIntervalSince(last)
            if elapsed >= 0 && elapsed < sensorLaunchRetryInterval { return }
        }
        sensorLaunchRequestedAt = now
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false
        NSWorkspace.shared.openApplication(at: helper, configuration: configuration) { _, error in
            if let error {
                saverLog.error("lid sensor app did not start: \(error.localizedDescription)")
            }
        }
    }

    private func connectSensor() {
        guard sensorActive, sensorTask == nil, let url = URL(string: "ws://127.0.0.1:8787") else { return }
        let session = URLSession(configuration: .ephemeral)
        let task = session.webSocketTask(with: url)
        sensorSession = session
        sensorTask = task
        task.resume()
        receiveSensor(task)
    }

    private func receiveSensor(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async { [weak self] in
                guard let self, self.sensorActive, self.sensorTask === task else { return }
                switch result {
                case .success(.string(let text)):
                    self.handleSensorMessage(text)
                    self.receiveSensor(task)
                case .success(.data):
                    self.receiveSensor(task)
                case .failure:
                    self.clearLidAngle()
                    self.sensorTask = nil
                    self.sensorSession?.invalidateAndCancel()
                    self.sensorSession = nil
                    self.requestSensorLaunch()
                    let delay = self.sensorRetryDelay
                    self.sensorRetryDelay = min(delay * 2, 3)
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connectSensor() }
                @unknown default:
                    self.receiveSensor(task)
                }
            }
        }
    }

    private func handleSensorMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if message["sensor"] as? Bool == false {
            clearLidAngle()
            return
        }
        guard let angle = message["angle"] as? Int, (0...180).contains(angle) else { return }
        if lastLidAngle == nil { saverLog.notice("lid sensor connected") }
        sensorLaunchRequestedAt = nil
        sensorRetryDelay = 0.25
        lastLidAngle = angle
        sendLidAngle(angle)
    }

    private func clearLidAngle() {
        lastLidAngle = nil
        webView?.evaluateJavaScript("window.lidscapeSaverClearLidAngle?.()") { _, _ in }
    }

    private func sendLidAngle(_ angle: Int) {
        webView?.evaluateJavaScript("window.lidscapeSaverSetLidAngle?.(\(angle))") { _, _ in }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard self.webView === webView else { return }
        pageRetry.cancel()
        if let lastLidAngle { sendLidAngle(lastLidAngle) }
    }

    private func schedulePageReload(_ view: WKWebView) {
        guard webView === view, pageURL != nil, resourcesURL != nil else { return }
        lastRenderSeen = nil
        renderStartedAt = nil
        updateFallback()
        guard let retry = pageRetry.schedule() else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + retry.delay) { [weak self, weak view] in
            guard let self, let view, self.webView === view,
                  let page = self.pageURL, let resources = self.resourcesURL,
                  self.pageRetry.begin(generation: retry.generation) else { return }
            view.loadFileURL(page, allowingReadAccessTo: resources)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        saverLog.error("WebKit content process stopped")
        schedulePageReload(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        saverLog.error("screen saver page did not load: \(error.localizedDescription)")
        schedulePageReload(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        saverLog.error("screen saver page failed: \(error.localizedDescription)")
        schedulePageReload(webView)
    }
}
