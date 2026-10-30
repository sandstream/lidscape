// How the parts of a motif move with the lid. Pop-up turns each card up on its
// hinge (src/city.js). Push puppet keeps the cards standing and lets each item
// fall down like the toy: the lid is the button under the base, and the lid
// angle is the tension in the string. See
// docs/superpowers/specs/2026-10-30-movement-research.md.

export const MOVEMENTS = ['popup', 'puppet']

// The items of a card become beads: horizontal bands of about this height.
const BAND = 2.2
const MIN_BANDS = 2
const MAX_BANDS = 7

// Collapsed pose: the beads tilt in turn to each side (zigzag) and the whole
// figure leans (lean), as the beads of a slack push puppet do.
const ZIGZAG = 0.45
const LEAN = 1.0

export function bandHeight(height) {
  const n = Math.min(MAX_BANDS, Math.max(MIN_BANDS, Math.round(height / BAND)))
  return height / n
}

// The pose of one point of an item, in the plane of its card. anchor is
// [centre x, band height, side (0 or 1)]. slack 0 is the standing pose; slack
// 1 is the collapsed pose. The shader in patchPuppet does the same sums.
export function puppetPose(x, y, [cx, h, side], slack) {
  if (h <= 0 || slack === 0) return [x, y, 0]
  const lean = (side > 0.5 ? 1 : -1) * LEAN * slack
  const t0 = ZIGZAG * slack + lean
  const t1 = -ZIGZAG * slack + lean
  const k = Math.floor(Math.max(y, 0) / h)
  const u = y - k * h
  const n0 = Math.ceil(k / 2)
  const n1 = Math.floor(k / 2)
  const jx = h * (n0 * Math.sin(t0) + n1 * Math.sin(t1))
  const jy = h * (n0 * Math.cos(t0) + n1 * Math.cos(t1))
  const th = k % 2 === 0 ? t0 : t1
  const dx = x - cx
  return [cx + jx + Math.cos(th) * dx + Math.sin(th) * u, jy - Math.sin(th) * dx + Math.cos(th) * u, th]
}

const POSE_GLSL = /* glsl */ `
attribute vec4 puppet;
uniform float puppetSlack[16];
float puppetAngle;
vec2 puppetPose(vec2 p) {
  float slack = puppetSlack[int(puppet.w)];
  puppetAngle = 0.0;
  if (puppet.y <= 0.0 || slack == 0.0) return p;
  float lean = (puppet.z > 0.5 ? 1.0 : -1.0) * ${LEAN.toFixed(3)} * slack;
  float t0 = ${ZIGZAG.toFixed(3)} * slack + lean;
  float t1 = -${ZIGZAG.toFixed(3)} * slack + lean;
  float h = puppet.y;
  float k = floor(max(p.y, 0.0) / h);
  float u = p.y - k * h;
  float n0 = ceil(k * 0.5);
  float n1 = floor(k * 0.5);
  vec2 joint = h * (n0 * vec2(sin(t0), cos(t0)) + n1 * vec2(sin(t1), cos(t1)));
  puppetAngle = mod(k, 2.0) < 0.5 ? t0 : t1;
  float c = cos(puppetAngle);
  float s = sin(puppetAngle);
  float dx = p.x - puppet.x;
  return vec2(puppet.x, 0.0) + joint + vec2(c * dx + s * u, -s * dx + c * u);
}
`

// Bends a material's vertices into the push puppet pose. slack is shared by
// every material of the motif: one value per card, indexed by puppet.w.
export function patchPuppet(material, slack) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.puppetSlack = slack
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.xy = puppetPose(transformed.xy);'
      )
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      // The normal turns with its bead. The pose sets puppetAngle, so work it
      // out first from the untouched position.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        puppetPose(position.xy);
        objectNormal.xy = vec2(cos(puppetAngle) * objectNormal.x + sin(puppetAngle) * objectNormal.y,
                               -sin(puppetAngle) * objectNormal.x + cos(puppetAngle) * objectNormal.y);`
      )
    }
  }
  material.customProgramCacheKey = () => 'puppet'
  return material
}

// The string pulls the figure up with a spring. Slightly underdamped, so the
// figure wobbles once or twice as it stands, as the toy does. With Reduce
// Motion the spring is critically damped: no wobble.
const STIFFNESS = 90
const DAMPING_RATIO = 0.42
const STEP = 1 / 240

export function stepSpring(state, goal, dt, reduceMotion = false) {
  const zeta = reduceMotion ? 1 : DAMPING_RATIO
  const damping = 2 * zeta * Math.sqrt(STIFFNESS)
  let left = Math.min(dt, 0.1)
  while (left > 1e-9) {
    const h = Math.min(STEP, left)
    state.v += (STIFFNESS * (goal - state.x) - damping * state.v) * h
    state.x += state.v * h
    left -= h
  }
  return state
}
