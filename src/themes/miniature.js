// Miniature: tilt-shift, as in photos that make a real city look like a model.
// One band is sharp and the rest blurs away above and below it; colours are
// stronger and the corners darker.
export const miniature = {
  id: 'miniature',
  name: { sv: 'Miniatyr', en: 'Miniature' },
  post: {
    tiltShift: { setting: 'focus', blur: 7, passes: 2 },
    grade: { saturation: 1.22, contrast: 1.1, vignette: 0.35 },
  },
  settings: [{ id: 'focus', label: { sv: 'Skärpa i höjdled', en: 'Sharp band height' }, min: 0.15, max: 0.75, step: 0.01, default: 0.3 }],
}
