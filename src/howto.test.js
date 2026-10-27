import test from 'node:test'
import assert from 'node:assert/strict'
import { withPage } from './browser.test-support.js'

test('help opens first, remembers dismissal, and can open again', { timeout: 45000 }, async () => {
  await withPage(5190, '?quality=low&lang=sv', null, async (page, errors) => {
    assert.equal(await page.locator('#howto').evaluate((dialog) => dialog.open), true)
    assert.ok((await page.locator('#howto ul').innerText()).includes('MacBook'))
    await page.locator('#howto button').click()
    assert.equal(await page.locator('#howto').evaluate((dialog) => dialog.open), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.lidscape?.worldMap)
    assert.equal(await page.locator('#howto').evaluate((dialog) => dialog.open), false)
    await page.locator('#help-btn').click()
    assert.equal(await page.locator('#howto').evaluate((dialog) => dialog.open), true)
    assert.deepEqual(errors, [])
  })
})
