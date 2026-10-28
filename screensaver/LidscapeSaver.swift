import AppKit
import Darwin
import ScreenSaver
import WebKit

private struct SaverSettings: Decodable {
    let city: String
    let theme: String
    let variant: String
    let view: String
}

@objc(LidscapeSaverView)
final class LidscapeSaverView: ScreenSaverView, WKNavigationDelegate {
    private var webView: WKWebView?
    private var bridge: Process?

    override init?(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame, isPreview: isPreview)
        wantsLayer = true
        layer?.backgroundColor = NSColor(red: 0.043, green: 0.086, blue: 0.133, alpha: 1).cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func startAnimation() {
        super.startAnimation()
        guard webView == nil else { return }
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
        view.loadFileURL(page, allowingReadAccessTo: resources)
        if !isPreview { startBridge(resources: resources) }
    }

    override func stopAnimation() {
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
        guard let entry = getpwuid(getuid()), let directory = entry.pointee.pw_dir else { return fallback }
        let home = URL(fileURLWithPath: String(cString: directory), isDirectory: true)
        let file = home.appendingPathComponent("Library/Application Support/Lidscape/screensaver.json")
        guard let data = try? Data(contentsOf: file) else { return fallback }
        return (try? JSONDecoder().decode(SaverSettings.self, from: data)) ?? fallback
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
