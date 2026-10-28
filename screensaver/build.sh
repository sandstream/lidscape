#!/bin/sh
# Build a self-contained screen saver. The website still loads its modules from
# jsDelivr; only the native screen saver packages them into one offline file.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/app/src-tauri/target/screensaver/Lidscape.saver"
CONTENTS="$OUT/Contents"
WEB="$CONTENTS/Resources/web"
test -f "$ROOT/node_modules/three/build/three.module.js" || { echo 'Install workspace dependencies first.' >&2; exit 1; }
test -x "$ROOT/app/src-tauri/binaries/lid-bridge-aarch64-apple-darwin" || { echo 'Stage the Mac app first.' >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$CONTENTS/MacOS" "$WEB"
cp "$ROOT/screensaver/Info.plist" "$CONTENTS/Info.plist"
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$ROOT/app/src-tauri/tauri.conf.json" | head -1)
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$CONTENTS/Info.plist"
cp "$ROOT/screensaver/index.html" "$WEB/index.html"
bun build --target=browser --format=iife --outfile="$WEB/saver.js" "$ROOT/src/saver-main.js"
cp "$ROOT/app/src-tauri/binaries/lid-bridge-aarch64-apple-darwin" "$CONTENTS/Resources/lid-bridge"
xcrun swiftc -emit-library -O -module-name LidscapeSaver -framework AppKit -framework ScreenSaver -framework WebKit \
  "$ROOT/screensaver/LidscapeSaver.swift" -o "$CONTENTS/MacOS/LidscapeSaver"
IDENTITY=${APPLE_SIGNING_IDENTITY:--}
if [ "$IDENTITY" = '-' ]; then
  codesign --force --sign - "$OUT"
else
  codesign --force --sign "$IDENTITY" --options runtime --timestamp "$OUT"
fi
codesign --verify --deep --strict "$OUT"
echo "Built $OUT"
