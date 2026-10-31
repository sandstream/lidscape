import AppKit
import CoreGraphics
import Foundation

@main
struct WallpaperDisplayNamesCheck {
    @MainActor
    static func main() {
        let a = "00000000-0000-4000-8000-000000000001"
        let b = "00000000-0000-4000-8000-000000000002"
        let c = "00000000-0000-4000-8000-000000000003"
        let slots = [
            WallpaperDisplayLabelInput(displayUUID: b, fallback: "Lidscape (Display 2)"),
            WallpaperDisplayLabelInput(displayUUID: a, fallback: "Lidscape (Display 1)"),
            WallpaperDisplayLabelInput(displayUUID: c, fallback: "Lidscape (Display 3)"),
        ]

        let labels = wallpaperDisplayLabels(slots, screenNames: [
            a: " Inbyggd Retina-skärm ", b: "Dell U2723", c: "  ",
        ])
        precondition(labels[a] == "Lidscape (Inbyggd Retina-skärm)")
        precondition(labels[b] == "Lidscape (Dell U2723)")
        precondition(labels[c] == "Lidscape (Display 3)")
        precondition(Set(labels.keys) == Set([a, b, c]), "Display identifiers changed")

        let duplicates = wallpaperDisplayLabels(slots, screenNames: [
            a: "Dell U2723", b: "Dell U2723",
        ])
        precondition(duplicates[a] == "Lidscape (Dell U2723, 1)")
        precondition(duplicates[b] == "Lidscape (Dell U2723, 2)")
        precondition(duplicates[c] == "Lidscape (Display 3)")
        let reverse = wallpaperDisplayLabels(Array(slots.reversed()), screenNames: [
            a: "Dell U2723", b: "Dell U2723",
        ])
        precondition(reverse == duplicates, "Labels changed when enumeration order changed")

        // On a machine with a screen, exercise the real AppKit to CoreGraphics mapping.
        let names = currentWallpaperDisplayNames()
        for screen in NSScreen.screens {
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
                  let uuid = CGDisplayCreateUUIDFromDisplayID(number.uint32Value)?.takeRetainedValue(),
                  let value = CFUUIDCreateString(nil, uuid),
                  let id = WallpaperDisplayUUID.normalized(value as String) else { continue }
            precondition(names[id] == screen.localizedName, "The screen name did not match its UUID")
        }
        print("Wallpaper display names: OK")
    }
}
