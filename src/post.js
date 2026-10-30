// Theme post treatment: steps added to the composer between bloom and output.
//   tiltShift: { setting, blur, passes } a sharp band at the setting's height
//   grade:     { saturation, contrast, vignette }
//   paint:     { setting, radius, haze, haze colour } brush strokes; the
//              strokes grow and the picture hazes over as the lid closes

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js'
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js'

const GradeShader = {
  name: 'LidscapeGrade',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float grey = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(grey), c.rgb, saturation);
      col = (col - 0.18) * contrast + 0.18;
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
}

// Brush strokes: a Kuwahara filter, the usual filter for an oil-paint look.
// Each pixel takes the mean colour of the calmest of four squares around it,
// so flat areas become dabs of one colour and edges stay. A little noise moves
// the squares, so the dabs do not line up in a grid.
const PaintShader = {
  name: 'LidscapePaint',
  uniforms: {
    tDiffuse: { value: null },
    texel: { value: [1 / 1024, 1 / 1024] },
    radius: { value: 4 },
    haze: { value: 0 },
    hazeColour: { value: [0.74, 0.7, 0.86] },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float radius;
    uniform float haze;
    uniform vec3 hazeColour;
    varying vec2 vUv;
    float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 jitter = (vec2(noise(floor(vUv / texel / 3.0)), noise(floor(vUv / texel / 3.0) + 7.0)) - 0.5) * texel * radius;
      vec2 step = texel * radius / 3.0;
      vec3 best = texture2D(tDiffuse, vUv).rgb;
      float calmest = 1e9;
      for (int q = 0; q < 4; q++) {
        vec2 dir = vec2(q == 1 || q == 3 ? 1.0 : -1.0, q >= 2 ? 1.0 : -1.0);
        vec3 sum = vec3(0.0);
        vec3 sq = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          for (int j = 0; j < 4; j++) {
            vec3 c = texture2D(tDiffuse, vUv + jitter + dir * vec2(float(i), float(j)) * step).rgb;
            sum += c;
            sq += c * c;
          }
        }
        vec3 mean = sum / 16.0;
        vec3 v = sq / 16.0 - mean * mean;
        float spread = v.r + v.g + v.b;
        if (spread < calmest) { calmest = spread; best = mean; }
      }
      gl_FragColor = vec4(mix(best, hazeColour, haze), 1.0);
    }`,
}

// Adds the theme's steps to the composer before `before` (the output pass).
// Returns resize(width, height) and update(settings, progress), where progress
// is the lid: 0 closed, 1 open.
export const POST_STEPS = ['tiltShift', 'grade', 'paint']

export function buildPost(composer, theme, before) {
  const index = composer.passes.indexOf(before)
  const added = []
  const tilt = []
  const { tiltShift, grade, paint } = theme.post ?? {}
  let brush = null
  if (paint) {
    brush = new ShaderPass(PaintShader)
    if (paint.hazeColour) brush.uniforms.hazeColour.value = paint.hazeColour
    added.push(brush)
  }
  if (tiltShift) {
    for (let i = 0; i < (tiltShift.passes ?? 1); i++) {
      const h = new ShaderPass(HorizontalTiltShiftShader)
      const v = new ShaderPass(VerticalTiltShiftShader)
      tilt.push(h, v)
      added.push(h, v)
    }
  }
  if (grade) {
    const g = new ShaderPass(GradeShader)
    g.uniforms.saturation.value = grade.saturation ?? 1
    g.uniforms.contrast.value = grade.contrast ?? 1
    g.uniforms.vignette.value = grade.vignette ?? 0
    added.push(g)
  }
  added.forEach((pass, i) => composer.insertPass(pass, index + i))

  return {
    resize(width, height) {
      for (const p of tilt) {
        if (p.uniforms.h) p.uniforms.h.value = (tiltShift.blur ?? 5) / width
        if (p.uniforms.v) p.uniforms.v.value = (tiltShift.blur ?? 5) / height
      }
      if (brush) brush.uniforms.texel.value = [1 / width, 1 / height]
    },
    update(settings, progress = 1) {
      if (brush) {
        // The strokes grow and the haze rises as the lid closes, like dusk.
        const closed = 1 - Math.min(1, Math.max(0, progress))
        const size = settings[paint.setting] ?? 1
        brush.uniforms.radius.value = (paint.radius ?? 4) * size * (1 + closed * 0.8)
        brush.uniforms.haze.value = (paint.haze ?? 0.3) * closed
      }
      if (!tiltShift) return
      const focus = settings[tiltShift.setting] ?? 0.3
      for (const p of tilt) p.uniforms.r.value = focus
    },
  }
}
