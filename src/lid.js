// Lid angle from the local bridge (bridge/LidBridge.swift) over a WebSocket.
// Reconnects quietly; the page falls back to manual control while it is away.

const URL = 'ws://127.0.0.1:8787'
// Finish the fold early, before the lid reaches the closed position.
const CLOSED_DEG = 50
const OPEN_DEG = 105
const RETRY_MS = 3000

export function lidProgressForAngle(angle) {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null
  return Math.min(1, Math.max(0, (angle - CLOSED_DEG) / (OPEN_DEG - CLOSED_DEG)))
}

export function connectLid(onChange) {
  const state = { connected: false, noSensor: false, angle: null, progress: null }
  let socket
  let retry
  let stopped = false

  function reconnect() {
    if (!stopped) retry = setTimeout(open, RETRY_MS)
  }

  function open() {
    if (stopped) return
    try {
      socket = new WebSocket(URL)
    } catch {
      reconnect()
      return
    }
    socket.onopen = () => {
      state.connected = !state.noSensor
      onChange(state)
    }
    socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        console.warn('Lidscape: ignored malformed lid message', event.data)
        return
      }
      // The bridge runs but this Mac has no sensor it can read (M1, desktop Macs).
      if (msg.sensor === false) {
        state.noSensor = true
        state.connected = false
        onChange(state)
        return
      }
      if (typeof msg.angle !== 'number') return
      state.angle = msg.angle
      state.progress = lidProgressForAngle(msg.angle)
      onChange(state)
    }
    socket.onclose = () => {
      const was = state.connected
      state.connected = false
      state.progress = null
      if (was) onChange(state)
      reconnect()
    }
  }

  open()
  state.disconnect = () => {
    stopped = true
    if (retry) clearTimeout(retry)
    socket?.close?.()
  }
  return state
}
