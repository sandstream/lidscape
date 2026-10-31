#!/bin/sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/lidscape-wallpaper-install-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
rustc --edition=2021 --test "$ROOT/wallpaper/installation/installer.rs" -o "$WORK/installer-tests"
if [ -n "${LIDSCAPE_INSTALL_TEST_SIGNED_APP:-}" ]; then
  "$WORK/installer-tests" --include-ignored
else
  "$WORK/installer-tests"
fi
