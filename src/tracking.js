// Webcam tracking with MediaPipe: head position for parallax, hand pose for lights.

import { FilesetResolver, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
import { pickCamera } from './camera.js'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const IPD_CM = 6.3 // average distance between pupils
const HFOV_DEG = 62 // FaceTime HD camera, approx.
const GESTURE_FRAMES = 8 // frames a pose must hold before it counts
const STALL_MS = 2000 // no new picture for this long: the camera has stopped

export function createTracker({ screenHeight }) {
  // camera: the deviceId in use. stalled: the camera sends no picture, for
  // example because it was unplugged or another app stopped it.
  const state = { eye: null, gesture: null, running: false, camera: null, stalled: false }
  let video, face, hand, stream, frameHandle
  let lastTime = -1
  let lastFrameAt = 0
  let frames = 0 // pictures the camera has delivered
  let seenFrames = 0
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
    const now = performance.now()
    // A new picture: counted by requestVideoFrameCallback where it exists. The
    // video's clock runs on when the camera stops, so it only stands in.
    const fresh = video.requestVideoFrameCallback ? frames !== seenFrames : video.currentTime !== lastTime
    if (!fresh) {
      if (now - lastFrameAt > STALL_MS) {
        state.stalled = true
        state.eye = null
      }
    } else {
      seenFrames = frames
      lastTime = video.currentTime
      lastFrameAt = now
      state.stalled = false

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

  function open(deviceId) {
    return navigator.mediaDevices.getUserMedia({
      video: { ...(deviceId && { deviceId: { exact: deviceId } }), width: 640, height: 480 },
      audio: false,
    })
  }

  // `saved` is the viewer's last choice of camera, or nothing.
  async function start(saved) {
    const before = await navigator.mediaDevices.enumerateDevices()
    stream = await open(before.some((d) => d.label) ? pickCamera(before, saved) : null)
    // Before the viewer allowed the camera there were no labels, and macOS gave
    // its default camera. Pick again now, and switch if that was another one.
    const wanted = pickCamera(await navigator.mediaDevices.enumerateDevices(), saved)
    if (wanted && stream.getVideoTracks()[0].getSettings().deviceId !== wanted) {
      stream.getTracks().forEach((track) => track.stop())
      stream = await open(wanted)
    }
    const track = stream.getVideoTracks()[0]
    state.camera = track.getSettings().deviceId ?? null
    // macOS mutes the track when it takes the camera away, and ends it when the
    // camera is unplugged.
    track.addEventListener('ended', () => (state.stalled = true))
    track.addEventListener('mute', () => (state.stalled = true))

    video = document.createElement('video')
    video.playsInline = true
    video.muted = true
    video.srcObject = stream
    await video.play()
    const counted = video
    const count = () => {
      if (video !== counted) return
      frames++
      video.requestVideoFrameCallback(count)
    }
    video.requestVideoFrameCallback?.(count)

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
    state.stalled = false
    lastFrameAt = performance.now()
    tick()
  }

  function stop() {
    state.running = false
    state.eye = null
    state.stalled = false
    cancelAnimationFrame(frameHandle)
    stream?.getTracks().forEach((track) => track.stop())
    face?.close()
    hand?.close()
  }

  return { state, start, stop }
}
