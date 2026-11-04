#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-display-names.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors -parse-as-library \
  "$ROOT/wallpaper/Shared/MetalScenePackage.swift" \
  "$ROOT/wallpaper/Shared/WallpaperAssignmentManifest.swift" \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperDisplayNames.swift" \
  "$ROOT/wallpaper/tests/WallpaperDisplayNamesCheck.swift" -o "$WORK/check"
"$WORK/check"
