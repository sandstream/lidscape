import test from 'node:test'
import assert from 'node:assert/strict'
import { withPage } from './browser.test-support.js'

test('an app update can be deferred or disabled', { timeout: 120000 }, async () => {
  await withPage(5191, '?quality=low&lang=en', () => {
    window.__TAURI__ = {
      core: { invoke: async (name) => name === 'check_update'
        ? { version: '9.9.9', url: 'https://github.com/sandstream/lidscape/releases/tag/v9.9.9' }
        : null },
    }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    const notice = page.locator('#hud-update')
    await notice.waitFor({ state: 'visible' })
    assert.ok((await notice.innerText()).includes('9.9.9'))
    await notice.locator('button').nth(1).click()
    assert.equal(await notice.isVisible(), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.worldMap)
    assert.equal(await notice.isVisible(), false)
    await page.locator('#update-check input').uncheck()
    assert.equal(await page.evaluate(() => localStorage.getItem('lidscape.updates')), 'off')
    assert.deepEqual(errors, [])
  })
})
