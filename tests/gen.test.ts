import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER1 } from '../src/data/book1.ts'
import { checkFairness, daysFor, generateZone } from '../src/rules/gen.ts'
import { cellAt } from '../src/rules/zone.ts'

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
