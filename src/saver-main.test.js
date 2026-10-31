import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('the offline screen saver draws the city and follows the lid', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-saver-test-'))
  let browser
  try {
    const bundled = join(dir, 'saver.js')
    execFileSync('bun', ['build', '--target=browser', '--format=iife', `--outfile=${bundled}`, join(root, 'src/saver-main.js')])
    const html = await readFile(join(root, 'screensaver/index.html'), 'utf8')
    const script = await readFile(bundled)
    const font = await readFile(join(root, 'assets/fonts/instrument-serif-italic.woff2'))
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.WebSocket = class { constructor() { throw new Error('The screen saver must use the native sensor') } }
      // Older installations may still send this setting.
      window.lidscapeSaverOptions = { view: 'map' }
    })
    await page.route('http://lidscape.test/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/index.html') return route.fulfill({ contentType: 'text/html', body: html })
      if (path === '/saver.js') return route.fulfill({ contentType: 'text/javascript', body: script })
      if (path === '/instrument-serif-italic.woff2') return route.fulfill({ contentType: 'font/woff2', body: font })
      return route.abort()
    })

    let cityHit
    for (const query of ['', '&view=map']) {
      await page.goto(`http://lidscape.test/index.html?quality=low${query}&lang=en`)
      await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 5)
      assert.equal(await page.evaluate(() => window.lidscapeSaver.city.root.visible), true)
      assert.equal(await page.evaluate(() => 'worldMap' in window.lidscapeSaver), false)
      await page.evaluate(() => window.lidscapeSaverSetPaused(true))
      const pausedFrame = await page.evaluate(() => window.lidscapeSaver.renderer.info.render.frame)
      await page.waitForTimeout(300)
      assert.equal(await page.evaluate(() => window.lidscapeSaver.renderer.info.render.frame), pausedFrame)
      await page.evaluate(() => { window.lidscapeSaverSetPaused(true); window.lidscapeSaverSetPaused(false); window.lidscapeSaverSetPaused(false) })
      await page.waitForFunction((frame) => window.lidscapeSaver.renderer.info.render.frame > frame, pausedFrame)
      assert.equal(await page.locator('#error').evaluate((element) => getComputedStyle(element).display), 'none')
      assert.equal(await page.locator('#error').textContent(), '')
      assert.equal(await page.locator('body > canvas').count(), 1)
      assert.ok((await page.screenshot()).length > 20000, 'city picture is empty')
      assert.equal(await page.locator('#label').isHidden(), true)
      const hit = await page.evaluate(() => {
        const label = document.getElementById('label')
        for (let y = 0.1; y < 0.9; y += 0.025) {
          for (let x = 0.1; x < 0.9; x += 0.025) {
            window.lidscapeSaverSetPointer(x, y)
            if (!label.hidden) return {
              x, y, name: label.querySelector('strong').textContent,
              note: label.querySelector('span').textContent,
            }
          }
        }
        return null
      })
      const landmarks = {
        'City Hall': '1923 · tower 106 m',
        Kaknästornet: '1967 · 155 m, 170 m with the mast',
        'Riddarholmen Church': 'Cast iron spire 1841 · 91 m',
        'German Church': 'Tower 1886 · 96 m',
        'Stockholm Cathedral': 'Lantern 1743 · 60–66 m',
        'Royal Palace': 'Royal home since 1754',
        'Katarina Church': '1695 · 72 m',
        Globen: 'Avicii Arena · 1989 · 85 m',
      }
      assert.ok(hit, 'a landmark can be picked')
      cityHit = hit
      assert.equal(hit.note, landmarks[hit.name])
      assert.equal(await page.locator('#label').isVisible(), true)
      assert.equal(await page.evaluate(async () => (await document.fonts.load('italic 19px "Instrument Serif"')).length > 0), true)
      await page.evaluate(() => window.lidscapeSaverSetPointer(0, 0))
      assert.equal(await page.locator('#label').isHidden(), true)
      await page.evaluate(() => window.lidscapeSaverSetPointer(null, null))
      assert.equal(await page.locator('#label').isHidden(), true)
      await page.evaluate(() => window.lidscapeSaverSetPointer(-0.1, 0.5))
      assert.equal(await page.locator('#label').isHidden(), true)
      await page.evaluate(({ x, y }) => window.lidscapeSaverSetPointer(x, y), hit)
      assert.equal(await page.locator('#label').isVisible(), true)
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(15))
      await page.waitForFunction(() => window.lidscapeSaver.lid.progress === 0)
      await page.waitForFunction(() => document.getElementById('label').hidden)
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.some((child) => child.type === 'Group' && child.rotation.x < -1.4))
      await page.evaluate(() => window.lidscapeSaverClearLidAngle())
      assert.deepEqual(await page.evaluate(() => ({
        connected: window.lidscapeSaver.lid.connected,
        progress: window.lidscapeSaver.lid.progress,
      })), { connected: false, progress: null })
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.filter((child) => child.type === 'Group').every((child) => Math.abs(child.rotation.x) < 0.01))
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(15))
      await page.waitForFunction(() => window.lidscapeSaver.lid.connected && window.lidscapeSaver.lid.progress === 0)
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(105))
      await page.waitForFunction(() => window.lidscapeSaver.lid.progress === 1)
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.filter((child) => child.type === 'Group').every((child) => Math.abs(child.rotation.x) < 0.01))
    }
    await page.goto('http://lidscape.test/index.html?quality=low&view=city&lang=sv')
    await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 5)
    await page.evaluate(({ x, y }) => window.lidscapeSaverSetPointer(x, y), cityHit)
    const swedishNames = {
      'City Hall': 'Stadshuset',
      Kaknästornet: 'Kaknästornet',
      'Riddarholmen Church': 'Riddarholmskyrkan',
      'German Church': 'Tyska kyrkan',
      'Stockholm Cathedral': 'Storkyrkan',
      'Royal Palace': 'Kungliga slottet',
      'Katarina Church': 'Katarina kyrka',
      Globen: 'Globen',
    }
    assert.equal(await page.locator('#label strong').textContent(), swedishNames[cityHit.name])
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await rm(dir, { recursive: true, force: true })
  }
})
