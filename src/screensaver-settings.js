export function setupScreenSaverSettings({ t }) {
  if (!window.__TAURI__?.core?.invoke) return

  const invoke = window.__TAURI__.core.invoke
  const dialog = document.getElementById('saver-settings')
  const status = document.getElementById('saver-status')
  const install = document.getElementById('saver-install')
  const reinstall = document.getElementById('saver-reinstall')
  const system = document.getElementById('saver-system')
  const close = document.getElementById('saver-close')
  let current = null
  let busy = false

  document.getElementById('saver-title').textContent = t.saverTitle
  document.getElementById('saver-description').textContent = t.saverDescription
  reinstall.textContent = t.saverReinstall
  system.textContent = t.saverSystem
  close.textContent = t.saverClose

  const message = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
  }
  function refresh() {
    install.disabled = busy || !current || (!current.available && !current.installed)
    reinstall.hidden = !current?.installed
    reinstall.disabled = busy || !current?.available
    system.disabled = busy || !current?.installed
    install.textContent = current?.installed ? t.saverUninstall : t.saverInstall
  }
  function statusMessage(state) {
    if (!state.available) return t.saverUnavailable
    if (!state.installed) return t.saverReady
    return state.matchesSource === false ? t.saverUpdateAvailable : t.saverInstalled
  }
  async function run(action) {
    busy = true
    refresh()
    try {
      await action()
    } catch (error) {
      const detail = String(error)
        .replace('LIDSCAPE_SAVER_SOURCE_UNVERIFIED', t.saverSourceUnverified)
        .replace('LIDSCAPE_SAVER_UNVERIFIED', t.saverUnverified)
        .replace('LIDSCAPE_SAVER_PARTIAL_REMOVAL', t.saverPartialRemoval)
      message(t.saverError.replace('{error}', detail), true)
    } finally {
      busy = false
      refresh()
    }
  }

  for (const button of [document.getElementById('city-saver'), document.getElementById('map-saver')]) {
    button.textContent = t.saver
    button.hidden = false
    button.addEventListener('click', () => {
      current = null
      message(t.saverLoading)
      refresh()
      dialog.showModal()
      run(async () => {
        current = await invoke('screensaver_status')
        message(statusMessage(current))
      })
    })
  }
  async function installSaver(replacing) {
    const priorMatches = current.matchesSource
    let result = await invoke('install_screensaver')
    if (replacing && priorMatches !== false) {
      current = result
      message(t.saverReinstallStarted)
      return
    }
    if (result.installationPending) {
      message(t.saverConfirm)
      for (let attempt = 0; attempt < 60 && dialog.open && !(result.installed && result.matchesSource === true); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        result = await invoke('screensaver_status')
      }
    }
    current = result
    if (result.installed && result.matchesSource === true) message(t.saverInstalled)
    else message(replacing ? t.saverUpdateNotConfirmed : t.saverNotConfirmed)
  }
  install.addEventListener('click', () => run(async () => {
    if (current.installed) {
      current = await invoke('uninstall_screensaver')
      message(t.saverRemoved)
      return
    }
    await installSaver(false)
  }))
  reinstall.addEventListener('click', () => run(() => installSaver(true)))
  system.addEventListener('click', () => run(async () => {
    await invoke('open_screensaver_settings')
    message(t.saverInstalled)
  }))
  close.addEventListener('click', () => dialog.close())
}
