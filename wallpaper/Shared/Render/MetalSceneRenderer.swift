import AppKit
import AVFoundation
import CoreMedia
import CoreVideo
import QuartzCore
import WebKit
import os

// This probe keeps the existing wallpaper host and replaces its Metal frames with
// snapshots from the real, bundled Lidscape page and uses the existing sensor app.
final class MetalSceneRenderer: @unchecked Sendable {
    private static let ids = OSAllocatedUnfairLock(initialState: 30000)
    let debugID = ids.withLock { $0 += 1; return $0 }
    let displayLayer: AVSampleBufferDisplayLayer
    private let displayID: UInt32?
    private var webView: WKWebView?
    private var offscreenWindow: NSWindow?
    private var navigationDelegate: ProbeNavigationDelegate?
    private var timer: Timer?
    private var sensorToken: UUID?
    private var callback: (@Sendable (Bool) -> Void)?
    private var running = false
    private var loaded = false
    private var paused = false
    private var captureSchedule = WallpaperCaptureSchedule()
    private var watchdog = WallpaperFrameWatchdog()
    private var captureGeneration = 0
    private var pending = false
    private var frames = 0
    private var measuredFrames = 0
    private var measureStart = Date()
    private var sceneOptions: ProbeOptions?
    private var sceneSettings = ProbeSettings()
    private var settingsCheckedAt = Date.distantPast
    private var lastImage: CGImage?
    private let imageLock = NSLock()

    static func create(rootLayer: CALayer, package: MetalScenePackage,
                       reusingDisplayLayer layer: AVSampleBufferDisplayLayer) throws -> MetalSceneRenderer {
        guard Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") != nil else {
            throw NSError(domain: "LidscapeWebProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: "The bundled Lidscape page is missing."])
        }
        layer.frame = rootLayer.bounds
        layer.contentsScale = rootLayer.contentsScale
        return MetalSceneRenderer(layer: layer, displayID: PointerGeometry.displayID(layerName: rootLayer.name))
    }

    private init(layer: AVSampleBufferDisplayLayer, displayID: UInt32?) {
        displayLayer = layer
        self.displayID = displayID
    }

    func start(onFirstFrameProcessed: (@Sendable (Bool) -> Void)? = nil, requiresVisibleRendering: Bool = true) {
        DispatchQueue.main.async { [self] in
            guard !running else { onFirstFrameProcessed?(false); return }
            running = true
            frames = 0
            loaded = false
            watchdog.reset()
            captureGeneration += 1
            sensorToken = ProbeLidSensor.shared.subscribe()
            displayLayer.videoGravity = .resizeAspectFill
            callback = onFirstFrameProcessed
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            do {
                let options = try ProbeOptions.load(from: .main)
                sceneOptions = options
                do { sceneSettings = ProbeSettings(shared: try options.sharedStore.load()) }
                catch { renderLog("[Lidscape Web Sensor] Cannot read wallpaper settings: \(error.localizedDescription)") }
            } catch {
                renderLog("[Lidscape Web Sensor] Cannot load wallpaper choices: \(error.localizedDescription)")
                finish(false)
                return
            }
            config.userContentController.addUserScript(WKUserScript(source: sceneSettings.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 720), configuration: config)
            let selector = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
            if view.responds(to: selector) {
                typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
                unsafeBitCast(view.method(for: selector), to: Setter.self)(view, selector, false)
                renderLog("[Lidscape Web Sensor] WebKit occlusion override enabled")
            } else { renderLog("[Lidscape Web Sensor] WebKit occlusion override unavailable") }
            let delegate = ProbeNavigationDelegate(onLoad: { [weak self] in
                guard let self else { return }
                self.loaded = true
                self.webView?.evaluateJavaScript("window.lidscapeSaverSetPaused?.(\(self.paused));", completionHandler: nil)
                renderLog("[Lidscape Web Sensor] Local page loaded in extension")
            }, onError: { [weak self] error in
                renderLog("[Lidscape Web Sensor] Navigation failed: \(error.localizedDescription)")
                guard let self else { return }
                self.loaded = false
                self.captureGeneration += 1
                self.pending = false
                if self.frames == 0 { self.finish(false) }
            })
            navigationDelegate = delegate
            view.navigationDelegate = delegate
            let minX = NSScreen.screens.map { $0.frame.minX }.min() ?? 0
            let minY = NSScreen.screens.map { $0.frame.minY }.min() ?? 0
            let frame = NSRect(x: minX - 1480, y: minY - 920, width: 1280, height: 720)
            let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.ignoresMouseEvents = true
            window.collectionBehavior = [.stationary, .ignoresCycle]
            window.contentView = view
            window.setFrameOrigin(frame.origin)
            guard !NSScreen.screens.contains(where: { $0.frame.intersects(window.frame) }) else {
                renderLog("[Lidscape Web Sensor] Refused to show a window on a display")
                window.close()
                finish(false)
                return
            }
            window.orderFrontRegardless()
            offscreenWindow = window
            renderLog("[Lidscape Web Sensor] Offscreen window ordered, origin \(frame.origin)")
            webView = view
            let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")!
            renderLog("[Lidscape Web Sensor] Starting local page navigation")
            let initialNavigation = view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
            delegate.track(initialNavigation)
            scheduleCapture()
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                guard let self, self.running, self.callback != nil else { return }
                renderLog("[Lidscape Web Sensor] Timed out before the first frame")
                self.finish(false)
            }
        }
    }

    @MainActor private func scheduleCapture() {
        timer?.invalidate()
        timer = nil
        guard running, let interval = captureSchedule.interval else { return }
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.capture() }
        }
    }

    @MainActor private func checkWatchdog(frameAge: TimeInterval?, in webView: WKWebView) {
        guard frames > 0 else { return }
        switch watchdog.observe(now: ProcessInfo.processInfo.systemUptime, frameAge: frameAge) {
        case .none:
            break
        case .reload:
            // Ignore callbacks from the page being replaced. The timer can then
            // recover even when an evaluation or snapshot never calls back.
            captureGeneration += 1
            pending = false
            loaded = false
            navigationDelegate?.track(nil)
            webView.stopLoading()
            navigationDelegate?.track(webView.reload())
            renderLog("[Lidscape Web Sensor] Stale frame; reloading page")
        case .exhausted:
            renderLog("[Lidscape Web Sensor] Frame recovery stopped after three attempts")
        }
    }

    @MainActor private func capture() {
        guard running, !paused, let webView else { return }
        let currentGeneration = captureGeneration
        checkWatchdog(frameAge: nil, in: webView)
        guard captureGeneration == currentGeneration, loaded, !pending else { return }
        refreshSettings(in: webView)
        guard loaded else { return }
        pending = true
        let generation = captureGeneration
        let angle = ProbeLidSensor.shared.angle
        let update = angle.map { "window.lidscapeSaverSetLidAngle?.(\($0));" }
            ?? "window.lidscapeSaverClearLidAngle?.();"
        let js = "\(update) \(pointerScript()) window.lidscapeSaverLastRender || 0"
        webView.evaluateJavaScript(js) { [weak self] result, error in
            guard let self, self.running, self.captureGeneration == generation else { return }
            guard !self.paused else { self.pending = false; return }
            let frameAge: TimeInterval?
            if error == nil, let timestamp = result as? NSNumber,
               timestamp.doubleValue.isFinite, timestamp.doubleValue > 0 {
                let age = Date().timeIntervalSince1970 - timestamp.doubleValue / 1000
                frameAge = age.isFinite && age >= -1 ? max(0, age) : nil
            } else { frameAge = nil }
            guard let frameAge, frameAge < 2, let timestamp = result as? NSNumber else {
                self.checkWatchdog(frameAge: frameAge, in: webView)
                if self.captureGeneration == generation { self.pending = false }
                return
            }
            webView.takeSnapshot(with: nil) { [weak self] image, error in
                guard let self, self.running, self.captureGeneration == generation else { return }
                defer { self.pending = false }
                guard !self.paused else { return }
                let snapshotAge = Date().timeIntervalSince1970 - timestamp.doubleValue / 1000
                guard snapshotAge.isFinite, snapshotAge >= -1, snapshotAge < 2 else {
                    self.checkWatchdog(frameAge: snapshotAge, in: webView)
                    return
                }
                guard let image, let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                      let sample = self.makeSample(cgImage) else {
                    renderLog("[Lidscape Web Sensor] Snapshot failed: \(error?.localizedDescription ?? "invalid image")")
                    return
                }
                let renderer = self.displayLayer.sampleBufferRenderer
                if renderer.status == .failed || renderer.requiresFlushToResumeDecoding { renderer.flush() }
                renderer.enqueue(sample)
                self.imageLock.lock(); self.lastImage = cgImage; self.imageLock.unlock()
                self.frames += 1
                self.measuredFrames += 1
                if self.frames == 1 {
                    self.watchdog.firstFrame(at: ProcessInfo.processInfo.systemUptime)
                    CATransaction.flush()
                    renderLog("[Lidscape Web Sensor] First snapshot enqueued in remote layer")
                    self.finish(true)
                } else {
                    self.checkWatchdog(frameAge: max(0, snapshotAge), in: webView)
                    guard Date().timeIntervalSince(self.measureStart) >= 10 else { return }
                    let elapsed = Date().timeIntervalSince(self.measureStart)
                    let fps = Double(self.measuredFrames) / elapsed
                    renderLog("[Lidscape Web Sensor] Snapshot rate: \(String(format: "%.2f", fps)) fps over \(String(format: "%.1f", elapsed)) s; total \(self.frames)")
                    self.measureStart = Date()
                    self.measuredFrames = 0
                }
            }
        }
    }
    @MainActor private func pointerScript() -> String {
        guard let displayID,
              let screen = NSScreen.screens.first(where: {
                  ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID
              }),
              let point = PointerGeometry.normalizedPosition(
                  NSEvent.mouseLocation, display: screen.frame, scene: CGSize(width: 1280, height: 720)
              ) else { return "window.lidscapeSaverSetPointer?.(null, null);" }
        return "window.lidscapeSaverSetPointer?.(\(point.x), \(point.y));"
    }
    @MainActor private func refreshSettings(in webView: WKWebView) {
        guard Date().timeIntervalSince(settingsCheckedAt) >= 1, let sceneOptions else { return }
        settingsCheckedAt = Date()
        do {
            let next = ProbeSettings(shared: try sceneOptions.sharedStore.load())
            guard next != sceneSettings else { return }
            sceneSettings = next
            loaded = false
            webView.configuration.userContentController.removeAllUserScripts()
            webView.configuration.userContentController.addUserScript(WKUserScript(source: next.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            navigationDelegate?.track(nil)
            navigationDelegate?.track(webView.reload())
            renderLog("[Lidscape Web Sensor] Wallpaper settings changed")
        } catch { renderLog("[Lidscape Web Sensor] Cannot read wallpaper settings: \(error.localizedDescription)") }
    }
    private func finish(_ success: Bool) {
        let completion = callback
        callback = nil
        completion?(success)
    }
    private func makeSample(_ image: CGImage) -> CMSampleBuffer? {
        let width = image.width, height = image.height
        var buffer: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:]]
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer) == kCVReturnSuccess,
              let buffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer), let context = CGContext(data: base, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        var format: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &format) == noErr,
              let format else { return nil }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescription: format,
            sampleTiming: &timing, sampleBufferOut: &sample) == noErr, let sample else { return nil }
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
            let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return sample
    }
    func stop(preservingDisplayLayer: Bool = false) {
        DispatchQueue.main.async { [self] in
            running = false
            captureGeneration += 1
            pending = false
            watchdog.reset()
            if let sensorToken { ProbeLidSensor.shared.unsubscribe(sensorToken); self.sensorToken = nil }
            timer?.invalidate(); timer = nil
            navigationDelegate?.track(nil)
            webView?.stopLoading(); webView?.navigationDelegate = nil; webView = nil; navigationDelegate = nil
            offscreenWindow?.orderOut(nil); offscreenWindow?.close(); offscreenWindow = nil
            finish(false)
            if !preservingDisplayLayer { displayLayer.removeFromSuperlayer() }
            renderLog("[Lidscape Web Sensor] Stopped after \(frames) snapshots")
        }
    }
    func setPlaybackRate(_ rate: Double) {}
    func setQuality(_ quality: RenderQuality) {}
    func applyPolicy(_ policy: PlaybackPolicy, animated: Bool = false) {
        DispatchQueue.main.async { [self] in
            guard captureSchedule.setPolicy(policy) else { return }
            measureStart = Date()
            measuredFrames = 0
            let nextPaused = policy == .paused
            if paused != nextPaused {
                paused = nextPaused
                captureGeneration += 1
                pending = false
                watchdog.reset()
                if !nextPaused && frames > 0 {
                    watchdog.firstFrame(at: ProcessInfo.processInfo.systemUptime)
                }
                webView?.evaluateJavaScript("window.lidscapeSaverSetPaused?.(\(nextPaused));", completionHandler: nil)
            }
            scheduleCapture()
        }
    }
    func resize(to size: CGSize) {}
    func snapshot() -> CGImage? { imageLock.lock(); defer { imageLock.unlock() }; return lastImage }
}

private final class ProbeNavigationDelegate: NSObject, WKNavigationDelegate {
    let onLoad: () -> Void
    let onError: (Error) -> Void
    private var tracker = WallpaperNavigationTracker<WKNavigation>()

    init(onLoad: @escaping () -> Void, onError: @escaping (Error) -> Void) {
        self.onLoad = onLoad; self.onError = onError
    }
    func track(_ navigation: WKNavigation?) { tracker.track(navigation) }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if tracker.accepts(navigation) { renderLog("[Lidscape Web Sensor] Navigation started") }
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        if tracker.accepts(navigation) { renderLog("[Lidscape Web Sensor] Navigation committed") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        tracker.track(nil)
        renderLog("[Lidscape Web Sensor] Web content process terminated")
        onError(NSError(domain: "LidscapeWebNetwork", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Web content process terminated."]))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard tracker.accepts(navigation) else { return }
        tracker.track(nil)
        onLoad()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard tracker.accepts(navigation) else { return }
        tracker.track(nil)
        onError(error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard tracker.accepts(navigation) else { return }
        tracker.track(nil)
        onError(error)
    }
}
