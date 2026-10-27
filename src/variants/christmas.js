// Christmas, a variant: string lights, Christmas trees and window garlands
// everywhere; snow and advent stars only where the city has them (see
// src/traits.js). Works on any theme.

export const christmas = {
  id: 'christmas',
  name: { sv: 'Jul', en: 'Christmas' },
  effects: [
    { type: 'stringLights', colors: ['#ffd9a0', '#ffe9c4', '#ffcf87'] },
    { type: 'trees', share: 1, height: 2.4, colors: ['#ffcf87', '#ff8a6b', '#ffe9c4', '#9fd0ff'] },
    { type: 'windowGarlands', share: 0.2 },
    { type: 'windowStars', requires: 'adventStars', share: 0.09, color: '#ffd28a' },
    { type: 'snowfall', requires: 'snow', setting: 'snow' },
    { type: 'snowcaps', requires: 'snow', setting: 'snow' },
    { type: 'ice', requires: 'ice', setting: 'snow' },
  ],
  settings: [{ id: 'snow', label: { sv: 'Snö', en: 'Snow' }, min: 0, max: 1, step: 0.01, default: 0.6, requires: 'snow' }],
}
