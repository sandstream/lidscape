// Webcam tracking with MediaPipe: head position for parallax, hand pose for lights.

import { FilesetResolver, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const IPD_CM = 6.3 // average distance between pupils
const HFOV_DEG = 62 // FaceTime HD camera, approx.
const GESTURE_FRAMES = 8 // frames a pose must hold before it counts

export function createTracker({ screenHeight }) {
  const state = { eye: null, gesture: null, running: false }
  let video, face, hand, stream, frameHandle
  let lastTime = -1
  let candidate = null
  let candidateFrames = 0

  function eyeFromFace(lm) {
    const vw = video.videoWidth
    const vh = video.videoHeight
    const a = lm[468] // left iris
    const b = lm[473] // right iris
    const ipdPx = Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh)
    if (ipdPx < 1) return null
    const focal = vw / 2 / Math.tan((HFOV_DEG * Math.PI) / 360)
    const z = Math.min(120, Math.max(22, (focal * IPD_CM) / ipdPx))
    const mx = ((a.x + b.x) / 2) * vw - vw / 2
    const my = ((a.y + b.y) / 2) * vh - vh / 2
    // Image is not mirrored: moving right moves you left in the frame.
    return {
      x: (-mx * z) / focal,
      y: (-my * z) / focal + screenHeight() / 2 + 0.8, // camera sits above the screen
      z,
    }
  }

  function poseFromHand(lm) {
    const wrist = lm[0]
    const d = (p) => Math.hypot(p.x - wrist.x, p.y - wrist.y)
    let extended = 0
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
      if (d(lm[tip]) > d(lm[pip]) * 1.15) extended++
    }
    if (extended >= 4) return 'open'
    if (extended === 0) return 'fist'
    return null
  }

  function tick() {
    if (!state.running) return
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime
      const now = performance.now()

      const f = face.detectForVideo(video, now)
      state.eye = f.faceLandmarks?.[0] ? eyeFromFace(f.faceLandmarks[0]) : null

      const h = hand.detectForVideo(video, now)
      const pose = h.landmarks?.[0] ? poseFromHand(h.landmarks[0]) : null
      if (pose && pose === candidate) {
        candidateFrames++
        if (candidateFrames === GESTURE_FRAMES) state.gesture = { pose, at: now }
      } else {
        candidate = pose
        candidateFrames = pose ? 1 : 0
      }
    }
    frameHandle = requestAnimationFrame(tick)
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    })
    video = document.createElement('video')
    video.playsInline = true
    video.muted = true
    video.srcObject = stream
    await video.play()

    const files = await FilesetResolver.forVisionTasks(WASM)
    ;[face, hand] = await Promise.all([
      FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      }),
      HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      }),
    ])
    state.running = true
    tick()
  }

  function stop() {
    state.running = false
    state.eye = null
    cancelAnimationFrame(frameHandle)
    stream?.getTracks().forEach((track) => track.stop())
    face?.close()
    hand?.close()
  }

  return { state, start, stop }
}
