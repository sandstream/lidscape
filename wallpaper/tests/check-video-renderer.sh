#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
TASK_TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-video-test.XXXXXX")
trap 'rm -rf "$TASK_TEMP_ROOT"' EXIT HUP INT TERM
xcrun swiftc -target "$(uname -m)-apple-macos14.0" \
  "$ROOT/wallpaper/Shared/Render/VideoRenderer.swift" \
  "$ROOT/wallpaper/Shared/Render/StillFrame.swift" \
  "$ROOT/wallpaper/Shared/Render/PlaybackPolicy.swift" \
  "$ROOT/wallpaper/Shared/Render/RenderLog.swift" \
  "$ROOT/wallpaper/Shared/Render/SendableBox.swift" \
  "$ROOT/wallpaper/tests/VideoRendererCheck.swift" \
  -o "$TASK_TEMP_ROOT/video-renderer-check"
"$TASK_TEMP_ROOT/video-renderer-check" "$TASK_TEMP_ROOT/video.mp4"
