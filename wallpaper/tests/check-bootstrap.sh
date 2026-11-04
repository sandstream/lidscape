#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-bootstrap-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc "$ROOT/wallpaper/Shared/MetalScenePackage.swift" \
  "$ROOT/wallpaper/Shared/WallpaperAssignmentManifest.swift" \
  "$ROOT/wallpaper/ProbeHost/ProbeChoiceMapping.swift" \
  "$ROOT/wallpaper/ProbeHost/ProbeBootstrap.swift" \
  "$ROOT/wallpaper/tests/ProbeBootstrapCheck.swift" -o "$WORK/check"
"$WORK/check"
