// Lid angle from the local bridge (bridge/LidBridge.swift) over a WebSocket.
// Reconnects quietly; the page falls back to manual control while it is away.

const URL = 'ws://127.0.0.1:8787'
const CLOSED_DEG = 15
const OPEN_DEG = 105
const RETRY_MS = 3000

export function connectLid(onChange) {
  const state = { connected: false, noSensor: false, angle: null, progress: null }
  let socket

  function open() {
    try {
      socket = new WebSocket(URL)
    } catch {
      setTimeout(open, RETRY_MS)
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
      state.progress = Math.min(1, Math.max(0, (msg.angle - CLOSED_DEG) / (OPEN_DEG - CLOSED_DEG)))
      onChange(state)
    }
    socket.onclose = () => {
      const was = state.connected
      state.connected = false
      state.progress = null
      if (was) onChange(state)
      setTimeout(open, RETRY_MS)
    }
  }

  open()
  return state
}
