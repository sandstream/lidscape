import test from 'node:test'
import assert from 'node:assert/strict'
import { christmas } from './christmas.js'
import { allows, TRAITS } from '../traits.js'

test('Christmas weather only appears in cities with matching traits', () => {
  const warmCity = { traits: { snow: false, ice: false, adventStars: false } }
  const winterCity = { traits: { snow: true, ice: true, adventStars: true } }
  const typesFor = (city) => christmas.effects.filter((effect) => allows(city, effect.requires)).map((effect) => effect.type)
  assert.ok(typesFor(warmCity).includes('trees'))
  assert.ok(!typesFor(warmCity).includes('snowfall'))
  assert.ok(!typesFor(warmCity).includes('ice'))
  assert.ok(typesFor(winterCity).includes('snowfall'))
  assert.ok(typesFor(winterCity).includes('ice'))
  for (const effect of christmas.effects) if (effect.requires) assert.ok(effect.requires in TRAITS)
})
