import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { useLocalModules } from './browser.test-support.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const url = 'http://127.0.0.1:5189/'

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Lidscape test server did not start')
}

test('the browser can switch views, fold the map, zoom, and open the city guide', { timeout: 120000 }, async () => {
  const server = spawn('python3', ['tools/serve.py', '5189'], { cwd: root, stdio: 'ignore' })
  let browser
  try {
    await waitForServer()
    console.log('main browser test: local server ready')
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    console.log('main browser test: Chromium launched')
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => { errors.push(error.message); console.error('main browser page error:', error.message) })
    page.on('console', (message) => { if (message.type() === 'error') console.error('main browser console error:', message.text()) })
    page.on('requestfailed', (request) => console.error('main browser request failed:', request.url(), request.failure()?.errorText))
    await page.addInitScript(() => {
      window.__openedLinks = []
      window.__TAURI__ = {
        core: { invoke: async (name, args) => {
          if (name === 'open_link') window.__openedLinks.push(args.url)
          return null
        } },
      }
      window.WebSocket = class {
        constructor() { window.__lidSocket = this }
        sendAngle(angle) { this.onmessage({ data: JSON.stringify({ angle }) }) }
      }
    })
    await useLocalModules(page)
    await page.goto(`${url}?view=map&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    console.log('main browser test: document loaded')
    await page.waitForFunction(() => window.lidscape?.worldMap)
    console.log('main browser test: Lidscape ready')
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    assert.equal(await page.locator('#map-info').isVisible(), true)
    assert.equal(await page.locator('#camera-btn').isVisible(), false)
    assert.equal(await page.locator('#lights-btn').isVisible(), false)
    await page.locator('#map-zoom-in').click()
    await page.waitForFunction(() => document.getElementById('map-zoom-level').textContent === '150 %')
    await page.evaluate(() => { window.__lidSocket.onopen(); window.__lidSocket.sendAngle(15) })
    await page.waitForFunction(() => window.lidscape.worldMap.leftPage.rotation.y > 1.4)
    await page.evaluate(() => window.__lidSocket.sendAngle(105))
    await page.waitForFunction(() => Math.abs(window.lidscape.worldMap.leftPage.rotation.y) < 0.01)
    await page.locator('#map-info a').click()
    assert.deepEqual(await page.evaluate(() => window.__openedLinks), ['https://github.com/sandstream/lidscape/blob/main/CONTRIBUTING.md'])
    await page.locator('#map-cities button').first().click()
    await page.waitForFunction(() => !document.body.classList.contains('map-view'), null, { timeout: 5000 })
    assert.equal(await page.locator('#lights-btn').isVisible(), true)
    assert.equal(await page.locator('#camera-btn').isVisible(), true)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    server.kill()
  }
})

test('changing a setting keeps the book as open as it was', { timeout: 120000 }, async () => {
  const server = spawn('python3', ['tools/serve.py', '5189'], { cwd: root, stdio: 'ignore' })
  let browser
  try {
    await waitForServer()
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {
        constructor() { window.__lidSocket = this }
        sendAngle(angle) { this.onmessage({ data: JSON.stringify({ angle }) }) }
      }
    })
    await useLocalModules(page)
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await page.evaluate(() => { window.__lidSocket.onopen(); window.__lidSocket.sendAngle(105) })
    await page.waitForFunction(() => window.lidscape.progress() > 0.99)
    await Promise.all([page.waitForURL(/variant=christmas/), page.locator('#variant').selectOption('christmas')])
    await page.waitForFunction(() => window.lidscape?.progress)
    // Before the sensor answers again, the book must not fall back to almost closed.
    assert.ok(await page.evaluate(() => window.lidscape.progress()) > 0.99)
  } finally {
    await browser?.close()
    server.kill()
  }
})

test('a setting change shows the last frame and menu until the new scene draws', { timeout: 120000 }, async () => {
  const server = spawn('python3', ['tools/serve.py', '5189'], { cwd: root, stdio: 'ignore' })
  let browser
  try {
    await waitForServer()
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      // Building the scene blocks the page, so the last frame must be on screen
      // before main.js starts. Its first WebGL call marks that start.
      new MutationObserver((records, observer) => {
        const image = document.getElementById('still')
        if (!image) return
        observer.disconnect()
        image.decode().then(() => requestAnimationFrame(() => setTimeout(() => { window.__stillPainted = true })))
      }).observe(document, { childList: true, subtree: true })
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (...args) {
        window.__stillAtStart ??= document.getElementById('still') ? Boolean(window.__stillPainted) : 'none'
        return getContext.apply(this, args)
      }
    })
    await useLocalModules(page)
    // Slow the scene code after the reload, as a slow Mac or network would.
    let loads = 0
    await page.route('**/src/city.js', async (route) => {
      if (loads++ === 1) await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.continue()
    })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await Promise.all([page.waitForURL(/variant=christmas/, { waitUntil: 'commit' }), page.locator('#variant').selectOption('christmas')])

    await page.waitForSelector('#still')
    const during = await page.evaluate(() => {
      const copy = document.getElementById('still-hud').shadowRoot
      const image = document.getElementById('still')
      return {
        ready: Boolean(window.lidscape?.progress),
        imageLoaded: image.complete && image.naturalWidth > 0,
        imageCovers: image.getBoundingClientRect().width === innerWidth && image.getBoundingClientRect().height === innerHeight,
        copyVariant: copy.getElementById('variant').value,
        copyThemes: copy.getElementById('theme').options.length,
        copyVisible: copy.getElementById('hud').getBoundingClientRect().height > 100,
        realHud: getComputedStyle(document.getElementById('hud')).visibility,
      }
    })
    assert.deepEqual(during, { ready: false, imageLoaded: true, imageCovers: true, copyVariant: 'christmas', copyThemes: during.copyThemes, copyVisible: true, realHud: 'hidden' })
    assert.ok(during.copyThemes > 1)

    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('still') && !document.getElementById('still-hud'))
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('hud')).visibility), 'visible')
    assert.equal(await page.locator('#variant').inputValue(), 'christmas')

    // Without a slow network, the frame must still reach the screen before the
    // new page starts to build its scene.
    await Promise.all([page.waitForURL(/theme=monet/), page.locator('#theme').selectOption('monet')])
    await page.waitForFunction(() => window.lidscape?.progress)
    assert.equal(await page.evaluate(() => window.__stillAtStart), true)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    server.kill()
  }
})
