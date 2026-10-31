#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-registration-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
sed '/^@main$/d' "$ROOT/wallpaper/ProbeHost/ProbeApp.swift" > "$WORK/ProbeApp.swift"
cp "$ROOT/wallpaper/tests/WallpaperRegistrationCheck.swift" "$WORK/main.swift"
xcrun swiftc -framework AppKit "$WORK/ProbeApp.swift" "$ROOT/wallpaper/ProbeHost/ProbeSettings.swift" "$ROOT/wallpaper/Shared/WallpaperSharedSettings.swift" "$WORK/main.swift" -o "$WORK/check-registration"
"$WORK/check-registration"
