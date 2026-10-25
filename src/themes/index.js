// Every theme the page can show. Add a theme: write src/themes/<id>.js and list
// it here. See CONTRIBUTING.md.

import { christmas } from './christmas.js'

export const THEMES = [christmas]

export function findTheme(id) {
  return THEMES.find((t) => t.id === id) ?? null
}
