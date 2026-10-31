# Wallpaper for macOS

This directory contains the wallpaper host and extension. The Mac app includes controls to install and remove the wallpaper. The feature is not ready for release.

The experiment uses private macOS interfaces. It was tested on one Mac running macOS 27. It may stop working after a macOS update. App Store distribution is not established.

The app now uses the bundle identifier `se.sandstream.lidscape.wallpaper`. The extension uses the same identifier with `.extension` appended. Settings saved by the earlier `websensorprobe` app are not migrated. The previous probe and its settings are not removed.

The app accepts `--register-only` for a windowless discovery check. It waits for PlugInKit to report this app's extension and exits with a nonzero status if discovery fails. This does not select a wallpaper. The Mac app used this mode to register the extension in a real Mac test.

The Mac app offers separate choices for city, theme, and variant. The variant list includes Christmas. It stores those choices in a shared app group. It does not change the screen saver's settings. Older settings that selected the world map now display the city. Active views check for changes and reload the scene. A real Mac test saved Christmas before selecting the wallpaper. The Lock Screen displayed Stockholm, and Peter confirmed that the book followed the lid. Live changes while the wallpaper is active still need a native test.

The renderer captures a 1280 by 720 WebKit view with a target of 15 frames per second. It logs the measured rate every ten seconds. The first interval includes startup. A separate local test reached about 15 frames per second in stable intervals. Peter reported smoother snowfall and confirmed that the book followed the lid on the Lock Screen. One interval had a lower rate. The renderer uses full scene quality so that Christmas ice is visible. It does not adapt to the display resolution. Each wallpaper surface creates its own WebKit view. Battery and memory use have not been measured.

The capture schedule targets ten frames per second on battery and five under serious thermal pressure or low battery. It stops capture and pauses the scene when the system reports a paused policy. A unit test checks policy changes. A browser test checks scene pause and resume. Battery operation, the adaptive policy on the Lock Screen, and wake from sleep still need native tests.

The experiment uses a separate sensor app and a localhost connection. The extension has permission to make outbound network connections. The connection has no server authentication. The scene clears its lid angle when the connection fails. A browser test covers this reset; a real sensor disconnection in the extension remains untested.

The Mac app installed and removed the wallpaper in a real Mac test. The app removed its extension registration before removal. The user must select another wallpaper before removal or update. The app cannot restore the previous wallpaper automatically. Updates in macOS, startup while locked, sleep and wake, display changes, long-running behavior, and distribution remain untested.

The macOS 27 SDK reports six concurrency warnings in the upstream rendering code. They concern main-actor access to AVFoundation display layer properties. The video renderer accounts for three warnings. The layer deck and surface account for three.

Moving individual calls to the main actor does not establish exclusive ownership. The render queue can still change the same layers during a build, geometry update, or teardown. A fix needs one clear owner for layer state and an asynchronous handoff between that owner and the render queue. It must preserve the order of flush, layer reuse, cancellation, and the first frame.

Before release, test the real video and city renderers on a Mac. Check rapid content changes, resize, pause and resume, teardown, and two displays. Check the Lock Screen, sleep, and wake. `sh wallpaper/tests/check-video-renderer.sh` checks video setup, decoding, pause, resume, and a missing file. It does not prove thread safety.

## Build

Install the workspace dependencies, Bun, Xcode, and Playwright's Chromium. Then run `sh wallpaper/build.sh`. The script builds the offline scene and sensor from the current project sources. It writes a signed local app to `dist/wallpaper-probe`. It does not register the app or change wallpaper settings.

The script refuses to replace an existing app. Set `LIDSCAPE_WALLPAPER_BUILD_OUTPUT` to an empty directory for another build.

The default signature is ad hoc. Set `APPLE_SIGNING_IDENTITY` to a local signing identity to use that identity. The output is not notarized. A successful signature check does not establish that the app will run on another Mac.

The choice list in `ProbeHost/options.json` comes from `node screensaver/options.mjs`. Compare them when city, theme, or variant definitions change.

## Settings checks

Run this command from the project root. The check uses temporary files and does not launch the app.

```sh
sh wallpaper/tests/check-settings.sh
sh wallpaper/tests/check-frame-policy.sh
```

## Source and licenses

The extension code is adapted from [Driftwood](https://github.com/iamEvanYT/driftwood), commit `17565db7fb208bb5094ca49e79d07e6181fce1a1`. The native wallpaper extension is also adapted from [Phosphene](https://github.com/kageroumado/phosphene). Preserve [DRIFTWOOD-LICENSE](DRIFTWOOD-LICENSE) and the Phosphene notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when distributing derived code.
