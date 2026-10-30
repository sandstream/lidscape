import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPost, POST_STEPS } from './post.js'

test('post effects preserve output order and resize blur by viewport size', () => {
  const output = {}
  const composer = { passes: [output], insertPass(pass, index) { this.passes.splice(index, 0, pass) } }
  const post = buildPost(composer, { post: { tiltShift: { setting: 'focus', blur: 8 }, grade: { saturation: 1.2 } } }, output)
  post.resize(800, 400)
  post.update({ focus: 0.65 })
  assert.deepEqual(POST_STEPS, ['tiltShift', 'grade', 'paint'])
  assert.equal(composer.passes.length, 4)
  assert.equal(composer.passes.at(-1), output)
  const [horizontal, vertical] = composer.passes
  assert.equal(horizontal.uniforms.h.value, 8 / 800)
  assert.equal(vertical.uniforms.v.value, 8 / 400)
  assert.equal(horizontal.uniforms.r.value, 0.65)
  assert.equal(vertical.uniforms.r.value, 0.65)
})
