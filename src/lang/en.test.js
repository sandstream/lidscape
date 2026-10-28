import test from 'node:test'
import assert from 'node:assert/strict'
import { en } from './en.js'
import { sv } from './sv.js'

test('English supplies every interface message', () => {
  assert.deepEqual(Object.keys(en.strings).sort(), Object.keys(sv.strings).sort())
  for (const [key, value] of Object.entries(en.strings)) {
    assert.equal(typeof value, 'string', key)
    assert.ok(value.length > 0, key)
  }
  assert.ok(en.strings.mapContribute.includes('city'))
  assert.ok(en.strings.noWebgl.includes('WebGL 2'))
})
