# Lidscape: plan

## Capability status

| Capability | Status |
| --- | --- |
| World map, zoom, city selection and separate menus | Built and checked in the browser and Mac app. |
| Map fold from the lid | Built. Peter confirmed the fold direction on a real MacBook. |
| Mac screen saver | Partial. The Mac app installs it. A separate ZIP is signed, notarized and ready to publish. Full-screen and wake tests remain. |
| iPhone motion screen saver | Planned. The paper scene responds to phone tilt in a full-screen app. |
| iPhone Lock Screen image | Planned. Export a still image or short Live Photo from Lidscape. |
| Desktop wallpaper | Planned. |
| Separate menus for other motifs | Planned. |

See [the world map design](superpowers/specs/2026-10-27-world-map-design.md).

## Later work

### Mac screen saver

- Package a local `.saver` module with the Mac app. macOS uses the Screen Saver framework for third-party screen savers.
- Bundle the picture code for offline use. The website still loads its modules without a build step.
- Save the screen saver's city, theme, variant and view in macOS Options. The same controls work with and without the app.
- Theme and variant effect sliders use their defaults. Add screen saver controls for those values later.
- Use the lid as the only active input. Keep the camera, pointer, gestures and menus out of the screen saver.
- Let the app install and remove its own screen saver module. Select the active screen saver in macOS settings.
- Publish the signed, notarized `.saver` as a separate ZIP download. The ZIP is built locally. Its macOS Options sheet provides settings without the app.
- The city and map passed the real macOS preview on macOS 27. The image stayed visible after five seconds.
- Test full-screen display, multiple screens and wake-up on a real Mac. Apple reports [legacy screen saver faults](https://developer.apple.com/forums/thread/787444) on secondary displays.
- The [Mac Lock Screen](https://support.apple.com/en-ie/guide/mac-help/mchl8e8b6a34/27/mac/27) shows the selected screen saver after inactivity. Verify Lidscape there during the full-screen test.

### Desktop wallpaper

- Start with an exported still image of the current scene. The still image needs no live inputs.
- Evaluate a moving background separately. Check battery use and macOS support.
- Give the moving background its own saved settings. Enable only inputs that work while it is in the background.

### iPhone motion screen saver

- Build a full-screen iPhone view of the paper scene. Use [Core Motion device attitude](https://developer.apple.com/documentation/coremotion/cmdevicemotion) to move the view when the phone tilts.
- Smooth motion, provide a neutral-position reset, and keep the scene stable when the phone rests. Add a touch fallback when motion data is unavailable.
- Let the user choose the city, theme and variant. Pause rendering and motion updates when the app leaves the foreground.
- Test portrait and landscape layouts, battery use, motion comfort and real-device performance.
- Investigate a [StandBy widget](https://developer.apple.com/design/human-interface-guidelines/widgets) for a still image. Apple describes widgets as non-real-time content, so the moving scene needs the open app.
- Export a still image for the [iPhone Lock Screen](https://support.apple.com/en-by/guide/iphone/-iph4d0e6c351/ios). Evaluate a Live Photo that plays briefly when the phone wakes. The gyro-controlled scene still needs the open app.

### Other motifs

- Add a separate menu for scenes such as a car or a teddy bear. Keep them outside the world map.
