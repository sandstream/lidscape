// Off-axis (head-coupled) projection.
// The physical screen is a window at z = 0, centred on the origin, size w × h (cm).
// The eye sits at `eye` in front of it. The frustum runs from the eye through the
// four screen corners, so the scene behind the glass keeps its place in the room.
export function setOffAxis(camera, eye, w, h, near = 0.5, far = 500) {
  camera.position.set(eye.x, eye.y, eye.z)
  camera.quaternion.identity()
  camera.updateMatrixWorld()

  const s = near / eye.z
  const left = (-w / 2 - eye.x) * s
  const right = (w / 2 - eye.x) * s
  const bottom = (-h / 2 - eye.y) * s
  const top = (h / 2 - eye.y) * s

  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}
