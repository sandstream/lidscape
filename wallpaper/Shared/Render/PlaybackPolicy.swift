import Foundation

/// Central decision-maker for wallpaper playback behavior.
/// Replaces scattered shouldPause boolean checks with a graduated policy system.
enum PlaybackPolicy: Int, Comparable {
    case full = 0
    case reduced = 1
    case minimal = 2
    case paused = 3

    /// Backlight level below which the display counts as off. The display is still
    /// technically "awake" at this point, so no sleep notification fires and
    /// WallpaperAgent never switches to "idle" — but the user cannot see anything.
    static let brightnessPauseThreshold: Float = 0.05

    /// The measured backlight belongs to the built-in display only.
    /// An external or unknown display must not inherit that brightness.
    static func brightnessForDisplay(_ builtInBrightness: Float, isBuiltIn: Bool?) -> Float {
        isBuiltIn == true ? builtInBrightness : 1.0
    }

    static func < (lhs: PlaybackPolicy, rhs: PlaybackPolicy) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Evaluate all conditions and return the most restrictive applicable policy.
    ///
    /// `alwaysPauseDesktop`: when true, wallpaper only plays on the lock screen.
    /// On the desktop (unlocked), it pauses with a ramp animation.
    ///
    /// Lock screen never reduces FPS by itself — only power/thermal conditions do.
    static func compute(
        presentationMode: String,
        activityState: String,
        userPaused: Bool,
        alwaysPauseDesktop: Bool,
        pauseWhenOccluded: Bool,
        desktopOccluded: Bool,
        pauseOnBattery: Bool,
        thermalState: ProcessInfo.ThermalState,
        isOnBattery: Bool,
        batteryLevel: Int,
        displayBrightness: Float = 1.0,
    ) -> PlaybackPolicy {
        var worst: PlaybackPolicy = .full

        // --- paused tier ---
        if userPaused { worst = max(worst, .paused) }
        if thermalState == .critical { worst = max(worst, .paused) }
        if isOnBattery, batteryLevel < 10 { worst = max(worst, .paused) }
        if activityState.contains("suspended") { worst = max(worst, .paused) }
        if presentationMode == "idle" { worst = max(worst, .paused) }
        if pauseOnBattery, isOnBattery { worst = max(worst, .paused) }
        // User dimmed the backlight to ~zero — nothing is visible to animate.
        if displayBrightness < Self.brightnessPauseThreshold {
            worst = max(worst, .paused)
        }
        // Desktop occlusion is irrelevant on the lock screen — the wallpaper
        // is always fully visible there regardless of desktop window state.
        if pauseWhenOccluded, desktopOccluded, presentationMode != "locked" { worst = max(worst, .paused) }
        if alwaysPauseDesktop, presentationMode != "locked" { worst = max(worst, .paused) }

        // --- minimal tier ---
        if thermalState == .serious { worst = max(worst, .minimal) }
        if isOnBattery, batteryLevel < 20 { worst = max(worst, .minimal) }

        // --- reduced tier ---
        if thermalState == .fair { worst = max(worst, .reduced) }
        if isOnBattery { worst = max(worst, .reduced) }

        return worst
    }

}

/// The probe keeps its user-visible frame rate separate from scene quality.
struct WallpaperCaptureSchedule {
    private(set) var policy: PlaybackPolicy = .full

    var interval: TimeInterval? {
        switch policy {
        case .full: return 1.0 / 15.0
        case .reduced: return 1.0 / 10.0
        case .minimal: return 1.0 / 5.0
        case .paused: return nil
        }
    }

    @discardableResult
    mutating func setPolicy(_ next: PlaybackPolicy) -> Bool {
        guard next != policy else { return false }
        policy = next
        return true
    }
}

/// Detects a stalled page after it has rendered at least one image.
/// Times use a monotonic clock. `frameAge` comes from the page in seconds.
struct WallpaperFrameWatchdog {
    enum Action: Equatable { case none, reload, exhausted }

    private static let staleAfter: TimeInterval = 2
    private static let retryAfter: TimeInterval = 3
    private static let stableAfter: TimeInterval = 10
    private static let maxReloads = 3
    private var armed = false
    private var lastFreshAt: TimeInterval?
    private var stableSince: TimeInterval?
    private var lastReloadAt: TimeInterval?
    private var reloads = 0
    private var reportedExhaustion = false

    /// Arm after the first displayed image, or when resuming an active scene.
    mutating func firstFrame(at now: TimeInterval) {
        guard now.isFinite, !armed else { return }
        armed = true
        lastFreshAt = now
        stableSince = now
    }

    /// Missing values retain the last fresh timestamp until it becomes stale.
    mutating func observe(now: TimeInterval, frameAge: TimeInterval?) -> Action {
        guard armed, now.isFinite, let previous = lastFreshAt else { return .none }
        if let age = frameAge, age.isFinite, age >= 0, age < Self.staleAfter {
            lastFreshAt = max(previous, now - age)
            if stableSince == nil { stableSince = now }
            if let stableSince, now - stableSince >= Self.stableAfter {
                reloads = 0
                lastReloadAt = nil
                reportedExhaustion = false
            }
            return .none
        }
        let explicitlyStale = frameAge.map { $0.isFinite && $0 >= Self.staleAfter } ?? false
        guard explicitlyStale || now - previous >= Self.staleAfter else { return .none }
        stableSince = nil
        if let lastReloadAt, now - lastReloadAt < Self.retryAfter { return .none }
        if reloads >= Self.maxReloads {
            guard !reportedExhaustion else { return .none }
            reportedExhaustion = true
            return .exhausted
        }
        lastReloadAt = now
        reloads += 1
        return .reload
    }

    /// Pause and resume start a fresh recovery period.
    mutating func reset() { self = Self() }
}

/// Only callbacks from the most recently started navigation may change state.
struct WallpaperNavigationTracker<Token: AnyObject> {
    private var current: Token?

    mutating func track(_ token: Token?) { current = token }

    func accepts(_ token: Token?) -> Bool {
        guard let current, let token else { return false }
        return current === token
    }
}
