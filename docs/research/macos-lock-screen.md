# Lidscape on the macOS Lock Screen

Research date: 29 October 2026. The Mac in the test runs macOS 27.

## Findings

- Apple provides the [Screen Saver framework](https://developer.apple.com/documentation/screensaver) for animated third-party screen savers. The system creates and controls the view. Lidscape uses this path.
- Apple says the [Lock Screen displays the selected screen saver after inactivity](https://support.apple.com/en-mk/guide/mac-help/mchl8e8b6a34/mac). Apple also says that the Lock Screen command can start the screen saver in its [screen saver guide](https://support.apple.com/en-ie/guide/mac-help/mchl4b68853d/27/mac/27). These descriptions do not establish that all lock methods start every screen saver immediately under all power assertions.
- Apple documents [`NSWorkspace.setDesktopImageURL`](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29) for setting a desktop image. It does not describe a live scene with sensor input on the Lock Screen. Apple also documents [selecting a photo as wallpaper](https://support.apple.com/en-gb/guide/mac-help/mchlp3013/26/mac/26).
- This research did not find an Apple public API for a third-party app to supply a continuously animated, sensor-controlled background behind the macOS Lock Screen authentication controls. This is a limit of the search, not proof that every possible approach is impossible.
- The [Screen Saver documentation](https://developer.apple.com/documentation/screensaver) says that the system stops a screen saver when the user takes an action. A scene that reacts to the lid without pointer or keyboard input is a different case. The documentation does not promise that the sensor remains accessible when locked.
- Apple documents [hot corners](https://support.apple.com/en-me/guide/mac-help/mchlp3000/mac) as a way to start a screen saver immediately. It separately documents [password timing after a screen saver starts](https://support.apple.com/en-gb/guide/mac-help/mchlp2270/27/mac/27). Neither source guarantees that a hot corner overrides another app's display assertion.
- Apple Developer Forums contain [reports of macOS screen saver issues](https://developer.apple.com/forums/thread/787444), including secondary displays and preview lifecycle issues. These are reports, not proof of the cause on this Mac.

## Evidence from this Mac

- System Settings showed Lidscape selected as the custom screen saver, with a one-minute idle time. Golden Gate was the selected desktop wallpaper.
- At 12:22:13 on 29 October, the system logged a manual lock request. It logged that the screen saver was not running and that it would use the desktop picture.
- At 12:22:58, the system logged `PMNoDisplaySleepEnabled so do not launch screen saver`. The power assertion named `Microsoft Teams Call in progress` blocked idle display sleep. This is what Teams reported; it does not establish the state of a meeting.
- The screen was unlocked at 12:23:17. At the earlier check, the system reported 44.7 seconds of user inactivity. The log does not establish a full minute of uninterrupted idle time before that check.
- The earlier `ScreenSaverEngine` test started Lidscape manually from the unlocked desktop. The system received rendered frames and lid angles there. That test did not establish what a person would see on the locked screen.
- A later test started Lidscape and then used Control-Command-Q. The key press stopped the screen saver, and Peter saw Golden Gate on the Lock Screen. The system reported that the screen saver was no longer running when the manual lock request arrived.
- In a later manual lock test, loginwindow set a 30-second timer for the lock screen login view. When it expired, macOS turned both displays off. The screen saver was not running. The normal display sleep setting was ten minutes, and the log did not identify a supported setting for the lock screen timer.
- The Mac's profile sets the password requirement to five seconds after the screen saver starts. This is a delay, not immediate locking.

These observations show that macOS did not start the screen saver during that locked interval. They do not prove that Lidscape cannot display or respond to the lid after the system starts it on a locked Mac.

## Next tests

1. When Teams releases its display assertion, lock the Mac and leave it untouched. Record the image, the time and the system log. Allow for the system's idle check interval.
2. Separately test a hot corner configured to start the selected screen saver. Keep the existing password policy unchanged. Check whether Lidscape starts while the Teams assertion exists.
3. After the five-second password delay, verify that authentication is required. Move the lid while the saver is visible and record whether the book follows it.
4. Test an Apple-menu lock separately from the hot corner. Record whether the Lock Screen shows Lidscape or the desktop picture immediately, and whether it changes later.

The hot-corner test starts a screen saver first. It does not by itself satisfy a requirement for immediate password protection or for the usual manual lock command to display Lidscape. Starting the saver before Control-Command-Q did not meet the latter requirement in the test above.
