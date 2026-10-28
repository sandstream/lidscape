import test from 'node:test'
import assert from 'node:assert/strict'
import { connectLid } from './lid.js'

test('the lid folds the book and falls back when the bridge closes', () => {
  const oldSocket = globalThis.WebSocket
  const oldTimeout = globalThis.setTimeout
  const retries = []
  let socket
  globalThis.WebSocket = class {
    constructor(url) {
      assert.equal(url, 'ws://127.0.0.1:8787')
      socket = this
    }
  }
  globalThis.setTimeout = (fn, delay) => { retries.push({ fn, delay }); return 1 }
  try {
    const changes = []
    const lid = connectLid((state) => changes.push({ ...state }))
    socket.onopen()
    assert.equal(lid.connected, true)
    for (const [angle, progress] of [[105, 1], [50, 0], [15, 0]]) {
      socket.onmessage({ data: JSON.stringify({ angle }) })
      assert.equal(lid.progress, progress)
    }
    socket.onclose()
    assert.equal(lid.connected, false)
    assert.equal(lid.progress, null)
    assert.equal(retries[0].delay, 3000)
    assert.equal(changes.at(-1).connected, false)
  } finally {
    globalThis.WebSocket = oldSocket
    globalThis.setTimeout = oldTimeout
  }
})

test('a bridge without a sensor disables automatic folding', () => {
  const oldSocket = globalThis.WebSocket
  let socket
  globalThis.WebSocket = class { constructor() { socket = this } }
  try {
    const lid = connectLid(() => {})
    socket.onopen()
    socket.onmessage({ data: '{"sensor":false}' })
    assert.equal(lid.noSensor, true)
    assert.equal(lid.connected, false)
  } finally {
    globalThis.WebSocket = oldSocket
  }
})
