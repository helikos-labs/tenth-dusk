import test from 'node:test'
import assert from 'node:assert/strict'
import { newRun } from '../src/rules/run.ts'
import { reachable } from '../src/scenes/reach.ts'
import { mk } from './helpers.ts'

// Meadow costs 2 and road 1; the start sees 3 hexes round it on open lowland.
const rows = ['DDDDD', 'MMMMM', 'MMMMM', 'MMMMM', 'MMMMM', 'MMMMM']

test('reachable: in-sight hexes the steps left can pay for, each with its path from the hero', () => {
  const run = newRun(mk(rows, undefined, { '0,0': 'start' }), 'Wren')
  const r = reachable(run)
  // Along the road: 1 step a hex; meadow 2 a hex. 0,4 is affordable but out of sight (4 away).
  assert.deepEqual(r.get('0,3')?.map((o) => `${o.row},${o.col}`), ['0,0', '0,1', '0,2', '0,3'])
  assert.ok(!r.has('0,4'))
  assert.ok(r.has('1,0') && r.has('2,0'))
  assert.ok(!r.has('0,0'), 'not the hero’s own hex')
  for (const k of r.keys()) assert.equal(run.fog.get(k), 3, `${k} is in sight`)
})

test('reachable: nothing beyond the steps left, nothing unseen, nothing once the run is over', () => {
  const run = newRun(mk(rows, undefined, { '0,0': 'start' }), 'Wren')
  const short = { ...run, steps: 2 }
  assert.deepEqual([...reachable(short).keys()].sort(), ['0,1', '0,2', '1,0'])
  const fog = new Map(run.fog)
  fog.set('0,2', 0)
  // 0,2 hidden: neither it nor anything whose path runs through it.
  const hidden = reachable({ ...run, fog })
  assert.ok(!hidden.has('0,2') && !hidden.has('0,3'))
  assert.equal(reachable({ ...run, status: 'hearth' }).size, 0)
})
