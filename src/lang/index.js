// Every language the page can show. Add a language: write src/lang/<code>.js
// and list it here. See "Add a language" in CONTRIBUTING.md.

import { sv } from './sv.js'
import { en } from './en.js'

export const LANGUAGES = { sv, en }

// Text in cities, themes and variants must exist in these.
export const BASE = ['sv', 'en']

// The first choice that is a known language, by its two-letter code. English
// when nothing matches, so a Mac in German gets English and not Swedish.
export function pickLang(...choices) {
  for (const c of choices) {
    const code = String(c ?? '').toLowerCase().slice(0, 2)
    if (code in LANGUAGES) return code
  }
  return 'en'
}

// Text in cities, themes and variants is a string (the same in every language)
// or { sv, en, ... }. A language that is missing falls back to English.
export function local(text, lang) {
  return typeof text === 'string' ? text : text?.[lang] ?? text?.en ?? ''
}
