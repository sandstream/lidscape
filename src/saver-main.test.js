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
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.WebSocket = class { constructor() { throw new Error('The screen saver must use the native sensor') } }
      window.lidscapeSaverOptions = { view: 'map' }
    })
    await page.route('http://lidscape.test/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/index.html') return route.fulfill({ contentType: 'text/html', body: html })
      if (path === '/saver.js') return route.fulfill({ contentType: 'text/javascript', body: script })
      return route.abort()
    })

    for (const query of ['', '&view=map']) {
      await page.goto(`http://lidscape.test/index.html?quality=low${query}`)
      await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 5)
      assert.equal(await page.evaluate(() => window.lidscapeSaver.city.root.visible), true)
      assert.equal(await page.evaluate(() => 'worldMap' in window.lidscapeSaver), false)
      assert.equal(await page.locator('#error').evaluate((element) => getComputedStyle(element).display), 'none')
      assert.equal(await page.locator('#error').textContent(), '')
      assert.equal(await page.locator('body > canvas').count(), 1)
      assert.ok((await page.screenshot()).length > 20000, 'city picture is empty')
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(15))
      await page.waitForFunction(() => window.lidscapeSaver.lid.progress === 0)
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.some((child) => child.type === 'Group' && child.rotation.x < -1.4))
      await page.evaluate(() => window.lidscapeSaverClearLidAngle())
      assert.deepEqual(await page.evaluate(() => ({ connected: window.lidscapeSaver.lid.connected, progress: window.lidscapeSaver.lid.progress })), { connected: false, progress: null })
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.filter((child) => child.type === 'Group').every((child) => Math.abs(child.rotation.x) < 0.01))
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(15))
      await page.waitForFunction(() => window.lidscapeSaver.lid.progress === 0)
      await page.evaluate(() => window.lidscapeSaverSetLidAngle(105))
      await page.waitForFunction(() => window.lidscapeSaver.lid.progress === 1)
      await page.waitForFunction(() => window.lidscapeSaver.city.root.children.filter((child) => child.type === 'Group').every((child) => Math.abs(child.rotation.x) < 0.01))
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await rm(dir, { recursive: true, force: true })
  }
})
