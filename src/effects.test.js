import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildEffects, EFFECT_TYPES } from './effects.js'
import { installCanvas } from './canvas.test-support.js'

test('snowfall is gated by the city and responds to its setting', () => {
  const restore = installCanvas()
  try {
    const variant = { effects: [{ type: 'snowfall', requires: 'snow', setting: 'snow' }] }
    const warmRoot = new THREE.Group()
    buildEffects(variant, { traits: { snow: false } }, { root: warmRoot })({ progress: 1, time: 0 })
    assert.equal(warmRoot.children.length, 0)

    const root = new THREE.Group()
    const ctx = { root, random: () => 0.5, setting: () => 0.25 }
    const update = buildEffects(variant, { traits: { snow: true } }, ctx)
    update({ progress: 1, time: 0 })
    assert.equal(root.children.length, 1)
    assert.equal(root.children[0].geometry.drawRange.count, 650)
    assert.equal(root.children[0].material.opacity, 1)
    assert.ok(EFFECT_TYPES.includes('snowfall'))
  } finally { restore() }
})
