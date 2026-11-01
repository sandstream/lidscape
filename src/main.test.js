import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { useLocalModules } from './browser.test-support.js'

const url = 'http://127.0.0.1:5189/'

test('the browser can switch views, fold the map, zoom, and open the city guide', { timeout: 120000 }, async () => {
  let browser
  try {
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
    await useLocalModules(page, { serveFiles: true })
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
  }
})

test('changing a setting keeps the book as open as it was', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {
        constructor() { window.__lidSocket = this }
        sendAngle(angle) { this.onmessage({ data: JSON.stringify({ angle }) }) }
      }
    })
    await useLocalModules(page, { serveFiles: true })
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
  }
})

test('changing language in the map keeps the map menu visible during reload', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => { window.WebSocket = class {} })
    await useLocalModules(page, { serveFiles: true })
    let loads = 0
    await page.route('**/src/city.js', async (route) => {
      if (loads++ > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fallback()
    })
    await page.goto(`${url}?view=map&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.worldMap && document.body.classList.contains('map-view'))
    await Promise.all([page.waitForURL(/lang=en/, { waitUntil: 'commit' }), page.locator('#map-lang').selectOption('en')])
    await page.waitForSelector('#still-hud', { state: 'attached' })
    const copy = await page.evaluate(() => {
      const shadow = document.getElementById('still-hud').shadowRoot
      const map = shadow.getElementById('map-info')
      const toggle = shadow.getElementById('map-toggle')
      const mapStyle = map && getComputedStyle(map)
      const toggleStyle = toggle && getComputedStyle(toggle)
      return {
        mapVisible: Boolean(map && !map.hidden && mapStyle.display !== 'none' && mapStyle.visibility === 'visible' && Number(mapStyle.opacity) > 0 && map.getBoundingClientRect().width > 0),
        cityMenu: Boolean(shadow.getElementById('hud')),
        language: shadow.getElementById('map-lang')?.value,
        toggleText: toggle?.textContent.trim(),
        toggleVisible: Boolean(toggle && toggleStyle.display !== 'none' && toggleStyle.visibility === 'visible' && toggle.getBoundingClientRect().width > 0),
        realToggleHidden: getComputedStyle(document.getElementById('map-toggle')).visibility === 'hidden',
      }
    })
    assert.deepEqual(copy, { mapVisible: true, cityMenu: false, language: 'en', toggleText: 'Tillbaka till staden', toggleVisible: true, realToggleHidden: true })
    await page.waitForFunction(() => window.lidscape?.worldMap && !document.getElementById('still-hud'))
  } finally {
    await browser?.close()
  }
})

test('entering another city keeps the map frame while it loads', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      window.WebSocket = class {
        constructor() { window.__lidSocket = this }
        sendAngle(angle) { this.onmessage({ data: JSON.stringify({ angle }) }) }
      }
    })
    await useLocalModules(page, { serveFiles: true })
    await page.route('**/src/cities/index.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: "import { stockholm } from './stockholm.js'; export const CITIES = [stockholm, { ...stockholm, id: 'testcity', name: 'Test City' }]; export function findCity(id) { return CITIES.find((c) => c.id === id) ?? CITIES[0] }",
    }))
    let loads = 0
    await page.route('**/src/city.js', async (route) => {
      if (loads++ > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fallback()
    })
    await page.goto(`${url}?view=map&city=stockholm&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.worldMap && document.body.classList.contains('map-view'))
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    await page.evaluate(() => { window.__lidSocket.onopen(); window.__lidSocket.sendAngle(70) })
    await page.waitForFunction(() => window.lidscape.progress() < 0.45)
    const before = await page.evaluate(() => window.lidscape.progress())
    await Promise.all([page.waitForURL(/city=testcity/, { waitUntil: 'commit' }), page.locator('#map-cities button').nth(1).click()])
    await page.waitForSelector('#still', { timeout: 5000 })
    const visibleMap = await page.evaluate(() => {
      const map = document.getElementById('still-hud')?.shadowRoot?.getElementById('map-info')
      const style = map && getComputedStyle(map)
      return Boolean(map && !map.hidden && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && map.getBoundingClientRect().width > 0)
    })
    assert.equal(visibleMap, true)
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('still'))
    assert.ok(Math.abs((await page.evaluate(() => window.lidscape.progress())) - before) < 0.1)
  } finally {
    await browser?.close()
  }
})

test('a paused animation frame does not prevent the app from starting after a setting change', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {}
      if (sessionStorage.getItem('lidscape.still')) window.requestAnimationFrame = () => 0
    })
    await useLocalModules(page, { serveFiles: true })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await Promise.all([page.waitForURL(/variant=christmas/), page.locator('#variant').selectOption('christmas')])
    await page.waitForFunction(() => window.lidscape?.progress, null, { timeout: 15000, polling: 100 })
    assert.equal(await page.evaluate(() => document.getElementById('variant').value), 'christmas')
  } finally {
    await browser?.close()
  }
})

test('a setting still changes if the previous frame cannot be captured', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {}
      HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Capture blocked', 'SecurityError') }
    })
    await useLocalModules(page, { serveFiles: true })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await Promise.all([page.waitForURL(/variant=christmas/, { waitUntil: 'commit', timeout: 5000 }), page.locator('#variant').selectOption('christmas')])
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('still-hud'))
    assert.equal(await page.locator('#variant').inputValue(), 'christmas')
  } finally {
    await browser?.close()
  }
})

test('a failed module load shows a retry action after a setting change', { timeout: 180000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {}
    })
    await useLocalModules(page, { serveFiles: true })
    let loads = 0
    await page.route('**/src/city.js', async (route) => {
      if ([2, 4].includes(++loads)) return route.abort('failed')
      return route.fallback()
    })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await Promise.all([page.waitForURL(/variant=christmas/, { waitUntil: 'commit' }), page.locator('#variant').selectOption('christmas')])
    const error = page.getByRole('alert')
    await error.waitFor({ timeout: 5000 })
    assert.match(await error.textContent(), /kunde inte laddas/i)
    assert.equal(await page.locator('#still-hud').count(), 0)
    assert.equal(await page.locator('#still').isVisible(), true)
    assert.equal(await page.locator('#about-btn').isVisible(), false)
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Försök igen')
    await page.keyboard.press('Tab')
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'about-btn')
    await page.getByRole('button', { name: 'Försök igen' }).click()
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('still-hud'), null, { timeout: 60000 })
    assert.equal(await page.locator('#variant').inputValue(), 'christmas')

    // The first load has no saved frame. It still needs a useful error and retry.
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=en`, { waitUntil: 'domcontentloaded' })
    await error.waitFor({ timeout: 5000 })
    assert.match(await error.textContent(), /could not load/i)
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('load-error'), null, { timeout: 60000 })
  } finally {
    await browser?.close()
  }
})

test('a module initialization error shows a retry action', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {}
    })
    await useLocalModules(page, { serveFiles: true })
    let loads = 0
    await page.route('**/src/city.js', (route) => {
      if (++loads === 2) return route.fulfill({ contentType: 'text/javascript', body: "export function buildCity() {}\nthrow new Error('Fixture initialization error')" })
      return route.fallback()
    })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.progress)
    await Promise.all([page.waitForURL(/variant=christmas/, { waitUntil: 'commit' }), page.locator('#variant').selectOption('christmas')])
    const error = page.getByRole('alert')
    await error.waitFor({ timeout: 5000 })
    assert.match(await error.textContent(), /kunde inte laddas/i)
    await page.getByRole('button', { name: 'Försök igen' }).click()
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('still-hud'))

    // A later unrelated error must not replace an already running scene.
    const laterError = page.waitForEvent('pageerror')
    await page.evaluate(() => { setTimeout(() => { throw new Error('Fixture late error') }) })
    assert.match((await laterError).message, /Fixture late error/)
    assert.equal(await page.locator('#load-error').count(), 0)

    // The existing WebGL explanation must not be replaced by the generic error.
    const noWebgl = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await noWebgl.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...args)
      }
    })
    await useLocalModules(noWebgl, { serveFiles: true })
    await noWebgl.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    await noWebgl.locator('#no-webgl').waitFor()
    assert.equal(await noWebgl.locator('#load-error').count(), 0)
  } finally {
    await browser?.close()
  }
})

test('a startup error remains actionable when the welcome dialog was open', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    await page.addInitScript(() => { window.WebSocket = class {} })
    await useLocalModules(page, { serveFiles: true })
    const source = await readFile(new URL('./main.js', import.meta.url), 'utf8')
    const start = 'setupHowTo({ t, lang, theme, variant })'
    assert.ok(source.includes(start))
    let loads = 0
    await page.route('**/src/main.js', (route) => {
      if (++loads === 1) return route.fulfill({ contentType: 'text/javascript', body: source.replace(start, `${start}\nthrow new Error('Fixture after welcome dialog')`) })
      return route.fallback()
    })
    await page.goto(`${url}?city=stockholm&theme=paper&quality=low&lang=sv`, { waitUntil: 'domcontentloaded' })
    const error = page.getByRole('alert')
    await error.waitFor({ timeout: 5000 })
    assert.equal(await page.locator('#howto').evaluate((dialog) => dialog.open), false)
    await page.getByRole('button', { name: 'Försök igen' }).click()
    await page.waitForFunction(() => window.lidscape?.progress && !document.getElementById('load-error'))
  } finally {
    await browser?.close()
  }
})

test('a setting change shows the last frame and menu until the new scene draws', { timeout: 120000 }, async () => {
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      try { localStorage.setItem('lidscape.howto', JSON.stringify(['paper', 'paper+christmas'])) } catch {}
      window.WebSocket = class {}
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
    await useLocalModules(page, { serveFiles: true })
    // Slow the scene code after the reload, as a slow Mac or network would.
    let loads = 0
    await page.route('**/src/city.js', async (route) => {
      if (loads++ === 1) await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fallback()
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
  }
})
