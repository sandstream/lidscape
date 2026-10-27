import test from 'node:test'
import assert from 'node:assert/strict'
import { allows, TRAITS } from './traits.js'

test('city traits gate weather and local customs', () => {
  const city = { traits: { snow: false, adventStars: true } }
  assert.equal(allows(city, 'snow'), false)
  assert.equal(allows(city, 'adventStars'), true)
  assert.equal(allows(city, 'ice'), false)
  assert.equal(allows(city), true)
  assert.ok('snow' in TRAITS && 'adventStars' in TRAITS && 'ice' in TRAITS)
})
