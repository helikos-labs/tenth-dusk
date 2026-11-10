// Parts the hero and the Landmarks share (ported from the concept scene): a rod between two points, a soft additive
// halo round a light, and a flame. Built on the world's modelling kit (world/models/kit.ts): cached geometries and
// materials, ticks through `rig`.
import * as THREE from 'three'
import { cone, cyl, mat, part, rig } from '../../world/models/kit.ts'

const UP = new THREE.Vector3(0, 1, 0)
const dir = new THREE.Vector3()

/** A tapered rod from a to b (radius r0 at a, r1 at b), as a kit part. */
export function rod(a: [number, number, number], b: [number, number, number], r0: number, r1: number, material: THREE.Material, seg = 6): THREE.Mesh {
  dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = dir.length()
  const m = part(cyl(r1, r0, +len.toFixed(4), seg), material, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  m.quaternion.setFromUnitVectors(UP, dir.normalize())
  return m
}

let haloTexture: THREE.DataTexture | null = null

/** A soft round spot (white, fading out from the middle), generated once: the halos' texture. */
function haloMap(): THREE.DataTexture {
  if (haloTexture) return haloTexture
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2))
      // The concept's gradient: full at the centre, 45% a quarter out, nothing at the edge.
      const a = d < 0.25 ? 1 - (d / 0.25) * 0.55 : 0.45 * (1 - (d - 0.25) / 0.75) ** 2
      data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4)
    }
  haloTexture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  haloTexture.magFilter = THREE.LinearFilter
  haloTexture.minFilter = THREE.LinearFilter
  haloTexture.needsUpdate = true
  return haloTexture
}

const haloMaterials = new Map<string, THREE.SpriteMaterial>()

/** A glow of `color` round a light, `size` across: an additive sprite (no shadows, no depth write). */
export function glow(color: string, size: number, opacity: number): THREE.Sprite {
  const k = `${color}|${opacity}`
  let m = haloMaterials.get(k)
  if (!m) {
    m = new THREE.SpriteMaterial({ map: haloMap(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity })
    haloMaterials.set(k, m)
  }
  const s = new THREE.Sprite(m)
  s.scale.setScalar(size)
  return s
}

/** Ember materials: a glowing core that reads as fire (bright enough to bloom), not a lit surface. */
export const EMBER = {
  outer: () => mat('#ff7a2e', { emissive: '#ff6a1e', glow: 2.6, rough: 1, flat: true }),
  inner: () => mat('#ffd27a', { emissive: '#ffc25a', glow: 3.4, rough: 1, flat: true }),
}

/**
 * A flame standing on y = 0 (the concept's `makeFlame`): an outer and an inner cone and three side tongues that
 * flicker, and a warm halo. No light of its own: the scene keeps a fixed set of lights (the lantern's), so revealing a
 * fire never recompiles a shader. Its tick flickers it; `scale` sizes it (0.38 tall at 1), `shine` its halo (across).
 */
export function flame(scale = 1, shine = 1.1): THREE.Group {
  const g = new THREE.Group()
  const outer = part(cone(0.11, 0.38, 6), EMBER.outer(), [0, 0.19, 0])
  const inner = part(cone(0.06, 0.24, 6), EMBER.inner(), [0, 0.12, 0])
  outer.castShadow = inner.castShadow = false
  g.add(outer, inner)
  const sides: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3
    const s = part(cone(0.05, 0.2, 5), EMBER.outer(), [Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06])
    s.castShadow = false
    g.add(s)
    sides.push(s)
  }
  const halo = glow('#ff8a3d', shine, 0.7)
  halo.position.y = 0.2
  g.add(halo)
  g.scale.setScalar(scale)
  const w = (k: number) => (Math.PI * 2 * k) / 4
  return rig(g, (pick) => {
    const o = pick(outer)
    const n = pick(inner)
    const ss = sides.map((s) => pick(s))
    const sh = pick(halo)
    return (t) => {
      const f = 1 + Math.sin(t * w(9)) * 0.12 + Math.sin(t * w(13) + 1) * 0.08
      o.scale.set(1, f, 1)
      n.scale.set(1, 2 - f, 1)
      o.rotation.y = t * w(1)
      ss.forEach((s, i) => (s.scale.y = 1 + Math.sin(t * w(10) + i * 2) * 0.25))
      sh.scale.setScalar(shine * (0.92 + 0.08 * f))
    }
  })
}
