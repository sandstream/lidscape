#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-acquire-cancel.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
python3 - "$ROOT" "$WORK" <<'PY'
from pathlib import Path
import sys
root, work = map(Path, sys.argv[1:])
source = (root / 'wallpaper/tests/WallpaperStateHandoffCheck.swift').read_text()
marker = '@main\nstruct WallpaperStateHandoffCheck'
if source.count(marker) != 1:
    raise SystemExit('The state test stubs changed')
(work / 'StateStubs.swift').write_text(source.split(marker)[0])
PY
xcrun swiftc -swift-version 6 -strict-concurrency=complete -warnings-as-errors -parse-as-library \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperState.swift" \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperAcquireReply.swift" \
  "$WORK/StateStubs.swift" "$ROOT/wallpaper/tests/WallpaperAcquireCancellationCheck.swift" -o "$WORK/check"
"$WORK/check"
