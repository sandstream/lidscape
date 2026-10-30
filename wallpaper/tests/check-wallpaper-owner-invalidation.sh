#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-wallpaper-owner.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors -parse-as-library \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperState.swift" \
  "$ROOT/wallpaper/tests/WallpaperOwnerInvalidationCheck.swift" -o "$WORK/check"
"$WORK/check"
