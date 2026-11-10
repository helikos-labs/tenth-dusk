import type { Off } from './hex.ts'
import { distance, key, line } from './hex.ts'
import { TERRAIN } from '../data/terrain.ts'
import { cellAt } from './zone.ts'
import type { Zone, ZCell } from './zone.ts'

export type Fog = 0 | 1 | 2 | 3 // 0 unseen, 1 sunk, 2 remembered, 3 in sight

export function sightRadius(c: ZCell, night: boolean): number {
  const wood = TERRAIN[c.terrain].cover > 0 ? 1 : 0
  return Math.max(1, 3 + c.level - wood - (night ? 1 : 0))
}

export function visible(z: Zone, from: Off, night: boolean): Set<string> {
  const seen = new Set<string>()
  const origin = cellAt(z, from)
  if (!origin) return seen
  seen.add(key(from))
  const eye = origin.level + 0.5
  const r = sightRadius(origin, night)
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const t = { row: from.row + dr, col: from.col + dc }
      const tc = cellAt(z, t)
      if (!tc || distance(from, t) > r) continue
      const path = line(from, t)
      let clear = true
      for (let i = 1; i < path.length - 1 && clear; i++) {
        const b = cellAt(z, path[i])
        if (b && b.level + TERRAIN[b.terrain].cover >= eye) clear = false
      }
      if (clear) seen.add(key(t))
    }
  }
  return seen
}

export function reveal(fog: Map<string, Fog>, seen: Set<string>): Map<string, Fog> {
  const out = new Map<string, Fog>()
  for (const [k, v] of fog) out.set(k, v === 3 && !seen.has(k) ? 2 : v)
  for (const k of seen) if (out.get(k) !== 1) out.set(k, 3)
  return out
}
