// Stockholm seen from Skeppsholmen across Strömmen, looking west at Gamla stan.
// Left (south): Södermalm's heights with Katarina kyrka. Middle: Tyska kyrkan,
// Storkyrkan and Riddarholmskyrkan's iron spire. Right (north): Kungliga slottet
// on the water, with Stadshuset's tower behind it, then Kaknästornet. Skeppsbron
// quay up front, with a Djurgården tram rolling in.
// Units are centimetres behind the screen. x = 0 is the screen centre.
// Landmark sources: docs/cities/stockholm.md

import { rng } from '../random.js'

// Colours taken from photographs of Skeppsbron and Gamla stan (docs/cities/stockholm.md):
// plastered facades in ochre, yellow, rust, salmon, sand and cream under slate and
// copper roofs.
const FACADES = ['#d9a85b', '#e3bf6e', '#b9543a', '#dd9a7e', '#d8c3a0', '#ece2c8', '#c97b55', '#cdb48c']
const SLATE = '#4c5560'
const COPPER_ROOF = '#6f9e8b'
const PAPER = ['#d8c9ad', '#cdbd9f', '#e0d3ba']
const BRICK = '#a9533c'
const COPPER = '#7fae9b'
const GOLD = '#e8c15a'
const IRON = '#3e4450'
const OCHRE = '#d9a85b'
const PALACE = '#d2b88e'
const LANTERN_RED = '#b3473a'

// Skeppsbron's merchant palaces: wide, five or six storeys, slate or copper roofs
// with dormers and chimneys. Now and then a gabled house breaks the line.
function palaceRow(seed, x0, x1, hMin, hMax) {
  const r = rng(seed)
  const roofs = ['mansard', 'hip', 'bell', 'mansard', 'hip']
  const items = []
  let x = x0
  while (x < x1) {
    const gabled = r() < 0.12
    const w = gabled ? 2.4 + r() * 0.8 : 3.2 + r() * 2.6
    const h = hMin + r() * (hMax - hMin)
    const tint = FACADES[Math.floor(r() * FACADES.length)]
    items.push(
      gabled
        ? { type: 'house', x: x + w / 2, w, h: h + 0.6, roof: r() < 0.5 ? 'step' : 'gable', roofH: 2 + r(), tint }
        : {
            type: 'house',
            x: x + w / 2,
            w,
            h,
            roof: roofs[Math.floor(r() * roofs.length)],
            roofH: 1.1 + r() * 0.8,
            tint,
            roofTint: r() < 0.3 ? COPPER_ROOF : SLATE,
            dormers: Math.max(1, Math.floor(w / 1.2)),
            chimneys: [0.18 + r() * 0.15, 0.65 + r() * 0.2],
          }
    )
    x += w + 0.04
  }
  return items
}

// A symmetric outline from its right half, listed bottom to top.
// `top` is an optional run of points from right to left across the summit.
function mirrored(right, top = []) {
  const left = right
    .slice()
    .reverse()
    .map(([x, y]) => [-x, y])
  return [...right, ...top, ...left]
}

// One crown in the run right to left: band, then three points.
function crown(cx, y, w = 0.4, h = 0.42) {
  return [
    [cx + w / 2, y],
    [cx + w / 2, y + h],
    [cx + w / 4, y + h * 0.55],
    [cx, y + h * 1.05],
    [cx - w / 4, y + h * 0.55],
    [cx - w / 2, y + h],
    [cx - w / 2, y],
  ]
}

// Points along an arc, from angle a0 to a1 (radians, 0 = right).
function arc(cx, cy, radius, a0, a1, steps) {
  const out = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
  }
  return out
}

// Stadshuset (1923): a 106 m brick tower at the south-east corner, gallery,
// belfry, copper hood and a gilded spire with the Three Crowns.
function stadshuset(x) {
  const body = mirrored([
    [1.7, 0],
    [1.7, 17],
    [1.95, 17],
    [1.95, 17.6],
    [1.45, 17.6],
    [1.45, 18.1],
    [1.2, 18.1],
    [1.2, 21],
    [1.42, 21],
    [1.42, 21.4],
    [0, 21.4],
  ])
  const hood = mirrored([
    [1.42, 21.4],
    [0.95, 22.4],
    [0.55, 23],
    [0.3, 23.3],
    [0.3, 23.9],
    [0.14, 25.1],
  ])
  const crowns = [[-0.72, 25.1], [0.72, 25.1], ...crown(0.48, 25.1), ...crown(0, 25.25), ...crown(-0.48, 25.1)]
  return [
    // Main building to the north, with the small corner tower at its far end
    {
      type: 'outline',
      x,
      tint: BRICK,
      points: [
        [0, 0],
        [14, 0],
        [14, 9.5],
        [13.6, 10.6],
        [13.2, 9.5],
        [13.2, 7],
        [12.6, 8.2],
        [1.6, 8.2],
        [1.2, 7],
        [0, 7],
      ],
      grids: [{ x: 7, w: 10, y0: 1.5, y1: 6.8, opts: { gapY: 1.8, skip: 0.18 } }],
    },
    { type: 'outline', x, tint: COPPER, points: hood },
    { type: 'outline', x, tint: GOLD, points: crowns },
    {
      type: 'outline',
      x,
      tint: BRICK,
      points: body,
      grids: [{ x: 0, w: 1.3, y0: 3, y1: 16.5, opts: { ww: 0.3, wh: 1, gapX: 0.7, gapY: 2.6, skip: 0.1 } }],
      windows: [
        { x: -0.45, y: 19.5, w: 0.35, h: 1.8 },
        { x: 0.45, y: 19.5, w: 0.35, h: 1.8 },
      ],
    },
  ]
}

// Riddarholmskyrkan: brick tower under an openwork cast-iron spire (1841, after
// lightning took the old one in 1835), cut here as lace in the paper. The spire is
// down for restoration from late 2026 to 2028; the scene shows it standing.
function riddarholmskyrkan(x) {
  const baseY = 10.6
  const topY = 21.5
  const halfAt = (y) => 1.05 * (1 - (y - baseY) / (topY - baseY))
  const holes = []
  for (let y = baseY + 1; y < topY - 2.2; y += 1.45) {
    const hw = halfAt(y + 0.6) * 0.42
    holes.push([
      [0, y],
      [hw, y + 0.6],
      [0, y + 1.2],
      [-hw, y + 0.6],
    ])
  }
  return [
    // Nave, west of the tower
    {
      type: 'outline',
      x,
      tint: BRICK,
      points: [
        [-7, 0],
        [-1, 0],
        [-1, 6.4],
        [-4, 8.6],
        [-7, 6.4],
      ],
      grids: [{ x: -4, w: 4, y0: 1.5, y1: 5.5, opts: { ww: 0.4, wh: 1.4, gapX: 1.2, gapY: 3, skip: 0 } }],
    },
    {
      type: 'outline',
      x,
      tint: BRICK,
      points: mirrored([
        [1.25, 0],
        [1.25, 10],
        [1.5, 10],
        [1.5, 10.6],
        [1.45, 11.6],
        [1.3, 10.6],
        [0, baseY],
      ]),
      windows: [{ x: 0, y: 8, w: 0.5, h: 1.2 }],
    },
    {
      type: 'outline',
      x,
      tint: IRON,
      points: mirrored([
        [1.05, baseY],
        [0.06, topY],
      ]),
      holes,
    },
  ]
}

// Tyska kyrkan: the tallest spire in Gamla stan, slim and copper-clad (1886).
function tyskaKyrkan(x) {
  return [
    {
      type: 'outline',
      x,
      tint: BRICK,
      points: mirrored([
        [1.15, 0],
        [1.15, 12],
        [1.3, 12],
        [1.3, 12.4],
        [0, 12.4],
      ]),
      windows: [{ x: 0, y: 9.5, w: 0.5, h: 1.3 }],
    },
    {
      type: 'outline',
      x,
      tint: COPPER,
      points: mirrored([
        [1.3, 12.4],
        [0.85, 13.1],
        [0.85, 14],
        [0.5, 14.6],
        [0.42, 17],
        [0.2, 21.5],
        [0.04, 23.6],
      ]),
      windows: [{ x: 0, y: 13.6, w: 0.35, h: 0.5 }],
    },
  ]
}

// Storkyrkan: square baroque tower (1743) under a tall bulb lantern and a ball.
// The lantern is red again since the 2020 to 2022 restoration.
function storkyrkan(x) {
  const top = 9.4
  const cornice = top + 0.4
  return [
    {
      type: 'outline',
      x,
      tint: OCHRE,
      points: mirrored([
        [1.4, 0],
        [1.4, top],
        [1.6, top],
        [1.6, cornice],
        [1.15, cornice],
        [0, cornice],
      ]),
      grids: [{ x: 0, w: 1.6, y0: 2.4, y1: top - 0.4, opts: { ww: 0.36, wh: 1, gapX: 0.8, gapY: 2.6, skip: 0.05 } }],
    },
    {
      type: 'outline',
      x,
      tint: LANTERN_RED,
      points: mirrored([
        [1.15, cornice],
        [1.15, top + 1],
        [1.25, top + 1.6],
        [1.15, top + 2.4],
        [0.9, top + 3.3],
        [0.55, top + 4.2],
        [0.3, top + 4.7],
        [0.3, top + 5.1],
        [0.42, top + 5.3],
        [0.42, top + 5.6],
        [0.12, top + 5.8],
        [0.04, top + 7.1],
      ]),
    },
  ]
}

// Kungliga slottet: a square block on the water with corner pavilions and a
// raised centre, flat against the sky.
function slottet(x, w = 17, h = 9.4) {
  const half = w / 2
  return {
    type: 'outline',
    x,
    tint: PALACE,
    points: mirrored([
      [half, 0],
      [half, h + 0.6],
      [half - 2, h + 0.6],
      [half - 2, h],
      [1.8, h],
      [1.8, h + 0.5],
      [1.2, h + 0.5],
      [1.2, h + 0.9],
      [0, h + 0.9],
    ]),
    facade: { kind: 'palace', ground: 1.6, top: h, door: { x: x, w: 1, h: 1.4 } },
    grids: [{ x: 0, w: w - 0.6, y0: 1.2, y1: h - 0.2, opts: { ww: 0.36, wh: 0.75, gapX: 0.8, gapY: 1.8, skip: 0.04 } }],
  }
}

// Katarina kyrka (1695; burned 1723 and 1990, reopened 1995): cross church with a
// great dome and lantern on Söder's ridge, and four small corner towers round the
// drum. Two of them show from the front.
function katarinaKyrka(x) {
  const drumY = 12.2
  const dome = arc(0, drumY, 2.35, 0, Math.PI * 0.42, 8)
  return [
    {
      type: 'outline',
      x,
      tint: '#ecdcb0',
      points: mirrored([
        [3.6, 0],
        [3.6, 10.2],
        // The corner towers share this outline with the church. Separate
        // outlines left visible paper edges inside its pale facade.
        [3.17, 10.6],
        [3.17, 12.4],
        [3.3, 12.4],
        [3.3, 12.7],
        [3.07, 13.2],
        [2.87, 13.8],
        [2.78, 14.4],
        [2.72, 14.4],
        [2.63, 13.8],
        [2.43, 13.2],
        [2.2, 12.7],
        [2.2, 12.4],
        [2.3, 12.4],
        [2.3, drumY],
        ...dome,
        [0.45, 14.6],
        [0.45, 15.5],
        [0.55, 15.5],
        [0.25, 16.3],
        [0.05, 17.6],
      ]),
      windows: [
        { x: -1.2, y: 8, w: 0.45, h: 1.3 },
        { x: 1.2, y: 8, w: 0.45, h: 1.3 },
        { x: 0, y: 12.7, w: 0.4, h: 0.8 },
      ],
    },
  ]
}

// Globen (Avicii Arena, 1989): a white sphere, 85 m high and 110 m across, with
// its steel grid, on a low arena base. A ring of lights runs round it at night.
function globen(x) {
  const r = 5
  const cy = 9.2
  const base = 4.6
  // The sphere meets the base where its outline crosses the base's roof.
  const cut = Math.asin((base - cy) / r)
  const lights = []
  for (let i = -5; i <= 5; i++) lights.push({ x: (i / 5.6) * r * 0.97, y: cy - 0.5, w: 0.22, h: 0.22 })
  return [
    {
      type: 'outline',
      x,
      tint: '#d8d5cd',
      points: [
        [-5.6, 0],
        [5.6, 0],
        [5.6, base],
        [-5.6, base],
      ],
      grids: [{ x: 0, w: 10.5, y0: base - 1.6, y1: base - 0.2, opts: { ww: 0.5, wh: 0.4, gapX: 1, gapY: 0.8, skip: 0.2 } }],
    },
    {
      type: 'outline',
      x,
      tint: '#e9e9ee',
      points: arc(0, cy, r, cut, Math.PI - cut, 44),
      facade: { kind: 'globe', globe: { cy, r } },
      windows: lights,
    },
  ]
}

// Kaknästornet (1967): a 155 m concrete TV tower on Gärdet, about 170 m with its
// mast. Square shaft; the head with restaurant and antenna platforms is turned
// 45 degrees, so it reads wider than the shaft. A lattice mast on top.
function kaknastornet(x) {
  const shaft = 0.7
  const head = 1.2
  return [
    {
      type: 'outline',
      x,
      tint: '#cfcac0',
      points: mirrored([
        [shaft + 0.15, 0],
        [shaft, 1],
        [shaft, 19.6],
        // The turned head: restaurant, café and the two antenna platforms
        [head, 20.1],
        [head, 21.3],
        [head - 0.15, 21.5],
        [head, 21.7],
        [head, 22.5],
        [shaft + 0.1, 22.8],
        [shaft + 0.1, 23.3],
        [head - 0.1, 23.4],
        [head - 0.1, 23.8],
        [0.5, 24],
        // Lattice mast
        [0.22, 24],
        [0.12, 27.2],
        [0.04, 27.2],
        [0.04, 28.2],
      ]),
      windows: [
        { x: -0.75, y: 20.8, w: 0.5, h: 0.45 },
        { x: 0, y: 20.8, w: 0.5, h: 0.45 },
        { x: 0.75, y: 20.8, w: 0.5, h: 0.45 },
        { x: -0.75, y: 22.1, w: 0.5, h: 0.35 },
        { x: 0, y: 22.1, w: 0.5, h: 0.35 },
        { x: 0.75, y: 22.1, w: 0.5, h: 0.35 },
      ],
    },
  ]
}

// Hover labels: name and one line of facts, from docs/cities/stockholm.md.
const LABELS = {
  stadshuset: { name: { sv: 'Stadshuset', en: 'City Hall' }, note: { sv: '1923 · tornet 106 m', en: '1923 · tower 106 m' } },
  riddarholmskyrkan: { name: { sv: 'Riddarholmskyrkan', en: 'Riddarholmen Church' }, note: { sv: 'Gjutjärnsspiran 1841 · 91 m', en: 'Cast iron spire 1841 · 91 m' } },
  tyska: { name: { sv: 'Tyska kyrkan', en: 'German Church' }, note: { sv: 'Tornet 1886 · 96 m', en: 'Tower 1886 · 96 m' } },
  storkyrkan: { name: { sv: 'Storkyrkan', en: 'Stockholm Cathedral' }, note: { sv: 'Lanterninen 1743 · 60–66 m', en: 'Lantern 1743 · 60–66 m' } },
  slottet: { name: { sv: 'Kungliga slottet', en: 'Royal Palace' }, note: { sv: 'Inflyttat 1754', en: 'Royal home since 1754' } },
  katarina: { name: { sv: 'Katarina kyrka', en: 'Katarina Church' }, note: '1695 · 72 m' },
  globen: { name: 'Globen', note: 'Avicii Arena · 1989 · 85 m' },
  kaknas: { name: 'Kaknästornet', note: { sv: '1967 · 155 m, 170 m med masten', en: '1967 · 155 m, 170 m with the mast' } },
}
const labelled = (label, items) => [items].flat().map((item) => ({ ...item, label }))

// Distance turns paper cooler and paler, as air does to a real skyline.
const FAR = '#9ea5b8'
const MIDDLE = '#b7aea2'

export const stockholm = {
  id: 'stockholm',
  name: 'Stockholm',
  lat: 59.324,
  lon: 18.068,
  // Blue hour over Riddarfjärden: deep blue overhead, the last warm light low in the west.
  sky: { top: '#14203d', horizon: '#e3a06e', blend: [0.44, 0.64] },
  windows: { dark: '#2b3240', litShare: 0.65 },
  // The moon rises over the east, on the right, away from Globen.
  moon: [32, 40],
  light: { sky: '#b8c4e0', ground: '#3d3029', key: '#ffd2a0', keyIntensity: 2.4, keyFrom: [-40, 22, 35] },
  floor: '#d8c9ad',
  // The city stands 15 cm back, so Strömmen has room to mirror it.
  water: { color: '#4c6683', zFrom: -15, zTo: 6 },
  palette: PAPER,
  traits: { snow: true, adventStars: true, ice: true },
  layers: [
    {
      // Globen far to the south, the white sphere every Stockholm skyline drawing
      // includes. Seen from Skeppsholmen it hides behind Söder; here it rises above.
      z: -75,
      items: labelled(LABELS.globen, globen(-32)),
    },
    {
      // Kaknästornet on Gärdet, north-east behind the viewer. Drawn Stockholm
      // skylines put it in anyway, so it stands north of Stadshuset here.
      z: -72,
      items: labelled(LABELS.kaknas, kaknastornet(30)),
    },
    {
      // Södermalm's heights to the south, low Kungsholmen to the north
      z: -65,
      tint: FAR,
      items: [
        // Söder falls away to the east, towards Skanstull, where Globen shows
        { type: 'hill', x0: -62, x1: 8, heights: [5, 6, 8.5, 11, 10.4, 9, 6.5, 4.5, 3] },
        { type: 'hill', x0: 6, x1: 62, heights: [2.5, 3.6, 3, 4, 3.4, 2.8] },
        ...labelled(LABELS.katarina, katarinaKyrka(-23.5)),
      ],
    },
    {
      // Riddarholmen and Stadshuset across Riddarfjärden
      z: -53,
      items: [...labelled(LABELS.riddarholmskyrkan, riddarholmskyrkan(-3)), ...labelled(LABELS.stadshuset, stadshuset(20.5))],
    },
    {
      // Church towers over the dark band of Gamla stan's roofs
      z: -43,
      items: [...labelled(LABELS.tyska, tyskaKyrkan(-12)), ...labelled(LABELS.storkyrkan, storkyrkan(2)), ...palaceRow(11, -46, 2, 6.5, 8).map((h) => ({ ...h, tint: MIDDLE }))],
    },
    {
      // Kungliga slottet on the water, and the row behind Skeppsbron
      z: -33,
      items: [...palaceRow(21, -44, 3, 6, 7.4), ...labelled(LABELS.slottet, slottet(12))],
    },
    {
      // Skeppsbron's merchant palaces; Slottsbacken stays open
      z: -23,
      items: palaceRow(31, -42, 3, 5.2, 6.6),
    },
    {
      // Skeppsbron's granite quay
      z: -15,
      items: [
        { type: 'arcade', x0: -50, x1: 50, h: 0.7, archW: 0, tint: '#a19d95' },
        // The quay stands about 2 m over the water; lamps about 4 m, against 20 m houses
        ...[-36, -28, -20, -12, -4, 4, 12, 20, 28, 36].map((x) => ({ type: 'lamp', x, y: 0.7, h: 1.1, scale: 0.42, tint: '#2c3036' })),
      ],
      // Djurgårdslinjen's vintage trams are blue
      vehicle: { type: 'tram', y: 0.7, from: -46, to: 3, w: 7.5, h: 2.6, tint: '#2e4d7c', wheelTint: '#2a2d33' },
    },
  ],
}
