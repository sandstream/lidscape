// Printed facades. Every card gets one canvas, an atlas, with all its facades
// painted on it: window surrounds, sills, pediments, a rusticated ground floor,
// corner quoins, doors and paper grain. Detail lives in the print, not in
// geometry, so the scene keeps its few draw calls.
//
// A region is { x0, x1, y0, y1, tint, kind, ground, windows, door }, in the
// card's centimetres. kind 'palace' gets the classical treatment; 'plain' only
// surrounds and sills; 'globe' a sphere's grid of steel, with globe: { cx, cy, r }.

import * as THREE from 'three'

const MAX_W = 4096
const MAX_H = 2048
const TARGET_PPC = 80 // pixels per centimetre

function shade(hex, amount) {
  const c = new THREE.Color(hex)
  return '#' + (amount >= 0 ? c.lerp(new THREE.Color('#ffffff'), amount) : c.lerp(new THREE.Color('#1a1410'), -amount)).getHexString()
}

export function paintFacades(regions, random) {
  const X0 = Math.min(...regions.map((r) => r.x0)) - 0.2
  const X1 = Math.max(...regions.map((r) => r.x1)) + 0.2
  const Y0 = 0
  const Y1 = Math.max(...regions.map((r) => r.y1)) + 0.2
  const ppc = Math.min(TARGET_PPC, MAX_W / (X1 - X0), MAX_H / (Y1 - Y0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((X1 - X0) * ppc)
  canvas.height = Math.ceil((Y1 - Y0) * ppc)
  const ctx = canvas.getContext('2d')
  const px = (x) => (x - X0) * ppc
  const py = (y) => (Y1 - y) * ppc
  const box = (x0, y0, x1, y1, fill) => {
    ctx.fillStyle = fill
    ctx.fillRect(px(x0), py(y1), (x1 - x0) * ppc, (y1 - y0) * ppc)
  }

  for (const r of regions) {
    const light = shade(r.tint, 0.32)
    const dark = shade(r.tint, -0.22)
    const top = r.y1

    // Base colour, a shade darker towards the street.
    const g = ctx.createLinearGradient(0, py(top), 0, py(r.y0))
    g.addColorStop(0, shade(r.tint, 0.04))
    g.addColorStop(1, shade(r.tint, -0.1))
    ctx.fillStyle = g
    ctx.fillRect(px(r.x0) - 2, py(top) - 2, (r.x1 - r.x0) * ppc + 4, (top - r.y0) * ppc + 4)

    if (r.kind === 'globe') {
      // A white sphere with its steel grid: parallels as straight lines, meridians
      // as ellipses, all clipped to the sphere, and light from the upper left.
      const { cx, cy, r: R } = r.globe
      ctx.save()
      ctx.beginPath()
      ctx.arc(px(cx), py(cy), R * ppc, 0, Math.PI * 2)
      ctx.clip()
      const shine = ctx.createRadialGradient(px(cx - R * 0.35), py(cy + R * 0.4), R * 0.1 * ppc, px(cx), py(cy), R * ppc)
      shine.addColorStop(0, '#fbfbfd')
      shine.addColorStop(1, shade(r.tint, -0.12))
      ctx.fillStyle = shine
      ctx.fillRect(px(cx - R), py(cy + R), 2 * R * ppc, 2 * R * ppc)
      ctx.strokeStyle = shade(r.tint, -0.35)
      ctx.lineWidth = Math.max(1, 0.05 * ppc)
      for (let k = -5; k <= 5; k++) {
        const y = cy + (R * k) / 6
        ctx.beginPath()
        ctx.moveTo(px(cx - R), py(y))
        ctx.lineTo(px(cx + R), py(y))
        ctx.stroke()
      }
      for (let k = 0; k < 6; k++) {
        ctx.beginPath()
        ctx.ellipse(px(cx), py(cy), Math.abs(Math.cos((k * Math.PI) / 6)) * R * ppc, R * ppc, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
      continue
    }

    if (r.kind === 'palace') {
      // Rusticated ground floor: horizontal joints in the render.
      ctx.strokeStyle = dark
      ctx.globalAlpha = 0.45
      ctx.lineWidth = Math.max(1, 0.03 * ppc)
      for (let y = 0.3; y < r.ground - 0.1; y += 0.3) {
        ctx.beginPath()
        ctx.moveTo(px(r.x0), py(y))
        ctx.lineTo(px(r.x1), py(y))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // String course over the ground floor, and quoins at the corners.
      box(r.x0, r.ground - 0.05, r.x1, r.ground + 0.07, light)
      for (let y = r.ground + 0.1; y < r.facadeTop - 0.2; y += 0.36) {
        const w = random() < 0.5 ? 0.22 : 0.15
        box(r.x0, y, r.x0 + w, y + 0.26, light)
        box(r.x1 - w, y, r.x1, y + 0.26, light)
      }
    }

    for (const w of r.windows) {
      const l = w.x - w.w / 2
      const rr = w.x + w.w / 2
      const b = w.y - w.h / 2
      const t = w.y + w.h / 2
      const ground = r.kind === 'palace' && w.y < r.ground
      // Surround and sill.
      box(l - 0.07, b - 0.05, rr + 0.07, t + 0.07, light)
      box(l - 0.12, b - 0.11, rr + 0.12, b - 0.04, light)
      if (ground) {
        // Arched shop window.
        ctx.fillStyle = light
        ctx.beginPath()
        ctx.arc(px(w.x), py(t), ((rr - l) / 2 + 0.07) * ppc, Math.PI, 0)
        ctx.fill()
      } else if (r.kind === 'palace' && w.floor === 1) {
        // Pediment over the main floor.
        ctx.fillStyle = light
        ctx.beginPath()
        ctx.moveTo(px(l - 0.14), py(t + 0.1))
        ctx.lineTo(px(rr + 0.14), py(t + 0.1))
        ctx.lineTo(px(w.x), py(t + 0.1 + w.w * 0.42))
        ctx.closePath()
        ctx.fill()
      } else if (r.kind === 'palace') {
        box(l - 0.1, t + 0.09, rr + 0.1, t + 0.15, light)
      }
      // Glass, seen when the window is dark.
      box(l, b, rr, t, '#2b3240')
    }

    if (r.door) {
      // Arched portal in dark wood with a stone surround.
      const { x, w, h } = r.door
      box(x - w / 2 - 0.1, 0, x + w / 2 + 0.1, h, light)
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.arc(px(x), py(h), (w / 2 + 0.1) * ppc, Math.PI, 0)
      ctx.fill()
      box(x - w / 2, 0, x + w / 2, h, '#4a3326')
      ctx.fillStyle = '#4a3326'
      ctx.beginPath()
      ctx.arc(px(x), py(h), (w / 2) * ppc, Math.PI, 0)
      ctx.fill()
    }
  }

  // Paper grain over everything.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = 0.93 + random() * 0.07
    d[i] *= n
    d[i + 1] *= n
    d[i + 2] *= n
  }
  ctx.putImageData(img, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  // Extruded caps carry their x and y as uv; map that onto the atlas.
  texture.repeat.set(1 / (X1 - X0), 1 / (Y1 - Y0))
  texture.offset.set(-X0 / (X1 - X0), -Y0 / (Y1 - Y0))
  return texture
}
