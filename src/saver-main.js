import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { buildCity } from './city.js'
import { findCity } from './cities/index.js'
import { findTheme } from './themes/index.js'
import { findVariant } from './variants/index.js'
import { buildPost } from './post.js'
import { setOffAxis } from './offaxis.js'
import { lidProgressForAngle } from './lid.js'
import { local, pickLang } from './lang/index.js'

const SCREEN_H = 19.5
const EYE = { x: 0, y: 1.5, z: 55 }
const params = new URLSearchParams({
  ...(window.lidscapeSaverOptions ?? {}),
  ...Object.fromEntries(new URLSearchParams(location.search)),
})
const lang = pickLang(params.get('lang'), window.lidscapeMacLanguage, ...(navigator.languages ?? [navigator.language]))
document.documentElement.lang = lang
const lowQuality = params.get('quality') === 'low'
const cityDef = findCity(params.get('city'))
const theme = findTheme(params.get('theme'))
const variant = findVariant(params.get('variant'))
const settings = {}
for (const item of [...theme.settings, ...(variant?.settings ?? [])]) {
  const value = Number(params.get(item.id))
  settings[item.id] = params.has(item.id) && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, item.min, item.max)
    : item.default
}

const canvas = document.getElementById('scene')
if (!canvas.getContext('webgl2')) throw new Error('Lidscape screen saver needs WebGL 2')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowQuality })
renderer.setPixelRatio(lowQuality ? 1 : Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = !lowQuality
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
scene.background = new THREE.Color('#0b1622')
const camera = new THREE.PerspectiveCamera()
const light = { sky: '#a39be6', ground: '#2a2452', key: '#d6d0ff', keyIntensity: 2.2, keyFrom: [-30, 45, 40], ...cityDef.light }
scene.add(new THREE.HemisphereLight(light.sky, light.ground, 1.25))
const moonLight = new THREE.DirectionalLight(light.key, light.keyIntensity)
moonLight.position.set(...light.keyFrom)
moonLight.castShadow = !lowQuality
moonLight.shadow.mapSize.set(2048, 2048)
Object.assign(moonLight.shadow.camera, { left: -60, right: 60, top: 50, bottom: -20, near: 1, far: 200 })
moonLight.shadow.bias = -0.0005
moonLight.shadow.normalBias = 0.05
moonLight.shadow.radius = 4
scene.add(moonLight)

const city = buildCity(cityDef, scene, -SCREEN_H / 2, { variant, settings })
city.setReflections(!lowQuality)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.95)
bloom.enabled = !lowQuality
composer.addPass(bloom)
const output = new OutputPass()
composer.addPass(output)
const post = buildPost(composer, theme, output)
post.update(settings)

function resize() {
  const width = Math.max(1, innerWidth)
  const height = Math.max(1, innerHeight)
  renderer.setSize(width, height, false)
  composer.setSize(width, height)
  post.resize(width, height)
  setOffAxis(camera, EYE, SCREEN_H * width / height, SCREEN_H)
}
addEventListener('resize', resize)
resize()

// The native screen saver reads the lid sensor and sends its angle to this page.
// On a Mac without a readable sensor, the book stays open.
const lid = { connected: false, progress: null, disconnect() {} }
window.lidscapeSaverSetLidAngle = (angle) => {
  const next = lidProgressForAngle(angle)
  if (next == null) return
  lid.connected = true
  lid.progress = next
}
// A wallpaper host can clear a stale angle when its sensor connection fails.
window.lidscapeSaverClearLidAngle = () => {
  lid.connected = false
  lid.progress = null
}
const clock = new THREE.Clock()
let progress = 1
let running = true
let paused = false
let frameRequest = null
let previousFrame = 0
let previousFrameSignal = -Infinity
const label = document.getElementById('label')
const labelRay = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let pointer = null

function updateLabel() {
  let found = null
  if (pointer && progress > 0.85) {
    pointerNdc.set(pointer.x * 2 - 1, 1 - pointer.y * 2)
    labelRay.setFromCamera(pointerNdc, camera)
    found = city.pick(labelRay.ray)
  }
  label.hidden = !found
  if (!found) return
  label.querySelector('strong').textContent = local(found.name, lang)
  label.querySelector('span').textContent = local(found.note, lang)
  const x = Math.max(0, Math.min(pointer.x * innerWidth + 14, innerWidth - label.offsetWidth - 8))
  const y = Math.max(0, Math.min(pointer.y * innerHeight + 16, innerHeight - label.offsetHeight - 8))
  label.style.transform = `translate(${x}px, ${y}px)`
}

// The wallpaper host sends normalized coordinates. No input leaves the label hidden.
window.lidscapeSaverSetPointer = (x, y) => {
  pointer = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
  updateLabel()
}

function frame(now) {
  if (!running || paused) return
  frameRequest = requestAnimationFrame(frame)
  if (now - previousFrame < 1000 / 30) return
  previousFrame = now
  const dt = Math.min(clock.getDelta(), 0.1)
  const target = lid.connected && lid.progress != null ? lid.progress : 1
  progress += (target - progress) * (1 - Math.exp(-dt * 6))
  city.update(progress, 1, clock.elapsedTime)
  if (!lowQuality) city.renderReflection(renderer, camera)
  composer.render()
  updateLabel()
  window.lidscapeSaverLastRender = Date.now()
  if (now - previousFrameSignal >= 250) {
    previousFrameSignal = now
    window.webkit?.messageHandlers?.lidscapeFrame?.postMessage(1)
  }
}

// The wallpaper host pauses the scene when the system cannot display it.
window.lidscapeSaverSetPaused = (value) => {
  if (!running || typeof value !== 'boolean' || paused === value) return
  paused = value
  if (paused) {
    cancelAnimationFrame(frameRequest)
    frameRequest = null
  } else {
    const elapsed = clock.elapsedTime
    clock.getDelta()
    clock.elapsedTime = elapsed
    previousFrame = 0
    frameRequest = requestAnimationFrame(frame)
  }
}

window.lidscapeSaver = {
  city,
  scene,
  camera,
  composer,
  renderer,
  lid,
  stop() {
    running = false
    cancelAnimationFrame(frameRequest)
    lid.disconnect()
    renderer.dispose()
  },
}
frameRequest = requestAnimationFrame(frame)
