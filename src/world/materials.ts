// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/materials.ts, adapted for Tenth Dusk.
// Shader work for the 3D board. The terrain is a MeshStandardMaterial (so it lights and takes shadows like everything
// else) patched to draw target and hover rims and pulsing Blight veins, read per province from a small state texture.
// Water has its own material: moving ripples, depth colour, shore foam and a sun glint. `windPatch` sways instanced
// plants.
//
// ORGANIC CONCEPT: no grid lines. Each pixel finds its province the way field.ts does, by warping its world position
// (field.ts `warp`, baked once into a displacement texture) and taking the hex under the warped point; rims then follow
// the province's meandering border, and a faint ink line marks each border between two land provinces,
// so provinces can be counted while the island still reads as one landscape.
import * as THREE from 'three'
import { makeWarp } from './field.ts'

/** Texels per hex in the state texture. */
export const TEXELS = 2

/** The state texture holds a fixed grid of axial coordinates, |q|, |r| <= SLOT_OFFSET, so a shader can find any hex. */
const SLOT_OFFSET = 7
const SLOT_WIDTH = 2 * SLOT_OFFSET + 1
export const SLOTS = SLOT_WIDTH * SLOT_WIDTH
export const slotOf = (q: number, r: number) => (r + SLOT_OFFSET) * SLOT_WIDTH + (q + SLOT_OFFSET)

/**
 * Per-hex state, two RGBA texels per hex slot:
 *   texel 0: r = target hint, g = hover (0.5 illegal, 1 legal), b and a unused (0)
 *   texel 1: r unused (0), g = landmark, b = selected, a = (terrain id + 1) / 8 (0: no hex, the sea)
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

/** The warp texture covers world x and z in [-WARP_EXTENT, WARP_EXTENT] (the whole tray) at WARP_TEXELS a side. */
const WARP_EXTENT = 10
export const WARP_TEXELS = 320
/** Warp textures by seed, the latest last; a few worlds' worth (a new game brings a new seed), the oldest freed. */
const warpTextures = new Map<number, THREE.DataTexture>()
const WARP_KEPT = 3

/**
 * One world's warp (field.ts `makeWarp(seed)`) as displacements on a grid over the tray: x then z per texel, half
 * floats. No three.js objects but the half-float maths, so the world worker bakes it with the world's first build
 * (worldBuild.ts) and the main thread only wraps it (`makeWarpTexture`).
 */
export function warpData(seed: number): Uint16Array {
  const warp = makeWarp(seed)
  const n = WARP_TEXELS
  const data = new Uint16Array(n * n * 2)
  const step = (2 * WARP_EXTENT) / n
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -WARP_EXTENT + (i + 0.5) * step
      const z = -WARP_EXTENT + (j + 0.5) * step
      const w = warp(x, z)
      data[(j * n + i) * 2] = THREE.DataUtils.toHalfFloat(w.x - x)
      data[(j * n + i) * 2 + 1] = THREE.DataUtils.toHalfFloat(w.z - z)
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
export function makeWarpTexture(seed: number, data?: Uint16Array): THREE.DataTexture {
  const cached = warpTextures.get(seed)
  if (cached) {
    warpTextures.delete(seed)
    warpTextures.set(seed, cached)
    return cached
  }
  const n = WARP_TEXELS
  const tex = new THREE.DataTexture(data && data.length === n * n * 2 ? data : warpData(seed), n, n, THREE.RGFormat, THREE.HalfFloatType)
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

/**
 * The province lookup, in GLSL: the warp (from the warp texture) and field.ts's `hexAt`, then the hex's slot in the state
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
 * `uBoardR` is the board's radius in hexes.
 */
const WARP_GLSL = /* glsl */ `
// The warp's displacement at a world point (the point's province is the hex under p + rr_disp(p)).
vec2 rr_disp(vec2 p) {
  return texture2D(uWarp, (p + ${WARP_EXTENT}.0) / ${2 * WARP_EXTENT}.0).rg;
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
float rr_hexDist(vec2 h) { return max(max(abs(h.x), abs(h.y)), abs(h.x + h.y)); }
bool rr_on(vec2 h) { return rr_hexDist(h) <= uBoardR + 0.5; }
float rr_slotOf(vec2 h) {
  return (abs(h.x) > ${SLOT_OFFSET}.0 || abs(h.y) > ${SLOT_OFFSET}.0) ? -1.0 : (h.y + ${SLOT_OFFSET}.0) * ${SLOT_WIDTH}.0 + (h.x + ${SLOT_OFFSET}.0);
}
// A Water province: terrain id 3, stored as 4 / 8 in texel 1's alpha (makeStateTexture).
bool rr_lake(vec2 h) {
  float slot = rr_slotOf(h);
  if (slot < 0.0) return false;
  return abs(texture2D(uState, vec2((slot * ${TEXELS}.0 + 1.5) / uStateSize, 0.5)).a - 0.5) < 0.06;
}
struct RRProv { float slot; vec2 local; float lake; float d; float ink; float edge; };
RRProv rr_province(vec2 world, bool land) {
  RRProv P = RRProv(-1.0, vec2(0.0), 0.0, 9.0, 9.0, 9.0);
  vec2 dsp = rr_disp(world);
  vec2 w = world + dsp;
  vec2 h = rr_hexRound(w);
  bool off = !rr_on(h);
  if (off) {
    if (!land) return P;
    // The rim province whose outer edge the ray from the centre leaves through (field.ts toRim).
    float qf = 0.57735027 * w.x - w.y / 3.0;
    float rf = w.y * (2.0 / 3.0);
    float m = max(max(abs(qf), abs(rf)), abs(qf + rf));
    float lo = min(1.0, (uBoardR - 0.01) / max(m, 1e-6));
    float hi = 1.0;
    for (int i = 0; i < 10; i++) {
      float mid = 0.5 * (lo + hi);
      if (rr_on(rr_hexRound(w * mid))) lo = mid;
      else hi = mid;
    }
    h = rr_hexRound(w * lo);
  }
  // How the warp stretches a distance across a line with normal n (warped space): |J^T n|.
  vec2 jx = vec2(1.0, 0.0) + (rr_disp(world + vec2(0.04, 0.0)) - dsp) * 25.0;
  vec2 jz = vec2(0.0, 1.0) + (rr_disp(world + vec2(0.0, 0.04)) - dsp) * 25.0;
  vec2 ctr = vec2(1.7320508 * (h.x + h.y * 0.5), 1.5 * h.y);
  P.slot = rr_slotOf(h);
  P.local = w - ctr;
  P.lake = rr_lake(h) ? 1.0 : 0.0;
  // Edge i faces neighbour EDGE_DIR[i]; its outward normal points at 60 * i - 60 degrees; corner i starts it.
  vec2 dirs[6] = vec2[6](vec2(1.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-1.0, 1.0), vec2(-1.0, 0.0), vec2(0.0, -1.0));
  vec2 norms[6] = vec2[6](vec2(0.5, -0.8660254), vec2(1.0, 0.0), vec2(0.5, 0.8660254), vec2(-0.5, 0.8660254), vec2(-1.0, 0.0), vec2(-0.5, -0.8660254));
  vec2 corners[6] = vec2[6](vec2(0.0, -1.0), vec2(0.8660254, -0.5), vec2(0.8660254, 0.5), vec2(0.0, 1.0), vec2(-0.8660254, 0.5), vec2(-0.8660254, -0.5));
  bool rim = false;
  for (int i = 0; i < 6; i++) {
    vec2 n = norms[i];
    float dw = (0.8660254 - dot(P.local, n)) / max(length(vec2(dot(n, jx), dot(n, jz))), 0.25);
    if (!rr_on(h + dirs[i])) {
      rim = true;
      if (!off) P.edge = min(P.edge, dw);
      continue;
    }
    if (off) continue;
    P.d = min(P.d, dw);
    // A border with a lake is a shore, not an ink line; it counts as 0.3 away, so the distance stays continuous.
    P.ink = min(P.ink, dw < 0.3 && (P.lake > 0.5 || rr_lake(h + dirs[i])) ? 0.3 : dw);
  }
  if (rim) {
    // Corner i is an inner corner of the outline when one of its two edges is shared and the other is not; beyond it
    // the border with that neighbour is the ray from the board's centre (the part from the corner outwards).
    for (int i = 0; i < 6; i++) {
      bool a = rr_on(h + dirs[(i + 5) % 6]);
      if (a == rr_on(h + dirs[i])) continue;
      vec2 v = ctr + corners[i];
      vec2 dir = normalize(v);
      vec2 perp = vec2(-dir.y, dir.x);
      float dr = dot(w, dir) > length(v) ? abs(dot(w, perp)) : length(w - v);
      float dw = dr / max(length(vec2(dot(perp, jx), dot(perp, jz))), 0.25);
      P.d = min(P.d, dw);
      P.ink = min(P.ink, dw < 0.3 && (P.lake > 0.5 || rr_lake(h + (a ? dirs[(i + 5) % 6] : dirs[i]))) ? 0.3 : dw);
    }
  }
  return P;
}
`

export interface TerrainUniforms {
  uTime: { value: number }
  uState: { value: THREE.DataTexture }
  uStateSize: { value: number }
  uHint: { value: THREE.Color }
  uBoardR: { value: number }
  uWarp: { value: THREE.DataTexture }
  /** Direction towards the sun (world space, normalised): snow in its shade turns blue. */
  uSun: { value: THREE.Vector3 }
}

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
varying float vCoast;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRock = aRock;
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
uniform float uBoardR;
uniform sampler2D uWarp;
uniform vec3 uSun;
varying vec3 vWPos;
varying float vRock;
varying float vCoast;
${NOISE_GLSL}
${CLOUD_GLSL}
${WARP_GLSL}
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
bool rr_blight = abs(rr_s1.a - 0.625) < 0.06;
// A target province takes a faint wash of the hint, inside its whole outline.
if (rr_s0.r > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, uHint, 0.12 * (1.0 - smoothstep(0.0, 0.5, rr_rim)));
diffuseColor.rgb *= 1.0 - rr_cloud(vWPos.xz, uTime);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
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
float rr_snow = smoothstep(0.38, 0.6, min(min(vColor.r, vColor.g), vColor.b));
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
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Pulsing Blight veins.
if (rr_blight) {
  float n = 1.0 - abs(rr_snoise(vWPos.xz * 1.7 + vec2(uTime * 0.03, -uTime * 0.02)));
  float n2 = 1.0 - abs(rr_snoise(vWPos.xz * 4.1 - vec2(uTime * 0.05, 0.0)));
  float vein = smoothstep(0.965, 0.997, n) + 0.3 * smoothstep(0.972, 0.997, n2);
  float pulse = 0.45 + 0.55 * sin(uTime * 2.2 + vWPos.x * 1.7 + vWPos.z);
  totalEmissiveRadiance += vec3(0.85, 0.15, 0.78) * vein * pulse * 0.6;
}
// Target hint: a gilt rim that breathes. Hover: green for legal, red for not. Both run round the whole outline, along
// the coast too where a rim province meets the sea.
if (rr_s0.r > 0.5) {
  float pulse = 0.6 + 0.4 * sin(uTime * 3.4);
  float rim = 1.0 - smoothstep(0.0, 0.10, rr_rim);
  totalEmissiveRadiance += uHint * (rim * pulse * 1.15 + 0.10 * (1.0 - smoothstep(0.0, 0.45, rr_rim)));
}
if (rr_s0.g > 0.25) {
  vec3 hc = rr_s0.g > 0.75 ? vec3(0.45, 1.0, 0.4) : vec3(1.0, 0.3, 0.2);
  totalEmissiveRadiance += hc * (1.0 - smoothstep(0.0, 0.065, rr_rim)) * 1.1;
}`,
      )
  }
  mat.customProgramCacheKey = () => 'rr-terrain-organic-3'
  return mat
}

export interface WaterUniforms {
  uTime: { value: number }
  uState: { value: THREE.DataTexture }
  uStateSize: { value: number }
  uHint: { value: THREE.Color }
  uSun: { value: THREE.Vector3 }
  uBoardR: { value: number }
  uWarp: { value: THREE.DataTexture }
}

export function makeWaterMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
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
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform sampler2D uState;
uniform float uStateSize;
uniform vec3 uHint;
uniform vec3 uSun;
uniform float uBoardR;
uniform sampler2D uWarp;
varying vec3 vWPos;
varying float vDepth;
${NOISE_GLSL}
${WARP_GLSL}
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
  vec3 shallow = vec3(0.24, 0.55, 0.58);
  vec3 deepc = vec3(0.05, 0.19, 0.30);
  vec3 col = mix(shallow, deepc, deep);
  vec3 sky = vec3(0.70, 0.82, 0.92);
  col = mix(col, sky, fres * 0.65);
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(uSun)), 0.0), 180.0) * 2.4 + pow(max(dot(r, normalize(uSun)), 0.0), 18.0) * 0.12;
  col += vec3(1.0, 0.95, 0.85) * spec;
  // Foam along the shore, broken up by noise.
  float foam = (1.0 - smoothstep(0.0, 0.035, vDepth)) * smoothstep(-0.2, 0.6, rr_snoise(vWPos.xz * 9.0 + uTime * 0.4));
  col = mix(col, vec3(0.93, 0.96, 0.95), foam * 0.75);
  float alpha = mix(0.5, 0.93, deep) + foam * 0.3;
  // A lake's markers, as on land, along its meandering border; a lake that opens into the sea is closed off where the
  // board ends. A land province stops at its coast, so the sea carries none of its marks.
  RRProv prov = rr_province(vWPos.xz, false);
  if (prov.slot >= 0.0 && prov.lake > 0.5) {
    float d = min(prov.d, prov.edge);
    vec4 s0 = texture2D(uState, vec2((prov.slot * ${TEXELS}.0 + 0.5) / uStateSize, 0.5));
    if (s0.r > 0.5) col += uHint * (1.0 - smoothstep(0.0, 0.1, d)) * (0.6 + 0.4 * sin(uTime * 3.4)) * 1.1;
    if (s0.g > 0.25) col += (s0.g > 0.75 ? vec3(0.45, 1.0, 0.4) : vec3(1.0, 0.3, 0.2)) * (1.0 - smoothstep(0.0, 0.065, d));
  }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  })
}

/**
 * Wind for instanced plants: each vertex sways by its height above the plant's base, in gusts that roll across the
 * board. `stiffness` scales the sway (trees 1, grass and flowers more).
 */
export function windPatch(mat: THREE.Material, uniforms: { uTime: { value: number } }, sway: number, key: string) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 rr_wpos;\n${NOISE_GLSL}\n${CLOUD_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - rr_cloud(rr_wpos.xz, uTime);`)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 rr_wpos;`)
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
  transformed.z += rr_off.y;`,
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
  mat.customProgramCacheKey = () => `rr-wind2-${key}`
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
 * shadow pass gives it. `extra` adds a caster whose depth material is its own (its geometry and depth material).
 */
export function warmDepth(gl: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, extra: [THREE.BufferGeometry, THREE.Material][] = []): Promise<unknown> {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3))
  const tinted = new THREE.InstancedMesh(geo, DEPTH.tinted, 1)
  tinted.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3)
  const stand = new THREE.Group()
  stand.add(new THREE.Mesh(geo, DEPTH.plain), new THREE.InstancedMesh(geo, DEPTH.instanced, 1), tinted)
  for (const [g, m] of extra) stand.add(new THREE.Mesh(g, m))
  // The shadow pass draws a caster whose own side is the front with the depth material's back.
  for (const m of Object.values(DEPTH)) m.side = THREE.BackSide
  shadowTarget ??= new THREE.WebGLRenderTarget(1, 1)
  const was = gl.getRenderTarget()
  gl.setRenderTarget(shadowTarget)
  try {
    return gl.compileAsync(stand, camera, scene)
  } finally {
    gl.setRenderTarget(was)
  }
}
