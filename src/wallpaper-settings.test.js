import test from 'node:test'
import assert from 'node:assert/strict'
import { withPage } from './browser.test-support.js'

test('the wallpaper menu manages its own settings and confirms removal', { timeout: 120000 }, async () => {
  await withPage(5195, '?quality=low&lang=sv', () => {
    window.__wallpaperCalls = []
    window.__wallpaperState = { available: true, installed: false, registration: 'missing', selection: 'unknown', canUninstall: false, updateAvailable: false, settings: null }
    window.__TAURI__ = { core: { invoke: async (name, args) => {
      window.__wallpaperCalls.push({ name, args })
      if (name === 'check_update') return null
      if (name === 'open_wallpaper_settings' && args?.backups && window.__backupFail) throw new Error('Backup folder unavailable')
      if (window.__wallpaperFail && name === 'wallpaper_status') throw new Error('Test failure')
      if (name === 'install_wallpaper') {
        window.__wallpaperState.installed = true
        window.__wallpaperState.registration = 'registered'
        window.__wallpaperState.settings ??= { city: 'stockholm', theme: 'paper', variant: '' }
      }
      if (name === 'save_wallpaper_settings') window.__wallpaperState.settings = args.settings
      if (name === 'update_wallpaper') {
        if (args?.confirmedUnused !== true) throw new Error('Missing confirmation')
        if (window.__updateFail) throw new Error('Update failure')
        window.__wallpaperState.updateAvailable = false
      }
      if (name === 'uninstall_wallpaper') {
        if (args?.confirmedUnused !== true) throw new Error('Missing confirmation')
        window.__wallpaperState.installed = false
        window.__wallpaperState.settings = null
      }
      return structuredClone(window.__wallpaperState)
    } } }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    await page.locator('#city-wallpaper').waitFor({ state: 'visible' })
    await page.locator('#city-wallpaper').click()
    await page.getByText('Installera Lidscape och välj den sedan som bakgrund i Mac-inställningar.').waitFor()
    assert.equal(await page.locator('#wallpaper-city').isDisabled(), true)
    assert.equal(await page.locator('#wallpaper-system').isDisabled(), true)
    await page.locator('#wallpaper-install').click()
    await page.getByText('Lidscape är installerad. Kontrollera den valda bakgrunden i Mac-inställningar.').waitFor()
    assert.equal(await page.locator('#wallpaper-city').inputValue(), 'stockholm')
    await page.locator('#wallpaper-theme').selectOption('miniature')
    await page.locator('#wallpaper-variant').selectOption('christmas')
    await page.locator('#wallpaper-save').click()
    await page.getByText('Bakgrundens val är sparade.').waitFor()
    assert.deepEqual(await page.evaluate(() => window.__wallpaperState.settings), {
      city: 'stockholm', theme: 'miniature', variant: 'christmas',
    })
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => {
      window.__wallpaperState.registration = 'missing'
      window.__wallpaperState.available = false
      window.__wallpaperState.selection = 'active'
    })
    await page.locator('#city-wallpaper').click()
    await page.getByText('Lidscape är installerad men inte registrerad i macOS. Försök registrera igen.').waitFor()
    assert.equal(await page.locator('#wallpaper-register').isVisible(), true)
    await page.locator('#wallpaper-register').click()
    await page.getByText('Lidscape är installerad. Kontrollera den valda bakgrunden i Mac-inställningar.').waitFor()
    assert.equal(await page.locator('#wallpaper-register').isHidden(), true)
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), 'christmas')
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => { window.__wallpaperState.registration = 'unknown' })
    await page.locator('#city-wallpaper').click()
    await page.getByText('Lidscape är installerad. Registreringen kunde inte kontrolleras. Försök igen.').waitFor()
    assert.equal(await page.locator('#wallpaper-retry').isVisible(), true)
    await page.evaluate(() => { window.__wallpaperState.registration = 'registered' })
    await page.locator('#wallpaper-retry').click()
    await page.getByText('Lidscape är installerad. Kontrollera den valda bakgrunden i Mac-inställningar.').waitFor()
    assert.equal(await page.locator('#wallpaper-update').isHidden(), true)
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => { window.__wallpaperState.updateAvailable = true })
    await page.locator('#city-wallpaper').click()
    await page.getByText('En uppdatering finns. Lidscape är installerad. Kontrollera den valda bakgrunden i Mac-inställningar.').waitFor()
    await page.locator('#wallpaper-update').click()
    await page.getByText('Välj en annan bakgrund i Mac-inställningar för alla skärmar och Spaces. Bekräfta sedan för att uppdatera.').waitFor()
    assert.equal(await page.locator('#wallpaper-confirm').isDisabled(), true)
    assert.equal(await page.evaluate(() => window.__wallpaperCalls.some((call) => call.name === 'update_wallpaper')), false)
    await page.locator('#wallpaper-confirm-cancel').click()
    await page.locator('#wallpaper-update').click()
    await page.locator('#wallpaper-confirm-system').click()
    await page.evaluate(() => { window.__updateFail = true })
    await page.locator('#wallpaper-confirm').click()
    await page.getByText(/Update failure/).waitFor()
    assert.equal(await page.locator('#wallpaper-confirm').isEnabled(), true)
    await page.evaluate(() => { window.__updateFail = false })
    await page.locator('#wallpaper-confirm').click()
    await page.getByText(/Den tidigare versionen finns under Säkerhetskopior/).waitFor()
    await page.evaluate(() => { window.__backupFail = true })
    await page.locator('#wallpaper-backups').click()
    await page.getByText(/Backup folder unavailable/).waitFor()
    await page.evaluate(() => { window.__backupFail = false })
    await page.locator('#wallpaper-backups').click()
    await page.getByText(/Packa upp en säkerhetskopia/).waitFor()
    assert.equal(await page.evaluate(() => window.__wallpaperCalls.some((call) => call.name === 'open_wallpaper_settings' && call.args?.backups === true)), true)
    assert.equal(await page.locator('#wallpaper-update').isHidden(), true)
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), 'christmas')
    await page.locator('#wallpaper-install').click()
    assert.equal(await page.locator('#wallpaper-confirm').isDisabled(), true)
    assert.equal(await page.evaluate(() => window.__wallpaperCalls.some((call) => call.name === 'uninstall_wallpaper')), false)
    await page.locator('#wallpaper-confirm-system').click()
    assert.equal(await page.locator('#wallpaper-confirm').isEnabled(), true)
    await page.locator('#wallpaper-confirm-cancel').click()
    assert.equal(await page.evaluate(() => window.__wallpaperState.installed), true)
    await page.locator('#wallpaper-install').click()
    assert.equal(await page.locator('#wallpaper-confirm').isDisabled(), true)
    await page.locator('#wallpaper-confirm-system').click()
    await page.locator('#wallpaper-confirm').click()
    await page.getByText('Lidscape flyttades till Papperskorgen. Dina val finns kvar. Du kan installera igen.').waitFor()
    assert.equal(await page.evaluate(() => window.__wallpaperState.installed), false)
    assert.equal(await page.locator('#wallpaper-backups').isEnabled(), true)
    assert.equal(await page.evaluate(() => window.__wallpaperCalls.filter((call) => call.name === 'uninstall_wallpaper').length), 1)
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => { window.__wallpaperState.available = true })
    await page.locator('#city-wallpaper').click()
    await page.getByText('Installera Lidscape och välj den sedan som bakgrund i Mac-inställningar.').waitFor()
    await page.locator('#wallpaper-backups').click()
    await page.getByText(/Packa upp en säkerhetskopia/).waitFor()
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => { window.__wallpaperFail = true; window.__wallpaperState.available = true })
    await page.locator('#city-wallpaper').click()
    await page.getByText(/Test failure/).waitFor()
    assert.equal(await page.locator('#wallpaper-status').getAttribute('data-error'), 'true')
    assert.equal(await page.locator('#wallpaper-backups').isEnabled(), true)
    await page.locator('#wallpaper-backups').click()
    await page.getByText(/Packa upp en säkerhetskopia/).waitFor()
    assert.equal(await page.locator('#wallpaper-retry').isVisible(), true)
    await page.evaluate(() => { window.__wallpaperFail = false })
    await page.locator('#wallpaper-retry').click()
    await page.getByText('Installera Lidscape och välj den sedan som bakgrund i Mac-inställningar.').waitFor()
    assert.deepEqual(errors, [])
  })
})

test('the wallpaper menu stays hidden when the backend is absent', { timeout: 120000 }, async () => {
  await withPage(5196, '?quality=low&lang=sv', () => {
    window.__TAURI__ = { core: { invoke: async (name) => {
      if (name === 'wallpaper_status') throw new Error('Command wallpaper_status not found')
      return null
    } } }
  }, async (page, errors) => {
    assert.equal(await page.locator('#city-wallpaper').isHidden(), true)
    assert.deepEqual(errors, [])
  })
})

test('a temporary startup error can be retried', { timeout: 120000 }, async () => {
  await withPage(5198, '?quality=low&lang=sv', () => {
    window.__wallpaperFail = true
    window.__TAURI__ = { core: { invoke: async (name) => {
      if (name === 'wallpaper_status') {
        if (window.__wallpaperFail) throw new Error('Wallpaper store unavailable')
        return { available: true, installed: false, selection: 'unknown', settings: null }
      }
      return null
    } } }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    await page.locator('#city-wallpaper').waitFor({ state: 'visible' })
    await page.locator('#city-wallpaper').click()
    await page.getByText(/Wallpaper store unavailable/).waitFor()
    await page.evaluate(() => { window.__wallpaperFail = false })
    await page.locator('#wallpaper-retry').click()
    await page.getByText('Installera Lidscape och välj den sedan som bakgrund i Mac-inställningar.').waitFor()
    assert.deepEqual(errors, [])
  })
})

test('unreadable wallpaper choices can be replaced after a save error', { timeout: 120000 }, async () => {
  await withPage(5199, '?quality=low&lang=sv', () => {
    window.__wallpaperState = {
      available: true, installed: true, registration: 'registered', selection: 'unknown',
      canUninstall: true, updateAvailable: false,
      settings: { city: 'stockholm', theme: 'removed-theme', variant: 'christmas' },
    }
    window.__wallpaperStoreUnavailable = true
    window.__TAURI__ = { core: { invoke: async (name, args) => {
      if (name === 'check_update') return null
      if (name === 'save_wallpaper_settings') {
        if (window.__wallpaperStoreUnavailable) throw new Error('Settings store unavailable')
        window.__wallpaperState.settings = structuredClone(args.settings)
      }
      return structuredClone(window.__wallpaperState)
    } } }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    await page.locator('#city-wallpaper').waitFor({ state: 'visible' })
    await page.locator('#city-wallpaper').click()
    await page.getByText(/De sparade valen kunde inte läsas/).waitFor()
    assert.equal(await page.locator('#wallpaper-city').inputValue(), 'stockholm')
    assert.equal(await page.locator('#wallpaper-theme').inputValue(), 'paper')
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), '')
    assert.equal(await page.locator('#wallpaper-save').isEnabled(), true)
    await page.locator('#wallpaper-theme').selectOption('miniature')
    await page.locator('#wallpaper-variant').selectOption('christmas')
    await page.locator('#wallpaper-save').click()
    await page.getByText(/Settings store unavailable/).waitFor()
    assert.equal(await page.locator('#wallpaper-save').isEnabled(), true)
    assert.equal(await page.locator('#wallpaper-theme').inputValue(), 'miniature')
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), 'christmas')
    await page.locator('#wallpaper-retry').click()
    await page.getByText(/De sparade valen kunde inte läsas/).waitFor()
    assert.equal(await page.locator('#wallpaper-theme').inputValue(), 'miniature')
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), 'christmas')
    await page.evaluate(() => { window.__wallpaperStoreUnavailable = false })
    await page.locator('#wallpaper-save').click()
    await page.getByText('Bakgrundens val är sparade.').waitFor()
    assert.deepEqual(await page.evaluate(() => window.__wallpaperState.settings), {
      city: 'stockholm', theme: 'miniature', variant: 'christmas',
    })
    await page.locator('#wallpaper-close').click()
    await page.locator('#city-wallpaper').click()
    await page.getByText('Lidscape är installerad. Kontrollera den valda bakgrunden i Mac-inställningar.').waitFor()
    assert.equal(await page.locator('#wallpaper-theme').inputValue(), 'miniature')
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), 'christmas')
    await page.locator('#wallpaper-close').click()
    await page.evaluate(() => { window.__wallpaperState.settings = null })
    await page.locator('#city-wallpaper').click()
    await page.getByText(/De sparade valen kunde inte läsas/).waitFor()
    assert.equal(await page.locator('#wallpaper-theme').inputValue(), 'paper')
    assert.equal(await page.locator('#wallpaper-variant').inputValue(), '')
    await page.locator('#wallpaper-save').click()
    await page.getByText('Bakgrundens val är sparade.').waitFor()
    assert.deepEqual(await page.evaluate(() => window.__wallpaperState.settings), {
      city: 'stockholm', theme: 'paper', variant: '',
    })
    assert.deepEqual(errors, [])
  })
})


test('backups stay accessible without an installed wallpaper or bundled source', { timeout: 120000 }, async () => {
  await withPage(5199, '?quality=low&lang=sv', () => {
    window.__backupCalls = []
    window.__TAURI__ = { core: { invoke: async (name, args) => {
      window.__backupCalls.push({ name, args })
      if (name === 'wallpaper_status') return { available: false, installed: false, hasBackups: true }
      return null
    } } }
  }, async (page, errors) => {
    if (await page.locator('#howto').evaluate((dialog) => dialog.open)) await page.locator('#howto button').click()
    await page.locator('#city-wallpaper').waitFor({ state: 'visible' })
    await page.locator('#city-wallpaper').click()
    await page.getByText('Bakgrunden finns inte i den här versionen av Mac-appen.').waitFor()
    await page.locator('#wallpaper-backups').click()
    await page.getByText(/Packa upp en säkerhetskopia/).waitFor()
    assert.equal(await page.evaluate(() => window.__backupCalls.some((call) => call.name === 'open_wallpaper_settings' && call.args?.backups === true)), true)
    assert.deepEqual(errors, [])
  })
})
