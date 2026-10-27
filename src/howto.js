// How to use Lidscape: a window that opens the first time someone sees a theme
// or a variant. It lists the general controls and the theme's and variant's own
// lines (howTo in src/themes and src/variants). The i in the top left corner
// opens a second window about the app. "Got it" remembers that this
// theme and variant have been seen; the Help button opens the window again.

import { local } from './lang/index.js'

const SEEN_ITEM = 'lidscape.howto'

function seenList() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_ITEM)) ?? []
  } catch {
    return []
  }
}

export function setupHowTo({ t, lang, theme, variant }) {
  const dialog = document.getElementById('howto')
  const list = dialog.querySelector('ul')
  const own = [theme, variant].filter((x) => x?.howTo)
  const key = [theme.id, variant?.id].filter(Boolean).join('+')

  dialog.querySelector('h2').textContent = t.howToTitle
  const item = (s, heading) => {
    const li = document.createElement('li')
    if (heading) li.className = 'own'
    li.textContent = s
    return li
  }
  list.replaceChildren(
    // The theme's and variant's own lines first: they are what is new.
    ...own.flatMap((x) => x.howTo.map((line) => item(`${local(x.name, lang)}: ${local(line, lang)}`, true))),
    item(t.howToLid),
    item(t.howToPointer),
    item(t.howToCamera),
  )
  const ok = dialog.querySelector('button')
  ok.textContent = t.howToOk
  ok.addEventListener('click', () => {
    const seen = seenList()
    if (!seen.includes(key)) seen.push(key)
    try {
      localStorage.setItem(SEEN_ITEM, JSON.stringify(seen))
    } catch {}
    dialog.close()
  })

  // About, behind the i in the top left corner: what Lidscape is, how to add
  // to it, and how to build your own.
  const about = document.getElementById('about')
  about.querySelector('h2').textContent = t.aboutTitle
  about.querySelector('.about-text').textContent = t.aboutText
  about.querySelector('.about-contribute span').textContent = t.aboutContribute
  about.querySelector('.about-contribute a').textContent = t.aboutContributeLink
  about.querySelector('.about-build').textContent = t.aboutBuild
  about.querySelector('.about-source').textContent = t.aboutSource
  // In the Mac app a link would replace the picture in the window, so the app
  // opens it in the browser instead.
  const tauri = window.__TAURI__
  if (tauri) {
    for (const a of about.querySelectorAll('a')) {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        tauri.core.invoke('open_link', { url: a.href }).catch(() => {})
      })
    }
    tauri.app
      ?.getVersion()
      .then((v) => (about.querySelector('.about-version').textContent = t.aboutVersion.replace('{version}', v)))
      .catch(() => {})
  }

  const aboutBtn = document.getElementById('about-btn')
  aboutBtn.setAttribute('aria-label', t.aboutTitle)
  aboutBtn.title = t.aboutTitle
  aboutBtn.classList.toggle('in-app', !!tauri)
  aboutBtn.addEventListener('click', () => about.showModal())
  const close = about.querySelector(':scope > button')
  close.textContent = t.close
  close.addEventListener('click', () => about.close())

  const help = document.getElementById('help-btn')
  help.textContent = t.help
  help.addEventListener('click', () => dialog.showModal())

  // The general controls are shown once; after that only a theme or variant
  // with lines of its own opens the window by itself.
  const seen = seenList()
  if (!seen.includes(key) && (!seen.length || own.length)) dialog.showModal()
}
