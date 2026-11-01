// A setting reloads the page. Until the new scene draws its first frame, show the
// last frame and a copy of the menu that main.js saved, so the window does not go
// blank and the menu does not fold up. main.js waits for lidscapeStillShown and
// calls lidscapeReleaseStill.
// This is a classic script: it runs before the modules have loaded.
(() => {
  let still = null
  let started = false
  window.lidscapeMarkReady = () => {
    started = true
    clearTimeout(startupTimeout)
    document.getElementById('load-error')?.remove()
    document.documentElement.classList.remove('load-failed')
    window.lidscapeMarkReady = undefined
  }
  function messages() {
    let storedLang
    try { storedLang = localStorage.getItem('lidscape.lang') } catch {}
    const choices = [new URLSearchParams(location.search).get('lang'), storedLang, window.lidscapeMacLanguage, ...(navigator.languages ?? [navigator.language])]
    const lang = choices.map((value) => String(value ?? '').toLowerCase().slice(0, 2)).find((value) => value === 'sv' || value === 'en') ?? 'en'
    return lang === 'sv'
      ? { error: 'Lidscape kunde inte laddas. Försök igen.', retry: 'Försök igen', loading: 'Lidscape laddar.' }
      : { error: 'Lidscape could not load. Try again.', retry: 'Try again', loading: 'Lidscape is loading.' }
  }
  function showLoadError() {
    if (started || document.getElementById('no-webgl')) return
    if (document.getElementById('load-error')) return
    const text = messages()
    const panel = document.createElement('div')
    panel.id = 'load-error'
    panel.setAttribute('role', 'alert')
    const message = document.createElement('p')
    message.textContent = text.error
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = text.retry
    retry.addEventListener('click', () => {
      if (still) {
        try { sessionStorage.setItem('lidscape.still', JSON.stringify(still)) } catch {}
      }
      location.reload()
    })
    panel.append(message, retry)
    document.getElementById('still-hud')?.remove()
    document.getElementById('reload-status')?.remove()
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close()
    document.documentElement.classList.add('load-failed')
    document.body.append(panel)
    retry.focus()
  }
  window.addEventListener('error', (event) => {
    const mainScript = event.target?.tagName === 'SCRIPT' && event.target.getAttribute('src') === 'src/main.js'
    if (mainScript || event.target === window) showLoadError()
  }, true)
  window.addEventListener('unhandledrejection', showLoadError)
  // A module can remain pending without sending an error event.
  const startupTimeout = setTimeout(showLoadError, 30000)
  try {
    still = JSON.parse(sessionStorage.getItem('lidscape.still'))
    sessionStorage.removeItem('lidscape.still')
  } catch {}
  if (!still) return
  const added = []
  const status = document.createElement('p')
  status.id = 'reload-status'
  status.setAttribute('role', 'status')
  status.textContent = messages().loading
  added.push(status)
  if (typeof still.image === 'string' && still.image.startsWith('data:image/')) {
    const image = document.createElement('img')
    image.id = 'still'
    image.alt = ''
    image.src = still.image
    added.push(image)
    // main.js waits for this before it builds the scene. Building blocks the page
    // for seconds on a Mac, and the frame must be on screen before that starts.
    window.lidscapeStillShown = new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        resolve()
      }
      // A hidden web view may suspend animation frames. Keep startup bounded.
      const timeout = setTimeout(finish, 1000)
      image.decode().catch(() => {}).then(() => {
        if (!finished) requestAnimationFrame(() => {
          if (!finished) setTimeout(finish)
        })
      })
    })
  }
  if (typeof still.hud === 'string') {
    // The copy keeps its ids inside a shadow root, so they do not clash with the
    // real menu that main.js fills.
    const host = document.createElement('div')
    host.id = 'still-hud'
    host.inert = true
    host.setAttribute('aria-hidden', 'true')
    const shadow = host.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync([...document.styleSheets].flatMap((s) => [...s.cssRules]).map((r) => r.cssText).join('\n'))
    shadow.adoptedStyleSheets = [sheet]
    shadow.innerHTML = still.hud
    added.push(host)
  }
  document.getElementById('scene').after(...added)
  document.documentElement.classList.add('reloading')
  window.lidscapeReleaseStill = () => {
    for (const element of added) element.remove()
    document.documentElement.classList.remove('reloading')
    window.lidscapeReleaseStill = undefined
  }
})()
