#!/bin/sh
# Build a self-contained screen saver. The website still loads its modules from
# jsDelivr; only the native screen saver packages them into one offline file.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
case "${1:-app}" in
  app) OUT="$ROOT/app/src-tauri/target/screensaver/LidscapeScreenSaver.saver" ;;
  standalone) OUT="$ROOT/dist/LidscapeScreenSaver.saver" ;;
  *) echo 'Use: build.sh [app|standalone]' >&2; exit 2 ;;
esac
CONTENTS="$OUT/Contents"
WEB="$CONTENTS/Resources/web"
test -f "$ROOT/node_modules/three/build/three.module.js" || { echo 'Install workspace dependencies first.' >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$CONTENTS/MacOS" "$WEB"
cp "$ROOT/screensaver/Info.plist" "$CONTENTS/Info.plist"
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$ROOT/app/src-tauri/tauri.conf.json" | head -1)
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$CONTENTS/Info.plist"
BUNDLE_VERSION=$(printf '%s' "$VERSION" | awk -F. '{ print $1 * 1000000 + $2 * 10000 + $3 * 100 + 1 }')
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUNDLE_VERSION" "$CONTENTS/Info.plist"
cp "$ROOT/screensaver/index.html" "$WEB/index.html"
bun build --target=browser --format=iife --outfile="$WEB/saver.js" "$ROOT/src/saver-main.js"
node "$ROOT/screensaver/generate-thumbnail.mjs" "$WEB/index.html" "$CONTENTS/Resources"
node "$ROOT/screensaver/options.mjs" > "$CONTENTS/Resources/options.json"
xcrun swiftc -O "$ROOT/bridge/LidBridge.swift" -o "$CONTENTS/Resources/lid-bridge"
xcrun swiftc -emit-library -O -module-name LidscapeSaver -framework AppKit -framework ScreenSaver -framework WebKit \
  "$ROOT/screensaver/LidscapeSaver.swift" -o "$CONTENTS/MacOS/LidscapeSaver"
IDENTITY=${APPLE_SIGNING_IDENTITY:--}
if [ "$IDENTITY" = '-' ]; then
  codesign --force --sign - "$CONTENTS/Resources/lid-bridge"
  codesign --force --sign - "$OUT"
else
  codesign --force --sign "$IDENTITY" --options runtime --timestamp "$CONTENTS/Resources/lid-bridge"
  codesign --force --sign "$IDENTITY" --options runtime --timestamp "$OUT"
fi
codesign --verify --deep --strict "$OUT"
echo "Built $OUT"
