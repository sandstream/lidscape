// Theme post treatment: steps added to the composer between bloom and output.
//   tiltShift: { setting, blur, passes } a sharp band at the setting's height
//   grade:     { saturation, contrast, vignette }

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

// Adds the theme's steps to the composer before `before` (the output pass).
// Returns resize(width, height) and update(settings).
export const POST_STEPS = ['tiltShift', 'grade']

export function buildPost(composer, theme, before) {
  const index = composer.passes.indexOf(before)
  const added = []
  const tilt = []
  const { tiltShift, grade } = theme.post ?? {}
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
    },
    update(settings) {
      if (!tiltShift) return
      const focus = settings[tiltShift.setting] ?? 0.3
      for (const p of tilt) p.uniforms.r.value = focus
    },
  }
}
