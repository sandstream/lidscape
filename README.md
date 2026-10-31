# Lidscape

A pop-up paper city behind your screen. Open the MacBook lid and the city folds up, the windows light up and a tram rolls in. The webcam tracks your head, so the screen works like a window. An open hand turns the lights on, a fist turns them off.

![Stockholm](docs/stockholm.png)

First city: Stockholm at blue hour, seen from Skeppsholmen: Skeppsbron's merchant palaces in front, Kungliga slottet on the water, the spires of Tyska kyrkan, Riddarholmskyrkan and Storkyrkan, Stadshuset behind, and Katarina kyrka and Globen over Söder. Hover a landmark for its name and a line of facts.

## Mac app

The app wraps the page in a native window and starts the lid bridge by itself.
It needs an Apple Silicon Mac with macOS 14.4 or later. The lid works on M2 and
later; on other Macs the slider and scroll open the book.

```bash
cd app
bun install
bun run build          # Lidscape.app, signed ad hoc
sh scripts/build-dmg.sh   # signed with Developer ID and notarized, when the Mac has the keys
```

On first start the app checks the Mac: without WebGL 2 it says so, a slow Mac
gets lower quality, and a Mac without a lid sensor or camera is told plainly.
The lid sensor cannot be read inside the App Store sandbox without a temporary
IOKit exception, so the app ships outside the App Store.

### Screen saver

The image shows the packaged screen saver with the book open:

![Stockholm screen saver](docs/screensaver-city.png)

The screen saver is also a separate Mac download. It does not need Lidscape.app.
On macOS 27 or later, unzip `Lidscape-Screen-Saver_<version>_arm64.zip` and
double-click `LidscapeScreenSaver.saver`. Confirm installation for this user in macOS.
Open Mac settings, choose **Screen Saver**, switch to **Custom**, and select Lidscape.
Use the screen saver's **Options** control to choose the city, theme, and variant.
To remove it, delete `~/Library/Screen Savers/LidscapeScreenSaver.saver`.
The screen saver starts its bundled sensor app while it runs. The sensor app
reads the lid angle and sends it to the screen saver. It does not use the camera.

The build captures Stockholm at two sizes: a small settings thumbnail and a
full-screen poster. The poster appears while the animated scene starts.
The full-screen screen saver rendered live in macOS on a real MacBook. The lid
sensor connected there. Closing the physical lid and waking the Mac still need
a separate check before release.
Build the separate download from the repository root:

```bash
bun install
bunx playwright install chromium
sh screensaver/build-download.sh
```

For a public release, set `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`,
`APPLE_API_ISSUER` and `APPLE_API_KEY_PATH`, then add `--notarize`.
The ZIP file appears in `dist/` and can be attached to a GitHub release.

The Mac app offers the same screen saver through its settings:

On macOS 27 or later, open **Screen Saver** in the Lidscape app and select **Install**.
Confirm installation for this user in macOS.
Open Mac settings, choose **Screen Saver**, switch to **Custom**, and select Lidscape.
Choose the picture with **Options** in Mac settings.
To remove it, select **Remove** in the Lidscape app.

## Run in a browser

```bash
python3 tools/serve.py           # or any static server
open http://localhost:5173
```

No build step and no npm dependencies. Three.js and MediaPipe load from jsDelivr.

### Lid angle (optional)

```bash
swift bridge/LidBridge.swift
```

Streams the lid angle to `ws://127.0.0.1:8787`. The page connects by itself and falls back to scroll, arrow keys or the slider when the bridge is not running.

The lid sensor has no public API. It works on Apple Silicon MacBooks, confirmed on M2 and later; M1 is reported not to work. Desktop Macs have no lid, so use gestures or scroll there.

### URL parameters

| Parameter | Effect |
|---|---|
| `?city=stockholm` | Which city to show (see `src/cities/index.js`) |
| `?theme=miniature` | The artistic form: `paper` (default) or `miniature`, with settings such as `&focus=0.4` |
| `?variant=christmas` | An occasion over the theme, with settings such as `&snow=0.3` |
| `?progress=0.6` | Start value for the fold (0 to 1) |
| `?lights=off` | Start with the lights off |
| `?quality=low` | Skip the speed check and draw at lower quality (or `high`) |
| `?lang=sv` | Language: `en` (default) or `sv`. Without it the page uses the last choice, then the Mac's language |

## How it works

| File | Role |
|---|---|
| `src/cities/stockholm.js` | City definition: layers, landmark outlines, tram |
| `src/cities/index.js` | The list of cities |
| `docs/cities/` | Research per city: viewpoint, landmarks, sources |
| `src/themes/`, `src/post.js` | Themes: the artistic form, as post treatment |
| `src/variants/`, `src/effects.js` | Variants: occasions such as Christmas, and their effects |
| `src/traits.js` | What a city has (snow, advent stars); variants respect it |
| `tools/check-cities.mjs` | Checks every city, theme and variant; runs on each pull request |
| `src/city.js` | Builds paper cards from the definition and animates fold, lights, tram |
| `src/offaxis.js` | Head-coupled off-axis projection; the screen is a 30 × 19.5 cm window |
| `src/tracking.js` | MediaPipe face (iris distance gives depth) and hand pose |
| `src/lid.js` | WebSocket client for the lid bridge |
| `bridge/LidBridge.swift` | Reads the lid sensor over IOKit HID and serves it on localhost |
| `screensaver/` | Builds the offline Mac screen saver module |

## Add a city, a theme or a variant

New cities, themes and variants come in as pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md). With Claude Code or Codex, open the repo and say "Build Göteborg"; [AGENTS.md](AGENTS.md) tells the agent what to do.

## License

- Code: [MIT](LICENSE).
- Cities, themes, variants, research and screenshots: [CC BY 4.0](LICENSE-CONTENT). Credit
  "Lidscape by Sandstream AB and contributors".
- Font: Instrument Serif, SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`).
- The name Lidscape and the app icon are not covered by these licenses.

## Credits

- Lid sensor approach: [samhenrigold/LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor) (Apache 2.0)
- Off-axis projection: Robert Kooima, *Generalized Perspective Projection*
- Inspired by Gabi Duncombe's pop-up MacBook demo
