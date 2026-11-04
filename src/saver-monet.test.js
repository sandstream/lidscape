import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))

test('the offline Monet screen saver renders without shader errors and follows the lid', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lidscape-monet-saver-'))
  let browser
  try {
    const bundled = join(dir, 'saver.js')
    execFileSync('bun', ['build', '--target=browser', '--format=iife', `--outfile=${bundled}`, join(root, 'src/saver-main.js')])
    const html = await readFile(join(root, 'screensaver/index.html'), 'utf8')
    const script = await readFile(bundled)
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
    await page.addInitScript(() => {
      window.WebSocket = class { constructor() { throw new Error('The screen saver must use the native sensor') } }
      window.shaderErrors = []
      for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!Context) continue
        const prototype = Context.prototype
        for (const [method, status, log] of [
          ['compileShader', 'COMPILE_STATUS', 'getShaderInfoLog'],
          ['linkProgram', 'LINK_STATUS', 'getProgramInfoLog'],
        ]) {
          const original = prototype[method]
          prototype[method] = function (item) {
            original.call(this, item)
            const ok = method === 'compileShader'
              ? this.getShaderParameter(item, this[status])
              : this.getProgramParameter(item, this[status])
            if (!ok) window.shaderErrors.push(this[log](item) || `${method} failed`)
          }
        }
      }
    })
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin === 'http://lidscape.test' && url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html })
      if (url.origin === 'http://lidscape.test' && url.pathname === '/saver.js') return route.fulfill({ contentType: 'text/javascript', body: script })
      errors.push(`Unexpected network request: ${url.origin}${url.pathname}`)
      return route.abort()
    })

    await page.goto('http://lidscape.test/index.html?city=stockholm&theme=monet&quality=low')
    await page.waitForFunction(() => window.lidscapeSaver?.renderer.info.render.frame > 5)
    const frame = await page.evaluate(() => window.lidscapeSaver.renderer.info.render.frame)
    await page.waitForFunction((previous) => window.lidscapeSaver.renderer.info.render.frame > previous + 2, frame)
    assert.equal(await page.locator('#error').textContent(), '')
    assert.deepEqual(await page.evaluate(() => window.shaderErrors), [])
    assert.deepEqual(errors, [])
    assert.equal(await page.evaluate(() => {
      const gl = window.lidscapeSaver.renderer.getContext()
      return gl.getError()
    }), 0, 'WebGL must not report an error')
    const picture = await page.screenshot()
    assert.ok(picture.length > 10000, 'The city picture must not be blank')

    const sky = async () => {
      const screenshot = await page.screenshot()
      return page.evaluate(async (base64) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, 4).data
        const sum = [0, 0, 0]
        for (let i = 0; i < pixels.length; i += 4) {
          for (let channel = 0; channel < 3; channel += 1) sum[channel] += pixels[i + channel]
        }
        return sum.map((value) => value / (pixels.length / 4))
      }, screenshot.toString('base64'))
    }
    const waitForSky = async (matches, description) => {
      const deadline = Date.now() + 10000
      let value
      do {
        value = await sky()
        if (matches(value)) return value
      } while (Date.now() < deadline)
      assert.fail(`${description}: last sky=${value}`)
    }
    const openSky = await sky()
    await page.evaluate(() => window.lidscapeSaverSetLidAngle(15))
    await page.waitForFunction(() => window.lidscapeSaver.city.root.children.some((child) => child.type === 'Group' && child.rotation.x < -1.4))
    await waitForSky((value) => value[0] > openSky[0] + 4, `The sky must become hazier as the lid closes: open=${openSky}`)
    await page.evaluate(() => window.lidscapeSaverSetLidAngle(105))
    await page.waitForFunction(() => window.lidscapeSaver.city.root.children.filter((child) => child.type === 'Group').every((child) => Math.abs(child.rotation.x) < 0.01))
    await waitForSky((value) => Math.abs(value[0] - openSky[0]) < 4, `The haze must clear when the lid opens: open=${openSky}`)
    assert.deepEqual(await page.evaluate(() => window.shaderErrors), [])
    assert.equal(await page.evaluate(() => {
      const gl = window.lidscapeSaver.renderer.getContext()
      return gl.getError()
    }), 0, 'WebGL must not report an error')
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await rm(dir, { recursive: true, force: true })
  }
})
