import test from 'node:test'
import assert from 'node:assert/strict'
import { rng } from './random.js'

test('city geometry stays stable across reloads', () => {
  const first = rng(1234)
  const second = rng(1234)
  const third = rng(5678)
  const a = Array.from({ length: 100 }, () => first())
  assert.deepEqual(a, Array.from({ length: 100 }, () => second()))
  assert.notDeepEqual(a, Array.from({ length: 100 }, () => third()))
  assert.ok(a.every((value) => value >= 0 && value < 1))
})
