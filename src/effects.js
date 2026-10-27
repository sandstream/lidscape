// Variant effects (see src/variants/). Each builder gets the built city and returns
// an update function. Effects on a card are added to its pivot, so they fold with
// it; weather lives in the space between the cards, so it follows the parallax.

import * as THREE from 'three'
import { allows } from './traits.js'

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const DARK = new THREE.Color('#3a3466')

function discTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// Snow falling through the whole depth of the scene, from the far hills to just
// behind the glass.
function snowfall(fx, ctx) {
  const COUNT = 2600
  const BOX = { x: 56, yTop: 48, zFar: -80, zNear: -1 }
  const r = ctx.random
  const pos = new Float32Array(COUNT * 3)
  const flake = []
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (r() - 0.5) * 2 * BOX.x
    pos[i * 3 + 1] = r() * BOX.yTop
    pos[i * 3 + 2] = BOX.zFar + r() * (BOX.zNear - BOX.zFar)
    flake.push({ speed: 1.6 + r() * 2.2, sway: 0.4 + r() * 0.8, phase: r() * Math.PI * 2 })
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.6,
    map: discTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  ctx.root.add(points)

  let last = null
  return ({ progress, time }) => {
    const amount = ctx.setting(fx.setting, 1)
    const dt = last == null ? 0 : Math.min(time - last, 0.1)
    last = time
    geo.setDrawRange(0, Math.round(COUNT * amount))
    mat.opacity = clamp01((progress - 0.3) / 0.4)
    for (let i = 0; i < COUNT; i++) {
      const f = flake[i]
      let y = pos[i * 3 + 1] - f.speed * dt
      if (y < 0) y += BOX.yTop
      pos[i * 3 + 1] = y
      pos[i * 3] += Math.sin(time * 0.9 + f.phase) * f.sway * dt
    }
    geo.attributes.position.needsUpdate = true
  }
}

function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function inside(pt, pts) {
  let hit = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

// Snow lying on every roof, ledge and dome that is flat enough to hold it. Edges
// hidden behind another shape on the same card get none. The setting decides
// how much: a dusting at the low end, thick cover that also holds on steeper
// roofs at the high end, and the ground and quay whiten with it.
function snowcaps(fx, ctx) {
  const mat = ctx.paper('#fbfaff').clone()
  const ground = ctx.floor.material.clone()
  const groundBase = ground.color.clone()
  const groundSnow = new THREE.Color('#f1effa')
  ctx.floor.material = ground

  // Every edge that faces up, once; the amount picks which ones hold snow.
  const cards = ctx.layers.map((layer) => {
    const outlines = layer.shapes.map((s) => s.getPoints(16))
    const edges = []
    outlines.forEach((pts, si) => {
      const ccw = signedArea(pts) > 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const up = ccw ? -dx : dx
        if (up <= 0 || Math.abs(dx) < 0.05) continue
        const slope = Math.abs(dy) / Math.abs(dx)
        if (slope > 1.4) continue
        const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.1)
        if (outlines.some((other, oi) => oi !== si && inside(mid, other))) continue
        edges.push({ l: a.x < b.x ? a : b, r: a.x < b.x ? b : a, slope })
      }
    })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    mesh.receiveShadow = true
    layer.pivot.add(mesh)
    return { edges, mesh }
  })

  function build(amount) {
    const thick = 0.04 + 0.42 * amount
    const maxSlope = 0.5 + 0.9 * amount
    for (const card of cards) {
      const caps = []
      for (const { l, r, slope } of card.edges) {
        if (slope > maxSlope) continue
        const inset = Math.min(0.12, (r.x - l.x) * 0.2)
        const cap = new THREE.Shape()
        cap.moveTo(l.x - 0.04, l.y - 0.04)
        cap.lineTo(r.x + 0.04, r.y - 0.04)
        cap.lineTo(r.x - inset, r.y + thick)
        cap.lineTo(l.x + inset, l.y + thick)
        caps.push(cap)
      }
      card.mesh.geometry.dispose()
      if (!caps.length) {
        card.mesh.geometry = new THREE.BufferGeometry()
        continue
      }
      // Deep enough to cover the small step each item stands in front of the last.
      const geo = new THREE.ExtrudeGeometry(caps, { depth: ctx.cardDepth + 0.3, bevelEnabled: false })
      geo.translate(0, 0, -0.04)
      card.mesh.geometry = geo
    }
  }

  let built = -1
  return () => {
    const amount = ctx.setting(fx.setting, 1)
    mat.visible = amount > 0.01
    if (mat.visible && Math.abs(amount - built) > 0.02) {
      build(amount)
      built = amount
    }
    ground.color.copy(groundBase).lerp(groundSnow, Math.min(1, amount * 0.9))
  }
}

// Warm bulbs hung in scallops along the top of every quay arcade.
function stringLights(fx, ctx) {
  const SPACING = 0.75
  const SAG = 0.45
  const bulbs = []
  for (const layer of ctx.layers) {
    for (const item of layer.def.items) {
      if (item.type !== 'arcade') continue
      const span = item.archW > 0 ? item.archW * 1.45 : 3.2
      for (let x = item.x0 + 0.4; x < item.x1 - 0.4; x += SPACING) {
        const t = (((x - item.x0) % span) + span) % span / span
        bulbs.push({ pivot: layer.pivot, x, y: item.h - 0.12 - SAG * Math.sin(Math.PI * t) })
      }
    }
  }
  if (!bulbs.length) return () => {}

  const geo = new THREE.CircleGeometry(0.1, 10)
  const groups = new Map()
  for (const b of bulbs) {
    if (!groups.has(b.pivot)) groups.set(b.pivot, [])
    groups.get(b.pivot).push(b)
  }
  const meshes = []
  const tmp = new THREE.Color()
  const m = new THREE.Matrix4()
  for (const [pivot, list] of groups) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), list.length)
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(b.x, b.y, ctx.cardDepth + 0.03))
      mesh.setColorAt(i, DARK)
    })
    pivot.add(mesh)
    meshes.push({ mesh, list, phase: list.map(() => ctx.random() * Math.PI * 2) })
  }

  return ({ lightLevel, time }) => {
    for (const { mesh, list, phase } of meshes) {
      for (let i = 0; i < list.length; i++) {
        const twinkle = 0.8 + 0.2 * Math.sin(time * 3 + phase[i])
        tmp.set(fx.colors[i % fx.colors.length]).multiplyScalar(2.4 * lightLevel * twinkle)
        mesh.setColorAt(i, tmp.lerp(DARK, 1 - lightLevel))
      }
      mesh.instanceColor.needsUpdate = true
    }
  }
}

function starShape(radius) {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 ? radius * 0.45 : radius
    const p = [Math.cos(a) * rad, Math.sin(a) * rad]
    if (i === 0) s.moveTo(...p)
    else s.lineTo(...p)
  }
  return s
}

// Advent stars: a lit paper star in a share of the windows.
function windowStars(fx, ctx) {
  // The window behind the star goes dim, so the star reads as a shape of light.
  const backing = new THREE.MeshBasicMaterial({ color: '#4a3b5e', transparent: true, opacity: 0 })
  const mat = new THREE.MeshBasicMaterial({ color: fx.color, toneMapped: false, transparent: true, opacity: 0 })
  const base = new THREE.Color(fx.color)
  const pane = new THREE.PlaneGeometry(1, 1)
  for (const layer of ctx.layers) {
    for (const w of layer.windows) {
      if (w.w < 0.3 || w.h < 0.5 || ctx.random() > fx.share) continue
      const back = new THREE.Mesh(pane, backing)
      back.scale.set(w.w, w.h, 1)
      back.position.set(w.x, w.y, ctx.cardDepth + 0.025 + (w.dz ?? 0))
      const star = new THREE.Mesh(new THREE.ShapeGeometry(starShape(Math.min(w.w, w.h) * 0.62)), mat)
      star.position.set(w.x, w.y, ctx.cardDepth + 0.035 + (w.dz ?? 0))
      layer.pivot.add(back, star)
    }
  }
  return ({ lightLevel }) => {
    backing.opacity = lightLevel * 0.85
    mat.opacity = lightLevel
    mat.color.copy(base).multiplyScalar(1 + 2.2 * lightLevel)
  }
}

// Ice on the water, as cold as the snow is deep: open water with a little snow,
// floes along the quay with more, most of the water frozen with a lot. The water
// shader draws the floes and their cracks.
function ice(fx, ctx) {
  return () => {
    const amount = ctx.setting(fx.setting, 1)
    ctx.water.ice.value = clamp01((amount - 0.25) / 0.75)
  }
}

// Christmas trees on the quay: paper trees between the lamps, with twinkling
// bulbs and a star. Where a quay has no lamps, they stand at an even spacing.
function trees(fx, ctx) {
  const H = fx.height ?? 1.3
  const W = H * 0.62
  const spots = []
  for (const layer of ctx.layers) {
    for (const item of layer.def.items) {
      if (item.type !== 'arcade') continue
      const lamps = layer.def.items.filter((it) => it.type === 'lamp' && it.x > item.x0 && it.x < item.x1).map((it) => it.x).sort((a, b) => a - b)
      const xs = lamps.length > 1 ? lamps.slice(1).map((x, i) => (x + lamps[i]) / 2) : []
      if (!xs.length) for (let x = item.x0 + 4; x < item.x1 - 4; x += 8) xs.push(x)
      for (const x of xs) if (ctx.random() < (fx.share ?? 0.6)) spots.push({ layer, x, y: item.h })
    }
  }
  if (!spots.length) return () => {}

  // Three tiers and a trunk, drawn once around x = 0 and moved into place.
  const shape = new THREE.Shape()
  const tiers = [[0, 0.42], [0.3, 0.34], [0.58, 0.25]]
  shape.moveTo(-0.05 * W, 0)
  shape.lineTo(0.05 * W, 0)
  shape.lineTo(0.05 * W, 0.12 * H)
  for (const [y, half] of tiers) {
    shape.lineTo(half * W * 2 * 0.5 + 0.0, 0.12 * H + y * H)
    shape.lineTo(0.06 * W, 0.12 * H + (y + 0.24) * H)
  }
  shape.lineTo(0, H)
  for (const [y, half] of [...tiers].reverse()) {
    shape.lineTo(-0.06 * W, 0.12 * H + (y + 0.24) * H)
    shape.lineTo(-half * W, 0.12 * H + y * H)
  }
  shape.lineTo(-0.05 * W, 0.12 * H)
  shape.lineTo(-0.05 * W, 0)
  const treeGeo = new THREE.ExtrudeGeometry(shape, { depth: ctx.cardDepth, bevelEnabled: false })
  // A little of its own green, so the tree reads as green and not grey at night.
  const treeMat = new THREE.MeshStandardMaterial({ color: fx.color ?? '#1d6b3a', emissive: fx.color ?? '#1d6b3a', emissiveIntensity: 0.35, roughness: 0.95, metalness: 0 })
  const starMat = new THREE.MeshBasicMaterial({ color: fx.star ?? '#ffd28a', toneMapped: false, transparent: true, opacity: 0 })
  const starGeo = new THREE.ShapeGeometry(starShape(0.13 * H))
  const starBase = new THREE.Color(fx.star ?? '#ffd28a')

  const bulbGeo = new THREE.CircleGeometry(0.035 * H, 8)
  const bulbs = []
  const m = new THREE.Matrix4()
  for (const spot of spots) {
    const tree = new THREE.Mesh(treeGeo, treeMat)
    tree.position.set(spot.x, spot.y, 0)
    const star = new THREE.Mesh(starGeo, starMat)
    star.position.set(spot.x, spot.y + H, ctx.cardDepth + 0.03)
    spot.layer.pivot.add(tree, star)
    // Bulbs in rows across each tier, narrower towards the top.
    for (const [y, half] of tiers) {
      for (let row = 0; row < 2; row++) {
        const by = 0.12 * H + (y + 0.06 + row * 0.1) * H
        const span = half * W * (1 - row * 0.45 - 0.2)
        for (let i = -1; i <= 1; i++) bulbs.push({ pivot: spot.layer.pivot, x: spot.x + i * span * 0.8, y: spot.y + by })
      }
    }
  }
  const groups = new Map()
  for (const b of bulbs) {
    if (!groups.has(b.pivot)) groups.set(b.pivot, [])
    groups.get(b.pivot).push(b)
  }
  const meshes = []
  for (const [pivot, list] of groups) {
    const mesh = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), list.length)
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(b.x, b.y, ctx.cardDepth + 0.03))
      mesh.setColorAt(i, DARK)
    })
    pivot.add(mesh)
    meshes.push({ mesh, list, phase: list.map(() => ctx.random() * Math.PI * 2) })
  }

  const tmp = new THREE.Color()
  return ({ lightLevel, time }) => {
    starMat.opacity = lightLevel
    starMat.color.copy(starBase).multiplyScalar(1 + 2 * lightLevel)
    for (const { mesh, list, phase } of meshes) {
      for (let i = 0; i < list.length; i++) {
        const twinkle = 0.7 + 0.3 * Math.sin(time * 2.2 + phase[i])
        tmp.set(fx.colors[i % fx.colors.length]).multiplyScalar(2.2 * lightLevel * twinkle)
        mesh.setColorAt(i, tmp.lerp(DARK, 1 - lightLevel))
      }
      mesh.instanceColor.needsUpdate = true
    }
  }
}

// A green garland hung in a curve across the top of a share of the windows,
// with a few small bulbs.
function windowGarlands(fx, ctx) {
  const mat = new THREE.MeshStandardMaterial({ color: fx.color ?? '#3f7a4f', roughness: 0.95, metalness: 0 })
  const bulbMat = new THREE.MeshBasicMaterial({ color: fx.bulb ?? '#ffcf87', toneMapped: false, transparent: true, opacity: 0 })
  const bulbBase = new THREE.Color(fx.bulb ?? '#ffcf87')
  for (const layer of ctx.layers) {
    for (const w of layer.windows) {
      if (w.w < 0.3 || w.h < 0.4 || ctx.random() > fx.share) continue
      const z = ctx.cardDepth + 0.03 + (w.dz ?? 0)
      const top = w.y + w.h / 2
      const sag = Math.min(w.h * 0.25, w.w * 0.4)
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(w.x - w.w / 2, top, z),
        new THREE.Vector3(w.x, top - sag * 2, z),
        new THREE.Vector3(w.x + w.w / 2, top, z),
      )
      const garland = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, Math.max(0.035, w.w * 0.11), 6), mat)
      layer.pivot.add(garland)
      for (const t of [0.2, 0.5, 0.8]) {
        const bulb = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.025, w.w * 0.08), 8), bulbMat)
        bulb.position.copy(curve.getPoint(t)).setZ(z + 0.03)
        layer.pivot.add(bulb)
      }
    }
  }
  return ({ lightLevel }) => {
    bulbMat.opacity = lightLevel
    bulbMat.color.copy(bulbBase).multiplyScalar(1 + 2 * lightLevel)
  }
}

const EFFECTS = { snowfall, snowcaps, stringLights, windowStars, ice, trees, windowGarlands }
export const EFFECT_TYPES = Object.keys(EFFECTS)

// Builds the variant's effects that this city allows, and returns one update.
export function buildEffects(variant, city, ctx) {
  if (!variant) return () => {}
  const updates = variant.effects
    .filter((fx) => allows(city, fx.requires))
    .map((fx) => EFFECTS[fx.type](fx, ctx))
  return (state) => updates.forEach((u) => u(state))
}
