import test from 'node:test'
import assert from 'node:assert/strict'
import { sv } from './sv.js'
import { en } from './en.js'

test('Swedish supplies every interface message and placeholders', () => {
  assert.deepEqual(Object.keys(sv.strings).sort(), Object.keys(en.strings).sort())
  for (const key of Object.keys(en.strings)) {
    assert.ok(sv.strings[key].trim(), key)
    const placeholders = (value) => [...value.matchAll(/\{[a-z]+\}/g)].map(([item]) => item).sort()
    assert.deepEqual(placeholders(sv.strings[key]), placeholders(en.strings[key]), key)
  }
  assert.ok(sv.strings.mapContribute.includes('stad'))
})
