import test from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('old map settings retain the selected city, theme and variant', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-settings-test-'))
  try {
    const source = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const testSource = `${source}
private let oldData = Data(#"{"city":"stockholm","theme":"miniature","variant":"christmas","view":"map"}"#.utf8)
private let settings = try JSONDecoder().decode(SaverSettings.self, from: oldData)
precondition(settings.city == "stockholm")
precondition(settings.theme == "miniature")
precondition(settings.variant == "christmas")
private let encoded = try JSONEncoder().encode(settings)
private let fields = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
precondition(fields["view"] == nil)
precondition(fields["city"] as? String == "stockholm")
precondition(fields["theme"] as? String == "miniature")
precondition(fields["variant"] as? String == "christmas")
`
    const file = join(dir, 'compatibility.swift')
    const executable = join(dir, 'compatibility')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the sensor helper can be launched again after a failed startup', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-sensor-test-'))
  try {
    const original = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const source = original.replace('NSWorkspace.shared.openApplication(at: helper, configuration: configuration)',
      'fakeOpenApplication(at: helper, configuration: configuration)')
    if (source === original) throw new Error('The sensor launch seam was not found')
    const testSource = `${source}
private var fakeLaunchCount = 0
private var fakeLaunchFails = false
private func fakeOpenApplication(at url: URL, configuration: NSWorkspace.OpenConfiguration,
                                 completionHandler: @escaping (NSRunningApplication?, Error?) -> Void) {
    fakeLaunchCount += 1
    let error: Error? = fakeLaunchFails ? NSError(domain: "SensorLaunchTest", code: 1) : nil
    completionHandler(nil, error)
}
extension LidscapeSaverView {
    func exerciseFailedSensorStartup() {
        sensorHelperURL = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let first = Date(timeIntervalSinceReferenceDate: 100)
        requestSensorLaunch(now: first)
        precondition(fakeLaunchCount == 1, "The first launch should start the helper")
        requestSensorLaunch(now: first.addingTimeInterval(1))
        precondition(fakeLaunchCount == 1, "Repeated failures must not cause a launch storm")
        requestSensorLaunch(now: first.addingTimeInterval(5))
        precondition(fakeLaunchCount == 2, "A helper that did not send an angle must be retried")
        handleSensorMessage(#"{"angle":120}"#)
        handleSensorMessage(#"{"angle":121}"#)
        precondition(fakeLaunchCount == 2, "Sensor messages must not start the helper again")
        requestSensorLaunch(now: first.addingTimeInterval(5.1))
        precondition(fakeLaunchCount == 3, "A new disconnect can launch after successful sensor data")
        sensorLaunchRequestedAt = nil
        fakeLaunchFails = true
        requestSensorLaunch(now: first.addingTimeInterval(10))
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        requestSensorLaunch(now: first.addingTimeInterval(11))
        precondition(fakeLaunchCount == 4, "Failed starts must also respect the retry limit")
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: false)!
view.exerciseFailedSensorStartup()
`
    const file = join(dir, 'sensor.swift')
    const executable = join(dir, 'sensor')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sensor loss clears the last known angle', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-loss-test-'))
  try {
    const source = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const testSource = `${source}
extension LidscapeSaverView {
    func exerciseSensorLoss() {
        handleSensorMessage(#"{"angle":15}"#)
        precondition(lastLidAngle == 15)
        handleSensorMessage(#"{"sensor":false}"#)
        precondition(lastLidAngle == nil, "A missing sensor must clear the last angle")
        handleSensorMessage(#"{"angle":120}"#)
        precondition(lastLidAngle == 120)
        clearLidAngle()
        precondition(lastLidAngle == nil, "A disconnected sensor must clear the last angle")
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: false)!
view.exerciseSensorLoss()
`
    const file = join(dir, 'loss.swift')
    const executable = join(dir, 'loss')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('WebKit failures retry with backoff and stop after the view closes', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-webkit-test-'))
  try {
    const original = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const source = original
      .replace('DispatchQueue.main.asyncAfter(deadline: .now() + retry.delay)', 'fakeAfter(delay: retry.delay)')
      .replace('            view.loadFileURL(page, allowingReadAccessTo: resources)', '            fakeLoadFileURL(view: view, page: page, resources: resources)')
    if (source === original || source.includes('            view.loadFileURL(page, allowingReadAccessTo: resources)')) {
      throw new Error('The retry test seams were not found')
    }
    const testSource = `${source}
private var scheduled: [(TimeInterval, () -> Void)] = []
private var reloads = 0
private func fakeAfter(delay: TimeInterval, perform: @escaping () -> Void) {
    scheduled.append((delay, perform))
}
private func fakeLoadFileURL(view: WKWebView, page: URL, resources: URL) {
    reloads += 1
}
extension LidscapeSaverView {
    func exercisePageFailure() {
        let content = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 480))
        webView = content
        fallbackView = NSImageView()
        fallbackView?.isHidden = true
        pageURL = URL(fileURLWithPath: "/tmp/page.html")
        resourcesURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
        lastRenderSeen = Date()
        renderStartedAt = Date().addingTimeInterval(-10)
        let error = NSError(domain: "WebKitTest", code: 1)
        webViewWebContentProcessDidTerminate(content)
        precondition(fallbackView?.isHidden == false, "The fallback must appear immediately")
        webView(content, didFailProvisionalNavigation: nil, withError: error)
        precondition(scheduled.map(\\.0) == [1], "Duplicate failures must share one pending retry")
        for expected in [1.0, 2, 4, 8, 16, 30, 30] {
            precondition(scheduled.count == 1 && scheduled[0].0 == expected)
            scheduled.removeFirst().1()
            webView(content, didFail: nil, withError: error)
        }
        precondition(reloads == 7)
        precondition(scheduled.count == 1 && scheduled[0].0 == 30)
        webView(content, didFinish: nil)
        scheduled.removeFirst().1()
        precondition(reloads == 7, "A successful navigation must cancel a pending retry")
        pageRetry.markHealthy()
        webViewWebContentProcessDidTerminate(content)
        precondition(scheduled.count == 1 && scheduled[0].0 == 1, "A healthy page resets the retry delay")
        stopAnimation()
        scheduled.removeFirst().1()
        precondition(reloads == 7, "A stopped view must not reload")
        precondition(pageRetry.delay == 1, "Stopping must reset the retry delay")
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: false)!
view.exercisePageFailure()
`
    const file = join(dir, 'webkit.swift')
    const executable = join(dir, 'webkit')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a small screen saver starts one live view when it grows', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-resize-test-'))
  try {
    const original = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const resourceLookup = `        let bundle = Bundle(for: Self.self)
        guard let resources = bundle.resourceURL,
              let page = bundle.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            NSLog("Lidscape saver: bundled page is missing")
            return
        }`
    if (!original.includes(resourceLookup)) throw new Error('The resource lookup seam was not found')
    const source = original.replace(resourceLookup, `        let resources = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let page = resources.appendingPathComponent("page.html")`)
      .replaceAll('view.loadFileURL(page, allowingReadAccessTo: resources)', 'fakeResizeLoad(view: view, page: page, resources: resources)')
      .replace('if !isPreview { startSensor(resources: resources) }', 'if !isPreview { fakeResizeSensorStart(resources: resources) }')
    const testSource = `${source}
private var resizeLoads = 0
private var resizeSensorStarts = 0
private func fakeResizeLoad(view: WKWebView, page: URL, resources: URL) { resizeLoads += 1 }
private func fakeResizeSensorStart(resources: URL) { resizeSensorStarts += 1 }
extension LidscapeSaverView {
    func exerciseResize() {
        startAnimation()
        precondition(fallbackView != nil && webView == nil, "A small view should start with the poster")
        setFrameSize(NSSize(width: 800, height: 600))
        precondition(webView != nil, "A growing view must start WebKit")
        let first = webView
        precondition(resizeLoads == 1 && resizeSensorStarts == 1)
        setFrameSize(NSSize(width: 900, height: 700))
        setFrameSize(NSSize(width: 200, height: 150))
        setFrameSize(NSSize(width: 1000, height: 800))
        startAnimation()
        precondition(webView === first, "Resizing must reuse the same WebKit view")
        precondition(resizeLoads == 1 && resizeSensorStarts == 1, "Resizing must not start duplicates")
        stopAnimation()
        setFrameSize(NSSize(width: 1200, height: 900))
        precondition(webView == nil && resizeLoads == 1, "A stopped view must not restart")
    }
    func exercisePreviewResize() {
        startAnimation()
        setFrameSize(NSSize(width: 800, height: 600))
        precondition(webView == nil && resizeLoads == 1, "A preview must remain on the poster")
        stopAnimation()
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 240, height: 156), isPreview: false)!
view.exerciseResize()
let preview = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 240, height: 156), isPreview: true)!
preview.exercisePreviewResize()
`
    const file = join(dir, 'resize.swift')
    const executable = join(dir, 'resize')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a stalled live screen saver retries without a reload storm', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-stall-test-'))
  try {
    const original = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const source = original
      .replace('DispatchQueue.main.asyncAfter(deadline: .now() + retry.delay)', 'fakeStallAfter(delay: retry.delay)')
      .replace('            view.loadFileURL(page, allowingReadAccessTo: resources)', '            fakeStallLoad(view: view, page: page, resources: resources)')
    if (source === original || source.includes('            view.loadFileURL(page, allowingReadAccessTo: resources)')) {
      throw new Error('The retry test seams were not found')
    }
    const testSource = `${source}
private var scheduledStall: [(TimeInterval, () -> Void)] = []
private var stallReloads = 0
private func fakeStallAfter(delay: TimeInterval, perform: @escaping () -> Void) {
    scheduledStall.append((delay, perform))
}
private func fakeStallLoad(view: WKWebView, page: URL, resources: URL) { stallReloads += 1 }
extension LidscapeSaverView {
    func exerciseStalledFrames() {
        let content = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 480))
        webView = content
        fallbackView = NSImageView()
        fallbackView?.isHidden = true
        pageURL = URL(fileURLWithPath: "/tmp/page.html")
        resourcesURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
        animationActive = true
        lastRenderSeen = Date().addingTimeInterval(-10)
        renderStartedAt = Date().addingTimeInterval(-20)
        updateFallback()
        precondition(fallbackView?.isHidden == false, "A stalled view must show its poster")
        precondition(scheduledStall.count == 1 && scheduledStall[0].0 == 1,
                     "A stalled live page must schedule one reload")
        for _ in 0..<10 { updateFallback() }
        precondition(scheduledStall.count == 1, "Repeated timer ticks must not schedule duplicate reloads")
        noteRenderedFrame(now: Date())
        scheduledStall.removeFirst().1()
        precondition(stallReloads == 0, "A resumed frame must cancel the pending reload")
        lastRenderSeen = Date().addingTimeInterval(-10)
        updateFallback()
        precondition(scheduledStall.count == 1 && scheduledStall[0].0 == 2, "The next failure must use backoff")
        scheduledStall.removeFirst().1()
        precondition(stallReloads == 1, "The stalled page must reload")
        updateFallback()
        precondition(scheduledStall.isEmpty, "A new page needs time to render its first frame")
        pageLoadStartedAt = Date().addingTimeInterval(-16)
        updateFallback()
        precondition(scheduledStall.count == 1 && scheduledStall[0].0 == 4,
                     "A page with no first frame must retry with backoff")
        stopAnimation()
        scheduledStall.removeFirst().1()
        precondition(stallReloads == 1, "Stopping must cancel the scheduled reload")
    }
    func exerciseStalledPreview() {
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 480))
        fallbackView = NSImageView()
        pageURL = URL(fileURLWithPath: "/tmp/page.html")
        resourcesURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
        animationActive = true
        lastRenderSeen = Date().addingTimeInterval(-10)
        updateFallback()
        precondition(scheduledStall.isEmpty, "A preview must not schedule a reload")
        stopAnimation()
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: false)!
view.exerciseStalledFrames()
let preview = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: true)!
preview.exerciseStalledPreview()
`
    const file = join(dir, 'stall.swift')
    const executable = join(dir, 'stall')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    execFileSync(executable, [], { stdio: 'pipe' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})


test('stopping the screen saver closes its sensor connection', {
  skip: process.platform !== 'darwin' && 'The screen saver requires macOS',
  timeout: 60000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-disconnect-test-'))
  const server = createServer()
  let connection
  let connected = false
  let disconnected = false
  let receivedAngle = false
  let closeBeforeStop = false
  let closeFrameSeen = false
  let stopRequested = false
  let closeWhileRunning = false
  let child
  const stopChild = () => {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  t.signal.addEventListener('abort', stopChild, { once: true })
  server.on('upgrade', (request, socket) => {
    connected = true
    connection = socket
    socket.on('error', () => {})
    socket.on('close', () => {
      disconnected = true
      closeWhileRunning = child?.exitCode === null
      if (closeWhileRunning) child.stdin.end('D')
    })
    socket.on('data', chunk => {
      if ((chunk[0] & 0x0f) === 8) {
        closeFrameSeen = true
        if (!stopRequested) closeBeforeStop = true
        socket.end(Buffer.from([0x88, 0x00]))
      }
    })
    const key = request.headers['sec-websocket-key']
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const message = Buffer.from('{"angle":120}')
    socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]))
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const source = await readFile(fileURLToPath(new URL('./LidscapeSaver.swift', import.meta.url)), 'utf8')
    const testSource = `${source}
extension LidscapeSaverView {
    func exerciseSensorDisconnect(port: Int) {
        sensorActive = true
        let session = URLSession(configuration: .ephemeral)
        let task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\\(port)")!)
        sensorSession = session
        sensorTask = task
        task.resume()
        receiveSensor(task)
        let deadline = Date().addingTimeInterval(5)
        while lastLidAngle != 120 && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.01))
        }
        precondition(lastLidAngle == 120, "The server must send a real sensor message")
        FileHandle.standardOutput.write(Data("angle-received\\n".utf8))
        let signal = FileHandle.standardInput.readData(ofLength: 1)
        precondition(signal == Data([83]), "The test must signal the stop")
        stopAnimation()
        let closed = FileHandle.standardInput.readData(ofLength: 1)
        precondition(closed == Data([68]), "The test must observe the closed connection")
    }
}
let view = LidscapeSaverView(frame: NSRect(x: 0, y: 0, width: 640, height: 480), isPreview: false)!
view.exerciseSensorDisconnect(port: Int(CommandLine.arguments[1])!)
`
    const file = join(dir, 'disconnect.swift')
    const executable = join(dir, 'disconnect')
    await writeFile(file, testSource)
    execFileSync('xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'ScreenSaver',
      '-framework', 'WebKit', file, '-o', executable], { stdio: 'pipe' })
    child = spawn(executable, [String(server.address().port)])
    child.stdin.on('error', () => {})
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', chunk => {
      output += chunk
      if (!receivedAngle && output.includes('angle-received')) {
        receivedAngle = true
        stopRequested = true
        child.stdin.write('S')
      }
    })
    child.stderr.on('data', chunk => { errorOutput += chunk })
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (status !== 0) throw new Error(`Sensor test failed (${status}): ${errorOutput}`)
    if (!connected || !receivedAngle) throw new Error('The sensor connection did not receive its angle')
    if (!closeFrameSeen || !disconnected || closeBeforeStop || !closeWhileRunning) {
      throw new Error('The sensor connection did not close after the screen saver stopped while its process was running')
    }
  } finally {
    t.signal.removeEventListener('abort', stopChild)
    const childClosed = child?.exitCode === null && child.signalCode === null
      ? new Promise(resolve => child.once('close', resolve))
      : null
    stopChild()
    if (childClosed) await childClosed
    connection?.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
