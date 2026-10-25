// Builds a pop-up paper city from a city definition (see src/cities/).
// Each layer is a card hinged at its bottom edge on the page. Progress 0 lies
// every card flat; progress 1 stands them all up.

import * as THREE from 'three'
import { rng } from './random.js'

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

function house(item, r) {
  const { x, w, h, roof = 'flat', roofH = 1.5 } = item
  const x0 = x - w / 2
  const x1 = x + w / 2
  const shape = new THREE.Shape()
  shape.moveTo(x0, 0)
  shape.lineTo(x1, 0)
  roofPoints(shape, x0, x1, h, roof, roofH)
  shape.lineTo(x0, 0)
  const windows = []
  windowGrid(windows, x, w, 0.9, h - 0.4, r)
  return { shape, windows }
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
  const windows = []
  for (let i = 0; i < 70; i++) {
    const t = r()
    const idx = t * (heights.length - 1)
    const hy = heights[Math.floor(idx)] * 0.85
    windows.push({ x: x0 + t * (x1 - x0), y: 0.8 + r() * (hy - 1.2), w: 0.3, h: 0.42 })
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
  const pitch = archW * 1.45
  for (let x = x0 + pitch / 2; x < x1 - pitch / 2; x += pitch) {
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

function lamp(item) {
  const { x, h } = item
  const shape = new THREE.Shape()
  shape.moveTo(x - 0.12, 0)
  shape.lineTo(x + 0.12, 0)
  shape.lineTo(x + 0.08, h)
  shape.lineTo(x + 0.4, h)
  shape.lineTo(x + 0.25, h + 0.7)
  shape.lineTo(x - 0.25, h + 0.7)
  shape.lineTo(x - 0.4, h)
  shape.lineTo(x - 0.08, h)
  shape.lineTo(x - 0.12, 0)
  return { shape, windows: [{ x, y: h + 0.3, w: 0.42, h: 0.42 }] }
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

const BUILDERS = { house, tower, hill, arcade, lamp }

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
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)
      if (Math.abs(cross) > 1e-6) return true
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

function extrude(shapes) {
  const list = (Array.isArray(shapes) ? shapes : [shapes]).map(clean)
  return new THREE.ExtrudeGeometry(list, { depth: CARD_DEPTH, bevelEnabled: false })
}

// --- Scene -------------------------------------------------------------------

function windowMesh(windows, z, r) {
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false })
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, windows.length))
  mesh.count = windows.length
  const m = new THREE.Matrix4()
  windows.forEach((win, i) => {
    m.makeScale(win.w, win.h, 1).setPosition(win.x, win.y, z)
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, WINDOW_DARK)
  })
  const thresholds = windows.map(() => 0.05 + r() * 0.9)
  const flicker = windows.map(() => r() * Math.PI * 2)
  return { mesh, thresholds, flicker }
}

export function buildCity(def, scene, floorY) {
  const r = rng(def.id.length * 131)
  const tex = paperTexture()
  const materials = new Map()
  const paper = (tint) => {
    if (!materials.has(tint)) {
      materials.set(tint, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95, metalness: 0, map: tex }))
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
      uniforms: { top: { value: new THREE.Color(def.sky.top) }, horizon: { value: new THREE.Color(def.sky.horizon) } },
      vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float vY; void main(){ gl_FragColor = vec4(mix(horizon, top, smoothstep(0.42, 0.85, vY)), 1.0); }',
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
  moon.position.set(-38, 44, -108)
  root.add(moon)

  // Page (floor) and water
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 140), paper(def.floor))
  floor.rotation.x = -Math.PI / 2
  floor.position.z = -60
  floor.receiveShadow = true
  root.add(floor)

  const waterDepth = def.water.zTo - def.water.zFrom
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(240, waterDepth),
    new THREE.MeshStandardMaterial({ color: def.water.color, roughness: 0.7, metalness: 0 })
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(0, 0.01, def.water.zFrom + waterDepth / 2)
  water.receiveShadow = true
  root.add(water)

  // Reflections: warm streaks on the water
  const streakMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb46a').multiplyScalar(1.4),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  for (let i = 0; i < 26; i++) {
    const len = 1.2 + r() * 3.5
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.35 + r() * 0.5, len), streakMat)
    s.rotation.x = -Math.PI / 2
    s.position.set((r() - 0.5) * 70, 0.02, def.water.zFrom + 0.6 + r() * (waterDepth - 2))
    root.add(s)
  }

  // Cards
  const layers = def.layers.map((layerDef, index) => {
    const pivot = new THREE.Group()
    pivot.position.z = layerDef.z
    root.add(pivot)

    const windows = []
    for (const item of layerDef.items) {
      const { shape, windows: w } = BUILDERS[item.type](item, r)
      const geo = extrude(shape)
      const tint = item.tint || layerDef.tint || def.palette[Math.floor(r() * def.palette.length)]
      const mesh = new THREE.Mesh(geo, paper(tint))
      mesh.castShadow = true
      mesh.receiveShadow = true
      pivot.add(mesh)
      windows.push(...w)
    }
    const win = windowMesh(windows, CARD_DEPTH + 0.015, r)
    pivot.add(win.mesh)

    let vehicle = null
    if (layerDef.vehicle) {
      const v = layerDef.vehicle
      const { shape, windows: vw } = tram(v)
      const group = new THREE.Group()
      const body = new THREE.Mesh(
        extrude(shape),
        paper('#efe7f6')
      )
      body.castShadow = true
      group.add(body)
      for (const wx of [-v.w / 2 + 1.3, v.w / 2 - 1.3]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, CARD_DEPTH, 20), paper('#b9b0df'))
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

    return { pivot, delay: index * LAYER_STAGGER, win, vehicle }
  })

  const glow = new THREE.PointLight('#ffb067', 0, 60, 1.5)
  glow.position.set(0, 7, -6)
  root.add(glow)

  const tmp = new THREE.Color()
  function paintWindows(win, level, time) {
    for (let i = 0; i < win.thresholds.length; i++) {
      const th = win.thresholds[i]
      const lit = smooth(th, th + 0.08, level) * (0.92 + 0.08 * Math.sin(time * 2.3 + win.flicker[i]))
      tmp.copy(WINDOW_DARK).lerp(WINDOW_LIT, lit)
      win.mesh.setColorAt(i, tmp)
    }
    if (win.mesh.instanceColor) win.mesh.instanceColor.needsUpdate = true
  }

  function update(progress, lights, time) {
    const lightLevel = lights * clamp01((progress - 0.45) / 0.45)

    for (const layer of layers) {
      const lp = ease(clamp01((progress - layer.delay) / SPAN))
      layer.pivot.rotation.x = -(1 - lp) * Math.PI / 2
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
    starMat.opacity = night
    moon.material.opacity = night
    streakMat.opacity = lightLevel * 0.35
    glow.intensity = lightLevel * 6
  }

  return { update }
}
