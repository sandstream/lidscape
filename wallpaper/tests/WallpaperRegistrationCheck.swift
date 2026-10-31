import Foundation

let id = WallpaperRegistration.extensionID
let expectedPath = "/Users/test/Applications/Lidscape Wallpaper.app/Contents/Extensions/LidscapeWallpaperExtension.appex"
let row = "    \(id)(1)\tUUID\t2026-10-30 12:00:00 +0000\t\(expectedPath)"
precondition(WallpaperRegistration.containsExpectedExtension(row, path: expectedPath))
precondition(WallpaperRegistration.containsExpectedExtension("+ " + row, path: expectedPath))
precondition(!WallpaperRegistration.containsExpectedExtension("- " + row, path: expectedPath))
precondition(!WallpaperRegistration.containsExpectedExtension(row, path: expectedPath + ".other"))
precondition(!WallpaperRegistration.containsExpectedExtension(row.replacingOccurrences(of: id, with: id + ".other"), path: expectedPath))
precondition(!WallpaperRegistration.containsExpectedExtension("(no matches)", path: expectedPath))
print("Wallpaper registration parsing: OK")
