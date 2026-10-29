import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

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
    { name: 'thumbnail.png', width: 240, height: 156, scale: 1 },
    { name: 'thumbnail@2x.png', width: 240, height: 156, scale: 2 },
    { name: 'poster.png', width: 2560, height: 1440, scale: 1 },
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
    await page.goto(`${pathToFileURL(pageFile).href}?view=city&city=stockholm&theme=paper&quality=high`)
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
} finally {
  await browser.close()
}
