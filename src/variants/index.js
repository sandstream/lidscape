// Variants: an occasion laid over any theme, such as Christmas. Add one: write
// src/variants/<id>.js and list it here. See CONTRIBUTING.md.

import { christmas } from './christmas.js'

export const VARIANTS = [christmas]

export function findVariant(id) {
  return VARIANTS.find((v) => v.id === id) ?? null
}
