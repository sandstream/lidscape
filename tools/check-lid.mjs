// Replays lid angles through the WebSocket path. Run: node tools/check-lid.mjs

import assert from 'node:assert/strict'
import { connectLid } from '../src/lid.js'

class FakeSocket {
  static current

  constructor(url) {
    assert.equal(url, 'ws://127.0.0.1:8787')
    FakeSocket.current = this
  }

  sendAngle(angle) {
    this.onmessage({ data: JSON.stringify({ angle }) })
  }
}

globalThis.WebSocket = FakeSocket
const lid = connectLid(() => {})
FakeSocket.current.onopen()
FakeSocket.current.sendAngle(105)
assert.equal(lid.progress, 1, 'an open lid must stand the book up')
FakeSocket.current.sendAngle(45)
assert.equal(lid.progress, 0, 'the book must lie flat by 45 degrees')
FakeSocket.current.sendAngle(15)
assert.equal(lid.progress, 0, 'a fully closed lid must stay folded')

console.log('OK: lid folding range')
