import { TERRAIN } from '../src/data/terrain.ts'
import type { TerrainId } from '../src/data/terrain.ts'
import type { LandmarkKind, Zone, ZCell } from '../src/rules/zone.ts'

const LETTERS: Record<string, { terrain: TerrainId; road?: boolean; crossing?: 'ford' }> = {
  M: { terrain: 'meadow' },
  H: { terrain: 'hills' },
  F: { terrain: 'forest' },
  A: { terrain: 'mountain' },
  P: { terrain: 'peaks' },
  W: { terrain: 'marsh' },
  R: { terrain: 'river' },
  D: { terrain: 'meadow', road: true },
  O: { terrain: 'river', crossing: 'ford' },
}

// Test zone builder. rows[0] is row 0; levels[row][col] overrides the terrain's default level.
export function mk(rows: string[], levels?: number[][], landmarks?: Record<string, LandmarkKind>): Zone {
  const cells = new Map<string, ZCell>()
  rows.forEach((line, row) => {
    ;[...line].forEach((ch, col) => {
      const def = LETTERS[ch]
      if (!def) throw new Error(`unknown terrain letter '${ch}'`)
      const k = `${row},${col}`
      const cell: ZCell = {
        row, col, terrain: def.terrain,
        level: (levels?.[row]?.[col] ?? TERRAIN[def.terrain].levels[0]) as ZCell['level'],
        wall: false,
      }
      if (def.road) cell.road = true
      if (def.crossing) cell.crossing = def.crossing
      if (landmarks?.[k]) cell.landmark = landmarks[k]
      cells.set(k, cell)
    })
  })
  return { seed: 'test', chapter: 'test', rows: rows.length, cols: rows[0]?.length ?? 0, wallDepth: 0, cells, links: new Set() }
}
