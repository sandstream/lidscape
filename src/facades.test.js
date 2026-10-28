import test from 'node:test'
import assert from 'node:assert/strict'
import { paintFacades } from './facades.js'
import { installCanvas } from './canvas.test-support.js'

test('a facade atlas covers its printed card and maps UVs back to it', () => {
  const restore = installCanvas()
  try {
    const texture = paintFacades([
      { x0: -5, x1: 5, y0: 0, y1: 8, tint: '#c7a375', kind: 'plain', windows: [{ x: 0, y: 4, w: 0.8, h: 1 }] },
    ], () => 0.5)
    assert.ok(texture.image.width > 0 && texture.image.width <= 4096)
    assert.ok(texture.image.height > 0 && texture.image.height <= 2048)
    assert.ok(texture.repeat.x > 0 && texture.repeat.y > 0)
    assert.ok(texture.offset.x > 0)
  } finally { restore() }
})
