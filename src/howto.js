// How to use Lidscape: a window that opens the first time someone sees a theme
// or a variant. It lists the general controls and the theme's and variant's own
// lines (howTo in src/themes and src/variants). "Got it" remembers that this
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

  const help = document.getElementById('help-btn')
  help.textContent = t.help
  help.addEventListener('click', () => dialog.showModal())

  // The general controls are shown once; after that only a theme or variant
  // with lines of its own opens the window by itself.
  const seen = seenList()
  if (!seen.includes(key) && (!seen.length || own.length)) dialog.showModal()
}
