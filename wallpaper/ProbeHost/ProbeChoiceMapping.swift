import CryptoKit
import Foundation

enum ProbeChoiceMapping {
    static func choiceID(forDisplay displayUUID: String) -> String {
        let seed = "se.sandstream.lidscape.wallpaper.choice:" + displayUUID.uppercased()
        var bytes = Array(SHA256.hash(data: Data(seed.utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])).uuidString
    }

    static func displayUUID(forChoice choiceID: String, slots: [(choiceID: String, displayUUID: String)]) -> String? {
        guard let canonicalChoiceID = UUID(uuidString: choiceID)?.uuidString else { return nil }
        let matches = slots.filter { $0.choiceID == canonicalChoiceID }
        guard matches.count == 1 else { return nil }
        return matches[0].displayUUID
    }
}
