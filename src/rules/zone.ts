import type { Off } from './hex.ts'
import { key } from './hex.ts'
import { TERRAIN } from '../data/terrain.ts'
import type { TerrainId } from '../data/terrain.ts'

export type LandmarkKind = 'start' | 'hearth' | 'beacon' | 'camp' | 'hamlet' | 'cave' | 'ruins' | 'pass'

export interface ZCell {
  row: number
  col: number
  terrain: TerrainId
  level: 0 | 1 | 2 | 3
  road?: boolean
  crossing?: 'ford' | 'bridge'
  landmark?: LandmarkKind
  wall: boolean
}

// Rows and columns run from -wallDepth to rows - 1 + wallDepth.
// A link key is the two cell keys sorted and joined with "|".
export interface Zone {
  seed: string
  chapter: string
  rows: number
  cols: number
  wallDepth: number
  cells: Map<string, ZCell>
  links: Set<string>
}

export type Block = 'offboard' | 'wall' | 'impassable' | 'cliff'

export const cellAt = (z: Zone, o: Off): ZCell | undefined => z.cells.get(key(o))

export const linkKey = (a: Off, b: Off): string => [key(a), key(b)].sort().join('|')

export function stepCost(z: Zone, from: Off, to: Off): number | { blocked: Block } {
  const f = cellAt(z, from), t = cellAt(z, to)
  if (!f || !t) return { blocked: 'offboard' }
  if (t.wall) return { blocked: 'wall' }
  const steps = TERRAIN[t.terrain].steps
  if (steps === null && !t.crossing) return { blocked: 'impassable' }
  const climb = t.level - f.level
  if (Math.abs(climb) >= 2 && !z.links.has(linkKey(from, to))) return { blocked: 'cliff' }
  const base = t.road ? 1 : t.crossing === 'ford' ? 2 : t.crossing === 'bridge' ? 1 : (steps as number)
  return Math.max(1, base + Math.max(0, climb))
}
