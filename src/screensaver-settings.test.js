import test from 'node:test'
import assert from 'node:assert/strict'
import { withPage } from './browser.test-support.js'

test('Mac screen saver settings save, install, open Mac settings, and remove from the map menu', { timeout: 120000 }, async () => {
  await withPage(5192, '?view=map&quality=low&lang=sv', () => {
    window.__saverState = {
      installed: false,
      available: true,
      settings: { city: 'stockholm', theme: 'paper', variant: '', view: 'city' },
    }
    window.__saverCalls = []
    window.__TAURI__ = { core: { invoke: async (name, args) => {
      window.__saverCalls.push(name)
      if (name === 'check_update') return null
      if (name === 'save_screensaver_settings') {
        if (window.__failSaver) throw new Error('Test failure')
        window.__saverState.settings = { ...args.settings }
      }
      if (name === 'install_screensaver') {
        setTimeout(() => { window.__saverState.installed = true }, 100)
        return { ...structuredClone(window.__saverState), installationPending: true }
      }
      if (name === 'uninstall_screensaver') window.__saverState.installed = false
      return structuredClone(window.__saverState)
    } } }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    assert.equal(await page.locator('#map-saver').isVisible(), true)
    assert.equal(await page.locator('#city-saver').isVisible(), false)
    await page.locator('#map-saver').click()
    await page.getByText('Kontrollerar skärmsläckaren…').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#saver-settings').evaluate((dialog) => dialog.open), true)
    await page.locator('#saver-view').selectOption('map')
    assert.equal(await page.locator('#saver-city').isVisible(), false)
    await page.locator('#saver-save').click()
    assert.deepEqual(await page.evaluate(() => window.__saverState.settings), {
      city: 'stockholm', theme: 'paper', variant: '', view: 'map',
    })
    await page.locator('#saver-install').click()
    await page.getByText('Installerad. Öppna Mac-inställningar, välj Skärmsläckare och sedan Lidscape.').waitFor()
    await page.locator('#saver-system').click()
    assert.equal(await page.evaluate(() => window.__saverCalls.includes('open_screensaver_settings')), true)
    await page.locator('#saver-install').click()
    await page.getByText('Skärmsläckaren togs bort.').waitFor()
    assert.equal(await page.evaluate(() => window.__saverState.installed), false)
    await page.locator('#saver-view').selectOption('city')
    await page.locator('#saver-theme').selectOption('miniature')
    await page.evaluate(() => { window.__failSaver = true })
    await page.locator('#saver-save').click()
    await page.getByText(/Test failure/).waitFor()
    assert.equal(await page.locator('#saver-status').getAttribute('data-error'), 'true')
    await page.locator('#saver-close').click()
    assert.equal(await page.locator('#saver-settings').evaluate((dialog) => dialog.open), false)
    assert.deepEqual(errors, [])
  })
})
