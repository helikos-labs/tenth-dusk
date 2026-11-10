import test from 'node:test'
import assert from 'node:assert/strict'
import { toAxial, toOffset, neighbours, distance, line } from '../src/rules/hex.ts'

test('axial round-trips and matches world position', () => {
  for (let row = 0; row < 30; row++) for (let col = 0; col < 12; col++) {
    const a = toAxial({ row, col }); assert.deepEqual(toOffset(a), { row, col })
    const x = Math.sqrt(3) * (a.q + a.r / 2); assert.ok(Math.abs(x - Math.sqrt(3) * (col + 0.5 * (row & 1))) < 1e-9)
    assert.equal(1.5 * a.r, -1.5 * row)            // z = 1.5 r: forward is −z, up the screen
  }
})
test('neighbours are at distance 1 and include the row above', () => {
  for (const o of [{ row: 4, col: 3 }, { row: 5, col: 3 }]) {
    const n = neighbours(o); assert.equal(n.length, 6); n.forEach((m) => assert.equal(distance(o, m), 1))
  }
  assert.deepEqual(neighbours({ row: 4, col: 3 }).filter((m) => m.row === 5).map((m) => m.col).sort(), [2, 3])
  assert.deepEqual(neighbours({ row: 5, col: 3 }).filter((m) => m.row === 6).map((m) => m.col).sort(), [3, 4])
})
test('line is contiguous, inclusive and symmetric in length', () => {
  const a = { row: 0, col: 0 }, b = { row: 7, col: 5 }; const l = line(a, b)
  assert.deepEqual(l[0], a); assert.deepEqual(l.at(-1), b); assert.equal(l.length, distance(a, b) + 1)
  for (let i = 1; i < l.length; i++) assert.equal(distance(l[i - 1], l[i]), 1)
  assert.equal(line(b, a).length, l.length)
})
