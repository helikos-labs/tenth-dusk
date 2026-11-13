// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/materials.ts, adapted for Tenth Dusk.
// Shader work for the 3D board. The terrain is a MeshStandardMaterial (so it lights and takes shadows like everything
// else) patched to draw target and hover rims, read per province from a small state texture.
// Water has its own material: moving ripples, depth colour, shore foam and a sun glint. `windPatch` sways instanced
// plants.
//
// ORGANIC CONCEPT: no grid lines. Each pixel finds its province the way field.ts does, by warping its world position
// (field.ts `warp`, baked once into a displacement texture) and taking the hex under the warped point; rims then follow
// the province's meandering border, and a faint ink line marks each border between two land provinces,
// so provinces can be counted while the island still reads as one landscape.
import * as THREE from 'three'
import type { WorldCell } from './adapter.ts'
import { CHAPTER1 } from '../data/book1.ts'
import { toAxial } from '../rules/hex.ts'
import { WATER_LEVEL, makeWarp, rimRay, type Bounds, type Rect } from './field.ts'
import { PALETTE } from './palette.ts'
import { PERF_GLSL } from '../testHooks.ts'
import { WARMTH_GLSL } from './warmth.ts'

/** Texels per hex in the state texture. */
export const TEXELS = 3

/**
 * The state texture holds a fixed grid of axial coordinates round SLOT_CENTRE, |q - centre q| and |r - centre r| at
 * most SLOT_OFFSET, so a shader can find any hex. It is sized from the bounds of Book I chapter 1 with its wall ring
 * (rows and columns -wallDepth to rows or cols - 1 + wallDepth): 29 × 29 slots, 2,523 texels wide.
 */
function slotGrid(s: { rows: number; cols: number; wallDepth: number }) {
  let q0 = Infinity
  let q1 = -Infinity
  let r0 = Infinity
  let r1 = -Infinity
  for (let row = -s.wallDepth; row < s.rows + s.wallDepth; row++)
    for (const col of [-s.wallDepth, s.cols - 1 + s.wallDepth]) {
      const { q, r } = toAxial({ row, col })
      q0 = Math.min(q0, q)
      q1 = Math.max(q1, q)
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
    }
  const centre = { q: Math.round((q0 + q1) / 2), r: Math.round((r0 + r1) / 2) }
  return { centre, offset: Math.max(q1 - centre.q, centre.q - q0, r1 - centre.r, centre.r - r0) }
}
const GRID = slotGrid(CHAPTER1)
export const SLOT_CENTRE: { q: number; r: number } = GRID.centre
export const SLOT_OFFSET = GRID.offset
const SLOT_WIDTH = 2 * SLOT_OFFSET + 1
export const SLOTS = SLOT_WIDTH * SLOT_WIDTH
export const slotOf = (q: number, r: number) => (r - SLOT_CENTRE.r + SLOT_OFFSET) * SLOT_WIDTH + (q - SLOT_CENTRE.q + SLOT_OFFSET)

/**
 * Per-hex state, three RGBA texels per hex slot:
 *   texel 0: r = target hint, g = hover (0.5 illegal, 1 legal), b and a unused (0)
 *   texel 1: r unused (0), g = landmark, b = selected, a = (terrain id + 1) / 8 (0: no hex, the sea)
 *   texel 2: fog (fog.ts `fogByte`): r = fog state / 3, g = marker kind, b = reachable highlight, a = wall
 */
export function makeStateTexture(count: number): THREE.DataTexture {
  const data = new Uint8Array(Math.max(1, count) * TEXELS * 4)
  const tex = new THREE.DataTexture(data, Math.max(1, count) * TEXELS, 1, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

export const NOISE_GLSL = /* glsl */ `
vec3 rr_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 rr_mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 rr_permute(vec3 x) { return rr_mod289(((x * 34.0) + 1.0) * x); }
float rr_snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = rr_mod289(i);
  vec3 p = rr_permute(rr_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`

/** Slow cloud shadows drifting across the board: how much to darken at a world point (0–0.2). */
const CLOUD_GLSL = /* glsl */ `
float rr_cloud(vec2 p, float t) {
  float n = rr_snoise(p * 0.11 + vec2(t * 0.018, t * 0.009)) * 0.7 + rr_snoise(p * 0.27 - vec2(t * 0.011, -t * 0.02)) * 0.3;
  return smoothstep(0.25, 0.75, n) * 0.2;
}
`

/**
 * The ground a warp texture covers (world units, from its corner minX, minZ) and its texels a side. A world's box is
 * `warpBoxOf` its bounds; the default is Rift & Root's, x and z in [-10, 10] at WARP_TEXELS a side.
 */
export interface WarpBox {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
  w: number
  h: number
}
export const WARP_TEXELS = 320
const DEFAULT_WARP_BOX: WarpBox = { minX: -10, minZ: -10, sizeX: 20, sizeZ: 20, w: WARP_TEXELS, h: WARP_TEXELS }
/** Texels per world unit, as Rift & Root had them, and the most a side may have. */
const WARP_DENSITY = 16
const WARP_MAX = 1024

/** The warp box round a board's bounds, with a hex to spare past the lattice's edge. */
export function warpBoxOf(b: Rect): WarpBox {
  const minX = b.minX - 1.5
  const minZ = b.minZ - 1.5
  const sizeX = b.maxX - b.minX + 3
  const sizeZ = b.maxZ - b.minZ + 3
  return { minX, minZ, sizeX, sizeZ, w: Math.min(WARP_MAX, Math.ceil(sizeX * WARP_DENSITY)), h: Math.min(WARP_MAX, Math.ceil(sizeZ * WARP_DENSITY)) }
}
/** Warp textures by seed, the latest last; a few worlds' worth (a new game brings a new seed), the oldest freed. */
const warpTextures = new Map<number, THREE.DataTexture>()
const WARP_KEPT = 3

/**
 * One world's warp (field.ts `makeWarp(seed)`) as displacements on a grid over `box`: x then z per texel, half
 * floats. No three.js objects but the half-float maths, so the world worker bakes it with the world's first build
 * (worldBuild.ts) and the main thread only wraps it (`makeWarpTexture`).
 */
export function warpData(seed: number, box: WarpBox = DEFAULT_WARP_BOX): Uint16Array {
  const warp = makeWarp(seed)
  const { w: nx, h: nz } = box
  const data = new Uint16Array(nx * nz * 2)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = box.minX + ((i + 0.5) * box.sizeX) / nx
      const z = box.minZ + ((j + 0.5) * box.sizeZ) / nz
      const w = warp(x, z)
      data[(j * nx + i) * 2] = THREE.DataUtils.toHalfFloat(w.x - x)
      data[(j * nx + i) * 2 + 1] = THREE.DataUtils.toHalfFloat(w.z - z)
    }
  return data
}

/**
 * One world's warp as a texture of displacements (half floats, filtered), so a pixel finds its province with one fetch
 * instead of evaluating the noise. Built from `data` (the world worker's `warpData`) when given, else baked here (the
 * fallback, about 80 ms). Cached per seed: a world keeps its seed all game. Only the last WARP_KEPT worlds' are kept:
 * an older one is disposed (its 400 KB on the GPU freed; three.js uploads it again if a board still draws with it). Between
 * texels it is interpolated, a few thousandths of a hex off the exact warp.
 */
export function makeWarpTexture(seed: number, data?: Uint16Array, box: WarpBox = DEFAULT_WARP_BOX): THREE.DataTexture {
  const cached = warpTextures.get(seed)
  if (cached) {
    warpTextures.delete(seed)
    warpTextures.set(seed, cached)
    return cached
  }
  const tex = new THREE.DataTexture(data && data.length === box.w * box.h * 2 ? data : warpData(seed, box), box.w, box.h, THREE.RGFormat, THREE.HalfFloatType)
  /** Where it lies on the ground, for the shaders' uWarpBox (`warpBoxUniform`). */
  tex.userData.box = box
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  warpTextures.set(seed, tex)
  for (const [old, t] of warpTextures) {
    if (warpTextures.size <= WARP_KEPT) break
    warpTextures.delete(old)
    t.dispose()
  }
  return tex
}

/** The uWarpBox value for a warp texture: its box's corner and size (x, z, width, depth). */
export function warpBoxUniform(tex: THREE.DataTexture, out = new THREE.Vector4()): THREE.Vector4 {
  const b: WarpBox = tex.userData.box ?? DEFAULT_WARP_BOX
  return out.set(b.minX, b.minZ, b.sizeX, b.sizeZ)
}

/**
 * The board's shape for the shaders: `uRect` its offset rows and columns (min row, max row, min column, max column; a
 * zone is a rectangle of them), and `uRim` the ray field.ts `toRim` follows off the board (`rimRay`: its centre x, z and
 * the half-extents surely on the board).
 */
export function boardShape(board: Record<string, WorldCell>, bounds: Bounds): { rect: THREE.Vector4; rim: THREE.Vector4 } {
  let r0 = Infinity
  let r1 = -Infinity
  let c0 = Infinity
  let c1 = -Infinity
  for (const c of Object.values(board)) {
    const row = -c.r
    const col = c.q - (row + (row & 1)) / 2
    r0 = Math.min(r0, row)
    r1 = Math.max(r1, row)
    c0 = Math.min(c0, col)
    c1 = Math.max(c1, col)
  }
  const ray = rimRay(bounds)
  return { rect: new THREE.Vector4(r0, r1, c0, c1), rim: new THREE.Vector4(ray.cx, ray.cz, ray.hx, ray.hz) }
}

/** True once a world's warp texture is made. */
export const hasWarpTexture = (seed: number) => warpTextures.has(seed)

/** A stand-in warp (no displacement) for the shaders' uniforms until the world's own arrives with its first build. */
export function noWarpTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint16Array(2), 1, 1, THREE.RGFormat, THREE.HalfFloatType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** Edge i of a hex faces neighbour RR_DIRS_ALL[i]; its outward normal points at 60 * i - 60 degrees; corner i starts it. */
const v2 = (x: number, y: number) => `vec2(${x.toFixed(7)}, ${y.toFixed(7)})`
const R3 = 0.8660254
const RR_DIRS_ALL = [v2(1, -1), v2(1, 0), v2(0, 1), v2(-1, 1), v2(-1, 0), v2(0, -1)]
const RR_NORMS = [v2(0.5, -R3), v2(1, 0), v2(0.5, R3), v2(-0.5, R3), v2(-1, 0), v2(-0.5, -R3)]
const RR_CORNERS = [v2(0, -1), v2(R3, -0.5), v2(R3, 0.5), v2(0, 1), v2(-R3, 0.5), v2(-R3, -0.5)]
/** RRProv's border distance to neighbour i. */
const RR_DN = ['dnA.x', 'dnA.y', 'dnA.z', 'dnB.x', 'dnB.y', 'dnB.z']
const SIX = [0, 1, 2, 3, 4, 5]
/**
 * rr_province's border distances, written out per edge and corner with constant indices (no loops over arrays).
 * Edge pass: an edge whose neighbour is off the board is the outline (P.edge), else a border (d, its dn, ink; a border
 * with a lake is a shore, not an ink line, and counts as 0.3 away so the distance stays continuous). Corner pass, on
 * the outline only: corner i is an inner corner when one of its two edges is shared and the other is not; beyond it
 * the border with that neighbour is the ray from the board's centre (the part from the corner outwards).
 */
const RR_EDGES_GLSL = [
  ...SIX.map((i) => `  bool rr_on${i} = rr_on(h + ${RR_DIRS_ALL[i]});`),
  ...SIX.map(
    (i) => `  {
    float dw = (0.8660254 - dot(P.local, ${RR_NORMS[i]})) / max(length(vec2(dot(${RR_NORMS[i]}, jx), dot(${RR_NORMS[i]}, jz))), 0.25);
    if (!rr_on${i}) {
      if (!off) P.edge = min(P.edge, dw);
    } else if (!off) {
      P.d = min(P.d, dw);
      P.${RR_DN[i]} = dw;
      P.ink = min(P.ink, dw < 0.3 && (P.lake > 0.5 || rr_lake(h + ${RR_DIRS_ALL[i]})) ? 0.3 : dw);
    }
  }`,
  ),
  `  if (!(rr_on0 && rr_on1 && rr_on2 && rr_on3 && rr_on4 && rr_on5)) {`,
  ...SIX.map((i) => {
    const j = (i + 5) % 6
    const across = (k: number) => `P.${RR_DN[k]} = min(P.${RR_DN[k]}, dw);
        P.ink = min(P.ink, dw < 0.3 && (P.lake > 0.5 || rr_lake(h + ${RR_DIRS_ALL[k]})) ? 0.3 : dw);`
    return `    if (rr_on${j} != rr_on${i}) {
      vec2 v = ctr + ${RR_CORNERS[i]};
      vec2 dir = normalize(v - uRim.xy);
      vec2 perp = vec2(-dir.y, dir.x);
      float dr = dot(w - uRim.xy, dir) > length(v - uRim.xy) ? abs(dot(w - uRim.xy, perp)) : length(w - v);
      float dw = dr / max(length(vec2(dot(perp, jx), dot(perp, jz))), 0.25);
      P.d = min(P.d, dw);
      if (rr_on${j}) {
        ${across(j)}
      } else {
        ${across(i)}
      }
    }`
  }),
  `  }`,
].join('\n')

/**
 * The province lookup, in GLSL: the warp (from the warp texture over `uWarpBox`) and field.ts's `hexAt`, then the hex's slot in the state
 * texture. `rr_province(world xz, on land)` returns an RRProv:
 *   slot   the province's slot in the state texture (-1: none, the sea);
 *   local  the warped point relative to the hex centre;
 *   lake   1 for a Water province;
 *   d      distance to the nearest border with another province (lake or land);
 *   ink    the same, counting only borders between two land provinces (at least 0.3 on a lake shore or in a lake);
 *   edge   distance to the board's outline, on the board: where a lake that opens into the sea ends.
 * Distances are on the board, in world units: each is measured in warped space and divided by how much the warp
 * stretches it there (the warp's Jacobian, from two more fetches of the warp texture), so a line drawn at a fixed
 * distance keeps its width while it meanders. The board's outline is no border (the coast is). Off the board, land
 * belongs to the rim province its ray from the board's centre leaves through (field.ts `toRim`), so the borders between
 * rim provinces run on out along the rays through the outline's inner corners; the sea belongs to none (slot -1).
 * `uRect` and `uRim` are the board's shape (`boardShape`).
 */
export const WARP_GLSL = /* glsl */ `
${PERF_GLSL}
// The warp's displacement at a world point (the point's province is the hex under p + rr_disp(p)).
vec2 rr_disp(vec2 p) {
  return texture2D(uWarp, (p - uWarpBox.xy) / uWarpBox.zw).rg;
}
vec2 rr_hexRound(vec2 w) {
  float qf = 0.57735027 * w.x - w.y / 3.0;
  float rf = w.y * (2.0 / 3.0);
  float sf = -qf - rf;
  float q = floor(qf + 0.5);
  float r = floor(rf + 0.5);
  float s = floor(sf + 0.5);
  float dq = abs(q - qf);
  float dr = abs(r - rf);
  float ds = abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return vec2(q, r);
}
// On the board: the hex's offset row and column (rules/hex.ts toOffset) inside uRect.
bool rr_on(vec2 h) {
  float row = -h.y;
  float col = h.x - (row + mod(row, 2.0)) * 0.5;
  return row > uRect.x - 0.5 && row < uRect.y + 0.5 && col > uRect.z - 0.5 && col < uRect.w + 0.5;
}
float rr_slotOf(vec2 h) {
  vec2 g = h - vec2(${SLOT_CENTRE.q}.0, ${SLOT_CENTRE.r}.0);
  return (abs(g.x) > ${SLOT_OFFSET}.0 || abs(g.y) > ${SLOT_OFFSET}.0) ? -1.0 : (g.y + ${SLOT_OFFSET}.0) * ${SLOT_WIDTH}.0 + (g.x + ${SLOT_OFFSET}.0);
}
// A Water province: terrain id 3, stored as 4 / 8 in texel 1's alpha (makeStateTexture).
bool rr_lake(vec2 h) {
  float slot = rr_slotOf(h);
  if (slot < 0.0) return false;
  return abs(texture2D(uState, vec2((slot * ${TEXELS}.0 + 1.5) / uStateSize, 0.5)).a - 0.5) < 0.06;
}
// Off the board: the rim province whose outer edge the ray from the centre through warped point w leaves through
// (field.ts toRim).
vec2 rr_rimHex(vec2 w) {
  vec2 rd = w - uRim.xy;
  float lo = min(1.0, min(uRim.z / max(abs(rd.x), 1e-6), uRim.w / max(abs(rd.y), 1e-6)));
  float hi = 1.0;
  for (int i = 0; i < 10; i++) {
    float mid = 0.5 * (lo + hi);
    if (rr_on(rr_hexRound(uRim.xy + rd * mid))) lo = mid;
    else hi = mid;
  }
  return rr_hexRound(uRim.xy + rd * lo);
}
// The hex of the province a land point lies in, by its warped point only (no distances): for plants' origins.
vec2 rr_hexOf(vec2 world) {
  vec2 w = world + rr_disp(world);
  vec2 h = rr_hexRound(w);
  return rr_on(h) ? h : rr_rimHex(w);
}
// The six neighbours' directions (axial), edge i facing RR_DIRS[i].
const vec2 RR_DIRS[6] = vec2[6](vec2(1.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-1.0, 1.0), vec2(-1.0, 0.0), vec2(0.0, -1.0));
// hex: the province's axial coordinates; dnA.xyz, dnB.xyz: the distances to the borders with neighbours 0 to 5
// (RR_DIRS order; 9 where there is none: the board's outline, or off the board).
struct RRProv { float slot; vec2 local; float lake; float d; float ink; float edge; vec2 hex; vec3 dnA; vec3 dnB; };
RRProv rr_province(vec2 world, bool land) {
  RRProv P = RRProv(-1.0, vec2(0.0), 0.0, 9.0, 9.0, 9.0, vec2(0.0), vec3(9.0), vec3(9.0));
  vec2 dsp = rr_disp(world);
  vec2 w = world + dsp;
  vec2 h = rr_hexRound(w);
  bool off = !rr_on(h);
  if (off) {
    if (!land) return P;
    h = rr_rimHex(w);
  }
  // How the warp stretches a distance across a line with normal n (warped space): |J^T n|.
  vec2 jx = vec2(1.0, 0.0) + (rr_disp(world + vec2(0.04, 0.0)) - dsp) * 25.0;
  vec2 jz = vec2(0.0, 1.0) + (rr_disp(world + vec2(0.0, 0.04)) - dsp) * 25.0;
  vec2 ctr = vec2(1.7320508 * (h.x + h.y * 0.5), 1.5 * h.y);
  P.slot = rr_slotOf(h);
  P.hex = h;
  P.local = w - ctr;
  P.lake = rr_lake(h) ? 1.0 : 0.0;
#ifndef TD_OFF_BORDER
  // Unrolled with constant indices (RR_EDGES_GLSL): computed indices into local arrays send them to memory on Adreno
  // GPUs, which held an Adreno 740 at 5 fps.
${RR_EDGES_GLSL}
#endif
  return P;
}
`

/** A colour as a GLSL vec3 (its linear working-space values, as the shaders work in). */
const glsl = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`

/**
 * Fog of war (§15.4), read from texel 2 (fog.ts). Each state treats a colour:
 *   unseen: the fog floor's colour FLOOR (not the hidden ground's, so nothing of it leaks, R16) mixed 92% toward
 *   UNSEEN, with slow mist noise (MIST_NOISE toward MIST);
 *   sunk: mixed 85% toward DUSK, the Hush;
 *   remembered: 30% saturation, then 35% toward DUSK;
 *   in sight: unchanged;
 *   wall: remembered, then toward UNSEEN in step with how far it lies into the ring (from the zone's bounds, `uInner`),
 *   reaching WALL_DARK WALL_FADE world units out (the ring is 4 hexes deep: 6 across its rows).
 */
/** The Hush's colour: the fog, the sky and the world's dusk everywhere (one source). */
export const DUSK = '#14171c'
export const FOG_LOOK = {
  UNSEEN: new THREE.Color('#10151d'),
  FLOOR: new THREE.Color('#3a4350'),
  DUSK: new THREE.Color(DUSK),
  MIST: new THREE.Color('#2b3542'),
  MIST_NOISE: 0.45,
  WALL_DARK: 0.8,
  WALL_FADE: 6,
}
/** States blend over this width across a province border (world units: a hex is 2 across its corners). */
export const FOG_BLEND = 0.12
/** Unseen and sunk land sinks to this flat floor (a little above the water level), hiding its relief (R16). */
export const FOG_FLOOR = WATER_LEVEL + 0.03

/** The fog treatments, given a state's weights. Needs uInner and the noise (NOISE_GLSL). */
export const FOG_TINT_GLSL = /* glsl */ `
// How much of each state a point shows: x unseen, y sunk, z remembered, w in sight, and wall; they sum to 1.
struct TDFog { vec4 w; float wall; };
// Adds weight k of a hex whose texel 2 is s (a wall counts as a wall whatever its state).
void td_add(inout TDFog f, vec4 s, float k) {
  if (s.a > 0.5) { f.wall += k; return; }
  float st = floor(s.r * 3.0 + 0.5);
  f.w += k * vec4(st < 0.5 ? 1.0 : 0.0, abs(st - 1.0) < 0.5 ? 1.0 : 0.0, abs(st - 2.0) < 0.5 ? 1.0 : 0.0, st > 2.5 ? 1.0 : 0.0);
}
// One hex's state alone.
TDFog td_one(vec4 s) {
  TDFog f = TDFog(vec4(0.0), 0.0);
  td_add(f, s, 1.0);
  return f;
}
vec3 td_remembered(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(mix(vec3(l), c, 0.3), ${glsl(FOG_LOOK.DUSK)}, 0.35);
}
// How far point p lies outside the zone's bounds.
float td_ring(vec2 p) {
  return length(max(max(uInner.xy - p, p - uInner.zw), 0.0));
}
float td_sum(TDFog f) {
  return max(dot(f.w, vec4(1.0)) + f.wall, 1e-4);
}
// The unseen and sunk share: how far land sinks to the fog floor and water fades out.
float td_hidden(TDFog f) {
  return (f.w.x + f.w.y) / td_sum(f);
}
// The unseen treatment: the fog floor's colour, whatever lies hidden; mist (0 to 1) is its slow noise.
vec3 td_unseen(float mist) {
  return mix(mix(${glsl(FOG_LOOK.FLOOR)}, ${glsl(FOG_LOOK.UNSEEN)}, 0.92), ${glsl(FOG_LOOK.MIST)}, ${FOG_LOOK.MIST_NOISE.toFixed(3)} * mist);
}
// Colour c at world point p as fog f shows it, all but the unseen share, which keeps c: the ground applies that after
// lighting (td_unseen), so unseen land isn't shaded by the sun.
vec3 td_tintSeen(vec3 c, TDFog f, vec2 p) {
  vec3 sunk = mix(c, ${glsl(FOG_LOOK.DUSK)}, 0.85);
  vec3 rem = td_remembered(c);
  vec3 wall = mix(rem, ${glsl(FOG_LOOK.UNSEEN)}, ${FOG_LOOK.WALL_DARK.toFixed(3)} * min(td_ring(p) / ${FOG_LOOK.WALL_FADE.toFixed(1)}, 1.0));
  return (c * (f.w.x + f.w.w) + sunk * f.w.y + rem * f.w.z + wall * f.wall) / td_sum(f);
}
// Colour c at world point p as fog f shows it, every share at once.
vec3 td_tint(vec3 c, TDFog f, vec2 p, float mist) {
  return td_tintSeen(c, f, p) + (td_unseen(mist) - c) * (f.w.x / td_sum(f));
}
// The unseen's slow mist noise at p (0 to 1).
float td_mistNoise(vec2 p, float t) {
  return smoothstep(-0.6, 0.8, rr_snoise(p * 0.35 + vec2(t * 0.025, t * 0.011)) * 0.65 + rr_snoise(p * 0.9 - vec2(t * 0.017, -t * 0.03)) * 0.35);
}
`

/** One hex's fog texel. Needs WARP_GLSL and uState / uStateSize. */
const FOG_TEXEL_GLSL = /* glsl */ `
// Texel 2 of hex h; a hex outside the slot grid is wall.
vec4 td_fogOf(vec2 h) {
  float slot = rr_slotOf(h);
  if (slot < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return texture2D(uState, vec2((slot * ${TEXELS}.0 + 2.5) / uStateSize, 0.5));
}
`

/** The fog at a point, through the warp (with FOG_TEXEL_GLSL). Needs WARP_GLSL, FOG_TINT_GLSL and uState / uStateSize. */
export const FOG_LOOKUP_GLSL = /* glsl */ `
${FOG_TEXEL_GLSL}
// The fog at a point of province P: its own state, blended with each neighbour's over FOG_BLEND across their border
// (the border distances rr_province measures, so the blend follows the warped border). No province (slot -1, the
// sea): wall.
TDFog td_fogAt(RRProv P) {
  TDFog f = TDFog(vec4(0.0), 0.0);
  if (P.slot < 0.0) {
    f.wall = 1.0;
    return f;
  }
  const float h = ${(FOG_BLEND / 2).toFixed(3)};
  td_add(f, td_fogOf(P.hex), smoothstep(-h, h, P.d));
#ifndef TD_OFF_BLEND
${RR_DIRS_ALL.map((d, i) => `  if (P.${RR_DN[i]} < h) td_add(f, td_fogOf(P.hex + ${d}), 1.0 - smoothstep(-h, h, P.${RR_DN[i]}));`).join('\n')}
#endif
  return f;
}
`

/** Ash drifts and the low haze on seen ground (ART-DIRECTION §3.3): their colours. */
export const ASH_LOOK = { ASH: new THREE.Color('#9a958a'), HAZE: new THREE.Color('#3b3a36') }

/**
 * Ash drifts and low haze (§3.3), driven by the cloud shade's noise (`rr_cloud`, no new noise call), and only on seen
 * ground (C7). `cloud` is rr_cloud's value over its range (0 to 1). Needs FOG_TINT_GLSL.
 */
export const ASH_GLSL = /* glsl */ `
// The pale ash blend (0 to 0.5) where the cloud noise runs high: from the cloud's edge, so a patch reads at the default
// zoom, strongest at its heart.
float td_ash(float cloud) {
  return 0.5 * smoothstep(0.0, 0.4, cloud);
}
// Colour c at world point wpos under the low haze: thickest on low ground, drifting with the cloud noise, scaled by
// seen (td_seenShare).
vec3 td_haze(vec3 c, vec3 wpos, float seen, float cloud) {
  return mix(c, ${glsl(ASH_LOOK.HAZE)}, 0.18 * (1.0 - smoothstep(0.0, 1.2, wpos.y)) * (0.6 + 0.4 * cloud) * seen);
}
// How far ash and haze show at fog f: none until its seen share (remembered and in sight) passes 0.5, so nothing of
// unseen or sunk ground shows (C7), then fading in with it.
float td_seenShare(TDFog f) {
  return smoothstep(0.5, 1.0, (f.w.z + f.w.w) / td_sum(f));
}
`

/** The fog's uniform declarations, for a shader that reads it. */
export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uState;
uniform float uStateSize;
uniform vec4 uRect;
uniform vec4 uRim;
uniform sampler2D uWarp;
uniform vec4 uWarpBox;
uniform vec4 uInner;`

/**
 * How far a ground vertex sinks to the fog floor (0 to 1): the unseen and sunk share of the fog at its province, from
 * its object-space position and its coast distance (the sea floor, at or below 0, never sinks). Needs NOISE_GLSL,
 * WARP_GLSL, FOG_TINT_GLSL and FOG_LOOKUP_GLSL.
 */
const SINK_GLSL = /* glsl */ `
float td_sinkAt(vec3 pos, float coast) {
  if (coast <= 0.0) return 0.0;
  vec3 w = (modelMatrix * vec4(pos, 1.0)).xyz;
  return td_hidden(td_fogAt(rr_province(w.xz, true)));
}
`
/** Everything a vertex shader needs for `td_sinkAt`: the fog's uniforms and lookups. */
const SINK_VERTEX_GLSL = `${FOG_UNIFORMS_GLSL}\n${NOISE_GLSL}\n${WARP_GLSL}\n${FOG_TINT_GLSL}\n${FOG_LOOKUP_GLSL}\n${SINK_GLSL}`

export interface TerrainUniforms {
  uTime: { value: number }
  uState: { value: THREE.DataTexture }
  uStateSize: { value: number }
  uHint: { value: THREE.Color }
  /** The board's shape (`boardShape`). */
  uRect: { value: THREE.Vector4 }
  uRim: { value: THREE.Vector4 }
  uWarp: { value: THREE.DataTexture }
  /** Where the warp texture lies (`warpBoxUniform`). */
  uWarpBox: { value: THREE.Vector4 }
  /** Direction towards the sun (world space, normalised): snow in its shade turns blue. */
  uSun: { value: THREE.Vector3 }
  /** The zone's bounds without its wall ring (field.ts `bounds.inner`: min x, min z, max x, max z), for the walls' fog. */
  uInner: { value: THREE.Vector4 }
  /** The first three lit beacons' world positions (warmth.ts `litPositions`; unused slots far away). */
  uLit0: { value: THREE.Vector3 }
  uLit1: { value: THREE.Vector3 }
  uLit2: { value: THREE.Vector3 }
}

/** What the fog of war reads (`windPatch` for plants, mist.ts): the state texture, the province lookup and uInner. */
export type FogUniforms = Pick<TerrainUniforms, 'uTime' | 'uState' | 'uStateSize' | 'uRect' | 'uRim' | 'uWarp' | 'uWarpBox' | 'uInner'>
/** What the warmth round lit beacons reads (warmth.ts): the terrain and, with the fog, the plants (`windPatch`). */
export type LitUniforms = Pick<TerrainUniforms, 'uLit0' | 'uLit1' | 'uLit2'>


/** The reachable highlight (texel 2 b): its colour, rim width (world units) and glow, and the wash inside it. */
export const REACH_LOOK = { color: new THREE.Color('#ffb46a'), rim: 0.09, rimGlow: 0.55, wash: 0.035 }

/** Width of the ink line along a province border, in world units (a hex is 2 across its corners). */
const INK_WIDTH = 0.024

export function makeTerrainMaterial(uniforms: TerrainUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aRock;
attribute float aCoast;
varying vec3 vWPos;
varying float vRock;
varying float vCoast;
varying float vSink;
${SINK_VERTEX_GLSL}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
// Fog of war (R16): unseen and sunk land sinks to the flat fog floor, so no relief shows through; its normal turns up.
float td_sink = td_sinkAt(position, aCoast);
objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), td_sink));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed.y = mix(transformed.y, ${FOG_FLOOR.toFixed(3)}, td_sink);
vSink = td_sink;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRock = aRock * (1.0 - td_sink);
vCoast = aCoast;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform sampler2D uState;
uniform float uStateSize;
uniform vec3 uHint;
uniform vec4 uRect;
uniform vec4 uRim;
uniform sampler2D uWarp;
uniform vec4 uWarpBox;
uniform vec3 uSun;
uniform vec4 uInner;
varying vec3 vWPos;
varying float vRock;
varying float vCoast;
varying float vSink;
${NOISE_GLSL}
${CLOUD_GLSL}
${WARP_GLSL}
${FOG_TINT_GLSL}
${FOG_LOOKUP_GLSL}
${ASH_GLSL}
${WARMTH_GLSL}
vec4 rr_state(float slot, float texel) {
  if (slot < 0.0) return vec4(0.0);
  return texture2D(uState, vec2((slot * ${TEXELS}.0 + texel + 0.5) / uStateSize, 0.5));
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// The province under this pixel and how far it is from the province's meandering borders (world units). The sea floor
// belongs to no province.
bool rr_land = vCoast > 0.0;
RRProv rr_prov = rr_province(vWPos.xz, rr_land);
if (!rr_land) rr_prov.slot = -1.0;
vec4 rr_s0 = rr_state(rr_prov.slot, 0.0);
vec4 rr_s1 = rr_state(rr_prov.slot, 1.0);
float rr_d = rr_prov.d;
// The province's whole outline, for rims and washes: its borders, then the coast (vCoast is a true distance), or for a
// lake that opens into the sea, the board's edge.
float rr_rim = min(rr_d, rr_prov.lake > 0.5 ? rr_prov.edge : vCoast);
// Ink: a faint line along every border between two land provinces, so each province can be counted (the rules are per
// province) without a grid; it wobbles with the warp. Anti-aliased, and never thinner than a pixel: a narrower line
// fades instead, so it does not break into dashes when the board is far away; close up, where it is several pixels
// wide, it lightens so it stays a pen line rather than a lane. It fades out before the coast and is never drawn on a
// lake or the sea; a little lighter on bright ground (snow), darker on meadow.
float rr_px = max(length(vec2(dFdx(rr_prov.ink), dFdy(rr_prov.ink))), 1e-4);
float rr_half = max(${(INK_WIDTH / 2).toFixed(4)}, 0.5 * rr_px);
float rr_ink = (1.0 - smoothstep(rr_half - 0.5 * rr_px, rr_half + 0.5 * rr_px, rr_prov.ink)) * min(1.0, ${INK_WIDTH.toFixed(4)} / rr_px);
rr_ink *= (rr_land ? smoothstep(0.03, 0.12, vCoast) : 0.0) * (1.0 - 0.45 * smoothstep(3.0, 9.0, ${INK_WIDTH.toFixed(4)} / rr_px));
float rr_lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb *= 1.0 - rr_ink * mix(0.24, 0.14, smoothstep(0.15, 0.6, rr_lum));
// A target province takes a faint wash of the hint, inside its whole outline.
if (rr_s0.r > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uHint, 0.12 * (1.0 - smoothstep(0.0, 0.5, rr_rim)));
// The cloud shade (0 to 0.2), computed once: it darkens the ground and drives the ash and the haze. 0 with ?perf=1's
// grain off.
float rr_cl = 0.0;
#ifndef TD_OFF_GRAIN
rr_cl = rr_cloud(vWPos.xz, uTime);
#endif
diffuseColor.rgb *= 1.0 - rr_cl;
float td_cl = rr_cl * 5.0;
// Fog of war (§15.4): the province's state from texel 2, blended with its neighbours' across the warped border. The
// unseen share is tinted after lighting (opaque_fragment).
TDFog rr_fog = td_fogAt(rr_prov);
// Ash drifts on seen land (the sea floor is no province, so never seen; not on a lake's bed), before lighting.
float td_seen = td_seenShare(rr_fog);
diffuseColor.rgb = mix(diffuseColor.rgb, ${glsl(ASH_LOOK.ASH)}, td_ash(td_cl) * td_seen * (1.0 - rr_prov.lake));
diffuseColor.rgb = td_tintSeen(diffuseColor.rgb, rr_fog, vWPos.xz);
// Warmth round lit beacons (§3.7), on seen ground only (C7): the albedo here, the fire's glow with the emissive.
float td_w = td_warmth(vWPos.xz) * td_seen;
diffuseColor.rgb = td_warm(diffuseColor.rgb, td_w);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifndef TD_OFF_GRAIN
// Rock grain on mountainsides and cliffs: bend the normal by a noise gradient (no extra geometry).
if (vRock > 0.02) {
  vec2 rp = vWPos.xz * 4.2;
  float h0 = rr_snoise(rp) + 0.45 * rr_snoise(rp * 2.7);
  float hx = rr_snoise(rp + vec2(0.1, 0.0)) + 0.45 * rr_snoise((rp + vec2(0.1, 0.0)) * 2.7);
  float hz = rr_snoise(rp + vec2(0.0, 0.1)) + 0.45 * rr_snoise((rp + vec2(0.0, 0.1)) * 2.7);
  vec3 grad = vec3(hx - h0, 0.0, hz - h0) * 0.55 * vRock;
  normal = normalize(normal - (viewMatrix * vec4(grad, 0.0)).xyz);
}
// Snow (the bright, grey-free vertex colours): wind ripples in the normal, a little grain in its white, and a cold blue
// where it turns away from the sun, so a snowfield reads as snow and not as smooth white plastic.
float rr_snow = smoothstep(0.38, 0.6, min(min(vColor.r, vColor.g), vColor.b)) * (1.0 - vSink);
if (rr_snow > 0.01) {
  vec2 sp = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz * vec2(9.0, 3.2);
  float s0 = rr_snoise(sp);
  float sx = rr_snoise(sp + vec2(0.12, 0.0));
  float sz = rr_snoise(sp + vec2(0.0, 0.12));
  normal = normalize(normal - (viewMatrix * vec4(vec3(sx - s0, 0.0, sz - s0) * 0.32 * rr_snow, 0.0)).xyz);
  float grain = 0.6 * rr_snoise(vWPos.xz * 2.4) + 0.4 * rr_snoise(vWPos.xz * 13.0);
  diffuseColor.rgb *= 1.0 - rr_snow * (0.05 + 0.045 * grain);
  float lit = dot(normal, normalize((viewMatrix * vec4(uSun, 0.0)).xyz));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.86, 1.0), rr_snow * smoothstep(0.45, -0.05, lit));
}
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += td_glow(td_w);
// Highlights show only on what is in sight (the in-sight share of the fog here), never on unseen, sunk or remembered
// ground. Target hint: a gilt rim that breathes. Hover: green for legal, red for not. Both run round the whole outline,
// along the coast too where a rim province meets the sea.
float td_lit = rr_fog.w.w / td_sum(rr_fog);
if (rr_s0.r > 0.5) {
  float pulse = 0.6 + 0.4 * sin(uTime * 3.4);
  float rim = 1.0 - smoothstep(0.0, 0.10, rr_rim);
  totalEmissiveRadiance += td_lit * uHint * (rim * pulse * 1.15 + 0.10 * (1.0 - smoothstep(0.0, 0.45, rr_rim)));
}
if (rr_s0.g > 0.25) {
  vec3 hc = rr_s0.g > 0.75 ? vec3(0.45, 1.0, 0.4) : vec3(1.0, 0.3, 0.2);
  totalEmissiveRadiance += td_lit * hc * (1.0 - smoothstep(0.0, 0.065, rr_rim)) * 1.1;
}
// Reachable (texel 2 b, the hexes the steps left can reach): a soft, steady lantern-coloured rim and a faint wash.
if (rr_state(rr_prov.slot, 2.0).b > 0.5) {
  float rim = 1.0 - smoothstep(0.0, ${REACH_LOOK.rim.toFixed(3)}, rr_rim);
  totalEmissiveRadiance += td_lit * ${glsl(REACH_LOOK.color)} * (rim * ${REACH_LOOK.rimGlow.toFixed(3)} + ${REACH_LOOK.wash.toFixed(3)});
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// The unseen share after lighting: flat fog, not shaded by the sun.
gl_FragColor.rgb = mix(gl_FragColor.rgb, td_unseen(rr_fog.w.x > 0.0 ? td_mistNoise(vWPos.xz, uTime) : 0.0), rr_fog.w.x / td_sum(rr_fog));
// The low haze, on seen ground only (C7).
gl_FragColor.rgb = td_haze(gl_FragColor.rgb, vWPos, td_seen, td_cl);`,
      )
  }
  mat.customProgramCacheKey = () => 'td-terrain-fog-6'
  return mat
}

/**
 * The terrain's depth material for the shadow pass: the ground sunk to the fog floor as the terrain material sinks it,
 * so hidden relief casts no shadow. Give it to the terrain mesh as its customDepthMaterial.
 */
export function makeTerrainDepthMaterial(uniforms: FogUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial()
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aCoast;\n${SINK_VERTEX_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.y = mix(transformed.y, ${FOG_FLOOR.toFixed(3)}, td_sinkAt(position, aCoast));`)
  }
  mat.customProgramCacheKey = () => 'td-terrain-depth-fog-1'
  return mat
}

/** What the water reflects at grazing angles, and its shore foam: muted to the dusk. */
const DUSK_SKY = new THREE.Color('#6f7f8c')
const FOAM = new THREE.Color('#7f8b8d')

export interface WaterUniforms {
  uTime: { value: number }
  uState: { value: THREE.DataTexture }
  uStateSize: { value: number }
  uHint: { value: THREE.Color }
  uSun: { value: THREE.Vector3 }
  uRect: { value: THREE.Vector4 }
  uRim: { value: THREE.Vector4 }
  uWarp: { value: THREE.DataTexture }
  uWarpBox: { value: THREE.Vector4 }
  uInner: { value: THREE.Vector4 }
}

export function makeWaterMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // The scene's fog too (three.js fills these from scene.fog), so the water fades with the land round it.
    uniforms: { ...(uniforms as unknown as Record<string, THREE.IUniform>), ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
#include <fog_pars_vertex>
attribute float aDepth;
varying vec3 vWPos;
varying float vDepth;
uniform float uTime;
void main() {
  vec3 p = position;
  p.y += 0.006 * sin(p.x * 3.1 + uTime * 1.4) * sin(p.z * 2.7 - uTime * 1.1) * smoothstep(0.0, 0.08, aDepth);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWPos = w.xyz;
  vDepth = aDepth;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform sampler2D uState;
uniform float uStateSize;
uniform vec3 uHint;
uniform vec3 uSun;
uniform vec4 uRect;
uniform vec4 uRim;
uniform sampler2D uWarp;
uniform vec4 uWarpBox;
uniform vec4 uInner;
varying vec3 vWPos;
varying float vDepth;
${NOISE_GLSL}
${WARP_GLSL}
${FOG_TINT_GLSL}
${FOG_LOOKUP_GLSL}
vec2 grad(vec2 p, float t) {
  float e = 0.04;
  float a = rr_snoise(p + vec2(t * 0.11, t * 0.07)) + 0.5 * rr_snoise(p * 2.3 - vec2(t * 0.17, -t * 0.05));
  float bx = rr_snoise(p + vec2(e, 0.0) + vec2(t * 0.11, t * 0.07)) + 0.5 * rr_snoise((p + vec2(e, 0.0)) * 2.3 - vec2(t * 0.17, -t * 0.05));
  float bz = rr_snoise(p + vec2(0.0, e) + vec2(t * 0.11, t * 0.07)) + 0.5 * rr_snoise((p + vec2(0.0, e)) * 2.3 - vec2(t * 0.17, -t * 0.05));
  return vec2(bx - a, bz - a) / e;
}
void main() {
  vec2 g = grad(vWPos.xz * 2.2, uTime);
  vec3 n = normalize(vec3(-g.x * 0.035, 1.0, -g.y * 0.035));
  vec3 v = normalize(cameraPosition - vWPos);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  float deep = smoothstep(0.02, 0.26, vDepth);
  // Dusk water (palette.ts): deep slate-teal, darker with depth, catching a dim evening sky at grazing angles.
  vec3 shallow = ${glsl(PALETTE.water)};
  vec3 deepc = ${glsl(PALETTE.waterDeep)};
  vec3 col = mix(shallow, deepc, deep);
  vec3 sky = ${glsl(DUSK_SKY)};
  col = mix(col, sky, fres * 0.65);
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(uSun)), 0.0), 180.0) * 2.4 + pow(max(dot(r, normalize(uSun)), 0.0), 18.0) * 0.12;
  col += vec3(1.0, 0.95, 0.85) * spec;
  // Foam along the shore, broken up by noise.
  float foam = (1.0 - smoothstep(0.0, 0.035, vDepth)) * smoothstep(-0.2, 0.6, rr_snoise(vWPos.xz * 9.0 + uTime * 0.4));
  col = mix(col, ${glsl(FOAM)}, foam * 0.75);
  float alpha = mix(0.5, 0.93, deep) + foam * 0.3;
  // A lake's markers, as on land, along its meandering border; a lake that opens into the sea is closed off where the
  // board ends. A land province stops at its coast, so the sea carries none of its marks.
  RRProv prov = rr_province(vWPos.xz, false);
  // Fog of war, as on the ground (the sea, no province, is the Hush); unseen and sunk water fades out, so the fog
  // floor shows instead of a river's course (R16). Markers show only on water in sight.
  TDFog fog = td_fogAt(prov);
  if (prov.slot >= 0.0 && prov.lake > 0.5) {
    float d = min(prov.d, prov.edge);
    float lit = fog.w.w / td_sum(fog);
    vec4 s0 = texture2D(uState, vec2((prov.slot * ${TEXELS}.0 + 0.5) / uStateSize, 0.5));
    if (s0.r > 0.5) col += lit * uHint * (1.0 - smoothstep(0.0, 0.1, d)) * (0.6 + 0.4 * sin(uTime * 3.4)) * 1.1;
    if (s0.g > 0.25) col += lit * (s0.g > 0.75 ? vec3(0.45, 1.0, 0.4) : vec3(1.0, 0.3, 0.2)) * (1.0 - smoothstep(0.0, 0.065, d));
  }
  col = td_tint(col, fog, vWPos.xz, fog.w.x > 0.0 ? td_mistNoise(vWPos.xz, uTime) : 0.0);
  alpha *= 1.0 - 0.95 * td_hidden(fog);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  })
}

/**
 * Wind for instanced plants: each vertex sways by its height above the plant's base, in gusts that roll across the
 * board. `sway` scales it (trees 0.07, grass and flowers more; 0 for none). Given the fog's uniforms too, a plant reads
 * texel 2 of the province at its instance's origin (through the warp, as the ground does): unseen or sunk (its ground
 * sunk to the fog floor), it scales to nothing; otherwise it takes the ground's treatment of its state (remembered and
 * wall desaturated). With the lit beacons' uniforms too, a seen plant warms near a lit beacon as the ground does
 * (warmth.ts). Its shadow needs `plantDepthMaterials`.
 */
export function windPatch(mat: THREE.Material, uniforms: { uTime: { value: number } } & Partial<FogUniforms & LitUniforms>, sway: number, key: string) {
  const fog = !!uniforms.uState
  const lit = fog && !!uniforms.uLit0
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fog ? uniforms : { uTime: uniforms.uTime })
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nvarying vec3 rr_wpos;\n${NOISE_GLSL}\n${CLOUD_GLSL}` +
          (fog ? `\nuniform vec4 uInner;\nvarying vec4 rr_fog;\n${FOG_TINT_GLSL}` : '') +
          (lit ? `\n${ASH_GLSL}\n${WARMTH_GLSL}` : ''),
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - rr_cloud(rr_wpos.xz, uTime);` +
          (fog ? `\ndiffuseColor.rgb = td_tint(diffuseColor.rgb, td_one(rr_fog), rr_wpos.xz, 0.0);` : '') +
          (lit
            ? `\n// Warmth round lit beacons (§3.7), on seen plants only (C7): the albedo here, the fire's glow with the emissive.\nfloat td_w = td_warmth(rr_wpos.xz) * td_seenShare(td_one(rr_fog));\ndiffuseColor.rgb = td_warm(diffuseColor.rgb, td_w);`
            : ''),
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>` + (lit ? `\ntotalEmissiveRadiance += td_glow(td_w);` : ''))
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nvarying vec3 rr_wpos;` + (fog ? `${FOG_UNIFORMS_GLSL}\nvarying vec4 rr_fog;\n${WARP_GLSL}\n${FOG_TEXEL_GLSL}` : ''),
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 rr_base = instanceMatrix[3].xyz;
#else
  vec3 rr_base = vec3(0.0);
#endif
  float rr_h = max(transformed.y, 0.0);
  float rr_ph = rr_base.x * 0.9 + rr_base.z * 0.6;
  float rr_gust = 0.6 + 0.4 * sin(uTime * 0.45 + rr_base.x * 0.25);
  float rr_s = (sin(uTime * 1.9 + rr_ph) * 0.65 + sin(uTime * 3.7 + rr_ph * 1.7) * 0.25) * rr_gust;
  vec2 rr_off = vec2(0.8, 0.45) * rr_s * ${sway.toFixed(3)} * pow(rr_h, 1.5);
  transformed.x += rr_off.x;
  transformed.z += rr_off.y;` +
          (fog
            ? `
  // Fog of war: the province at the instance's origin; an unseen or sunk plant (not on a wall) scales to nothing.
  rr_fog = td_fogOf(rr_hexOf((modelMatrix * vec4(rr_base, 1.0)).xz));
  if (rr_fog.a < 0.5 && rr_fog.r < 0.5) transformed *= 0.0;`
            : ''),
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
#ifdef USE_INSTANCING
  rr_wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  rr_wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      )
  }
  mat.customProgramCacheKey = () => `rr-wind2-${key}${fog ? '-fog2' : ''}${lit ? '-lit2' : ''}`
}

/**
 * Depth materials for fog-enabled plants' shadows (R16): an unseen or sunk plant scales to nothing in the shadow pass
 * as in the colour pass (`windPatch`), so hidden plants cast no shadows. No wind (a shadow's sway is too small to see).
 * One for instanced meshes and one for tinted ones, as DEPTH has.
 */
export function plantDepthMaterials(uniforms: FogUniforms): { instanced: THREE.MeshDepthMaterial; tinted: THREE.MeshDepthMaterial } {
  const make = (key: string) => {
    const mat = new THREE.MeshDepthMaterial()
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FOG_UNIFORMS_GLSL}\n${WARP_GLSL}\n${FOG_TEXEL_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec4 td_s = td_fogOf(rr_hexOf((modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz));
#else
  vec4 td_s = td_fogOf(rr_hexOf((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz));
#endif
  if (td_s.a < 0.5 && td_s.r < 0.5) transformed *= 0.0;`,
        )
    }
    mat.customProgramCacheKey = () => `td-plant-depth-fog-${key}`
    return mat
  }
  return { instanced: make('instanced'), tinted: make('tinted') }
}

/**
 * The fog of war on a plain lit material (roads): it sinks just below the fog floor as the ground under it sinks, so
 * a hidden road lies under the floor; and each fragment finds its province through the warp and takes the ground's
 * treatment of its fog, blended across the borders as on the ground (the unseen share after lighting).
 */
export function fogPatch(mat: THREE.Material, uniforms: FogUniforms, key: string) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 td_wpos;\n${SINK_VERTEX_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed.y = mix(transformed.y, ${(FOG_FLOOR - 0.03).toFixed(3)}, td_sinkAt(position, 1.0));\ntd_wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;${FOG_UNIFORMS_GLSL}\nvarying vec3 td_wpos;\n${NOISE_GLSL}\n${WARP_GLSL}\n${FOG_TINT_GLSL}\n${FOG_LOOKUP_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
TDFog td_f = td_fogAt(rr_province(td_wpos.xz, true));
diffuseColor.rgb = td_tintSeen(diffuseColor.rgb, td_f, td_wpos.xz);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, td_unseen(td_f.w.x > 0.0 ? td_mistNoise(td_wpos.xz, uTime) : 0.0), td_f.w.x / td_sum(td_f));`,
      )
  }
  mat.customProgramCacheKey = () => `td-fog2-${key}`
}

// ---------------------------------------------------------------- shadows and compiling ahead
//
// three.js compiles a shader program the first time something draws with it, and waits for the driver there: tens to
// hundreds of milliseconds per program on a phone, in the middle of a frame. The board compiles every program it will
// need before it shows anything new (Board3D.tsx): with `warmUp`, which uses KHR_parallel_shader_compile where the
// browser has it, so the driver compiles in the background while frames go on.

/**
 * The shadow pass's depth materials, one per kind of caster, given to every caster as its customDepthMaterial
 * (`castShadows`). three.js would otherwise draw every caster with one shared depth material and pick its program
 * again each time the kind of caster changes (plain, instanced, instanced with a tint) whenever the shadows redraw, and
 * a program picked there can't be compiled ahead.
 */
export const DEPTH = {
  plain: new THREE.MeshDepthMaterial(),
  instanced: new THREE.MeshDepthMaterial(),
  tinted: new THREE.MeshDepthMaterial(),
}

/** Gives every shadow caster under `root` that has none the depth material for its kind (see DEPTH). */
export function castShadows(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.castShadow || m.customDepthMaterial) return
    const inst = m as THREE.InstancedMesh
    m.customDepthMaterial = !inst.isInstancedMesh ? DEPTH.plain : inst.instanceColor ? DEPTH.tinted : DEPTH.instanced
  })
}

/**
 * Compiles the programs `root` needs (lit by `scene`'s lights) without drawing it; resolves once they are ready, so
 * the first frame that shows `root` doesn't stop to compile. `root` may be hidden or outside the scene.
 */
export function warmUp(gl: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene): Promise<unknown> {
  return gl.compileAsync(root, camera, scene)
}

let shadowTarget: THREE.WebGLRenderTarget | null = null

/**
 * Compiles depth materials as the shadow pass will draw with them: into a render target (which changes their programs:
 * no tone mapping, linear colour), with `scene`'s lights, each on a stand-in mesh of its kind and facing the side the
 * shadow pass gives it. `extra` adds casters whose depth material is their own: stand-ins drawn with that depth
 * material as their material (an InstancedMesh for an instanced caster's), turned to the shadow pass's side too.
 */
export function warmDepth(gl: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, extra: THREE.Mesh[] = []): Promise<unknown> {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3))
  const tinted = new THREE.InstancedMesh(geo, DEPTH.tinted, 1)
  tinted.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3)
  const stand = new THREE.Group()
  stand.add(new THREE.Mesh(geo, DEPTH.plain), new THREE.InstancedMesh(geo, DEPTH.instanced, 1), tinted)
  for (const m of extra) stand.add(m)
  // The shadow pass draws a caster whose own side is the front with the depth material's back.
  for (const m of [...Object.values(DEPTH), ...extra.map((e) => e.material as THREE.Material)]) m.side = THREE.BackSide
  shadowTarget ??= new THREE.WebGLRenderTarget(1, 1)
  const was = gl.getRenderTarget()
  gl.setRenderTarget(shadowTarget)
  try {
    return gl.compileAsync(stand, camera, scene)
  } finally {
    gl.setRenderTarget(was)
  }
}
