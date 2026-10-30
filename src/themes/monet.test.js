import test from 'node:test'
import assert from 'node:assert/strict'
import { monet } from './monet.js'
import { buildPost } from '../post.js'

test('the monet theme paints brush strokes that grow and haze over as the lid closes', () => {
  const output = {}
  const composer = { passes: [output], insertPass(pass, index) { this.passes.splice(index, 0, pass) } }
  const post = buildPost(composer, monet, output)
  post.resize(800, 400)
  const brush = composer.passes.find((pass) => pass.uniforms?.haze)
  assert.deepEqual(brush.uniforms.texel.value, [1 / 800, 1 / 400])
  assert.equal(composer.passes.at(-1), output)

  post.update({ strokes: 1 }, 1)
  assert.equal(brush.uniforms.radius.value, 4)
  assert.equal(brush.uniforms.haze.value, 0)

  post.update({ strokes: 1 }, 0)
  assert.equal(brush.uniforms.radius.value, 7.2)
  assert.equal(brush.uniforms.haze.value, 0.18)

  post.update({ strokes: 2 })
  assert.equal(brush.uniforms.radius.value, 8, 'no lid value means an open lid')
})
