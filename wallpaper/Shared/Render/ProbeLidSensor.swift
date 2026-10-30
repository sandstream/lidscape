import AppKit
import Foundation

// The sensor is a separate app because the sandboxed wallpaper extension
// cannot be assumed to have access to the MacBook's HID device.
@MainActor
final class ProbeLidSensor {
    static let shared = ProbeLidSensor()
    private(set) var angle: Int?
    private var users = Set<UUID>()
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var heartbeat: Timer?
    private var launchPending = false
    private var nextLaunch = Date.distantPast
    private var retryDelay = 0.25
    private var generation = 0

    func subscribe() -> UUID {
        let token = UUID()
        users.insert(token)
        if users.count == 1 {
            generation += 1
            heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.task?.send(.string("keepalive")) { error in
                        if let error { renderLog("[Lidscape Sensor] Keepalive failed: \(error.localizedDescription)") }
                    }
                }
            }
            connect()
        }
        return token
    }

    func unsubscribe(_ token: UUID) {
        users.remove(token)
        guard users.isEmpty else { return }
        generation += 1
        heartbeat?.invalidate(); heartbeat = nil
        task?.cancel(with: .normalClosure, reason: nil); task = nil
        session?.invalidateAndCancel(); session = nil
        angle = nil
        retryDelay = 0.25
        renderLog("[Lidscape Sensor] Last renderer stopped; sensor connection closed")
    }

    private func connect() {
        guard !users.isEmpty, task == nil, let url = URL(string: "ws://127.0.0.1:8787") else { return }
        let session = URLSession(configuration: .ephemeral)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        task.resume()
        receive(task)
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, !self.users.isEmpty, self.task === task else { return }
                switch result {
                case .success(.string(let text)):
                    if let data = text.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let number = json["angle"] as? NSNumber,
                       CFGetTypeID(number) != CFBooleanGetTypeID(),
                       let value = json["angle"] as? Int, (0...180).contains(value) {
                        if self.angle == nil { renderLog("[Lidscape Sensor] Received first valid angle") }
                        self.angle = value
                        self.retryDelay = 0.25
                    } else if let data = text.data(using: .utf8),
                              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              (json["sensor"] as? Bool) == false {
                        self.angle = nil
                        renderLog("[Lidscape Sensor] No sensor available")
                    }
                    self.receive(task)
                case .success(.data): self.receive(task)
                case .failure(let error):
                    renderLog("[Lidscape Sensor] Connection failed: \(error.localizedDescription)")
                    self.task = nil
                    self.session?.invalidateAndCancel(); self.session = nil
                    self.angle = nil
                    self.requestHelper()
                    let delay = self.retryDelay
                    self.retryDelay = min(delay * 2, 3)
                    let generation = self.generation
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                        guard let self, self.generation == generation else { return }
                        self.connect()
                    }
                @unknown default: self.receive(task)
                }
            }
        }
    }

    private func requestHelper() {
        guard !launchPending, Date() >= nextLaunch,
              let resources = Bundle.main.resourceURL else { return }
        let helper = resources.appendingPathComponent("Lidscape Sensor.app")
        guard FileManager.default.fileExists(atPath: helper.path) else {
            renderLog("[Lidscape Sensor] Bundled helper is missing")
            nextLaunch = Date().addingTimeInterval(3)
            return
        }
        launchPending = true
        nextLaunch = Date().addingTimeInterval(3)
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        config.addsToRecentItems = false
        config.promptsUserIfNeeded = false
        NSWorkspace.shared.openApplication(at: helper, configuration: config) { [weak self] _, error in
            DispatchQueue.main.async {
                self?.launchPending = false
                if let error { renderLog("[Lidscape Sensor] Helper launch failed: \(error.localizedDescription)") }
                else { renderLog("[Lidscape Sensor] Helper launch requested") }
            }
        }
    }
}
