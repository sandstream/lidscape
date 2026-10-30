// Monet: impressionism, as in Claude Monet's paintings of water lilies and of
// the Houses of Parliament in fog. Dabs of colour replace hard edges. When the
// lid closes, the strokes grow and a lilac haze rises, like dusk on the Thames.
// Monet died in 1926; his works and his name are free to use.
export const monet = {
  id: 'monet',
  name: { sv: 'Monet', en: 'Monet' },
  post: {
    paint: { setting: 'strokes', radius: 4, haze: 0.18, hazeColour: [0.74, 0.7, 0.86] },
    grade: { saturation: 1.15, contrast: 0.94, vignette: 0.2 },
  },
  howTo: [
    {
      sv: 'Stäng locket långsamt: penseldragen blir större och bilden försvinner i skymningsdis.',
      en: 'Close the lid slowly: the brush strokes grow and the picture fades into dusk haze.',
    },
  ],
  settings: [{ id: 'strokes', label: { sv: 'Penseldrag', en: 'Brush strokes' }, min: 0.5, max: 2, step: 0.05, default: 1 }],
}
