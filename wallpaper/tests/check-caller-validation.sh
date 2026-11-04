#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-caller-validation.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc -import-objc-header "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperExtension-Bridging-Header.h" \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/CallerValidation.swift" \
  "$ROOT/wallpaper/tests/CallerValidationCheck.swift" -o "$WORK/check"
"$WORK/check"
