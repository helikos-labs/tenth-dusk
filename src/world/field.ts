// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/field.ts, adapted for Tenth Dusk.
// The 3D board's terrain field: height and colour as pure functions of a world point (x, z), built from the board cells.
// One hex has circumradius 1 and the axes match the flat board: x right, z down the screen. No three.js here, so tests
// can read it. Every terrain shape is a profile of the distance to its region's border (Mountain hexes that touch merge
// into one massif whose ridge runs along the middle of the region; lakes deepen away from their shores).
//
// ORGANIC CONCEPT: the engine keeps its hexes, but the world on screen does not show them. A world point belongs to the
// hex under its *warped* position (`warp`), so every border meanders: ragged forest edges, irregular shores, ranges with
// crests instead of hexagonal blocks. Off the board lies the sea, with a coast that has beaches, cliffs, and islets off a
// sea wall.

import type { Terrain, WorldCell } from './adapter.ts'

export const SQRT3 = Math.sqrt(3)
/** Distance from a hex centre to the middle of an edge. */
export const INRADIUS = SQRT3 / 2
/** The water surface. */
export const WATER_LEVEL = -0.07

export interface Pt {
  x: number
  z: number
}

export const hexCenter = (q: number, r: number): Pt => ({ x: SQRT3 * (q + r / 2), z: 1.5 * r })

/** The axial hex under a world point (cube rounding). */
export function hexAt(x: number, z: number): { q: number; r: number } {
  const qf = (SQRT3 / 3) * x - z / 3
  const rf = (2 / 3) * z
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q: q + 0, r: r + 0 }
}

/** Corner i of a pointy-top hex (i = 0 is the top corner, then clockwise on screen). */
export function corner(c: Pt, i: number, radius = 1): Pt {
  const a = (Math.PI / 180) * (60 * i - 90)
  return { x: c.x + radius * Math.cos(a), z: c.z + radius * Math.sin(a) }
}

/** Edge i runs from corner i to corner i + 1 and faces this neighbour. */
export const EDGE_DIR = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
]

// ---------------------------------------------------------------- noise (deterministic, no seed: the board is the seed)

function lattice(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt, 0x2545f491)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade = (t: number) => t * t * (3 - 2 * t)

export function vnoise(x: number, y: number, salt = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const a = lattice(x0, y0, salt)
  const b = lattice(x0 + 1, y0, salt)
  const c = lattice(x0, y0 + 1, salt)
  const d = lattice(x0 + 1, y0 + 1, salt)
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
}

/** Fractal noise in [0, 1). */
export function fbm(x: number, y: number, salt = 0, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, salt + i * 17)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

/** fbmGrad's gradient (d/dx, d/dy) of its last call: a scratch pair, so the probe allocates nothing per point. */
const GRAD = new Float64Array(2)

/** `fbm`, the same value to the last bit, and its gradient in GRAD. */
function fbmGrad(x: number, y: number, salt: number, octaves: number): number {
  let sum = 0
  let gx = 0
  let gy = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    const X = x * f
    const Y = y * f
    const x0 = Math.floor(X)
    const y0 = Math.floor(Y)
    const fx = X - x0
    const fy = Y - y0
    const tx = fade(fx)
    const ty = fade(fy)
    const s = salt + i * 17
    const a = lattice(x0, y0, s)
    const b = lattice(x0 + 1, y0, s)
    const c = lattice(x0, y0 + 1, s)
    const d = lattice(x0 + 1, y0 + 1, s)
    const k = a - b - c + d
    sum += amp * (a + (b - a) * tx + (c - a) * ty + k * tx * ty)
    gx += amp * f * (b - a + k * ty) * 6 * fx * (1 - fx)
    gy += amp * f * (c - a + k * tx) * 6 * fy * (1 - fy)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  GRAD[0] = gx / norm
  GRAD[1] = gy / norm
  return sum / norm
}

/** Clamps x to [lo, hi] with rounded knees `k` wide, so the slope never jumps (softClampSlope is its slope). */
function softClamp(x: number, lo: number, hi: number, k: number): number {
  if (x <= lo - k) return lo
  if (x < lo + k) return lo + ((x - lo + k) * (x - lo + k)) / (4 * k)
  if (x <= hi - k) return x
  if (x < hi + k) return hi - ((hi + k - x) * (hi + k - x)) / (4 * k)
  return hi
}
const softClampSlope = (x: number, lo: number, hi: number, k: number) => Math.min(1, Math.max(0, Math.min(x - lo + k, hi + k - x) / (2 * k)))

/** Ridged noise in [0, 1]: sharp crests where the noise crosses its middle. */
export function ridged(x: number, y: number, salt = 0, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, salt + i * 31) * 2 - 1)
    sum += amp * n * n
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return sum / norm
}

/**
 * `ridged` with rounded crests and its fine octaves left out: the noise folds over a soft corner `soft` wide instead of
 * into a cusp, and only the first `octaves` of `of` are summed (scaled as if all were), so the shapes and heights match
 * `ridged`'s but no crest is finer than the mesh can draw (a crease narrower than two lattice steps renders as a
 * needle). The shader's rock grain adds the fine detail instead.
 */
function softRidged(x: number, y: number, salt: number, octaves: number, of: number, soft = 0.22): number {
  const top = Math.sqrt(1 + soft * soft)
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    const t = vnoise(x * f, y * f, salt + i * 31) * 2 - 1
    const n = (top - Math.sqrt(t * t + soft * soft)) / (top - soft)
    sum += amp * n * n
    amp *= 0.5
    f *= 2.1
  }
  return sum / (1 - Math.pow(0.5, of))
}

/** A stable [0, 1) value per integer pair, for picking per-hex variety. */
export const hash01 = (q: number, r: number, salt = 0) => lattice(q * 7 + 3, r * 13 - 5, salt + 99)

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The smaller of a and b with the corner rounded over `k` (never above Math.min(a, b), and equal to it beyond k). */
const smoothMin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}

// ---------------------------------------------------------------- regions

interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
}

/** Border segments of one terrain's region, bucketed on a grid so a point only checks the ones near it. */
class Border {
  private cells = new Map<string, Segment[]>()
  private reach: number
  readonly empty: boolean
  constructor(segments: Segment[], reach: number) {
    this.reach = reach
    this.empty = segments.length === 0
    for (const s of segments) {
      const minX = Math.floor((Math.min(s.ax, s.bx) - reach) / CELL)
      const maxX = Math.floor((Math.max(s.ax, s.bx) + reach) / CELL)
      const minZ = Math.floor((Math.min(s.az, s.bz) - reach) / CELL)
      const maxZ = Math.floor((Math.max(s.az, s.bz) + reach) / CELL)
      for (let i = minX; i <= maxX; i++)
        for (let j = minZ; j <= maxZ; j++) {
          const k = `${i},${j}`
          const list = this.cells.get(k)
          if (list) list.push(s)
          else this.cells.set(k, [s])
        }
    }
  }
  /**
   * Distance to the nearest border segment, capped at `reach`. With `grad` it also leaves the distance's gradient there
   * (the unit vector away from the nearest point; 0 when capped).
   */
  distance(x: number, z: number, grad?: Float64Array): number {
    const list = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    let best = this.reach
    if (grad) grad[0] = grad[1] = 0
    if (!list) return best
    for (const s of list) {
      const dx = s.bx - s.ax
      const dz = s.bz - s.az
      const l2 = dx * dx + dz * dz
      // A segment may be a single point (a lone rim hex's centre, for the coast's keep).
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0
      const ex = x - (s.ax + t * dx)
      const ez = z - (s.az + t * dz)
      const d = Math.hypot(ex, ez)
      if (d < best) {
        best = d
        if (grad && d > 1e-12) {
          grad[0] = ex / d
          grad[1] = ez / d
        }
      }
    }
    return best
  }
}
const CELL = 0.5

/** Terrain heights over the region profile. */
const MOUNTAIN_HEIGHT = 1.25
const LAKE_DEPTH = 0.3
const SEA_DEPTH = 0.34
/** Foothills: how high the ground swells at a range's foot (and how far the swell spills onto its neighbours). */
const FOOTHILL = 0.07
/** Mountain height above `knee` is eased towards at most knee + span, so summits round off instead of spiking. */
const SUMMIT = { knee: 1.1, span: 0.55 }

/** The direction (radians from the x axis towards z) ranges run in near a point: a grain that turns slowly across the board. */
export const grain = (x: number, z: number) => 0.6 + (fbm(x * 0.12, z * 0.12, 51, 2) - 0.5) * 2.4

/**
 * The body of a lone Mountain (no Mountain beside it): a short ridge along the grain with two summits, one higher, and
 * a saddle at the centre where pieces stand, instead of a single cone. `w` is the warped point; `dmc` its depth inside
 * the province, which brings the body down to the foothills at the border.
 */
function loneBody(cell: WorldCell, w: Pt, dmc: number): number {
  const c = hexCenter(cell.q, cell.r)
  const g = grain(c.x, c.z)
  const lx = w.x - c.x
  const lz = w.z - c.z
  const u = lx * Math.cos(g) + lz * Math.sin(g)
  const v = -lx * Math.sin(g) + lz * Math.cos(g)
  // Distance from the crest (0.3 each way from the centre), squeezed across the grain so the flanks fall faster.
  const r = Math.hypot(Math.max(0, Math.abs(u) - 0.3), v * 1.35)
  const side = hash01(cell.q, cell.r, 7) < 0.5 ? 1 : -1
  const twin = 1 - 0.16 * Math.exp(-(u * u) / 0.015) + 0.08 * side * Math.tanh(u / 0.3)
  return Math.pow(smoothstep(0, 0.6, dmc), 1.1) * (1 - smoothstep(0, 0.8, r)) * twin
}

// ---------------------------------------------------------------- the organic warp

/**
 * Domain warp knobs (world units; a hex has circumradius 1). Three octaves: a slow meander that bends whole borders, a
 * middle one that gives them bays and tongues, and a fine one that frays them. The displacement is soft-clamped to
 * `max`, below the 0.866 from a hex centre to its edge, so every hex centre, and the pieces standing on it, stays inside
 * its own province. materials.ts bakes `warp` into a displacement texture, so the shaders find the same province per
 * pixel.
 */
export const WARP = { f1: 0.3, a1: 1.3, f2: 0.8, a2: 0.8, f3: 2.0, a3: 0.36, knee: 0.3, max: 0.46 }

/** A warp: the point whose hex owns world point (x, z). */
export type Warp = (x: number, z: number) => Pt

/**
 * The warp for one world. `seed` shifts where the noise is read (two hashed offsets, so neighbouring seeds land far
 * apart), so every world meanders differently while the shape of the warp (its wavelengths and its cap) stays the same.
 */
export function makeWarp(seed: number): Warp {
  const { ox, oz } = warpOffset(seed)
  return (x0: number, z0: number): Pt => warpAt(x0, z0, ox, oz, null)
}

const warpOffset = (seed: number) => ({ ox: lattice(seed | 0, 17, 7) * 997, oz: lattice(seed | 0, 29, 11) * 991 })

/**
 * The warp at world point (x0, z0), its noise read at offset (ox, oz). With `jac` it also fills the warp's Jacobian
 * [dwx/dx, dwx/dz, dwz/dx, dwz/dz] (the same noise, differentiated), which turns a distance measured in warped space
 * into one on the board: the warp stretches some stretches of border to twice their length and squeezes others.
 */
function warpAt(x0: number, z0: number, ox: number, oz: number, jac: number[] | null): Pt {
  const { f1, a1, f2, a2, f3, a3 } = WARP
  const x = x0 + ox
  const z = z0 + oz
  let dx: number
  let dz: number
  let dxx = 0
  let dxz = 0
  let dzx = 0
  let dzz = 0
  if (!jac) {
    dx = (fbm(x * f1, z * f1, 41, 3) - 0.5) * a1 + (fbm(x * f2, z * f2, 45, 2) - 0.5) * a2 + (fbm(x * f3, z * f3, 43, 2) - 0.5) * a3
    dz = (fbm(x * f1 + 5.2, z * f1 - 1.3, 42, 3) - 0.5) * a1 + (fbm(x * f2 + 3.7, z * f2 + 2.9, 46, 2) - 0.5) * a2 + (fbm(x * f3 - 2.7, z * f3 + 8.1, 44, 2) - 0.5) * a3
  } else {
    // The same noise, differentiated: each call leaves its gradient in GRAD.
    const p1 = fbmGrad(x * f1, z * f1, 41, 3)
    dxx = a1 * f1 * GRAD[0]
    dxz = a1 * f1 * GRAD[1]
    const p2 = fbmGrad(x * f2, z * f2, 45, 2)
    dxx += a2 * f2 * GRAD[0]
    dxz += a2 * f2 * GRAD[1]
    const p3 = fbmGrad(x * f3, z * f3, 43, 2)
    dxx += a3 * f3 * GRAD[0]
    dxz += a3 * f3 * GRAD[1]
    const q1 = fbmGrad(x * f1 + 5.2, z * f1 - 1.3, 42, 3)
    dzx = a1 * f1 * GRAD[0]
    dzz = a1 * f1 * GRAD[1]
    const q2 = fbmGrad(x * f2 + 3.7, z * f2 + 2.9, 46, 2)
    dzx += a2 * f2 * GRAD[0]
    dzz += a2 * f2 * GRAD[1]
    const q3 = fbmGrad(x * f3 - 2.7, z * f3 + 8.1, 44, 2)
    dzx += a3 * f3 * GRAD[0]
    dzz += a3 * f3 * GRAD[1]
    dx = (p1 - 0.5) * a1 + (p2 - 0.5) * a2 + (p3 - 0.5) * a3
    dz = (q1 - 0.5) * a1 + (q2 - 0.5) * a2 + (q3 - 0.5) * a3
  }
  const l = Math.hypot(dx, dz)
  if (l > WARP.knee) {
    const span = WARP.max - WARP.knee
    const th = Math.tanh((l - WARP.knee) / span)
    const k = (WARP.knee + span * th) / l
    if (jac) {
      // The cap scales the displacement by k(l): its slope gains D k'(l) dl, with k'(l) = (sech² - k) / l.
      const kp = (1 - th * th - k) / l
      const lx = (dx * dxx + dz * dzx) / l
      const lz = (dx * dxz + dz * dzz) / l
      dxx = dxx * k + dx * kp * lx
      dxz = dxz * k + dx * kp * lz
      dzx = dzx * k + dz * kp * lx
      dzz = dzz * k + dz * kp * lz
    }
    dx *= k
    dz *= k
  }
  if (jac) {
    jac[0] = 1 + dxx
    jac[1] = dxz
    jac[2] = dzx
    jac[3] = 1 + dzz
  }
  return { x: x0 + dx, z: z0 + dz }
}

/**
 * The warp seed of a board: a hash of its Mountain and Water hexes, which never change during a game, so the world keeps
 * one shape from round 1 to the end and the same seed always draws the same island.
 */
export function warpSeedOf(board: Record<string, WorldCell>): number {
  const keys = Object.values(board)
    .filter((c) => c.terrain === 'mountain' || c.terrain === 'water')
    .map((c) => `${c.q},${c.r}${c.terrain[0]}`)
    .sort()
    .join(' ')
  let h = 0x811c9dc5
  for (let i = 0; i < keys.length; i++) h = Math.imul(h ^ keys.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** What covers a point: a terrain, or the sea round the island. */
export type Ground = Terrain | 'sea'
export const LAND: Terrain[] = ['grassland', 'forest', 'mountain', 'blight']
const TERRAINS: Terrain[] = ['grassland', 'forest', 'mountain', 'water', 'blight']

/**
 * Fine, per-terrain noise added to a terrain's signed distance where colours and plants decide, so two terrains that
 * share a border pull it back and forth: ragged forest edges, fingers of rot.
 */
export const fray = (t: Terrain, x: number, z: number) => (fbm(x * 3.6 + TERRAINS.indexOf(t) * 17.3, z * 3.6, 120 + TERRAINS.indexOf(t), 2) - 0.5) * 0.36

/** Everything the mesh and the plants need to know about one world point, computed once. */
export interface Probe {
  /** The warped point (where the hex lookup happens). */
  w: Pt
  /** The province (hex) that owns the point; off the board, the rim province it faces (see `toRim`), even at sea. */
  cell: WorldCell | null
  ground: Ground
  /** Signed distance to each terrain's region border, positive inside, capped at the region's reach; `sea` is minus `s`. */
  sd: Record<Ground, number>
  /** Signed distance to the coast, positive on land. */
  s: number
  /** Distance to the nearest lake shore and to the coast (0 when in the water or at sea). */
  lake: number
  coast: number
  /** How much the nearby coast is a cliff (0 beach, 1 cliff). */
  cliff: number
  height: number
}

export interface Field {
  board: Record<string, WorldCell>
  /** This world's warp seed (`warpSeedOf`) and warp. */
  seed: number
  warp: Warp
  probe(x: number, z: number): Probe
  /** The province under a world point (the hex its warped position falls in, or the nearest rim province on the coast). */
  provinceAt(x: number, z: number): WorldCell | null
  terrainAt(x: number, z: number): Terrain | null
  /** Distance from a point inside a region of terrain `t` to that region's border (0 outside the region). */
  depthIn(t: Terrain, x: number, z: number): number
  /** Distance from a point to the nearest lake shore or coast (0 in the water). */
  shoreDistance(x: number, z: number): number
  height(x: number, z: number): number
  normal(x: number, z: number): [number, number, number]
  /** The board's extent on the ground, wall ring included, and the zone's inside it (`boundsOf`). */
  bounds: Bounds
}

/** A rectangle on the ground (world units). */
export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** The ground the board covers: every hex whole (corners included), and `inner`, the same for the non-wall hexes. */
export interface Bounds extends Rect {
  inner: Rect
}

/** The rectangle round the hexes `cells`, corners included (a pointy-top hex is √3 wide and 2 tall). */
function rectOf(cells: WorldCell[]): Rect {
  const r: Rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const c of cells) {
    const p = hexCenter(c.q, c.r)
    r.minX = Math.min(r.minX, p.x - INRADIUS)
    r.maxX = Math.max(r.maxX, p.x + INRADIUS)
    r.minZ = Math.min(r.minZ, p.z - 1)
    r.maxZ = Math.max(r.maxZ, p.z + 1)
  }
  return r
}

/** The board's bounds: round all its hexes, and (`inner`) round those that are not wall (all of them if every one is). */
export function boundsOf(board: Record<string, WorldCell>): Bounds {
  const cells = Object.values(board)
  if (!cells.length) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, inner: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } }
  const zone = cells.filter((c) => !c.wall)
  return { ...rectOf(cells), inner: rectOf(zone.length ? zone : cells) }
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error below 1.2e-9). */
function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)))
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)))
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * The coast. The board's outline is a sawtooth of hex edges, so the coast is drawn instead along a contour of the board
 * blurred by a Gaussian (SIGMA), which has no trace of the lattice left in it; COAST_LEVEL puts that contour just outside
 * the rim hexes' corners, so every province keeps its land. Low noise then pushes capes out and cuts bays in, and the
 * keep (KEEP) stops a bay short of the rim provinces' middles.
 */
const SIGMA = 0.9
const COAST_LEVEL = 0.3
const LATTICE_SUM = (2 * Math.PI * SIGMA * SIGMA) / (1.5 * SQRT3)
/** The raw contour value's typical slope on the board, which turns it into a distance away from the coast. */
const COAST_SLOPE = 1.4
/**
 * The rim provinces keep their middles dry: a bay may cut into a rim province, but never within KEEP of the chain that
 * links the rim hexes' centres, since pieces stand up to about 0.6 from a centre and roads run from centre to centre.
 * (Before the keep, the coast came within 0.2 of a rim centre, and within 0.6 of one rim centre in eleven.) KEEP
 * wanders between `min` and `min + span` with seeded noise of frequency `f`, so where it holds a bay back the shore still
 * meanders instead of running along the board's side; `soft` (raw contour units) rounds the bay's floor into it, and
 * the chain's distance is read out to `reach`.
 */
export const KEEP = { min: 0.62, span: 0.25, f: 0.32, soft: 0.4, reach: 2.6 }
/** The keep's distance gradient at the point being probed (a scratch pair, like GRAD). */
const KGRAD = new Float64Array(2)

export function buildField(board: Record<string, WorldCell>, seed = warpSeedOf(board)): Field {
  const { ox, oz } = warpOffset(seed)
  const warp: Warp = (x, z) => warpAt(x, z, ox, oz, null)
  /** The warp's Jacobian at the point being probed (see warpAt). */
  const jac = [1, 0, 0, 1]
  // The coast's capes, cliffs and islets read their noise at a seeded offset too, so every island has its own outline.
  const sx = lattice(seed | 0, 3, 5) * 503
  const sz = lattice(seed | 0, 7, 9) * 509
  const cells = Object.values(board)
  const bounds = boundsOf(board)
  // The hexes in a grid over the board's axial range, with room round it (lookups reach a few hexes off the board).
  const PAD = 8
  const q0 = Math.min(0, ...cells.map((c) => c.q)) - PAD
  const r0 = Math.min(0, ...cells.map((c) => c.r)) - PAD
  const GQ = Math.max(0, ...cells.map((c) => c.q)) + PAD + 1 - q0
  const GR = Math.max(0, ...cells.map((c) => c.r)) + PAD + 1 - r0
  const grid: (WorldCell | undefined)[] = new Array(GQ * GR)
  const at = (q: number, r: number): WorldCell | undefined => {
    const i = q - q0
    const j = r - r0
    return i < 0 || j < 0 || i >= GQ || j >= GR ? undefined : grid[j * GQ + i]
  }
  for (const c of cells) grid[(c.r - r0) * GQ + (c.q - q0)] = c

  // Region borders: edges between two terrains. The board's outline is no border (the coast is), so a terrain on the
  // rim runs on to the sea.
  const regions = new Map<Terrain, Border>()
  for (const t of TERRAINS) {
    const segs: Segment[] = []
    for (const c of cells) {
      if (c.terrain !== t) continue
      const ctr = hexCenter(c.q, c.r)
      EDGE_DIR.forEach((d, i) => {
        const nb = at(c.q + d.q, c.r + d.r)
        if (!nb || nb.terrain === t) return
        const a = corner(ctr, i)
        const b = corner(ctr, i + 1)
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z })
      })
    }
    regions.set(t, new Border(segs, t === 'mountain' ? 1.6 : 1.0))
  }
  /** Mountain hexes with no Mountain beside them: each is drawn as a short ridge rather than a lone cone. */
  const lone = new Set(cells.filter((c) => c.terrain === 'mountain' && EDGE_DIR.every((d) => at(c.q + d.q, c.r + d.r)?.terrain !== 'mountain')))

  // The chain the coast keeps clear of (KEEP): each rim hex's centre and the links to its rim neighbours.
  const onRim = (c: WorldCell) => EDGE_DIR.some((d) => !at(c.q + d.q, c.r + d.r))
  const chain: Segment[] = []
  for (const c of cells) {
    if (!onRim(c)) continue
    const a = hexCenter(c.q, c.r)
    chain.push({ ax: a.x, az: a.z, bx: a.x, bz: a.z })
    // Each link once: towards the first three neighbours only.
    for (const d of EDGE_DIR.slice(0, 3)) {
      const n = at(c.q + d.q, c.r + d.r)
      if (!n || !onRim(n)) continue
      const b = hexCenter(n.q, n.r)
      chain.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z })
    }
  }
  const keep = new Border(chain, KEEP.reach)

  const twoS2 = 2 * SIGMA * SIGMA
  const level = probit(COAST_LEVEL)
  const SQRT_2PI = Math.sqrt(2 * Math.PI)
  /**
   * Signed distance to the coast at world point (x, z) whose warped point is w (positive on land). The blurred board and
   * the cape noise stretch the raw contour value unevenly (its slope runs from about 0.3 to 2.7 round one coast), which
   * made sand broad on some capes and a hairline elsewhere; so near the coast it is divided by its own slope, worked out
   * alongside it, and every width measured from the coast (beaches, shelves, cliffs) is about the same everywhere.
   * Uses the Jacobian `jac` of the probe's warp; `exact` false skips that (for callers that only need the sign).
   */
  const coastAt = (w: Pt, x: number, z: number, exact = true): number => {
    const h0 = hexAt(w.x, w.z)
    let sum = 0
    let gx = 0
    let gz = 0
    for (let dq = -3; dq <= 3; dq++)
      for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++) {
        if (!at(h0.q + dq, h0.r + dr)) continue
        const c = hexCenter(h0.q + dq, h0.r + dr)
        const d2 = (w.x - c.x) * (w.x - c.x) + (w.z - c.z) * (w.z - c.z)
        // A smooth window, not a cut-off: the loop reaches every centre within 5 of the point, and a hard edge in the
        // faint tails would show as scalloped steps on the sea floor.
        if (d2 >= 21) continue
        const e = Math.exp(-d2 / twoS2)
        const t = Math.max(0, (d2 - 9) / 12)
        const win = 1 - t * t * (3 - 2 * t)
        sum += e * win
        // The slope of this centre's share (Gaussian and window), towards the centre.
        const k = e * (win / (SIGMA * SIGMA) + t * (1 - t))
        gx -= k * (w.x - c.x)
        gz -= k * (w.z - c.z)
      }
    const mr = sum / LATTICE_SUM
    const m = Math.min(1 - 1e-9, Math.max(1e-9, mr))
    const p = probit(m)
    const capeRaw = (fbmGrad((x + sx) * 0.28, (z + sz) * 0.28, 91, 3) - 0.5) * 2.6
    const capeX = GRAD[0]
    const capeZ = GRAD[1]
    let raw = SIGMA * (p - level) + softClamp(capeRaw, -0.45, 0.9, 0.12)
    // The keep (KEEP): the contour value is at least the distance inside the line KEEP out from the rim chain (in raw
    // units), blended in smoothly; `own` is raw's share of the blend, and (kx, kz) the keep's slope.
    let own = 1
    let kx = 0
    let kz = 0
    const dk = keep.distance(x, z, KGRAD)
    if ((KEEP.min + KEEP.span - dk) * COAST_SLOPE > raw - KEEP.soft) {
      const n = fbmGrad((x + sx) * KEEP.f, (z + sz) * KEEP.f, 95, 2)
      const guard = (KEEP.min + KEEP.span * smoothstep(0.3, 0.7, n) - dk) * COAST_SLOPE
      own = Math.min(1, Math.max(0, 0.5 + (raw - guard) / (2 * KEEP.soft)))
      if (own < 1) {
        raw = guard + (raw - guard) * own + KEEP.soft * own * (1 - own)
        const t = Math.min(1, Math.max(0, (n - 0.3) / 0.4))
        const dn = (KEEP.span * 6 * t * (1 - t) * KEEP.f) / 0.4
        kx = COAST_SLOPE * (dn * GRAD[0] - KGRAD[0])
        kz = COAST_SLOPE * (dn * GRAD[1] - KGRAD[1])
      }
    }
    if (!exact) return raw
    // d probit / dm is 1 over the normal density at probit(m); the warp's Jacobian carries that slope onto the board.
    // The blend's slope is the shares of its two slopes (the shares' own change cancels out).
    const dp = m === mr ? (SIGMA * SQRT_2PI * Math.exp(0.5 * p * p)) / LATTICE_SUM : 0
    const ck = softClampSlope(capeRaw, -0.45, 0.9, 0.12) * 0.728
    const bx = (dp * (jac[0] * gx + jac[2] * gz) + ck * capeX) * own + kx * (1 - own)
    const bz = (dp * (jac[1] * gx + jac[3] * gz) + ck * capeZ) * own + kz * (1 - own)
    const k = Math.min(2.5, Math.max(0.5, Math.hypot(bx, bz)))
    // The slope is a true scale only near the coast: it changes within a tenth of a hex (the warp's fine octave), so away
    // from the coast s is scaled by the typical slope instead, which keeps it smooth. On land the blend is quick, since
    // ranges and cliffs stand on s; out to sea it is slower, so the shallows are as wide off a cape as off a bay. Either
    // way it is gentle enough that s still grows steadily away from the coast for any slope from 0.5 up.
    const blend = raw > 0 ? smoothstep(0.05, 0.8, raw) : smoothstep(0.2, 1.6, -raw)
    return raw / (k + (COAST_SLOPE - k) * blend)
  }
  const rim = rimRay(bounds)
  /**
   * Where the ray from the middle of the board's bounds through an off-board (warped) point leaves the board: the land
   * beyond the outline belongs to that rim province and reads its terrain there, so the strip continues the rim
   * smoothly (the point on the outline maps to itself). Bisection between a scale surely on the board (`rimRay`) and
   * 1; the shader does the same.
   */
  const toRim = (w: Pt): Pt => {
    const dx = w.x - rim.cx
    const dz = w.z - rim.cz
    let lo = rim.sure(dx, dz)
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      const h = hexAt(rim.cx + dx * mid, rim.cz + dz * mid)
      if (at(h.q, h.r)) lo = mid
      else hi = mid
    }
    return { x: rim.cx + dx * lo, z: rim.cz + dz * lo }
  }
  const nearestRim = (w: Pt): WorldCell | null => {
    const r = toRim(w)
    const h = hexAt(r.x, r.z)
    return at(h.q, h.r) ?? null
  }

  const probe = (x: number, z: number): Probe => {
    const w = warpAt(x, z, ox, oz, jac)
    const hx = hexAt(w.x, w.z)
    const s = coastAt(w, x, z)
    let cell = at(hx.q, hx.r) ?? null
    // Off the board, the terrain is read where the point's ray leaves the board.
    let wq = w
    if (!cell && cells.length) {
      wq = toRim(w)
      const h = hexAt(wq.x, wq.z)
      cell = at(h.q, h.r) ?? null
    }
    const ground: Ground = s <= 0 || !cell ? 'sea' : cell.terrain
    const sd = {} as Record<Ground, number>
    for (const t of TERRAINS) {
      const b = regions.get(t)!
      const d = b.empty ? 1.6 : b.distance(wq.x, wq.z)
      sd[t] = cell?.terrain === t ? d : -d
    }
    sd.sea = -s
    const wet = ground === 'water' || ground === 'sea'
    const lake = wet ? 0 : -sd.water
    const coast = ground === 'sea' ? 0 : s
    // Stretches of the coast are cliffs: the land holds its height to the edge and the sea is deep below it.
    const cliff = smoothstep(0.5, 0.62, fbm((x + sx) * 0.35, (z + sz) * 0.35, 71, 2))
    const p: Probe = { w, cell, ground, sd, s, lake, coast, cliff, height: 0 }
    p.height = heightOf(x, z, p)
    return p
  }

  const heightOf = (x: number, z: number, p: Probe): number => {
    const { ground, sd } = p
    // Gentle rolling ground everywhere, flattened towards shores so land meets the water at its edge.
    const roll = (fbm(x * 0.55, z * 0.55, 1, 3) - 0.5) * 0.11 + (fbm(x * 2.3, z * 2.3, 2, 2) - 0.5) * 0.025
    const lakeBed = (d: number) => -0.025 - LAKE_DEPTH * smoothstep(0, 0.3, d) + (fbm(x * 1.7, z * 1.7, 3, 2) - 0.5) * 0.05 * smoothstep(0.2, 0.7, d)
    if (ground === 'sea') {
      const d = -p.s
      // The land meets the sea a little above the water, so the floor first dips under it within a narrow strip of wet
      // sand; then it shelves gently off a beach, or drops at once below a cliff.
      let h = -0.025 - 0.06 * smoothstep(0, 0.09, d) - (SEA_DEPTH - 0.06) * smoothstep(0.03, 0.75 - 0.5 * p.cliff, d)
      h += (fbm(x * 1.7, z * 1.7, 3, 2) - 0.5) * 0.06 * smoothstep(0.15, 0.5, d)
      // Islets and skerries offshore: rocky knolls rising out of the shelf, with water between them and the beach (an
      // islet that touched it would join it as a broad sand spit).
      // Only off a sea wall (the rim province is water): the walls of peaks stand on the Hush, not on islands.
      const isle =
        smoothstep(0.62, 0.74, fbm((x + sx) * 0.55, (z + sz) * 0.55, 61, 3)) * smoothstep(0.3, 0.55, d) * (1 - smoothstep(0.9, 1.35, d)) * smoothstep(0, 0.4, sd.water)
      const top = 0.08 + 0.26 * ridged(x * 2.2, z * 2.2, 62, 2)
      h += (top - h) * isle
      // A lake on the rim opens into the sea: its basin carries on (no sandbar where the two meet).
      if (sd.water > 0) h = Math.min(h, lakeBed(sd.water))
      return h
    }
    if (ground === 'water') return lakeBed(sd.water)
    const shoreLake = smoothstep(0, 0.42, p.lake)
    const shoreCoast = smoothstep(0, 0.3 - 0.24 * p.cliff, p.coast)
    const shore = Math.min(shoreLake, shoreCoast)
    // A cliffy coast lifts the land behind it, so the cliff has height.
    const lift = 0.13 * p.cliff * (1 - smoothstep(0.18, 0.95, p.coast))
    let h = (roll + lift) * shore - 0.025 * (1 - shore)
    // Relief fades out right at the water so shores stay continuous.
    const relief = smoothstep(0, 0.12, Math.min(p.lake, p.coast))
    const foot = FOOTHILL * (0.5 + fbm(x * 1.6, z * 1.6, 9, 2))
    const dm = sd.mountain
    if (dm > 0) {
      // A range that reaches the water falls to it as steep slopes, not a wall: the shore bounds it like any border. The
      // bounds meet in a rounded crease (a hard min would draw a sharp crest where they cross, a needle near the coast).
      const dmc = smoothMin(smoothMin(dm, p.coast * 1.2, 0.3), p.lake * 1.6, 0.3)
      let body = Math.pow(smoothstep(0, 0.85, dmc), 1.15)
      // Ranges, not blocks: ridged noise stretched along a slowly turning grain gives crests and valleys.
      const ang = grain(x, z)
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const ridge = softRidged((x * ca + z * sa) * 0.75, (-x * sa + z * ca) * 1.9, 5, 2, 4, 0.32)
      const crags = 0.42 + 0.82 * ridge + 0.25 * softRidged(x * 1.35, z * 1.35, 7, 2, 3, 0.32)
      const spires = 0.2 * smoothstep(0.35, 1.25, dmc) * softRidged(x * 3.4 + 7, z * 3.4, 6, 1, 3, 0.5)
      if (p.cell && lone.has(p.cell)) body = loneBody(p.cell, p.w, dmc)
      // Where the noise peaks line up, a summit would shoot up as a needle; heights above the knee rise ever more
      // slowly, which rounds those tops (a crest at 1.5 loses only 0.06; one at 2 is held to 1.61).
      const m = MOUNTAIN_HEIGHT * body * crags + spires
      h += relief * (foot + (m > SUMMIT.knee ? SUMMIT.knee + SUMMIT.span * Math.tanh((m - SUMMIT.knee) / SUMMIT.span) : m))
    } else {
      // Foothills spill out over the neighbouring land.
      h += relief * foot * (1 - smoothstep(0, 0.5, -dm))
    }
    if (ground === 'blight') {
      h += smoothstep(0, 0.25, sd.blight) * (-0.035 + 0.05 * ridged(x * 3.2, z * 3.2, 8, 2))
    } else if (ground === 'forest') {
      h += 0.035 * smoothstep(0, 0.4, sd.forest)
    }
    return h
  }

  const provinceAt = (x: number, z: number): WorldCell | null => {
    const w = warp(x, z)
    const h = hexAt(w.x, w.z)
    const c = at(h.q, h.r)
    if (c) return c
    return coastAt(w, x, z, false) > 0 ? nearestRim(w) : null
  }
  const terrainAt = (x: number, z: number): Terrain | null => provinceAt(x, z)?.terrain ?? null
  const depthIn = (t: Terrain, x: number, z: number) => Math.max(0, probe(x, z).sd[t])
  const shoreDistance = (x: number, z: number) => {
    const p = probe(x, z)
    return Math.min(p.lake, p.coast)
  }
  const height = (x: number, z: number): number => probe(x, z).height

  const normal = (x: number, z: number): [number, number, number] => {
    const e = 0.025
    const dx = height(x + e, z) - height(x - e, z)
    const dz = height(x, z + e) - height(x, z - e)
    const nx = -dx
    const ny = 2 * e
    const nz = -dz
    const l = Math.hypot(nx, ny, nz)
    return [nx / l, ny / l, nz / l]
  }

  return { board, seed, warp, probe, provinceAt, terrainAt, depthIn, shoreDistance, height, normal, bounds }
}

/**
 * The ray toRim follows, for the field and the shader alike: from the middle of the bounds (cx, cz), and `sure`, the
 * share of an offset (dx, dz) from there that surely stays on the board, inside the bounds by RIM_SURE on both axes
 * (the outline's teeth and the corners between pointy tops reach in less than that).
 */
export function rimRay(b: Rect) {
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const hx = Math.max(0, (b.maxX - b.minX) / 2 - RIM_SURE)
  const hz = Math.max(0, (b.maxZ - b.minZ) / 2 - RIM_SURE)
  const sure = (dx: number, dz: number) => Math.min(1, hx / Math.max(Math.abs(dx), 1e-9), hz / Math.max(Math.abs(dz), 1e-9))
  return { cx, cz, hx, hz, sure }
}
/** How far inside the bounds a point surely lies on the board: past the outline's deepest notch (√3 at the side). */
export const RIM_SURE = 2
