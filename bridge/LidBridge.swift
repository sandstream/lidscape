// LidBridge: streams the MacBook lid angle to ws://127.0.0.1:8787 as {"angle": <degrees>}.
//
// Run:   swift bridge/LidBridge.swift
// Needs: Apple Silicon MacBook with a lid angle sensor (M2 and later confirmed; M1 reported not to work).
//
// The sensor is an Apple HID device without a public API. Matching values and the
// report layout follow samhenrigold/LidAngleSensor (Apache 2.0).

import Foundation
import IOKit.hid
import Network

setvbuf(stdout, nil, _IOLBF, 0) // show log lines at once, also when output goes to a file

let port: NWEndpoint.Port = 8787
let pollInterval = 1.0 / 30.0

final class LidSensor {
    // The manager must outlive init: releasing it closes the device and every read fails.
    private let manager: IOHIDManager
    private let device: IOHIDDevice

    init?() {
        manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        let matching: [String: Any] = [
            kIOHIDVendorIDKey: 0x05AC,
            kIOHIDProductIDKey: 0x8104,
            kIOHIDPrimaryUsagePageKey: 0x0020, // sensor
            kIOHIDPrimaryUsageKey: 0x008A,     // orientation
        ]
        IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)
        IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))

        guard let set = IOHIDManagerCopyDevices(manager) as NSSet?,
              let found = set.allObjects.first
        else { return nil }

        device = found as! IOHIDDevice
        guard IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess else { return nil }
    }

    func angle() -> Int? {
        var report = [UInt8](repeating: 0, count: 8)
        var length = CFIndex(report.count)
        let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &report, &length)
        guard result == kIOReturnSuccess, length >= 3 else { return nil }
        return Int(UInt16(report[2]) << 8 | UInt16(report[1]))
    }
}

// Without a sensor the bridge still answers, so the page can tell the user why
// the lid does nothing instead of waiting for a bridge that never comes.
// LIDBRIDGE_NO_SENSOR=1 acts as a Mac without a sensor, to test that path.
let sensor = ProcessInfo.processInfo.environment["LIDBRIDGE_NO_SENSOR"] == "1" ? nil : LidSensor()
if sensor == nil {
    FileHandle.standardError.write("LidBridge: no lid angle sensor found on this Mac.\n".data(using: .utf8)!)
}

// WebSocket server, bound to localhost only.
let parameters = NWParameters.tcp
let wsOptions = NWProtocolWebSocket.Options()
wsOptions.autoReplyPing = true
parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)
parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)

let listener = try NWListener(using: parameters)
var clients: [ObjectIdentifier: NWConnection] = [:]
var lastAngle: Int?

func send(_ angle: Int, to connection: NWConnection) {
    sendText("{\"angle\":\(angle)}", to: connection)
}

func sendText(_ text: String, to connection: NWConnection) {
    let data = Data(text.utf8)
    let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
    let context = NWConnection.ContentContext(identifier: "angle", metadata: [metadata])
    connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { error in
        if let error { print("LidBridge: send failed: \(error)") }
    })
}

listener.newConnectionHandler = { connection in
    let id = ObjectIdentifier(connection)
    connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
            clients[id] = connection
            if sensor == nil { sendText("{\"sensor\":false}", to: connection) }
            if let lastAngle { send(lastAngle, to: connection) }
            print("LidBridge: client connected (\(clients.count))")
        case .failed, .cancelled:
            clients[id] = nil
            print("LidBridge: client left (\(clients.count))")
        default:
            break
        }
    }
    connection.start(queue: .main)
}

listener.stateUpdateHandler = { state in
    if case .failed(let error) = state {
        print("LidBridge: listener failed: \(error)")
        exit(1)
    }
}
listener.start(queue: .main)
print("LidBridge: streaming lid angle on ws://127.0.0.1:\(port)")

Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { _ in
    guard let angle = sensor?.angle(), angle != lastAngle else { return }
    lastAngle = angle
    clients.values.forEach { send(angle, to: $0) }
}

RunLoop.main.run()
