import test from 'node:test'
import assert from 'node:assert/strict'
import { camp, move, newRun } from '../src/rules/run.ts'
import type { RunEvent } from '../src/rules/run.ts'
import { eventCopy, newestNotice } from '../src/ui/notices.ts'
import { mk } from './helpers.ts'

const at = { row: 0, col: 0 }
const ev = (kind: RunEvent['kind']): RunEvent => ({ kind, at, day: 1 })

test('each event the player should see has its line; the rest say nothing', () => {
  assert.equal(eventCopy(ev('cold'), 'Ash'), 'The cold bites · −2 vigour')
  assert.equal(eventCopy(ev('leeches'), 'Ash'), 'Leeches in the mire · −2 vigour')
  assert.equal(eventCopy(ev('fell'), 'Ash'), 'Ash falls · wakes at camp, a day lost')
  assert.equal(eventCopy(ev('pushed'), 'Ash'), 'The Hush rises · Ash wakes further on')
  assert.equal(eventCopy(ev('sunk'), 'Ash'), 'The Hush takes the land behind')
  assert.equal(eventCopy(ev('beacon'), 'Ash'), 'Beacon lit · +1 max ember')
  for (const kind of ['moved', 'camped', 'hearth', 'expired'] as const) assert.equal(eventCopy(ev(kind), 'Ash'), null, kind)
})

test('newestNotice tells the newest unseen event that has a line', () => {
  const events = [ev('cold'), ev('moved'), ev('leeches'), ev('fell'), ev('moved')]
  assert.equal(newestNotice(events, 0, 'Wren'), 'Wren falls · wakes at camp, a day lost')
  assert.equal(newestNotice(events, 3, 'Wren'), 'Wren falls · wakes at camp, a day lost')
  assert.equal(newestNotice(events, 4, 'Wren'), null) // only a move is new
  assert.equal(newestNotice(events, 5, 'Wren'), null) // nothing is new
  assert.equal(newestNotice([], 0, 'Wren'), null)
})

test('the rules’ own events map to lines: a camp that pushes the hero, marsh leeches, a beacon', () => {
  const grid = Array.from({ length: 14 }, () => 'MMMM')
  const s0 = newRun(mk(grid, undefined, { '3,0': 'start', '13,3': 'hearth' }), 'Ash')
  const pushed = camp({ ...s0, furthestRow: 10 }, ['rest'])
  assert.equal(newestNotice(pushed.events, s0.events.length, 'Ash'), 'The Hush rises · Ash wakes further on')
  const sunk = camp({ ...s0, furthestRow: 6 }, ['rest']) // rows 0 and 1 sink; the hero on row 3 stays
  assert.equal(newestNotice(sunk.events, 0, 'Ash'), 'The Hush takes the land behind')
  const marsh = newRun(mk(['MW', 'MM'], undefined, { '0,0': 'start', '1,1': 'beacon' }), 'Ash')
  const wet = move(marsh, { row: 0, col: 1 })
  assert.equal(newestNotice(wet.events, 0, 'Ash'), 'Leeches in the mire · −2 vigour')
  const lit = move(wet, { row: 1, col: 1 })
  assert.equal(newestNotice(lit.events, wet.events.length, 'Ash'), 'Beacon lit · +1 max ember')
})
