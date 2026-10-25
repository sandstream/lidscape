// Checks every city, theme and variant before it reaches the page:
//   node tools/check-cities.mjs
// It runs in CI on each pull request. It does not render; open the page for that.

import { readdirSync, existsSync } from 'node:fs'
import { CITIES } from '../src/cities/index.js'
import { THEMES } from '../src/themes/index.js'
import { VARIANTS } from '../src/variants/index.js'
import { TRAITS } from '../src/traits.js'

// Keep in step with BUILDERS in src/city.js.
const ITEM_TYPES = ['house', 'tower', 'hill', 'arcade', 'lamp', 'outline']
// Keep in step with EFFECTS in src/effects.js and POST_STEPS in src/post.js.
const POST_STEPS = ['tiltShift', 'grade']
const EFFECT_TYPES = ['snowfall', 'snowcaps', 'stringLights', 'windowStars', 'ice']
const HEX = /^#[0-9a-f]{6}$/i
const errors = []
const fail = (where, msg) => errors.push(`${where}: ${msg}`)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

const files = readdirSync(new URL('../src/cities/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js')
const ids = CITIES.map((c) => c.id)
for (const f of files) {
  if (!ids.includes(f.replace(/\.js$/, ''))) fail(f, 'file is not listed in src/cities/index.js')
}

const seen = new Set()
for (const city of CITIES) {
  const at = city.id ?? '(no id)'
  if (!/^[a-z0-9-]+$/.test(city.id ?? '')) fail(at, 'id must be lower case letters, digits and hyphens')
  if (seen.has(city.id)) fail(at, 'id is used twice')
  seen.add(city.id)
  if (!files.includes(`${city.id}.js`)) fail(at, `src/cities/${city.id}.js must hold this city`)
  if (!existsSync(new URL(`../docs/cities/${city.id}.md`, import.meta.url))) fail(at, `docs/cities/${city.id}.md with sources is missing`)
  if (!city.name) fail(at, 'name is missing')
  for (const trait of Object.keys(TRAITS)) {
    if (typeof city.traits?.[trait] !== 'boolean') fail(at, `traits.${trait} must be true or false (${TRAITS[trait]}), with a source`)
  }
  for (const key of Object.keys(city.traits ?? {})) if (!(key in TRAITS)) fail(at, `traits.${key} is unknown; add it to src/traits.js`)
  for (const key of ['top', 'horizon']) if (!HEX.test(city.sky?.[key] ?? '')) fail(at, `sky.${key} must be a #rrggbb colour`)
  if (!HEX.test(city.floor ?? '')) fail(at, 'floor must be a #rrggbb colour')
  if (!Array.isArray(city.palette) || !city.palette.length || !city.palette.every((c) => HEX.test(c))) fail(at, 'palette must list #rrggbb colours')
  if (!Array.isArray(city.layers) || !city.layers.length) {
    fail(at, 'layers are missing')
    continue
  }

  let lastZ = -Infinity
  city.layers.forEach((layer, li) => {
    const lw = `${at} layer ${li}`
    if (!finite(layer.z) || layer.z >= 0) fail(lw, 'z must be a negative number (cm behind the screen)')
    if (layer.z <= lastZ) fail(lw, 'layers must go from back (most negative z) to front')
    lastZ = layer.z
    ;(layer.items ?? []).forEach((item, ii) => {
      const iw = `${lw} item ${ii} (${item.type})`
      if (!ITEM_TYPES.includes(item.type)) return fail(iw, `type must be one of ${ITEM_TYPES.join(', ')}`)
      if (item.tint && !HEX.test(item.tint)) fail(iw, 'tint must be a #rrggbb colour')
      if (item.label && (typeof item.label.name !== 'string' || !item.label.name)) fail(iw, 'label needs a name')
      if (item.type !== 'outline') return
      const pts = item.points
      if (!Array.isArray(pts) || pts.length < 3) return fail(iw, 'points needs at least 3 [x, y] pairs')
      if (!pts.every((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]))) return fail(iw, 'every point must be [x, y] numbers')
      if (pts.some((p) => p[1] < -1e-6)) fail(iw, 'points must not go below the page (y < 0)')
      // The shoelace area catches outlines that fold over themselves to nothing.
      const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2
      if (Math.abs(area) < 0.05) fail(iw, 'outline has no area')
      for (const [hi, hole] of (item.holes ?? []).entries()) {
        if (!Array.isArray(hole) || hole.length < 3) fail(`${iw} hole ${hi}`, 'needs at least 3 points')
      }
    })
  })
}

const RESERVED = ['city', 'theme', 'variant', 'progress', 'lights', 'quality']
const settingIds = new Map()
function checkSettings(at, list) {
  for (const st of list ?? []) {
    const sw = `${at} setting ${st.id}`
    if (!st.label) fail(sw, 'label is missing')
    if (![st.min, st.max, st.step, st.default].every(finite) || st.min >= st.max || st.default < st.min || st.default > st.max) fail(sw, 'needs min < max, step, and a default inside the range')
    if (st.requires && !(st.requires in TRAITS)) fail(sw, `requires unknown trait ${st.requires}`)
    if (RESERVED.includes(st.id)) fail(sw, 'id clashes with a page URL parameter')
    if (settingIds.has(st.id) && settingIds.get(st.id) !== at) fail(sw, `id is also used by ${settingIds.get(st.id)}; settings share the URL`)
    settingIds.set(st.id, at)
  }
}
function checkFolder(folder, list, label) {
  const files = readdirSync(new URL(`../src/${folder}/`, import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js')
  const listed = list.map((x) => x.id)
  for (const f of files) if (!listed.includes(f.replace(/\.js$/, ''))) fail(`${folder}/${f}`, `file is not listed in src/${folder}/index.js`)
  for (const x of list) {
    if (!/^[a-z0-9-]+$/.test(x.id ?? '')) fail(`${label} ${x.id}`, 'id must be lower case letters, digits and hyphens')
    if (!x.name) fail(`${label} ${x.id}`, 'name is missing')
  }
  return listed
}

// Themes: the artistic form of the picture.
const themeIds = checkFolder('themes', THEMES, 'theme')
for (const theme of THEMES) {
  const at = `theme ${theme.id}`
  for (const step of Object.keys(theme.post ?? {})) if (!POST_STEPS.includes(step)) fail(at, `post step ${step} is unknown; use ${POST_STEPS.join(', ')}`)
  checkSettings(at, theme.settings)
  const ts = theme.post?.tiltShift
  if (ts && !(theme.settings ?? []).some((st) => st.id === ts.setting)) fail(at, `tiltShift.setting ${ts.setting} is not in the theme's settings`)
}

// Variants: an occasion over any theme, limited by the city's traits.
const variantIds = checkFolder('variants', VARIANTS, 'variant')
for (const variant of VARIANTS) {
  const at = `variant ${variant.id}`
  checkSettings(at, variant.settings)
  const ids = (variant.settings ?? []).map((st) => st.id)
  ;(variant.effects ?? []).forEach((fx, i) => {
    const fw = `${at} effect ${i} (${fx.type})`
    if (!EFFECT_TYPES.includes(fx.type)) fail(fw, `type must be one of ${EFFECT_TYPES.join(', ')}`)
    if (fx.requires && !(fx.requires in TRAITS)) fail(fw, `requires unknown trait ${fx.requires}`)
    if (fx.setting && !ids.includes(fx.setting)) fail(fw, `setting ${fx.setting} is not in the variant's settings`)
  })
}

if (errors.length) {
  console.error(errors.map((e) => `FAIL ${e}`).join('\n'))
  process.exit(1)
}
console.log(`OK: cities (${ids.join(', ')}), themes (${themeIds.join(', ')}), variants (${variantIds.join(', ')})`)
