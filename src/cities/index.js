// Every city the page can show. Add a city: write src/cities/<id>.js and list it
// here. See CONTRIBUTING.md.

import { stockholm } from './stockholm.js'

export const CITIES = [stockholm]

export function findCity(id) {
  return CITIES.find((c) => c.id === id) ?? CITIES[0]
}
