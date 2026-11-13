// The dying-world grade (ART-DIRECTION §3.5): one change appended to three's tone-mapping chunk, so every built-in
// and patched material runs it after tone mapping with no extra pass. Keeps 70% of the saturation, tints shadows
// toward slate and highlights slightly warm, and never lifts the blacks (a lift flattened the mist to pale grey).
import * as THREE from 'three'

const KEEP = 0.7
const SHADOW = [0.9, 0.96, 1.06] as const
const LIGHT = [1.06, 1.0, 0.9] as const
const EDGE0 = 0.05
const EDGE1 = 0.6

export const GRADE_GLSL = `
{ // td_grade
  float tdL = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 tdC = mix(vec3(tdL), gl_FragColor.rgb, ${KEEP.toFixed(1)});
  tdC = mix(tdC * vec3(${SHADOW.map((v) => v.toFixed(2)).join(', ')}), tdC * vec3(${LIGHT.map((v) => v.toFixed(2)).join(', ')}), smoothstep(${EDGE0.toFixed(2)}, ${EDGE1.toFixed(1)}, tdL));
  gl_FragColor.rgb = tdC;
}
`

/** The grade's arithmetic in TypeScript, exactly as `GRADE_GLSL` computes it (for tests). */
export function gradeRGB(rgb: [number, number, number]): [number, number, number] {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  const t = Math.min(1, Math.max(0, (l - EDGE0) / (EDGE1 - EDGE0)))
  const w = t * t * (3 - 2 * t)
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const c = l + (rgb[i] - l) * KEEP
    out[i] = c * SHADOW[i] + (c * LIGHT[i] - c * SHADOW[i]) * w
  }
  return out
}

/** Append the grade to the tone-mapping chunk. Idempotent; call before any program compiles. */
export function installGrade(): void {
  const chunk = THREE.ShaderChunk as Record<string, string>
  if (chunk.tonemapping_fragment.includes('td_grade')) return
  chunk.tonemapping_fragment += GRADE_GLSL
}
