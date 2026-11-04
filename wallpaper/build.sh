#!/bin/sh
# Build the isolated wallpaper experiment. This does not register or select it.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${LIDSCAPE_WALLPAPER_BUILD_OUTPUT:-"$ROOT/dist/wallpaper-probe"}
if [ -e "$OUT/Lidscape Wallpaper.app" ]; then
  echo "A previous build exists at $OUT/Lidscape Wallpaper.app." >&2
  echo 'Choose an empty directory with LIDSCAPE_WALLPAPER_BUILD_OUTPUT.' >&2
  exit 1
fi
VERSION=${LIDSCAPE_WALLPAPER_VERSION:-0.0.1}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-wallpaper-build.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
test -f "$ROOT/node_modules/three/build/three.module.js" || { echo 'Install workspace dependencies first.' >&2; exit 1; }
command -v bun >/dev/null || { echo 'Install bun first.' >&2; exit 1; }
cp -R "$ROOT/wallpaper/." "$WORK/"
node "$ROOT/screensaver/options.mjs" > "$WORK/ProbeHost/options.json"
mkdir -p "$WORK/ProbeHost/web" "$WORK/ProbeHost/Lidscape Sensor.app/Contents/MacOS"
cp "$ROOT/screensaver/index.html" "$WORK/ProbeHost/web/index.html"
cp "$ROOT/assets/fonts/instrument-serif-italic.woff2" "$WORK/ProbeHost/web/instrument-serif-italic.woff2"
cp "$ROOT/assets/fonts/OFL.txt" "$WORK/ProbeHost/web/InstrumentSerif-LICENSE.txt"
bun build --target=browser --format=iife --outfile="$WORK/ProbeHost/web/saver.js" "$ROOT/src/saver-main.js"
node "$ROOT/wallpaper/generate-poster.mjs" "$WORK/ProbeHost/web/index.html" "$WORK/ProbeHost/poster.png"
cp "$ROOT/screensaver/SensorInfo.plist" "$WORK/ProbeHost/Lidscape Sensor.app/Contents/Info.plist"
xcrun swiftc -O "$ROOT/bridge/LidBridge.swift" -o "$WORK/ProbeHost/Lidscape Sensor.app/Contents/MacOS/lid-bridge"
IDENTITY=${APPLE_SIGNING_IDENTITY:--}
codesign --force --sign "$IDENTITY" --options runtime "$WORK/ProbeHost/Lidscape Sensor.app"
xcodebuild -quiet -project "$WORK/LidscapeSensorWallpaperProbe.xcodeproj" \
  -scheme LidscapeSensorWallpaperProbe -configuration Release -derivedDataPath "$WORK/build" \
  CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION="$VERSION" MARKETING_VERSION="$VERSION" build
APP="$WORK/build/Build/Products/Release/Lidscape Wallpaper.app"
EXTENSION="$APP/Contents/Extensions/LidscapeWallpaperExtension.appex"
mkdir -p "$APP/Contents/Resources/Licenses"
cp "$WORK/DRIFTWOOD-LICENSE" "$WORK/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/Licenses/"
codesign --force --sign "$IDENTITY" --options runtime \
  --entitlements "$WORK/DriftwoodWallpaperExtension/DriftwoodWallpaperExtension.entitlements" "$EXTENSION"
codesign --force --sign "$IDENTITY" --options runtime --entitlements "$WORK/ProbeHost/ProbeHost.entitlements" "$APP"
codesign --verify --deep --strict "$APP"
mkdir -p "$OUT"
if [ -e "$OUT/Lidscape Wallpaper.app" ]; then
  echo "Remove the previous build at $OUT/Lidscape Wallpaper.app before rebuilding." >&2
  exit 1
fi
cp -R "$APP" "$OUT/"
codesign --verify --deep --strict "$OUT/Lidscape Wallpaper.app"
echo "Built $OUT/Lidscape Wallpaper.app"
