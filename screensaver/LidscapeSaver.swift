import AppKit
import ScreenSaver
import WebKit
import os

private struct SaverSettings: Codable, Equatable {
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
private let firstFrameTimeout: TimeInterval = 15
private let stalledFrameTimeout: TimeInterval = 5
private let heldReleaseTimeout: TimeInterval = 2
private let heldReleaseAttempts = 3

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

private final class SensorPing: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Result<Void, Error>?
    let startedAt = ProcessInfo.processInfo.systemUptime

    func complete(_ error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        guard stored == nil else { return }
        stored = error.map { .failure($0) } ?? .success(())
    }

    var result: Result<Void, Error>? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

/// Fill the screen without stretching, even when it is wider than the poster.
func posterRect(_ image: NSSize, in bounds: NSRect) -> NSRect {
    guard image.width > 0, image.height > 0 else { return bounds }
    let scale = max(bounds.width / image.width, bounds.height / image.height)
    let width = image.width * scale
    let height = image.height * scale
    return NSRect(x: bounds.midX - width / 2, y: bounds.midY - height / 2, width: width, height: height)
}

final class PosterView: NSView {
    var image: NSImage? { didSet { needsDisplay = true } }
    private(set) var fading = false

    /// Showing the poster again cancels a fade at once.
    override var isHidden: Bool {
        didSet {
            guard !isHidden else { return }
            fading = false
            alphaValue = 1
        }
    }

    /// Fade instead of cutting: the live brush pattern never lines up with the poster's.
    func fadeOut() {
        guard !isHidden, !fading else { return }
        fading = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.5
            animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.fading else { return }
                self.fading = false
                self.isHidden = true
                self.alphaValue = 1
            }
        })
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let image else { return }
        image.draw(in: posterRect(image.size, in: bounds), from: .zero, operation: .sourceOver, fraction: 1)
    }
}

@objc(LidscapeSaverView)
final class LidscapeSaverView: ScreenSaverView, WKNavigationDelegate, WKScriptMessageHandler {
    private lazy var saverDefaults = ScreenSaverDefaults(forModuleWithName: saverBundleID)
    private var poster: NSImage?
    private var webView: WKWebView?
    private var fallbackView: PosterView?
    private var fallbackTimer: Timer?
    private var animationActive = false
    private var lastRenderSeen: Date?
    private var renderStartedAt: Date?
    private var pageRetry = PageRetryState()
    private var pageURL: URL?
    private var resourcesURL: URL?
    private var currentNavigation: WKNavigation?
    private var pageSettings: SaverSettings?
    private var pageLoadStartedAt: Date?
    private var sensorSession: URLSession?
    private var sensorTask: URLSessionWebSocketTask?
    private var sensorHeartbeatTimer: Timer?
    private var sensorPingPending: SensorPing?
    private var sensorPingTimeoutScheduled = false
    private var sensorRetryDelay = 0.25
    private var sensorActive = false
    private var sensorHelperURL: URL?
    private var lastLidAngle: Int?
    /// The poster is a saved copy of this screen's first live frame. The page holds
    /// that frame until the poster goes, so the swap shows no change.
    private var posterIsHeldFrame = false
    private var heldFrameRequested = false
    private var heldFramePending: (id: String, target: URL)?
    private var heldFrameCaptureAllowed = true
    private var heldFrameCaptureFailures = 0
    private var heldReleaseConfirmed = false
    private var heldReleaseAttempt: UUID?
    private var heldReleaseOutstanding: Set<UUID> = []
    private var heldReleaseBlockedLogged = false
    private var heldReleaseRequestedAt: TimeInterval?
    private var heldReleaseFailures = 0
    private var heldReleaseReloadPending = false
    private var heldReleaseReloadStarted = false
    private var heldReleaseNavigation: WKNavigation?
    static var heldFrameDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent(saverBundleID, isDirectory: true)
        .appendingPathComponent("held-frames", isDirectory: true)
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
        refreshPoster()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    private var showsThumbnail: Bool { isPreview || min(bounds.width, bounds.height) < 400 }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).setFill()
        dirtyRect.fill()
        if let poster { poster.draw(in: posterRect(poster.size, in: bounds), from: .zero, operation: .sourceOver, fraction: 1) }
    }

    override func startAnimation() {
        super.startAnimation()
        animationActive = true
        resetHeldRelease()
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
            let fallback = PosterView(frame: bounds)
            fallback.image = poster
            fallback.autoresizingMask = [.width, .height]
            addSubview(fallback)
            fallbackView = fallback
        }
        startLiveSceneIfNeeded()
        updateFallback()
    }

    override func setFrameSize(_ newSize: NSSize) {
        let changed = frame.size != newSize
        super.setFrameSize(newSize)
        if changed { invalidateHeldCapture() }
        guard animationActive else { return }
        refreshPoster()
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
        configuration.userContentController.add(WeakFrameHandler(receiver: self), name: "lidscapeCapture")
        heldFrameRequested = false
        heldFramePending = nil
        heldFrameCaptureAllowed = true
        heldFrameCaptureFailures = 0
        let settings = loadSettings()
        pageSettings = settings
        let options: [String: String] = [
            "city": settings.city,
            "theme": settings.theme,
            "variant": settings.variant,
            "quality": isPreview ? "low" : "high",
            "hold": "1",
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
        heldReleaseOutstanding.removeAll()
        heldReleaseBlockedLogged = false
        addSubview(view)
        addSubview(fallback, positioned: .above, relativeTo: view)
        updateFallback()
        pageLoadStartedAt = Date()
        currentNavigation = view.loadFileURL(page, allowingReadAccessTo: resources)
        if !isPreview { startSensor(resources: resources) }
    }

    override func animateOneFrame() {
        super.animateOneFrame()
        updateFallback()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let webView, message.webView === webView else { return }
        if message.name == "lidscapeCapture" {
            guard let body = message.body as? [String: Any],
                  let id = body["id"] as? String, let dataURL = body["data"] as? String,
                  let pending = heldFramePending, pending.id == id else { return }
            heldFramePending = nil
            guard let pageSettings, pageSettings == loadSettings(), pending.target == heldFrameURL() else {
                if heldFrameCaptureAllowed { heldFrameRequested = false }
                return
            }
            heldFrameCaptureFailures = 0
            let target = pending.target
            DispatchQueue.global(qos: .utility).async {
                if Self.saveHeldFrame(dataURL, to: target) { Self.pruneHeldFrames(keeping: target) }
            }
            return
        }
        guard message.name == "lidscapeFrame" else { return }
        noteRenderedFrame(now: Date())
    }

    /// One saved frame per screen size, settings, and build. The page's code is part
    /// of the key, because a changed scene must not show an old frame.
    func heldFrameURL() -> URL? {
        heldFrameURL(for: loadSettings())
    }

    private func heldFrameURL(for settings: SaverSettings) -> URL? {
        guard let directory = Self.heldFrameDirectory, bounds.width >= 1, bounds.height >= 1 else { return nil }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        let page = Bundle(for: Self.self).url(forResource: "saver", withExtension: "js", subdirectory: "web")
        let attributes = page.flatMap { try? FileManager.default.attributesOfItem(atPath: $0.path) }
        let build = [
            Bundle(for: Self.self).object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
            String(attributes?[.size] as? Int ?? 0),
            String(Int((attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)),
        ].joined(separator: "-")
        let parts = [settings.city, settings.theme, settings.variant.isEmpty ? "none" : settings.variant,
                     "\(Int(bounds.width))x\(Int(bounds.height))@\(Int(scale * 100))", build]
        let name = parts.map { $0.filter { $0.isLetter || $0.isNumber || "-x@".contains($0) } }.joined(separator: "_")
        return directory.appendingPathComponent(name).appendingPathExtension("png")
    }

    /// Accept only a PNG that decodes, and only up to the size of a large screen.
    nonisolated static func saveHeldFrame(_ dataURL: String, to target: URL) -> Bool {
        let prefix = "data:image/png;base64,"
        guard dataURL.hasPrefix(prefix), dataURL.utf8.count < 96_000_000,
              let data = Data(base64Encoded: String(dataURL.dropFirst(prefix.count))),
              data.starts(with: [0x89, 0x50, 0x4E, 0x47]),
              NSBitmapImageRep(data: data) != nil else { return false }
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Keep the newest few frames, so old sizes and settings do not fill the disk.
    nonisolated static func pruneHeldFrames(keeping current: URL, limit: Int = 6) {
        let directory = current.deletingLastPathComponent()
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let dated = files.filter { $0.pathExtension == "png" }.map { url in
            (url, (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(limit) where url != current {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func noteRenderedFrame(now: Date) {
        // Frames from the previous page must not cancel a scheduled reload.
        guard !heldReleaseReloadPending else { return }
        if lastRenderSeen == nil {
            saverLog.notice("first rendered frame")
            pageRetry.cancel()
        }
        // Save this screen's held frame once, while the page still holds it.
        if heldFrameCaptureAllowed, !posterIsHeldFrame, !heldFrameRequested,
           let pageSettings, pageSettings == loadSettings(),
           let target = heldFrameURL(), let webView {
            heldFrameRequested = true
            let id = UUID().uuidString
            heldFramePending = (id, target)
            let script = "(() => { if (typeof window.lidscapeSaverCapture !== 'function') return false; return window.lidscapeSaverCapture('\(id)') === true; })()"
            webView.evaluateJavaScript(script) { [weak self, weak webView] result, error in
                guard let self, let webView, self.animationActive, self.webView === webView,
                      self.heldFramePending?.id == id else { return }
                guard error != nil || result as? Bool != true else { return }
                self.heldFramePending = nil
                self.heldFrameCaptureFailures += 1
                if self.heldFrameCaptureAllowed && self.heldFrameCaptureFailures < 3 {
                    self.heldFrameRequested = false
                }
            }
        }
        if lastRenderSeen.map({ (0..<0.75).contains(now.timeIntervalSince($0)) }) != true {
            renderStartedAt = now
        }
        lastRenderSeen = now
        if let started = renderStartedAt, now.timeIntervalSince(started) >= 10 { pageRetry.markHealthy() }
        updateFallback()
    }

    private func updateFallback(now: Date = Date(), uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        if let pending = heldFramePending, pending.target != heldFrameURL() { invalidateHeldCapture() }
        let isLive = lastRenderSeen.map { now.timeIntervalSince($0) < 0.75 } == true
            && renderStartedAt.map { now.timeIntervalSince($0) >= 1 } == true
        let shouldShow = showsThumbnail || !isLive
        if let fallbackView {
            if shouldShow && (fallbackView.isHidden || fallbackView.fading) {
                fallbackView.isHidden = false
            } else if !shouldShow && !fallbackView.isHidden && !fallbackView.fading && heldReleaseConfirmed {
                if posterIsHeldFrame { fallbackView.isHidden = true } else { fallbackView.fadeOut() }
            } else if !shouldShow && !fallbackView.isHidden && !fallbackView.fading,
                      animationActive, let webView {
                requestHeldRelease(webView, uptime: uptime)
            }
        }
        guard animationActive, !showsThumbnail, let view = webView else { return }
        let lastSignal = lastRenderSeen ?? pageLoadStartedAt
        let timeout = lastRenderSeen == nil ? firstFrameTimeout : stalledFrameTimeout
        if let lastSignal {
            let elapsed = now.timeIntervalSince(lastSignal)
            if elapsed < 0 || elapsed >= timeout { schedulePageReload(view) }
        }
    }

    private func resetHeldRelease() {
        heldReleaseAttempt = nil
        heldReleaseRequestedAt = nil
        heldReleaseFailures = 0
        heldReleaseConfirmed = false
        heldReleaseReloadPending = false
        heldReleaseReloadStarted = false
        heldReleaseNavigation = nil
    }

    private func invalidateHeldCapture() {
        heldFramePending = nil
        if heldFrameCaptureAllowed { heldFrameRequested = false }
    }

    private func requestHeldRelease(_ view: WKWebView, uptime: TimeInterval) {
        guard webView === view, !heldReleaseReloadPending else { return }
        if let requestedAt = heldReleaseRequestedAt {
            guard uptime - requestedAt >= heldReleaseTimeout else { return }
            heldReleaseAttempt = nil
            heldReleaseRequestedAt = nil
            heldReleaseFailures += 1
        }
        if heldReleaseFailures >= heldReleaseAttempts {
            guard pageURL != nil, resourcesURL != nil else { return }
            saverLog.error("screen saver release failed; scheduling a page reload")
            heldReleaseReloadPending = true
            schedulePageReload(view)
            return
        }
        // A timed-out WebKit call may still be pending after navigation.
        guard heldReleaseOutstanding.count < heldReleaseAttempts else {
            if !heldReleaseBlockedLogged {
                heldReleaseBlockedLogged = true
                saverLog.error("screen saver release is waiting for unanswered WebKit calls")
            }
            return
        }
        let attempt = UUID()
        heldFrameCaptureAllowed = false
        heldReleaseAttempt = attempt
        heldReleaseRequestedAt = uptime
        heldReleaseOutstanding.insert(attempt)
        let script = "(() => { if (typeof window.lidscapeSaverRelease !== 'function') return false; window.lidscapeSaverRelease(); return true; })()"
        view.evaluateJavaScript(script) { [weak self, weak view] result, error in
            guard let self else { return }
            self.heldReleaseOutstanding.remove(attempt)
            if self.heldReleaseOutstanding.count < heldReleaseAttempts { self.heldReleaseBlockedLogged = false }
            guard let view, self.animationActive, self.webView === view,
                  self.heldReleaseAttempt == attempt, !self.heldReleaseReloadPending else { return }
            self.heldReleaseAttempt = nil
            self.heldReleaseRequestedAt = nil
            guard error == nil, result as? Bool == true else {
                self.heldReleaseFailures += 1
                saverLog.warning("screen saver release was not confirmed")
                return
            }
            self.heldReleaseConfirmed = true
            self.heldReleaseFailures = 0
            self.updateFallback()
        }
    }

    override func stopAnimation() {
        animationActive = false
        heldFramePending = nil
        heldFrameCaptureAllowed = false
        resetHeldRelease()
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        lastRenderSeen = nil
        renderStartedAt = nil
        pageRetry.cancel()
        pageRetry.markHealthy()
        pageURL = nil
        resourcesURL = nil
        currentNavigation = nil
        pageSettings = nil
        pageLoadStartedAt = nil
        fallbackView?.removeFromSuperview()
        fallbackView = nil
        webView?.evaluateJavaScript("window.lidscapeSaver?.stop()") { _, _ in }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "lidscapeFrame")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "lidscapeCapture")
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
        heldReleaseOutstanding.removeAll()
        heldReleaseBlockedLogged = false
        sensorActive = false
        sensorHeartbeatTimer?.invalidate()
        sensorHeartbeatTimer = nil
        sensorTask?.cancel(with: .goingAway, reason: nil)
        sensorTask = nil
        sensorPingPending = nil
        sensorPingTimeoutScheduled = false
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
            invalidateHeldCapture()
            refreshPoster()
            closeConfiguration()
        } catch {
            settingsError?.stringValue = error.localizedDescription
        }
    }

    private func refreshPoster() {
        let settings = pageSettings ?? loadSettings()
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
        let held = showsThumbnail ? nil : heldFrameURL(for: settings).flatMap { NSImage(contentsOf: $0) }
        posterIsHeldFrame = held != nil
        poster = held ?? url.flatMap { NSImage(contentsOf: $0) }
        fallbackView?.image = poster
        needsDisplay = true
    }

    private func startSensor(resources: URL) {
        sensorActive = true
        sensorRetryDelay = 0.25
        sensorHelperURL = resources.appendingPathComponent("Lidscape Sensor.app")
        let timer = Timer(timeInterval: 5, repeats: true) { [weak self] _ in
            self?.checkSensorHeartbeat()
        }
        RunLoop.main.add(timer, forMode: .common)
        sensorHeartbeatTimer = timer
        connectSensor()
    }

    private func checkSensorHeartbeat() {
        guard sensorActive, let task = sensorTask else { return }
        task.send(.string("keepalive")) { _ in }
        if let pending = sensorPingPending {
            if pending.result == nil {
                let elapsed = ProcessInfo.processInfo.systemUptime - pending.startedAt
                guard elapsed >= (sensorHeartbeatTimer?.timeInterval ?? 5) else { return }
                guard !sensorPingTimeoutScheduled else { return }
                sensorPingTimeoutScheduled = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak task] in
                    guard let self, let task, self.sensorActive, self.sensorTask === task,
                          self.sensorPingPending === pending else { return }
                    if pending.result == nil { self.sensorDisconnected(task) }
                    else { self.sensorPingCompleted(task, ping: pending) }
                }
                return
            }
            sensorPingCompleted(task, ping: pending)
            guard sensorActive, sensorTask === task else { return }
        }
        let ping = SensorPing()
        sensorPingPending = ping
        task.sendPing { [weak self, weak task, ping] error in
            ping.complete(error)
            DispatchQueue.main.async { [weak self, weak task] in
                guard let self, let task else { return }
                self.sensorPingCompleted(task, ping: ping)
            }
        }
    }

    private func sensorPingCompleted(_ task: URLSessionWebSocketTask, ping: SensorPing) {
        guard sensorActive, sensorTask === task, sensorPingPending === ping,
              let result = ping.result else { return }
        sensorPingPending = nil
        sensorPingTimeoutScheduled = false
        if case .failure = result { sensorDisconnected(task) }
    }

    private func sensorDisconnected(_ task: URLSessionWebSocketTask) {
        guard sensorActive, sensorTask === task else { return }
        clearLidAngle()
        sensorTask = nil
        sensorPingPending = nil
        sensorPingTimeoutScheduled = false
        task.cancel(with: .goingAway, reason: nil)
        sensorSession?.invalidateAndCancel()
        sensorSession = nil
        requestSensorLaunch()
        let delay = sensorRetryDelay
        sensorRetryDelay = min(delay * 2, 3)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connectSensor() }
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
        let callbacks = OperationQueue()
        callbacks.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: .ephemeral, delegate: nil, delegateQueue: callbacks)
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
                    self.sensorDisconnected(task)
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
        if let currentNavigation, navigation !== currentNavigation { return }
        if heldReleaseReloadPending {
            guard heldReleaseReloadStarted, navigation === heldReleaseNavigation else { return }
        }
        currentNavigation = navigation
        resetHeldRelease()
        pageRetry.cancel()
        if let lastLidAngle { sendLidAngle(lastLidAngle) }
    }

    private func schedulePageReload(_ view: WKWebView) {
        guard webView === view, pageURL != nil, resourcesURL != nil else { return }
        lastRenderSeen = nil
        renderStartedAt = nil
        fallbackView?.isHidden = false
        guard let retry = pageRetry.schedule() else { return }
        invalidateHeldCapture()
        heldReleaseAttempt = nil
        heldReleaseRequestedAt = nil
        heldReleaseConfirmed = false
        if heldReleaseReloadPending {
            heldReleaseReloadStarted = false
            heldReleaseNavigation = nil
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + retry.delay) { [weak self, weak view] in
            guard let self, let view, self.webView === view,
                  let page = self.pageURL, let resources = self.resourcesURL,
                  self.pageRetry.begin(generation: retry.generation) else { return }
            self.pageLoadStartedAt = Date()
            self.heldFrameRequested = false
            self.heldFramePending = nil
            self.heldFrameCaptureAllowed = true
            self.heldFrameCaptureFailures = 0
            let navigation = view.loadFileURL(page, allowingReadAccessTo: resources)
            self.currentNavigation = navigation
            if self.heldReleaseReloadPending {
                self.heldReleaseReloadStarted = true
                self.heldReleaseNavigation = navigation
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        saverLog.error("WebKit content process stopped")
        schedulePageReload(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if let currentNavigation, navigation !== currentNavigation { return }
        if heldReleaseReloadPending && (!heldReleaseReloadStarted || navigation !== heldReleaseNavigation) { return }
        saverLog.error("screen saver page did not load: \(error.localizedDescription)")
        schedulePageReload(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if let currentNavigation, navigation !== currentNavigation { return }
        if heldReleaseReloadPending && (!heldReleaseReloadStarted || navigation !== heldReleaseNavigation) { return }
        saverLog.error("screen saver page failed: \(error.localizedDescription)")
        schedulePageReload(webView)
    }
}
