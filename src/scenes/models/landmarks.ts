// The Landmarks (§7.1) as they stand in the world, ported from the concept scene onto the world's modelling kit
// (world/models/kit.ts): the beacon tower (`addBeacon`, its fire lit or dead), the hearth (the concept's gate as its
// stone frame, round a fire on a hearthstone), the camp site (`addCamp`), the hamlet (`addHamlet`), the cave mouth (a
// dark arch in a rock mound), the ruins (`addRuins`) and the start (a waystone after the concept's obelisk, its runes
// banked embers). Each stands on y = 0 at its hex centre and fits inside the hex; static parts bake (kit `prepare`).
import * as THREE from 'three'
import type { LandmarkKind } from '../../rules/zone.ts'
import { FOG_LOOK } from '../../world/materials.ts'
import { box, cone, cyl, gable, geo, mat, part, rough, torus } from '../../world/models/kit.ts'
import { EMBER, flame, rod } from './parts.ts'

const STONE = { tower: '#77736b', band: '#55524c', ruin: '#8a867c', slab: '#6e6a62', gate: '#6f6b62', lintel: '#5f5b53', rock: '#5a554d', dark: '#2a2a2e', ash: '#1a1a1c', void: '#050506', way: '#3b3f47' }

/** A roughened copy of a geometry (kit `rough`), cached by key, with nothing pushed below y = 0. */
function roughOn(key: string, make: () => THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  return geo(key, () => {
    const g = rough(make(), amount, seed)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, 0)
    g.computeVertexNormals()
    return g
  })
}

/** A shape's geometry lifted so its base sits on y = 0 (three's primitives are centred). */
const lifted = (g: THREE.BufferGeometry, h: number) => g.translate(0, h / 2, 0)

const stone = (color: string) => mat(color, { flat: true, rough: 0.9 })

function beacon(lit: boolean): THREE.Group {
  const g = new THREE.Group()
  g.add(part(roughOn('lm-beacon-tower', () => lifted(new THREE.CylinderGeometry(0.2, 0.32, 1.05, 8, 3), 1.05), 0.014, 3), stone(STONE.tower)))
  for (let i = 0; i < 3; i++) g.add(part(cyl(0.3 - i * 0.04, 0.31 - i * 0.04, 0.04, 8), stone(STONE.band), [0, 0.12 + i * 0.33, 0]))
  g.add(part(cyl(0.26, 0.15, 0.14, 8), mat(STONE.dark, { flat: true, metal: 0.5, rough: 0.5 }), [0, 1.12, 0]))
  if (lit) {
    const f = flame(1.3)
    f.position.y = 1.1
    g.add(f)
  } else {
    g.add(part(cyl(0.2, 0.2, 0.04, 8), stone(STONE.ash), [0, 1.18, 0]))
  }
  return g
}

function hearth(): THREE.Group {
  const g = new THREE.Group()
  // The stone frame: two leaning pillars and a lintel.
  for (const s of [-1, 1]) g.add(part(box(0.22, 1.7, 0.26), stone(STONE.gate), [s * 0.42, 0.85, 0], [0, 0, s * -0.04]))
  g.add(part(box(1.25, 0.2, 0.3), stone(STONE.lintel), [0, 1.75, 0]))
  // The hearthstone, its embers and the fire.
  g.add(part(roughOn('lm-hearthstone', () => lifted(new THREE.BoxGeometry(0.46, 0.38, 0.34, 2, 2, 2), 0.38), 0.02, 5), stone(STONE.slab)))
  g.add(part(cyl(0.17, 0.15, 0.03, 8), EMBER.outer(), [0, 0.395, 0]))
  const f = flame(1.4, 0.95)
  f.position.y = 0.4
  g.add(f)
  return g
}

function camp(): THREE.Group {
  const g = new THREE.Group()
  // A ring of fire stones round dead logs and a few banked coals.
  const pebble = geo('lm-pebble', () => new THREE.DodecahedronGeometry(0.05, 0))
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7
    g.add(part(pebble, stone('#6c6a66'), [Math.cos(a) * 0.17, 0.045, Math.sin(a) * 0.17], [0, i * 2, 0]))
  }
  g.add(rod([-0.1, 0.03, -0.06], [0.1, 0.05, 0.06], 0.022, 0.02, mat('#3a2a20', { flat: true })))
  g.add(rod([-0.08, 0.05, 0.09], [0.09, 0.03, -0.08], 0.02, 0.022, mat('#33241b', { flat: true })))
  g.add(part(cone(0.06, 0.05, 5), mat('#ff7a2e', { emissive: '#ff5a1a', glow: 1.4, flat: true }), [0, 0.025, 0]))
  // The tent.
  g.add(part(gable(0.42, 0.4, 0.3), mat('#8a7a5e', { flat: true }), [-0.42, 0, -0.26], [0, 0.5, 0]))
  return g
}

function hamlet(): THREE.Group {
  const g = new THREE.Group()
  for (const [x, z, r] of [[-0.3, 0.1, 0.3], [0.25, -0.2, -0.4], [0.3, 0.35, 1.2]]) {
    const h = new THREE.Group()
    h.position.set(x, 0, z)
    h.rotation.y = r
    h.add(part(box(0.3, 0.2, 0.22), stone('#8b7f6c'), [0, 0.1, 0]))
    h.add(part(gable(0.34, 0.26, 0.16), mat('#3d2e2a', { flat: true }), [0, 0.2, 0]))
    // A lit window.
    h.add(part(box(0.045, 0.055, 0.006), mat('#ffc070', { emissive: '#ff9a40', glow: 2.6, flat: true }), [0.06, 0.1, 0.112]))
    g.add(h)
  }
  return g
}

function cave(): THREE.Group {
  const g = new THREE.Group()
  // A rock mound, its mouth a dark arch facing the camera (+z), framed by stones, with a boulder or two.
  g.add(part(roughOn('lm-cave-mound', () => new THREE.SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.07, 7), stone(STONE.rock), [0, 0, -0.05], [0, 0, 0], [1, 0.8, 0.85]))
  g.add(part(geo('lm-cave-mouth', () => new THREE.CircleGeometry(0.21, 10, 0, Math.PI)), mat(STONE.void, { flat: true, rough: 1 }), [0, 0, 0.42]))
  g.add(part(torus(0.235, 0.05, 4, 9, Math.PI), stone('#4b4741'), [0, 0, 0.43]))
  const boulder = roughOn('lm-boulder', () => lifted(new THREE.DodecahedronGeometry(0.11, 0), 0.18), 0.03, 11)
  g.add(part(boulder, stone(STONE.rock), [0.42, 0, 0.3], [0, 0.6, 0]))
  g.add(part(boulder, stone('#4b4741'), [-0.38, 0, 0.36], [0, 2.1, 0], 0.7))
  return g
}

function ruins(): THREE.Group {
  const g = new THREE.Group()
  // Broken columns round a fallen arch on two piers, and a slab.
  const heights = [0.55, 0.3, 0.42, 0.22]
  heights.forEach((h, i) => {
    const a = (i * Math.PI) / 2 + 0.4
    g.add(part(roughOn(`lm-column-${h}`, () => lifted(new THREE.CylinderGeometry(0.07, 0.08, h, 7, 2), h), 0.018, 13 + i), stone(STONE.ruin), [Math.cos(a) * 0.45, 0, Math.sin(a) * 0.4]))
  })
  g.add(part(torus(0.22, 0.05, 4, 8, Math.PI), stone(STONE.ruin), [0, 0.3, -0.15]))
  for (const s of [-1, 1]) g.add(part(box(0.1, 0.3, 0.1), stone(STONE.ruin), [s * 0.22, 0.15, -0.15]))
  g.add(part(box(0.4, 0.06, 0.2), stone(STONE.slab), [0.1, 0.03, 0.3], [0, 0.4, 0]))
  return g
}

function start(): THREE.Group {
  const g = new THREE.Group()
  // A waystone: a square foot, a tapering shaft and a cap, turned to face the camera; on its face, runes like banked
  // embers.
  const q = Math.PI / 4
  g.add(part(cyl(0.3, 0.36, 0.12, 4), stone('#55534e'), [0, 0.06, 0], [0, q, 0]))
  g.add(part(roughOn('lm-way-shaft', () => lifted(new THREE.CylinderGeometry(0.07, 0.13, 0.95, 4, 3), 0.95), 0.01, 17), mat(STONE.way, { flat: true, rough: 0.7 }), [0, 0.12, 0], [0, q, 0]))
  g.add(part(cone(0.075, 0.14, 4), mat(STONE.way, { flat: true, rough: 0.7 }), [0, 1.14, 0], [0, q, 0]))
  const rune = mat('#ff9a48', { emissive: '#ff7a2a', glow: 1.6, flat: true })
  const sizes = [[0.06, 0.02], [0.03, 0.06], [0.05, 0.02], [0.04, 0.03]]
  sizes.forEach(([w, h], i) => {
    const y = 0.38 + i * 0.16
    // The shaft's face lies its half width × cos 45° out, the half width narrowing from 0.13 to 0.07 up the shaft.
    const half = 0.13 - ((y - 0.12) / 0.95) * 0.06
    g.add(part(box(w, h, 0.01), rune, [(i % 2 ? 1 : -1) * 0.012, y, half * Math.SQRT1_2 + 0.004]))
  })
  return g
}

/**
 * The model of a Landmark kind (§7.1), standing on y = 0 at its hex centre, facing the camera (+z). A beacon's fire
 * burns when `lit`. A pass has no model in M1 (gates are M2).
 */
export function makeLandmark(kind: LandmarkKind, lit = false): THREE.Group {
  const g =
    kind === 'beacon' ? beacon(lit)
    : kind === 'hearth' ? hearth()
    : kind === 'camp' ? camp()
    : kind === 'hamlet' ? hamlet()
    : kind === 'cave' ? cave()
    : kind === 'ruins' ? ruins()
    : kind === 'start' ? start()
    : new THREE.Group()
  g.name = `landmark-${kind}${lit ? '-lit' : ''}`
  return g
}

const dimmed = new Map<THREE.Material, THREE.Material>()
const DUSK = FOG_LOOK.DUSK

/**
 * The remembered look of a material (§5.2: remembered landmarks show dimmed), made once per material: as the ground's
 * remembered treatment (30% saturation, then 35% toward the Hush's colour) applied to the lit colour; a fire's ember
 * material burns on at half strength (the same program), and a halo at half its opacity.
 */
function dimOf(m: THREE.Material): THREE.Material {
  let d = dimmed.get(m)
  if (d) return d
  const s = m as THREE.MeshStandardMaterial
  if ((m as THREE.SpriteMaterial).isSpriteMaterial) {
    d = m.clone()
    d.opacity *= 0.5
  } else if (s.isMeshStandardMaterial && !s.vertexColors && s.emissiveIntensity > 1) {
    const f = s.clone()
    f.emissiveIntensity *= 0.5
    f.color.multiplyScalar(0.6)
    d = f
  } else if (s.isMeshStandardMaterial) {
    const r = s.clone()
    r.onBeforeCompile = (shader, renderer) => {
      s.onBeforeCompile(shader, renderer)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// Remembered: dimmed as the remembered ground is.
float td_l = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
gl_FragColor.rgb = mix(mix(vec3(td_l), gl_FragColor.rgb, 0.3), vec3(${DUSK.r.toFixed(4)}, ${DUSK.g.toFixed(4)}, ${DUSK.b.toFixed(4)}), 0.35);`,
      )
    }
    r.customProgramCacheKey = () => `${s.customProgramCacheKey()}|td-remembered`
    d = r
  } else d = m
  dimmed.set(m, d)
  return d
}

/** Shows a Landmark's copy (kit `copyModel`) remembered (dimmed, `dimOf`) or in sight (as built). */
export function dimLandmark(copy: THREE.Object3D, dim: boolean) {
  copy.traverse((o) => {
    const m = o as THREE.Mesh | THREE.Sprite
    if (!(m as THREE.Mesh).isMesh && !(m as THREE.Sprite).isSprite) return
    const lit = (o.userData.tdLit ??= m.material) as THREE.Material
    m.material = dim ? dimOf(lit) : lit
  })
}
