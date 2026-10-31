import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { buildCity } from './city.js'
import { buildWorldMap } from './world-map.js'
import { MAP_WIDTH, MAP_HEIGHT } from './map-layout.js'
import { CITIES, findCity } from './cities/index.js'
import { THEMES, findTheme } from './themes/index.js'
import { VARIANTS, findVariant } from './variants/index.js'
import { buildPost } from './post.js'
import { allows } from './traits.js'
import { setOffAxis } from './offaxis.js'
import { connectLid } from './lid.js'
import { createTracker } from './tracking.js'
import { LANGUAGES, pickLang, local } from './lang/index.js'
import { watchUpdates } from './update.js'
import { setupHowTo } from './howto.js'

// The screen is modelled at real size: MacBook Pro 14" is about 30 × 19.5 cm.
const SCREEN_H = 19.5
const DEFAULT_EYE = { x: 0, y: 1.5, z: 55 }
const IDLE_MS = 4000

const params = new URLSearchParams(location.search)
// 'auto' until measured, then 'high' or 'low' (see measureQuality below).
let quality = params.get('quality') ?? 'auto'

// Language: ?lang=, then the viewer's last choice, then the Mac or browser.
// English when none of them is a language the page has.
const LANG_KEY = 'lidscape.lang'
let storedLang = null
try {
  storedLang = localStorage.getItem(LANG_KEY)
} catch {}
// The Mac app sets lidscapeMacLanguage (see app/src-tauri/src/lib.rs).
const lang = pickLang(params.get('lang'), storedLang, window.lidscapeMacLanguage, ...(navigator.languages ?? [navigator.language]))
const t = LANGUAGES[lang].strings
document.documentElement.lang = lang

// --- Renderer ----------------------------------------------------------------

const canvas = document.getElementById('scene')
// Without WebGL 2 nothing can draw: say so instead of showing a black window.
if (!canvas.getContext('webgl2')) {
  document.body.insertAdjacentHTML('beforeend', `<p id="no-webgl">${t.noWebgl}</p>`)
  throw new Error('Lidscape: WebGL 2 is not available')
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color('#0b1622')
const camera = new THREE.PerspectiveCamera()

// A city may set its own light; the default is the original lavender dusk.
const cityDef = findCity(params.get('city'))
const light = { sky: '#a39be6', ground: '#2a2452', key: '#d6d0ff', keyIntensity: 2.2, keyFrom: [-30, 45, 40], ...cityDef.light }
scene.add(new THREE.HemisphereLight(light.sky, light.ground, 1.25))
const moonLight = new THREE.DirectionalLight(light.key, light.keyIntensity)
moonLight.position.set(...light.keyFrom)
moonLight.castShadow = true
moonLight.shadow.mapSize.set(2048, 2048)
Object.assign(moonLight.shadow.camera, { left: -60, right: 60, top: 50, bottom: -20, near: 1, far: 200 })
moonLight.shadow.bias = -0.0005
// Cards turn through every angle as the lid moves; push the shadow lookup out
// along the normal so a face never shades itself in bands.
moonLight.shadow.normalBias = 0.05
moonLight.shadow.radius = 4
scene.add(moonLight)

// A theme is the artistic form of the whole picture; a variant is an occasion
// laid over it. Both come from the URL, with their settings, so a link or the
// app can set them.
const theme = findTheme(params.get('theme'))
const variant = findVariant(params.get('variant'))
const allSettings = [...theme.settings, ...(variant?.settings ?? [])]
const settings = {}
for (const s of allSettings) {
  const v = Number(params.get(s.id))
  settings[s.id] = params.has(s.id) && Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.default
}
// Movement is a URL choice while Push puppet is a prototype (docs/superpowers/specs/2026-10-30-movement-research.md).
const movement = params.get('movement') === 'puppet' ? 'puppet' : 'popup'
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const city = buildCity(cityDef, scene, -SCREEN_H / 2, { variant, settings, movement, reduceMotion })
const worldMap = buildWorldMap(scene, CITIES)
let flight = params.get('view') === 'map' ? 1 : 0
let flightTarget = params.has('enter') ? 0 : flight
const cityHome = city.root.position.clone()
const mapHome = worldMap.root.position.clone()
const smallBook = new THREE.Vector3(0, 0, -50)
let mapZoom = 1
let mapZoomTarget = 1
const mapPan = { x: 0, y: 0 }
city.root.visible = flight < 1
worldMap.root.visible = flight > 0

// For the console and for tests: window.lidscape.scene and friends.
window.lidscape = { scene, camera, renderer, worldMap }

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.95)
composer.addPass(bloom)
const output = new OutputPass()
composer.addPass(output)
const post = buildPost(composer, theme, output)

let screenW = 30
function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  composer.setSize(innerWidth, innerHeight)
  post.resize(innerWidth, innerHeight)
  screenW = SCREEN_H * (innerWidth / innerHeight)
}
addEventListener('resize', resize)
resize()

// --- HUD ---------------------------------------------------------------------

const hud = document.getElementById('hud')
const slider = document.getElementById('progress')
const cameraBtn = document.getElementById('camera-btn')
const lightsBtn = document.getElementById('lights-btn')
const hint = document.getElementById('hud-hint')
const cameraPicker = document.getElementById('camera')
const mapToggle = document.getElementById('map-toggle')
const mapInfo = document.getElementById('map-info')
const mapZoomControls = document.getElementById('map-zoom')
const mapZoomLevel = document.getElementById('map-zoom-level')
const mapSlider = document.getElementById('map-progress')
const mapLidStatus = document.getElementById('map-lid-status')
const mapSelection = document.getElementById('map-selection')
const mapSelected = document.getElementById('map-selected')
const mapSelectedNote = document.getElementById('map-selected-note')
const mapNearby = document.getElementById('map-nearby')
const capitalName = (name) => name === 'Helsinki' ? t.mapHelsinki : name

// A WebView does not open target=_blank links. Send repository links through the
// app's checked browser command, including the link on the world map.
if (window.__TAURI__) {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]')
    if (!link || !link.href.startsWith('https://github.com/sandstream/lidscape/')) return
    event.preventDefault()
    window.__TAURI__.core.invoke('open_link', { url: link.href }).catch((error) => {
      console.error('Lidscape: could not open link', error)
      hint.textContent = t.linkError
      mapLidStatus.textContent = t.linkError
    })
  })
}

const cityName = local(cityDef.name, lang)
document.getElementById('hud-title').innerHTML = t.title.replace('{city}', cityName)
document.title = `Lidscape ${cityName}`
document.getElementById('map-title').textContent = t.mapTitle
document.getElementById('map-hint').textContent = t.mapHint
mapInfo.querySelector('a').textContent = t.mapContribute
document.getElementById('map-progress-label').textContent = t.mapProgress
const mapCities = document.getElementById('map-cities')
for (const listedCity of CITIES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = local(listedCity.name, lang)
  button.addEventListener('click', () => enterCity(listedCity.id))
  mapCities.append(button)
}

function refreshMapUi() {
  const on = flightTarget === 1
  const mapVisible = flight >= 0.5
  mapToggle.querySelector('.map-toggle-text').textContent = on ? t.mapBack : t.mapOpen
  mapToggle.setAttribute('aria-pressed', String(on))
  mapInfo.hidden = !mapVisible
  document.body.classList.toggle('map-view', mapVisible)
}

mapZoomControls.setAttribute('aria-label', t.mapZoom)
document.getElementById('map-zoom-in').setAttribute('aria-label', t.mapZoomIn)
document.getElementById('map-zoom-out').setAttribute('aria-label', t.mapZoomOut)
document.getElementById('map-zoom-reset').textContent = t.mapZoomResetShort
document.getElementById('map-zoom-reset').setAttribute('aria-label', t.mapZoomReset)

function clampMapPan() {
  const depth = (DEFAULT_EYE.z - mapHome.z) / DEFAULT_EYE.z
  const maxX = Math.max(0, (MAP_WIDTH * mapZoomTarget - screenW * depth) / 2)
  const maxY = Math.max(0, (MAP_HEIGHT * Math.cos(worldMap.root.rotation.x) * mapZoomTarget - SCREEN_H * depth) / 2)
  mapPan.x = THREE.MathUtils.clamp(mapPan.x, -maxX, maxX)
  mapPan.y = THREE.MathUtils.clamp(mapPan.y, -maxY, maxY)
}

function setMapZoom(value) {
  mapZoomTarget = THREE.MathUtils.clamp(value, 1, 3)
  clampMapPan()
  mapZoomLevel.textContent = `${Math.round(mapZoomTarget * 100)} %`
  document.getElementById('map-zoom-out').disabled = mapZoomTarget <= 1
  document.getElementById('map-zoom-in').disabled = mapZoomTarget >= 3
  document.getElementById('map-zoom-reset').disabled = mapZoomTarget <= 1 && mapPan.x === 0 && mapPan.y === 0
}

document.getElementById('map-zoom-in').addEventListener('click', () => setMapZoom(mapZoomTarget + 0.5))
document.getElementById('map-zoom-out').addEventListener('click', () => setMapZoom(mapZoomTarget - 0.5))
document.getElementById('map-zoom-reset').addEventListener('click', () => {
  mapPan.x = 0
  mapPan.y = 0
  setMapZoom(1)
})
setMapZoom(1)
addEventListener('resize', () => setMapZoom(mapZoomTarget))

function setMapUrl(on) {
  if (on) params.set('view', 'map')
  else params.delete('view')
  params.delete('enter')
  const query = params.toString()
  history.replaceState(null, '', query ? `?${query}` : location.pathname)
}

function enterCity(id) {
  mapSelection.hidden = true
  if (id !== cityDef.id) {
    params.set('city', id)
    params.set('view', 'map')
    params.set('enter', '1')
    location.search = params.toString()
    return
  }
  flightTarget = 0
  refreshMapUi()
  refreshHud()
}

mapToggle.addEventListener('click', () => {
  if (flight !== flightTarget) return
  flightTarget = flightTarget === 1 ? 0 : 1
  if (flightTarget === 1) {
    mapSelection.hidden = true
    mapPan.x = 0
    mapPan.y = 0
    setMapZoom(1)
    setMapUrl(true)
  }
  refreshMapUi()
  refreshHud()
})
refreshMapUi()

// The language picker reloads the page in the new language and remembers it.
const langPicker = document.getElementById('lang')
langPicker.setAttribute('aria-label', t.lang)
for (const [code, l] of Object.entries(LANGUAGES)) langPicker.add(new Option(l.name, code, false, code === lang))
const mapLangPicker = document.getElementById('map-lang')
mapLangPicker.setAttribute('aria-label', t.lang)
for (const [code, l] of Object.entries(LANGUAGES)) mapLangPicker.add(new Option(l.name, code, false, code === lang))
function changeLanguage(code) {
  try {
    localStorage.setItem(LANG_KEY, code)
  } catch {}
  params.set('lang', code)
  location.search = params.toString()
}
langPicker.addEventListener('change', () => changeLanguage(langPicker.value))
mapLangPicker.addEventListener('change', () => changeLanguage(mapLangPicker.value))

// The city picker reloads the page; the URL carries the choice, so the app can set it too.
const cityPicker = document.getElementById('city')
cityPicker.setAttribute('aria-label', t.city)
for (const c of CITIES) cityPicker.add(new Option(local(c.name, lang), c.id, false, c.id === cityDef.id))
cityPicker.hidden = CITIES.length < 2
cityPicker.addEventListener('change', () => {
  params.set('city', cityPicker.value)
  location.search = params.toString()
})

const themePicker = document.getElementById('theme')
themePicker.setAttribute('aria-label', t.theme)
for (const th of THEMES) themePicker.add(new Option(local(th.name, lang), th.id, false, th.id === theme.id))
themePicker.addEventListener('change', () => {
  params.set('theme', themePicker.value)
  location.search = params.toString()
})

const variantPicker = document.getElementById('variant')
variantPicker.setAttribute('aria-label', t.variant)
variantPicker.add(new Option(t.variantNone, '', false, !variant))
for (const v of VARIANTS) variantPicker.add(new Option(local(v.name, lang), v.id, false, v.id === variant?.id))
variantPicker.addEventListener('change', () => {
  if (variantPicker.value) params.set('variant', variantPicker.value)
  else params.delete('variant')
  location.search = params.toString()
})

// A setting shows only when the city allows what it controls: no snow slider in Nairobi.
const settingsBox = document.getElementById('theme-settings')
for (const s of allSettings) {
  if (!allows(cityDef, s.requires)) continue
  const label = document.createElement('label')
  label.textContent = local(s.label, lang)
  const range = Object.assign(document.createElement('input'), { type: 'range', min: s.min, max: s.max, step: s.step })
  range.value = settings[s.id]
  range.addEventListener('input', () => {
    settings[s.id] = Number(range.value)
    params.set(s.id, range.value)
    history.replaceState(null, '', `?${params}`)
  })
  label.append(range)
  settingsBox.append(label)
}
settingsBox.hidden = !settingsBox.children.length
document.getElementById('progress-label').textContent = t.progress
for (const li of document.querySelectorAll('#hud-status li')) {
  li.querySelector('.label').textContent = t[li.dataset.source]
}

watchUpdates({ t, hud })
setupHowTo({ t, lang, theme, variant })

function setStatus(source, value) {
  document.querySelector(`[data-source="${source}"]`).dataset.state = value
}

// --- Inputs ------------------------------------------------------------------

const input = {
  manual: Number(params.get('progress') ?? (params.get('view') === 'map' ? 1 : 0.15)),
  lightsOn: params.get('lights') !== 'off',
  pointer: { x: 0.5, y: 0.5 },
  cameraOn: false,
}
slider.value = input.manual
mapSlider.value = input.manual

const tracker = createTracker({ screenHeight: () => SCREEN_H })
let lastGestureAt = 0

// The head moves the view relative to where it was when tracking started, so the
// scene does not jump when the camera turns on: the depth guess from iris size and
// the camera sitting above the screen would otherwise shift zoom and sky colour.
// Press C to take the current head position as the new rest position.
const CALIBRATION_FRAMES = 20
let rest = null
let restSamples = []
function headEye() {
  const e = tracker.state.eye
  if (!e) return null
  if (!rest) {
    restSamples.push(e)
    if (restSamples.length < CALIBRATION_FRAMES) return null
    const avg = (k) => restSamples.reduce((sum, s) => sum + s[k], 0) / restSamples.length
    rest = { x: avg('x'), y: avg('y'), z: avg('z') }
  }
  return {
    x: DEFAULT_EYE.x + (e.x - rest.x),
    y: DEFAULT_EYE.y + (e.y - rest.y),
    z: Math.min(85, Math.max(32, DEFAULT_EYE.z + (e.z - rest.z))),
  }
}
function recalibrate() {
  rest = null
  restSamples = []
}

const lid = connectLid(refreshHud)
window.lidscape.tracker = tracker
window.lidscape.input = input

function refreshHud() {
  setStatus('lid', lid.connected ? 'on' : 'off')
  setStatus('face', !input.cameraOn ? 'off' : tracker.state.eye ? 'on' : 'wait')
  setStatus('hand', !input.cameraOn ? 'off' : tracker.state.gesture ? 'on' : 'wait')
  slider.disabled = lid.connected
  mapSlider.disabled = lid.connected
  if (lid.connected) slider.value = lid.progress ?? slider.value
  if (lid.connected) mapSlider.value = lid.progress ?? mapSlider.value
  mapLidStatus.textContent = lid.noSensor ? t.hintNoSensor : lid.connected ? t.mapControlsLid : t.mapControlsManual
  lightsBtn.textContent = input.lightsOn ? t.lightsOff : t.lightsOn
  if (!cameraBtn.disabled && !cameraBtn.dataset.none) cameraBtn.textContent = input.cameraOn ? t.cameraOff : t.cameraOn
  hint.textContent = [
    flightTarget === 1
      ? lid.connected ? t.mapControlsLid : t.mapControlsManual
      : lid.noSensor ? t.hintNoSensor : lid.connected ? t.hintLid : t.hintManual,
    flightTarget === 0 && input.cameraOn ? (tracker.state.stalled ? t.cameraStalled : t.hintHand) : '',
    quality === 'low' ? t.hintLowQuality : '',
  ]
    .filter(Boolean)
    .join(' ')
}

slider.addEventListener('input', () => {
  input.manual = Number(slider.value)
  mapSlider.value = slider.value
})
mapSlider.addEventListener('input', () => {
  input.manual = Number(mapSlider.value)
  slider.value = mapSlider.value
})

addEventListener('wheel', (e) => {
  if (flightTarget === 1 && flight > 0.98) {
    e.preventDefault()
    setMapZoom(mapZoomTarget * Math.exp(-THREE.MathUtils.clamp(e.deltaY, -120, 120) * 0.0012))
    return
  }
  if (lid.connected) return
  input.manual = Math.min(1, Math.max(0, input.manual - e.deltaY * 0.0012))
  slider.value = input.manual
  mapSlider.value = input.manual
}, { passive: false })

let gestureStartZoom = 1
addEventListener('gesturestart', (e) => {
  if (flightTarget !== 1 || flight < 0.98) return
  e.preventDefault()
  gestureStartZoom = mapZoomTarget
})
addEventListener('gesturechange', (e) => {
  if (flightTarget !== 1 || flight < 0.98) return
  e.preventDefault()
  setMapZoom(gestureStartZoom * e.scale)
})

addEventListener('keydown', (e) => {
  if (e.key === 'l') toggleLights()
  if (e.key === 'c') recalibrate()
  if (lid.connected) return
  if (e.key === 'ArrowUp') input.manual = Math.min(1, input.manual + 0.05)
  if (e.key === 'ArrowDown') input.manual = Math.max(0, input.manual - 0.05)
  slider.value = input.manual
  mapSlider.value = input.manual
})

// Labels: a landmark under the pointer shows its name and a line of facts.
const label = document.getElementById('label')
const pointerNdc = new THREE.Vector2()
let pointerInside = false
let focus = settings[theme.post?.tiltShift?.setting] ?? 0.3
const labelRay = new THREE.Raycaster()
let shownLabel = null
let mapHit = null
function updateLabel() {
  let found = null
  mapHit = null
  if (pointerInside && flight > 0.98) {
    labelRay.setFromCamera(pointerNdc, camera)
    mapHit = worldMap.pick(labelRay)
    if (mapHit?.type === 'city') found = { name: mapHit.city.name, note: t.mapReady }
    if (mapHit?.type === 'capital') found = { name: capitalName(mapHit.name), note: `${mapHit.country} · ${t.mapMissing}` }
  } else if (pointerInside && flight < 0.02 && progress > 0.85) {
    labelRay.setFromCamera(pointerNdc, camera)
    found = city.pick(labelRay.ray)
  }
  const key = found ? `${local(found.name, lang)}|${local(found.note, lang)}` : null
  if (key !== shownLabel) {
    shownLabel = key
    if (found) {
      label.querySelector('strong').textContent = local(found.name, lang)
      label.querySelector('span').textContent = local(found.note, lang)
    }
    label.hidden = !found
  }
  canvas.style.cursor = mapHit ? 'pointer' : 'default'
}

function showCapital(hit) {
  mapSelection.hidden = false
  mapSelected.textContent = capitalName(hit.name)
  mapSelectedNote.textContent = `${hit.country} · ${t.mapMissing}`
  mapNearby.replaceChildren()
  if (hit.nearby.length < 2) return
  for (const capital of hit.nearby) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = capitalName(capital.name)
    button.setAttribute('aria-pressed', String(capital.code === hit.code))
    button.addEventListener('click', () => showCapital({ ...capital, nearby: hit.nearby }))
    mapNearby.append(button)
  }
}
document.addEventListener('pointerleave', () => (pointerInside = false))

let idleTimer
let mapDrag = null
let suppressMapClickUntil = 0
canvas.addEventListener('pointerdown', (e) => {
  if (flightTarget !== 1 || flight < 0.98 || e.button !== 0) return
  mapDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0, moved: false }
  canvas.setPointerCapture(e.pointerId)
})
addEventListener('pointermove', (e) => {
  if (mapDrag?.id === e.pointerId) {
    const dx = e.clientX - mapDrag.x
    const dy = e.clientY - mapDrag.y
    mapDrag.x = e.clientX
    mapDrag.y = e.clientY
    mapDrag.distance += Math.abs(dx) + Math.abs(dy)
    mapDrag.moved = mapDrag.distance > 4
    if (mapDrag.moved) {
      const depth = (DEFAULT_EYE.z - mapHome.z) / DEFAULT_EYE.z
      mapPan.x += (dx / innerWidth) * screenW * depth
      mapPan.y -= (dy / innerHeight) * SCREEN_H * depth
      setMapZoom(mapZoomTarget)
    }
  }
  pointerInside = !hud.contains(e.target) && !mapToggle.contains(e.target) && !mapInfo.contains(e.target)
  pointerNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  label.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - label.offsetWidth - 8)}px, ${e.clientY + 16}px)`
  input.pointer.x = e.clientX / innerWidth
  input.pointer.y = e.clientY / innerHeight
  hud.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => hud.classList.add('idle'), IDLE_MS)
})
canvas.addEventListener('pointerup', (e) => {
  if (mapDrag?.id !== e.pointerId) return
  if (mapDrag.moved) suppressMapClickUntil = performance.now() + 300
  mapDrag = null
})
canvas.addEventListener('pointercancel', () => { mapDrag = null })
canvas.addEventListener('click', (e) => {
  if (performance.now() < suppressMapClickUntil) return
  if (flight < 0.99 || flightTarget !== 1) return
  pointerNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  labelRay.setFromCamera(pointerNdc, camera)
  const hit = worldMap.pick(labelRay)
  if (hit?.type === 'city') enterCity(hit.city.id)
  else if (hit?.type === 'capital') showCapital(hit)
  else mapSelection.hidden = true
})

function toggleLights() {
  input.lightsOn = !input.lightsOn
  refreshHud()
}
lightsBtn.addEventListener('click', toggleLights)

// The camera picker shows when the Mac has more than one camera, and remembers
// the choice. Without a choice the Mac's own camera is used (see camera.js).
const CAMERA_ITEM = 'lidscape.camera'
function savedCamera() {
  try {
    return localStorage.getItem(CAMERA_ITEM)
  } catch {
    return null
  }
}

async function fillCameraPicker() {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
  cameraPicker.replaceChildren(...cameras.map((c, i) => new Option(c.label || `${t.camera} ${i + 1}`, c.deviceId, false, c.deviceId === tracker.state.camera)))
  cameraPicker.hidden = !input.cameraOn || cameras.length < 2
}
cameraPicker.setAttribute('aria-label', t.camera)
navigator.mediaDevices?.addEventListener?.('devicechange', () => input.cameraOn && fillCameraPicker())

// A new theme, city, variant or language reloads the page. The camera stays on
// across that reload, but not when the app or the tab is opened again.
const CAMERA_ON_ITEM = 'lidscape.cameraOn'
function rememberCamera(on) {
  try {
    if (on) sessionStorage.setItem(CAMERA_ON_ITEM, '1')
    else sessionStorage.removeItem(CAMERA_ON_ITEM)
  } catch {}
}

async function startCamera() {
  cameraBtn.disabled = true
  cameraBtn.textContent = t.cameraLoading
  try {
    await tracker.start(savedCamera())
    recalibrate()
    input.cameraOn = true
    rememberCamera(true)
  } catch (err) {
    console.error('Lidscape: camera failed', err)
    hint.textContent = `${t.cameraError}: ${err.message}`
    tracker.stop()
  } finally {
    cameraBtn.disabled = false
    await fillCameraPicker().catch(() => {})
    refreshHud()
  }
}

cameraPicker.addEventListener('change', () => {
  try {
    localStorage.setItem(CAMERA_ITEM, cameraPicker.value)
  } catch {}
  tracker.stop()
  input.cameraOn = false
  startCamera()
})

cameraBtn.addEventListener('click', () => {
  if (!input.cameraOn) return startCamera()
  tracker.stop()
  input.cameraOn = false
  rememberCamera(false)
  cameraPicker.hidden = true
  refreshHud()
})

// A Mac without a camera gets a plain answer on the button instead of an error.
navigator.mediaDevices
  ?.enumerateDevices()
  .then((devices) => {
    if (devices.some((d) => d.kind === 'videoinput')) return
    cameraBtn.disabled = true
    cameraBtn.dataset.none = 'true'
    cameraBtn.textContent = t.noCamera
  })
  .catch(() => {})

try {
  if (sessionStorage.getItem(CAMERA_ON_ITEM)) startCamera()
} catch {}

refreshHud()

// --- Loop --------------------------------------------------------------------

const eye = { ...DEFAULT_EYE }
let progress = input.manual
let lights = input.lightsOn ? 1 : 0
const clock = new THREE.Clock()
let hudTick = 0

// Quality: measure frames 60 to 180 after start. A Mac that cannot hold about 45
// frames a second drops to one pixel per point, no shadows and no bloom, and says
// so. ?quality=low or ?quality=high skips the measurement.
const QUALITY_SLOW_MS = 22
const frameTimes = []
function lowerQuality() {
  quality = 'low'
  renderer.setPixelRatio(1)
  resize()
  moonLight.castShadow = false
  bloom.enabled = false
  city.setReflections(false)
  refreshHud()
}
if (quality === 'low') lowerQuality()
function measureQuality(rawMs) {
  if (quality !== 'auto') return
  frameTimes.push(rawMs)
  if (frameTimes.length < 180) return
  const sorted = frameTimes.slice(60).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median > QUALITY_SLOW_MS) lowerQuality()
  else quality = 'high'
  console.info(`Lidscape: quality ${quality} (median frame ${median.toFixed(1)} ms)`)
}
window.lidscape.quality = () => quality

let lastFrameAt = performance.now()
function frame() {
  const now = performance.now()
  measureQuality(now - lastFrameAt)
  lastFrameAt = now
  const dt = Math.min(clock.getDelta(), 0.1)
  const time = clock.elapsedTime
  const k = (rate) => 1 - Math.exp(-dt * rate)

  // Gesture toggles lights; each held pose fires once.
  const g = tracker.state.gesture
  if (g && g.at !== lastGestureAt) {
    lastGestureAt = g.at
    input.lightsOn = g.pose === 'open'
    refreshHud()
  }

  const target = lid.connected && lid.progress != null ? lid.progress : input.manual
  progress += (target - progress) * k(6)
  lights += ((input.lightsOn ? 1 : 0) - lights) * k(2.5)

  // With the camera on, the head alone moves the view; it rests while calibrating
  // or when the face is lost. Without it, the pointer stands in for the head.
  const targetEye = input.cameraOn
    ? headEye() ?? DEFAULT_EYE
    : {
        x: (input.pointer.x - 0.5) * 18 * (1 - flight * 0.82),
        y: DEFAULT_EYE.y + (0.5 - input.pointer.y) * 10 * (1 - flight * 0.82),
        z: DEFAULT_EYE.z,
      }
  eye.x += (targetEye.x - eye.x) * k(8)
  eye.y += (targetEye.y - eye.y) * k(8)
  eye.z += (targetEye.z - eye.z) * k(8)

  setOffAxis(camera, eye, screenW, SCREEN_H)
  if (flight !== flightTarget) {
    const step = dt / 2.6
    flight = Math.abs(flightTarget - flight) <= step ? flightTarget : flight + Math.sign(flightTarget - flight) * step
    if (flight === 0) setMapUrl(false)
  }
  if (document.body.classList.contains('map-view') !== (flight >= 0.5)) refreshMapUi()
  const cityPart = Math.min(1, flight * 2)
  const mapPart = Math.max(0, flight * 2 - 1)
  const cityMove = cityPart * cityPart * (3 - 2 * cityPart)
  const mapMove = mapPart * mapPart * (3 - 2 * mapPart)
  city.root.position.copy(cityHome).lerp(smallBook, cityMove)
  city.root.scale.setScalar(1 - cityMove * 0.978)
  city.root.visible = flight < 0.5
  mapZoom += (mapZoomTarget - mapZoom) * k(10)
  worldMap.root.position.copy(smallBook).lerp(mapHome, mapMove)
  worldMap.root.position.x += mapPan.x * mapMove
  worldMap.root.position.y += mapPan.y * mapMove
  worldMap.root.scale.setScalar((0.04 + mapMove * 0.96) * mapZoom)
  worldMap.root.visible = flight >= 0.5
  city.setReflections(flight === 0 && quality !== 'low')
  city.setFlightProgress(cityMove)
  if (city.root.visible) city.update(progress, lights, time)
  worldMap.update(progress, lights)
  // Tilt-shift focus follows the pointer's height over the scene, so the sharp
  // band sits where you look; elsewhere the setting holds it. Gaze from the
  // webcam is too rough for this, the pointer is not.
  const focusId = theme.post?.tiltShift?.setting
  if (focusId) {
    const target = pointerInside ? Math.min(0.9, Math.max(0.1, (pointerNdc.y + 1) / 2)) : settings[focusId]
    focus += (target - focus) * k(4)
  }
  post.update(focusId ? { ...settings, [focusId]: focus } : settings, progress)
  updateLabel()
  if (flight === 0) city.renderReflection(renderer, camera)
  composer.render()

  if (input.cameraOn && (hudTick = (hudTick + 1) % 15) === 0) refreshHud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
