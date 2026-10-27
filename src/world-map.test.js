import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildWorldMap } from './world-map.js'
import { stockholm } from './cities/stockholm.js'
import { installCanvas } from './canvas.test-support.js'

test('the world map closes both pages and keeps its spine behind the map', () => {
  const restore = installCanvas()
  try {
    const scene = new THREE.Scene()
    const map = buildWorldMap(scene, [stockholm])
    assert.equal(map.cityMarkers.size, 1)
    assert.equal(map.capitalCount, 192)
    assert.equal(scene.children.includes(map.root), true)
    map.update(0, 1)
    assert.ok(map.leftPage.rotation.y > 1.4)
    assert.ok(map.rightPage.rotation.y < -1.4)
    map.root.updateMatrixWorld(true)
    const leftEdge = map.leftPage.localToWorld(new THREE.Vector3(-29, 0, 0))
    const rightEdge = map.rightPage.localToWorld(new THREE.Vector3(29, 0, 0))
    assert.ok(leftEdge.z > map.root.position.z && rightEdge.z > map.root.position.z, 'both outer edges fold towards the viewer')
    map.update(1, 0)
    assert.ok(Math.abs(map.leftPage.rotation.y) < 1e-9)
    assert.ok(Math.abs(map.rightPage.rotation.y) < 1e-9)
    assert.ok(map.root.children[2].position.z < -0.2)
    assert.equal(map.cityMarkers.get('stockholm').windows.color.getHexString(), '695d5e')
  } finally { restore() }
})
