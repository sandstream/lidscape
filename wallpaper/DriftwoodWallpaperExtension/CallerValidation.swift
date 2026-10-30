// Validates the identity of processes connecting to the extension's XPC surface.
//
// The exported handler can change extension state, drive renderer/snapshot work,
// and reach library-mutation paths, so connections should only be served to the
// expected Apple wallpaper host. We derive the peer's code signature from its
// audit token (never trusting the PID alone, which is reusable) and require an
// Apple-signed platform binary.
//
// Posture: reject callers we can positively identify as non-Apple. Accept Apple
// platform binaries — logging when the signer isn't the expected WallpaperAgent
// rather than rejecting, since the settings surfaces are also Apple-hosted.
// Reject a connection if its identity cannot be verified.

import Foundation
import Security

enum CallerValidation {
    static func isAcceptable(_ connection: NSXPCConnection) -> Bool {
        return allows(
            auditTokenAvailable: connection.responds(to: NSSelectorFromString("auditToken")),
            resolvePeer: { () -> SecCode? in
                var token = connection.auditToken
                let tokenData = withUnsafeBytes(of: &token) { Data($0) }
                let attrs = [kSecGuestAttributeAudit: tokenData] as CFDictionary
                var code: SecCode?
                let status = SecCodeCopyGuestWithAttributes(nil, attrs, [], &code)
                guard status == errSecSuccess, let code else {
                    extensionLog("  [Caller] Could not derive peer SecCode (status \(status)); rejected")
                    return nil
                }
                return code
            },
            checkApple: { (code: SecCode) in
                guard let appleReq = requirement("anchor apple") else {
                    extensionLog("  [Caller] Could not build anchor-apple requirement; rejected")
                    return nil
                }
                let status = SecCodeCheckValidity(code, SecCSFlags(rawValue: 0), appleReq)
                guard status == errSecSuccess else {
                    extensionLog("  [Caller] REJECTED non-Apple caller (status \(status))")
                    return false
                }
                if let agentReq = requirement("identifier \"com.apple.wallpaper.agent\""),
                   SecCodeCheckValidity(code, SecCSFlags(rawValue: 0), agentReq) != errSecSuccess {
                    extensionLog("  [Caller] Apple caller is not WallpaperAgent; accepting")
                }
                return true
            }
        )
    }

    // Keep peer resolution and signature validation separate so failure paths
    // can be tested without creating a system XPC connection.
    static func allows<Peer>(auditTokenAvailable: Bool, resolvePeer: () -> Peer?,
                             checkApple: (Peer) -> Bool?) -> Bool {
        guard auditTokenAvailable else {
            extensionLog("  [Caller] auditToken SPI unavailable; rejected")
            return false
        }
        guard let peer = resolvePeer(), let verified = checkApple(peer) else { return false }
        return verified
    }

    private static func requirement(_ text: String) -> SecRequirement? {
        var req: SecRequirement?
        guard SecRequirementCreateWithString(text as CFString, SecCSFlags(rawValue: 0), &req) == errSecSuccess else {
            return nil
        }
        return req
    }
}
