import test from 'node:test'
import assert from 'node:assert/strict'
import { pickCamera } from './camera.js'

const camera = (deviceId, label = '') => ({ kind: 'videoinput', deviceId, label })

test('a saved camera wins while it exists, then the built-in camera wins', () => {
  const devices = [camera('usb', 'USB Camera'), camera('mac', 'MacBook Pro Camera')]
  assert.equal(pickCamera(devices, 'usb'), 'usb')
  assert.equal(pickCamera(devices, 'removed'), 'mac')
  assert.equal(pickCamera([camera('old', 'FaceTime HD Camera'), ...devices]), 'old')
})

test('unlabelled cameras and missing cameras have safe defaults', () => {
  assert.equal(pickCamera([camera('first'), camera('second')]), 'first')
  assert.equal(pickCamera([{ kind: 'audioinput', deviceId: 'mic' }]), null)
})
