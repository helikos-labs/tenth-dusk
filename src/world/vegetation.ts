// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/vegetation.ts, adapted for Tenth Dusk.
// Plants and rocks for the 3D board, all instanced: pine and broadleaf woods (denser and darker in old wood), grass
// tufts, a different mix of flowers in every field, heath with its own flowers and stones but no trees, reeds round the
// marsh pools, boulders and hardy pines on the mountains. Placement is seeded by each hex's coordinates, so a hex keeps
// the same trees and flowers for the whole game. Plants sway in the wind (materials.ts).
//
// ORGANIC CONCEPT: plants follow the warped provinces, not hexagons. Each hex scatters candidates over a disc round its
// centre and keeps those its province owns, so woods fill their meandering outline; trees thin out raggedly towards a
// wood's edge and spill into the meadow as a fringe of young trees and bushes; reeds stand in the lake margins; boulders
// fan out round a range's foot; the islets off a sea wall get rocks and a few pines.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WorldCell } from './adapter.ts'
import { SQRT3, WARP, WATER_LEVEL, fbm, fray, hash01, hexCenter, smoothstep, type Field, type Probe, type Rect } from './field.ts'
import { flowersOf } from './flora.ts'
import { onRim } from './layout.ts'
import { castShadows, plantDepthMaterials, windPatch, type FogUniforms } from './materials.ts'
import { LATTICE } from './terrainMesh.ts'

/** Hex centres keep a clearing this wide for the hero and Landmarks. */
export const CLEARING = 0.34
/** Old wood (§15.3): its trees stand this many times as thick as a forest's, and darker. */
export const OLD_WOOD = { density: 1.6, shade: 0.72 }

/** mulberry32 seeded from a hex. */
function rng(q: number, r: number, salt: number) {
  let s = (Math.floor(hash01(q, r, salt) * 4294967296) ^ 0x9e3779b9) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random point in the ring between radii `inner` and `outer` round a centre, uniform by area. */
function discPoint(rand: () => number, inner: number, outer: number) {
  const a = rand() * Math.PI * 2
  const rr = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner))
  return { x: Math.cos(a) * rr, z: Math.sin(a) * rr }
}

/** A province reaches at most this far from its hex centre (the hex's corner plus the warp); a rim province also owns
 * the coastal strip beyond the board, out to its capes. */
const REACH = 1 + WARP.max
const RIM_REACH = 2.8

// ---------------------------------------------------------------- geometry kit

function paint(g: THREE.BufferGeometry, color: THREE.Color | ((y: number, x: number, z: number) => THREE.Color)) {
  const p = g.getAttribute('position')
  const c = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const col = typeof color === 'function' ? color(p.getY(i), p.getX(i), p.getZ(i)) : color
    c.set([col.r, col.g, col.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/**
 * Nudges vertices by a seeded amount so shapes read hand-made, not machined. The offset is a hash of the vertex's
 * position, so copies of one corner (seams, faces of a polyhedron) move together and nothing tears open.
 */
export function jitter(g: THREE.BufferGeometry, amount: number, seed: number) {
  const p = g.getAttribute('position')
  const h = (k: number) => {
    let t = (k ^ 0x9e3779b9) >>> 0
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b)
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35)
    return (((t ^ (t >>> 16)) >>> 0) / 4294967296 - 0.5) * 2
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = (Math.imul(Math.round(x * 997), 73856093) ^ Math.imul(Math.round(y * 997), 19349663) ^ Math.imul(Math.round(z * 997), 83492791) ^ seed) >>> 0
    p.setXYZ(i, x + h(k) * amount, y + h(k + 1) * amount * 0.6, z + h(k + 2) * amount)
  }
  g.computeVertexNormals()
  return g
}

const C = (hex: string) => new THREE.Color(hex)
const strip = (g: THREE.BufferGeometry) => {
  const out = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color'].includes(k)) out.deleteAttribute(k)
  return out
}

function conifer(): THREE.BufferGeometry {
  const parts = [paint(new THREE.CylinderGeometry(0.016, 0.024, 0.13, 5).translate(0, 0.065, 0), C('#5b3d25'))]
  const tiers = [
    [0.135, 0.23, 0.2, '#244b29'],
    [0.11, 0.21, 0.31, '#2b5a2f'],
    [0.08, 0.19, 0.42, '#356a37'],
  ] as const
  tiers.forEach(([r, h, y, c], i) => parts.push(paint(jitter(new THREE.ConeGeometry(r, h, 8, 1).translate(0, y, 0), 0.012, 11 + i), C(c))))
  return mergeGeometries(parts.map(strip))!
}

function broadleaf(): THREE.BufferGeometry {
  const parts = [paint(new THREE.CylinderGeometry(0.02, 0.03, 0.17, 6).translate(0, 0.085, 0), C('#62452c'))]
  const blobs = [
    [0, 0.25, 0, 0.12, '#3f6f2c'],
    [0.07, 0.22, 0.03, 0.09, '#4a7d31'],
    [-0.06, 0.23, -0.04, 0.095, '#3a6729'],
    [0.01, 0.33, -0.02, 0.085, '#5a9038'],
  ] as const
  blobs.forEach(([x, y, z, r, c], i) => parts.push(paint(jitter(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), 0.014, 31 + i), C(c))))
  return mergeGeometries(parts.map(strip))!
}

function tuft(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const base = C('#3e6a26')
  const tip = C('#a9c45e')
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + i * 0.4
    const lean = 0.018 + (i % 3) * 0.008
    const h = 0.05 + (i % 4) * 0.012
    const w = 0.006
    const bx = Math.cos(a) * 0.01
    const bz = Math.sin(a) * 0.01
    const px = -Math.sin(a) * w
    const pz = Math.cos(a) * w
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean)
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  // Blades face every way; give them an upward normal so they light like the ground.
  const n = g.getAttribute('normal')
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0)
  return g
}

/** A clump of reeds: tall thin blades and two cattail heads. */
function reed(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const base = C('#3f5424')
  const tip = C('#b3a565')
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + i * 0.7
    const lean = 0.008 + (i % 3) * 0.006
    const h = 0.1 + (i % 4) * 0.02
    const w = 0.0045
    const bx = Math.cos(a) * 0.012
    const bz = Math.sin(a) * 0.012
    const px = -Math.sin(a) * w
    const pz = Math.cos(a) * w
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean)
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b)
  }
  const blades = new THREE.BufferGeometry()
  blades.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  blades.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  blades.computeVertexNormals()
  const n = blades.getAttribute('normal')
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0)
  const parts = [blades]
  for (const [x, z, y] of [
    [0.006, 0.004, 0.15],
    [-0.008, -0.005, 0.13],
  ]) {
    parts.push(paint(new THREE.CylinderGeometry(0.0022, 0.0022, y, 3).translate(x, y / 2, z), C('#4d5f2a')))
    parts.push(paint(new THREE.CylinderGeometry(0.0075, 0.0075, 0.032, 6).translate(x, y - 0.012, z), C('#5a3a20')))
  }
  return mergeGeometries(parts.map(strip))!
}

function stem(): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(0.0025, 0.003, 0.065, 3).translate(0, 0.0325, 0), C('#3f7a2c'))
}

function bloom(): THREE.BufferGeometry {
  const head = new THREE.IcosahedronGeometry(0.017, 0).scale(1, 0.55, 1).translate(0, 0.066, 0)
  return paint(head, C('#ffffff'))
}

function boulder(seed: number): THREE.BufferGeometry {
  return paint(
    jitter(new THREE.IcosahedronGeometry(0.06, 0).scale(1.2, 0.75, 1), 0.016, seed),
    (y) => C('#80786b').lerp(C('#5b544a'), Math.max(0, -y * 8)),
  )
}

// ---------------------------------------------------------------- placement
//
// Placement is plain numbers (an instance matrix and a tint a plant), with no three.js objects in it but colours and
// matrix maths, so the world worker (world.worker.ts) does it off the main thread. A province draws its plants from its
// own seed and reads the field only inside its own province, so after a change of terrain only the provinces near it
// are placed again (worldBuild.ts) and every other province keeps exactly the plants it had.

/** The kinds of plant; each is one instanced mesh (flowers are two: stems and heads on the same spots). */
export const PLANT_KINDS = ['conifer', 'oak', 'tuft', 'reed', 'flower', 'rock'] as const
export type PlantKind = (typeof PLANT_KINDS)[number]
/** Kinds drawn without a tint of their own. */
const UNTINTED: readonly PlantKind[] = ['rock']

/** One province's plants (or the islets'): per kind, 16 matrix numbers a plant and, if tinted, 3 colour numbers. */
export type PlantLists = Record<PlantKind, { matrix: number[]; color: number[] }>

/** Every plant of one kind on the board, ready for an instanced mesh. */
export interface PlantSet {
  count: number
  matrix: Float32Array
  color: Float32Array | null
}
export type PlantSets = Record<PlantKind, PlantSet>

interface Placement {
  x: number
  y: number
  z: number
  s: number
  rot: number
  tilt?: number
  color?: THREE.Color
}

const emptyLists = () => Object.fromEntries(PLANT_KINDS.map((k) => [k, { matrix: [], color: [] }])) as unknown as PlantLists

const mat4 = new THREE.Matrix4()
const quat = new THREE.Quaternion()
const euler = new THREE.Euler()
const spot = new THREE.Vector3()
const size = new THREE.Vector3()

/** Adds a plant: its matrix (turned, tilted, scaled and set down) and its tint. */
function put(lists: PlantLists, kind: PlantKind, p: Placement) {
  euler.set(p.tilt ?? 0, p.rot, (p.tilt ?? 0) * 0.6)
  quat.setFromEuler(euler)
  mat4.compose(spot.set(p.x, p.y, p.z), quat, size.set(p.s, p.s, p.s))
  const list = lists[kind]
  for (let i = 0; i < 16; i++) list.matrix.push(mat4.elements[i])
  if (p.color) list.color.push(p.color.r, p.color.g, p.color.b)
}

const tint = (rand: () => number, spread: number) => new THREE.Color(1, 1, 1).multiplyScalar(1 - spread / 2 + rand() * spread)
/** How much meadow a point is (the colour blend's grass weight, so grass thins out where the ground turns). */
const meadow = (pr: Probe, x: number, z: number) => smoothstep(-0.12, 0.12, pr.sd.grassland + fray('grassland', x, z))
/** Wet banks and beaches stay clear of grass and trees. */
const wetBank = (pr: Probe) => pr.lake < 0.07 || pr.coast < 0.14

/**
 * One province's plants: its terrain from `field`, and a clearing round a Landmark on `cell`. Seeded by
 * the hex and reading the field only inside the province, so they change only when the ground there changes.
 */
export function placeProvince(field: Field, cell: WorldCell, detail = 1): PlantLists {
  const out = emptyLists()
  const c = hexCenter(cell.q, cell.r)
  const rand = rng(cell.q, cell.r, 1)
  const busy = !!cell.landmark
  const inner = busy ? CLEARING + 0.1 : CLEARING
  const rim = onRim(field, cell)
  const reach = rim ? RIM_REACH : REACH
  /** More tries over a rim province's larger disc keep the same density. */
  const more = (k: number) => Math.round(k * (rim ? (RIM_REACH / REACH) ** 2 * 0.75 : 1))
  /** A random point of this hex's province (rejection-sampled from a disc round the centre), or null. */
  const sample = (from: number): { p: { x: number; z: number }; x: number; z: number } | null => {
    const p = discPoint(rand, from, reach)
    const x = c.x + p.x
    const z = c.z + p.z
    return field.provinceAt(x, z) === cell ? { p, x, z } : null
  }
  // Keep a sight line from the table to the clearing, so the hero among the trees stays visible.
  const inFront = (p: { x: number; z: number }) => p.z > 0.04 && Math.abs(p.x) < 0.17 + 0.35 * p.z && p.z < 0.8

  if (cell.terrain === 'forest') {
    // Some woods are mostly pine, some mostly oak. Old wood packs its trees closer (more tries, less room each).
    const pine = 0.25 + hash01(cell.q, cell.r, 5) * 0.6
    const placed: { x: number; z: number }[] = []
    const thick = cell.dense ? OLD_WOOD.density : 1
    const room = 0.15 / Math.sqrt(thick)
    const tries = more((busy ? 95 : 130) * thick * detail)
    for (let t = 0; t < tries; t++) {
      const s = sample(inner)
      if (!s || inFront(s.p) || placed.some((o) => Math.hypot(o.x - s.p.x, o.z - s.p.z) < room)) continue
      const pr = field.probe(s.x, s.z)
      // Ragged edges: the wood thins out towards its border.
      if (pr.sd.forest + fray('forest', s.x, s.z) < 0.28 * rand() || wetBank(pr) || pr.height < WATER_LEVEL + 0.01) continue
      placed.push(s.p)
      const color = tint(rand, 0.32)
      if (cell.dense) color.multiplyScalar(OLD_WOOD.shade)
      const item = { x: s.x, y: pr.height - 0.004, z: s.z, s: 0.82 + rand() * 0.45, rot: rand() * Math.PI * 2, color }
      put(out, rand() < pine ? 'conifer' : 'oak', item)
    }
  }

  if (cell.terrain === 'grassland' || cell.terrain === 'forest' || cell.terrain === 'blight') {
    // Grass wherever the ground is meadow, thinning out across the blend into the next terrain.
    const nt = more((cell.terrain === 'grassland' ? 190 : 60) * detail)
    for (let i = 0; i < nt; i++) {
      const s = sample(0.05)
      if (!s) continue
      const pr = field.probe(s.x, s.z)
      if (rand() > meadow(pr, s.x, s.z) || wetBank(pr) || pr.height < WATER_LEVEL + 0.01) continue
      put(out, 'tuft', { x: s.x, y: pr.height - 0.004, z: s.z, s: 0.75 + rand() * 0.7, rot: rand() * Math.PI * 2, color: tint(rand, 0.35) })
    }
  }

  if (cell.terrain === 'grassland') {
    // The wood's fringe: young trees and bushes straggle out into the meadow, and a few stand alone in the fields.
    // Heath grows none.
    const nf = cell.heath ? 0 : more(70 * detail)
    for (let i = 0; i < nf; i++) {
      const s = sample(inner)
      if (!s || inFront(s.p)) continue
      const pr = field.probe(s.x, s.z)
      if (wetBank(pr) || pr.height < WATER_LEVEL + 0.01) continue
      const fringe = pr.sd.forest > -0.45 ? Math.pow(1 + pr.sd.forest / 0.45, 1.6) * 0.55 : 0
      if (rand() > Math.max(fringe, 0.012)) continue
      const bush = rand() < 0.5
      const item = { x: s.x, y: pr.height - 0.004, z: s.z, s: bush ? 0.32 + rand() * 0.18 : 0.55 + rand() * 0.3, rot: rand() * Math.PI * 2, color: tint(rand, 0.3) }
      put(out, bush || rand() < 0.45 ? 'oak' : 'conifer', item)
    }
    // Flowers grow in clumps: a main kind and a second kind per field.
    const { main, second } = flowersOf(cell.q, cell.r, cell.heath)
    const clumps = 4 + Math.floor(rand() * 3)
    for (let k = 0, tries = 0; k < clumps && tries < 40; tries++) {
      const cc = sample(busy ? CLEARING : 0.18)
      if (!cc) continue
      const kind = k === clumps - 1 ? second : main
      k++
      const count = Math.round((16 + rand() * 10) * detail)
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2
        const d = Math.abs(rand() + rand() - 1) * 0.2
        const x = cc.x + Math.cos(a) * d
        const z = cc.z + Math.sin(a) * d
        if (field.provinceAt(x, z) !== cell) continue
        const pr = field.probe(x, z)
        if (meadow(pr, x, z) < 0.6 || wetBank(pr)) continue
        const color = new THREE.Color(kind.color).multiplyScalar(0.85 + rand() * 0.3)
        put(out, 'flower', { x, y: pr.height - 0.004, z, s: 0.8 + rand() * 0.5, rot: rand() * Math.PI * 2, color })
      }
    }
  }

  if (cell.terrain !== 'mountain') {
    // Reeds in clumps along the lake margins: in the shallows and on the wet bank. A marsh's pools (field.ts: where its
    // sunken ground drops below the water) get the same margins.
    const marsh = cell.terrain === 'blight'
    const nr = more((cell.terrain === 'water' ? 260 : marsh ? 220 : 90) * detail)
    for (let i = 0; i < nr; i++) {
      const s = sample(cell.terrain === 'water' ? 0 : inner)
      if (!s) continue
      if (fbm(s.x * 3.2, s.z * 3.2, 81, 2) < 0.5) continue
      const pr = field.probe(s.x, s.z)
      const shallow = (pr.ground === 'water' || (pr.ground === 'blight' && pr.height < WATER_LEVEL)) && WATER_LEVEL - pr.height < 0.035
      const bank = pr.ground !== 'water' && pr.ground !== 'sea' && (pr.lake < 0.06 || (pr.ground === 'blight' && pr.height < WATER_LEVEL + 0.05))
      if (!shallow && !bank) continue
      put(out, 'reed', { x: s.x, y: pr.height - 0.004, z: s.z, s: 0.8 + rand() * 0.6, rot: rand() * Math.PI * 2, color: tint(rand, 0.3) })
    }
  }

  if (cell.terrain === 'mountain') {
    for (let i = 0; i < more(26); i++) {
      const s = sample(0.15)
      if (!s) continue
      const pr = field.probe(s.x, s.z)
      const y = pr.height - 0.004
      if (rand() < 0.42) put(out, 'rock', { x: s.x, y: y - 0.01, z: s.z, s: 0.7 + rand() * 0.9, rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.5 })
      // Hardy pines on the lower slopes (measured from the terrace the range stands on).
      else if (y - pr.terrace < 0.34 && y > WATER_LEVEL + 0.02 && rand() < 0.5) put(out, 'conifer', { x: s.x, y, z: s.z, s: 0.55 + rand() * 0.3, rot: rand() * 6.28, color: tint(rand, 0.25) })
    }
  } else if (cell.terrain !== 'water') {
    // Boulders fan out round a range's foot.
    for (let i = 0; i < more(40); i++) {
      const s = sample(inner)
      if (!s) continue
      const pr = field.probe(s.x, s.z)
      if (pr.sd.mountain < -0.3 || rand() > (1 + pr.sd.mountain / 0.3) * 0.5) continue
      put(out, 'rock', { x: s.x, y: pr.height - 0.014, z: s.z, s: 0.35 + rand() * 0.45, rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.5 })
    }
  }

  if (cell.heath) {
    // Stones scattered over the heath.
    for (let i = 0; i < more(16); i++) {
      const s = sample(inner)
      if (!s) continue
      const pr = field.probe(s.x, s.z)
      if (pr.heath < 0.1 * rand() || wetBank(pr)) continue
      put(out, 'rock', { x: s.x, y: pr.height - 0.012, z: s.z, s: 0.3 + rand() * 0.5, rot: rand() * Math.PI * 2, tilt: (rand() - 0.5) * 0.5 })
    }
  }
  return out
}

/** Islet candidates per unit of ground (Rift & Root's 2600 over its ring of sea). */
const ISLET_DENSITY = 18

/**
 * The bands along the sides of the bounds whose outermost hexes are all water (a sea wall), from inside the board's
 * notched outline out to the lattice's edge. The walls of peaks get none: they stand on the Hush.
 */
export function seaSides(field: Field): Rect[] {
  const b = field.bounds
  const cells = Object.values(field.board)
  const out = LATTICE.OUTER_MARGIN
  const sides: { at: (x: number, z: number) => boolean; band: Rect }[] = [
    { at: (x) => x <= b.minX + SQRT3 + 0.01, band: { minX: b.minX - out, maxX: b.minX + 1.5, minZ: b.minZ - out, maxZ: b.maxZ + out } },
    { at: (x) => x >= b.maxX - SQRT3 - 0.01, band: { minX: b.maxX - 1.5, maxX: b.maxX + out, minZ: b.minZ - out, maxZ: b.maxZ + out } },
    { at: (_x, z) => z <= b.minZ + 1.01, band: { minX: b.minX - out, maxX: b.maxX + out, minZ: b.minZ - out, maxZ: b.minZ + 1.5 } },
    { at: (_x, z) => z >= b.maxZ - 1.01, band: { minX: b.minX - out, maxX: b.maxX + out, minZ: b.maxZ - 1.5, maxZ: b.maxZ + out } },
  ]
  return sides
    .filter((s) => {
      const edge = cells.filter((c) => {
        const p = hexCenter(c.q, c.r)
        return s.at(p.x, p.z)
      })
      return edge.length > 0 && edge.every((c) => c.terrain === 'water')
    })
    .map((s) => s.band)
}

/**
 * Off the board along its sea walls (`seaSides`): rocks and a few wind-bent pines on the islets and capes, and
 * boulders in the shallows under cliffs. They stand outside every province, where nothing changes in a game, so a world
 * places them once.
 */
export function placeIslets(field: Field): PlantLists {
  const out = emptyLists()
  const rand = rng(97, -41, 3)
  // Candidates over each sea band, by area.
  const spots: { x: number; z: number }[] = []
  for (const b of seaSides(field)) {
    const n = Math.round((b.maxX - b.minX) * (b.maxZ - b.minZ) * ISLET_DENSITY)
    for (let i = 0; i < n; i++) spots.push({ x: b.minX + rand() * (b.maxX - b.minX), z: b.minZ + rand() * (b.maxZ - b.minZ) })
  }
  for (const p of spots) {
    if (field.provinceAt(p.x, p.z)) continue
    const pr = field.probe(p.x, p.z)
    const above = pr.height - WATER_LEVEL
    if (above > 0.03) {
      const r = rand()
      if (r < 0.1) put(out, 'rock', { x: p.x, y: pr.height - 0.012, z: p.z, s: 0.5 + rand() * 0.9, rot: rand() * 6.28, tilt: (rand() - 0.5) * 0.6 })
      else if (r < 0.15 && above > 0.06) put(out, 'conifer', { x: p.x, y: pr.height - 0.004, z: p.z, s: 0.5 + rand() * 0.3, rot: rand() * 6.28, tilt: 0.12, color: tint(rand, 0.25) })
      else if (r < 0.3) put(out, 'tuft', { x: p.x, y: pr.height - 0.004, z: p.z, s: 0.7 + rand() * 0.5, rot: rand() * 6.28, color: tint(rand, 0.3).multiplyScalar(0.9) })
    } else if (above > -0.1 && pr.cliff > 0.5 && pr.sd.sea < 0.35 && rand() < 0.05) {
      put(out, 'rock', { x: p.x, y: pr.height + 0.01, z: p.z, s: 0.6 + rand() * 0.8, rot: rand() * 6.28, tilt: (rand() - 0.5) * 0.6 })
    }
  }
  return out
}

/** Provinces in reading order (rows from the top, each from the left): the order their plants are joined in. */
export const readingOrder = (board: Record<string, WorldCell>): WorldCell[] => Object.values(board).sort((a, b) => a.r - b.r || a.q - b.q)

/** Joins plant lists, in the order given, into one set per kind. */
export function joinPlants(parts: PlantLists[]): PlantSets {
  const sets = {} as PlantSets
  for (const kind of PLANT_KINDS) {
    let m = 0
    let c = 0
    for (const p of parts) {
      m += p[kind].matrix.length
      c += p[kind].color.length
    }
    const matrix = new Float32Array(m)
    const color = UNTINTED.includes(kind) ? null : new Float32Array(c)
    m = 0
    c = 0
    for (const p of parts) {
      matrix.set(p[kind].matrix, m)
      m += p[kind].matrix.length
      if (color) color.set(p[kind].color, c)
      c += p[kind].color.length
    }
    sets[kind] = { count: matrix.length / 16, matrix, color }
  }
  return sets
}

/** Every province's plants and the islets', placed at once on this thread (what the world worker does). */
export function plantsFor(field: Field, board: Record<string, WorldCell>, detail = 1): PlantSets {
  return joinPlants([...readingOrder(board).map((c) => placeProvince(field, c, detail)), placeIslets(field)])
}

// ---------------------------------------------------------------- instanced meshes (main thread)

interface Part {
  kind: PlantKind
  geo: THREE.BufferGeometry
  mat: THREE.Material
  cast: boolean
  tinted: boolean
  mesh: THREE.InstancedMesh | null
}

/**
 * The plants' instanced meshes for one board. Geometry and materials are made once; each update copies the new
 * instances into the meshes, and a mesh is made anew only when its kind outgrows it.
 */
export class PlantMeshes {
  readonly group = new THREE.Group()
  private parts: Part[]
  /** With the fog: the plants' own shadow depth materials, which hide unseen plants' shadows too. */
  private depth: ReturnType<typeof plantDepthMaterials> | null

  /** With the fog's uniforms (materials.ts FogUniforms) the plants show the fog of war (`windPatch`). */
  constructor(uniforms: { uTime: { value: number } } & Partial<FogUniforms>) {
    this.depth = uniforms.uState ? plantDepthMaterials(uniforms as FogUniforms) : null
    const plant = (sway: number, key: string, opts: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts })
      windPatch(m, uniforms, sway, key)
      return m
    }
    const part = (kind: PlantKind, geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, tinted = !UNTINTED.includes(kind)): Part => ({
      kind,
      geo,
      mat,
      cast,
      tinted,
      mesh: null,
    })
    this.parts = [
      part('conifer', conifer(), plant(0.08, 'tree'), true),
      part('oak', broadleaf(), plant(0.07, 'oak'), true),
      part('tuft', tuft(), plant(2.4, 'grass', { side: THREE.DoubleSide, roughness: 0.95 }), false),
      part('reed', reed(), plant(1.6, 'reed', { side: THREE.DoubleSide, roughness: 0.9 }), false),
      // Flower stems stand on the heads' spots, untinted.
      part('flower', stem(), plant(2.2, 'stem'), false, false),
      part('flower', bloom(), plant(2.2, 'bloom', { roughness: 0.6 }), false),
      // Rocks don't sway; the patch gives them the fog.
      part('rock', boulder(7), plant(0, 'rock', { roughness: 0.95, flatShading: true }), true),
    ]
  }

  /**
   * One stand-in instanced mesh per kind, drawn with its material and instancing as the real ones are, for compiling
   * their programs (and their shadows') before the first plants arrive (materials.ts warmUp).
   */
  standIns(): THREE.Group {
    const g = new THREE.Group()
    for (const p of this.parts) {
      const m = new THREE.InstancedMesh(p.geo, p.mat, 1)
      if (p.tinted) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3)
      m.castShadow = p.cast
      this.shade(m, p)
      g.add(m)
    }
    return g
  }

  /** Shows these plants (each kind's complete set). */
  set(sets: PlantSets) {
    for (const p of this.parts) {
      const s = sets[p.kind]
      let mesh = p.mesh
      if (!mesh || mesh.instanceMatrix.count < s.count) {
        if (mesh) {
          this.group.remove(mesh)
          mesh.dispose()
        }
        // Room to grow, so an update rarely needs a new mesh.
        mesh = p.mesh = this.make(p, Math.max(16, Math.ceil(s.count * 1.25)))
      }
      fill(mesh.instanceMatrix, s.matrix)
      if (mesh.instanceColor && s.color) fill(mesh.instanceColor, s.color)
      mesh.count = s.count
      mesh.visible = s.count > 0
    }
  }

  /** Frees what the GPU holds (geometry, materials, instances); the meshes stay usable and upload again if drawn. */
  dispose() {
    for (const p of this.parts) {
      p.geo.dispose()
      p.mat.dispose()
      p.mesh?.dispose()
    }
    this.depth?.instanced.dispose()
    this.depth?.tinted.dispose()
  }

  /** A mesh's shadow depth material: the fog's own when the plants show the fog, else the shared one (castShadows). */
  private shade(mesh: THREE.InstancedMesh, p: Part) {
    if (this.depth && p.cast) mesh.customDepthMaterial = mesh.instanceColor ? this.depth.tinted : this.depth.instanced
    castShadows(mesh)
  }

  private make(p: Part, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(p.geo, p.mat, capacity)
    if (p.tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.castShadow = p.cast
    this.shade(mesh, p)
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.raycast = () => {}
    this.group.add(mesh)
    return mesh
  }
}

/** Copies instance data into the start of an instance buffer and marks just that much for upload. */
function fill(attr: THREE.InstancedBufferAttribute, data: Float32Array) {
  if (!data.length) return
  ;(attr.array as Float32Array).set(data)
  attr.clearUpdateRanges()
  attr.addUpdateRange(0, data.length)
  attr.needsUpdate = true
}

export interface Vegetation {
  group: THREE.Group
  dispose(): void
}

/**
 * Plant everything for a board at once on this thread: terrain from `field`, clearings round the Landmarks on
 * `board`. The board itself builds plants in the world worker (useWorld.ts); this is for scripts.
 */
export function buildVegetation(field: Field, board: Record<string, WorldCell>, uniforms: { uTime: { value: number } }, detail = 1): Vegetation {
  const meshes = new PlantMeshes(uniforms)
  meshes.set(plantsFor(field, board, detail))
  return { group: meshes.group, dispose: () => meshes.dispose() }
}
