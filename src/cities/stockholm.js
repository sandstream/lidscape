// Stockholm seen from the water: Södermalm on the hill, Stadshuset and
// Riddarholmen to the left, Slottet and Gamla stan in the middle, Skeppsbron
// quay up front with a Djurgården tram rolling in.
// Units are centimetres behind the screen. x = 0 is the screen centre.

import { rng } from '../random.js'

const OLD_TOWN = ['#f2e2cf', '#ecd6c8', '#e6dcf3', '#f4e6d8', '#eadff0']
const PAPER = ['#e7e1f7', '#ddd5f3', '#ebe3f2', '#d8d0f0']

function oldTownRow(seed, x0, x1, hMin, hMax, gap) {
  const r = rng(seed)
  const roofs = ['gable', 'step', 'hip', 'gable', 'flat']
  const items = []
  let x = x0
  while (x < x1) {
    const w = 2.3 + r() * 1.4
    const cx = x + w / 2
    if (!gap || cx < gap[0] || cx > gap[1]) {
      items.push({
        type: 'house',
        x: cx,
        w,
        h: hMin + r() * (hMax - hMin),
        roof: roofs[Math.floor(r() * roofs.length)],
        roofH: 1 + r() * 1.4,
        tint: OLD_TOWN[Math.floor(r() * OLD_TOWN.length)],
      })
    }
    x += w + 0.05
  }
  return items
}

export const stockholm = {
  id: 'stockholm',
  name: 'Stockholm',
  sky: { top: '#1d1940', horizon: '#7a6cc2' },
  floor: '#cfc6ee',
  water: { color: '#8b7fca', zFrom: -8, zTo: 6 },
  palette: PAPER,
  layers: [
    {
      // Södermalm ridge with Katarina kyrka
      z: -54,
      items: [
        { type: 'hill', x0: -50, x1: 50, heights: [5, 7, 6.2, 8.5, 7.4, 9, 8.2, 6.4, 7.2, 5.4, 6] },
        { type: 'tower', x: 11, w: 4.2, h: 9.5, top: 'dome', topH: 4.4 },
      ],
    },
    {
      // Stadshuset, Riddarholmskyrkan, Tyska kyrkan
      z: -42,
      items: [
        { type: 'house', x: -21, w: 15, h: 7, roof: 'flat' },
        { type: 'tower', x: -14.5, w: 3.6, h: 19, top: 'crowns', topH: 4.5 },
        { type: 'house', x: -3.5, w: 5.5, h: 7, roof: 'gable', roofH: 2 },
        { type: 'tower', x: -4, w: 2.2, h: 10, top: 'spire', topH: 9.5 },
        { type: 'tower', x: 16, w: 2.4, h: 11, top: 'spire', topH: 8 },
      ],
    },
    {
      // Kungliga slottet and Storkyrkan
      z: -32,
      items: [
        { type: 'house', x: 6, w: 21, h: 8.5, roof: 'flat', tint: '#efe4d6' },
        { type: 'tower', x: -7, w: 2.8, h: 13, top: 'cupola', topH: 4 },
        ...oldTownRow(11, -40, -9, 5, 8),
        ...oldTownRow(12, 17.5, 40, 5, 8),
      ],
    },
    {
      // Gamla stan, back row
      z: -22,
      items: oldTownRow(21, -42, 42, 6.5, 10),
    },
    {
      // Gamla stan, front row around Börshuset
      z: -14,
      items: [
        ...oldTownRow(31, -40, 40, 4, 6.5, [-6, 6]),
        { type: 'house', x: 0, w: 10, h: 5.5, roof: 'hip', roofH: 1.4, tint: '#f4e8da' },
        { type: 'tower', x: 0, w: 1.6, h: 7, top: 'cupola', topH: 2 },
      ],
    },
    {
      // Skeppsbron quay
      z: -8,
      items: [{ type: 'arcade', x0: -50, x1: 50, h: 3.2, archW: 2.2 }],
      vehicle: { type: 'tram', y: 3.2, from: -46, to: 3, w: 7.5, h: 2.6 },
    },
    {
      // Street lamps on the waterfront
      z: -3,
      items: [-26, -13, 13, 26].map((x) => ({ type: 'lamp', x, h: 4.6 })),
    },
  ],
}
