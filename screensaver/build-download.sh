#!/bin/sh
# Build the screen saver as a separate download. Use --notarize for a public release.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SAVER="$ROOT/dist/Lidscape.saver"
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$ROOT/app/src-tauri/tauri.conf.json" | head -1)
ARCHIVE="$ROOT/dist/Lidscape-Screen-Saver_${VERSION}_arm64.zip"

case "${1:-}" in
  '') ;;
  --notarize) test "${APPLE_SIGNING_IDENTITY:--}" != '-' || { echo 'Developer ID signing is required to notarize.' >&2; exit 1; } ;;
  *) echo 'Use: build-download.sh [--notarize]' >&2; exit 2 ;;
esac

sh "$ROOT/screensaver/build.sh" standalone
codesign --verify --deep --strict "$SAVER"

if [ "${1:-}" = '--notarize' ]; then
  KEY_ID=${APPLE_API_KEY:?Set APPLE_API_KEY}
  ISSUER=${APPLE_API_ISSUER:?Set APPLE_API_ISSUER}
  KEY_PATH=${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH}
  test -f "$KEY_PATH" || { echo 'The App Store Connect API key is missing.' >&2; exit 1; }
  SUBMISSION="$ROOT/dist/Lidscape-Screen-Saver-notary.zip"
  /usr/bin/ditto -c -k --keepParent "$SAVER" "$SUBMISSION"
  xcrun notarytool submit "$SUBMISSION" --key "$KEY_PATH" --key-id "$KEY_ID" --issuer "$ISSUER" --wait
  xcrun stapler staple "$SAVER"
  xcrun stapler validate "$SAVER"
  spctl -a -t install "$SAVER"
  rm "$SUBMISSION"
fi

rm -f "$ARCHIVE"
/usr/bin/ditto -c -k --keepParent "$SAVER" "$ARCHIVE"
unzip -tq "$ARCHIVE"
echo "Built $ARCHIVE"
