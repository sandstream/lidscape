import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'

const [pageFile, outputFile] = process.argv.slice(2)
if (!pageFile || !outputFile) throw new Error('Use: node wallpaper/generate-poster.mjs <index.html> <poster.png>')
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  await page.addInitScript(() => {
    window.WebSocket = class { constructor() {} }
  })
  await page.goto(`${pathToFileURL(pageFile).href}?city=stockholm&theme=paper&quality=high`)
  await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 15)
  const error = await page.locator('#error').textContent()
  if (error) throw new Error(`Cannot render the wallpaper poster: ${error}`)
  await page.screenshot({ path: outputFile })
} finally {
  await browser.close()
}
