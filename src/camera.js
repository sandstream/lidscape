// Which camera to track with. The head position is worked out for a camera above
// the screen, so the Mac's own camera comes first; a USB camera or an iPhone
// (Continuity Camera) sees the viewer from elsewhere. Labels are empty until the
// viewer allows the camera.

const BUILT_IN = /macbook|facetime|built-in|inbyggd/i

export function pickCamera(devices, saved) {
  const cameras = devices.filter((d) => d.kind === 'videoinput')
  if (!cameras.length) return null
  const chosen = cameras.find((c) => c.deviceId === saved) ?? cameras.find((c) => BUILT_IN.test(c.label)) ?? cameras[0]
  return chosen.deviceId
}
