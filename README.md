# Lidscape

A pop-up paper city behind your screen. Open the MacBook lid and the city folds up, the windows light up and a tram rolls in. The webcam tracks your head, so the screen works like a window. An open hand turns the lights on, a fist turns them off.

![Stockholm](docs/stockholm.png)

First city: Stockholm (Södermalm, Stadshuset, Riddarholmen, Slottet, Gamla stan, Skeppsbron).

## Run

```bash
python3 -m http.server 5173     # any static server works
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
| `?progress=0.6` | Start value for the fold (0 to 1) |
| `?lights=off` | Start with the lights off |

## How it works

| File | Role |
|---|---|
| `src/cities/stockholm.js` | City definition: layers, buildings, tram. Add a city by adding a file. |
| `src/city.js` | Builds paper cards from the definition and animates fold, lights, tram |
| `src/offaxis.js` | Head-coupled off-axis projection; the screen is a 30 × 19.5 cm window |
| `src/tracking.js` | MediaPipe face (iris distance gives depth) and hand pose |
| `src/lid.js` | WebSocket client for the lid bridge |
| `bridge/LidBridge.swift` | Reads the lid sensor over IOKit HID and serves it on localhost |

## Credits

- Lid sensor approach: [samhenrigold/LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor) (Apache 2.0)
- Off-axis projection: Robert Kooima, *Generalized Perspective Projection*
- Inspired by Gabi Duncombe's pop-up MacBook demo
