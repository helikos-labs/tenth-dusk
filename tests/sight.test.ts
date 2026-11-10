import test from 'node:test'
import assert from 'node:assert/strict'
import { sightRadius, visible, reveal } from '../src/rules/sight.ts'
import type { Fog } from '../src/rules/sight.ts'
import type { ZCell } from '../src/rules/zone.ts'
import type { TerrainId } from '../src/data/terrain.ts'
import { mk } from './helpers.ts'

const c = (terrain: TerrainId, level: number): ZCell =>
  ({ row: 0, col: 0, terrain, level: level as ZCell['level'], wall: false })

test('sight radius by level, cover and night (§6)', () => {
  assert.equal(sightRadius(c('meadow', 0), false), 3); assert.equal(sightRadius(c('hills', 1), false), 4)
  assert.equal(sightRadius(c('mountain', 2), false), 5); assert.equal(sightRadius(c('forest', 0), false), 2)
  assert.equal(sightRadius(c('forest', 0), true), 1)
})
test('a ridge hides what lies behind it; standing on it reveals', () => {
  const z = mk(['MMMMMM', 'MMMMMM', 'AAAAAA', 'MMMMMM', 'MMMMMM'], [[], [], [2, 2, 2, 2, 2, 2]])
  const seen = visible(z, { row: 0, col: 2 }, false)
  assert.ok(seen.has('2,2'))
  assert.ok(!seen.has('3,2'))
  assert.ok(visible(z, { row: 2, col: 2 }, false).has('4,2'))
})
test('forest blocks a lowland eye but not an eye on the hills', () => {
  const z = mk(['MMM', 'FFF', 'MMM'])
  assert.ok(!visible(z, { row: 0, col: 1 }, false).has('2,1'))
  const z2 = mk(['MHM', 'FFF', 'MMM'], [[0, 1, 0]])
  assert.ok(visible(z2, { row: 0, col: 1 }, false).has('2,1'))
})
test('reveal keeps memory and never un-sinks', () => {
  let f = reveal(new Map(), new Set(['0,0', '0,1'])); f = reveal(f, new Set(['0,1']))
  assert.equal(f.get('0,0'), 2); assert.equal(f.get('0,1'), 3)
  f.set('0,1', 1 as Fog); assert.equal(reveal(f, new Set(['0,1'])).get('0,1'), 1)
})
