#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-shared-settings-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc "$ROOT/wallpaper/Shared/WallpaperSharedSettings.swift" \
  "$ROOT/wallpaper/tests/WallpaperSharedSettingsCheck.swift" -o "$WORK/check"
"$WORK/check"
