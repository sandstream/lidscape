export function setupScreenSaverSettings({ t }) {
  if (!window.__TAURI__?.core?.invoke) return

  const invoke = window.__TAURI__.core.invoke
  const dialog = document.getElementById('saver-settings')
  const status = document.getElementById('saver-status')
  const install = document.getElementById('saver-install')
  const system = document.getElementById('saver-system')
  const close = document.getElementById('saver-close')
  let current = null
  let busy = false

  document.getElementById('saver-title').textContent = t.saverTitle
  document.getElementById('saver-description').textContent = t.saverDescription
  system.textContent = t.saverSystem
  close.textContent = t.saverClose

  const message = (text, error = false) => {
    status.textContent = text
    status.dataset.error = String(error)
  }
  function refresh() {
    install.disabled = busy || !current || (!current.available && !current.installed)
    system.disabled = busy || !current?.installed
    install.textContent = current?.installed ? t.saverUninstall : t.saverInstall
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
        message(!current.available ? t.saverUnavailable : current.installed ? t.saverInstalled : t.saverReady)
      })
    })
  }
  install.addEventListener('click', () => run(async () => {
    if (current.installed) {
      current = await invoke('uninstall_screensaver')
      message(t.saverRemoved)
      return
    }
    let result = await invoke('install_screensaver')
    if (result.installationPending) {
      message(t.saverConfirm)
      for (let attempt = 0; attempt < 60 && dialog.open && !result.installed; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        result = await invoke('screensaver_status')
      }
    }
    current = result
    message(result.installed ? t.saverInstalled : t.saverNotInstalled)
  }))
  system.addEventListener('click', () => run(async () => {
    await invoke('open_screensaver_settings')
    message(t.saverInstalled)
  }))
  close.addEventListener('click', () => dialog.close())
}
