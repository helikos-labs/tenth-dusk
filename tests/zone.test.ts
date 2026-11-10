import test from 'node:test'
import assert from 'node:assert/strict'
import { stepCost } from '../src/rules/zone.ts'
import { mk } from './helpers.ts'

test('terrain costs, roads and fords', () => {
  const z = mk(['MDFW', 'MDOM'])            // row 0 first
  assert.equal(stepCost(z, { row: 0, col: 1 }, { row: 1, col: 1 }), 1)    // onto a road
  assert.equal(stepCost(z, { row: 0, col: 2 }, { row: 0, col: 3 }), 4)    // forest to marsh
  assert.equal(stepCost(z, { row: 1, col: 1 }, { row: 1, col: 2 }), 2)    // onto a ford
  assert.equal(stepCost(z, { row: 0, col: 1 }, { row: 0, col: 2 }), 3)    // road to forest
  assert.deepEqual(stepCost(z, { row: 0, col: 3 }, { row: 0, col: 4 }), { blocked: 'offboard' })
})
test('climbing adds a step per level gained, descending adds none, minimum 1', () => {
  const z = mk(['MHA'], [[0, 1, 2]])
  assert.equal(stepCost(z, { row: 0, col: 0 }, { row: 0, col: 1 }), 3 + 1)
  assert.equal(stepCost(z, { row: 0, col: 1 }, { row: 0, col: 2 }), 4 + 1)
  assert.equal(stepCost(z, { row: 0, col: 2 }, { row: 0, col: 1 }), 3)
})
test('cliffs block a 2-level jump unless linked; peaks, water and walls block', () => {
  const z = mk(['MA'], [[0, 2]])
  assert.deepEqual(stepCost(z, { row: 0, col: 0 }, { row: 0, col: 1 }), { blocked: 'cliff' })
  z.links.add(['0,0', '0,1'].sort().join('|'))
  assert.equal(stepCost(z, { row: 0, col: 0 }, { row: 0, col: 1 }), 4 + 2)
  assert.deepEqual(stepCost(mk(['MP']), { row: 0, col: 0 }, { row: 0, col: 1 }), { blocked: 'impassable' })
  assert.deepEqual(stepCost(mk(['MR']), { row: 0, col: 0 }, { row: 0, col: 1 }), { blocked: 'impassable' })
  assert.equal(stepCost(mk(['MO']), { row: 0, col: 0 }, { row: 0, col: 1 }), 2)
})
test('a wall cell blocks even when its terrain is meadow', () => {
  const z = mk(['MM'])
  z.cells.get('0,1')!.wall = true
  assert.deepEqual(stepCost(z, { row: 0, col: 0 }, { row: 0, col: 1 }), { blocked: 'wall' })
})
