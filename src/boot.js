// A setting reloads the page. Until the new scene draws its first frame, show the
// last frame and a copy of the menu that main.js saved, so the window does not go
// blank and the menu does not fold up. main.js waits for lidscapeStillShown and
// calls lidscapeReleaseStill.
// This is a classic script: it runs before the modules have loaded.
(() => {
  let still = null
  try {
    still = JSON.parse(sessionStorage.getItem('lidscape.still'))
    sessionStorage.removeItem('lidscape.still')
  } catch {}
  if (!still) return
  const added = []
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
