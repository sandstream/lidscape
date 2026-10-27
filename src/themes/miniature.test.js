import test from 'node:test'
import assert from 'node:assert/strict'
import { miniature } from './miniature.js'
import { buildPost } from '../post.js'

test('the miniature theme adds blur and grading with a user controlled focus', () => {
  const output = {}
  const composer = { passes: [output], insertPass(pass, index) { this.passes.splice(index, 0, pass) } }
  const post = buildPost(composer, miniature, output)
  post.resize(800, 600)
  post.update({ focus: 0.42 })
  assert.equal(composer.passes.length, 6)
  assert.equal(composer.passes.at(-1), output)
  assert.equal(composer.passes.filter((pass) => pass.uniforms?.r).length, 4)
  assert.ok(composer.passes.filter((pass) => pass.uniforms?.r).every((pass) => pass.uniforms.r.value === 0.42))
  assert.equal(miniature.settings.find((setting) => setting.id === 'focus').default, 0.3)
})
