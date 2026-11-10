// Tenth Dusk's side of the world core (the files copied from Rift & Root): the cell the engine draws, and the zone
// turned into those cells. The engine knows nothing of the rules beyond this file.
import { TERRAIN, type Engine } from '../data/terrain.ts'
import { toAxial } from '../rules/hex.ts'
import type { Zone } from '../rules/zone.ts'

/** An axial hex: the engine's coordinates (field.ts hexCenter). */
export type Hex = { q: number; r: number }

/** The engine's terrains: each Tenth Dusk terrain is drawn as one of these (data/terrain.ts `engine`). */
export type Terrain = Engine

/** One hex as the engine draws it. */
export interface WorldCell {
  q: number
  r: number
  terrain: Terrain
  level: number
  /** Outside the zone: the ring of impassable wall cells. */
  wall: boolean
  /** A road, or a crossing of water (a bridge, or a ford drawn as one). */
  road?: 'road' | 'bridge'
  landmark?: string
  /** Old wood: a denser, darker forest. */
  dense?: boolean
  /** Heath: a grassland palette variant. */
  heath?: boolean
}

/** The zone as the engine's cells, keyed "q,r" (axial, from each cell's offset row and column). */
export function zoneToWorld(z: Zone): Record<string, WorldCell> {
  const out: Record<string, WorldCell> = {}
  for (const c of z.cells.values()) {
    const { q, r } = toAxial(c)
    const w: WorldCell = { q, r, terrain: TERRAIN[c.terrain].engine, level: c.level, wall: c.wall }
    if (c.crossing) w.road = 'bridge'
    else if (c.road) w.road = 'road'
    if (c.landmark) w.landmark = c.landmark
    if (c.terrain === 'oldwood') w.dense = true
    if (c.terrain === 'heath') w.heath = true
    out[`${q},${r}`] = w
  }
  return out
}
