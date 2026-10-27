# Lidscape: plan

## Capability status

| Capability | Status |
| --- | --- |
| World map, zoom, city selection and separate menus | Built and checked in the browser and Mac app. |
| Map fold from the lid | Built. The manual fold was checked. A physical lid close still needs a check. |
| Mac screen saver | Planned. |
| Desktop wallpaper | Planned. |
| Separate menus for other motifs | Planned. |

See [the world map design](superpowers/specs/2026-10-27-world-map-design.md).

## Later work

### Mac screen saver

- Prototype an app extension inside `Lidscape.app` on macOS 27.
- Apple reports a [WebKit display fault](https://developer.apple.com/forums/thread/820860) in older screen saver modules. Test scene rendering before adding installation.
- Save the screen saver's city, theme and view in the app.
- Use the lid as the only active input at first. Disable the camera, pointer and gestures. Hide interactive controls.
- Test preview, full-screen display, multiple screens and wake-up on a real Mac.

### Desktop wallpaper

- Start with an exported still image of the current scene. The still image needs no live inputs.
- Evaluate a moving background separately. Check battery use and macOS support.
- Give the moving background its own saved settings. Enable only inputs that work while it is in the background.

### Other motifs

- Add a separate menu for scenes such as a car or a teddy bear. Keep them outside the world map.
