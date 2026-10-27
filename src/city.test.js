import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildCity } from './city.js'
import { stockholm } from './cities/stockholm.js'
import { installCanvas } from './canvas.test-support.js'

test('city cards fold flat, stand up, and fade during a flight', () => {
  const restore = installCanvas()
  try {
    const scene = new THREE.Scene()
    const city = buildCity(stockholm, scene, -9.75)
    assert.ok(scene.children.includes(city.root))
    const cards = city.root.children.filter((child) => child.type === 'Group')
    assert.equal(cards.length, stockholm.layers.length)
    city.update(0, 1, 0)
    assert.ok(cards.every((card) => Math.abs(card.rotation.x + Math.PI / 2) < 1e-9))
    city.update(1, 1, 1)
    assert.ok(cards.every((card) => Math.abs(card.rotation.x) < 1e-9))
    city.setFlightProgress(1)
    const sky = city.root.children.find((child) => child.material?.uniforms?.alpha)
    assert.equal(sky.material.uniforms.alpha.value, 0)
  } finally { restore() }
})
