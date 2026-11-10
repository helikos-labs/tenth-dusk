// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/terrainMesh.ts, adapted for Tenth Dusk.
// Terrain geometry for the 3D board. ORGANIC CONCEPT: one triangle-lattice mesh over a round sea instead of one hexagon
// per hex, so nothing in the geometry follows the grid. Every vertex takes its height and colour from the field
// (field.ts), whose regions are domain-warped: borders meander, terrains blend across them (forest fringe into meadow,
// sand and mud at the water, scree round a range's foot, rock on cliffs) and the coast has beaches, cliffs and islets.
import * as THREE from 'three'
import type { Terrain, WorldCell } from './adapter.ts'
import { LAND, SQRT3, WATER_LEVEL, fbm, fray, ridged, smoothstep, type Field, type Probe } from './field.ts'
import { flowersOf } from './flora.ts'
import { slotOf } from './materials.ts'

export const PLINTH_TOP = -0.75
/** The sea reaches the tray's rim at this radius; the lattice runs a step past it, under the rim. */
export const SEA_RADIUS = 9.5
/** Lattice spacing (world units); a hex is 1 across its corners. */
const STEP = 0.085

export const TERRAIN_ID: Record<Terrain, number> = { grassland: 0, forest: 1, mountain: 2, water: 3, blight: 4 }

const col = (hex: string) => new THREE.Color(hex)
const PAL = {
  grass: col('#4f7d2f'),
  grassLight: col('#76993f'),
  grassDark: col('#335a22'),
  grassDry: col('#948f4f'),
  forest: col('#33502a'),
  forestDark: col('#22381b'),
  rock: col('#7b7266'),
  rockDark: col('#4f483f'),
  rockLight: col('#a49b8b'),
  snow: col('#eaeff4'),
  /** Wind-packed snow and drifts in hollows: a cold blue-grey. */
  snowShade: col('#c3d0e0'),
  scree: col('#8f8a7c'),
  sand: col('#b9a274'),
  wetSand: col('#8f7d58'),
  mud: col('#5e5034'),
  reedBank: col('#5f6e35'),
  bed: col('#3e4d3c'),
  heath: col('#56693a'),
  heathDry: col('#7b7a4a'),
  blight: col('#3a1c43'),
  blightDark: col('#1f0d26'),
  blightLight: col('#6a2f6e'),
}

/** Each hex's slot in the shaders' state texture (a fixed grid of axial coordinates, see materials.ts). */
export function hexIndex(board: Record<string, WorldCell>): Map<string, number> {
  return new Map(Object.values(board).map((c) => [`${c.q},${c.r}`, slotOf(c.q, c.r)]))
}

const tmp = new THREE.Color()
const tmpFlower = new THREE.Color()
const tmpHeath = new THREE.Color()
const tmpSnow = new THREE.Color()

/** Ground colour of land terrain `t` at a world point, given the height and slope there. */
function groundColor(t: Terrain, pr: Probe, x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  const n = fbm(x * 0.9, z * 0.9, 11, 3)
  const m = fbm(x * 3.1, z * 3.1, 12, 2)
  switch (t) {
    case 'grassland': {
      out.copy(PAL.grass).lerp(PAL.grassLight, smoothstep(0.45, 0.75, n) * 0.8)
      out.lerp(PAL.grassDark, smoothstep(0.5, 0.25, m) * 0.5)
      // Meadows shade from lush to sun-dried in wide drifts that ignore the provinces.
      out.lerp(PAL.grassDry, smoothstep(0.42, 0.68, fbm(x * 0.33, z * 0.33, 19, 3)) * 0.5 * smoothstep(0.3, 0.7, m))
      // A haze of the field's main flower, in drifts.
      if (pr.cell) {
        const bloom = fbm(x * 2.2, z * 2.2, 15, 3)
        out.lerp(tmpFlower.set(flowersOf(pr.cell.q, pr.cell.r).main.color), smoothstep(0.55, 0.8, bloom) * 0.13)
      }
      return out
    }
    case 'forest':
      return out.copy(PAL.forest).lerp(PAL.forestDark, smoothstep(0.35, 0.7, m))
    case 'mountain': {
      const crack = ridged(x * 5.5, z * 5.5, 13, 2)
      out.copy(PAL.rock).lerp(PAL.rockLight, smoothstep(0.5, 0.85, n) * 0.6)
      out.lerp(PAL.rockDark, smoothstep(0.75, 0.45, ny) * 0.6 + smoothstep(0.6, 0.9, crack) * 0.25)
      // Grassy foothills, scree on the shoulders, snow on gentle high ground.
      out.lerp(PAL.grass, smoothstep(0.2, 0.04, h) * 0.75)
      out.lerp(PAL.scree, smoothstep(0.25, 0.5, h) * smoothstep(0.9, 0.7, ny) * 0.25)
      // Snow lies in tongues and patches, not one sheet: a ragged snow line, rock showing through in streaks where the
      // slope steepens, and wind-packed blue-grey drifts among the fresh white.
      const line = smoothstep(0.66, 0.86, h + 0.12 * (n - 0.5) + 0.1 * (m - 0.5))
      const cover = smoothstep(0.42, 0.7, ny) * (1 - 0.55 * smoothstep(0.62, 0.92, crack) * smoothstep(0.88, 0.62, ny))
      tmpSnow.copy(PAL.snow).lerp(PAL.snowShade, 0.5 * smoothstep(0.35, 0.75, fbm(x * 1.9, z * 1.9, 16, 2)) + 0.35 * smoothstep(0.8, 0.5, ny))
      out.lerp(tmpSnow, line * cover)
      return out
    }
    case 'water':
      return out.copy(PAL.sand).lerp(PAL.bed, smoothstep(-0.07, -0.22, h))
    case 'blight': {
      out.copy(PAL.blight).lerp(PAL.blightLight, smoothstep(0.55, 0.85, n) * 0.5)
      return out.lerp(PAL.blightDark, smoothstep(0.55, 0.9, ridged(x * 4.2, z * 4.2, 14, 2)) * 0.7)
    }
  }
}

/** Colour at a world point: land terrains blended across their (warped) borders, then shores, scree and cliffs. */
function surfaceColor(pr: Probe, x: number, z: number, ny: number, out: THREE.Color): THREE.Color {
  const h = pr.height
  if (pr.ground === 'water' || pr.ground === 'sea') {
    if (h > WATER_LEVEL + 0.004) {
      // Dry sea floor is beach; islets rise from it to heath and bare rock.
      tmpHeath.copy(PAL.heath).lerp(PAL.heathDry, fbm(x * 1.2, z * 1.2, 23, 2))
      out.copy(PAL.sand).lerp(tmpHeath, smoothstep(WATER_LEVEL + 0.06, WATER_LEVEL + 0.13, h))
      out.lerp(PAL.rock, smoothstep(0.9, 0.6, ny) * 0.9 * smoothstep(WATER_LEVEL + 0.03, WATER_LEVEL + 0.09, h))
      return out.lerp(PAL.wetSand, (1 - smoothstep(WATER_LEVEL, WATER_LEVEL + 0.015, h)) * 0.5)
    }
    return out.copy(PAL.sand).lerp(PAL.bed, smoothstep(-0.07, -0.24, h))
  }
  // The blend between terrains wanders from crisp to wide, and each terrain's edge is frayed, so no border is a line.
  const blend = 0.05 + 0.2 * smoothstep(0.3, 0.7, fbm(x * 1.7, z * 1.7, 77, 2))
  let total = 0
  let r = 0
  let g = 0
  let b = 0
  for (const t of LAND) {
    const wgt = smoothstep(-blend, blend, pr.sd[t] + fray(t, x, z))
    if (wgt < 0.002) continue
    groundColor(t, pr, x, z, h, ny, tmp)
    r += tmp.r * wgt
    g += tmp.g * wgt
    b += tmp.b * wgt
    total += wgt
  }
  if (total > 0) out.setRGB(r / total, g / total, b / total)
  else groundColor(pr.ground as Terrain, pr, x, z, h, ny, out)
  const wob = fbm(x * 2.6, z * 2.6, 31, 2)
  // Scree and gravel fanning out round a range's foot.
  if (pr.sd.mountain < 0) out.lerp(PAL.scree, (1 - smoothstep(0.02, 0.34, -pr.sd.mountain + 0.2 * (wob - 0.5))) * 0.5)
  // Undergrowth darkens the meadow just outside the woods.
  if (pr.sd.forest < 0) out.lerp(PAL.forestDark, (1 - smoothstep(0, 0.28, -pr.sd.forest)) * 0.3 * smoothstep(0.3, 0.6, wob))
  // Steep ground shows bare rock: cliffs on the coast, cut banks.
  if (pr.ground !== 'mountain') out.lerp(PAL.rockDark, smoothstep(0.78, 0.5, ny) * 0.75)
  // Beaches on the open coast (narrow under cliffs), muddy reed banks round the lakes. The coast distance is a true
  // distance (field.ts), so a beach is as wide on a cape as in a bay.
  const beach = (0.025 + 0.16 * smoothstep(0.3, 0.75, wob)) * (1 - 0.85 * pr.cliff)
  out.lerp(PAL.sand, (1 - smoothstep(beach * 0.55, beach, pr.coast)) * 0.85)
  out.lerp(PAL.wetSand, (1 - smoothstep(0, 0.03, pr.coast)) * 0.5)
  const bank = 0.05 + 0.11 * wob
  out.lerp(wob > 0.5 ? PAL.reedBank : PAL.mud, (1 - smoothstep(bank * 0.4, bank, pr.lake)) * 0.6)
  out.lerp(PAL.wetSand, (1 - smoothstep(0, 0.04, pr.lake)) * 0.5)
  return out
}

/** How much rock grain the shader adds: mountainsides and cliffs, not their grassy feet or snowcaps. */
function rockiness(pr: Probe, ny: number): number {
  const range = smoothstep(-0.05, 0.12, pr.sd.mountain) * smoothstep(0.08, 0.3, pr.height) * (1 - smoothstep(0.75, 0.95, pr.height))
  return Math.max(range, smoothstep(0.8, 0.55, ny) * 0.8)
}

export interface TerrainGeometry {
  surface: THREE.BufferGeometry
  /** Water surface over the whole tray (lakes and sea), with the depth below each vertex. */
  water: THREE.BufferGeometry | null
}

// ---------------------------------------------------------------- the mesh as plain arrays
//
// The mesh is built as typed arrays with no three.js objects in them (`buildTerrainArrays`), so the world worker
// (world.worker.ts) can build it off the main thread and hand the buffers over; the main thread only wraps them
// (`terrainGeometry`). When hexes change terrain, `patchTerrain` redoes only the vertices the change can reach
// (worldBuild.ts works out which) and keeps the rest.

/** A triangle lattice over the tray (see `lattice`) as typed arrays, with the triangles round each vertex. */
export interface Lattice {
  /** Ground-plane position of each vertex. */
  x: Float64Array
  z: Float64Array
  /** Three vertex ids per triangle, wound so normals face up. */
  tris: Uint32Array
  /** The triangles round vertex v, in triangle order: around[aroundAt[v]] up to around[aroundAt[v + 1] - 1]. */
  aroundAt: Uint32Array
  around: Uint32Array
}

/** A triangle lattice over the tray: vertices inside the sea's radius, triangles wound so normals face up. */
function lattice(radius: number, step: number) {
  const rowH = (step * SQRT3) / 2
  const rows = Math.ceil(radius / rowH) + 1
  const cols = Math.ceil(radius / step) + 2
  const ids = new Map<number, number>()
  const pts: number[] = []
  const key = (j: number, i: number) => (j + rows) * (2 * cols + 3) + (i + cols)
  for (let j = -rows; j <= rows; j++) {
    const odd = ((j % 2) + 2) % 2 === 1
    for (let i = -cols; i <= cols; i++) {
      const x = i * step + (odd ? step / 2 : 0)
      const z = j * rowH
      if (Math.hypot(x, z) > radius + step) continue
      ids.set(key(j, i), pts.length / 2)
      pts.push(x, z)
    }
  }
  const tris: number[] = []
  const at = (j: number, i: number) => ids.get(key(j, i))
  const tri = (a?: number, b?: number, c?: number) => {
    if (a !== undefined && b !== undefined && c !== undefined) tris.push(a, b, c)
  }
  for (let j = -rows; j < rows; j++) {
    const odd = ((j % 2) + 2) % 2 === 1
    for (let i = -cols; i < cols; i++) {
      if (!odd) {
        tri(at(j, i), at(j + 1, i), at(j, i + 1))
        tri(at(j, i + 1), at(j + 1, i), at(j + 1, i + 1))
      } else {
        tri(at(j, i), at(j + 1, i), at(j + 1, i + 1))
        tri(at(j, i), at(j + 1, i + 1), at(j, i + 1))
      }
    }
  }
  return { pts, tris }
}

const lattices = new Map<number, Lattice>()

/** The lattice for a detail level (1 on desktops, less on phones: useWorld.ts), made once, as nothing else changes it. */
export function latticeFor(detail: number): Lattice {
  const step = STEP / Math.max(0.5, detail)
  const known = lattices.get(step)
  if (known) return known
  const { pts, tris } = lattice(SEA_RADIUS, step)
  const n = pts.length / 2
  const x = new Float64Array(n)
  const z = new Float64Array(n)
  for (let v = 0; v < n; v++) {
    x[v] = pts[v * 2]
    z[v] = pts[v * 2 + 1]
  }
  // Each vertex's triangles, counted, then filled in triangle order.
  const aroundAt = new Uint32Array(n + 1)
  for (const v of tris) aroundAt[v + 1]++
  for (let v = 0; v < n; v++) aroundAt[v + 1] += aroundAt[v]
  const next = aroundAt.slice(0, n)
  const around = new Uint32Array(tris.length)
  for (let i = 0; i < tris.length; i++) around[next[tris[i]]++] = (i / 3) | 0
  const made: Lattice = { x, z, tris: Uint32Array.from(tris), aroundAt, around }
  lattices.set(step, made)
  return made
}

/** Everything the terrain and water meshes draw, as typed arrays (vectors and colours three numbers a vertex). */
export interface TerrainArrays {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  /** How much rock grain the shader adds (`rockiness`). */
  rock: Float32Array
  /** Signed distance to the coast: the shader gives the coastal strip off the board to the nearest rim province. */
  coast: Float32Array
  index: Uint32Array
  /** The water surface over the whole lattice, the depth below each vertex, and the triangles with water under them. */
  waterPosition: Float32Array
  depth: Float32Array
  waterIndex: Uint32Array
  /** Bounding spheres (centre x, y, z and radius) of the ground and of the water, as three.js computes them. */
  sphere: number[]
  waterSphere: number[]
}

/** A built terrain: its lattice and arrays, kept by the world worker to patch. */
export interface TerrainBuild {
  lattice: Lattice
  arrays: TerrainArrays
}

/**
 * The terrain and water meshes for a field as typed arrays, at a detail level. No three.js objects (colours and maths
 * only), so the world worker can run it. `onProbe` sees every vertex's probe (worldBuild.ts notes where it reads).
 */
export function buildTerrainArrays(field: Field, waterLevel: number, detail = 1, onProbe?: (v: number, pr: Probe) => void): TerrainBuild {
  const lat = latticeFor(detail)
  const n = lat.x.length
  const a: TerrainArrays = {
    position: new Float32Array(n * 3),
    normal: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
    rock: new Float32Array(n),
    coast: new Float32Array(n),
    index: lat.tris,
    waterPosition: new Float32Array(n * 3),
    depth: new Float32Array(n),
    waterIndex: new Uint32Array(0),
    sphere: [],
    waterSphere: [],
  }
  const probes: Probe[] = new Array(n)
  for (let v = 0; v < n; v++) {
    probes[v] = probeVertex(field, lat, v, a, waterLevel)
    onProbe?.(v, probes[v])
  }
  vertexNormals(a.position, lat, a.normal, null)
  for (let v = 0; v < n; v++) shade(probes[v], lat, v, a)
  // One water surface for the lakes and the sea: only the triangles with water under them.
  for (let v = 0; v < n; v++) {
    a.waterPosition[v * 3] = lat.x[v]
    a.waterPosition[v * 3 + 1] = waterLevel
    a.waterPosition[v * 3 + 2] = lat.z[v]
  }
  a.waterIndex = waterTriangles(a.depth, lat.tris)
  a.sphere = sphereOf(a.position)
  a.waterSphere = sphereOf(a.waterPosition)
  return { lattice: lat, arrays: a }
}

/**
 * Re-probes the vertices `verts` (those a change of terrain can reach) on `field`, the board after the change, and
 * redoes what depends on them: their heights and depths, then the normals and colours of them and of the ring round
 * them (a normal reads its neighbours' heights), and the water's triangles. Returns the vertices that changed,
 * `from` up to `to`, and whether the water's triangles did.
 */
export function patchTerrain(build: TerrainBuild, field: Field, verts: ArrayLike<number>, waterLevel: number): { from: number; to: number; water: boolean } {
  const { lattice: lat, arrays: a } = build
  const redo = withRing(lat, verts)
  if (!redo.length) return { from: 0, to: 0, water: false }
  const probes: Probe[] = new Array(redo.length)
  for (let k = 0; k < redo.length; k++) probes[k] = probeVertex(field, lat, redo[k], a, waterLevel)
  vertexNormals(a.position, lat, a.normal, redo)
  for (let k = 0; k < redo.length; k++) shade(probes[k], lat, redo[k], a)
  const water = waterTriangles(a.depth, lat.tris)
  const changed = !sameArray(water, a.waterIndex)
  if (changed) a.waterIndex = water
  a.sphere = sphereOf(a.position)
  return { from: redo[0], to: redo[redo.length - 1] + 1, water: changed }
}

/** Probes vertex v: its height, its depth under the water and its distance to the coast. */
function probeVertex(field: Field, lat: Lattice, v: number, a: TerrainArrays, waterLevel: number): Probe {
  const pr = field.probe(lat.x[v], lat.z[v])
  a.position[v * 3] = lat.x[v]
  a.position[v * 3 + 1] = pr.height
  a.position[v * 3 + 2] = lat.z[v]
  a.depth[v] = Math.max(0, waterLevel - pr.height)
  a.coast[v] = pr.s
  return pr
}

/** Vertex v's colour and rock grain, from its probe and the slope of its (already computed) normal. */
function shade(pr: Probe, lat: Lattice, v: number, a: TerrainArrays) {
  const ny = a.normal[v * 3 + 1]
  surfaceColor(pr, lat.x[v], lat.z[v], ny, tmp)
  a.color[v * 3] = tmp.r
  a.color[v * 3 + 1] = tmp.g
  a.color[v * 3 + 2] = tmp.b
  a.rock[v] = rockiness(pr, ny)
}

/**
 * Smooth normals of the vertices `verts` (all when null): the sum of the faces round each, weighted by area, as
 * BufferGeometry.computeVertexNormals has it. Every vertex adds its faces in triangle order, so a patched normal comes
 * out to the bit the same as a full build's.
 */
function vertexNormals(pos: Float32Array, lat: Lattice, out: Float32Array, verts: ArrayLike<number> | null) {
  const { tris, aroundAt, around } = lat
  const count = verts ? verts.length : lat.x.length
  for (let k = 0; k < count; k++) {
    const v = verts ? verts[k] : k
    let nx = 0
    let ny = 0
    let nz = 0
    for (let i = aroundAt[v]; i < aroundAt[v + 1]; i++) {
      const t = around[i] * 3
      const a = tris[t] * 3
      const b = tris[t + 1] * 3
      const c = tris[t + 2] * 3
      // (C − B) × (A − B)
      const cbx = pos[c] - pos[b]
      const cby = pos[c + 1] - pos[b + 1]
      const cbz = pos[c + 2] - pos[b + 2]
      const abx = pos[a] - pos[b]
      const aby = pos[a + 1] - pos[b + 1]
      const abz = pos[a + 2] - pos[b + 2]
      nx += cby * abz - cbz * aby
      ny += cbz * abx - cbx * abz
      nz += cbx * aby - cby * abx
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    out[v * 3] = nx / l
    out[v * 3 + 1] = ny / l
    out[v * 3 + 2] = nz / l
  }
}

/** `verts` and every vertex that shares a triangle with one of them, in order. */
function withRing(lat: Lattice, verts: ArrayLike<number>): Uint32Array {
  const mark = new Uint8Array(lat.x.length)
  let count = 0
  const add = (v: number) => {
    if (!mark[v]) {
      mark[v] = 1
      count++
    }
  }
  for (let k = 0; k < verts.length; k++) {
    const v = verts[k]
    add(v)
    for (let i = lat.aroundAt[v]; i < lat.aroundAt[v + 1]; i++) {
      const t = lat.around[i] * 3
      add(lat.tris[t])
      add(lat.tris[t + 1])
      add(lat.tris[t + 2])
    }
  }
  const out = new Uint32Array(count)
  for (let v = 0, k = 0; k < count; v++) if (mark[v]) out[k++] = v
  return out
}

/** The triangles with water under at least one corner. */
function waterTriangles(depth: Float32Array, tris: Uint32Array): Uint32Array {
  const out = new Uint32Array(tris.length)
  let n = 0
  for (let t = 0; t < tris.length; t += 3) {
    if (depth[tris[t]] > 0 || depth[tris[t + 1]] > 0 || depth[tris[t + 2]] > 0) {
      out[n++] = tris[t]
      out[n++] = tris[t + 1]
      out[n++] = tris[t + 2]
    }
  }
  return out.slice(0, n)
}

function sameArray(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Bounding sphere of positions as BufferGeometry.computeBoundingSphere finds it: the box's centre, the farthest point. */
function sphereOf(pos: Float32Array): number[] {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k]
      if (pos[i + k] > max[k]) max[k] = pos[i + k]
    }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2)
  let r2 = 0
  for (let i = 0; i < pos.length; i += 3) r2 = Math.max(r2, (pos[i] - c[0]) ** 2 + (pos[i + 1] - c[1]) ** 2 + (pos[i + 2] - c[2]) ** 2)
  return [c[0], c[1], c[2], Math.sqrt(r2)]
}

// ---------------------------------------------------------------- three.js geometry (main thread)

/**
 * What the main thread gets for the terrain: complete arrays for whatever can have changed (on an update: no index,
 * coast or water vertices, and the water's triangles only when they changed), and the vertices that did, `from` up to
 * `to` (all of them on a full build), so only those go to the GPU.
 */
export interface TerrainUpdate {
  arrays: Partial<TerrainArrays>
  from: number
  to: number
}

const sphere = (s: number[]) => new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3])

/** Wraps a full build's arrays in three.js geometry (no copying). */
export function terrainGeometry(a: TerrainArrays): TerrainGeometry {
  const surface = new THREE.BufferGeometry()
  surface.setAttribute('position', new THREE.BufferAttribute(a.position, 3))
  surface.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3))
  surface.setAttribute('color', new THREE.BufferAttribute(a.color, 3))
  surface.setAttribute('aRock', new THREE.BufferAttribute(a.rock, 1))
  surface.setAttribute('aCoast', new THREE.BufferAttribute(a.coast, 1))
  surface.setIndex(new THREE.BufferAttribute(a.index, 1))
  surface.boundingSphere = sphere(a.sphere)
  // The water's index has room for every triangle, so an update can change which have water without a new buffer.
  const water = new THREE.BufferGeometry()
  water.setAttribute('position', new THREE.BufferAttribute(a.waterPosition, 3))
  water.setAttribute('aDepth', new THREE.BufferAttribute(a.depth, 1))
  const wet = new Uint32Array(a.index.length)
  wet.set(a.waterIndex)
  water.setIndex(new THREE.BufferAttribute(wet, 1))
  water.setDrawRange(0, a.waterIndex.length)
  water.boundingSphere = sphere(a.waterSphere)
  return { surface, water }
}

/**
 * Applies a terrain update: new geometry for the first build (or a lattice of another size), else the new arrays are
 * swapped into the geometry in place and only vertices `from` up to `to` are uploaded. Returns the geometry to draw.
 */
export function applyTerrain(geo: TerrainGeometry | null, u: TerrainUpdate): TerrainGeometry {
  const a = u.arrays
  const pos = geo?.surface.getAttribute('position')
  if (!geo || !pos || (a.position && a.position.length !== pos.array.length)) return terrainGeometry(a as TerrainArrays)
  const from = Math.max(0, u.from)
  const to = Math.min(pos.count, u.to)
  swap(geo.surface, 'position', a.position, from, to)
  swap(geo.surface, 'normal', a.normal, from, to)
  swap(geo.surface, 'color', a.color, from, to)
  swap(geo.surface, 'aRock', a.rock, from, to)
  swap(geo.surface, 'aCoast', a.coast, from, to)
  if (a.sphere) geo.surface.boundingSphere = sphere(a.sphere)
  const water = geo.water
  if (water) {
    swap(water, 'position', a.waterPosition, from, to)
    swap(water, 'aDepth', a.depth, from, to)
    if (a.waterIndex && water.index) {
      ;(water.index.array as Uint32Array).set(a.waterIndex)
      water.index.clearUpdateRanges()
      water.index.addUpdateRange(0, a.waterIndex.length)
      water.index.needsUpdate = true
      water.setDrawRange(0, a.waterIndex.length)
    }
    if (a.waterSphere) water.boundingSphere = sphere(a.waterSphere)
  }
  return geo
}

/** Swaps a new array (same size) into a vertex attribute and marks vertices `from` up to `to` for upload. */
function swap(g: THREE.BufferGeometry, name: string, array: Float32Array | undefined, from: number, to: number) {
  const attr = g.getAttribute(name) as THREE.BufferAttribute | undefined
  if (!array || !attr) return
  attr.array = array
  if (to <= from) return
  attr.clearUpdateRanges()
  attr.addUpdateRange(from * attr.itemSize, (to - from) * attr.itemSize)
  attr.needsUpdate = true
}

/** The terrain and water meshes for a field, built at once on this thread (what the world worker does, for scripts). */
export function buildTerrain(field: Field, _index: Map<string, number>, waterLevel: number, detail = 1): TerrainGeometry {
  return terrainGeometry(buildTerrainArrays(field, waterLevel, detail).arrays)
}
