import { CITIES } from './cities/index.js'
import { THEMES } from './themes/index.js'
import { VARIANTS } from './variants/index.js'
import { local } from './lang/index.js'

export function setupWallpaperSettings({ t, lang }) {
  if (!window.__TAURI__?.core?.invoke) return

  const invoke = window.__TAURI__.core.invoke
  const byId = (id) => document.getElementById(id)
  const button = byId('city-wallpaper')
  const dialog = byId('wallpaper-settings')
  const status = byId('wallpaper-status')
  const main = byId('wallpaper-main')
  const confirmation = byId('wallpaper-confirmation')
  const install = byId('wallpaper-install')
  const update = byId('wallpaper-update')
  const register = byId('wallpaper-register')
  const save = byId('wallpaper-save')
  const system = byId('wallpaper-system')
  const backups = document.createElement('button')
  backups.type = 'button'
  backups.id = 'wallpaper-backups'
  system.insertAdjacentElement('afterend', backups)
  const retry = byId('wallpaper-retry')
  const close = byId('wallpaper-close')
  const confirmSystem = byId('wallpaper-confirm-system')
  const confirmAction = byId('wallpaper-confirm')
  const confirmCancel = byId('wallpaper-confirm-cancel')
  const city = byId('wallpaper-city')
  const theme = byId('wallpaper-theme')
  const variant = byId('wallpaper-variant')
  let current = null
  let busy = false
  let confirmationAction = null
  let systemOpened = false
  let choicesInitialized = false

  button.textContent = t.wallpaper
  byId('wallpaper-title').textContent = t.wallpaperTitle
  byId('wallpaper-description').textContent = t.wallpaperDescription
  byId('wallpaper-city-label').textContent = t.city
  byId('wallpaper-theme-label').textContent = t.theme
  byId('wallpaper-variant-label').textContent = t.variant
  save.textContent = t.wallpaperSave
  update.textContent = t.wallpaperUpdate
  register.textContent = t.wallpaperRegister
  system.textContent = confirmSystem.textContent = t.wallpaperSystem
  backups.textContent = t.wallpaperBackups
  retry.textContent = t.wallpaperRetry
  close.textContent = t.wallpaperClose
  confirmAction.textContent = t.wallpaperRemoveConfirm
  confirmCancel.textContent = t.wallpaperRemoveCancel
  for (const item of CITIES) city.add(new Option(local(item.name, lang), item.id))
  for (const item of THEMES) theme.add(new Option(local(item.name, lang), item.id))
  variant.add(new Option(t.variantNone, ''))
  for (const item of VARIANTS) variant.add(new Option(local(item.name, lang), item.id))

  const message = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
  }
  const settingsValid = (settings) => !!settings &&
    CITIES.some((item) => item.id === settings.city) &&
    THEMES.some((item) => item.id === settings.theme) &&
    (settings.variant === '' || VARIANTS.some((item) => item.id === settings.variant))
  function refresh() {
    const installed = current?.installed === true
    const valid = installed && settingsValid(current?.settings)
    main.hidden = confirmationAction !== null
    confirmation.hidden = confirmationAction === null
    byId('wallpaper-confirm-description').textContent = confirmationAction === 'update'
      ? t.wallpaperUpdateDescription : t.wallpaperRemoveDescription
    install.textContent = installed ? t.wallpaperUninstall : t.wallpaperInstall
    install.disabled = busy || !current || (!installed && !current.available)
    update.hidden = !installed || current?.updateAvailable !== true
    update.disabled = busy
    register.hidden = !installed || current?.registration !== 'missing'
    register.disabled = busy
    system.disabled = busy || !installed
    backups.disabled = busy
    retry.disabled = busy
    retry.hidden = current !== null && status.dataset.error !== 'true' && !(installed && (!valid || !['registered', 'missing'].includes(current?.registration)))
    close.disabled = busy
    city.disabled = theme.disabled = variant.disabled = save.disabled = busy || !installed
    confirmSystem.disabled = busy
    confirmAction.disabled = busy || !systemOpened
    confirmCancel.disabled = busy
  }
  function setCurrent(next) {
    current = next
    if (settingsValid(next?.settings)) {
      city.value = next.settings.city
      theme.value = next.settings.theme
      variant.value = next.settings.variant
      choicesInitialized = true
    } else if (next?.installed && !choicesInitialized) {
      city.value = CITIES.some((item) => item.id === 'stockholm') ? 'stockholm' : CITIES[0]?.id ?? ''
      theme.value = THEMES.some((item) => item.id === 'paper') ? 'paper' : THEMES[0]?.id ?? ''
      variant.value = ''
      choicesInitialized = true
    }
  }
  function statusMessage() {
    if (!current?.installed) return current?.available ? t.wallpaperReady : t.wallpaperUnavailable
    let result = t.wallpaperInstalledUnknown
    if (current.registration === 'missing') result = t.wallpaperRegistrationMissing
    else if (current.registration !== 'registered') result = t.wallpaperRegistrationUnknown
    if (!settingsValid(current.settings)) result += ` ${t.wallpaperSettingsUnavailable}`
    return current.updateAvailable === true ? `${t.wallpaperUpdateAvailable} ${result}` : result
  }
  async function run(action) {
    if (busy) return
    busy = true
    refresh()
    try { await action() } catch (error) {
      message(t.wallpaperError.replace('{error}', String(error)), true)
    } finally {
      busy = false
      refresh()
    }
  }
  async function reload() {
    message(t.wallpaperLoading)
    setCurrent(await invoke('wallpaper_status'))
    message(statusMessage())
  }
  button.addEventListener('click', () => {
    current = null
    choicesInitialized = false
    confirmationAction = null
    systemOpened = false
    message(t.wallpaperLoading)
    refresh()
    dialog.showModal()
    run(reload)
  })
  install.addEventListener('click', () => {
    if (current?.installed) {
      confirmationAction = 'remove'
      systemOpened = false
      refresh()
      return
    }
    run(async () => {
      setCurrent(await invoke('install_wallpaper'))
      message(statusMessage())
    })
  })
  update.addEventListener('click', () => {
    confirmationAction = 'update'
    systemOpened = false
    refresh()
  })
  register.addEventListener('click', () => run(async () => {
    setCurrent(await invoke('install_wallpaper'))
    message(statusMessage())
  }))
  save.addEventListener('click', () => {
    const settings = { city: city.value, theme: theme.value, variant: variant.value }
    run(async () => {
      setCurrent(await invoke('save_wallpaper_settings', { settings }))
      message(t.wallpaperSaved)
    })
  })
  system.addEventListener('click', () => run(async () => { await invoke('open_wallpaper_settings') }))
  backups.addEventListener('click', () => run(async () => {
    await invoke('open_wallpaper_settings', { backups: true })
    message(t.wallpaperRestoreHelp)
  }))
  retry.addEventListener('click', () => run(reload))
  confirmSystem.addEventListener('click', () => run(async () => {
    await invoke('open_wallpaper_settings')
    systemOpened = true
  }))
  confirmAction.addEventListener('click', () => run(async () => {
    const updating = confirmationAction === 'update'
    setCurrent(await invoke(updating ? 'update_wallpaper' : 'uninstall_wallpaper', { confirmedUnused: true }))
    confirmationAction = null
    systemOpened = false
    message(updating ? `${t.wallpaperUpdated} ${statusMessage()}` : t.wallpaperRemoved)
  }))
  confirmCancel.addEventListener('click', () => {
    confirmationAction = null
    systemOpened = false
    message(statusMessage())
    refresh()
  })
  close.addEventListener('click', () => dialog.close())

  // Do not expose a control in app builds that do not provide this capability.
  invoke('wallpaper_status').then((state) => {
    button.hidden = !(state?.available || state?.installed || state?.hasBackups)
  }).catch((error) => {
    // A present backend can fail temporarily. Let the user retry that case.
    const message = String(error)
    button.hidden = /(?:unknown command|command .*not found)/i.test(message)
  })
}
