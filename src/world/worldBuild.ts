// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/worldBuild.ts, adapted for Tenth Dusk.
// The 3D board's world (terrain mesh, water and plants) as plain typed arrays: built in full once, then updated where
// hexes change terrain or a Landmark comes or goes. It runs in the world worker (world.worker.ts), on the main thread
// when there is no worker (worldClient.ts), and in tests. No three.js objects here.
//
// What a change can reach. Every height, colour and plant reads the board through the field's probe (field.ts), which
// reads two things: the terrain of the province under the point's warped position, and each terrain region's distance
// to its border there, capped at the region's reach (1.0 for Grassland, Forest and Blight; Mountain and Water never
// change in a game). When a hex changes terrain, only the border segments along its own six edges move, all within one
// hex radius of its centre, so a probe can change only if it reads within 1 + 1.0 of that centre (FLIP_REACH). In
// world units that is at most 2.46 from the centre, as the warp moves a point by less than WARP.max (0.46). Off the
// board a point reads where the ray from the middle of the board's bounds leaves the board, somewhere in its rim province, so it
// gets one hex radius of slack round that province's centre. A normal also reads its neighbours' heights, so the ring
// of vertices round the reached ones is redone too (terrainMesh.ts patchTerrain).
// The one exception is a terrain appearing on the board or vanishing from it (the first Blight), which moves the
// distance to that terrain everywhere: then the world is built in full.

import type { WorldCell } from './adapter.ts'
import { WATER_LEVEL, buildField, hexAt, hexCenter, warpSeedOf, type Field, type Probe } from './field.ts'
import { warpBoxOf, warpData, type WarpBox } from './materials.ts'
import { buildTerrainArrays, latticeFor, patchTerrain, type TerrainArrays, type TerrainBuild, type TerrainUpdate } from './terrainMesh.ts'
import { PLANT_KINDS, joinPlants, placeIslets, placeProvince, readingOrder, type PlantLists, type PlantSets } from './vegetation.ts'

type Board = Record<string, WorldCell>

/** How far a region's distance field reaches, for every terrain that can change (field.ts, the regions' Border). */
const REGION_REACH = 1.0
/** A probe that reads the board this close to a changed hex's centre may change: 1 + REGION_REACH, and a margin. */
export const FLIP_REACH = 1 + REGION_REACH + 0.05

/** What the main thread sends: the board to show and the mesh detail (useWorld.ts). */
export interface WorldRequest {
  id: number
  board: Board
  detail: number
}

/** What comes back: the update for request `id`, or the error that stopped it. */
export interface WorldReply {
  id: number
  update?: WorldUpdate
  error?: string
}

export interface WorldUpdate {
  /** A full build: the first, another world, or a terrain that appeared or vanished. */
  full: boolean
  /** The terrain and water, when they changed (terrainMesh.ts TerrainUpdate). */
  terrain?: TerrainUpdate
  /** Every plant, when any province's plants changed. */
  plants?: PlantSets
  /** The world's warp for the shaders (materials.ts `warpData`) over its box, with the first build of each world. */
  warp?: { seed: number; data: Uint16Array; box: WarpBox }
  stats: WorldStats
}

export interface WorldStats {
  /** The builder's time in milliseconds. */
  ms: number
  /** Vertices in the mesh, vertices probed again (all on a full build), provinces planted again. */
  verts: number
  probed: number
  provinces: number
}

/**
 * Where each vertex reads the board: a point, and `slack`, how far from it the reading may lie: 0 on the board (the
 * warped point); 1 off the board (the rim province's centre); -1 never, for lakes and the sea, which take their height
 * and colour from the water's border and the coast, which never move.
 */
interface Reads {
  x: Float32Array
  z: Float32Array
  slack: Int8Array
}

const isBusy = (c: WorldCell) => !!c.landmark
/**
 * What must match for an update: the same world (warp seed and hexes) with the same terrains on it, and every hex at
 * the same level and variant (the field's level and variant borders are built once; only terrain flips are patched).
 */
const shapeOf = (board: Board) => {
  const present = [...new Set(Object.values(board).map((c) => c.terrain))].sort().join()
  const keys = Object.keys(board).sort()
  const levels = keys.map((k) => `${board[k].level}${board[k].heath ? 'h' : ''}${board[k].dense ? 'd' : ''}`).join('')
  return `${warpSeedOf(board)}|${keys.join(' ')}|${present}|${levels}`
}

/**
 * Builds a world's arrays and keeps them, so the next board costs only what changed. Feed it boards in order; each
 * update holds complete arrays for whatever changed, so a caller may skip one and apply a later one (mergeUpdates).
 */
export class WorldBuilder {
  readonly detail: number
  private board: Board | null = null
  private shape = ''
  private field: Field | null = null
  private terrain: TerrainBuild | null = null
  private reads: Reads | null = null
  private order: string[] = []
  private provinces = new Map<string, PlantLists>()
  private islets: PlantLists | null = null
  /** The warp seed this builder last sent the warp of. */
  private warpSent: number | null = null

  constructor(detail = 1) {
    this.detail = detail
  }

  /** The world for `board`: in full the first time (or for another world), else only what changed since the last. */
  build(board: Board): WorldUpdate {
    const t0 = performance.now()
    const prev = this.board
    const shape = shapeOf(board)
    if (!prev || !this.field || !this.terrain || shape !== this.shape) return this.full(board, shape, t0)
    this.board = board
    const flips: WorldCell[] = []
    const cleared = new Set<string>()
    for (const k of this.order) {
      if (prev[k].terrain !== board[k].terrain) flips.push(board[k])
      if (isBusy(prev[k]) !== isBusy(board[k])) cleared.add(k)
    }
    const stats: WorldStats = { ms: 0, verts: this.terrain.lattice.x.length, probed: 0, provinces: 0 }
    const out: WorldUpdate = { full: false, stats }
    if (flips.length || cleared.size) {
      const field = buildField(board, this.field.seed)
      this.field = field
      if (flips.length) {
        const verts = this.reached(flips)
        const { from, to, water } = patchTerrain(this.terrain, field, verts, WATER_LEVEL)
        out.terrain = { arrays: changing(this.terrain.arrays, water), from, to }
        stats.probed = verts.length
      }
      // A province's plants read the field only inside the province, whose readings lie within a hex radius of its
      // centre; a Landmark coming or going changes only its own clearing.
      const flipped = flips.map((c) => hexCenter(c.q, c.r))
      const redo = this.order.filter((k) => {
        const p = hexCenter(board[k].q, board[k].r)
        return cleared.has(k) || flipped.some((f) => Math.hypot(p.x - f.x, p.z - f.z) < 1 + FLIP_REACH)
      })
      for (const k of redo) this.provinces.set(k, placeProvince(field, board[k], this.detail))
      if (redo.length) out.plants = this.plants()
      stats.provinces = redo.length
    }
    stats.ms = performance.now() - t0
    return out
  }

  private full(board: Board, shape: string, t0: number): WorldUpdate {
    const field = buildField(board)
    const n = latticeFor(this.detail, field.bounds).x.length
    const reads: Reads = { x: new Float32Array(n), z: new Float32Array(n), slack: new Int8Array(n) }
    const terrain = buildTerrainArrays(field, WATER_LEVEL, this.detail, (v, pr) => note(reads, v, pr))
    const cells = readingOrder(board)
    this.board = board
    this.shape = shape
    this.field = field
    this.terrain = terrain
    this.reads = reads
    this.order = cells.map((c) => `${c.q},${c.r}`)
    this.provinces = new Map(cells.map((c) => [`${c.q},${c.r}`, placeProvince(field, c, this.detail)]))
    this.islets = placeIslets(field)
    // The warp changes only with the world (a terrain appearing keeps it), so it goes with a world's first build.
    const box = warpBoxOf(field.bounds)
    const warp = this.warpSent === field.seed ? undefined : { seed: field.seed, data: warpData(field.seed, box), box }
    this.warpSent = field.seed
    return {
      full: true,
      terrain: { arrays: everything(terrain.arrays), from: 0, to: n },
      plants: this.plants(),
      warp,
      stats: { ms: performance.now() - t0, verts: n, probed: n, provinces: cells.length },
    }
  }

  /** The vertices whose probe a change of terrain on `cells` can reach (see the top of this file), in order. */
  private reached(cells: WorldCell[]): Uint32Array {
    const { x, z, slack } = this.reads!
    const centres = cells.map((c) => hexCenter(c.q, c.r))
    const out: number[] = []
    for (let v = 0; v < slack.length; v++) {
      if (slack[v] < 0) continue
      const r = FLIP_REACH + slack[v]
      for (const c of centres) {
        const dx = x[v] - c.x
        const dz = z[v] - c.z
        if (dx * dx + dz * dz < r * r) {
          out.push(v)
          break
        }
      }
    }
    return Uint32Array.from(out)
  }

  /** Every plant: the provinces' in reading order, then the islets'. */
  private plants(): PlantSets {
    return joinPlants([...this.order.map((k) => this.provinces.get(k)!), this.islets!])
  }
}

/** Notes where vertex v reads the board (see Reads). */
function note(reads: Reads, v: number, pr: Probe) {
  if (pr.ground === 'water' || pr.ground === 'sea' || !pr.cell) {
    reads.slack[v] = -1
    return
  }
  const h = hexAt(pr.w.x, pr.w.z)
  const on = h.q === pr.cell.q && h.r === pr.cell.r
  const c = on ? pr.w : hexCenter(pr.cell.q, pr.cell.r)
  reads.x[v] = c.x
  reads.z[v] = c.z
  reads.slack[v] = on ? 0 : 1
}

/** Copies of every array (the builder keeps its own to patch, and copies can be handed to another thread). */
function everything(a: TerrainArrays): Partial<TerrainArrays> {
  return {
    ...changing(a, true),
    coast: a.coast.slice(),
    index: a.index.slice(),
    waterPosition: a.waterPosition.slice(),
    waterSphere: [...a.waterSphere],
  }
}

/** Copies of the arrays a change of terrain can touch; the water's triangles only when they changed. */
function changing(a: TerrainArrays, water: boolean): Partial<TerrainArrays> {
  const out: Partial<TerrainArrays> = {
    position: a.position.slice(),
    normal: a.normal.slice(),
    color: a.color.slice(),
    rock: a.rock.slice(),
    depth: a.depth.slice(),
    sphere: [...a.sphere],
  }
  if (water) out.waterIndex = a.waterIndex.slice()
  return out
}

/**
 * One update standing for `older` then `newer` (from one builder, in order): newer arrays win, older ones fill in
 * what the newer left out, and the changed vertices add up. The main thread holds a result back this way while it waits
 * for a newer board's.
 */
export function mergeUpdates(older: WorldUpdate, newer: WorldUpdate): WorldUpdate {
  let terrain = newer.terrain ?? older.terrain
  if (older.terrain && newer.terrain) {
    const arrays: Record<string, unknown> = { ...older.terrain.arrays }
    for (const [k, v] of Object.entries(newer.terrain.arrays)) if (v !== undefined) arrays[k] = v
    terrain = { arrays, from: Math.min(older.terrain.from, newer.terrain.from), to: Math.max(older.terrain.to, newer.terrain.to) }
  }
  return { full: older.full || newer.full, terrain, plants: newer.plants ?? older.plants, warp: newer.warp ?? older.warp, stats: newer.stats }
}

/** The buffers an update can hand to another thread without copying (each array is its own copy). */
export function transferables(u: WorldUpdate): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  if (u.warp) out.push(u.warp.data.buffer as ArrayBuffer)
  for (const v of Object.values(u.terrain?.arrays ?? {})) if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer)
  for (const k of PLANT_KINDS) {
    const s = u.plants?.[k]
    if (!s) continue
    out.push(s.matrix.buffer as ArrayBuffer)
    if (s.color) out.push(s.color.buffer as ArrayBuffer)
  }
  return out
}
