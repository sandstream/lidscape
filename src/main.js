import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { buildCity } from './city.js'
import { CITIES, findCity } from './cities/index.js'
import { THEMES, findTheme } from './themes/index.js'
import { VARIANTS, findVariant } from './variants/index.js'
import { buildPost } from './post.js'
import { allows } from './traits.js'
import { setOffAxis } from './offaxis.js'
import { connectLid } from './lid.js'
import { createTracker } from './tracking.js'
import { t } from './strings.js'

// The screen is modelled at real size: MacBook Pro 14" is about 30 × 19.5 cm.
const SCREEN_H = 19.5
const DEFAULT_EYE = { x: 0, y: 1.5, z: 55 }
const IDLE_MS = 4000

const params = new URLSearchParams(location.search)
// 'auto' until measured, then 'high' or 'low' (see measureQuality below).
let quality = params.get('quality') ?? 'auto'

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
const city = buildCity(cityDef, scene, -SCREEN_H / 2, { variant, settings })

// For the console and for tests: window.lidscape.scene and friends.
window.lidscape = { scene, camera, renderer }

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

document.getElementById('hud-title').innerHTML = t.title.replace('{city}', cityDef.name)
document.title = `Lidscape ${cityDef.name}`

// The city picker reloads the page; the URL carries the choice, so the app can set it too.
const cityPicker = document.getElementById('city')
cityPicker.setAttribute('aria-label', t.city)
for (const c of CITIES) cityPicker.add(new Option(c.name, c.id, false, c.id === cityDef.id))
cityPicker.hidden = CITIES.length < 2
cityPicker.addEventListener('change', () => {
  params.set('city', cityPicker.value)
  location.search = params.toString()
})

const themePicker = document.getElementById('theme')
themePicker.setAttribute('aria-label', t.theme)
for (const th of THEMES) themePicker.add(new Option(th.name, th.id, false, th.id === theme.id))
themePicker.addEventListener('change', () => {
  params.set('theme', themePicker.value)
  location.search = params.toString()
})

const variantPicker = document.getElementById('variant')
variantPicker.setAttribute('aria-label', t.variant)
variantPicker.add(new Option(t.variantNone, '', false, !variant))
for (const v of VARIANTS) variantPicker.add(new Option(v.name, v.id, false, v.id === variant?.id))
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
  label.textContent = s.label
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

function setStatus(source, value) {
  document.querySelector(`[data-source="${source}"]`).dataset.state = value
}

// --- Inputs ------------------------------------------------------------------

const input = {
  manual: Number(params.get('progress') ?? 0.15),
  lightsOn: params.get('lights') !== 'off',
  pointer: { x: 0.5, y: 0.5 },
  cameraOn: false,
}
slider.value = input.manual

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
  if (lid.connected) slider.value = lid.progress ?? slider.value
  lightsBtn.textContent = input.lightsOn ? t.lightsOff : t.lightsOn
  if (!cameraBtn.disabled && !cameraBtn.dataset.none) cameraBtn.textContent = input.cameraOn ? t.cameraOff : t.cameraOn
  hint.textContent = [
    lid.noSensor ? t.hintNoSensor : lid.connected ? t.hintLid : t.hintManual,
    input.cameraOn ? t.hintHand : '',
    quality === 'low' ? t.hintLowQuality : '',
  ]
    .filter(Boolean)
    .join(' ')
}

slider.addEventListener('input', () => {
  input.manual = Number(slider.value)
})

addEventListener('wheel', (e) => {
  if (lid.connected) return
  input.manual = Math.min(1, Math.max(0, input.manual - e.deltaY * 0.0012))
  slider.value = input.manual
}, { passive: true })

addEventListener('keydown', (e) => {
  if (e.key === 'l') toggleLights()
  if (e.key === 'c') recalibrate()
  if (lid.connected) return
  if (e.key === 'ArrowUp') input.manual = Math.min(1, input.manual + 0.05)
  if (e.key === 'ArrowDown') input.manual = Math.max(0, input.manual - 0.05)
  slider.value = input.manual
})

// Labels: a landmark under the pointer shows its name and a line of facts.
const label = document.getElementById('label')
const pointerNdc = new THREE.Vector2()
let pointerInside = false
const labelRay = new THREE.Raycaster()
let shownLabel = null
function updateLabel() {
  let found = null
  if (pointerInside && progress > 0.85) {
    labelRay.setFromCamera(pointerNdc, camera)
    found = city.pick(labelRay.ray)
  }
  if (found !== shownLabel) {
    shownLabel = found
    if (found) {
      label.querySelector('strong').textContent = found.name
      label.querySelector('span').textContent = found.note ?? ''
    }
    label.hidden = !found
  }
}
document.addEventListener('pointerleave', () => (pointerInside = false))

let idleTimer
addEventListener('pointermove', (e) => {
  pointerInside = !hud.contains(e.target)
  pointerNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  label.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - label.offsetWidth - 8)}px, ${e.clientY + 16}px)`
  input.pointer.x = e.clientX / innerWidth
  input.pointer.y = e.clientY / innerHeight
  hud.classList.remove('idle')
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => hud.classList.add('idle'), IDLE_MS)
})

function toggleLights() {
  input.lightsOn = !input.lightsOn
  refreshHud()
}
lightsBtn.addEventListener('click', toggleLights)

cameraBtn.addEventListener('click', async () => {
  if (input.cameraOn) {
    tracker.stop()
    input.cameraOn = false
    refreshHud()
    return
  }
  cameraBtn.disabled = true
  cameraBtn.textContent = t.cameraLoading
  try {
    await tracker.start()
    recalibrate()
    input.cameraOn = true
  } catch (err) {
    console.error('Lidscape: camera failed', err)
    hint.textContent = `${t.cameraError}: ${err.message}`
    tracker.stop()
  } finally {
    cameraBtn.disabled = false
    refreshHud()
  }
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
        x: (input.pointer.x - 0.5) * 18,
        y: DEFAULT_EYE.y + (0.5 - input.pointer.y) * 10,
        z: DEFAULT_EYE.z,
      }
  eye.x += (targetEye.x - eye.x) * k(8)
  eye.y += (targetEye.y - eye.y) * k(8)
  eye.z += (targetEye.z - eye.z) * k(8)

  setOffAxis(camera, eye, screenW, SCREEN_H)
  city.update(progress, lights, time)
  post.update(settings)
  updateLabel()
  composer.render()

  if (input.cameraOn && (hudTick = (hudTick + 1) % 15) === 0) refreshHud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
