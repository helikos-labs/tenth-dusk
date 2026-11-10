// Where the hero can walk this turn, for the world's highlight and the path preview (§5.1). A hex is reachable when
// it is in sight, its cheapest path (rules/run.ts `path`) runs only over in-sight hexes, and the steps left pay for
// it: so neither the highlight nor a preview ever shows on, or runs through, a hex the hero hasn't seen.
import { key, type Off } from '../rules/hex.ts'
import { path, type RunState } from '../rules/run.ts'

/** Each reachable hex (offset key "row,col") with its path from the hero's hex (both ends included). */
export function reachable(run: RunState): Map<string, Off[]> {
  const out = new Map<string, Off[]>()
  if (run.status !== 'walking') return out
  const left = run.night ? run.nightSteps : run.steps
  const here = key(run.at)
  for (const [k, f] of run.fog) {
    if (f !== 3 || k === here) continue
    const c = run.zone.cells.get(k)
    if (!c || c.wall) continue
    const p = path(run, { row: c.row, col: c.col })
    if (!p || p.costs.reduce((a, b) => a + b, 0) > left) continue
    if (p.path.some((o) => run.fog.get(key(o)) !== 3)) continue
    out.set(k, p.path)
  }
  return out
}
