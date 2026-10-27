// Tells the viewer of the Mac app when a newer Lidscape is on GitHub, as Lyssna
// does. The app asks GitHub at start and once a day; the page only shows the
// answer. In a browser there is no app to update, and nothing shows.

const CHECK_ITEM = 'lidscape.updates'
const LATER_ITEM = 'lidscape.updateLater'
const DAY_MS = 24 * 60 * 60 * 1000

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

export function watchUpdates({ t, hud }) {
  const invoke = window.__TAURI__?.core?.invoke
  if (!invoke) return

  const notice = document.getElementById('hud-update')
  const text = notice.querySelector('span')
  const [download, later] = notice.querySelectorAll('button')
  const toggle = document.getElementById('update-check')
  const box = toggle.querySelector('input')

  download.textContent = t.updateDownload
  later.textContent = t.updateLater
  toggle.querySelector('span').textContent = t.updateCheck
  toggle.title = t.updateInfo
  toggle.hidden = false
  box.checked = read(CHECK_ITEM) !== 'off'

  let found = null
  function show() {
    // "Later" hides one version; the next version shows again.
    notice.hidden = !found || !box.checked || read(LATER_ITEM) === found.version
    if (notice.hidden) return
    text.textContent = t.updateAvailable.replace('{version}', found.version)
    hud.classList.remove('idle')
  }

  async function check() {
    if (!box.checked) return
    try {
      found = await invoke('check_update')
    } catch {
      found = null
    }
    show()
  }

  download.addEventListener('click', () => found && invoke('open_link', { url: found.url }).catch(() => {}))
  later.addEventListener('click', () => {
    if (found) write(LATER_ITEM, found.version)
    show()
  })
  box.addEventListener('change', () => {
    write(CHECK_ITEM, box.checked ? null : 'off')
    if (box.checked) check()
    else show()
  })

  check()
  setInterval(check, DAY_MS)
}
