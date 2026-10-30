#!/bin/sh
# Builds the Mac DMG and checks what a user's Mac will check, as Lyssna's script
# does: the app and the lid bridge are inside and signed, the app may use the
# camera under hardened runtime, and Gatekeeper accepts it.
# Without a Developer ID certificate the signature is ad hoc, and Gatekeeper
# rejects the app on other Macs.
set -e
cd "$(dirname "$0")/.."

# Nothing secret is in the repo:
# - the Developer ID certificate lives in the login keychain,
# - the App Store Connect API key is ~/.private_keys/AuthKey_<KEY_ID>.p8,
# - Key ID and Issuer ID come from ~/.config/lidscape/notarize.env, or Lyssna's
#   file with the same team key (APPLE_API_KEY=..., APPLE_API_ISSUER=...).
TEAM_ID=VDE8E369XE
NOTARIZE=
unset LIDSCAPE_NOTARIZE_WALLPAPER
IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application: .*($TEAM_ID)" | head -1 | sed -E 's/.*"(.+)"/\1/')
ENV_FILE="$HOME/.config/lidscape/notarize.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$HOME/.config/lyssna/notarize.env"
if [ -n "$IDENTITY" ]; then
  export APPLE_SIGNING_IDENTITY="$IDENTITY"
  echo "Signerar med: $IDENTITY"
  if [ -f "$ENV_FILE" ]; then
    . "$ENV_FILE"
    export APPLE_API_KEY APPLE_API_ISSUER
    export APPLE_API_KEY_PATH="$HOME/.private_keys/AuthKey_$APPLE_API_KEY.p8"
    test -f "$APPLE_API_KEY_PATH" || { echo "FAIL: den privata nyckelfilen saknas"; exit 1; }
    NOTARIZE=1
    export LIDSCAPE_NOTARIZE_WALLPAPER=1
    echo "Notariserar med App Store Connect"
  else
    echo "VARNING: notarize.env saknas, så appen notariseras inte."
  fi
else
  echo "VARNING: inget Developer ID-certifikat för $TEAM_ID, så signaturen blir ad hoc."
fi

sh scripts/stage.sh
sh scripts/check-macros.sh
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)
DMG="src-tauri/target/release/bundle/dmg/Lidscape_${VERSION}_aarch64.dmg"
rm -f "$DMG"
# A broken proc-macro library from the linker fails the first build; clean and retry once.
bunx tauri build --bundles dmg || { sh scripts/check-macros.sh && bunx tauri build --bundles dmg; }
test -f "$DMG" || { echo "FAIL: $DMG missing"; exit 1; }

if [ -n "$NOTARIZE" ]; then
  # Tauri notarizes the app; the DMG around it gets its own ticket so installs work offline.
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"
fi

MP=$(mktemp -d)
WALLPAPER_CHECK=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MP" "$DMG" >/dev/null
trap 'hdiutil detach -quiet "$MP"; rm -rf "$WALLPAPER_CHECK"' EXIT
APP="$MP/Lidscape.app"
for b in lidscape lid-bridge; do
  test -x "$APP/Contents/MacOS/$b" || { echo "FAIL: $b missing"; exit 1; }
  codesign --verify --strict "$APP/Contents/MacOS/$b" || { echo "FAIL: $b is not signed"; exit 1; }
done
python3 scripts/check-macos-target.py "$APP/Contents/Info.plist" "$APP/Contents/MacOS/lid-bridge"
SAVER="$APP/Contents/Resources/LidscapeScreenSaver.saver"
test -f "$SAVER/Contents/Resources/web/saver.js" || { echo "FAIL: screen saver missing"; exit 1; }
codesign --verify --deep --strict "$SAVER" || { echo "FAIL: screen saver signature invalid"; exit 1; }
WALLPAPER_ARCHIVE="$APP/Contents/Resources/Lidscape Wallpaper.zip"
test -f "$WALLPAPER_ARCHIVE" || { echo "FAIL: wallpaper archive missing"; exit 1; }
/usr/bin/ditto -x -k "$WALLPAPER_ARCHIVE" "$WALLPAPER_CHECK"
WALLPAPER_APP="$WALLPAPER_CHECK/Lidscape Wallpaper.app"
codesign --verify --deep --strict "$WALLPAPER_APP" || { echo "FAIL: wallpaper signature invalid"; exit 1; }
if [ -n "$IDENTITY" ]; then
  codesign --verify --deep --strict -R '=anchor apple generic and identifier "se.sandstream.lidscape.wallpaper" and certificate leaf[subject.OU] = "VDE8E369XE" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$WALLPAPER_APP" || { echo "FAIL: wallpaper identity invalid"; exit 1; }
fi
codesign -d --entitlements - "$APP/Contents/MacOS/lidscape" 2>&1 | grep -q "com.apple.security.device.camera" \
  || { echo "FAIL: the app lacks the camera entitlement"; exit 1; }
/usr/libexec/PlistBuddy -c "Print :NSCameraUsageDescription" "$APP/Contents/Info.plist" >/dev/null \
  || { echo "FAIL: NSCameraUsageDescription missing"; exit 1; }
codesign --verify --deep --strict "$APP" || { echo "FAIL: invalid signature"; exit 1; }
if [ -n "$NOTARIZE" ]; then
  xcrun stapler validate "$WALLPAPER_APP" >/dev/null || { echo "FAIL: wallpaper app lacks a notarization ticket"; exit 1; }
  spctl -a -vv -t exec "$APP" 2>&1 | grep -q "source=Notarized Developer ID" || { echo "FAIL: Gatekeeper godkänner inte appen"; spctl -a -vv -t exec "$APP"; exit 1; }
  xcrun stapler validate "$APP" >/dev/null || { echo "FAIL: appen saknar notariseringsbiljett"; exit 1; }
  xcrun stapler validate "$DMG" >/dev/null || { echo "FAIL: DMG saknar notariseringsbiljett"; exit 1; }
fi
echo "OK: $DMG ($(du -h "$DMG" | cut -f1)), $(codesign -dv "$APP" 2>&1 | grep -E '^Authority=' | head -1)"
