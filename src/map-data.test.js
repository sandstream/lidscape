import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPITALS, LAND } from './map-data.js'

test('the world map has one valid capital per UN member state', () => {
  assert.equal(CAPITALS.length, 193)
  assert.equal(new Set(CAPITALS.map(([code]) => code)).size, 193)
  for (const [code, name, country, lat, lon] of CAPITALS) {
    assert.match(code, /^[A-Z]{3}$/)
    assert.ok(name && country)
    assert.ok(lat >= -90 && lat <= 90)
    assert.ok(lon >= -180 && lon <= 180)
  }
  assert.equal(CAPITALS.find(([code]) => code === 'FIN')[1], 'Helsinki')
  assert.equal(CAPITALS.find(([code]) => code === 'EST')[1], 'Tallinn')
})

test('land polygons stay within geographical bounds', () => {
  assert.ok(LAND.length > 100)
  for (const ring of LAND) {
    assert.ok(ring.length >= 3)
    for (const [lon, lat] of ring) {
      assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180)
      assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90)
    }
  }
})
