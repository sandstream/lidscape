import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPoint, mapUV, layoutCities, layoutCapitals, MAP_WIDTH, MAP_HEIGHT } from './map-layout.js'

test('texture and markers use the same world projection', () => {
  assert.deepEqual(mapUV(0, 0), { u: 0.5, v: 0.5 })
  assert.deepEqual(mapPoint(0, 0), { x: 0, y: 0 })
  assert.deepEqual(mapPoint(90, 180), { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 })
})

test('nearby Nordic cities remain separately selectable', () => {
  const cities = layoutCities([
    { id: 'stockholm', lat: 59.324, lon: 18.066 },
    { id: 'helsinki', lat: 60.164, lon: 24.932 },
    { id: 'tallinn', lat: 59.434, lon: 24.728 },
  ])
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i].point
      const b = cities[j].point
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 2.1, `${cities[i].city.id} overlaps ${cities[j].city.id}`)
    }
  }
})

test('close capitals remain on their original book page', () => {
  const capitals = [
    ['FIN', 'Helsinki', 'Finland', 60.164, 24.932],
    ['EST', 'Tallinn', 'Estonia', 59.434, 24.728],
    ['PRT', 'Lisbon', 'Portugal', 38.725, -9.147],
  ]
  const placed = layoutCapitals(capitals)
  assert.ok(Math.hypot(placed[0].point.x - placed[1].point.x, placed[0].point.y - placed[1].point.y) >= 0.64)
  assert.ok(placed.every(({ point, truePoint }) => (point.x < 0) === (truePoint.x < 0)))
})
