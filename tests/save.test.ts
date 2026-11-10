import test from 'node:test'
import assert from 'node:assert/strict'
import { move, newRun, canMove } from '../src/rules/run.ts'
import type { RunState } from '../src/rules/run.ts'
import { neighbours } from '../src/rules/hex.ts'
import { generateZone } from '../src/rules/gen.ts'
import { CHAPTER1 } from '../src/data/book1.ts'
import { load, serialise, SAVE_KEY } from '../src/rules/save.ts'

const firstAffordableNeighbour = (s: RunState) => {
  const n = neighbours(s.at).find((o) => canMove(s, o).ok)
  assert.ok(n, 'a neighbour is affordable')
  return n
}
const stripZone = (s: RunState) => {
  const { zone: _zone, ...rest } = s
  return rest
}

test('a mid-day run round-trips exactly', () => {
  let s = newRun(generateZone(CHAPTER1, 'REACH1'), 'Wren'); s = move(s, firstAffordableNeighbour(s))
  const r = load(serialise(s)); assert.ok(r.ok); assert.deepEqual(stripZone(r.run), stripZone(s)); assert.equal(r.run.zone.seed, 'REACH1')
})
test('empty, corrupt and newer saves are refused with a reason', () => {
  assert.deepEqual(load(null), { ok: false, reason: 'empty' }); assert.deepEqual(load('{oops'), { ok: false, reason: 'corrupt' })
  assert.deepEqual(load(JSON.stringify({ v: 99, savedAt: 0, run: {} })), { ok: false, reason: 'newer' })
  assert.deepEqual(load(JSON.stringify({ v: 1, savedAt: 0, run: { at: 'x' } })), { ok: false, reason: 'corrupt' })
})
test('a saved position outside the zone, or an unknown chapter, is corrupt', () => {
  const s = newRun(generateZone(CHAPTER1, 'REACH1'), 'Wren')
  const edit = (f: (run: Record<string, unknown>) => void) => {
    const file = JSON.parse(serialise(s)); f(file.run); return load(JSON.stringify(file))
  }
  assert.deepEqual(edit((r) => { r.at = { row: 9999, col: 0 } }), { ok: false, reason: 'corrupt' })
  assert.deepEqual(edit((r) => { r.zone = { chapter: 'nope', seed: 'x' } }), { ok: false, reason: 'corrupt' })
  assert.deepEqual(edit((r) => { r.fog = [['0,0', 7]] }), { ok: false, reason: 'corrupt' })
  assert.deepEqual(edit((r) => { r.status = 'dead' }), { ok: false, reason: 'corrupt' })
})
test('the save key names version 1', () => assert.equal(SAVE_KEY, 'tenth-dusk.save.v1'))
