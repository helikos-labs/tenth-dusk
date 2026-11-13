// Warmth as progress (ART-DIRECTION §3.7): each lit beacon gives back colour and warmth to the land within about 2.5
// hexes, on the ground and the plants. The shaders hold up to three lit beacons (uLit0 to uLit2, unused slots far
// away); a pixel takes the warmth of the nearest, falling off smoothly, and only on seen ground (C7).
import * as THREE from 'three'
import type { WorldCell } from './adapter.ts'
import { SQRT3, hexCenter } from './field.ts'
import { toAxial, unkey } from '../rules/hex.ts'

/** Warmth reaches 0 this far from a lit beacon (world units: SQRT3 is one hex, centre to centre). */
export const WARM_RADIUS = 2.5 * SQRT3
/** Within this distance of a lit beacon the land is fully warm (one hex). */
export const WARM_FULL = SQRT3
/**
 * The fire's own glow at full warmth (linear RGB, added as emissive light, R11): it shows even in deep shade, where
 * the colour and tint alone, which scale the light a pixel gets, barely do.
 */
export const WARM_GLOW = [0.035, 0.02, 0.008] as const
/** Where an unused slot lies: far enough that no pixel is warmed by it. */
const FAR = 1e4

const far = () => new THREE.Vector3(FAR, 0, FAR)

/**
 * The world positions of the first three lit beacons, in `lit` order (offset "row,col" keys, as `run.lit` holds them);
 * a slot whose key is not in `world` lies far away.
 */
export function litPositions(lit: readonly string[], world: Record<string, WorldCell>): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const out: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [far(), far(), far()]
  lit.slice(0, 3).forEach((k, i) => {
    const { q, r } = toAxial(unkey(k))
    if (!world[`${q},${r}`]) return
    const c = hexCenter(q, r)
    out[i].set(c.x, 0, c.z)
  })
  return out
}

/** One beacon's falloff at distance d, as the GLSL computes it. */
const falloff = (d: number) => {
  const t = Math.min(1, Math.max(0, (d - WARM_FULL) / (WARM_RADIUS - WARM_FULL)))
  return 1 - t * t * (3 - 2 * t)
}

/** The warmth at a world point (0 to 1), exactly as `td_warmth` computes it (for tests). */
export function warmthAt(p: { x: number; z: number }, lit: readonly THREE.Vector3[]): number {
  return Math.max(0, ...lit.slice(0, 3).map((b) => falloff(Math.hypot(p.x - b.x, p.z - b.z))))
}

/**
 * The warmth's uniforms and functions. `td_warmth` is the largest of the three beacons' falloffs, written out with
 * constant indices (C3); with w (0 to 1) the warmth times the seen share, `td_warm` gives back an albedo's saturation and
 * warms it, and `td_glow` is the fire's glow to add as emissive light. Both go in at the same stage on the ground and the
 * plants: the albedo before lighting, the glow with the emissive.
 */
export const WARMTH_GLSL = /* glsl */ `
uniform vec3 uLit0;
uniform vec3 uLit1;
uniform vec3 uLit2;
float td_warmFrom(vec2 xz, vec3 b) {
  return 1.0 - smoothstep(${WARM_FULL.toFixed(4)}, ${WARM_RADIUS.toFixed(4)}, distance(xz, b.xz));
}
float td_warmth(vec2 xz) {
  return max(max(td_warmFrom(xz, uLit0), td_warmFrom(xz, uLit1)), td_warmFrom(xz, uLit2));
}
vec3 td_warm(vec3 c, float w) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, 1.0 + 0.6 * w), 0.0) * mix(vec3(1.0), vec3(1.08, 1.0, 0.9), w);
}
vec3 td_glow(float w) {
  return w * vec3(${WARM_GLOW.map((v) => v.toFixed(4)).join(', ')});
}
`
