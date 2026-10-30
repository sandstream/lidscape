#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-webkit-watchdog.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/WatchdogTest.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>se.sandstream.lidscape.watchdogtest</string>
<key>CFBundleExecutable</key><string>WatchdogTest</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
cp "$ROOT/wallpaper/tests/WallpaperWebKitWatchdogTest.html" "$APP/Contents/Resources/web/index.html"
xcrun swiftc -framework AppKit -framework WebKit -framework AVFoundation -framework CoreMedia -framework CoreVideo -framework QuartzCore \
  "$ROOT/wallpaper/Shared/Render/PlaybackPolicy.swift" \
  "$ROOT/wallpaper/Shared/Render/PointerGeometry.swift" \
  "$ROOT/wallpaper/Shared/Render/MetalSceneRenderer.swift" \
  "$ROOT/wallpaper/tests/WallpaperWebKitWatchdogCheck.swift" -o "$APP/Contents/MacOS/WatchdogTest"
codesign --force --sign - "$APP" >/dev/null
python3 - "$APP/Contents/MacOS/WatchdogTest" <<'PYTEST'
import subprocess
import sys
try:
    subprocess.run([sys.argv[1]], check=True, timeout=60)
except subprocess.TimeoutExpired:
    print("The offscreen WebKit test timed out. The test process was stopped.", file=sys.stderr)
    sys.exit(1)
PYTEST
