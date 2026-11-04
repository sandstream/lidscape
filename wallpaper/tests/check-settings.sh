#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-wallpaper-settings-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc "$ROOT/wallpaper/Shared/WallpaperSharedSettings.swift" \
  "$ROOT/wallpaper/ProbeHost/ProbeSettings.swift" \
  "$ROOT/wallpaper/tests/ProbeSettingsCheck.swift" -o "$WORK/check"
"$WORK/check" "$ROOT/wallpaper/ProbeHost/options.json"
node "$ROOT/screensaver/options.mjs" > "$WORK/options.json"
if ! cmp -s "$WORK/options.json" "$ROOT/wallpaper/ProbeHost/options.json"; then
  echo 'Wallpaper choices do not match the city, theme, and variant lists.' >&2
  exit 1
fi
