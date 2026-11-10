// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/roads.ts, adapted for Tenth Dusk.
// Roads on the 3D board: packed-earth ribbons draped over the ground between the hexes of the road network (roads and
// Bridges), and plank decks over Water.
//
// ORGANIC CONCEPT: a road never runs straight from hex centre to hex centre, which would draw the grid. Between linked
// hexes A and B it leaves A's centre, crosses the drawn border near where the straight line A–B meets it (slid along the
// border and turned there by a seeded amount, so no two crossings look alike) and bends into B's centre; through a hex
// with two links it flows past the centre without a kink. Every sample is checked against the provinces: a bend that
// strays out of A ∪ B is straightened, and the straight line itself can't stray (the warp moves a point at most 0.46,
// short of any third hex).
import * as THREE from 'three'
import type { Hex, WorldCell } from './adapter.ts'
import { EDGE_DIR, WATER_LEVEL, hash01, hexCenter, type Field, type Pt } from './field.ts'
import { SURE, inProvince } from './layout.ts'
import { castShadows } from './materials.ts'

const onNetwork = (c: WorldCell | undefined) => !!c && !!c.road

/** Road knobs (world units; a hex has circumradius 1). */
export const ROAD = {
  /** Sample spacing along a road (the ground mesh's own spacing is 0.085). */
  step: 0.1,
  /** How far a crossing slides along the border, and how far the road turns there (radians), at most. */
  shift: 0.16,
  turn: 0.4,
  /** How far a road turning sharply through a hex leans into the turn (0 meets in a corner, 1 loops out). */
  sharp: 0.5,
  /** A dead end tapers off over this length. */
  taper: 0.14,
  /** Half widths of a dirt road and of a plank deck, and how far a road floats over the ground. */
  dirt: 0.045,
  planks: 0.06,
  lift: 0.012,
  /** A Bridge's deck height. */
  deck: WATER_LEVEL + 0.05,
  /** A lone road hex's track: half its length, and how far it bows. */
  lone: 0.45,
  bow: 0.12,
}

/**
 * A stretch of road: its centreline, whether it is a plank deck, the hexes whose provinces hold it (one or two), and
 * whether it tapers off at its start and at its end (a dead end).
 */
export interface RoadStrip {
  pts: Pt[]
  planks: boolean
  hexes: string[]
  taper: [boolean, boolean]
}

export interface RoadPlan {
  strips: RoadStrip[]
}

const unit = (x: number, z: number): Pt => {
  const l = Math.hypot(x, z) || 1
  return { x: x / l, z: z / l }
}
const lerpPt = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k })

/** True if point p lies in the province of one of `hexes` (at once when it is close to one of their centres). */
function inAny(field: Field, hexes: Hex[], p: Pt): boolean {
  for (const h of hexes) {
    const c = hexCenter(h.q, h.r)
    if (Math.hypot(p.x - c.x, p.z - c.z) < SURE) return true
  }
  return hexes.some((h) => inProvince(field, h, p.x, p.z))
}

/**
 * Where the straight line from hex a's centre to its neighbour b's centre crosses the drawn border between their
 * provinces: the first point out from a that is not a's, found by stepping and then bisection. Points within 0.4 of a
 * centre lie in its own province whatever the warp does, so the border lies in the middle part of the line.
 */
export function crossing(field: Field, a: Hex, b: Hex): Pt {
  const A = hexCenter(a.q, a.r)
  const B = hexCenter(b.q, b.r)
  const inA = (t: number) => inProvince(field, a, A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t)
  let lo = 0.22
  let hi = 0.78
  for (let t = 0.26; t < 0.77; t += 0.04) {
    if (!inA(t)) {
      hi = t
      break
    }
    lo = t
  }
  for (let i = 0; i < 8; i++) {
    const m = (lo + hi) / 2
    if (inA(m)) lo = m
    else hi = m
  }
  return lerpPt(A, B, (lo + hi) / 2)
}

/**
 * Points of the cubic curve from p0 to p3 that leaves along unit vector t0 and arrives along t3 (handles a third of the
 * chord long), about ROAD.step apart, appended to `out`; the first point is left out when `out` already ends there.
 */
function curve(p0: Pt, t0: Pt, p3: Pt, t3: Pt, out: Pt[]) {
  const h = Math.hypot(p3.x - p0.x, p3.z - p0.z) / 3
  const p1 = { x: p0.x + t0.x * h, z: p0.z + t0.z * h }
  const p2 = { x: p3.x - t3.x * h, z: p3.z - t3.z * h }
  const n = Math.max(3, Math.ceil((3 * h) / ROAD.step))
  for (let i = out.length ? 1 : 0; i <= n; i++) {
    const s = i / n
    const u = 1 - s
    const a = u * u * u
    const b = 3 * u * u * s
    const c = 3 * u * s * s
    const d = s * s * s
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z })
  }
}

/** One link of the network, between neighbours a and b (in a fixed order), with its crossing. */
interface Link {
  a: WorldCell
  b: WorldCell
  /** Where the straight line meets the border, the crossing the road takes, and the road's heading there (a → b). */
  line: Pt
  at: Pt
  dir: Pt
}

/**
 * The road network on `board` laid out on `field`'s organic map: the centreline of every stretch of road. Only the
 * provinces are read here (no heights), so this is cheap; `buildRoads` drapes it.
 */
export function roadPlan(field: Field, board: Record<string, WorldCell>): RoadPlan {
  const strips: RoadStrip[] = []
  const k = (h: Hex) => `${h.q},${h.r}`
  const linked = new Map<string, WorldCell[]>()
  for (const c of Object.values(board)) {
    if (!onNetwork(c)) continue
    linked.set(
      k(c),
      EDGE_DIR.map((d) => board[`${c.q + d.q},${c.r + d.r}`]).filter((n): n is WorldCell => onNetwork(n)),
    )
  }

  // Every link once, with its crossing slid along the border and turned by seeded amounts (kept if it is still in a or b).
  const links = new Map<string, Link>()
  for (const [key, list] of linked) {
    const a = board[key]
    for (const b of list) {
      if (a.q > b.q || (a.q === b.q && a.r > b.r)) continue
      const A = hexCenter(a.q, a.r)
      const B = hexCenter(b.q, b.r)
      const line = crossing(field, a, b)
      const u = unit(B.x - A.x, B.z - A.z)
      const seedQ = a.q * 37 + b.q * 11
      const seedR = a.r * 37 + b.r * 11
      const shift = (hash01(seedQ, seedR, 401) * 2 - 1) * ROAD.shift
      const turn = (hash01(seedQ, seedR, 402) * 2 - 1) * ROAD.turn
      let at = line
      for (const s of [shift, shift / 2]) {
        const p = { x: line.x - u.z * s, z: line.z + u.x * s }
        if (inAny(field, [a, b], p)) {
          at = p
          break
        }
      }
      const dir = { x: u.x * Math.cos(turn) - u.z * Math.sin(turn), z: u.x * Math.sin(turn) + u.z * Math.cos(turn) }
      links.set(`${key}|${k(b)}`, { a, b, line, at, dir })
    }
  }
  const linkOf = (p: WorldCell, q: WorldCell) => links.get(`${k(p)}|${k(q)}`) ?? links.get(`${k(q)}|${k(p)}`)!

  /**
   * The way a road leaves hex p's centre toward q. Through a hex with two links it flows from one crossing to the other
   * without a kink; a sharp turn (links 60° apart) only leans part way into the flow, since flowing right through would
   * loop out. A dead end and a junction head straight for their crossings.
   */
  const heading = (p: WorldCell, q: WorldCell): Pt => {
    const c = hexCenter(p.q, p.r)
    const to = linkOf(p, q).at
    const radial = unit(to.x - c.x, to.z - c.z)
    const list = linked.get(k(p)) ?? []
    if (list.length !== 2) return radial
    const from = linkOf(p, list[0] === q ? list[1] : list[0]).at
    const back = unit(from.x - c.x, from.z - c.z)
    const flow = unit(to.x - from.x, to.z - from.z)
    const lean = radial.x * back.x + radial.z * back.z < 0 ? 1 : ROAD.sharp
    return unit(radial.x + (flow.x - radial.x) * lean, radial.z + (flow.z - radial.z) * lean)
  }
  /**
   * A road ending in the open (a road hex with one link and no Landmark to end at): its ribbon tapers off instead of
   * stopping square.
   */
  const deadEnd = (c: WorldCell) => (linked.get(k(c)) ?? []).length === 1 && !c.landmark

  for (const l of links.values()) {
    const { a, b } = l
    const A = hexCenter(a.q, a.r)
    const B = hexCenter(b.q, b.r)
    const u = unit(B.x - A.x, B.z - A.z)
    const ha = heading(a, b)
    const hb = heading(b, a)
    // The bend as planned, half of it, then the straight line (which always stays inside a ∪ b).
    let half: Pt[][] = []
    for (const s of [1, 0.5, 0]) {
      const at = lerpPt(l.line, l.at, s)
      const dir = unit(u.x + (l.dir.x - u.x) * s, u.z + (l.dir.z - u.z) * s)
      const ra = unit(at.x - A.x, at.z - A.z)
      const rb = unit(at.x - B.x, at.z - B.z)
      const ta = unit(ra.x + (ha.x - ra.x) * s, ra.z + (ha.z - ra.z) * s)
      const tb = unit(rb.x + (hb.x - rb.x) * s, rb.z + (hb.z - rb.z) * s)
      const pa: Pt[] = []
      const pb: Pt[] = []
      curve(A, ta, at, dir, pa)
      curve(B, tb, at, { x: -dir.x, z: -dir.z }, pb)
      half = [pa, pb]
      if (s === 0 || half.every((pts) => pts.every((p) => inAny(field, [a, b], p)))) break
    }
    // Each half belongs to its own hex: planks on a Bridge.
    const hexes = [k(a), k(b)]
    const own: [WorldCell, Pt[]][] = [
      [a, half[0]],
      [b, half[1]],
    ]
    const parts: RoadStrip[] = []
    for (const [cell, pts] of own) {
      // From the crossing inward.
      const inward = [...pts].reverse()
      const planks = cell.road === 'bridge'
      parts.push({ pts: inward, planks, hexes, taper: [false, !planks && deadEnd(cell)] })
    }
    // Two halves of the same make join into one ribbon, from a's side to b's.
    const [pa, pb] = parts
    if (pa.planks === pb.planks) strips.push({ pts: [...[...pa.pts].reverse(), ...pb.pts.slice(1)], planks: pa.planks, hexes, taper: [pa.taper[1], pb.taper[1]] })
    else strips.push(pa, pb)
  }

  // A road hex with no links gets a short bowed track across its province.
  for (const [key, list] of linked) {
    const cell = board[key]
    if (list.length) continue
    const c = hexCenter(cell.q, cell.r)
    const ang = (hash01(cell.q, cell.r, 403) * 2 - 1) * 0.6
    const u = { x: Math.cos(ang), z: Math.sin(ang) }
    const bow = (hash01(cell.q, cell.r, 404) * 2 - 1) * ROAD.bow
    let pts: Pt[] = []
    for (let len = ROAD.lone; len > 0.1; len *= 0.75) {
      const s = { x: c.x - u.x * len, z: c.z - u.z * len }
      const e = { x: c.x + u.x * len, z: c.z + u.z * len }
      const m = { x: (s.x + e.x) / 2 - u.z * bow, z: (s.z + e.z) / 2 + u.x * bow }
      pts = []
      curve(s, unit(m.x - s.x, m.z - s.z), e, unit(e.x - m.x, e.z - m.z), pts)
      if (pts.every((p) => inAny(field, [cell], p))) break
    }
    const planks = cell.road === 'bridge'
    strips.push({ pts, planks, hexes: [key], taper: [!planks, !planks] })
  }
  return { strips }
}

// Shared by every build (never disposed): the ribbons' materials.
const DIRT = new THREE.MeshStandardMaterial({ color: '#9a7b52', roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
const PLANKS = new THREE.MeshStandardMaterial({ color: '#7a5332', roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })

/**
 * Roads from `board` (the current one), draped over `field`'s ground. The group's `userData.dispose()` frees its
 * ribbons (materials are shared).
 */
export function buildRoads(field: Field, board: Record<string, WorldCell>): THREE.Group {
  const g = new THREE.Group()
  const plan = roadPlan(field, board)
  const dirt = new Ribbon()
  const planks = new Ribbon()
  for (const s of plan.strips) {
    if (s.pts.length < 2) continue
    if (s.planks) planks.add(s.pts, ROAD.planks, () => ROAD.deck, s.taper)
    else dirt.add(s.pts, ROAD.dirt, (x, z) => Math.max(field.height(x, z), WATER_LEVEL) + ROAD.lift, s.taper)
  }
  const geos = [dirt.mesh(DIRT, g), planks.mesh(PLANKS, g)]
  castShadows(g)
  g.userData.dispose = () => geos.forEach((geo) => geo?.dispose())
  return g
}

/** One stand-in mesh per road material (dirt, planks), for compiling ahead. */
export function roadStandIns(): THREE.Group {
  const g = new THREE.Group()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3))
  for (const m of [DIRT, PLANKS]) g.add(new THREE.Mesh(geo, m))
  castShadows(g)
  return g
}

/** Ribbons along centrelines, gathered into one indexed mesh. */
class Ribbon {
  private pos: number[] = []
  private index: number[] = []
  /** Adds a ribbon `w` either side of `pts`, its edges at height y(x, z), narrowing to a third at a tapered end. */
  add(pts: Pt[], w: number, y: (x: number, z: number) => number, taper: [boolean, boolean]) {
    const base = this.pos.length / 3
    const along = [0]
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
    const total = along[along.length - 1]
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(pts.length - 1, i + 1)]
      const t = unit(b.x - a.x, b.z - a.z)
      const end = Math.min(taper[0] ? along[i] : Infinity, taper[1] ? total - along[i] : Infinity)
      const wi = w * (end < ROAD.taper ? 0.35 + 0.65 * Math.sqrt(end / ROAD.taper) : 1)
      const lx = p.x + t.z * wi
      const lz = p.z - t.x * wi
      const rx = p.x - t.z * wi
      const rz = p.z + t.x * wi
      this.pos.push(lx, y(lx, lz), lz, rx, y(rx, rz), rz)
      if (i) {
        const v = base + 2 * i
        this.index.push(v - 2, v - 1, v, v, v - 1, v + 1)
      }
    }
  }
  mesh(material: THREE.Material, into: THREE.Group): THREE.BufferGeometry | null {
    if (!this.index.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    geo.setIndex(this.index)
    geo.computeVertexNormals()
    const m = new THREE.Mesh(geo, material)
    m.receiveShadow = true
    into.add(m)
    return geo
  }
}
