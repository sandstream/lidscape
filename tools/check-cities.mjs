// Checks every city, theme and variant before it reaches the page:
//   node tools/check-cities.mjs
// It runs in CI on each pull request. It does not render; open the page for that.

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { CITIES } from '../src/cities/index.js'
import { THEMES } from '../src/themes/index.js'
import { VARIANTS } from '../src/variants/index.js'
import { TRAITS } from '../src/traits.js'
import { LANGUAGES, BASE } from '../src/lang/index.js'
import { CAPITALS, LAND } from '../src/map-data.js'
import { layoutCities, layoutCapitals, mapPoint, MAP_WIDTH, MAP_HEIGHT } from '../src/map-layout.js'

// Keep in step with BUILDERS in src/city.js.
const ITEM_TYPES = ['house', 'tower', 'hill', 'arcade', 'lamp', 'outline']
// Keep in step with EFFECTS in src/effects.js and POST_STEPS in src/post.js.
const POST_STEPS = ['tiltShift', 'grade']
const EFFECT_TYPES = ['snowfall', 'snowcaps', 'stringLights', 'windowStars', 'ice', 'trees', 'windowGarlands']
const HEX = /^#[0-9a-f]{6}$/i
const errors = []
const fail = (where, msg) => errors.push(`${where}: ${msg}`)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
// Shown text: one string for every language, or { sv, en, ... } with at least
// the base languages filled in and no unknown language codes.
const text = (v) =>
  (typeof v === 'string' && v.length > 0) ||
  (v !== null &&
    typeof v === 'object' &&
    BASE.every((l) => typeof v[l] === 'string' && v[l]) &&
    Object.entries(v).every(([l, s]) => l in LANGUAGES && typeof s === 'string' && s))
const TEXT_RULE = `must be a string or { ${BASE.join(', ')} } (other languages optional)`

if (CAPITALS.length !== 193) fail('world map', 'list one capital for each of the 193 UN member states')
if (new Set(CAPITALS.map(([code]) => code)).size !== CAPITALS.length) fail('world map', 'country codes must be unique')
for (const [code, name, country, lat, lon] of CAPITALS) {
  if (!/^[A-Z]{3}$/.test(code) || !name || !country || !finite(lat) || lat < -90 || lat > 90 || !finite(lon) || lon < -180 || lon > 180) fail('world map', `invalid capital ${code}`)
}
if (!LAND.length || LAND.some((ring) => ring.length < 3 || ring.some(([lon, lat]) => !finite(lon) || Math.abs(lon) > 180 || !finite(lat) || Math.abs(lat) > 90))) fail('world map', 'land polygons are invalid')
const northeast = mapPoint(90, 180)
if (Math.abs(northeast.x - MAP_WIDTH / 2) > 1e-9 || Math.abs(northeast.y - MAP_HEIGHT / 2) > 1e-9) {
  fail('world map', 'marker projection must cover the full map texture')
}
const closeCities = layoutCities([
  { id: 'stockholm', lat: 59.324, lon: 18.068 },
  { id: 'oslo', lat: 59.913, lon: 10.752 },
  { id: 'copenhagen', lat: 55.676, lon: 12.568 },
  { id: 'helsinki', lat: 60.170, lon: 24.938 },
])
for (let i = 0; i < closeCities.length; i++) {
  for (let j = i + 1; j < closeCities.length; j++) {
    const a = closeCities[i].point
    const b = closeCities[j].point
    if (Math.hypot(a.x - b.x, a.y - b.y) < 2.1) fail('world map', `miniatures for ${closeCities[i].city.id} and ${closeCities[j].city.id} overlap`)
  }
}
const capitalTargets = layoutCapitals(CAPITALS, layoutCities(CITIES))
for (let i = 0; i < capitalTargets.length; i++) {
  const a = capitalTargets[i]
  if ((a.truePoint.x < 0) !== (a.point.x < 0)) fail('world map', `${a.capital[1]} moved across the book spine`)
  for (let j = i + 1; j < capitalTargets.length; j++) {
    const b = capitalTargets[j]
    if (Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) < 0.64) {
      fail('world map', `capital markers for ${a.capital[1]} and ${b.capital[1]} overlap`)
    }
  }
}

const files = readdirSync(new URL('../src/cities/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'))
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
  if (!text(city.name)) fail(at, `name ${TEXT_RULE}`)
  if (!finite(city.lat) || city.lat < -90 || city.lat > 90) fail(at, 'lat must be a latitude from -90 to 90, with a source in the city research file')
  if (!finite(city.lon) || city.lon < -180 || city.lon > 180) fail(at, 'lon must be a longitude from -180 to 180, with a source in the city research file')
  const research = new URL(`../docs/cities/${city.id}.md`, import.meta.url)
  if (existsSync(research) && !readFileSync(research, 'utf8').includes('Coordinates:')) fail(at, 'source coordinates in the city research file')
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
      if (item.label && !text(item.label.name)) fail(iw, `label name ${TEXT_RULE}`)
      if (item.label?.note !== undefined && !text(item.label.note)) fail(iw, `label note ${TEXT_RULE}`)
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

// Languages: the same keys as English, and the app must declare each one, or a
// Mac in that language opens the app in English.
const langFiles = readdirSync(new URL('../src/lang/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'))
for (const f of langFiles) if (!(f.replace(/\.js$/, '') in LANGUAGES)) fail(`lang/${f}`, 'file is not listed in src/lang/index.js')
const plist = readFileSync(new URL('../app/src-tauri/Info.plist', import.meta.url), 'utf8')
const appFiles = JSON.parse(readFileSync(new URL('../app/src-tauri/tauri.conf.json', import.meta.url), 'utf8')).bundle?.macOS?.files ?? {}
for (const [code, l] of Object.entries(LANGUAGES)) {
  const at = `lang ${code}`
  if (!/^[a-z]{2}$/.test(code)) fail(at, 'code must be two lower case letters (ISO 639-1)')
  if (!l.name) fail(at, 'name is missing (in the language itself, such as Deutsch)')
  for (const key of Object.keys(LANGUAGES.en.strings)) if (typeof l.strings?.[key] !== 'string' || !l.strings[key]) fail(at, `strings.${key} is missing`)
  for (const key of Object.keys(l.strings ?? {})) if (!(key in LANGUAGES.en.strings)) fail(at, `strings.${key} is unknown`)
  if (!l.strings?.title?.includes('{city}')) fail(at, 'title must hold {city}')
  if (!plist.includes(`<string>${code}</string>`)) fail(at, 'add it to CFBundleLocalizations in app/src-tauri/Info.plist')
  const strings = `locales/${code}.lproj/InfoPlist.strings`
  if (appFiles[`Resources/${code}.lproj/InfoPlist.strings`] !== strings) fail(at, `map Resources/${code}.lproj/InfoPlist.strings to ${strings} in bundle.macOS.files of app/src-tauri/tauri.conf.json`)
  const path = new URL(`../app/src-tauri/${strings}`, import.meta.url)
  if (!existsSync(path) || !readFileSync(path, 'utf8').includes('NSCameraUsageDescription')) fail(at, `app/src-tauri/${strings} must translate NSCameraUsageDescription`)
}

const RESERVED = ['city', 'theme', 'variant', 'progress', 'lights', 'quality', 'lang', 'view', 'enter']
const settingIds = new Map()
function checkSettings(at, list) {
  for (const st of list ?? []) {
    const sw = `${at} setting ${st.id}`
    if (!text(st.label)) fail(sw, `label ${TEXT_RULE}`)
    if (![st.min, st.max, st.step, st.default].every(finite) || st.min >= st.max || st.default < st.min || st.default > st.max) fail(sw, 'needs min < max, step, and a default inside the range')
    if (st.requires && !(st.requires in TRAITS)) fail(sw, `requires unknown trait ${st.requires}`)
    if (RESERVED.includes(st.id)) fail(sw, 'id clashes with a page URL parameter')
    if (settingIds.has(st.id) && settingIds.get(st.id) !== at) fail(sw, `id is also used by ${settingIds.get(st.id)}; settings share the URL`)
    settingIds.set(st.id, at)
  }
}
// How to use a theme or variant: shown text, one line per item, in the window
// that opens the first time someone picks it.
function checkHowTo(at, list) {
  if (list === undefined) return
  if (!Array.isArray(list) || !list.length) return fail(at, 'howTo must list at least one line, or be left out')
  list.forEach((line, i) => !text(line) && fail(at, `howTo ${i} ${TEXT_RULE}`))
}
function checkFolder(folder, list, label) {
  const files = readdirSync(new URL(`../src/${folder}/`, import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'))
  const listed = list.map((x) => x.id)
  for (const f of files) if (!listed.includes(f.replace(/\.js$/, ''))) fail(`${folder}/${f}`, `file is not listed in src/${folder}/index.js`)
  for (const x of list) {
    if (!/^[a-z0-9-]+$/.test(x.id ?? '')) fail(`${label} ${x.id}`, 'id must be lower case letters, digits and hyphens')
    if (!text(x.name)) fail(`${label} ${x.id}`, `name ${TEXT_RULE}`)
  }
  return listed
}

// Themes: the artistic form of the picture.
const themeIds = checkFolder('themes', THEMES, 'theme')
for (const theme of THEMES) {
  const at = `theme ${theme.id}`
  for (const step of Object.keys(theme.post ?? {})) if (!POST_STEPS.includes(step)) fail(at, `post step ${step} is unknown; use ${POST_STEPS.join(', ')}`)
  checkSettings(at, theme.settings)
  checkHowTo(at, theme.howTo)
  if (theme.post?.tiltShift && !theme.howTo) fail(at, 'tiltShift follows the pointer: say so in howTo')
  const ts = theme.post?.tiltShift
  if (ts && !(theme.settings ?? []).some((st) => st.id === ts.setting)) fail(at, `tiltShift.setting ${ts.setting} is not in the theme's settings`)
}

// Variants: an occasion over any theme, limited by the city's traits.
const variantIds = checkFolder('variants', VARIANTS, 'variant')
for (const variant of VARIANTS) {
  const at = `variant ${variant.id}`
  checkSettings(at, variant.settings)
  checkHowTo(at, variant.howTo)
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
console.log(`OK: languages (${Object.keys(LANGUAGES).join(', ')}), cities (${ids.join(', ')}), themes (${themeIds.join(', ')}), variants (${variantIds.join(', ')})`)
