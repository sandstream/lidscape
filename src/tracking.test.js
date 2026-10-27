import test from 'node:test'
import assert from 'node:assert/strict'
import { createTracker } from './tracking.js'

test('tracking switches to the built-in camera and releases it when stopped', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalDocument = globalThis.document
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const stops = []
  const tracks = {}
  const stream = (id) => {
    const handlers = {}
    const track = {
      getSettings: () => ({ deviceId: id }),
      stop: () => stops.push(id),
      addEventListener: (event, fn) => { handlers[event] = fn },
    }
    tracks[id] = handlers
    return { getVideoTracks: () => [track], getTracks: () => [track] }
  }
  let enumerations = 0
  const requests = []
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: {
      enumerateDevices: async () => ++enumerations === 1
        ? [{ kind: 'videoinput', deviceId: 'usb', label: '' }]
        : [{ kind: 'videoinput', deviceId: 'usb', label: 'USB Camera' }, { kind: 'videoinput', deviceId: 'mac', label: 'MacBook Pro Camera' }],
      getUserMedia: async (options) => {
        requests.push(options)
        return stream(requests.length === 1 ? 'usb' : 'mac')
      },
    },
  } })
  globalThis.document = { createElement: (tag) => {
    assert.equal(tag, 'video')
    return { videoWidth: 640, videoHeight: 480, currentTime: 0, play: async () => {} }
  } }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  let closed = 0
  const vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async () => ({ detectForVideo: () => ({}), close: () => closed++ }) },
    HandLandmarker: { createFromOptions: async () => ({ detectForVideo: () => ({}), close: () => closed++ }) },
  }
  try {
    const tracker = createTracker({ screenHeight: () => 19.5, vision })
    await tracker.start()
    assert.equal(tracker.state.running, true)
    assert.equal(tracker.state.camera, 'mac')
    assert.deepEqual(stops, ['usb'])
    assert.equal(requests[1].video.deviceId.exact, 'mac')
    tracks.mac.mute()
    assert.equal(tracker.state.stalled, true)
    tracker.stop()
    assert.equal(tracker.state.running, false)
    assert.equal(tracker.state.stalled, false)
    assert.deepEqual(stops, ['usb', 'mac'])
    assert.equal(closed, 2)
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
    globalThis.document = originalDocument
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
  }
})
