#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
BIN=$(mktemp "${TMPDIR:-/tmp}/lidscape-surface-check.XXXXXX")
trap 'rm -f "$BIN"' EXIT HUP INT TERM
swiftc -parse-as-library -target "$(uname -m)-apple-macosx26.0" \
  "$ROOT/wallpaper/Shared/Render/RenderQueue.swift" \
  "$ROOT/wallpaper/Shared/Render/SendableBox.swift" \
  "$ROOT/wallpaper/Shared/Render/LayerRuntime.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperTransition.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperLayerDeck.swift" \
  "$ROOT/wallpaper/Shared/Render/WallpaperSurface.swift" \
  "$ROOT/wallpaper/tests/WallpaperSurfaceOrderingCheck.swift" \
  -o "$BIN"
"$BIN"
