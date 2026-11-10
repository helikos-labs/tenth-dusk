// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/models/kit.ts, adapted for Tenth Dusk.
// The modelling kit for the 3D board's pieces: cached materials, primitive parts and a jitter for a hand-made look.
// Every model is a THREE.Group built from these parts, standing on y = 0 at its hex centre, sized in hex units (a hex
// has circumradius 1; a piece fits inside radius 0.34 unless it is a Landmark). A model animates itself through ticks
// (`rig`): `userData.tick(time, delta)` on its root or a part, which the board calls every frame.
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface MatOpts {
  rough?: number
  metal?: number
  emissive?: string
  glow?: number
  flat?: boolean
  opacity?: number
  side?: THREE.Side
}

const cache = new Map<string, THREE.MeshStandardMaterial>()
/** The materials `mat` made: shared and never changed, so a model's static parts can bake their look into vertices. */
const shared = new WeakSet<THREE.Material>()

/** A shared material per colour and options; never dispose these. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.glow ?? 0}|${o.flat ? 1 : 0}|${o.opacity ?? 1}|${o.side ?? 0}`
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.8,
      metalness: o.metal ?? 0,
      flatShading: o.flat ?? false,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.glow ?? (o.emissive ? 1 : 0),
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: (o.opacity ?? 1) >= 1,
    })
    cache.set(key, m)
    shared.add(m)
  }
  return m
}

/** A mesh that casts and receives shadows, placed and turned. */
export function part(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  at: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: number | [number, number, number] = 1,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material)
  m.position.set(...at)
  m.rotation.set(...rot)
  if (typeof scale === 'number') m.scale.setScalar(scale)
  else m.scale.set(...scale)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  for (const c of children) g.add(c)
  return g
}

// Shared geometries: reuse these instead of making new ones per piece.
const geoCache = new Map<string, THREE.BufferGeometry>()

/** When a slice of the board's background work must stop (`performance.now()` milliseconds; see `prepare`). */
export interface Slice {
  end: number
}
/** The slice a model kind is being built in, if it is built in slices (see `prepare`). */
let slicing: Slice | null = null
/** Geometries and steps made since the build last started (see `prepare`): each start makes at least one. */
let made = 0
/** Thrown by `geo` when a model built in slices runs out of its slice before making a geometry it has not made yet. */
const OUT_OF_TIME = new Error('model build paused: its slice is used up')

/** Whether a build in slices should stop here: its slice is up, and it has made something since it last started. */
const outOfTime = () => !!slicing && made > 0 && performance.now() >= slicing.end

/**
 * A shared geometry, made once per key. While a model kind is built in slices (`prepare`), a geometry not made yet
 * waits for the next slice once this one is used up: the build stops here and starts again from the top in the next
 * slice, finding every geometry it made so far in the cache.
 */
export function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key)
  if (!g) {
    if (outOfTime()) throw OUT_OF_TIME
    g = make()
    geoCache.set(key, g)
    made++
  }
  return g
}

/** The steps of the model being built (see `step`), kept until it is built. */
const steps = new Map<string, unknown>()

/**
 * One step of a model's build, named by `key` (unique to that model): it runs once and its result is kept until the
 * model is built, so a build its slice cuts short (see `geo`) takes up after it in the next slice. For a geometry that
 * takes long to make, a step per part.
 */
export function step<T>(key: string, make: () => T): T {
  if (steps.has(key)) return steps.get(key) as T
  if (outOfTime()) throw OUT_OF_TIME
  const v = make()
  steps.set(key, v)
  made++
  return v
}

export const box = (w: number, h: number, d: number) => geo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d))
export const cyl = (rt: number, rb: number, h: number, seg = 10) => geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))
export const cone = (r: number, h: number, seg = 10) => geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg))
export const sphere = (r: number, w = 12, h = 8) => geo(`sph${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h))
export const ico = (r: number, detail = 0) => geo(`ico${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail))
export const torus = (r: number, tube: number, rs = 6, ts = 16, arc = Math.PI * 2) =>
  geo(`tor${r},${tube},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc))

/** A gabled roof (a triangular prism) along x: width w, depth d, height h, sitting on y = 0. */
export const gable = (w: number, d: number, h: number) =>
  geo(`gable${w},${d},${h}`, () => {
    const s = new THREE.Shape()
    s.moveTo(-d / 2, 0)
    s.lineTo(d / 2, 0)
    s.lineTo(0, h)
    s.lineTo(-d / 2, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false })
    g.translate(0, 0, -w / 2)
    g.rotateY(Math.PI / 2)
    g.computeVertexNormals()
    return g
  })

/**
 * A copy of a geometry: its index, attributes and groups, each array copied once (BufferGeometry.clone copies typed
 * attributes twice and carries bounds and user data the models never read).
 */
export function dup(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  const copy = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
    (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? a.clone() : new THREE.BufferAttribute(a.array.slice(), a.itemSize, a.normalized)
  if (g.index) out.setIndex(copy(g.index) as THREE.BufferAttribute)
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, copy(a))
  for (const { start, count, materialIndex } of g.groups) out.addGroup(start, count, materialIndex)
  return out
}

const placeMatrix = new THREE.Matrix4()
const placeNormals = new THREE.Matrix3()

/** An attribute's array, to read directly if it is a plain one of three numbers per vertex. */
const plainArray = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) =>
  a && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.itemSize === 3 && !a.normalized ? a.array : null

/**
 * Writes geometry `g` moved by matrix `m` (elements `e`, normal matrix elements `ne`) into `pos` and `nrm` from vertex
 * `at` on, without its index: the numbers three.js's toNonIndexed and applyMatrix4 give. Returns the next vertex.
 */
function writeMoved(g: THREE.BufferGeometry, e: ArrayLike<number>, ne: ArrayLike<number>, pos: Float32Array, nrm: Float32Array | null, at: number): number {
  const p = g.getAttribute('position')
  const q = g.getAttribute('normal') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined
  const index = g.index
  const count = index ? index.count : p.count
  // Plain arrays are read directly; anything else (interleaved, normalised) through the attribute's getters.
  const pa = plainArray(p)
  const qa = plainArray(q)
  const ia = index ? index.array : null
  let v = at
  for (let i = 0; i < count; i++, v++) {
    const s = index ? (ia ? ia[i] : index.getX(i)) : i
    // Vector3.applyMatrix4, as BufferAttribute.applyMatrix4 moves a position.
    const x = pa ? pa[s * 3] : p.getX(s)
    const y = pa ? pa[s * 3 + 1] : p.getY(s)
    const z = pa ? pa[s * 3 + 2] : p.getZ(s)
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    pos[v * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
    pos[v * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
    pos[v * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    if (!nrm || !q) continue
    // Vector3.applyNormalMatrix: the normal matrix, then normalised.
    const a = qa ? qa[s * 3] : q.getX(s)
    const b = qa ? qa[s * 3 + 1] : q.getY(s)
    const c = qa ? qa[s * 3 + 2] : q.getZ(s)
    let nx = ne[0] * a + ne[3] * b + ne[6] * c
    let ny = ne[1] * a + ne[4] * b + ne[7] * c
    let nz = ne[2] * a + ne[5] * b + ne[8] * c
    const k = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1)
    nx *= k
    ny *= k
    nz *= k
    nrm[v * 3] = nx
    nrm[v * 3 + 1] = ny
    nrm[v * 3 + 2] = nz
  }
  return v
}

/**
 * A geometry moved by `m`, as a new non-indexed geometry with its positions and normals only: what
 * `g.toNonIndexed()` (or `g.clone()`), dropping its other attributes and `applyMatrix4(m)` give, without the copies.
 */
export function moved(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const count = g.index ? g.index.count : g.getAttribute('position').count
  const pos = new Float32Array(count * 3)
  const nrm = g.getAttribute('normal') ? new Float32Array(count * 3) : null
  writeMoved(g, placeMatrix.copy(m).elements, placeNormals.getNormalMatrix(placeMatrix).elements, pos, nrm, 0)
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  if (nrm) out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return out
}

/**
 * Nudges vertices by a hash of their position, so copies of one corner move together and nothing tears open.
 * Returns a new geometry (the cached original is left alone). `smooth` welds faces first for soft shading.
 */
export function rough(g: THREE.BufferGeometry, amount: number, seed = 1, smooth = false): THREE.BufferGeometry {
  let out = dup(g)
  if (smooth) {
    // Weld the faces so the normals come out smooth (foliage), not faceted.
    out.deleteAttribute('normal')
    out.deleteAttribute('uv')
    out = mergeVertices(out)
  }
  const p = out.getAttribute('position')
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
    p.setXYZ(i, x + h(k) * amount, y + h(k + 1) * amount, z + h(k + 2) * amount)
  }
  out.computeVertexNormals()
  return out
}

/** A faction-coloured base under a unit: a dark disc with a coloured rim, like a painted miniature's base. */
export function base(color: string, radius = 0.075): THREE.Group {
  const g = group(
    part(cyl(radius, radius * 1.06, 0.018, 20), mat('#1b140d', { rough: 0.6 }), [0, 0.009, 0]),
    part(torus(radius, 0.009, 6, 24), mat(color, { rough: 0.45, metal: 0.2 }), [0, 0.018, 0], [Math.PI / 2, 0, 0]),
  )
  g.name = 'base'
  return g
}

const flockSpot = new THREE.Vector3()
const flockSize = new THREE.Vector3()
const flockTurn = new THREE.Quaternion()
const flockEuler = new THREE.Euler()
const flockMatrix = new THREE.Matrix4()

/** A few little things a tick moves one by one (fireflies, droplets, motes, glints), drawn in one call. */
export class Flock extends THREE.InstancedMesh {
  /** Places thing i: its centre, its size (one number, or per axis) and, if given, its turn (x, y, z Euler angles). */
  put(i: number, x: number, y: number, z: number, size: number | [number, number, number] = 1, turn?: [number, number, number]) {
    if (typeof size === 'number') flockSize.setScalar(size)
    else flockSize.set(size[0], size[1], size[2])
    if (turn) flockTurn.setFromEuler(flockEuler.set(turn[0], turn[1], turn[2]))
    else flockTurn.identity()
    this.setMatrixAt(i, flockMatrix.compose(flockSpot.set(x, y, z), flockTurn, flockSize))
    this.instanceMatrix.needsUpdate = true
  }
}

/**
 * `n` copies of a little part as one instanced mesh (see Flock): one draw call instead of n. Unlit like the parts it
 * stands for, so it casts and takes no shadows. Marked as moving, so baking leaves it alone.
 */
export function flock(n: number, geometry: THREE.BufferGeometry, material: THREE.Material): Flock {
  const m = new Flock(geometry, material, n)
  m.castShadow = false
  m.receiveShadow = false
  m.frustumCulled = false
  m.userData.anim = true
  return m
}

/** Runs every tick function in a model tree. */
export function tickAll(root: THREE.Object3D, t: number, dt: number) {
  root.traverse((o) => {
    const f = o.userData.tick as Tick | undefined
    if (f) f(t, dt)
  })
}

export const PALETTE = {
  stone: '#c8bfae',
  stoneDark: '#8f8676',
  slate: '#3e4f73',
  roofRed: '#9a3b2c',
  thatch: '#c9a65b',
  plaster: '#ebe3cf',
  timber: '#5a3c25',
  wood: '#7a5332',
  iron: '#6d6f73',
  gold: '#d6a743',
  leaf: '#4c7d31',
  leafDark: '#2f5a26',
  bark: '#5d4029',
  skin: '#e2b38f',
  chitin: '#4a1f5c',
  chitinLight: '#7a3a94',
  glowSpawn: '#e043ff',
  glowElder: '#9dff6a',
  glowAmber: '#ffb347',
  water: '#4f9fbf',
}

// ---------------------------------------------------------------- animation
//
// A model's maker builds it once; the board shows copies of it (cloned, see "the board's models" below), so a tick
// must not close over the parts the maker built. A maker hands `rig` a rigging instead: a function that, given `pick`
// (the copy's own object or material for one the maker built), returns the tick for that copy.

/** One copy's tick: run every frame with the time and the frame's length (seconds). */
export type Tick = (t: number, dt: number) => void
/** The copy's own object or material for one the maker built: the identity on the model as built. */
export type Pick = <T extends THREE.Object3D | THREE.Material>(o: T) => T
/** Makes one copy's tick from its parts (see `rig`). */
export type Rigging = (pick: Pick) => Tick

const riggings = new WeakMap<THREE.Object3D, Rigging>()
const same: Pick = (o) => o

/** A copy's own objects and materials for a maker's named parts (`pick` on each). */
export function pickParts<P extends Record<string, THREE.Object3D | THREE.Material>>(pick: Pick, parts: P): P {
  const out: Record<string, THREE.Object3D | THREE.Material> = {}
  for (const k of Object.keys(parts)) out[k] = pick(parts[k])
  return out as P
}

/**
 * Animates `o` (a model's root or one of its parts): `rigging` makes the tick for one copy of the model, reaching the
 * copy's parts and per-copy materials through `pick`, and keeping any state of its own (a phase, a walk's weight). It
 * runs now for the model as built (`o.userData.tick`) and again for every copy the board clones. Returns `o`.
 */
export function rig<T extends THREE.Object3D>(o: T, rigging: Rigging): T {
  riggings.set(o, rigging)
  o.userData.tick = rigging(same)
  return o
}

// ---------------------------------------------------------------- baking
//
// A model's parts that never move on their own are merged into as few meshes as possible. Each such part belongs to
// its anchor: the nearest group above it that moves (a unit's arm, a token's bobbing pivot), else the model's root, and
// it is merged with the other parts of its anchor in the anchor's frame. Parts drawn with a kit material (`mat`) that
// is opaque go into one mesh per look (flat or smooth shading, the side, and whether it casts and takes shadows), their
// colour, roughness, metalness and glow written into their vertices for the baked material below to read; at the root,
// parts drawn with any other material (see-through water) merge per material. A Landmark of twenty colours becomes a
// handful of draw calls, and every model shares the baked material's programs.
//
// What moves is found by running the model's ticks at a spread of times, walking and standing: every object whose
// place, turn, size or visibility changes moves, and so does whatever its author marked `userData.anim`; a material a
// tick changes is never baked. Then everything is put back as it was built. Each model kind is baked once, as its
// template (see "the board's models" below); its copies are clones of the baked template.

interface Baked {
  /** The anchor's path from the root (child indices), and the merged mesh's parts. */
  anchor: number[]
  geometry: THREE.BufferGeometry
  material: THREE.Material
  cast: boolean
  receive: boolean
}
interface Recipe {
  /** The merged meshes, and the paths of the parts they replace. */
  parts: Baked[]
  merged: number[][]
  /** The materials the model's ticks change. */
  changes: Set<THREE.Material>
}

const bakedLooks = new Map<string, THREE.MeshStandardMaterial>()

/**
 * The material baked parts draw with: a MeshStandardMaterial that reads its colour (vertex colours), roughness and
 * metalness (`aRM`) and glow (`aGlow`, the emissive colour times its intensity) from each vertex, so it lights exactly
 * as the parts' own materials did. One per look: flat or smooth shading, and the side.
 */
export function bakedMaterial(flat: boolean, side: THREE.Side): THREE.MeshStandardMaterial {
  const key = `${flat ? 1 : 0}|${side}`
  let m = bakedLooks.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: flat, side, roughness: 1, metalness: 0 })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nattribute vec3 aGlow;\nvarying vec2 vRM;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;\nvGlow = aGlow;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vGlow;')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vGlow;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
    }
    m.customProgramCacheKey = () => 'rr-baked-1'
    bakedLooks.set(key, m)
  }
  return m
}

/** True if a part's look can be baked into its vertices: a shared kit material, opaque, with no maps. */
function bakeable(m: THREE.Material): m is THREE.MeshStandardMaterial {
  const s = m as THREE.MeshStandardMaterial
  return shared.has(m) && s.isMeshStandardMaterial && !s.transparent && s.opacity >= 1 && !s.map && !s.vertexColors
}

/** An object's path from the root (child indices), and the object at a path. */
function pathOf(root: THREE.Object3D, o: THREE.Object3D): number[] {
  const out: number[] = []
  for (let c = o; c !== root && c.parent; c = c.parent) out.unshift(c.parent.children.indexOf(c))
  return out
}
const atPath = (root: THREE.Object3D, path: number[]) => path.reduce<THREE.Object3D>((o, i) => o.children[i], root)

/** The times a model's ticks are run at to see what moves: irregular, so no cycle hides, over two minutes. */
const PROBE_TIMES = Array.from({ length: 48 }, (_, i) => i * 2.517 + (i % 7) * 0.613 + (i % 3) * 0.171)

/** An object's place, turn, size and visibility (11 numbers), written at `at`, and whether it still matches them. */
const POSE = 11
function writePose(o: THREE.Object3D, out: Float64Array, at: number) {
  o.position.toArray(out, at)
  o.quaternion.toArray(out, at + 3)
  o.scale.toArray(out, at + 7)
  out[at + 10] = o.visible ? 1 : 0
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-7
function samePose(o: THREE.Object3D, p: Float64Array, at: number): boolean {
  const { position: v, quaternion: q, scale: s } = o
  return (
    near(v.x, p[at]) && near(v.y, p[at + 1]) && near(v.z, p[at + 2]) &&
    near(q.x, p[at + 3]) && near(q.y, p[at + 4]) && near(q.z, p[at + 5]) && near(q.w, p[at + 6]) &&
    near(s.x, p[at + 7]) && near(s.y, p[at + 8]) && near(s.z, p[at + 9]) &&
    near(o.visible ? 1 : 0, p[at + 10])
  )
}
/** A material's look (10 numbers: colour, emissive colour and intensity, opacity, roughness, metalness), and a check. */
const LOOK = 10
function writeLook(m: THREE.MeshStandardMaterial, out: Float64Array, at: number) {
  m.color.toArray(out, at)
  m.emissive.toArray(out, at + 3)
  out[at + 6] = m.emissiveIntensity
  out[at + 7] = m.opacity
  out[at + 8] = m.roughness
  out[at + 9] = m.metalness
}
function sameLook(m: THREE.MeshStandardMaterial, p: Float64Array, at: number): boolean {
  return (
    near(m.color.r, p[at]) && near(m.color.g, p[at + 1]) && near(m.color.b, p[at + 2]) &&
    near(m.emissive.r, p[at + 3]) && near(m.emissive.g, p[at + 4]) && near(m.emissive.b, p[at + 5]) &&
    near(m.emissiveIntensity, p[at + 6]) && near(m.opacity, p[at + 7]) && near(m.roughness, p[at + 8]) && near(m.metalness, p[at + 9])
  )
}

/**
 * The objects a model's ticks move and the materials they change (see above), in steps that stop once `slice` is up.
 * The ticks run walking for 8 steps, then standing for 8, in turn; then standing a few long steps (so a walk fades
 * out), and everything is put back.
 */
function* movement(root: THREE.Object3D, slice: Slice): Generator<void, { moves: Set<THREE.Object3D>; changes: Set<THREE.Material> }> {
  const objects: THREE.Object3D[] = []
  const ticks: Tick[] = []
  const materials: THREE.MeshStandardMaterial[] = []
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    objects.push(o)
    if (typeof o.userData.tick === 'function') ticks.push(o.userData.tick as Tick)
    const m = (o as THREE.Mesh).material
    if ((o as THREE.Mesh).isMesh && !Array.isArray(m) && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && !seen.has(m)) {
      seen.add(m)
      materials.push(m as THREE.MeshStandardMaterial)
    }
  })
  const poses = new Float64Array(objects.length * POSE)
  objects.forEach((o, k) => writePose(o, poses, k * POSE))
  const looks = new Float64Array(materials.length * LOOK)
  materials.forEach((m, k) => writeLook(m, looks, k * LOOK))
  const moves = new Set<THREE.Object3D>()
  const changes = new Set<THREE.Material>()
  if (ticks.length) {
    const walking = root.userData.moving
    for (let i = 0; i < PROBE_TIMES.length; i++) {
      if (performance.now() >= slice.end) yield
      root.userData.moving = i % 16 < 8
      for (const f of ticks) f(PROBE_TIMES[i], 0.05)
      objects.forEach((o, k) => {
        if (!moves.has(o) && !samePose(o, poses, k * POSE)) moves.add(o)
      })
      materials.forEach((m, k) => {
        if (!changes.has(m) && !sameLook(m, looks, k * LOOK)) changes.add(m)
      })
    }
    root.userData.moving = walking
    for (let i = 1; i <= 4; i++) for (const f of ticks) f(PROBE_TIMES[PROBE_TIMES.length - 1] + i, 1)
    objects.forEach((o, k) => {
      const at = k * POSE
      o.position.fromArray(poses, at)
      o.quaternion.fromArray(poses, at + 3)
      o.scale.fromArray(poses, at + 7)
      o.visible = poses[at + 10] === 1
    })
    materials.forEach((m, k) => {
      const at = k * LOOK
      m.color.fromArray(looks, at)
      m.emissive.fromArray(looks, at + 3)
      m.emissiveIntensity = looks[at + 6]
      m.opacity = looks[at + 7]
      m.roughness = looks[at + 8]
      m.metalness = looks[at + 9]
    })
  }
  // What its author marked as moving moves, whatever the ticks showed (a group with a tick may only move its children).
  for (const o of objects) if (o !== root && o.userData.anim) moves.add(o)
  return { moves, changes }
}

const toAnchor = new THREE.Matrix4()
const normalMatrix = new THREE.Matrix3()

/**
 * Merges parts into one non-indexed geometry in their anchor's frame: positions and normals only, as three.js's
 * applyMatrix4, toNonIndexed and mergeGeometries would give them, written straight into the merged arrays. With
 * `look`, each part's material's colour, roughness and metalness and glow go into its vertices too (`bakedMaterial`).
 * Null if the parts can't merge (a part without normals).
 */
function mergeParts(meshes: THREE.Mesh[], anchor: THREE.Object3D, look: boolean): THREE.BufferGeometry | null {
  let n = 0
  for (const m of meshes) {
    const g = m.geometry
    if (!g.getAttribute('position') || !g.getAttribute('normal')) return null
    n += g.index ? g.index.count : g.getAttribute('position').count
  }
  const pos = new Float32Array(n * 3)
  const nrm = new Float32Array(n * 3)
  const color = look ? new Float32Array(n * 3) : null
  const rm = look ? new Float32Array(n * 2) : null
  const glow = look ? new Float32Array(n * 3) : null
  const inverse = new THREE.Matrix4().copy(anchor.matrixWorld).invert()
  let v = 0
  for (const m of meshes) {
    const e = toAnchor.multiplyMatrices(inverse, m.matrixWorld).elements
    const start = v
    v = writeMoved(m.geometry, e, normalMatrix.getNormalMatrix(toAnchor).elements, pos, nrm, v)
    if (color && rm && glow) {
      const s = m.material as THREE.MeshStandardMaterial
      const ek = s.emissiveIntensity
      for (let i = start; i < v; i++) {
        color[i * 3] = s.color.r
        color[i * 3 + 1] = s.color.g
        color[i * 3 + 2] = s.color.b
        rm[i * 2] = s.roughness
        rm[i * 2 + 1] = s.metalness
        glow[i * 3] = s.emissive.r * ek
        glow[i * 3 + 1] = s.emissive.g * ek
        glow[i * 3 + 2] = s.emissive.b * ek
      }
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  if (color && rm && glow) {
    out.setAttribute('color', new THREE.BufferAttribute(color, 3))
    out.setAttribute('aRM', new THREE.BufferAttribute(rm, 2))
    out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3))
  }
  return out
}

/** Works out how a model kind merges (see above), in steps that stop once `slice` is up. */
function* recipeOf(root: THREE.Group, slice: Slice): Generator<void, Recipe> {
  const { moves, changes } = yield* movement(root, slice)
  root.updateMatrixWorld(true)
  const groups = new Map<string, { anchor: THREE.Object3D; meshes: THREE.Mesh[]; material: THREE.Material; look: boolean; cast: boolean; receive: boolean }>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || moves.has(m) || Array.isArray(m.material)) return
    let anchor: THREE.Object3D = root
    for (let p = m.parent; p && p !== root; p = p.parent) {
      if (moves.has(p)) {
        anchor = p
        break
      }
    }
    const material = m.material
    const look = bakeable(material) && !changes.has(material)
    // Off the root, only looks merge: a part with a material of its own may have that material changed by a tick.
    if (!look && anchor !== root) return
    const draw = look ? bakedMaterial(material.flatShading, material.side) : material
    const k = `${anchor.uuid}|${draw.uuid}|${m.castShadow}|${m.receiveShadow}`
    const entry = groups.get(k) ?? { anchor, meshes: [], material: draw, look, cast: m.castShadow, receive: m.receiveShadow }
    entry.meshes.push(m)
    groups.set(k, entry)
  })
  const parts: Baked[] = []
  const merged: number[][] = []
  for (const { anchor, meshes, material, look, cast, receive } of groups.values()) {
    // A lone part draws as it is.
    if (meshes.length < 2) continue
    if (performance.now() >= slice.end) yield
    const geometry = mergeParts(meshes, anchor, look)
    if (!geometry) continue
    parts.push({ anchor: pathOf(root, anchor), geometry, material, cast, receive })
    for (const m of meshes) merged.push(pathOf(root, m))
  }
  return { parts, merged, changes }
}

/**
 * Swaps a model's static parts for the recipe's merged meshes (see above), keeping moving parts as they are. Merged
 * meshes never move against their anchor, so their matrices are fixed. Returns the same root.
 */
function applyRecipe(root: THREE.Group, r: Recipe): THREE.Group {
  // Find everything by its path before changing the tree.
  const anchors = r.parts.map((p) => atPath(root, p.anchor))
  const gone = r.merged.map((p) => atPath(root, p))
  for (const o of gone) o.parent?.remove(o)
  r.parts.forEach((p, i) => {
    const mesh = new THREE.Mesh(p.geometry, p.material)
    mesh.castShadow = p.cast
    mesh.receiveShadow = p.receive
    mesh.matrixAutoUpdate = false
    anchors[i].add(mesh)
  })
  // Drop groups left empty.
  const prune = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      prune(c)
      if (!(c as THREE.Mesh).isMesh && !c.children.length && !c.userData.tick && !c.userData.anim && c.type === 'Group') o.remove(c)
    }
  }
  prune(root)
  return root
}

const NO_SLICE: Slice = { end: Infinity }

/** Runs a stepped job to its end at once. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
  }
}

// ---------------------------------------------------------------- the board's models
//
// Each model kind (a key: its kind and whatever changes how it is built) is built once, as a template the board never
// shows: made, baked, and its ticks' riggings noted. The board shows copies: a clone of the template that shares its
// geometries and materials, with its own clones of the materials its ticks change and its own ticks from the riggings
// (`copyModel`). A copy costs a clone of the scene graph, so a piece turning up in play builds nothing. Templates are
// prepared in steps (`prepare`), so the board builds them in slices between frames and no task runs long.

interface Kind {
  template: THREE.Group
  /** The materials the ticks change: each copy draws with its own clones of these. */
  own: Set<THREE.Material>
  /** The template's objects with a rigging, in tree order. */
  rigged: THREE.Object3D[]
}
const kinds = new Map<string, Kind>()

/** Whether a model kind's template is ready to copy. */
export const prepared = (key: string) => kinds.has(key)

/**
 * Prepares a model kind's template, in steps: a generator that runs until `slice.end` has passed, then yields until the
 * next slice. A first build makes geometries, which can't be cut short: the maker stops when its slice is up and runs
 * again from the top in the next one, making at least one more geometry or step each time (see `geo` and `step`), so
 * a slice runs over by one geometry at most. Nothing happens if the kind is ready.
 */
export function* prepare(key: string, make: () => THREE.Group, slice: Slice): Generator<void, void> {
  let root: THREE.Group | null = null
  while (!root) {
    if (kinds.has(key)) return
    if (performance.now() >= slice.end) yield
    slicing = slice
    made = 0
    try {
      root = make()
    } catch (e) {
      if (e !== OUT_OF_TIME) throw e
    } finally {
      slicing = null
    }
  }
  steps.clear()
  const r = yield* recipeOf(root, slice)
  applyRecipe(root, r)
  const rigged: THREE.Object3D[] = []
  const bounds = new Set<THREE.BufferGeometry>()
  root.traverse((o) => {
    if (riggings.has(o)) rigged.push(o)
    else if (typeof o.userData.tick === 'function') throw new Error(`model ${key}: a tick without a rigging can't follow a copy (use kit.rig)`)
    const g = (o as THREE.Mesh).geometry
    if ((o as THREE.Mesh).isMesh && !g.boundingSphere) bounds.add(g)
  })
  // The bounds three.js culls by, worked out now rather than on the first frame that draws the model.
  for (const g of bounds) {
    if (performance.now() >= slice.end) yield
    g.computeBoundingSphere()
  }
  root.updateMatrixWorld(true)
  if (!kinds.has(key)) kinds.set(key, { template: root, own: r.changes, rigged })
}

/** Prepares a model kind at once (tests, previews); returns its template, which must not be shown or changed. */
export function prepareNow(key: string, make: () => THREE.Group): THREE.Group {
  finish(prepare(key, make, NO_SLICE))
  return kinds.get(key)!.template
}

/** The template of a prepared kind (to compile its programs ahead); it must not be shown or changed. */
export const templateOf = (key: string): THREE.Group | null => kinds.get(key)?.template ?? null

/** A clone of one object (not its children): the same geometry and material, place, flags and depth material. */
function cloneOne(o: THREE.Object3D): THREE.Object3D {
  const m = o as THREE.InstancedMesh
  const Make = o.constructor as new (geometry?: THREE.BufferGeometry, material?: THREE.Material | THREE.Material[], count?: number) => THREE.Object3D
  const out = m.isInstancedMesh ? new Make(m.geometry, m.material, m.count) : m.isMesh ? new Make(m.geometry, m.material) : new Make()
  out.copy(o, false)
  out.customDepthMaterial = o.customDepthMaterial
  return out
}

/**
 * A copy of a prepared model kind for one piece (see above): its ticks in `userData.ticks` (`ticksOf`), in tree order.
 * Throws if the kind is not prepared.
 */
export function copyModel(key: string): THREE.Group {
  const kind = kinds.get(key)
  if (!kind) throw new Error(`model ${key} is not prepared`)
  const objects = new Map<THREE.Object3D, THREE.Object3D>()
  const materials = new Map<THREE.Material, THREE.Material>()
  const clone = (o: THREE.Object3D): THREE.Object3D => {
    const c = cloneOne(o)
    objects.set(o, c)
    const mesh = c as THREE.Mesh
    if (mesh.isMesh && !Array.isArray(mesh.material) && kind.own.has(mesh.material)) {
      const m = mesh.material
      let own = materials.get(m)
      if (!own) {
        own = m.clone()
        materials.set(m, own)
      }
      mesh.material = own
    }
    for (const child of o.children) c.add(clone(child))
    return c
  }
  const root = clone(kind.template) as THREE.Group
  const pick = (<T extends THREE.Object3D | THREE.Material>(o: T): T => {
    if ((o as THREE.Material).isMaterial) return (materials.get(o as THREE.Material) ?? o) as T
    const c = objects.get(o as THREE.Object3D)
    if (!c) throw new Error(`model ${key}: a rigging picks a part the copy doesn't have`)
    return c as T
  }) as Pick
  const ticks: Tick[] = []
  for (const o of kind.rigged) {
    const tick = riggings.get(o)!(pick)
    objects.get(o)!.userData.tick = tick
    ticks.push(tick)
  }
  root.userData.ticks = ticks
  return root
}

/** A model copy's tick functions (from `copyModel`), in tree order. */
export const ticksOf = (root: THREE.Object3D): Tick[] => (root.userData.ticks as Tick[] | undefined) ?? []

/**
 * A tube along a smooth curve through `points` that tapers from radius r0 to r1: roots, branches, limbs, tails.
 * Not cached (each call makes its own shape).
 */
export function taper(points: [number, number, number][], r0: number, r1: number, radial = 7, segs = 14): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  const frames = curve.computeFrenetFrames(segs, false)
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const c = curve.getPointAt(t)
    const r = r0 + (r1 - r0) * t
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)))
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r)
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  // Cap the thin end.
  const tip = curve.getPointAt(1)
  const ti = pos.length / 3
  pos.push(tip.x, tip.y, tip.z)
  for (let j = 0; j < radial; j++) idx.push(segs * (radial + 1) + j, ti, segs * (radial + 1) + j + 1)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
