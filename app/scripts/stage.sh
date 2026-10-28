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
swiftc -O "$ROOT/bridge/LidBridge.swift" -o src-tauri/binaries/lid-bridge-aarch64-apple-darwin
sh "$ROOT/screensaver/build.sh"
echo "Staged web/, binaries/lid-bridge, and LidscapeScreenSaver.saver"
