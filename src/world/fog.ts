// Fog of war for the world (§5.2, §15.4): each hex's fog state goes into texel 2 of its slot in the shaders' state
// texture (materials.ts), which the ground, plants, water and mist read through the warp, so fog edges follow the
// organic province borders. Revealing hexes only rewrites the texture; nothing is rebuilt.
import type * as THREE from 'three'
import { toOffset } from '../rules/hex.ts'
import type { Fog } from '../rules/sight.ts'
import { TEXELS } from './materials.ts'

/** `r` per fog state (0 unseen, 1 sunk, 2 remembered, 3 in sight): the shaders read it back as round(r × 3). */
const FOG_R = [0, 85, 170, 255] as const

/**
 * Texel 2 of a hex: r = fog state, g = marker kind (none in M1), b = reachable highlight (set by `writeFog`),
 * a = 255 for a wall hex (outside the zone).
 */
export function fogByte(f: Fog, wall: boolean): [r: number, g: number, b: number, a: number] {
  return [FOG_R[f], 0, 0, wall ? 255 : 0]
}

/**
 * Writes texel 2 of every slot in `slots` (keyed by world key "q,r", the engine's hex index) from `fog`, `walls` and
 * `highlight` (keyed by the rules' offset key "row,col"; a hex missing from `fog` is unseen), and marks the texture
 * for upload. Texels 0 and 1 are left as they are.
 */
export function writeFog(tex: THREE.DataTexture, slots: Map<string, number>, fog: Map<string, Fog>, walls: Set<string>, highlight: Set<string>): void {
  const data = tex.image.data as Uint8Array
  for (const [k, slot] of slots) {
    const [q, r] = k.split(',').map(Number)
    const o = toOffset({ q, r })
    const off = `${o.row},${o.col}`
    const px = fogByte(fog.get(off) ?? 0, walls.has(off))
    if (highlight.has(off)) px[2] = 255
    data.set(px, (slot * TEXELS + 2) * 4)
  }
  tex.needsUpdate = true
}
