import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function useLocalModules(page) {
  const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
    .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', '/node_modules/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', '/node_modules/three/examples/jsm/')
    .replace('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs', '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (route.request().resourceType() === 'document' && url.hostname === '127.0.0.1' && url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: html })
    }
    if (url.hostname !== '127.0.0.1') return route.abort()
    return route.continue()
  })
}

export async function withPage(port, query, init, run) {
  const base = `http://127.0.0.1:${port}/`
  const server = spawn('python3', ['tools/serve.py', String(port)], { cwd: root, stdio: 'ignore' })
  let browser
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = (await fetch(base)).ok } catch {}
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('Lidscape test server did not start')
    browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] })
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (init) await page.addInitScript(init)
    await useLocalModules(page)
    await page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.worldMap)
    await run(page, errors)
  } finally {
    await browser?.close()
    server.kill()
  }
}
