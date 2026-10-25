// What is true of a real city: its weather and its customs. Every city states
// each trait, with a source in docs/cities/<id>.md. Theme effects ask for a trait,
// so a theme never shows what the city does not have: no snow in Nairobi.

export const TRAITS = {
  snow: 'Snow falls and settles in winter',
  adventStars: 'Lit paper stars hang in windows in December',
}

export function allows(city, trait) {
  return !trait || city.traits?.[trait] === true
}
