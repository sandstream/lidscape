# Wallpaper installation component

This component handles filesystem operations for the wallpaper host app. The Mac app connects these operations to its wallpaper settings. The feature is not an installer release.

It copies a verified app to a fixed name in an Applications directory. It checks the complete signature against an Apple anchor, Developer ID certificate, bundle identifier, and signing team. It stages and checks the copy before an update. It refuses foreign bundles and symbolic links. It uses an exclusive rename to avoid replacing a destination created during the operation.

Status reports whether the target is missing, owned, or another app. The selected wallpaper is always reported as unknown. Updates and removal require explicit user confirmation that another wallpaper is selected on every display and Space. This confirmation is not a system-verified status.

Updates preserve the prior app until registration completes. The component then verifies a ZIP copy and stores it in `~/Applications/Lidscape Wallpaper Backups`. ZIP files cannot register a second wallpaper extension. Opening the backup folder also preserves valid backups left by interrupted updates.

To restore a backup, choose another wallpaper for every display and Space. Remove the current wallpaper in Lidscape. Open the backup folder from the wallpaper menu and extract a ZIP. Move the extracted `previous-backup` folder to `~/Applications`. Rename it to `Lidscape Wallpaper.app`. Open the wallpaper menu. Select **Try registering again** if it appears. Then select Lidscape in Mac settings. The settings file stays in the shared container.

Automatic rollback verifies the prior app and preserves the displaced app. It does not overwrite a foreign app. Removal moves the verified app to the macOS Trash. The returned path identifies the app in Trash. The user can recover it from Trash. Finder may not restore it to Applications automatically because the app first moves through a temporary verification folder. The component does not register or unregister an extension, choose a wallpaper, restore the previous wallpaper, or restart a running extension. macOS can rediscover an extension in an installed app. The Mac app handles extension registration and removal. The user selects the active wallpaper in System Settings. A real Mac test passed installation and removal. Updates in macOS, sleep, wake, and battery use remain untested.

To unregister this app's extension, pass its exact bundle path to `pluginkit -r` while the bundle is still present. The path is `Lidscape Wallpaper.app/Contents/Extensions/LidscapeWallpaperExtension.appex` inside the selected Applications directory. Then check `pluginkit -m -A -D -v -i se.sandstream.lidscape.wallpaper.extension`. A missing match does not establish that no cached renderer is still running. The removal test confirmed that the registration disappeared. Updates and the complete lifecycle still need a real Mac test.

Run the isolated filesystem checks on macOS:

```sh
sh wallpaper/installation/test.sh
```

The tests use temporary directories. They do not change System Settings or the selected wallpaper. Removal tests move temporary apps to Trash and recover them into the test directory. Most checks use a test verifier. The ad hoc signature check uses macOS `codesign`. Set `LIDSCAPE_INSTALL_TEST_SIGNED_APP` to a Developer ID signed probe app to also check a real signature, wrong requirements, a modified copy, and archive and restore of a signed app.
