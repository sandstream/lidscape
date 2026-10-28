import { local } from './lang/index.js'

export function setupScreenSaverSettings({ t, lang, cities, themes, variants }) {
  if (!window.__TAURI__?.core?.invoke) return

  const invoke = window.__TAURI__.core.invoke
  const dialog = document.getElementById('saver-settings')
  const status = document.getElementById('saver-status')
  const save = document.getElementById('saver-save')
  const install = document.getElementById('saver-install')
  const system = document.getElementById('saver-system')
  const close = document.getElementById('saver-close')
  const view = document.getElementById('saver-view')
  const city = document.getElementById('saver-city')
  const theme = document.getElementById('saver-theme')
  const variant = document.getElementById('saver-variant')
  let current = null
  let busy = false

  document.getElementById('saver-title').textContent = t.saverTitle
  document.getElementById('saver-description').textContent = t.saverDescription
  for (const [id, label] of [['view', t.saverView], ['city', t.saverCity], ['theme', t.saverTheme], ['variant', t.saverVariant]]) {
    document.getElementById(`saver-${id}-label`).textContent = label
  }
  view.add(new Option(t.saverViewCity, 'city'))
  view.add(new Option(t.saverViewMap, 'map'))
  for (const item of cities) city.add(new Option(local(item.name, lang), item.id))
  for (const item of themes) theme.add(new Option(local(item.name, lang), item.id))
  variant.add(new Option(t.variantNone, ''))
  for (const item of variants) variant.add(new Option(local(item.name, lang), item.id))
  save.textContent = t.saverSave
  system.textContent = t.saverSystem
  close.textContent = t.saverClose

  const controls = [view, city, theme, variant, save, install, system]
  const chosen = () => ({ city: city.value, theme: theme.value, variant: variant.value, view: view.value })
  const dirty = () => current && Object.entries(chosen()).some(([key, value]) => value !== current.settings[key])
  const message = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
  }
  function refresh() {
    const available = !!current?.available
    for (const control of controls) control.disabled = busy || !current
    save.disabled = busy || !available || !dirty()
    install.disabled = busy || !current || (!available && !current.installed)
    system.disabled = busy || !current?.installed
    install.textContent = current?.installed ? t.saverUninstall : t.saverInstall
    for (const field of dialog.querySelectorAll('.saver-city-field')) field.hidden = view.value === 'map'
  }
  function apply(result) {
    current = result
    view.value = result.settings.view
    city.value = result.settings.city
    theme.value = result.settings.theme
    variant.value = result.settings.variant
    refresh()
  }
  async function run(action) {
    busy = true
    refresh()
    try {
      await action()
    } catch (error) {
      message(t.saverError.replace('{error}', String(error)), true)
    } finally {
      busy = false
      refresh()
    }
  }
  async function persistIfDirty() {
    if (!dirty()) return
    apply(await invoke('save_screensaver_settings', { settings: chosen() }))
  }

  for (const input of [view, city, theme, variant]) input.addEventListener('change', refresh)
  for (const button of [document.getElementById('city-saver'), document.getElementById('map-saver')]) {
    button.textContent = t.saver
    button.hidden = false
    button.addEventListener('click', () => {
      current = null
      message(t.saverLoading)
      refresh()
      dialog.showModal()
      run(async () => {
        const result = await invoke('screensaver_status')
        apply(result)
        message(!result.available ? t.saverUnavailable : result.installed ? t.saverInstalled : t.saverReady)
      })
    })
  }
  save.addEventListener('click', () => run(async () => {
    apply(await invoke('save_screensaver_settings', { settings: chosen() }))
    message(t.saverSaved)
  }))
  install.addEventListener('click', () => run(async () => {
    if (current.installed) {
      apply(await invoke('uninstall_screensaver'))
      message(t.saverRemoved)
      return
    }
    await persistIfDirty()
    let result = await invoke('install_screensaver')
    if (result.installationPending) {
      message(t.saverConfirm)
      for (let attempt = 0; attempt < 60 && dialog.open && !result.installed; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        result = await invoke('screensaver_status')
      }
    }
    apply(result)
    message(result.installed ? t.saverInstalled : t.saverNotInstalled)
  }))
  system.addEventListener('click', () => run(async () => {
    await persistIfDirty()
    await invoke('open_screensaver_settings')
    message(t.saverInstalled)
  }))
  close.addEventListener('click', () => dialog.close())
}
