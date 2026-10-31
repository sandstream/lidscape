#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-frame-policy.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
xcrun swiftc "$ROOT/wallpaper/Shared/Render/PlaybackPolicy.swift" "$ROOT/wallpaper/tests/FramePolicyTest.swift" -o "$WORK/check"
"$WORK/check"
