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
  howTo: [
    {
      sv: 'Det skarpa bandet följer muspekaren. Peka högt eller lågt i bilden för att flytta skärpan.',
      en: 'The sharp band follows the pointer. Point high or low in the picture to move the focus.',
    },
    {
      sv: 'När muspekaren lämnar bilden håller reglaget Skärpa i höjdled bandet på plats.',
      en: 'When the pointer leaves the picture, the slider Sharp band height holds the band in place.',
    },
  ],
  settings: [{ id: 'focus', label: { sv: 'Skärpa i höjdled', en: 'Sharp band height' }, min: 0.15, max: 0.75, step: 0.01, default: 0.3 }],
}
