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
        print("Wallpaper frame policy: OK")
    }
}
