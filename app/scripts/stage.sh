#!/bin/sh
# Copies the page into app/web (the app's frontend) and builds the lid bridge as
# the app's helper, the way Lyssna ships lyssna-audio.
set -e
cd "$(dirname "$0")/.."
ROOT=..
rm -rf web
mkdir -p web
cp "$ROOT/index.html" web/
cp -R "$ROOT/src" "$ROOT/assets" web/
find web/src -type f \( -name '*.test.js' -o -name '*.test-support.js' \) -delete
mkdir -p src-tauri/binaries
MINIMUM_MACOS_VERSION=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["bundle"]["macOS"]["minimumSystemVersion"])')
xcrun swiftc -target "arm64-apple-macosx$MINIMUM_MACOS_VERSION" -O "$ROOT/bridge/LidBridge.swift" -o src-tauri/binaries/lid-bridge-aarch64-apple-darwin
sh "$ROOT/screensaver/build.sh"
WALLPAPER_OUT="$PWD/src-tauri/target/wallpaper"
mkdir -p "$WALLPAPER_OUT"
rm -rf "$WALLPAPER_OUT/Lidscape Wallpaper.app"
rm -f "$WALLPAPER_OUT/Lidscape Wallpaper.zip"
VERSION=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
LIDSCAPE_WALLPAPER_VERSION="$VERSION" LIDSCAPE_WALLPAPER_BUILD_OUTPUT="$WALLPAPER_OUT" sh "$ROOT/wallpaper/build.sh"
/usr/bin/ditto -c -k --keepParent "$WALLPAPER_OUT/Lidscape Wallpaper.app" "$WALLPAPER_OUT/Lidscape Wallpaper.zip"
if [ "${LIDSCAPE_NOTARIZE_WALLPAPER:-0}" = 1 ]; then
  : "${APPLE_API_KEY:?APPLE_API_KEY is required}"
  : "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
  : "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH is required}"
  NOTARY_RESULT=$(mktemp "${TMPDIR:-/tmp}/lidscape-wallpaper-notary.XXXXXX")
  trap 'rm -f "$NOTARY_RESULT"' EXIT HUP INT TERM
  xcrun notarytool submit "$WALLPAPER_OUT/Lidscape Wallpaper.zip" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
    --wait --output-format json > "$NOTARY_RESULT"
  if ! python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])).get("status") != "Accepted")' "$NOTARY_RESULT"; then
    cat "$NOTARY_RESULT" >&2
    echo "FAIL: wallpaper notarization was not accepted" >&2
    exit 1
  fi
  xcrun stapler staple "$WALLPAPER_OUT/Lidscape Wallpaper.app"
  xcrun stapler validate "$WALLPAPER_OUT/Lidscape Wallpaper.app"
  rm -f "$WALLPAPER_OUT/Lidscape Wallpaper.zip"
  /usr/bin/ditto -c -k --keepParent "$WALLPAPER_OUT/Lidscape Wallpaper.app" "$WALLPAPER_OUT/Lidscape Wallpaper.zip"
  rm -f "$NOTARY_RESULT"
  trap - EXIT HUP INT TERM
fi
rm -rf "$WALLPAPER_OUT/Lidscape Wallpaper.app"
echo "Staged web/, lid bridge, screen saver, and wallpaper host archive"
