import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { CITIES } from '../src/cities/index.js'
import { THEMES } from '../src/themes/index.js'
import { VARIANTS } from '../src/variants/index.js'

const [pageFile, outputDirectory] = process.argv.slice(2)
if (!pageFile || !outputDirectory) {
  console.error('Use: node screensaver/generate-thumbnail.mjs <index.html> <resources>')
  process.exit(2)
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
})
try {
  const images = [
    { name: 'thumbnail.png', width: 240, height: 156, scale: 1, params: { city: 'stockholm', theme: 'paper' } },
    { name: 'thumbnail@2x.png', width: 240, height: 156, scale: 2, params: { city: 'stockholm', theme: 'paper' } },
    ...CITIES.flatMap(({ id: city }) => THEMES.flatMap(({ id: theme }) =>
      ['', ...VARIANTS.map(({ id }) => id)].map((variant) => ({
        name: `poster-city-${city}-${theme}-${variant || 'none'}.png`,
        // 21:9 covers ultrawide screens; the saver crops the sides on narrower ones.
        // Brush strokes and glow are sized in screen points, so render at a laptop's
        // point height (982) and scale up to 1440 pixels. Otherwise the poster looks
        // sharper than the live scene that replaces it.
        width: 2300, height: 982, scale: 1440 / 982,
        params: { city, theme, variant },
      })))),
  ]
  for (const image of images) {
    const page = await browser.newPage({
      viewport: { width: image.width, height: image.height },
      deviceScaleFactor: image.scale,
    })
    await page.addInitScript(() => {
      window.WebSocket = class { constructor() {} }
      window.lidscapeFrameSignals = 0
      window.webkit ??= {}
      window.webkit.messageHandlers ??= {}
      window.webkit.messageHandlers.lidscapeFrame = {
        postMessage() { window.lidscapeFrameSignals += 1 },
      }
    })
    const query = new URLSearchParams({ ...image.params, quality: 'high' })
    await page.goto(`${pathToFileURL(pageFile).href}?${query}`)
    await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 15)
    const firstRender = await page.evaluate(() => window.lidscapeSaverLastRender)
    if (!Number.isFinite(firstRender)) throw new Error('Screen saver render heartbeat is missing')
    await page.waitForFunction((previous) => window.lidscapeSaverLastRender > previous, firstRender)
    await page.waitForFunction(() => window.lidscapeFrameSignals > 1)
    const error = await page.locator('#error').textContent()
    if (error) throw new Error(`Cannot render screen saver thumbnail: ${error}`)
    await page.screenshot({ path: join(outputDirectory, image.name) })
    await page.close()
  }
  await copyFile(join(outputDirectory, 'poster-city-stockholm-paper-none.png'), join(outputDirectory, 'poster.png'))
} finally {
  await browser.close()
}
