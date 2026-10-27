// Checks which camera Lidscape picks. Run: node tools/check-camera.mjs

import assert from 'node:assert/strict'
import { pickCamera } from '../src/camera.js'

const cam = (deviceId, label) => ({ kind: 'videoinput', deviceId, label })
const usb = cam('usb', 'USB Camera')
const builtIn = cam('mac', 'MacBook Pro Camera')
const phone = cam('phone', "Peter's iPhone Camera")
const mic = { kind: 'audioinput', deviceId: 'mic', label: 'MacBook Pro Microphone' }

// The head is measured from a camera above the screen, so the built-in one wins.
assert.equal(pickCamera([usb, phone, builtIn, mic]), 'mac')
assert.equal(pickCamera([cam('old', 'FaceTime HD Camera'), usb]), 'old')
assert.equal(pickCamera([usb, cam('sv', 'Inbyggd kamera')]), 'sv')
// The viewer's own choice wins, while that camera is there.
assert.equal(pickCamera([usb, builtIn], 'usb'), 'usb')
assert.equal(pickCamera([usb, builtIn], 'gone'), 'mac')
// Without a built-in camera, the first one.
assert.equal(pickCamera([usb, phone]), 'usb')
// No camera, or no labels yet (before the viewer allows the camera).
assert.equal(pickCamera([mic]), null)
assert.equal(pickCamera([cam('a', ''), cam('b', '')]), 'a')

console.log('OK: camera choice')
