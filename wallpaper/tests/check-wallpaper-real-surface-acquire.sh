#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-real-acquire.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
python3 - "$ROOT" "$WORK" <<'PY'
from pathlib import Path
import sys
root, work = map(Path, sys.argv[1:])
source = (root / 'wallpaper/tests/WallpaperSurfaceOrderingCheck.swift').read_text()
marker = '@main struct WallpaperSurfaceOrderingCheck {'
if source.count(marker) != 1:
    raise SystemExit('The renderer test stubs changed')
source = source.split(marker)[0].replace('enum PlaybackPolicy { case full }', 'enum PlaybackPolicy { case full, paused }')
source += '''
final class VideoLibrary: @unchecked Sendable {
    static let shared = VideoLibrary()
    func scan() {}
    func videoURL(for id: String) -> URL? { nil }
}
final class WallpaperPrefs: @unchecked Sendable {
    static let shared = WallpaperPrefs()
    func refreshActiveState() {}
}
func traceLog(_ message: String) {}
func extensionLog(_ message: String) {}
'''
(work / 'RendererStubs.swift').write_text(source)
PY
swiftc -parse-as-library -target "$(uname -m)-apple-macosx26.0" \
  "$ROOT/wallpaper/Shared/Render/RenderQueue.swift" \
  "$ROOT/wallpaper/Shared/Render/SendableBox.swift" \
  "$ROOT/wallpaper/Shared/Render/LayerRuntime.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperTransition.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperLayerDeck.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperSurface.swift" \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperState.swift" \
  "$ROOT/wallpaper/DriftwoodWallpaperExtension/WallpaperAcquireReply.swift" \
  "$WORK/RendererStubs.swift" "$ROOT/wallpaper/tests/WallpaperRealSurfaceAcquireCheck.swift" -o "$WORK/check"
"$WORK/check"
