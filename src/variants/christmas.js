// Christmas, a variant: string lights on the quay everywhere, snow and advent
// stars only where the city has them (see src/traits.js). Works on any theme.

export const christmas = {
  id: 'christmas',
  name: 'Jul',
  effects: [
    { type: 'stringLights', colors: ['#ffd9a0', '#ffe9c4', '#ffcf87'] },
    { type: 'windowStars', requires: 'adventStars', share: 0.09, color: '#ffd28a' },
    { type: 'snowfall', requires: 'snow', setting: 'snow' },
    { type: 'snowcaps', requires: 'snow', setting: 'snow' },
  ],
  settings: [{ id: 'snow', label: 'Snö', min: 0, max: 1, step: 0.01, default: 0.6, requires: 'snow' }],
}
