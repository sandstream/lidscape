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
  for (const scale of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: 240, height: 156 },
      deviceScaleFactor: scale,
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
    const name = scale === 1 ? 'thumbnail.png' : 'thumbnail@2x.png'
    await page.screenshot({ path: join(outputDirectory, name) })
    await page.close()
  }
} finally {
  await browser.close()
}
