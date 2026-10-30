#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-handoff-owner.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
python3 - "$ROOT/wallpaper/tests/WallpaperOwnerInvalidationCheck.swift" "$WORK/Stubs.swift" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
marker = '@main\nstruct WallpaperOwnerInvalidationCheck'
if source.count(marker) != 1:
    raise SystemExit('State test stubs changed')
pathlib.Path(sys.argv[2]).write_text(source.split(marker)[0])
PY
xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors -parse-as-library \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperState.swift" "$WORK/Stubs.swift" \
  "$ROOT/wallpaper/tests/WallpaperHandoffOwnerChangeCheck.swift" -o "$WORK/check"
"$WORK/check"
