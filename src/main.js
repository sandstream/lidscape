import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { buildCity } from './city.js'
import { stockholm } from './cities/stockholm.js'
import { setOffAxis } from './offaxis.js'
import { connectLid } from './lid.js'
import { createTracker } from './tracking.js'
import { t } from './strings.js'

// The screen is modelled at real size: MacBook Pro 14" is about 30 × 19.5 cm.
const SCREEN_H = 19.5
const DEFAULT_EYE = { x: 0, y: 1.5, z: 55 }
const IDLE_MS = 4000

const params = new URLSearchParams(location.search)

// --- Renderer ----------------------------------------------------------------

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera()

scene.add(new THREE.HemisphereLight('#a39be6', '#2a2452', 1.25))
const moonLight = new THREE.DirectionalLight('#d6d0ff', 2.2)
moonLight.position.set(-30, 45, 40)
moonLight.castShadow = true
moonLight.shadow.mapSize.set(2048, 2048)
Object.assign(moonLight.shadow.camera, { left: -60, right: 60, top: 50, bottom: -20, near: 1, far: 200 })
moonLight.shadow.bias = -0.0005
moonLight.shadow.radius = 4
scene.add(moonLight)

const city = buildCity(stockholm, scene, -SCREEN_H / 2)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.95))
composer.addPass(new OutputPass())

let screenW = 30
function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  composer.setSize(innerWidth, innerHeight)
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

document.getElementById('hud-title').innerHTML = t.title
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

const lid = connectLid(refreshHud)

function refreshHud() {
  setStatus('lid', lid.connected ? 'on' : 'off')
  setStatus('face', !input.cameraOn ? 'off' : tracker.state.eye ? 'on' : 'wait')
  setStatus('hand', !input.cameraOn ? 'off' : tracker.state.gesture ? 'on' : 'wait')
  slider.disabled = lid.connected
  if (lid.connected) slider.value = lid.progress ?? slider.value
  lightsBtn.textContent = input.lightsOn ? t.lightsOff : t.lightsOn
  if (!cameraBtn.disabled) cameraBtn.textContent = input.cameraOn ? t.cameraOff : t.cameraOn
  hint.textContent = [lid.connected ? t.hintLid : t.hintManual, input.cameraOn ? t.hintHand : '']
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
  if (lid.connected) return
  if (e.key === 'ArrowUp') input.manual = Math.min(1, input.manual + 0.05)
  if (e.key === 'ArrowDown') input.manual = Math.max(0, input.manual - 0.05)
  slider.value = input.manual
})

let idleTimer
addEventListener('pointermove', (e) => {
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

refreshHud()

// --- Loop --------------------------------------------------------------------

const eye = { ...DEFAULT_EYE }
let progress = input.manual
let lights = input.lightsOn ? 1 : 0
const clock = new THREE.Clock()
let hudTick = 0

function frame() {
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

  const targetEye = tracker.state.eye ?? {
    x: (input.pointer.x - 0.5) * 18,
    y: DEFAULT_EYE.y + (0.5 - input.pointer.y) * 10,
    z: DEFAULT_EYE.z,
  }
  eye.x += (targetEye.x - eye.x) * k(8)
  eye.y += (targetEye.y - eye.y) * k(8)
  eye.z += (targetEye.z - eye.z) * k(8)

  setOffAxis(camera, eye, screenW, SCREEN_H)
  city.update(progress, lights, time)
  composer.render()

  if (input.cameraOn && (hudTick = (hudTick + 1) % 15) === 0) refreshHud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
