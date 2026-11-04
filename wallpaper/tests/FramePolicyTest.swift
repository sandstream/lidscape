import Foundation

@main
struct FramePolicyTest {
    static func main() {
        var schedule = WallpaperCaptureSchedule()
        precondition(schedule.interval == 1.0 / 15.0)
        precondition(!schedule.setPolicy(.full))
        precondition(schedule.setPolicy(.reduced))
        precondition(schedule.interval == 1.0 / 10.0)
        precondition(schedule.setPolicy(.minimal))
        precondition(schedule.interval == 1.0 / 5.0)
        precondition(schedule.setPolicy(.paused))
        precondition(schedule.interval == nil)
        precondition(!schedule.setPolicy(.paused))
        precondition(schedule.setPolicy(.full))
        precondition(schedule.interval == 1.0 / 15.0)

        func lockedPolicy(onBattery: Bool, level: Int, activity: String = "active") -> PlaybackPolicy {
            PlaybackPolicy.compute(presentationMode: "locked", activityState: activity,
                userPaused: false, alwaysPauseDesktop: true, pauseWhenOccluded: true,
                desktopOccluded: true, pauseOnBattery: false, thermalState: .nominal,
                isOnBattery: onBattery, batteryLevel: level)
        }
        precondition(lockedPolicy(onBattery: false, level: 100) == .full)
        precondition(lockedPolicy(onBattery: true, level: 80) == .reduced)
        precondition(lockedPolicy(onBattery: true, level: 15) == .minimal)
        precondition(lockedPolicy(onBattery: true, level: 9) == .paused)
        precondition(lockedPolicy(onBattery: false, level: 9) == .full)
        precondition(lockedPolicy(onBattery: false, level: 100, activity: "suspended") == .paused)

        func displayPolicy(isBuiltIn: Bool?, brightness: Float) -> PlaybackPolicy {
            PlaybackPolicy.compute(presentationMode: "locked", activityState: "active",
                userPaused: false, alwaysPauseDesktop: false, pauseWhenOccluded: false,
                desktopOccluded: false, pauseOnBattery: false, thermalState: .nominal,
                isOnBattery: false, batteryLevel: 100,
                displayBrightness: PlaybackPolicy.brightnessForDisplay(brightness, isBuiltIn: isBuiltIn))
        }
        precondition(displayPolicy(isBuiltIn: true, brightness: 0) == .paused)
        precondition(displayPolicy(isBuiltIn: true, brightness: 0.5) == .full)
        precondition(displayPolicy(isBuiltIn: false, brightness: 0) == .full)
        precondition(displayPolicy(isBuiltIn: nil, brightness: 0) == .full)
        var watchdog = WallpaperFrameWatchdog()
        precondition(watchdog.observe(now: 100, frameAge: nil) == .none)
        watchdog.firstFrame(at: 100)
        precondition(watchdog.observe(now: 101.9, frameAge: nil) == .none)
        precondition(watchdog.observe(now: 102, frameAge: nil) == .reload)
        precondition(watchdog.observe(now: 104.9, frameAge: nil) == .none)
        precondition(watchdog.observe(now: 105, frameAge: nil) == .reload)
        precondition(watchdog.observe(now: 108, frameAge: 3) == .reload)
        precondition(watchdog.observe(now: 110.9, frameAge: 3) == .none)
        precondition(watchdog.observe(now: 111, frameAge: 3) == .exhausted)
        precondition(watchdog.observe(now: 115, frameAge: 3) == .none)
        precondition(watchdog.observe(now: 116, frameAge: 0) == .none)
        precondition(watchdog.observe(now: 117, frameAge: nil) == .none)
        precondition(watchdog.observe(now: 118, frameAge: 0) == .none)
        for now in 119...126 { precondition(watchdog.observe(now: Double(now), frameAge: 0) == .none) }
        precondition(watchdog.observe(now: 128, frameAge: nil) == .reload)
        watchdog.reset()
        precondition(watchdog.observe(now: 200, frameAge: nil) == .none)
        watchdog.firstFrame(at: 200)
        precondition(watchdog.observe(now: 202, frameAge: nil) == .reload)
        watchdog.reset()
        watchdog.firstFrame(at: 300)
        precondition(watchdog.observe(now: 301, frameAge: 0) == .none)
        precondition(watchdog.observe(now: 303, frameAge: 2) == .reload)
        var navigations = WallpaperNavigationTracker<NSObject>()
        let oldNavigation = NSObject()
        let newNavigation = NSObject()
        precondition(!navigations.accepts(nil))
        precondition(!navigations.accepts(oldNavigation))
        navigations.track(oldNavigation)
        precondition(navigations.accepts(oldNavigation))
        navigations.track(newNavigation)
        var loaded = false
        if navigations.accepts(newNavigation) { loaded = true }
        if navigations.accepts(oldNavigation) { loaded = false }
        precondition(loaded)
        precondition(!navigations.accepts(nil))
        navigations.track(nil)
        precondition(!navigations.accepts(newNavigation))
        print("Wallpaper frame policy: OK")
    }
}
