#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-pointer-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc "$ROOT/wallpaper/Shared/Render/PointerGeometry.swift" \
  "$ROOT/wallpaper/tests/PointerGeometryCheck.swift" -o "$WORK/check"
"$WORK/check"
