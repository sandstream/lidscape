# Lidscape on the macOS Lock Screen

Research date: 29 October 2026. The Mac in the test runs macOS 27.

## Findings

- Apple provides the [Screen Saver framework](https://developer.apple.com/documentation/screensaver) for animated third-party screen savers. The system creates and controls the view. Lidscape uses this path.
- Apple says the [Lock Screen displays the selected screen saver after inactivity](https://support.apple.com/en-mk/guide/mac-help/mchl8e8b6a34/mac). Apple also says that the Lock Screen command can start the screen saver in its [screen saver guide](https://support.apple.com/en-ie/guide/mac-help/mchl4b68853d/27/mac/27). These descriptions do not establish that all lock methods start every screen saver immediately under all power assertions.
- Apple documents [`NSWorkspace.setDesktopImageURL`](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29) for setting a desktop image. It does not describe a live scene with sensor input on the Lock Screen. Apple also documents [selecting a photo as wallpaper](https://support.apple.com/en-gb/guide/mac-help/mchlp3013/26/mac/26).
- This research did not find an Apple public API for a third-party app to supply a continuously animated, sensor-controlled background behind the macOS Lock Screen authentication controls. This is a limit of the search, not proof that every possible approach is impossible.
- [Phosphene](https://github.com/kageroumado/phosphene) describes a private WallpaperExtensionKit integration for custom video on the desktop and Lock Screen. The project reports tests on macOS 26 and 27. This is not an Apple-supported API.
- [Driftwood](https://github.com/iamEvanYT/driftwood) describes video and real-time Metal scenes on the Lock Screen. Its [renderer](https://github.com/iamEvanYT/driftwood/blob/main/Shared/Render/MetalSceneRenderer.swift) produces frames in real time. Its [extension](https://github.com/iamEvanYT/driftwood/blob/main/DriftwoodWallpaperExtension/WallpaperXPCHandler.swift) uses private Core Animation and wallpaper interfaces to provide a surface to macOS.
- Neither project establishes that Lidscape's WebKit scene or lid sensor can run in this extension. The extension is sandboxed. Its communication with a separate sensor helper, lock-screen rendering, signing, and removal must be tested on the target Mac.
- A signed local probe adapted from Driftwood displayed a moving Metal scene on the Lock Screen after Control-Command-Q. Peter observed the movement. The probe did not use Lidscape's WebKit scene or lid sensor. It used Driftwood commit `17565db7fb208bb5094ca49e79d07e6181fce1a1` under its MIT license.
- A separate WebKit probe rendered the Lidscape map in an off-screen window. Simulated lid angles changed the map. The same probe without a window produced no rendered frames. Neither configuration was tested in the wallpaper extension.
- Two wallpaper extension probes timed out before their first WebKit frame on the target Mac. One used an off-screen window and one used no window. Neither produced snapshots. Golden Gate Sunset was restored after the tests.
- A later probe used an off-screen WebKit window and the network client entitlement. It loaded the local Stockholm scene and sent frames to the wallpaper surface. Peter locked the Mac with Control-Command-Q and observed Stockholm moving on the Lock Screen. The lid angle was simulated; the real lid sensor was not tested in this probe. Golden Gate Sunset was restored afterward.
- A separate sensor probe started the bundled helper and received lid angles in the wallpaper extension. Peter locked the Mac with Control-Command-Q and observed the book follow the physical lid. Golden Gate Sunset was restored afterward. Startup while already locked, sleep and wake, long-running behavior, and removal remain untested.
- A project-built probe with separate wallpaper settings showed the Stockholm Christmas scene on the Lock Screen. Peter observed snow, ice, and lid movement. He also observed that the snow moved less smoothly than in the app. The probe limited snapshots to five per second.
- A separate 15-frame-per-second probe moved more smoothly on the Lock Screen, and the book followed the lid. The measured rate was near 15 frames per second in steady intervals, with one lower interval. Battery use was not measured.
- A pointer probe used `NSEvent.mouseLocation` to draw a marker in the wallpaper. Peter observed the marker follow the pointer on the Lock Screen. A later probe showed a building name at the correct building on the Lock Screen. The probes did not read clicks or keystrokes. Multi-display accuracy remains to be tested.
- A separate camera probe used Apple Vision to estimate head position. Peter observed the picture follow his head on the Lock Screen. The system hosted surfaces on both displays. The probe processed camera frames locally and did not save them. It wrote a temporary position file, then removed it when the camera stopped. This probe approximates the app's MediaPipe tracking. It did not test sleep, wake, or camera failures.
- A sandboxed local client with network client entitlement received a real lid angle from the existing sensor helper. Other clients were connected, so this did not establish whether the test client alone could keep the helper alive.
- The [Screen Saver documentation](https://developer.apple.com/documentation/screensaver) says that the system stops a screen saver when the user takes an action. A scene that reacts to the lid without pointer or keyboard input is a different case. The documentation does not promise that the sensor remains accessible when locked.
- Apple documents [hot corners](https://support.apple.com/en-me/guide/mac-help/mchlp3000/mac) as a way to start a screen saver immediately. It separately documents [password timing after a screen saver starts](https://support.apple.com/en-gb/guide/mac-help/mchlp2270/27/mac/27). Neither source guarantees that a hot corner overrides another app's display assertion.
- Apple Developer Forums contain [reports of macOS screen saver issues](https://developer.apple.com/forums/thread/787444), including secondary displays and preview lifecycle issues. These are reports, not proof of the cause on this Mac.

## Evidence from this Mac

- System Settings showed Lidscape selected as the custom screen saver, with a one-minute idle time. Golden Gate was the selected desktop wallpaper.
- At 12:22:13 on 29 October, the system logged a manual lock request. It logged that the screen saver was not running and that it would use the desktop picture.
- At 12:22:58, the system logged `PMNoDisplaySleepEnabled so do not launch screen saver`. The power assertion named `Microsoft Teams Call in progress` blocked idle display sleep. This is what Teams reported; it does not establish the state of a meeting.
- The screen was unlocked at 12:23:17. At the earlier check, the system reported 44.7 seconds of user inactivity. The log does not establish a full minute of uninterrupted idle time before that check.
- The earlier `ScreenSaverEngine` test started Lidscape manually from the unlocked desktop. The system received rendered frames and lid angles there. Peter also saw Lidscape after the system presented the lock interface during a screen saver test.
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
