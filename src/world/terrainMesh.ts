// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/terrainMesh.ts, adapted for Tenth Dusk.
// Terrain geometry for the 3D board. ORGANIC CONCEPT: one triangle-lattice mesh over the zone's bounds instead of one
// hexagon per hex, so nothing in the geometry follows the grid. Every vertex takes its height and colour from the field
// (field.ts), whose regions are domain-warped: borders meander, terrains blend across them (forest fringe into meadow,
// sand and mud at the water, scree round a range's foot, rock on cliffs) and the coast has beaches, cliffs and islets.
import * as THREE from 'three'
import type { Terrain, WorldCell } from './adapter.ts'
import { LAND, PEAK_SCALE, SQRT3, WATER_LEVEL, fbm, fray, ridged, smoothstep, type Bounds, type Field, type Probe, type Rect } from './field.ts'
import { flowersOf } from './flora.ts'
import { TEXELS, slotOf } from './materials.ts'
import { PALETTE as PAL } from './palette.ts'

/**
 * The lattice (§15.3 detail rings, §15.6 budget). Spacing `STEP / detail` (world units; a hex is 2 across its corners)
 * inside the zone's bounds grown by `FINE_MARGIN`, `COARSE` times that out in the wall ring, over a rectangle round the
 * whole board grown by `OUTER_MARGIN` with corners rounded `CORNER`. `BUDGET` vertices at detail 1, scaling with the
 * square of the detail (26k at 0.75); a board too big for it gets both steps coarsened evenly.
 */
export const LATTICE = { STEP: 0.085, COARSE: 2.5, FINE_MARGIN: 1, OUTER_MARGIN: 0.5, CORNER: 1.5, BUDGET: 46_000 }

export const TERRAIN_ID: Record<Terrain, number> = { grassland: 0, forest: 1, mountain: 2, water: 3, blight: 4 }

/** Each hex's slot in the shaders' state texture (a fixed grid of axial coordinates, see materials.ts). */
export function hexIndex(board: Record<string, WorldCell>): Map<string, number> {
  return new Map(Object.values(board).map((c) => [`${c.q},${c.r}`, slotOf(c.q, c.r)]))
}

/**
 * Writes texel 1 of each hex's slot (materials.ts makeStateTexture): its Landmark and its terrain, so a pixel knows a
 * lake from land (0: the sea, no hex), and marks the texture for upload. Texels 0 and 2 are left as they are.
 */
export function writeCells(tex: THREE.DataTexture, slots: Map<string, number>, board: Record<string, WorldCell>): void {
  const data = tex.image.data as Uint8Array
  for (const [k, slot] of slots) {
    const c = board[k]
    if (!c) continue
    data.set([0, c.landmark ? 255 : 0, 0, Math.round(((TERRAIN_ID[c.terrain] + 1) / 8) * 255)], (slot * TEXELS + 1) * 4)
  }
  tex.needsUpdate = true
}

const tmp = new THREE.Color()
const tmpFlower = new THREE.Color()
const tmpHeath = new THREE.Color()
const tmpSnow = new THREE.Color()
const tmpWood = new THREE.Color()

/**
 * How far snow covers a mountain point (0 to 1), before slope: on mountains a ragged line 0.66 to 0.86 above the
 * terrace, on peaks above 70% of the local maximum (the height the crests reach there, field.ts `top`), so the crests
 * of a wall are white and its gullies and faces bare. `n` and `m` are the colour noise (0.5 for none).
 */
function snowLine(pr: Probe, h: number, n: number, m: number): number {
  const wobble = 0.12 * (n - 0.5) + 0.1 * (m - 0.5)
  const mountain = smoothstep(0.66, 0.86, h - pr.terrace + wobble)
  const peak = smoothstep(0.66, 0.76, h / Math.max(pr.top, 1e-6) + 0.5 * wobble)
  return mountain + (peak - mountain) * smoothstep(1, PEAK_SCALE, pr.scale)
}

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
      // Heath: the meadow's palette variant, ochre and dry (its weight blends across its frayed border).
      tmpHeath.copy(PAL.heath).lerp(PAL.heathDry, smoothstep(0.4, 0.7, n))
      out.lerp(tmpHeath, smoothstep(-0.12, 0.12, pr.heath + fray('grassland', x, z) * 0.5))
      // A haze of the field's main flower, in drifts.
      if (pr.cell) {
        const bloom = fbm(x * 2.2, z * 2.2, 15, 3)
        out.lerp(tmpFlower.set(flowersOf(pr.cell.q, pr.cell.r, !!pr.cell.heath).main.color), smoothstep(0.55, 0.8, bloom) * 0.13)
      }
      return out
    }
    case 'forest':
      out.copy(PAL.forest).lerp(PAL.forestDark, smoothstep(0.35, 0.7, m))
      // Old wood: the same wood, darker (its weight blends across its frayed border like a terrain's).
      tmpWood.copy(PAL.oldwood).lerp(PAL.oldwoodDark, smoothstep(0.35, 0.7, m))
      return out.lerp(tmpWood, smoothstep(-0.12, 0.12, pr.dense + fray('forest', x, z) * 0.5))
    case 'mountain': {
      const crack = ridged(x * 5.5, z * 5.5, 13, 2)
      // Heights here are measured from the terrace the range stands on (field.ts LEVEL_HEIGHT).
      const rel = h - pr.terrace
      out.copy(PAL.rock).lerp(PAL.rockLight, smoothstep(0.5, 0.85, n) * 0.6)
      out.lerp(PAL.rockDark, smoothstep(0.75, 0.45, ny) * 0.6 + smoothstep(0.6, 0.9, crack) * 0.25)
      // Grassy foothills, scree on the shoulders, snow on gentle high ground.
      out.lerp(PAL.grass, smoothstep(0.2, 0.04, rel) * 0.75)
      out.lerp(PAL.scree, smoothstep(0.25, 0.5, rel) * smoothstep(0.9, 0.7, ny) * 0.25)
      // Hills are heath on their gentle ground, with rock where they steepen.
      tmpHeath.copy(PAL.heath).lerp(PAL.heathDry, smoothstep(0.4, 0.7, n))
      out.lerp(tmpHeath, (1 - smoothstep(0.3, 1, pr.scale)) * smoothstep(0.5, 0.8, ny) * 0.9)
      // Snow lies in tongues and patches, not one sheet: a ragged snow line, rock showing through in streaks where the
      // slope steepens, and wind-packed blue-grey drifts among the fresh white.
      const line = snowLine(pr, h, n, m)
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
  const range = smoothstep(-0.05, 0.12, pr.sd.mountain) * smoothstep(0.08, 0.3, pr.height - pr.terrace) * (1 - snowLine(pr, pr.height, 0.5, 0.5))
  return Math.max(range, smoothstep(0.8, 0.55, ny) * 0.8)
}

export interface TerrainGeometry {
  surface: THREE.BufferGeometry
  /** Water surface over the whole board (lakes and sea), with the depth below each vertex. */
  water: THREE.BufferGeometry | null
}

// ---------------------------------------------------------------- the mesh as plain arrays
//
// The mesh is built as typed arrays with no three.js objects in them (`buildTerrainArrays`), so the world worker
// (world.worker.ts) can build it off the main thread and hand the buffers over; the main thread only wraps them
// (`terrainGeometry`). When hexes change terrain, `patchTerrain` redoes only the vertices the change can reach
// (worldBuild.ts works out which) and keeps the rest.

/** A triangle lattice over the board (see `latticeFor`) as typed arrays, with the triangles round each vertex. */
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

/** A triangle mesh under construction: points (x, z pairs) and triangles. */
interface Sheet {
  pts: number[]
  tris: number[]
}

const grow = (r: Rect, by: number): Rect => ({ minX: r.minX - by, maxX: r.maxX + by, minZ: r.minZ - by, maxZ: r.maxZ + by })
const within = (r: Rect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ
/** True if (x, z) lies in rectangle r with its corners rounded `k`. */
function inRounded(r: Rect, k: number, x: number, z: number): boolean {
  const dx = Math.max(r.minX + k - x, 0, x - (r.maxX - k))
  const dz = Math.max(r.minZ + k - z, 0, z - (r.maxZ - k))
  return within(r, x, z) && dx * dx + dz * dz <= k * k
}

/**
 * A triangle lattice of spacing `step` laid from the corner of `box`, keeping the points `keep` accepts and the
 * triangles whose three corners it keeps, wound so normals face up. Points ids start at `base`.
 */
function sheet(box: Rect, step: number, keep: (x: number, z: number) => boolean, base: number): Sheet {
  const rowH = (step * SQRT3) / 2
  const rows = Math.floor((box.maxZ - box.minZ) / rowH) + 1
  const cols = Math.floor((box.maxX - box.minX) / step) + 1
  const ids = new Int32Array(rows * cols).fill(-1)
  const pts: number[] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = box.minX + i * step + (j % 2 ? step / 2 : 0)
      const z = box.minZ + j * rowH
      if (!keep(x, z)) continue
      ids[j * cols + i] = base + pts.length / 2
      pts.push(x, z)
    }
  const tris: number[] = []
  const at = (j: number, i: number) => (j < rows && i < cols ? ids[j * cols + i] : -1)
  const tri = (a: number, b: number, c: number) => {
    if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c)
  }
  for (let j = 0; j + 1 < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (j % 2 === 0) {
        tri(at(j, i), at(j + 1, i), at(j, i + 1))
        if (i > 0) tri(at(j, i), at(j + 1, i - 1), at(j + 1, i))
      } else {
        tri(at(j, i), at(j + 1, i), at(j + 1, i + 1))
        tri(at(j, i), at(j + 1, i + 1), at(j, i + 1))
      }
    }
  return { pts, tris }
}

/** Twice the signed area of triangle a, b, c on the ground, positive when its normal ((C − B) × (A − B)) faces up. */
function upArea(p: number[], a: number, b: number, c: number): number {
  const abx = p[a * 2] - p[b * 2]
  const abz = p[a * 2 + 1] - p[b * 2 + 1]
  const cbx = p[c * 2] - p[b * 2]
  const cbz = p[c * 2 + 1] - p[b * 2 + 1]
  return cbz * abx - cbx * abz
}

/** The closed loops of a mesh's outline (edges on one triangle only), each as vertex ids in walking order. */
function outlines(tris: number[]): number[][] {
  const count = new Map<number, number>()
  const id = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a)
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = id(tris[t + e], tris[t + ((e + 1) % 3)])
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  const next = new Map<number, number>()
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e]
      const b = tris[t + ((e + 1) % 3)]
      if (count.get(id(a, b)) === 1) next.set(a, b)
    }
  const loops: number[][] = []
  const seen = new Set<number>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    for (let v: number | undefined = start; v !== undefined && !seen.has(v); v = next.get(v)) {
      seen.add(v)
      loop.push(v)
    }
    loops.push(loop)
  }
  return loops
}

/**
 * Stitches the gap between two nested loops round (cx, cz), `inner` (the fine sheet's outline) and `outer` (the coarse
 * ring's hole), with triangles that each join neighbouring points: both loops are walked by angle round the centre and
 * whichever's next point comes first is joined to the other's current one. Wound to face up.
 */
function stitch(p: number[], inner: number[], outer: number[], cx: number, cz: number, out: number[]) {
  const ordered = (loop: number[]) => {
    const ang = loop.map((v) => Math.atan2(p[v * 2 + 1] - cz, p[v * 2] - cx))
    // Walk the loop with the angle rising, from its smallest angle.
    let turn = 0
    for (let i = 0; i < loop.length; i++) {
      let d = ang[(i + 1) % loop.length] - ang[i]
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      turn += d
    }
    const ids = turn > 0 ? loop : [...loop].reverse()
    const as = turn > 0 ? ang : [...ang].reverse()
    let s0 = 0
    for (let i = 1; i < as.length; i++) if (as[i] < as[s0]) s0 = i
    const v = [...ids.slice(s0), ...ids.slice(0, s0)]
    const a = [...as.slice(s0), ...as.slice(0, s0)]
    for (let i = 1; i < a.length; i++) while (a[i] < a[i - 1]) a[i] += 2 * Math.PI
    v.push(v[0])
    a.push(a[0] + 2 * Math.PI)
    return { v, a }
  }
  const A = ordered(inner)
  const B = ordered(outer)
  const face = (a: number, b: number, c: number) => {
    if (upArea(p, a, b, c) >= 0) out.push(a, b, c)
    else out.push(a, c, b)
  }
  let i = 0
  let j = 0
  const nA = A.v.length - 1
  const nB = B.v.length - 1
  while (i < nA || j < nB) {
    if (j >= nB || (i < nA && A.a[i + 1] <= B.a[j + 1])) {
      face(A.v[i], A.v[i + 1], B.v[j])
      i++
    } else {
      face(A.v[i], B.v[j + 1], B.v[j])
      j++
    }
  }
}

/**
 * The lattice over `bounds` at spacing `step` (§15.3 detail rings): fine inside the zone's bounds grown by
 * FINE_MARGIN, COARSE times coarser in the wall ring out to the board's rounded outline, the two stitched along the
 * gap between them. A board whose wall ring is too thin for a coarse ring (or has none) is fine throughout.
 */
function lattice(bounds: Bounds, step: number): Sheet {
  const L = LATTICE
  const outer = grow(bounds, L.OUTER_MARGIN)
  const inOuter = (x: number, z: number) => inRounded(outer, L.CORNER, x, z)
  const fine = grow(bounds.inner, L.FINE_MARGIN)
  const coarse = step * L.COARSE
  const gap = coarse * 0.5
  const hole = grow(fine, gap)
  // The coarse ring must go all the way round, with room for a row of its own past the gap, and the fine sheet's
  // corners must lie inside the rounded outline.
  const ring =
    hole.minX - outer.minX > coarse * 1.5 &&
    outer.maxX - hole.maxX > coarse * 1.5 &&
    hole.minZ - outer.minZ > coarse * 1.5 &&
    outer.maxZ - hole.maxZ > coarse * 1.5 &&
    [fine.minX, fine.maxX].every((x) => [fine.minZ, fine.maxZ].every((z) => inOuter(x, z)))
  if (!ring) return sheet(outer, step, inOuter, 0)
  const a = sheet(fine, step, () => true, 0)
  const b = sheet(outer, coarse, (x, z) => inOuter(x, z) && !within(hole, x, z), a.pts.length / 2)
  const pts = [...a.pts, ...b.pts]
  const tris = [...a.tris, ...b.tris]
  const cx = (fine.minX + fine.maxX) / 2
  const cz = (fine.minZ + fine.maxZ) / 2
  const inner = outlines(a.tris)
  // The ring's outline is two loops, its rim and its hole: the hole is the one that stays nearer the middle.
  const loops = outlines(b.tris)
  const reach = (loop: number[]) => Math.max(...loop.map((v) => Math.hypot(pts[v * 2] - cx, pts[v * 2 + 1] - cz)))
  if (inner.length !== 1 || loops.length !== 2) return sheet(outer, step, inOuter, 0)
  stitch(pts, inner[0], reach(loops[0]) < reach(loops[1]) ? loops[0] : loops[1], cx, cz, tris)
  return { pts, tris }
}

/** Drops points no triangle uses (a lattice's ragged edge leaves a few) and numbers the rest in order. */
function prune(m: Sheet): Sheet {
  const n = m.pts.length / 2
  const used = new Uint8Array(n)
  for (const v of m.tris) used[v] = 1
  const map = new Int32Array(n).fill(-1)
  const pts: number[] = []
  for (let v = 0; v < n; v++) {
    if (!used[v]) continue
    map[v] = pts.length / 2
    pts.push(m.pts[v * 2], m.pts[v * 2 + 1])
  }
  return { pts, tris: m.tris.map((v) => map[v]) }
}

const lattices = new Map<string, Lattice>()

/**
 * The lattice for a detail level (1 on desktops, less on phones: useWorld.ts) over a board's bounds, made once per
 * board shape, as nothing else changes it. Its step is `LATTICE.STEP / detail`, coarsened evenly until the vertices
 * fit the budget (§15.6).
 */
export function latticeFor(detail: number, bounds: Bounds): Lattice {
  const d = Math.max(0.5, detail)
  const k = `${d}|${[bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, bounds.inner.minX, bounds.inner.maxX, bounds.inner.minZ, bounds.inner.maxZ].map((v) => v.toFixed(4)).join(',')}`
  const known = lattices.get(k)
  if (known) return known
  const budget = LATTICE.BUDGET * d * d
  let step = LATTICE.STEP / d
  let m = prune(lattice(bounds, step))
  for (let i = 0; i < 20 && m.pts.length / 2 > budget; i++) {
    step *= Math.sqrt(m.pts.length / 2 / budget) * 1.01
    m = prune(lattice(bounds, step))
  }
  const { pts, tris } = m
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
  if (lattices.size > 6) lattices.delete(lattices.keys().next().value!)
  lattices.set(k, made)
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
  const lat = latticeFor(detail, field.bounds)
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
