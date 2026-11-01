import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./boot.js', import.meta.url), 'utf8')

function startWithImage(decode) {
  let nextTimer = 0
  const timers = new Map()
  const frames = []
  const window = { addEventListener() {} }
  const image = { decode, remove() {} }
  const document = {
    createElement: () => image,
    getElementById: () => ({ after() {} }),
    documentElement: { classList: { add() {}, remove() {} } },
  }
  const sessionStorage = {
    getItem: () => JSON.stringify({ image: 'data:image/jpeg;base64,AA==' }),
    removeItem() {},
  }
  const setTimeout = (callback, delay = 0) => {
    const id = ++nextTimer
    timers.set(id, { callback, delay })
    return id
  }
  const clearTimeout = (id) => timers.delete(id)
  const requestAnimationFrame = (callback) => frames.push(callback)
  runInNewContext(source, { window, document, sessionStorage, setTimeout, clearTimeout, requestAnimationFrame })
  return { window, timers, frames }
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function runTimer(timers, delay) {
  const entry = [...timers].find(([, timer]) => timer.delay === delay)
  assert.ok(entry, `Expected a ${delay} ms timer`)
  timers.delete(entry[0])
  entry[1].callback()
}

function runFallback(timers) {
  const entry = [...timers].find(([, timer]) => timer.delay > 0 && timer.delay <= 2000)
  assert.ok(entry, 'Expected startup to have a bounded fallback')
  timers.delete(entry[0])
  entry[1].callback()
}

test('a stalled image decode does not block the new scene indefinitely', async () => {
  let decodeImage
  const { window, timers, frames } = startWithImage(() => new Promise((resolve) => { decodeImage = resolve }))
  runFallback(timers)
  await window.lidscapeStillShown
  decodeImage()
  await flushPromises()
  assert.equal(frames.length, 0)
})

test('a suspended animation frame does not block the new scene indefinitely', async () => {
  const { window, timers, frames } = startWithImage(() => Promise.resolve())
  await flushPromises()
  assert.equal(frames.length, 1)
  runFallback(timers)
  await window.lidscapeStillShown
  frames[0]()
  assert.equal(timers.size, 0)
})

test('a normal frame is awaited before the new scene starts', async () => {
  const { window, timers, frames } = startWithImage(() => Promise.resolve())
  let ready = false
  window.lidscapeStillShown.then(() => { ready = true })
  await flushPromises()
  assert.equal(ready, false)
  assert.equal(frames.length, 1)
  frames[0]()
  assert.equal(ready, false)
  runTimer(timers, 0)
  await window.lidscapeStillShown
  await flushPromises()
  assert.equal(ready, true)
  assert.equal(timers.size, 0)
})

test('a rejected image decode still waits for a frame', async () => {
  const { window, timers, frames } = startWithImage(() => Promise.reject(new Error('Decode failed')))
  await flushPromises()
  assert.equal(frames.length, 1)
  frames[0]()
  runTimer(timers, 0)
  await window.lidscapeStillShown
  assert.equal(timers.size, 0)
})

test('a late paint timer is harmless after the fallback', async () => {
  const { window, timers, frames } = startWithImage(() => Promise.resolve())
  await flushPromises()
  frames[0]()
  runFallback(timers)
  await window.lidscapeStillShown
  runTimer(timers, 0)
  assert.equal(timers.size, 0)
})
