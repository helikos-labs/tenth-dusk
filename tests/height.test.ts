// Height levels (DESIGN.md §6, §15.3): every hex stands on the terrace of its level, a jump of 2 or more levels is a
// sheer face, peaks stand far above the mountains, and the new provinces (old wood, marsh, heath) plant as they should.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerrainId } from '../src/data/terrain.ts'
import { zoneToWorld, type WorldCell } from '../src/world/adapter.ts'
import { CLIFF, EDGE_DIR, LEVEL_HEIGHT, WATER_LEVEL, buildField, hexCenter, type Field, type Pt } from '../src/world/field.ts'
import { plantsFor, type PlantKind } from '../src/world/vegetation.ts'
import { neighbours, toAxial } from '../src/rules/hex.ts'
import { mk } from './helpers.ts'

type Board = Record<string, WorldCell>

/** The board for `rows` (helpers.ts letters), with `terrain` and `level` overrides keyed "row,col". */
function boardOf(rows: string[], over: Record<string, { terrain?: TerrainId; level?: number }> = {}): Board {
  const z = mk(rows)
  for (const [k, o] of Object.entries(over)) {
    const c = z.cells.get(k)!
    if (o.terrain) c.terrain = o.terrain
    if (o.level !== undefined) c.level = o.level as typeof c.level
  }
  return zoneToWorld(z)
}

/** The world cell at offset row, col. */
const at = (board: Board, row: number, col: number): WorldCell => {
  const { q, r } = toAxial({ row, col })
  return board[`${q},${r}`]
}

const centreHeight = (f: Field, c: WorldCell) => {
  const p = hexCenter(c.q, c.r)
  return f.probe(p.x, p.z).height
}

/** True if hex q,r has all six neighbours on the board. */
const inland = (board: Board, c: WorldCell) => EDGE_DIR.every((d) => !!board[`${c.q + d.q},${c.r + d.r}`])

/** Pairs (a, b) of neighbouring inland hexes where `a` passes `lo` and `b` passes `hi`. */
function pairs(board: Board, lo: (c: WorldCell) => boolean, hi: (c: WorldCell) => boolean): [WorldCell, WorldCell][] {
  const out: [WorldCell, WorldCell][] = []
  for (const a of Object.values(board)) {
    if (!lo(a) || !inland(board, a)) continue
    for (const d of EDGE_DIR) {
      const b = board[`${a.q + d.q},${a.r + d.r}`]
      if (b && hi(b) && inland(board, b)) out.push([a, b])
    }
  }
  return out
}

/**
 * Along the segment from a's centre to b's, the point (as a distance from a's centre) where the drawn border lies: the
 * first place the province under the point turns from a to another, found by bisection.
 */
function borderAlong(f: Field, a: Pt, b: Pt, ca: WorldCell): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const at = (t: number) => ({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len })
  let lo = 0
  let hi = 0
  for (let t = 0; t <= len; t += 0.005) {
    const p = at(t)
    if (f.provinceAt(p.x, p.z) !== ca) {
      hi = t
      break
    }
    lo = t
  }
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    const p = at(m)
    if (f.provinceAt(p.x, p.z) === ca) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/** The height gained from `t - w` to `t + w` along the segment from a to b (t and w measured along it). */
function gainAround(f: Field, a: Pt, b: Pt, t: number, w: number): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const h = (s: number) => f.height(a.x + ((b.x - a.x) * s) / len, a.z + ((b.z - a.z) * s) / len)
  return h(t + w) - h(t - w)
}

/** The largest jump in height along chords across the board, each jump bisected down to a hair's width. */
function worstJump(f: Field, board: Board): number {
  const cs = Object.values(board).map((c) => hexCenter(c.q, c.r))
  const mid = { x: cs.reduce((s, c) => s + c.x, 0) / cs.length, z: cs.reduce((s, c) => s + c.z, 0) / cs.length }
  const end = Math.max(...cs.map((c) => Math.hypot(c.x - mid.x, c.z - mid.z))) + 1
  let worst = 0
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI
    const off = ((k % 4) - 1.5) * 1.3
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const at = (t: number) => f.height(mid.x - dz * off + dx * t, mid.z + dx * off + dz * t)
    let prev = at(-end)
    for (let t = 0.01 - end; t <= end; t += 0.01) {
      const h = at(t)
      if (Math.abs(h - prev) > 0.06) {
        let lo = t - 0.01
        let hi = t
        let hl = prev
        let hh = h
        for (let i = 0; i < 34 && Math.abs(hh - hl) > 1e-3; i++) {
          const m = (lo + hi) / 2
          const hm = at(m)
          if (Math.abs(hm - hl) > Math.abs(hh - hm)) {
            hi = m
            hh = hm
          } else {
            lo = m
            hl = hm
          }
        }
        worst = Math.max(worst, Math.abs(hh - hl))
      }
      prev = h
    }
  }
  return worst
}

test('cell centres stand at their level (hills above meadow, mountain above hills)', () => {
  // Three rows of M H A at their default levels 0 1 2: along each row the centres climb by at least 0.25 a step.
  const board = boardOf(['MHA', 'MHA', 'MHA'])
  const f = buildField(board)
  for (let row = 0; row < 3; row++) {
    const cells = [0, 1, 2].map((col) => at(board, row, col))
    assert.deepEqual(
      cells.map((c) => c.level),
      [0, 1, 2],
    )
    const h = cells.map((c) => centreHeight(f, c))
    assert.ok(h[1] - h[0] >= 0.25 && h[2] - h[1] >= 0.25, `row ${row}: centres at ${h.map((v) => v.toFixed(2)).join(', ')}`)
  }
})

test('peaks stand at least 2.5× the tallest mountain', () => {
  // Three rows of peaks over two of mountain, hills and meadow (the zone's wall over its high ground). How high each
  // centre stands is measured from the terrace of its level (LEVEL_HEIGHT; 0 under peaks, which reach their height
  // through the mountain profile alone): the peaks' tallest centre against the mountains' tallest.
  const rows = ['MMMMMMMM', 'MMMMMMMM', 'HHHHHHHH', 'AAAAAAAA', 'AAAAAAAA', 'PPPPPPPP', 'PPPPPPPP', 'PPPPPPPP']
  const board = boardOf(rows)
  const f = buildField(board)
  const tallest = (level: number) =>
    Math.max(
      ...Object.values(board)
        .filter((c) => c.level === level)
        .map((c) => {
          const p = hexCenter(c.q, c.r)
          const pr = f.probe(p.x, p.z)
          return pr.height - pr.terrace
        }),
    )
  const peaks = tallest(3)
  const mountain = tallest(2)
  assert.ok(peaks >= 2.5 * mountain, `peaks stand ${peaks.toFixed(2)}, mountains ${mountain.toFixed(2)}`)
})

test('a 2-level jump is a sheer face: ≥ 80% of the rise happens within CLIFF.width of the drawn border', () => {
  // Meadow at level 0 beside meadow at level 2: nothing but the terrace differs, so the whole rise from one centre to
  // the other is the step. Along each centre-to-centre line, the gain within CLIFF.width either side of where the drawn
  // border (the province under the point) changes.
  const rows = ['MMMMMMMM', 'MMMMMMMM', 'MMMMMMMM', 'MMMMMMMM', 'MMMMMMMM', 'MMMMMMMM']
  const over: Record<string, { level: number }> = {}
  rows.forEach((line, row) => [...line].forEach((_, col) => col >= 4 && (over[`${row},${col}`] = { level: 2 })))
  const board = boardOf(rows, over)
  const f = buildField(board)
  const ps = pairs(board, (c) => c.level === 0, (c) => c.level === 2)
  assert.ok(ps.length >= 5, `only ${ps.length} pairs`)
  for (const [a, b] of ps) {
    const pa = hexCenter(a.q, a.r)
    const pb = hexCenter(b.q, b.r)
    const rise = f.height(pb.x, pb.z) - f.height(pa.x, pa.z)
    const t = borderAlong(f, pa, pb, a)
    const face = gainAround(f, pa, pb, t, CLIFF.width)
    assert.ok(rise > 0.6, `${a.q},${a.r} → ${b.q},${b.r}: rises only ${rise.toFixed(2)}`)
    assert.ok(face >= 0.8 * rise, `${a.q},${a.r} → ${b.q},${b.r}: ${face.toFixed(2)} of ${rise.toFixed(2)} at the border`)
  }
  // Meadow beside mountain (level 2): the range rises on from the top of its face, but the face itself carries at least
  // 80% of the step between the two terraces.
  const mtn = boardOf(['MMMMAAAA', 'MMMMAAAA', 'MMMMAAAA', 'MMMMAAAA', 'MMMMAAAA', 'MMMMAAAA'])
  const g = buildField(mtn)
  const step = LEVEL_HEIGHT[2] - LEVEL_HEIGHT[0]
  const mp = pairs(mtn, (c) => c.level === 0, (c) => c.level === 2)
  assert.ok(mp.length >= 5)
  for (const [a, b] of mp) {
    const pa = hexCenter(a.q, a.r)
    const pb = hexCenter(b.q, b.r)
    const face = gainAround(g, pa, pb, borderAlong(g, pa, pb, a), CLIFF.width)
    assert.ok(face >= 0.8 * step, `${a.q},${a.r} → ${b.q},${b.r}: the face rises ${face.toFixed(2)} of ${step}`)
  }
})

test('heights stay continuous across borders with a 0- or 1-level difference (ported continuity check)', () => {
  // world.test.ts's chord check on a zone of levels 0 and 1 only: meadow, hills, forest, marsh, a river, and heath at
  // levels 0 and 1. Every jump along the chords bisects down to under 1e-3.
  const rows = ['MMHHMMFFMM', 'MHHHMFFFMM', 'MMHMMWWMHH', 'FFMMMWWMHH', 'FFFMRRRMMM', 'MMMMMMMHHM', 'MWWMMMHHHM', 'MWWMFFMMMM']
  const board = boardOf(rows, {
    '0,0': { terrain: 'heath', level: 1 },
    '0,1': { terrain: 'heath', level: 1 },
    '5,2': { terrain: 'heath' },
    '7,9': { terrain: 'oldwood' },
  })
  const levels = new Set(Object.values(board).map((c) => c.level))
  assert.deepEqual([...levels].sort(), [0, 1])
  const worst = worstJump(buildField(board), board)
  assert.ok(worst < 1e-3, `the height jumps by ${worst.toFixed(4)} somewhere`)
})

test('old wood places ≥ 1.5× the trees of forest; marsh places reeds and pools; heath places no trees', () => {
  // One province of each kind (a hex and two rings round it, apart in a meadow): forest, old wood, marsh, heath.
  // Plants are counted by the province under each instance. Old wood and forest are counted again with their places
  // swapped, so the two are compared on the same ground: two places differ by ±10% in trees as forest, which would
  // swamp the margin between the 1.6× density and the 1.5× asked (a single hex grows only about 20 trees).
  const woods = (first: TerrainId, second: TerrainId) => {
    const z = mk(Array.from({ length: 9 }, () => 'M'.repeat(29)))
    ;([first, second, 'marsh', 'heath'] as const).forEach((t, i) => {
      const o = { row: 4, col: 3 + i * 7 }
      for (const n of [o, ...neighbours(o), ...neighbours(o).flatMap(neighbours)]) z.cells.get(`${n.row},${n.col}`)!.terrain = t
    })
    return zoneToWorld(z)
  }
  const count = (board: Board) => {
    const f = buildField(board)
    const sets = plantsFor(f, board)
    const n: Record<string, Partial<Record<PlantKind, number>>> = {}
    for (const [kind, set] of Object.entries(sets) as [PlantKind, (typeof sets)[PlantKind]][])
      for (let i = 0; i < set.count; i++) {
        const c = f.provinceAt(set.matrix[i * 16 + 12], set.matrix[i * 16 + 14])
        const name = !c ? 'off' : c.dense ? 'oldwood' : c.heath ? 'heath' : c.terrain === 'blight' ? 'marsh' : c.terrain
        n[name] ??= {}
        n[name][kind] = (n[name][kind] ?? 0) + 1
      }
    return { f, n }
  }
  const trees = (n: Partial<Record<PlantKind, number>> = {}) => (n.conifer ?? 0) + (n.oak ?? 0)
  const a = count(woods('forest', 'oldwood'))
  const b = count(woods('oldwood', 'forest'))
  const forest = trees(a.n.forest) + trees(b.n.forest)
  const old = trees(a.n.oldwood) + trees(b.n.oldwood)
  assert.ok(forest > 500, `only ${forest} forest trees`)
  assert.ok(old >= 1.5 * forest, `old wood ${old} trees, forest ${forest}`)
  // Marsh: reeds, and pools where its ground sinks below the water.
  assert.ok((a.n.marsh?.reed ?? 0) > 100, `marsh reeds: ${a.n.marsh?.reed ?? 0}`)
  const marsh = Object.values(a.f.board).filter((c) => c.terrain === 'blight')
  let pool = 0
  let ground = 0
  for (const c of marsh) {
    const m = hexCenter(c.q, c.r)
    for (let dx = -1; dx <= 1; dx += 0.05)
      for (let dz = -1; dz <= 1; dz += 0.05) {
        if (a.f.provinceAt(m.x + dx, m.z + dz) !== c) continue
        ground++
        if (a.f.height(m.x + dx, m.z + dz) < WATER_LEVEL) pool++
      }
  }
  assert.ok(pool > 0.03 * ground, `pools cover ${pool} of ${ground} marsh points`)
  // Heath: tufts, flowers and stones, and no tree.
  const heath = a.n.heath ?? {}
  assert.equal(trees(heath), 0, `heath has ${trees(heath)} trees`)
  assert.ok((heath.tuft ?? 0) > 0 && (heath.flower ?? 0) > 0 && (heath.rock ?? 0) > 0, JSON.stringify(heath))
})
