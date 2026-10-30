import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandHeight, puppetPose, stepSpring } from './movement.js'

test('a building splits into 2 to 7 beads', () => {
  assert.equal(bandHeight(2), 1)
  assert.equal(bandHeight(11), 11 / 5)
  assert.equal(bandHeight(40), 40 / 7)
})

test('a tight string gives the standing pose', () => {
  assert.deepEqual(puppetPose(3, 7, [1, 2, 1], 0), [3, 7, 0])
})

test('a slack string brings the top down and keeps the base in place', () => {
  const anchor = [0, 2, 1]
  const [, topY] = puppetPose(0, 10, anchor, 1)
  assert.ok(topY < 6, `top at ${topY}`)
  const [baseX, baseY] = puppetPose(0, 0, anchor, 1)
  assert.equal(baseX, 0)
  assert.equal(baseY, 0)
})

test('the beads stay joined: the top of one bead is the base of the next', () => {
  const anchor = [0, 2, 0]
  const top = puppetPose(0, 2 - 1e-9, anchor, 0.8)
  const base = puppetPose(0, 2, anchor, 0.8)
  assert.ok(Math.hypot(top[0] - base[0], top[1] - base[1]) < 1e-6)
})

test('the string pulls the figure up and it wobbles before it stands', () => {
  const s = { x: 0, v: 0 }
  let max = 0
  for (let i = 0; i < 120; i++) max = Math.max(max, stepSpring(s, 1, 1 / 60).x)
  assert.ok(max > 1.05, `overshoot ${max}`)
  assert.ok(Math.abs(s.x - 1) < 0.01, `rest at ${s.x}`)
})

test('with Reduce Motion the figure stands with no wobble', () => {
  const s = { x: 0, v: 0 }
  let max = 0
  for (let i = 0; i < 120; i++) max = Math.max(max, stepSpring(s, 1, 1 / 60, true).x)
  assert.ok(max <= 1 + 1e-9, `overshoot ${max}`)
  assert.ok(Math.abs(s.x - 1) < 0.01)
})
