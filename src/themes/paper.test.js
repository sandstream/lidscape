import test from 'node:test'
import assert from 'node:assert/strict'
import { paper } from './paper.js'
import { buildPost } from '../post.js'

test('the paper theme leaves the rendered image without post effects', () => {
  const output = {}
  const composer = { passes: [output], insertPass() { throw new Error('unexpected effect') } }
  const post = buildPost(composer, paper, output)
  post.resize(800, 600)
  post.update({})
  assert.deepEqual(composer.passes, [output])
  assert.deepEqual(paper.settings, [])
})
