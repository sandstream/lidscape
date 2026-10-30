import test from 'node:test'
import assert from 'node:assert/strict'
import { withPage } from './browser.test-support.js'

test('Mac app installs, opens settings, and removes the screen saver from the map menu', { timeout: 120000 }, async () => {
  await withPage(5192, '?view=map&quality=low&lang=sv', () => {
    window.__saverState = { installed: false, available: true }
    window.__saverCalls = []
    window.__TAURI__ = { core: { invoke: async (name) => {
      window.__saverCalls.push(name)
      if (name === 'check_update') return null
      if (window.__failSaver && name === 'screensaver_status') throw new Error('Test failure')
      if (name === 'install_screensaver' && window.__unsignedSource) throw new Error('LIDSCAPE_SAVER_SOURCE_UNVERIFIED')
      if (name === 'install_screensaver') {
        setTimeout(() => { window.__saverState.installed = true }, 100)
        return { ...structuredClone(window.__saverState), installationPending: true }
      }
      if (name === 'uninstall_screensaver' && window.__partialSaver) throw new Error('Trash failed. LIDSCAPE_SAVER_PARTIAL_REMOVAL')
      if (name === 'uninstall_screensaver' && window.__unsignedSaver) throw new Error('LIDSCAPE_SAVER_UNVERIFIED')
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
    assert.equal(await page.locator('#saver-description').textContent(), 'Installera skärmsläckaren. Välj bild med Alternativ i Mac-inställningar.')
    await page.locator('#saver-install').click()
    await page.getByText('Installerad. Öppna Mac-inställningar, välj Skärmsläckare och Lidscape. Välj bild med Alternativ.').waitFor()
    await page.locator('#saver-system').click()
    assert.equal(await page.evaluate(() => window.__saverCalls.includes('open_screensaver_settings')), true)
    await page.locator('#saver-install').click()
    await page.getByText('Skärmsläckaren finns i Papperskorgen. Dra tillbaka den till ~/Library/Screen Savers för att återställa den.').waitFor()
    assert.equal(await page.evaluate(() => window.__saverState.installed), false)
    await page.locator('#saver-close').click()
    await page.evaluate(() => { window.__failSaver = true })
    await page.locator('#map-saver').click()
    await page.getByText(/Test failure/).waitFor()
    assert.equal(await page.locator('#saver-status').getAttribute('data-error'), 'true')
    await page.locator('#saver-close').click()
    await page.evaluate(() => { window.__failSaver = false; window.__unsignedSaver = true; window.__saverState.installed = true })
    await page.locator('#map-saver').click()
    await page.getByText('Installerad. Öppna Mac-inställningar, välj Skärmsläckare och Lidscape. Välj bild med Alternativ.').waitFor()
    await page.locator('#saver-install').click()
    await page.getByText(/Ta bort äldre osignerade versioner manuellt/).waitFor()
    assert.equal(await page.evaluate(() => window.__saverState.installed), true)
    await page.locator('#saver-close').click()
    await page.evaluate(() => { window.__unsignedSaver = false; window.__unsignedSource = true; window.__saverState.installed = false })
    await page.locator('#map-saver').click()
    await page.getByText('Välj Installera. Bekräfta i macOS och välj sedan Lidscape under Skärmsläckare. Välj bild med Alternativ.').waitFor()
    await page.locator('#saver-install').click()
    await page.getByText(/Den medföljande skärmsläckaren saknar giltig Lidscape-signatur/).waitFor()
    assert.equal(await page.evaluate(() => window.__saverState.installed), false)
    await page.locator('#saver-close').click()
    await page.evaluate(() => { window.__unsignedSource = false; window.__partialSaver = true; window.__saverState.installed = true })
    await page.locator('#map-saver').click()
    await page.getByText('Installerad. Öppna Mac-inställningar, välj Skärmsläckare och Lidscape. Välj bild med Alternativ.').waitFor()
    await page.locator('#saver-install').click()
    await page.getByText(/En annan version har redan flyttats till Papperskorgen/).waitFor()
    assert.deepEqual(errors, [])
  })
})
