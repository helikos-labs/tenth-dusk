import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER1 } from '../src/data/book1.ts'
import { checkFairness, cheapestPath, daysFor, generateZone } from '../src/rules/gen.ts'
import type { Fairness } from '../src/rules/gen.ts'
import { key } from '../src/rules/hex.ts'
import { cellAt, stepCost } from '../src/rules/zone.ts'
import type { LandmarkKind, Zone } from '../src/rules/zone.ts'
import { mk } from './helpers.ts'

test('daysFor waits when a move does not fit the day', () => {
  assert.equal(daysFor([2, 2, 2]), 1); assert.equal(daysFor([4, 4]), 1 + 4 / 6); assert.equal(daysFor([1]), 1 / 6)
})
test('generation is deterministic per seed and differs across seeds', () => {
  const a = generateZone(CHAPTER1, 'REACH1'), b = generateZone(CHAPTER1, 'REACH1'), c = generateZone(CHAPTER1, 'REACH2')
  assert.deepEqual([...a.cells.values()], [...b.cells.values()]); assert.notDeepEqual([...a.cells.values()], [...c.cells.values()])
})
test('zone layout: wall ring, river band crossings, landmarks (§7.1, §14)', () => {
  const z = generateZone(CHAPTER1, 'REACH1')
  for (const c of z.cells.values()) if (c.row < 0 || c.row >= 17 || c.col < 0 || c.col >= 9) assert.ok(c.wall)
  assert.equal(cellAt(z, { row: 16, col: 4 })!.landmark, 'hearth')
  const crossings = [...z.cells.values()].filter((c) => c.terrain === 'river' && c.crossing).length
  assert.ok(crossings >= 1 && crossings <= 2)
  const beacons = [...z.cells.values()].filter((c) => c.landmark === 'beacon')
  assert.equal(beacons.length, 3); beacons.forEach((b) => assert.ok(b.col === 0 || b.col === 8))
  assert.ok([...z.cells.values()].some((c) => c.landmark === 'cave'))
  for (let band = 0; band < 17; band += 5) assert.ok([...z.cells.values()].some((c) => c.landmark === 'camp' && c.row >= band && c.row < band + 5))
})
test('1,000 seeds are all fair (S2)', () => {
  for (let i = 0; i < 1000; i++) { const z = generateZone(CHAPTER1, 'S' + i); const f = checkFairness(z); assert.ok(f.ok, `${z.seed}: ${f.reasons.join('; ')}`) }
})

test('daysFor takes the steps per day', () => {
  assert.equal(daysFor([4, 4], 8), 1)
})

test('cheapestPath: null when unreachable, honours avoid, costs[i] enters path[i + 1]', () => {
  assert.equal(cheapestPath(mk(['MPM']), { row: 0, col: 0 }, { row: 0, col: 2 }), null)
  const z = mk(['MDM', 'MMM'])
  const direct = cheapestPath(z, { row: 0, col: 0 }, { row: 0, col: 2 })!
  assert.deepEqual(direct.path.map(key), ['0,0', '0,1', '0,2'])
  const around = cheapestPath(z, { row: 0, col: 0 }, { row: 0, col: 2 }, new Set(['0,1']))!
  assert.deepEqual(around.path.map(key), ['0,0', '1,0', '1,1', '0,2'])
  const hilly = mk(['MHFW', 'MDAM', 'HMMF'], [[0, 1, 0, 0], [0, 0, 2, 0], [1, 0, 0, 0]])
  const p = cheapestPath(hilly, { row: 0, col: 0 }, { row: 2, col: 3 })!
  assert.equal(key(p.path[0]), '0,0'); assert.equal(key(p.path.at(-1)!), '2,3')
  assert.equal(p.costs.length, p.path.length - 1)
  p.costs.forEach((c, i) => assert.equal(c, stepCost(hilly, p.path[i], p.path[i + 1])))
})

// A corridor one hex wide: terrain[i] is row i, and each row touches the next. Unless told otherwise,
// a cave goes on the first free row and a camp on the first free row of each 5-row band.
function corridor(terrain: string, marks: Record<number, LandmarkKind>, opts: { cave?: boolean; campless?: number } = {}): Zone {
  const m: Record<number, LandmarkKind> = { ...marks }
  const free = (lo: number, hi: number): number => {
    for (let r = lo; r < hi; r++) if (!m[r] && terrain[r] !== 'P') return r
    throw new Error(`no free row in ${lo}–${hi - 1}`)
  }
  if (opts.cave !== false) m[free(1, terrain.length)] = 'cave'
  for (let band = 0; band < terrain.length; band += 5) {
    if (band !== opts.campless) m[free(band, Math.min(band + 5, terrain.length))] = 'camp'
  }
  return mk([...terrain], undefined, Object.fromEntries(Object.entries(m).map(([r, k]) => [`${r},0`, k])))
}
const failsOnly = (f: Fairness, prefix: string): void => {
  assert.equal(f.ok, false)
  assert.equal(f.reasons.length, 1, f.reasons.join('; '))
  assert.ok(f.reasons[0].startsWith(prefix), f.reasons[0])
}
// 22 meadow rows: hearth 10 rows up (20 steps), beacon at the far end, so the tour is 42 + 22 = 64 steps.
const BASE = { 0: 'start', 10: 'hearth', 21: 'beacon' } as const

test('fairness: a hand-built corridor that meets every check passes', () => {
  const f = checkFairness(corridor('M'.repeat(22), BASE))
  assert.deepEqual(f.reasons, []); assert.equal(f.ok, true)
  assert.equal(f.hearthDays, 20 / 6); assert.equal(f.tourDays, 8); assert.equal(f.tourDays6, 64 / 6)
})
test('fairness fails: hearth more than 7 days away', () => {
  const f = checkFairness(corridor('M'.repeat(30), { 0: 'start', 22: 'hearth', 29: 'beacon' }))   // 44 steps
  failsOnly(f, 'hearth:'); assert.equal(f.hearthDays, 7 + 2 / 6)
})
test('fairness fails: tour over 10 days at 8 steps a day', () => {
  const f = checkFairness(corridor('M'.repeat(11) + 'W'.repeat(11), BASE))   // marsh beyond the hearth: 106 steps
  failsOnly(f, 'tour-long:'); assert.ok(f.tourDays > 10)
})
test('fairness fails: tour under 9.5 days at 6 steps a day', () => {
  const f = checkFairness(corridor('M'.repeat(22), { 0: 'start', 5: 'beacon', 10: 'hearth' }))   // 20 steps
  failsOnly(f, 'tour-short:'); assert.ok(f.tourDays6 < 9.5)
})
test('fairness fails: a landmark cut off', () => {
  failsOnly(checkFairness(corridor('M'.repeat(22) + 'PM', { ...BASE, 23: 'ruins' })), 'unreachable:')
})
test('fairness fails: no camp in the last band', () => {
  failsOnly(checkFairness(corridor('M'.repeat(22), BASE, { campless: 20 })), 'camp:')
})
test('fairness fails: no cave', () => {
  failsOnly(checkFairness(corridor('M'.repeat(22), BASE, { cave: false })), 'cave:')
})
