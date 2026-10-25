// Themes: the artistic form the whole picture takes. Every theme works for
// every city. Add one: write src/themes/<id>.js and list it here; its post
// treatment uses the steps in src/post.js. See CONTRIBUTING.md.

import { paper } from './paper.js'
import { miniature } from './miniature.js'

export const THEMES = [paper, miniature]

export function findTheme(id) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
