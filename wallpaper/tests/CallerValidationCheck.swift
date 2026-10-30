import Foundation

// The extension provides its own logger.
func extensionLog(_ message: String) {}

@main
struct CallerValidationCheck {
    static func main() {
        var resolved = false
        let noToken = CallerValidation.allows(auditTokenAvailable: false, resolvePeer: {
            resolved = true
            return 1
        }, checkApple: { _ in true })
        precondition(!noToken && !resolved, "A missing audit token must reject before resolving the peer")

        var checked = false
        let noPeer = CallerValidation.allows(auditTokenAvailable: true, resolvePeer: {
            nil as Int?
        }, checkApple: { _ in
            checked = true
            return true
        })
        precondition(!noPeer && !checked, "A missing peer must reject before signature validation")

        let noRequirement = CallerValidation.allows(auditTokenAvailable: true, resolvePeer: { 1 }, checkApple: { _ in nil })
        precondition(!noRequirement, "An unavailable signature requirement must reject")

        let nonApple = CallerValidation.allows(auditTokenAvailable: true, resolvePeer: { 1 }, checkApple: { _ in false })
        precondition(!nonApple, "A non-Apple peer must reject")

        let apple = CallerValidation.allows(auditTokenAvailable: true, resolvePeer: { 1 }, checkApple: { _ in true })
        precondition(apple, "A verified Apple peer must be accepted")
        print("Wallpaper caller validation: OK")
    }
}
