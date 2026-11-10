import test from 'node:test'
import assert from 'node:assert/strict'
import { camp, campOptions, canMove, move, newRun, path, pressOn } from '../src/rules/run.ts'
import type { RunState } from '../src/rules/run.ts'
import { STARTING_HERO } from '../src/data/kit.ts'
import { distance, key } from '../src/rules/hex.ts'
import { mk } from './helpers.ts'

const START = { '0,0': 'start' } as const
const grid = (rows: number, cols = 4, ch = 'M') => Array.from({ length: rows }, () => ch.repeat(cols))
const meadow = (rows: number, extra: Record<string, never | string> = {}) =>
  newRun(mk(grid(rows), undefined, { ...START, ...extra } as never), 'Wren')

test('starting hero matches the kit', () => {
  const h = STARTING_HERO('Wren')
  assert.equal(h.vigour, 30); assert.equal(h.maxEmber, 6); assert.equal(h.ember, 4)
  assert.deepEqual(h.gear.cloak, { id: 'travel-cloak', tier: 1 })
  assert.deepEqual(h.satchel, [{ id: 'ration', n: 2 }, { id: 'draught', n: 1 }])
})

test('moving spends steps and reveals fog; unaffordable moves are refused', () => {
  let s = newRun(mk(['MMMM', 'MMMM', 'MMMM'], undefined, START as never), 'Wren')
  s = move(s, { row: 1, col: 0 }); assert.equal(s.steps, 4)
  assert.equal(s.fog.get('1,0'), 3)
  s = { ...s, steps: 1 }; assert.deepEqual(canMove(s, { row: 2, col: 0 }), { ok: false, reason: 'steps' })
})

test('move does not mutate its input', () => {
  const s = meadow(3)
  const before = JSON.stringify({ ...s, fog: [...s.fog] })
  move(s, { row: 1, col: 0 })
  assert.equal(JSON.stringify({ ...s, fog: [...s.fog] }), before)
})

test('canMove reports notAdjacent and cliff', () => {
  const s = newRun(mk(['MM', 'AM', 'MM', 'MM'], [[0, 0], [2, 0], [0, 0], [0, 0]], START as never), 'Wren')
  assert.deepEqual(canMove(s, { row: 3, col: 1 }), { ok: false, reason: 'notAdjacent' })
  assert.deepEqual(canMove(s, s.at), { ok: false, reason: 'notAdjacent' })
  assert.deepEqual(canMove(s, { row: 1, col: 0 }), { ok: false, reason: 'cliff' })
})

test('canMove reports impassable, wall and sunk', () => {
  const z = mk(['MMM', 'MMM', 'MMM'], undefined, { '1,1': 'start' })
  const nb = [{ row: 1, col: 0 }, { row: 1, col: 2 }, { row: 0, col: 1 }, { row: 2, col: 1 }, { row: 0, col: 0 }, { row: 2, col: 0 }]
  const s0 = newRun(z, 'Wren')
  const adj = nb.filter((o) => distance(s0.at, o) === 1)
  assert.ok(adj.length >= 3)
  z.cells.get(key(adj[0]))!.terrain = 'river'
  z.cells.get(key(adj[1]))!.wall = true
  const s = newRun(z, 'Wren')
  assert.deepEqual(canMove(s, adj[0]), { ok: false, reason: 'impassable' })
  assert.deepEqual(canMove(s, adj[1]), { ok: false, reason: 'wall' })
  assert.deepEqual(canMove({ ...s, sunkBelow: 5 }, adj[2]), { ok: false, reason: 'sunk' })
  assert.deepEqual(canMove({ ...s, status: 'expired' }, adj[2]), { ok: false, reason: 'over' })
})

test('lighting a beacon: +1 max ember, radius-2 memory, one rumour, once', () => {
  // row 3 is forest, hiding (3,0) and (3,1) from the beacon at (1,0); (0,0) is marked sunk
  const z = mk(['MMMMMM', 'MMMMMM', 'MMMMMM', 'FFFFFF', 'MMMMMM', 'MMMMMM', 'MMMMMM', 'MMMMMM'], undefined,
    { '1,0': 'start', '2,0': 'beacon', '7,5': 'hearth' })
  const s0 = newRun(z, 'Wren')
  assert.equal(s0.fog.get('3,0') ?? 0, 3) // forest row itself is seen
  assert.equal(s0.fog.get('4,0') ?? 0, 0) // behind the forest: unseen
  const sunkCell = '0,0'
  let s = { ...s0, fog: new Map(s0.fog).set(sunkCell, 1 as const) }
  s = move(s, { row: 2, col: 0 })
  assert.deepEqual(s.lit, ['2,0']); assert.equal(s.hero.maxEmber, 7); assert.equal(s.hero.ember, 4)
  assert.equal(s.fog.get(sunkCell), 1) // sunk stays sunk (within 2 of the beacon)
  assert.ok(distance({ row: 2, col: 0 }, { row: 0, col: 0 }) <= 2)
  assert.ok((s.fog.get('4,0') ?? 0) >= 2) // behind the forest, within 2: remembered
  for (const [k, c] of z.cells) if (distance({ row: 2, col: 0 }, c) <= 2 && k !== sunkCell) assert.ok((s.fog.get(k) ?? 0) >= 2, k)
  assert.deepEqual(s.rumours, ['7,5'])
  const back = move(move(s, { row: 1, col: 0 }), { row: 2, col: 0 })
  assert.equal(back.hero.maxEmber, 7); assert.equal(back.rumours.length, 1); assert.equal(back.lit.length, 1)
})

test('mountain cold costs 2 vigour without the fur cloak; marsh leeches 2 without waxed boots', () => {
  const z = mk(['MMM', 'AWM', 'MMM'], [[0, 0, 0], [1, 0, 0], [0, 0, 0]], { '1,0': 'start' })
  const s = newRun(z, 'Wren')
  const w = move({ ...s, steps: 6 }, { row: 1, col: 1 })
  assert.equal(w.hero.vigour, 28); assert.equal(w.events.at(-1)!.kind, 'leeches')
  const furred = { ...s, hero: { ...s.hero, gear: { ...s.hero.gear, boots: { id: 'waxed-boots', tier: 1 as const } } } }
  assert.equal(move(furred, { row: 1, col: 1 }).hero.vigour, 30)
  const mz = mk(['MM', 'AM'], [[0, 0], [2, 0]], { '0,0': 'start' })
  const m = newRun(mz, 'Wren')
  mz.links.add(['0,0', '1,0'].sort().join('|'))
  const cold = move({ ...m, steps: 6 }, { row: 1, col: 0 })
  assert.equal(cold.hero.vigour, 28); assert.equal(cold.events.at(-1)!.kind, 'cold')
  const fur = { ...m, hero: { ...m.hero, gear: { ...m.hero.gear, cloak: { id: 'fur-cloak', tier: 1 as const } } } }
  assert.equal(move({ ...fur, steps: 6 }, { row: 1, col: 0 }).hero.vigour, 30)
})

test('camp: 2 picks, 3 when safe; rest +10 capped; tend +2 capped; forage adds a ration; stars adds a rumour', () => {
  const z = mk(grid(6, 4), undefined, { '0,0': 'start', '1,0': 'camp', '5,3': 'hearth' })
  let s = newRun(z, 'Wren')
  assert.deepEqual(campOptions(s), { safe: false, picks: 2 })
  assert.throws(() => camp(s, ['rest', 'tend', 'forage']))
  assert.throws(() => camp(s, ['rest', 'rest']))
  assert.throws(() => camp(s, []))
  s = { ...s, hero: { ...s.hero, vigour: 15 } }
  let c = camp(s, ['rest', 'tend'])
  assert.equal(c.hero.vigour, 25); assert.equal(c.hero.ember, 6)
  assert.equal(camp({ ...s, hero: { ...s.hero, vigour: 25, ember: 5 } }, ['rest', 'tend']).hero.vigour, 30)
  assert.equal(camp({ ...s, hero: { ...s.hero, vigour: 25, ember: 5 } }, ['rest', 'tend']).hero.ember, 6)
  c = camp(s, ['forage', 'stars'])
  assert.equal(c.hero.satchel.find((i) => i.id === 'ration')!.n, 3)
  assert.deepEqual(c.rumours, ['5,3'])
  assert.equal(camp(c, ['forage']).hero.satchel.find((i) => i.id === 'ration')!.n, 3)
  const safe = move(s, { row: 1, col: 0 })
  assert.deepEqual(campOptions(safe), { safe: true, picks: 3 })
  assert.equal(camp(safe, ['rest', 'tend', 'forage']).hero.satchel.find((i) => i.id === 'ration')!.n, 3)
  assert.deepEqual(camp(safe, ['rest']).lastCamp, { row: 1, col: 0 })
})

test('dawn: steps refill, day +1, rows more than 4 below the furthest row sink', () => {
  const s0 = newRun(mk(grid(12), undefined, START as never), 'Wren')
  const s: RunState = { ...s0, furthestRow: 9, steps: 0 }
  const d = camp(s, ['rest'])
  assert.equal(d.steps, 6); assert.equal(d.day, 2); assert.equal(d.sunkBelow, 5)
  for (const [k, c] of d.zone.cells) if (c.row < 5) assert.equal(d.fog.get(k), 1, k)
  assert.ok(d.events.some((e) => e.kind === 'sunk'))
})

test('hero on a sinking row is moved forward', () => {
  const s0 = newRun(mk(grid(14), undefined, { '3,0': 'start' }), 'Wren')
  const s: RunState = { ...s0, furthestRow: 10 }
  assert.equal(s.at.row, 3)
  const d = camp(s, ['rest'])
  assert.ok(d.at.row === 5 || d.at.row === 6, `row ${d.at.row}`)
  assert.equal(d.at.row, 6)
  assert.ok(d.events.some((e) => e.kind === 'pushed'))
  assert.equal(d.fog.get(key(d.at)), 3)
})

test('path avoids sunk and wall hexes', () => {
  const z = mk(['MMM', 'MMM', 'MMM', 'MMM'], undefined, { '2,1': 'start' })
  z.cells.get('1,1')!.wall = true
  const s = { ...newRun(z, 'Wren'), sunkBelow: 1 }
  const p = path(s, { row: 3, col: 1 })!
  assert.ok(p.path.every((o) => o.row >= 1 && key(o) !== '1,1'))
  assert.equal(path(s, { row: 0, col: 1 }), null)
})

test('no affordable move still allows camp and pressing on', () => {
  const z = mk(['WWW', 'WWW', 'WWW'], undefined, { '1,1': 'start' })
  const s = { ...newRun(z, 'Wren'), steps: 3 }
  const around = [...z.cells.values()].filter((c) => distance(s.at, c) === 1)
  assert.equal(around.length, 6)
  for (const c of around) assert.deepEqual(canMove(s, c), { ok: false, reason: 'steps' })
  assert.doesNotThrow(() => camp(s, ['rest']))
  const p = pressOn(s)
  assert.equal(p.night, true); assert.equal(p.nightSteps, 5); assert.equal(p.steps, 0)
  assert.equal(pressOn(p), p)
  assert.equal(pressOn({ ...s, status: 'expired' }).night, false)
})

test('pressOn is refused while an affordable move exists', () => {
  const s = { ...meadow(4), steps: 2 }
  assert.equal(pressOn(s), s)
})

test('camp does nothing once the run is over', () => {
  const s = { ...meadow(3), status: 'hearth' as const }
  assert.equal(camp(s, ['rest']), s)
})

test('a pushed hero falls back to the push destination, not a sunk hex', () => {
  const z = mk(grid(14), undefined, { '3,0': 'start' })
  z.cells.get('7,0')!.terrain = 'mountain'; z.cells.get('7,0')!.level = 2
  z.links.add(['6,0', '7,0'].sort().join('|'))
  const s0 = newRun(z, 'Wren')
  const d = camp({ ...s0, furthestRow: 10 }, ['rest'])
  assert.deepEqual(d.lastCamp, d.at)
  assert.ok(d.lastCamp.row >= d.sunkBelow)
  const f = move({ ...d, hero: { ...d.hero, vigour: 1 }, steps: 6 }, { row: 7, col: 0 })
  assert.ok(f.events.some((e) => e.kind === 'fell'))
  assert.deepEqual(f.at, d.lastCamp); assert.ok(f.at.row >= d.sunkBelow)
})

test('night steps spend the night pool', () => {
  const s = pressOn({ ...meadow(4), steps: 0 })
  const m = move(s, { row: 1, col: 0 })
  assert.equal(m.nightSteps, 0); assert.equal(m.steps, 0)
})

test('cold to zero vigour falls to last camp', () => {
  const z = mk(['MM', 'AM'], [[0, 0], [2, 0]], { '0,0': 'start' })
  z.links.add(['0,0', '1,0'].sort().join('|'))
  const s0 = newRun(z, 'Wren')
  const s = { ...s0, steps: 6, hero: { ...s0.hero, vigour: 2 } }
  const f = move(s, { row: 1, col: 0 })
  assert.equal(f.status, 'walking'); assert.deepEqual(f.at, s.lastCamp); assert.equal(f.day, 2)
  assert.equal(f.hero.vigour, 15); assert.equal(f.steps, 6)
  assert.ok(f.events.some((e) => e.kind === 'fell'))
})

test('falling past day 10 expires the chapter', () => {
  const z = mk(['MM', 'AM'], [[0, 0], [2, 0]], { '0,0': 'start' })
  z.links.add(['0,0', '1,0'].sort().join('|'))
  const s0 = newRun(z, 'Wren')
  const f = move({ ...s0, day: 10, hero: { ...s0.hero, vigour: 1 } }, { row: 1, col: 0 })
  assert.equal(f.status, 'expired'); assert.deepEqual(f.scars, ['test'])
})

test('reaching the hearth ends the chapter', () => {
  const s = newRun(mk(['MMM', 'MMM'], undefined, { '0,0': 'start', '1,0': 'hearth' }), 'Wren')
  const h = move(s, { row: 1, col: 0 })
  assert.equal(h.status, 'hearth'); assert.equal(h.events.at(-1)!.kind, 'hearth')
  assert.deepEqual(canMove(h, { row: 0, col: 0 }), { ok: false, reason: 'over' })
})

test('the tenth dusk without the hearth expires the chapter and records the scar b1c1', () => {
  const z = mk(grid(3), undefined, START as never)
  z.chapter = 'b1c1'
  const s = { ...newRun(z, 'Wren'), day: 10 }
  const e = camp(s, ['rest'])
  assert.equal(e.status, 'expired'); assert.deepEqual(e.scars, ['b1c1'])
  assert.equal(e.events.at(-1)!.kind, 'expired')
})
