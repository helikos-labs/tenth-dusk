// Chapter generator and fairness checks (§14). Deterministic from the seed: every draw comes from mulberry32 (rng.ts).
import type { Off } from './hex.ts'
import { distance, key, neighbours } from './hex.ts'
import { hashSeed, int, next } from './rng.ts'
import { TERRAIN } from '../data/terrain.ts'
import type { TerrainId } from '../data/terrain.ts'
import type { LandmarkKind, ZCell, Zone } from './zone.ts'
import { cellAt, stepCost } from './zone.ts'

export interface ChapterSkeleton {
  id: string
  name: string
  rows: number
  cols: number
  wallDepth: number
  walls: { west: TerrainId; east: TerrainId; north: TerrainId; south: TerrainId }
  weights: Partial<Record<TerrainId, number>>
  riverRows: [number, number]
  start: Off
  hearth: Off
  beaconRows: number[]
}

/** `tourDays` counts 8 steps a day (6 + the 2 pressing-on night steps, §5.1); `tourDays6` counts 6 (R9). */
export interface Fairness { ok: boolean; reasons: string[]; hearthDays: number; tourDays: number; tourDays6: number }

const STEPS_PER_DAY = 6
const NIGHT_STEPS = 2
const MAX_HEARTH_DAYS = 7
const TOUR_MIN_DAYS = 9.5 // at 6 steps a day: the tour can't be done without pressing on
const TOUR_MAX_DAYS = 10 // at 8 steps a day: it can be done by pressing on every night
const BAND_ROWS = 5
const ATTEMPTS = 6
const TUNE_MOVES = 6

// ---------- Days and paths ----------

/** Days used walking `costs` at `perDay` steps a day: whole days plus the used fraction of the last one. */
export function daysFor(costs: number[], perDay = STEPS_PER_DAY): number {
  let days = 0, left = perDay
  for (const c of costs) {
    if (c > left) { days++; left = perDay }
    left -= c
  }
  return days + (perDay - left) / perDay
}

interface Tree { dist: Map<string, number>; prev: Map<string, Off> }

// Binary min-heap on (cost, row, col), so equal-cost ties always settle in the same order.
type Entry = { d: number; o: Off }
const before = (a: Entry, b: Entry): boolean =>
  a.d !== b.d ? a.d < b.d : a.o.row !== b.o.row ? a.o.row < b.o.row : a.o.col < b.o.col

function heapPush(h: Entry[], e: Entry): void {
  h.push(e)
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1
    if (!before(h[i], h[p])) break
    ;[h[i], h[p]] = [h[p], h[i]]
    i = p
  }
}

function heapPop(h: Entry[]): Entry {
  const top = h[0], last = h.pop()!
  if (h.length) {
    h[0] = last
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1
      let m = i
      if (l < h.length && before(h[l], h[m])) m = l
      if (r < h.length && before(h[r], h[m])) m = r
      if (m === i) break
      ;[h[i], h[m]] = [h[m], h[i]]
      i = m
    }
  }
  return top
}

/** Dijkstra from `from` over every hex it can reach, never entering a key in `avoid`. */
function shortestTree(z: Zone, from: Off, avoid?: Set<string>): Tree {
  const dist = new Map([[key(from), 0]]), prev = new Map<string, Off>(), done = new Set<string>()
  const heap: Entry[] = [{ d: 0, o: from }]
  while (heap.length) {
    const { d, o } = heapPop(heap)
    const k = key(o)
    if (done.has(k)) continue
    done.add(k)
    for (const n of neighbours(o)) {
      const nk = key(n)
      if (done.has(nk) || avoid?.has(nk)) continue
      const c = stepCost(z, o, n)
      if (typeof c !== 'number') continue
      if (d + c < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, d + c); prev.set(nk, o); heapPush(heap, { d: d + c, o: n })
      }
    }
  }
  return { dist, prev }
}

function pathIn(z: Zone, tree: Tree, to: Off): { path: Off[]; costs: number[] } | null {
  if (!tree.dist.has(key(to))) return null
  const path = [to]
  for (let p = tree.prev.get(key(to)); p; p = tree.prev.get(key(p))) path.unshift(p)
  const costs = path.slice(1).map((o, i) => stepCost(z, path[i], o) as number)
  return { path, costs }
}

/** Cheapest walk from `from` to `to`; `costs[i]` is the cost of entering `path[i + 1]`. Null when unreachable. */
export function cheapestPath(z: Zone, from: Off, to: Off, avoid?: Set<string>): { path: Off[]; costs: number[] } | null {
  return pathIn(z, shortestTree(z, from, avoid), to)
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
}

/** Best days at 6 and at 8 steps a day for start → every beacon (any order) → hearth, each leg by its cheapest path. */
function tourDays(z: Zone, start: Off, beacons: Off[], hearth: Off): { at6: number; at8: number } {
  const trees = new Map<string, Tree>()
  const leg = (a: Off, b: Off): number[] | null => {
    if (!trees.has(key(a))) trees.set(key(a), shortestTree(z, a))
    return pathIn(z, trees.get(key(a))!, b)?.costs ?? null
  }
  let at6 = Infinity, at8 = Infinity
  for (const order of permutations(beacons)) {
    const stops = [start, ...order, hearth], costs: number[] = []
    let open = true
    for (let i = 0; open && i < stops.length - 1; i++) {
      const c = leg(stops[i], stops[i + 1])
      if (c) costs.push(...c)
      else open = false
    }
    if (open) {
      at6 = Math.min(at6, daysFor(costs))
      at8 = Math.min(at8, daysFor(costs, STEPS_PER_DAY + NIGHT_STEPS))
    }
  }
  return { at6, at8 }
}

// ---------- Fairness (§14.2, minus locks and gates) ----------

const landmarksOf = (z: Zone, kind: LandmarkKind): ZCell[] => [...z.cells.values()].filter((c) => c.landmark === kind)

/** Each reason starts with one of: 'ends:', 'hearth:', 'tour-long:', 'tour-short:', 'unreachable:', 'camp:', 'cave:'. */
export function checkFairness(z: Zone): Fairness {
  const [start] = landmarksOf(z, 'start'), [hearth] = landmarksOf(z, 'hearth')
  if (!start || !hearth) return { ok: false, reasons: ['ends: no start or no hearth'], hearthDays: Infinity, tourDays: Infinity, tourDays6: Infinity }
  const reasons: string[] = []
  const fromStart = shortestTree(z, start)

  const toHearth = pathIn(z, fromStart, hearth)
  const hearthDays = toHearth ? daysFor(toHearth.costs) : Infinity
  if (hearthDays > MAX_HEARTH_DAYS) reasons.push(`hearth: takes ${hearthDays.toFixed(2)} days (max ${MAX_HEARTH_DAYS})`)

  const tour = tourDays(z, start, landmarksOf(z, 'beacon'), hearth)
  if (tour.at8 > TOUR_MAX_DAYS) reasons.push(`tour-long: takes ${tour.at8.toFixed(2)} days at 8 steps a day (max ${TOUR_MAX_DAYS})`)
  if (tour.at6 < TOUR_MIN_DAYS) reasons.push(`tour-short: takes ${tour.at6.toFixed(2)} days at 6 steps a day (min ${TOUR_MIN_DAYS})`)

  for (const c of z.cells.values()) {
    if (c.landmark && !fromStart.dist.has(key(c))) reasons.push(`unreachable: ${c.landmark} at ${key(c)}`)
  }
  for (let band = 0; band < z.rows; band += BAND_ROWS) {
    if (!landmarksOf(z, 'camp').some((c) => c.row >= band && c.row < band + BAND_ROWS)) reasons.push(`camp: none in rows ${band}–${Math.min(band + BAND_ROWS, z.rows) - 1}`)
  }
  if (!landmarksOf(z, 'cave').length) reasons.push('cave: none')

  return { ok: reasons.length === 0, reasons, hearthDays, tourDays: tour.at8, tourDays6: tour.at6 }
}

// ---------- Generation (§14.1) ----------

type Rng = { s: number }
const rand = (r: Rng): number => { const [v, s] = next(r.s); r.s = s; return v }
const randInt = (r: Rng, n: number): number => { const [v, s] = int(r.s, n); r.s = s; return v }
const pick = <T>(r: Rng, xs: T[]): T | undefined => (xs.length ? xs[randInt(r, xs.length)] : undefined)

const inPlay = (z: Zone, o: Off): boolean => o.row >= 0 && o.row < z.rows && o.col >= 0 && o.col < z.cols
const playCells = (z: Zone): ZCell[] => [...z.cells.values()].filter((c) => !c.wall)
const levelOf = (n: number): ZCell['level'] => n as ZCell['level']
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function setTerrain(c: ZCell, t: TerrainId, level = TERRAIN[t].levels[0]): void {
  c.terrain = t
  c.level = levelOf(level)
}

/** Step 1: every hex, with the ring outside play filled from the skeleton's walls (corners take west/east). */
function wallRing(skel: ChapterSkeleton, seed: string): Zone {
  const { rows, cols, wallDepth: d, walls } = skel
  const cells = new Map<string, ZCell>()
  for (let row = -d; row < rows + d; row++) {
    for (let col = -d; col < cols + d; col++) {
      const wall = col < 0 ? walls.west : col >= cols ? walls.east : row < 0 ? walls.south : row >= rows ? walls.north : null
      const terrain = wall ?? 'meadow'
      cells.set(key({ row, col }), { row, col, terrain, level: levelOf(TERRAIN[terrain].levels[0]), wall: wall !== null })
    }
  }
  return { seed, chapter: skel.id, rows, cols, wallDepth: d, cells, links: new Set() }
}

/** Two octaves of smoothed value noise over the play area, keyed by cell key. */
function valueNoise(z: Zone, rng: Rng): Map<string, number> {
  const octaves = [{ size: 4, amp: 1 }, { size: 2, amp: 0.5 }].map(({ size, amp }) => {
    const h = Math.floor(z.rows / size) + 2, w = Math.floor(z.cols / size) + 2
    const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => rand(rng)))
    return { size, amp, grid }
  })
  const ease = (t: number): number => t * t * (3 - 2 * t)
  const out = new Map<string, number>()
  for (const c of playCells(z)) {
    const x = c.col + (c.row & 1) / 2, y = c.row
    let v = 0
    for (const { size, amp, grid } of octaves) {
      const gx = x / size, gy = y / size, x0 = Math.floor(gx), y0 = Math.floor(gy)
      const fx = ease(gx - x0), fy = ease(gy - y0)
      const top = grid[y0][x0] + (grid[y0][x0 + 1] - grid[y0][x0]) * fx
      const bot = grid[y0 + 1][x0] + (grid[y0 + 1][x0 + 1] - grid[y0 + 1][x0]) * fx
      v += amp * (top + (bot - top) * fy)
    }
    out.set(key(c), v)
  }
  return out
}

/** Play cells ordered by `field` value, ties by row then col. */
const ranked = (z: Zone, field: Map<string, number>): ZCell[] =>
  playCells(z).sort((a, b) => field.get(key(a))! - field.get(key(b))! || a.row - b.row || a.col - b.col)

// Low noise to high: wet ground, open ground, wood, high ground.
const RANK: TerrainId[] = ['sea', 'lake', 'river', 'marsh', 'meadow', 'oldwood', 'forest', 'heath', 'hills', 'mountain', 'peaks']

/** Step 2: rank the cells by noise and hand out terrain in RANK order by the skeleton's weights. */
function fillTerrain(z: Zone, skel: ChapterSkeleton, rng: Rng): void {
  const cells = ranked(z, valueNoise(z, rng))
  const order = (Object.keys(skel.weights) as TerrainId[]).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))
  const total = order.reduce((s, t) => s + skel.weights[t]!, 0)
  let acc = 0, i = 0
  for (const t of order) {
    acc += skel.weights[t]!
    for (const end = Math.round((acc / total) * cells.length); i < end; i++) setTerrain(cells[i], t)
  }
}

/** Step 3: levels from a smoothed height field, clamped to each terrain's range. */
function setLevels(z: Zone, rng: Rng): void {
  const raw = valueNoise(z, rng), height = new Map<string, number>()
  for (const c of playCells(z)) {
    const around = neighbours(c).filter((o) => inPlay(z, o)).map((o) => raw.get(key(o))!)
    height.set(key(c), [raw.get(key(c))!, ...around].reduce((s, v) => s + v, 0) / (around.length + 1))
  }
  const cells = ranked(z, height)
  cells.forEach((c, i) => {
    const [lo, hi] = TERRAIN[c.terrain].levels
    c.level = levelOf(clamp(Math.floor((i / cells.length) * 4), lo, hi))
  })
}

/** Step 3b: one cluster of three mutually adjacent mountain hexes in rows 3–13. */
function addMountainCluster(z: Zone, rng: Rng): Off[] {
  const centre = { row: 4 + randInt(rng, 9), col: 1 + randInt(rng, z.cols - 2) }
  const d = randInt(rng, 6), ns = neighbours(centre)
  const trio = [centre, ns[d], ns[(d + 1) % 6]]
  for (const o of trio) setTerrain(cellAt(z, o)!, 'mountain')
  return trio
}

interface River { row: number; ford: Off; bridge?: Off }

/** Step 4: a river across one row in `riverRows` (avoiding the mountain cluster), with a ford and sometimes a bridge. */
function layRiver(z: Zone, skel: ChapterSkeleton, cluster: Off[], rng: Rng): River {
  const rows: number[] = []
  for (let r = skel.riverRows[0]; r <= skel.riverRows[1]; r++) rows.push(r)
  const clear = rows.filter((r) => !cluster.some((o) => o.row === r))
  const row = pick(rng, clear.length ? clear : rows)!
  for (let col = 0; col < z.cols; col++) setTerrain(cellAt(z, { row, col })!, 'river')
  // A crossing needs a bank it can be stepped onto from on both sides: open ground no more than 1 level up.
  const bank = (o: Off): boolean => {
    const c = cellAt(z, o)
    return !!c && !c.wall && TERRAIN[c.terrain].steps !== null && c.level <= 1
  }
  const cols = Array.from({ length: z.cols }, (_, col) => col).filter((col) => {
    const ns = neighbours({ row, col })
    return ns.some((o) => o.row === row - 1 && bank(o)) && ns.some((o) => o.row === row + 1 && bank(o))
  })
  const ford = { row, col: pick(rng, cols.length ? cols : [randInt(rng, z.cols)])! }
  cellAt(z, ford)!.crossing = 'ford'
  if (randInt(rng, 2) === 0) return { row, ford }
  const mid = Math.round((skel.start.col + skel.hearth.col) / 2)
  const spots = cols.filter((col) => col !== ford.col && Math.abs(col - mid) <= 2)
  if (!spots.length) return { row, ford }
  const bridge = { row, col: pick(rng, spots)! }
  cellAt(z, bridge)!.crossing = 'bridge'
  return { row, ford, bridge }
}

/** Step 5: a road from start to hearth by the cheapest path over the river's bridge (or its ford), then 25–40% cut away in gaps. */
function layRoad(z: Zone, skel: ChapterSkeleton, river: River, rng: Rng): boolean {
  for (const end of [skel.start, skel.hearth]) {
    const c = cellAt(z, end)!
    if (TERRAIN[c.terrain].steps === null) setTerrain(c, 'meadow')
  }
  const via = river.bridge ?? river.ford
  const avoid = new Set(river.bridge ? [key(river.ford)] : [])
  const a = cheapestPath(z, skel.start, via, avoid), b = cheapestPath(z, via, skel.hearth, avoid)
  if (!a || !b) return false
  const path = [...a.path, ...b.path.slice(1)]
  // A ford stays a 2-step ford (M1); the road runs up to it and on from it.
  for (const o of path) if (cellAt(z, o)!.crossing !== 'ford') cellAt(z, o)!.road = true
  return cutGaps(z, path, rng)
}

/** Remove 25–40% of the road in separate runs of 2 or 3, never the crossing or either end. */
function cutGaps(z: Zone, path: Off[], rng: Rng): boolean {
  const n = path.length, lo = Math.ceil(n * 0.25), hi = Math.floor(n * 0.4)
  const target = lo + randInt(rng, hi - lo + 1)
  const kept = path.map(() => true)
  const removable = (i: number): boolean => i > 0 && i < n - 1 && kept[i] && !cellAt(z, path[i])!.crossing
  let removed = 0
  for (let tries = 0; removed < target && tries < 100; tries++) {
    const len = removed + 3 <= hi && randInt(rng, 2) === 1 ? 3 : 2
    if (removed + len > hi) break
    const at = 1 + randInt(rng, n - 2)
    const run = Array.from({ length: len }, (_, j) => at + j)
    if (!run.every(removable) || !kept[at - 1] || !kept[at + len]) continue
    for (const i of run) { kept[i] = false; delete cellAt(z, path[i])!.road }
    removed += len
  }
  return removed >= lo
}

/** Step 6: start, hearth, beacons on alternating flanks, a camp per band, a hamlet, ruins and a cave mouth. */
function placeLandmarks(z: Zone, skel: ChapterSkeleton, rng: Rng): boolean {
  const reach = shortestTree(z, skel.start).dist
  const free = (o: Off): boolean => {
    const c = cellAt(z, o)
    return !!c && !c.wall && !c.landmark && !c.crossing && reach.has(key(o))
  }
  const place = (o: Off | undefined, kind: LandmarkKind): boolean => {
    if (!o) return false
    cellAt(z, o)!.landmark = kind
    return true
  }
  const somewhere = (test: (c: ZCell) => boolean): ZCell | undefined => pick(rng, playCells(z).filter((c) => free(c) && test(c)))

  place(skel.start, 'start')
  place(skel.hearth, 'hearth')
  let ok = true
  skel.beaconRows.forEach((row, i) => {
    const col = i % 2 === 0 ? 0 : z.cols - 1
    const first = randInt(rng, 3) - 1
    const spot = [first, ...[-1, 0, 1].filter((d) => d !== first)].map((d) => ({ row: row + d, col })).find(free)
    ok = place(spot, 'beacon') && ok
  })
  for (let band = 0; band < z.rows; band += BAND_ROWS) {
    ok = place(somewhere((c) => c.row >= band && c.row < band + BAND_ROWS), 'camp') && ok
  }
  ok = place(somewhere((c) => c.row >= 4 && c.row <= 12), 'hamlet') && ok
  ok = place(somewhere((c) => c.row >= 4 && c.row <= 12), 'ruins') && ok
  ok = place(somewhere((c) => c.terrain === 'hills' || c.terrain === 'mountain'), 'cave') && ok
  return ok
}

/**
 * Step 7: move a beacon one row towards the road when the tour is too long at 8 steps a day, or away from it when it is
 * too short at 6 a day. The beacon nearest the road that can move that way goes first; beacons stay within ±1 of their row.
 */
function tuneBeacons(z: Zone, skel: ChapterSkeleton): void {
  const road = playCells(z).filter((c) => c.road)
  const roadDistance = (o: Off): number => Math.min(...road.map((r) => distance(o, r)))
  const home = (b: ZCell): number => skel.beaconRows.find((r) => Math.abs(b.row - r) <= 1)!
  const reach = shortestTree(z, skel.start).dist
  for (let move = 0; move < TUNE_MOVES; move++) {
    const f = checkFairness(z)
    const away = f.tourDays6 < TOUR_MIN_DAYS
    if (!away && f.tourDays <= TOUR_MAX_DAYS) return
    const better = (from: ZCell, to: ZCell): boolean => (away ? roadDistance(to) > roadDistance(from) : roadDistance(to) < roadDistance(from))
    const moves = landmarksOf(z, 'beacon')
      .sort((a, b) => roadDistance(a) - roadDistance(b))
      .flatMap((b) => [-1, 1]
        .map((d) => cellAt(z, { row: b.row + d, col: b.col }))
        .filter((c): c is ZCell => !!c && Math.abs(c.row - home(b)) <= 1 && !c.landmark && !c.crossing &&
          reach.has(key(c)) && better(b, c))
        .map((to) => ({ from: b, to })))
    if (!moves.length) return
    delete moves[0].from.landmark
    moves[0].to.landmark = 'beacon'
  }
}

function buildAttempt(skel: ChapterSkeleton, seed: string, attemptSeed: string): Zone | null {
  const rng: Rng = { s: hashSeed(attemptSeed) }
  const z = wallRing(skel, seed)
  fillTerrain(z, skel, rng)
  setLevels(z, rng)
  const cluster = addMountainCluster(z, rng)
  const river = layRiver(z, skel, cluster, rng)
  if (!layRoad(z, skel, river, rng)) return null
  if (!placeLandmarks(z, skel, rng)) return null
  tuneBeacons(z, skel)
  return z
}

/** A fair zone for `seed`; rerolls with `seed·1`, `seed·2`… inside, so the same seed always gives the same zone. */
export function generateZone(skel: ChapterSkeleton, seed: string): Zone {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const z = buildAttempt(skel, seed, attempt === 0 ? seed : `${seed}·${attempt}`)
    if (z && checkFairness(z).ok) return z
  }
  throw new Error(`no fair zone for seed ${seed} in ${ATTEMPTS} attempts`)
}
