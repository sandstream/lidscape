// Builds a pop-up paper city from a city definition (see src/cities/).
// Each layer is a card hinged at its bottom edge on the page. Progress 0 lies
// every card flat; progress 1 stands them all up.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from './random.js'
import { buildEffects } from './effects.js'
import { paintFacades } from './facades.js'
import { bandHeight, patchPuppet, stepSpring } from './movement.js'

const CARD_DEPTH = 0.22
const SPAN = 0.62 // share of progress each card needs to stand up
const LAYER_STAGGER = 0.045
const WINDOW_DARK = new THREE.Color('#3a3466')
const WINDOW_LIT = new THREE.Color('#ffc277').multiplyScalar(2.2)

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const ease = (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2)
const smooth = (a, b, v) => {
  const x = clamp01((v - a) / (b - a))
  return x * x * (3 - 2 * x)
}

function paperTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const r = rng(7)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 236 + r() * 19
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(0.15, 0.15)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- Silhouettes -------------------------------------------------------------

function windowGrid(windows, x, w, y0, y1, r, { ww = 0.42, wh = 0.7, gapX = 0.9, gapY = 1.5, skip = 0.12 } = {}) {
  const cols = Math.max(1, Math.floor((w - 0.5) / gapX))
  const rows = Math.max(0, Math.floor((y1 - y0) / gapY))
  const startX = x - ((cols - 1) * gapX) / 2
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (r() < skip) continue
      windows.push({ x: startX + col * gapX, y: y0 + gapY * (row + 0.5), w: ww, h: wh })
    }
  }
}

function roofPoints(shape, x0, x1, h, roof, roofH) {
  const cx = (x0 + x1) / 2
  const w = x1 - x0
  switch (roof) {
    case 'gable':
      shape.lineTo(x1, h)
      shape.lineTo(cx, h + roofH)
      shape.lineTo(x0, h)
      break
    case 'step': {
      const steps = 3
      const sw = w / 2 / (steps + 0.5)
      const sh = roofH / steps
      shape.lineTo(x1, h)
      for (let i = 0; i < steps; i++) {
        shape.lineTo(x1 - sw * i, h + sh * (i + 1))
        shape.lineTo(x1 - sw * (i + 1), h + sh * (i + 1))
      }
      shape.lineTo(x0 + sw * steps, h + roofH)
      for (let i = steps - 1; i >= 0; i--) {
        shape.lineTo(x0 + sw * (i + 1), h + sh * i)
        shape.lineTo(x0 + sw * i, h + sh * i)
      }
      break
    }
    case 'hip':
      shape.lineTo(x1, h)
      shape.lineTo(x1 - w * 0.2, h + roofH)
      shape.lineTo(x0 + w * 0.2, h + roofH)
      shape.lineTo(x0, h)
      break
    default:
      shape.lineTo(x1, h)
      shape.lineTo(x0, h)
  }
}

// Roofs drawn as their own piece of paper, in the roof's colour: copper, slate, tile.
const OWN_ROOFS = ['hip', 'mansard', 'bell']

function rect(x0, y0, x1, y1) {
  const s = new THREE.Shape()
  s.moveTo(x0, y0)
  s.lineTo(x1, y0)
  s.lineTo(x1, y1)
  s.lineTo(x0, y1)
  return s
}

function lighten(hex, amount) {
  return '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amount).getHexString()
}

// A roof piece standing on the facade at height h, overhanging it a little.
function roofPiece(x0, x1, h, roof, roofH) {
  const w = x1 - x0
  const ov = Math.min(0.12, w * 0.03)
  const s = new THREE.Shape()
  s.moveTo(x0 - ov, h)
  s.lineTo(x1 + ov, h)
  if (roof === 'hip') {
    s.lineTo(x1 - w * 0.18, h + roofH)
    s.lineTo(x0 + w * 0.18, h + roofH)
  } else if (roof === 'mansard') {
    s.lineTo(x1 - w * 0.05, h + roofH * 0.68)
    s.lineTo(x1 - w * 0.2, h + roofH)
    s.lineTo(x0 + w * 0.2, h + roofH)
    s.lineTo(x0 + w * 0.05, h + roofH * 0.68)
  } else {
    // bell: the swept Swedish roof, concave below and convex above
    s.quadraticCurveTo(x1 - w * 0.02, h + roofH * 0.25, x1 - w * 0.08, h + roofH * 0.62)
    s.quadraticCurveTo(x1 - w * 0.12, h + roofH * 0.95, x1 - w * 0.24, h + roofH)
    s.lineTo(x0 + w * 0.24, h + roofH)
    s.quadraticCurveTo(x0 + w * 0.12, h + roofH * 0.95, x0 + w * 0.08, h + roofH * 0.62)
    s.quadraticCurveTo(x0 + w * 0.02, h + roofH * 0.25, x0 - ov, h)
  }
  s.closePath()
  return s
}

// A building. Gabled houses are one piece; palaces get a roof in its own colour,
// a cornice that stands proud of the facade, dormers and chimneys. Windows sit
// in floors with a taller ground floor, never in a random grid.
function house(item, r) {
  const { x, w, h, roof = 'flat', roofH = 1.5, tint, roofTint = '#5b6470' } = item
  const x0 = x - w / 2
  const x1 = x + w / 2
  const parts = []
  const windows = []

  const palace = OWN_ROOFS.includes(roof)
  if (palace) {
    parts.push({ shape: rect(x0, 0, x1, h), facade: true })
    parts.push({ shape: roofPiece(x0, x1, h, roof, roofH), tint: roofTint })
    if (item.cornice !== false) {
      const ov = Math.min(0.12, w * 0.03)
      parts.push({ shape: rect(x0 - ov, h - 0.16, x1 + ov, h + 0.04), tint: tint && lighten(tint, 0.35), dz: 0.03 })
    }
    const dormers = item.dormers ?? 0
    for (let i = 0; i < dormers; i++) {
      const dx = x0 + (w * (i + 0.5)) / dormers
      const y0 = h + roofH * 0.12
      const dw = Math.min(0.5, (w / dormers) * 0.45)
      const d = new THREE.Shape()
      d.moveTo(dx - dw / 2, y0)
      d.lineTo(dx + dw / 2, y0)
      d.lineTo(dx + dw / 2, y0 + 0.42)
      d.quadraticCurveTo(dx + dw / 2, y0 + 0.62, dx, y0 + 0.64)
      d.quadraticCurveTo(dx - dw / 2, y0 + 0.62, dx - dw / 2, y0 + 0.42)
      parts.push({ shape: d, tint: tint && lighten(tint, 0.2), dz: 0.03 })
      windows.push({ x: dx, y: y0 + 0.26, w: dw * 0.45, h: 0.3, dz: 0.03 })
    }
    for (const cx of item.chimneys ?? []) {
      const at = x0 + w * cx
      parts.push({ shape: rect(at - 0.13, h + roofH * 0.4, at + 0.13, h + roofH + 0.55), tint: roofTint, dz: -0.04 })
    }
  } else {
    const shape = new THREE.Shape()
    shape.moveTo(x0, 0)
    shape.lineTo(x1, 0)
    roofPoints(shape, x0, x1, h, roof, roofH)
    shape.lineTo(x0, 0)
    parts.push({ shape, facade: true })
  }

  // Floors: a tall ground floor, then even storeys under the cornice.
  const floors = item.floors ?? Math.max(1, Math.round((h - 0.4) / 1.35))
  const ground = Math.min(1.7, h * 0.24)
  const storey = (h - ground - 0.35) / Math.max(1, floors - 1)
  const cols = Math.max(1, Math.floor((w - 0.45) / (item.bay ?? 0.72)))
  const pitch = (w - 0.45) / cols
  // Palaces with three bays or more get a portal in the middle bay.
  const doorCol = palace && cols >= 3 ? Math.floor(cols / 2) : -1
  const facadeWindows = []
  for (let c = 0; c < cols; c++) {
    const wx = x0 + 0.225 + pitch * (c + 0.5)
    if (c !== doorCol) facadeWindows.push({ x: wx, y: ground * 0.46, w: pitch * 0.46, h: ground * 0.5, floor: 0 })
    for (let f = 1; f < floors; f++) {
      if (r() < (item.skip ?? 0.04)) continue
      facadeWindows.push({ x: wx, y: ground + storey * (f - 0.5), w: pitch * 0.4, h: storey * 0.52, floor: f })
    }
  }
  windows.push(...facadeWindows)
  const facade = {
    x0,
    x1,
    y0: 0,
    y1: palace ? h : h + roofH,
    facadeTop: h,
    tint: tint ?? '#d8c9ad',
    kind: palace ? 'palace' : 'plain',
    ground,
    windows: facadeWindows,
    door: doorCol >= 0 ? { x: x0 + 0.225 + pitch * (doorCol + 0.5), w: pitch * 0.42, h: ground * 0.72 } : null,
  }
  return { parts, windows, facades: [facade] }
}

function tower(item, r) {
  const { x, w, h, top = 'spire', topH = 4 } = item
  const x0 = x - w / 2
  const x1 = x + w / 2
  const shape = new THREE.Shape()
  shape.moveTo(x0, 0)
  shape.lineTo(x1, 0)
  shape.lineTo(x1, h)
  if (top === 'spire') {
    shape.lineTo(x + w * 0.08, h + topH)
    shape.lineTo(x - w * 0.08, h + topH)
  } else if (top === 'dome') {
    shape.absarc(x, h, w / 2 - w * 0.05, 0, Math.PI, false)
    shape.lineTo(x - 0.15, h + w / 2)
    shape.lineTo(x, h + topH)
    shape.lineTo(x + 0.15, h + w / 2)
  } else if (top === 'cupola') {
    const cw = w * 0.32
    shape.lineTo(x + cw, h)
    shape.quadraticCurveTo(x + cw, h + topH * 0.7, x + 0.08, h + topH * 0.75)
    shape.lineTo(x, h + topH)
    shape.lineTo(x - 0.08, h + topH * 0.75)
    shape.quadraticCurveTo(x - cw, h + topH * 0.7, x - cw, h)
  } else if (top === 'crowns') {
    // Stadshuset: tapered lantern with the three crowns on the pinnacle
    const lw = w * 0.32
    shape.lineTo(x1 - w * 0.12, h + topH * 0.25)
    shape.lineTo(x + lw, h + topH * 0.25)
    shape.lineTo(x + lw, h + topH * 0.62)
    const base = h + topH * 0.86
    shape.lineTo(x + 0.6, base)
    for (const dx of [0.42, 0, -0.42]) {
      shape.lineTo(x + dx + 0.15, base)
      shape.lineTo(x + dx + 0.11, h + topH)
      shape.lineTo(x + dx - 0.11, h + topH)
      shape.lineTo(x + dx - 0.15, base)
    }
    shape.lineTo(x - 0.6, base)
    shape.lineTo(x - lw, h + topH * 0.62)
    shape.lineTo(x - lw, h + topH * 0.25)
    shape.lineTo(x0 + w * 0.12, h + topH * 0.25)
  }
  shape.lineTo(x0, h)
  shape.lineTo(x0, 0)
  const windows = []
  windowGrid(windows, x, Math.min(w, 1.4), 1.2, h - 0.6, r, { ww: 0.34, wh: 0.9, gapY: 2.1, skip: 0.05 })
  if (top === 'crowns') windows.push({ x, y: h + topH * 0.42, w: 0.5, h: 0.9 })
  return { shape, windows }
}

function hill(item, r) {
  const { x0, x1, heights } = item
  const step = (x1 - x0) / (heights.length - 1)
  const shape = new THREE.Shape()
  shape.moveTo(x0, 0)
  shape.lineTo(x0, heights[0])
  for (let i = 1; i < heights.length; i++) {
    const px = x0 + step * (i - 0.5)
    const py = (heights[i - 1] + heights[i]) / 2
    shape.quadraticCurveTo(x0 + step * (i - 1), heights[i - 1], px, py)
    shape.lineTo(x0 + step * i, heights[i])
  }
  shape.lineTo(x1, 0)
  shape.lineTo(x0, 0)
  // Windows only where the drawn ridge is high enough over them: the curve
  // dips between the given heights, so check the outline itself.
  const outline = shape.getPoints(12)
  const ridgeAt = (x) => {
    let best = 0
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1]
      const b = outline[i]
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) best = Math.max(best, a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y))
    }
    return best
  }
  const windows = []
  for (let i = 0; i < 70; i++) {
    const x = x0 + r() * (x1 - x0)
    const top = Math.min(ridgeAt(x - 0.2), ridgeAt(x + 0.2)) - 0.6
    if (top < 1.2) continue
    windows.push({ x, y: 0.8 + r() * (top - 1.2), w: 0.3, h: 0.42 })
  }
  return { shape, windows }
}

function arcade(item) {
  const { x0, x1, h, archW } = item
  const shape = new THREE.Shape()
  shape.moveTo(x0, 0)
  shape.lineTo(x1, 0)
  shape.lineTo(x1, h)
  shape.lineTo(x0, h)
  shape.lineTo(x0, 0)
  // archW 0 is a plain quay wall
  const pitch = archW * 1.45
  for (let x = x0 + pitch / 2; archW > 0 && x < x1 - pitch / 2; x += pitch) {
    const hole = new THREE.Path()
    const ah = h * 0.62
    hole.moveTo(x - archW / 2, 0.01)
    hole.lineTo(x + archW / 2, 0.01)
    hole.lineTo(x + archW / 2, ah - archW / 2)
    hole.absarc(x, ah - archW / 2, archW / 2, 0, Math.PI, false)
    hole.lineTo(x - archW / 2, 0.01)
    shape.holes.push(hole)
  }
  return { shape, windows: [] }
}

// A street lamp: post and lantern. `y` lifts it onto a quay; `scale` sizes the
// post and lantern together, so a lamp can stay in proportion to the houses.
function lamp(item) {
  const { x, h, y = 0, scale = 1 } = item
  const s = scale
  const shape = new THREE.Shape()
  shape.moveTo(x - 0.12 * s, y)
  shape.lineTo(x + 0.12 * s, y)
  shape.lineTo(x + 0.08 * s, y + h)
  shape.lineTo(x + 0.4 * s, y + h)
  shape.lineTo(x + 0.25 * s, y + h + 0.7 * s)
  shape.lineTo(x - 0.25 * s, y + h + 0.7 * s)
  shape.lineTo(x - 0.4 * s, y + h)
  shape.lineTo(x - 0.08 * s, y + h)
  shape.lineTo(x - 0.12 * s, y)
  return { shape, windows: [{ x, y: y + h + 0.3 * s, w: 0.42 * s, h: 0.42 * s }] }
}

function tram(v) {
  const { w, h } = v
  const shape = new THREE.Shape()
  const r = 0.5
  shape.moveTo(-w / 2 + 0.6, 0.35)
  shape.lineTo(w / 2 - 0.6, 0.35)
  shape.lineTo(w / 2, 0.6)
  shape.lineTo(w / 2, h - r)
  shape.quadraticCurveTo(w / 2, h, w / 2 - r, h)
  shape.lineTo(-w / 2 + r, h)
  shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r)
  shape.lineTo(-w / 2, 0.6)
  shape.lineTo(-w / 2 + 0.6, 0.35)
  // pantograph
  const panto = new THREE.Shape()
  panto.moveTo(-0.6, h - 0.05)
  panto.lineTo(0.6, h - 0.05)
  panto.lineTo(0.08, h + 1.1)
  panto.lineTo(0.7, h + 1.1)
  panto.lineTo(0.7, h + 1.2)
  panto.lineTo(-0.7, h + 1.2)
  panto.lineTo(-0.7, h + 1.1)
  panto.lineTo(-0.08, h + 1.1)
  panto.lineTo(-0.6, h - 0.05)
  const windows = []
  const count = Math.floor((w - 1.2) / 0.9)
  const start = -((count - 1) * 0.9) / 2
  for (let i = 0; i < count; i++) windows.push({ x: start + i * 0.9, y: h * 0.62, w: 0.62, h: h * 0.38 })
  return { shape: [shape, panto], windows }
}

// A hand-drawn landmark: points (and optional holes) relative to x, windows
// placed one by one or as grids.
function outline(item, r) {
  const { x = 0, points, holes = [], windows = [], grids = [] } = item
  const at = (list) => list.map(([px, py]) => new THREE.Vector2(x + px, py))
  const shape = new THREE.Shape(at(points))
  shape.holes = holes.map((hole) => new THREE.Path(at(hole)))
  const out = windows.map((w) => ({ ...w, x: x + w.x }))
  for (const g of grids) windowGrid(out, x + g.x, g.w, g.y0, g.y1, r, g.opts)
  if (!item.facade) return { shape, windows: out }
  // A printed facade over the outline's bounding box; floors from the window rows.
  const xs = points.map((p) => x + p[0])
  const ys = points.map((p) => p[1])
  const rows = [...new Set(out.map((w) => w.y.toFixed(2)))].sort((a, b) => a - b)
  const top = item.facade.top ?? Math.max(...ys)
  return {
    parts: [{ shape, facade: true }],
    windows: out,
    facades: [
      {
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: 0,
        y1: Math.max(...ys),
        facadeTop: top,
        tint: item.tint,
        kind: item.facade.kind ?? 'palace',
        globe: item.facade.globe && { ...item.facade.globe, cx: x },
        ground: item.facade.ground ?? 1.6,
        windows: out.map((w) => ({ ...w, floor: rows.indexOf(w.y.toFixed(2)) })),
        door: item.facade.door ?? null,
      },
    ],
  }
}

const FACADE = 'facade'

// An extruded card holds its faces (group 0) and its cut edges (group 1). Split
// them so the edges can show the paper's core and the faces the print.
function splitCapsSides(geo) {
  const out = { caps: [], sides: [] }
  for (const g of geo.groups) out[g.materialIndex === 0 ? 'caps' : 'sides'].push(g)
  const take = (groups) => {
    const part = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv', 'puppet']) {
      const a = geo.attributes[name]
      if (!a) continue
      const size = a.itemSize
      const count = groups.reduce((n, g) => n + g.count, 0)
      const arr = new Float32Array(count * size)
      let o = 0
      for (const g of groups) {
        arr.set(a.array.subarray(g.start * size, (g.start + g.count) * size), o)
        o += g.count * size
      }
      part.setAttribute(name, new THREE.BufferAttribute(arr, size))
    }
    return part
  }
  return { caps: take(out.caps), sides: take(out.sides) }
}

const BUILDERS = { house, tower, hill, arcade, lamp, outline }

// Drop repeated and collinear points. Either one yields zero-area triangles,
// whose zero normals turn into NaN in lighting and black out the bloom pass.
function cleanPoints(points) {
  let out = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4)
  while (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-4) out.pop()
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    out = out.filter((p, i, arr) => {
      const a = arr[(i - 1 + arr.length) % arr.length]
      const b = arr[(i + 1) % arr.length]
      // Compare the sine of the turn, not the raw cross product: rounding on
      // longer edges leaves a cross product above any fixed tolerance.
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)
      if (Math.abs(cross) > 1e-5 * p.distanceTo(a) * b.distanceTo(p)) return true
      changed = true
      return false
    })
  }
  return out
}

function clean(shape) {
  const result = new THREE.Shape(cleanPoints(shape.getPoints(16)))
  result.holes = shape.holes.map((hole) => new THREE.Path(cleanPoints(hole.getPoints(16))))
  return result
}

function extrude(shapes, label = 'shape') {
  const list = (Array.isArray(shapes) ? shapes : [shapes]).map(clean)
  const geo = new THREE.ExtrudeGeometry(list, { depth: CARD_DEPTH, bevelEnabled: false })
  repairNormals(geo, label)
  return geo
}

// A zero normal turns into NaN in lighting and flashes the bloom pass black.
// Triangulation makes them from corners that lie on one line without being
// neighbours, as the inner corners of a stepped gable do. Such a triangle has no
// area, so it is safe to point its normal out of the card face it lies in.
// Anything else is a broken shape: say which, so it is found in the console.
function repairNormals(geo, label) {
  const n = geo.attributes.normal.array
  const p = geo.attributes.position.array
  for (let i = 0; i < n.length; i += 3) {
    if (Math.hypot(n[i], n[i + 1], n[i + 2]) >= 0.5) continue
    const z = p[i + 2]
    if (Math.abs(z) < 1e-4 || Math.abs(z - CARD_DEPTH) < 1e-4) {
      n[i] = 0
      n[i + 1] = 0
      n[i + 2] = z > CARD_DEPTH / 2 ? 1 : -1
    } else {
      console.error(`Lidscape: ${label} has a zero normal on its side wall and will flicker black`)
      return
    }
  }
  geo.attributes.normal.needsUpdate = true
}

// Push puppet: every vertex of an item learns its bead size and its centre
// (src/movement.js). A spire or a crown on top of a tower is an item of its
// own: it moves with the item its foot stands on. Low, wide items (hills,
// quays, the palace) stand still: as beads they turn into long poles.
function setPuppetAnchors(items3d, card) {
  for (const it of items3d) {
    it.box = new THREE.Box3()
    for (const { geo } of it.built3d) {
      geo.computeBoundingBox()
      it.box.union(geo.boundingBox)
    }
  }
  const grounded = items3d.filter((it) => it.box.min.y <= 0.3)
  for (const it of grounded) {
    const { min, max } = it.box
    const wide = it.item.type === 'hill' || max.x - min.x > max.y * 1.25
    it.anchor = [(min.x + max.x) / 2, wide ? 0 : bandHeight(max.y), (it.itemIndex + card) % 2, card]
  }
  for (const it of items3d) {
    if (!it.anchor) {
      const { min, max } = it.box
      const cx = (min.x + max.x) / 2
      const under = grounded.filter((g) => g.box.min.x <= cx && cx <= g.box.max.x)
      under.sort((a, b) => Math.abs(a.box.max.y - min.y) - Math.abs(b.box.max.y - min.y))
      it.anchor = under[0]?.anchor ?? [cx, bandHeight(max.y), (it.itemIndex + card) % 2, card]
    }
    for (const { geo } of it.built3d) {
      const n = geo.attributes.position.count
      const arr = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) arr.set(it.anchor, i * 4)
      geo.setAttribute('puppet', new THREE.BufferAttribute(arr, 4))
    }
  }
}

// --- Scene -------------------------------------------------------------------

// litShare is the part of the windows that are lit with the lights fully on.
function windowMesh(windows, z, r, dark = WINDOW_DARK, litShare = 1) {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false })
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, windows.length))
  mesh.count = windows.length
  const m = new THREE.Matrix4()
  windows.forEach((win, i) => {
    m.makeScale(win.w, win.h, 1).setPosition(win.x, win.y, z + (win.dz ?? 0))
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, dark)
  })
  const thresholds = windows.map(() => 0.05 + (r() * 0.9) / litShare)
  const flicker = windows.map(() => r() * Math.PI * 2)
  return { mesh, thresholds, flicker }
}

export function buildCity(def, scene, floorY, { variant = null, settings = {}, movement = 'popup', reduceMotion = false } = {}) {
  const puppet = movement === 'puppet'
  // One slack value per card for the push puppet shader (src/movement.js).
  const slack = { value: new Array(16).fill(0) }
  const bend = (material) => (puppet ? patchPuppet(material, slack) : material)
  const r = rng(def.id.length * 131)
  const edgeShade = (tint) => '#' + new THREE.Color(tint).multiplyScalar(def.edgeShade ?? 0.78).getHexString()
  const windowDark = new THREE.Color(def.windows?.dark ?? WINDOW_DARK)
  const litShare = def.windows?.litShare ?? 1
  // Where the sky turns from horizon colour to top colour, in the sky plane's height.
  const blend = def.sky.blend ?? [0.42, 0.85]
  const tex = paperTexture()
  const materials = new Map()
  const paper = (tint) => {
    if (!materials.has(tint)) {
      materials.set(tint, bend(new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95, metalness: 0, map: tex })))
    }
    return materials.get(tint)
  }

  const root = new THREE.Group()
  root.position.y = floorY
  scene.add(root)

  // Sky
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 160),
    new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(def.sky.top) }, horizon: { value: new THREE.Color(def.sky.horizon) }, alpha: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform float alpha; varying float vY; void main(){ gl_FragColor = vec4(mix(horizon, top, smoothstep(${blend[0].toFixed(3)}, ${blend[1].toFixed(3)}, vY)), alpha); }`,
      transparent: true,
      depthWrite: false,
    })
  )
  sky.position.set(0, 0, -120)
  root.add(sky)

  // Stars and moon
  const starGeo = new THREE.BufferGeometry()
  const starPos = []
  for (let i = 0; i < 420; i++) starPos.push((r() - 0.5) * 220, 18 + r() * 60, -110)
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  const starMat = new THREE.PointsMaterial({ color: '#fff6e6', size: 0.55, transparent: true, opacity: 0, toneMapped: false })
  root.add(new THREE.Points(starGeo, starMat))

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 48),
    new THREE.MeshBasicMaterial({ color: '#fff3dd', transparent: true, opacity: 0, toneMapped: false })
  )
  moon.position.set(...(def.moon ?? [-38, 44]), -108)
  root.add(moon)

  // Page (floor) and water
  const floorMaterial = paper(def.floor).clone()
  floorMaterial.transparent = true
  floorMaterial.depthWrite = false
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 140), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.z = -60
  floor.receiveShadow = true
  root.add(floor)

  const waterDepth = def.water.zTo - def.water.zFrom
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(240, waterDepth),
    new THREE.MeshStandardMaterial({ color: def.water.color, roughness: 0.7, metalness: 0, transparent: true, depthWrite: false })
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(0, 0.01, def.water.zFrom + waterDepth / 2)
  water.receiveShadow = true
  root.add(water)

  // The city mirrored in the water. renderReflection() flips the whole city in
  // the water plane and draws it with the real camera into a texture; the water
  // then reads that texture at its own screen position. Unlike three's
  // Reflector, which turns its camera upside down and so breaks the off-axis
  // frustum, this stays right however far the head moves. Small moving ripples
  // break it up; the water's own colour shows through. Slow Macs keep the flat
  // water (setReflections).
  const reflection = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(240, waterDepth),
    new THREE.ShaderMaterial({
      ...WATER_SHADER,
      uniforms: THREE.UniformsUtils.clone(WATER_SHADER.uniforms),
    })
  )
  mirror.material.uniforms.tReflection.value = reflection.texture
  mirror.material.uniforms.water.value = new THREE.Color(def.water.color)
  mirror.material.uniforms.span.value.set(def.water.zFrom, def.water.zTo)
  mirror.rotation.x = -Math.PI / 2
  mirror.position.set(0, 0.015, def.water.zFrom + waterDepth / 2)
  root.add(mirror)

  // Reflections: warm streaks on the water
  const streakMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb46a').multiplyScalar(1.4),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  // Light on the water: thin broken streaks that shimmer, as lit windows make on
  // a dark harbour.
  const streaks = []
  for (let i = 0; i < 90; i++) {
    const len = 0.4 + r() * 1.8
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.05 + r() * 0.1, len), streakMat)
    s.rotation.x = -Math.PI / 2
    s.position.set((r() - 0.5) * 70, 0.02, def.water.zFrom + 0.6 + r() * (waterDepth - 2))
    root.add(s)
    streaks.push({ mesh: s, phase: r() * Math.PI * 2, speed: 1.5 + r() * 2 })
  }

  // Shadows of the push puppet follow its pose.
  const depth = puppet ? patchPuppet(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), slack) : null

  // Cards
  const layers = def.layers.map((layerDef, index) => {
    const pivot = new THREE.Group()
    pivot.position.z = layerDef.z
    root.add(pivot)

    const windows = []
    const shapes = []
    const pieces = new Map()
    const regions = []
    // Cut edges in a darker shade of their own paper: a white core read as
    // bright lines flickering round dark roofs.
    const edges = new Map()
    const hits = []
    // Each item on a card stands a hair in front of the one before it. Shapes
    // that overlap on a card would otherwise lie in one plane and flicker as
    // the card turns, letting a house behind show through one in front.
    const ITEM_STEP = 0.004
    const items3d = []
    for (const [itemIndex, item] of layerDef.items.entries()) {
      const itemDz = itemIndex * ITEM_STEP
      const built = BUILDERS[item.type](item, r)
      const parts = built.parts ?? [{ shape: built.shape }]
      const tint = item.tint || layerDef.tint || def.palette[Math.floor(r() * def.palette.length)]
      const label = `${def.id} z=${layerDef.z} ${item.type} at x=${item.x ?? item.x0}`
      const built3d = parts.map((part) => {
        const list = Array.isArray(part.shape) ? part.shape : [part.shape]
        if (!part.dz || part.dz <= 0) {
          shapes.push(...list)
          for (const sh of list) hits.push({ pts: sh.getPoints(8), label: item.label ?? null })
        }
        const geo = extrude(list, label)
        geo.translate(0, 0, itemDz + (part.dz ?? 0))
        return { part, geo }
      })
      items3d.push({ item, itemIndex, built, built3d, tint })
      if (built.facades) regions.push(...built.facades.map((f) => ({ ...f, tint: f.tint ?? tint })))
      windows.push(...built.windows.map((w) => ({ ...w, dz: (w.dz ?? 0) + itemDz })))
    }
    if (puppet) setPuppetAnchors(items3d, index)
    for (const { built, built3d, tint } of items3d) {
      for (const { part, geo } of built3d) {
        const key = part.facade && built.facades ? FACADE : part.tint || tint
        const { caps, sides } = splitCapsSides(geo)
        if (!pieces.has(key)) pieces.set(key, [])
        pieces.get(key).push(caps)
        const edgeKey = part.tint || tint
        if (!edges.has(edgeKey)) edges.set(edgeKey, [])
        edges.get(edgeKey).push(sides)
      }
    }
    // One mesh per colour per card keeps draw calls low however much detail there
    // is: the facades share one printed atlas, the card edges one paper core.
    const atlas = regions.length
      ? bend(new THREE.MeshStandardMaterial({ map: paintFacades(regions, r), roughness: 0.95, metalness: 0 }))
      : null
    for (const [key, geos] of pieces) {
      const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], key === FACADE ? atlas : paper(key))
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (puppet) mesh.customDepthMaterial = depth
      pivot.add(mesh)
    }
    for (const [key, geos] of edges) {
      const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], paper(edgeShade(key)))
      mesh.castShadow = true
      if (puppet) mesh.customDepthMaterial = depth
      pivot.add(mesh)
    }
    const win = windowMesh(windows, CARD_DEPTH + 0.015, r, windowDark, litShare)
    pivot.add(win.mesh)

    let vehicle = null
    if (layerDef.vehicle) {
      const v = layerDef.vehicle
      const { shape, windows: vw } = tram(v)
      const group = new THREE.Group()
      const body = new THREE.Mesh(
        extrude(shape, `${def.id} vehicle`),
        paper(v.tint ?? '#efe7f6')
      )
      body.castShadow = true
      group.add(body)
      for (const wx of [-v.w / 2 + 1.3, v.w / 2 - 1.3]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, CARD_DEPTH, 20), paper(v.wheelTint ?? '#b9b0df'))
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(wx, 0.38, CARD_DEPTH / 2 + 0.05)
        group.add(wheel)
      }
      const vwin = windowMesh(vw, CARD_DEPTH + 0.015, r)
      vwin.thresholds.fill(0)
      group.add(vwin.mesh)
      group.position.set(v.from, v.y, 0.3)
      group.visible = false
      pivot.add(group)
      vehicle = { def: v, group, win: vwin }
    }

    return { def: layerDef, pivot, shapes, hits, windows, delay: index * LAYER_STAGGER, win, vehicle, string: { x: 0, v: 0 } }
  })

  const glow = new THREE.PointLight('#ffb067', 0, 60, 1.5)
  glow.position.set(0, 7, def.water.zFrom + 2)
  root.add(glow)

  const updateEffects = buildEffects(variant, def, {
    root,
    layers,
    floor,
    paper,
    cardDepth: CARD_DEPTH,
    water: mirror.material.uniforms,
    random: rng(def.id.length * 977),
    setting: (id, fallback) => settings[id] ?? fallback,
  })

  const tmp = new THREE.Color()
  let flight = 0
  function setFlightProgress(value) {
    flight = clamp01(value)
    sky.material.uniforms.alpha.value = 1 - flight
    floor.material.opacity = 1 - flight
    water.material.opacity = 1 - flight
  }
  function paintWindows(win, level, time) {
    for (let i = 0; i < win.thresholds.length; i++) {
      const th = win.thresholds[i]
      const lit = smooth(th, th + 0.08, level) * (0.92 + 0.08 * Math.sin(time * 2.3 + win.flicker[i]))
      tmp.copy(windowDark).lerp(WINDOW_LIT, lit)
      win.mesh.setColorAt(i, tmp)
    }
    if (win.mesh.instanceColor) win.mesh.instanceColor.needsUpdate = true
  }

  let lastTime = null
  function update(progress, lights, time) {
    const lightLevel = lights * clamp01((progress - 0.45) / 0.45)
    const dt = lastTime === null ? 1 : Math.max(0, time - lastTime)
    lastTime = time

    for (const [index, layer] of layers.entries()) {
      const lp = ease(clamp01((progress - layer.delay) / SPAN))
      if (puppet) {
        // The lid is the button: the cards stand, and the string tension
        // follows the lid. The windows show only on a standing figure, as
        // they do not bend with it.
        stepSpring(layer.string, lp, dt, reduceMotion)
        slack.value[index] = Math.min(1.2, Math.max(-0.25, 1 - layer.string.x))
        layer.win.mesh.visible = Math.abs(slack.value[index]) < 0.03
      } else {
        layer.pivot.rotation.x = -(1 - lp) * Math.PI / 2
      }
      paintWindows(layer.win, lightLevel, time)

      if (layer.vehicle) {
        const { def: v, group, win } = layer.vehicle
        const tp = clamp01((progress - 0.72) / 0.28)
        const eased = 1 - Math.pow(1 - tp, 3)
        group.visible = tp > 0
        group.position.x = v.from + (v.to - v.from) * eased
        paintWindows(win, lights * tp, time)
      }
    }

    const night = clamp01((progress - 0.25) / 0.5)
    starMat.opacity = night * (1 - flight)
    moon.material.opacity = night * (1 - flight)
    streakMat.opacity = lightLevel * 0.35 * (1 - flight)
    glow.intensity = lightLevel * 6
    mirror.material.uniforms.time.value = time
    for (const st of streaks) st.mesh.scale.x = 0.5 + 0.5 * Math.sin(time * st.speed + st.phase) ** 2
    updateEffects({ progress, lights, lightLevel, time })
  }

  // What the ray hits first, card by card from the front: a landmark's label, or
  // null when an ordinary building is in the way.
  const front = [...layers].sort((a, b) => b.def.z - a.def.z)
  const inv = new THREE.Matrix4()
  const ray = new THREE.Ray()
  function pick(worldRay) {
    for (const layer of front) {
      inv.copy(layer.pivot.matrixWorld).invert()
      ray.copy(worldRay).applyMatrix4(inv)
      if (Math.abs(ray.direction.z) < 1e-6) continue
      const t = (CARD_DEPTH - ray.origin.z) / ray.direction.z
      if (t < 0) continue
      const p = ray.at(t, new THREE.Vector3())
      if (p.y < 0) continue
      for (const h of layer.hits) if (insidePolygon(p, h.pts)) return h.label
    }
    return null
  }

  function setReflections(on) {
    mirror.visible = on
  }

  // Draws the mirrored city into the reflection texture. Call before the frame,
  // with the frame's camera. The city is flipped in place at the water line, so
  // everything it animates stays in step, then put back.
  const notMirrored = [floor, water, mirror, ...streaks.map((s) => s.mesh)]
  const size = new THREE.Vector2()
  function renderReflection(renderer, camera) {
    if (!mirror.visible) return
    renderer.getDrawingBufferSize(size)
    const w = Math.max(1, Math.round(size.x / 2))
    const h = Math.max(1, Math.round(size.y / 2))
    if (reflection.width !== w || reflection.height !== h) reflection.setSize(w, h)
    mirror.material.uniforms.resolution.value.copy(size)

    const shown = notMirrored.map((o) => o.visible)
    notMirrored.forEach((o) => (o.visible = false))
    root.scale.y = -1
    root.updateMatrixWorld(true)
    const autoShadows = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    const target = renderer.getRenderTarget()
    renderer.setRenderTarget(reflection)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(target)
    renderer.shadowMap.autoUpdate = autoShadows
    root.scale.y = 1
    root.updateMatrixWorld(true)
    notMirrored.forEach((o, i) => (o.visible = shown[i]))
  }

  return { root, update, pick, setReflections, setFlightProgress, renderReflection }
}

// Water: the mirrored city read at the fragment's own screen position, shifted
// by long slow swells and softened with three taps, mixed with the water's
// colour and fading towards the viewer. Output stays linear; the composer's
// output pass maps tone and colour space.
const WATER_SHADER = {
  name: 'LidscapeWater',
  uniforms: {
    tReflection: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    water: { value: null },
    span: { value: new THREE.Vector2(-8, 6) },
    time: { value: 0 },
    ice: { value: 0 },
  },
  vertexShader: `
    varying vec3 vWorld;
    varying vec3 vLocal;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vLocal = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tReflection;
    uniform vec2 resolution;
    uniform vec3 water;
    uniform vec2 span;
    uniform float time;
    uniform float ice;
    varying vec3 vWorld;
    varying vec3 vLocal;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    void main() {
      // Depth along the water, 0 at the quay and 1 at the viewer.
      float near = clamp((-vLocal.y + (span.y - span.x) * 0.5) / (span.y - span.x), 0.0, 1.0);
      // Far water is seen almost edge-on, so the same swell packs into a few
      // pixels there: calm it with distance or it reads as a zigzag.
      float wave = sin(vWorld.z * 0.7 + time * 0.9) * 0.5 + sin(vWorld.x * 0.3 + vWorld.z * 1.1 - time * 0.7) * 0.5;
      vec2 uv = gl_FragCoord.xy / resolution;
      uv.x += wave * 0.004 * (0.15 + 0.85 * near * near);
      vec2 dy = vec2(0.0, 0.003);
      vec3 mirrored = (texture2D(tReflection, uv).rgb + texture2D(tReflection, uv + dy).rgb + texture2D(tReflection, uv - dy).rgb) / 3.0;
      vec3 col = mix(water, mirrored * 0.72, 0.62 - near * 0.25);
      if (ice > 0.0) {
        // Floes: broken noise, more of it along the quay; cracks where floes meet.
        vec2 p = vWorld.xz * vec2(0.45, 0.9);
        float n = noise(p) * 0.6 + noise(p * 2.3 + 7.0) * 0.3 + noise(p * 6.0) * 0.1;
        float edge = 1.0 - near;
        float cover = ice * 1.05 + edge * edge * ice * 0.5;
        float threshold = 1.0 - cover;
        float floe = smoothstep(threshold - 0.015, threshold + 0.015, n);
        float crack = 1.0 - smoothstep(0.0, 0.02, abs(n - threshold - 0.06)) * 0.5;
        vec3 iceCol = mix(vec3(0.42, 0.46, 0.52), vec3(0.58, 0.62, 0.68), noise(p * 3.0)) * crack;
        iceCol += mirrored * 0.12;
        col = mix(col, iceCol, floe);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
}

function insidePolygon(pt, pts) {
  let hit = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}
