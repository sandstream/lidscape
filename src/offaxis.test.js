import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { setOffAxis } from './offaxis.js'

test('the eye moves the camera while the screen stays fixed', () => {
  const camera = new PerspectiveCamera()
  setOffAxis(camera, { x: 0, y: 0, z: 50 }, 30, 20)
  const centered = camera.projectionMatrix.elements.slice()
  assert.equal(centered[8], 0)
  assert.equal(centered[9], 0)
  setOffAxis(camera, { x: 5, y: 2, z: 50 }, 30, 20)
  assert.deepEqual(camera.position.toArray(), [5, 2, 50])
  assert.notEqual(camera.projectionMatrix.elements[8], 0)
  assert.notEqual(camera.projectionMatrix.elements[9], 0)
  const product = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse)
  assert.ok(product.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9))
})
