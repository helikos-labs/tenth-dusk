// The Tenth Dusk look (ART-DIRECTION §3.1-3.2): a drained ground palette, withered flowers, thinned to a third.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PALETTE } from '../src/world/palette.ts'
import { FLOWERS, HEATH_FLOWERS } from '../src/world/flora.ts'
import { SQRT3, buildField, hexCenter } from '../src/world/field.ts'
import { WARM_RADIUS, WARMTH_GLSL, litPositions, warmthAt } from '../src/world/warmth.ts'
import { toAxial, unkey } from '../src/rules/hex.ts'
import { FLOWER_SHARE, LEAFY_SHARE, SNAPPED_SHARE, broadleaf, conifer, crown, deadleaf, plantsFor, reed, stem } from '../src/world/vegetation.ts'
import * as THREE from 'three'
import { GRADE_GLSL, gradeRGB, installGrade } from '../src/world/grade.ts'
import { VALLEY } from './fixtures/valley.ts'

/** HSL as the hex reads, in sRGB (three's default would read the linear working space). */
const hsl = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)

test('ground palette is drained', () => {
  const pinned = ['snow', 'snowShade', 'water', 'waterDeep', 'bed']
  for (const [k, c] of Object.entries(PALETTE)) {
    if (pinned.includes(k)) continue
    assert.ok(hsl(c).s <= 0.32, `${k} saturation ${hsl(c).s.toFixed(2)}`)
    assert.ok(c.g - Math.max(c.r, c.b) <= 0.02, `${k} reads green`)
  }
})

test('snow and water as the spec pins', () => {
  assert.equal(PALETTE.snow.getHexString(), 'cfd2d6')
  assert.equal(PALETTE.snowShade.getHexString(), '9ea6b0')
  assert.equal(PALETTE.water.getHexString(), '252f33')
  assert.equal(PALETTE.waterDeep.getHexString(), '151c20')
})

test('flowers are withered', () => {
  for (const f of [...FLOWERS, ...HEATH_FLOWERS]) {
    const { s, l } = hsl(new THREE.Color(f.color))
    assert.ok(s <= 0.45, `${f.name} saturation ${s.toFixed(2)}`)
    assert.ok(l <= 0.75, `${f.name} lightness ${l.toFixed(2)}`)
  }
})

test('flowers thinned to a third', () => {
  assert.equal(FLOWER_SHARE, 1 / 3)
  const f = buildField(VALLEY)
  const now = plantsFor(f, VALLEY, 1).flower.count
  const was = plantsFor(f, VALLEY, 1, 1).flower.count
  assert.ok(was > 0)
  assert.ok(now <= 0.4 * was, `${now} flowers against ${was}`)
})

test('reed and flower stem vertex colours are not green', () => {
  for (const [name, g] of [['reed', reed()], ['stem', stem()]] as const) {
    const a = g.getAttribute('color')
    assert.ok(a.count > 0, `${name} has vertex colours`)
    for (let i = 0; i < a.count; i++) {
      // The attribute holds three's linear working space; read it as sRGB, as the hex reads.
      const c = new THREE.Color().setRGB(a.getX(i), a.getY(i), a.getZ(i), THREE.LinearSRGBColorSpace)
      const { r, g: gr, b } = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
      assert.ok(gr - Math.max(r, b) <= 0.02, `${name} vertex ${i} reads green (${c.getHexString(THREE.SRGBColorSpace)})`)
    }
  }
})

/** Triangles of a non-indexed geometry. */
const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3
/** Each vertex colour as the hex reads (the attribute holds three's linear working space). */
const srgb = (g: THREE.BufferGeometry): THREE.Color[] => {
  const a = g.getAttribute('color')
  return Array.from({ length: a.count }, (_, i) => new THREE.Color().setRGB(a.getX(i), a.getY(i), a.getZ(i), THREE.LinearSRGBColorSpace))
}

// Measured from the green trees before the restyle (conifer 68, broadleaf 344 triangles).
const OLD_CONIFER_TRIS = 68
const OLD_BROADLEAF_TRIS = 344

test('dead trees fit the old triangle budget', () => {
  assert.ok(tris(conifer()) + tris(crown()) <= OLD_CONIFER_TRIS, `pine ${tris(conifer()) + tris(crown())}`)
  assert.ok(tris(broadleaf()) + tris(deadleaf()) <= OLD_BROADLEAF_TRIS, `broadleaf ${tris(broadleaf()) + tris(deadleaf())}`)
})

test('most broadleaves are bare', () => {
  assert.equal(LEAFY_SHARE, 0.3)
  const p = plantsFor(buildField(VALLEY), VALLEY, 1)
  assert.ok(p.oak.count > 50, `${p.oak.count} oaks`)
  const share = p.deadleaf.count / p.oak.count
  assert.ok(Math.abs(share - LEAFY_SHARE) <= 0.08, `leafy share ${share.toFixed(3)}`)
})

test('some pines are snapped', () => {
  assert.equal(SNAPPED_SHARE, 0.25)
  const p = plantsFor(buildField(VALLEY), VALLEY, 1)
  assert.ok(p.conifer.count > 50, `${p.conifer.count} pines`)
  const share = p.crown.count / p.conifer.count
  assert.ok(Math.abs(share - (1 - SNAPPED_SHARE)) <= 0.08, `crowned share ${share.toFixed(3)}`)
})

test('crown and leaves sit on their tree', () => {
  const p = plantsFor(buildField(VALLEY), VALLEY, 1)
  const has = (set: { matrix: Float32Array; color: Float32Array | null }, i: number, from: typeof set, j: number) => {
    for (let k = 0; k < 16; k++) if (set.matrix[i * 16 + k] !== from.matrix[j * 16 + k]) return false
    return true
  }
  // Every crown is some pine's matrix and colour, in the same order.
  let j = 0
  for (let i = 0; i < p.crown.count; i++) {
    while (j < p.conifer.count && !has(p.crown, i, p.conifer, j)) j++
    assert.ok(j < p.conifer.count, `crown ${i} has no pine`)
    for (let k = 0; k < 3; k++) assert.equal(p.crown.color![i * 3 + k], p.conifer.color![j * 3 + k])
    j++
  }
})

test('trees are pale and dead', () => {
  for (const [name, g] of [['pine', conifer()], ['broadleaf', broadleaf()]] as const) {
    // Only the trunk reaches the ground: its base ring is the vertices at y = 0.
    const pos = g.getAttribute('position')
    const base = srgb(g).filter((_, i) => Math.abs(pos.getY(i)) < 1e-6)
    assert.ok(base.length > 0, `${name} has a trunk base`)
    for (const c of base) {
      const { s, l } = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
      assert.ok(l >= 0.6, `${name} trunk lightness ${l.toFixed(2)}`)
      assert.ok(s <= 0.2, `${name} trunk saturation ${s.toFixed(2)}`)
    }
  }
  for (const [name, g] of [['conifer', conifer()], ['crown', crown()], ['broadleaf', broadleaf()], ['deadleaf', deadleaf()]] as const) {
    srgb(g).forEach((c, i) => {
      const { r, g: gr, b } = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
      assert.ok(gr - Math.max(r, b) <= 0.02, `${name} vertex ${i} reads green (${c.getHexString(THREE.SRGBColorSpace)})`)
    })
  }
})

test('grade installs once', () => {
  installGrade()
  installGrade()
  const chunk = THREE.ShaderChunk.tonemapping_fragment
  assert.equal(chunk.split('td_grade').length - 1, 1)
  assert.ok(GRADE_GLSL.includes('td_grade'))
})

test('grade keeps the blacks, drains saturation, leaves grey near grey', () => {
  const black = gradeRGB([0, 0, 0])
  for (const v of black) assert.ok(Math.abs(v) < 0.01, `black ${black}`)
  // HSL saturation, as the rest of this file reads colour.
  const sat = (c: number[]) => {
    const hi = Math.max(...c)
    const lo = Math.min(...c)
    return (hi - lo) / (1 - Math.abs(hi + lo - 1))
  }
  const green: [number, number, number] = [0.2, 0.6, 0.2]
  assert.ok(sat(gradeRGB(green)) <= sat(green) * 0.75, `green ${gradeRGB(green)}`)
  const grey = gradeRGB([0.5, 0.5, 0.5])
  for (const v of grey) assert.ok(Math.abs(v - 0.5) < 0.05, `grey ${grey}`)
})

/**
 * A computed index into an array (C3): `[`, then anything but a plain integer, then `]`. `vec2[6](`, `RR_DIRS[6]` and
 * `instanceMatrix[3]` pass; `x[i]`, `x[ i ]`, `dirs[(i + 5) % 6]` and `x[0 + i]` do not. Comments are stripped first.
 */
const COMPUTED_INDEX = /\[(?!\s*\d+\s*\])\s*[^\]\s][^\]]*\]/g
const computedIndices = (glsl: string) =>
  glsl
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .match(COMPUTED_INDEX) ?? []

test('the computed-index check catches what it should', () => {
  for (const bad of ['x[i]', 'x[ i ]', 'vec2 d = dirs[(i + 5) % 6];', 'x[0 + i]']) assert.ok(computedIndices(bad).length > 0, bad)
  for (const ok of ['const vec2 RR_DIRS[6] = vec2[6](vec2(1.0), vec2(0.0));', 'vec3 b = instanceMatrix[3].xyz;', 'float[]( 1.0 )', '// x[i]'])
    assert.deepEqual(computedIndices(ok), [], ok)
})

test('no computed array indices in shaders', async () => {
  const materials = await import('../src/world/materials.ts')
  const grade = await import('../src/world/grade.ts')
  const warmth = await import('../src/world/warmth.ts')
  const { makeMist } = await import('../src/world/mist.ts')
  const sources: [string, string][] = []
  for (const [file, mod] of [['materials', materials], ['grade', grade], ['warmth', warmth]] as const)
    for (const [k, v] of Object.entries(mod)) if (k.endsWith('_GLSL') && typeof v === 'string') sources.push([`${file}.${k}`, v])
  // The patched materials' shader text, as their onBeforeCompile writes it into three's chunks (only the include
  // lines stand in for three's own code).
  const chunks = ['common', 'beginnormal_vertex', 'begin_vertex', 'worldpos_vertex', 'color_fragment', 'normal_fragment_maps', 'emissivemap_fragment', 'opaque_fragment']
  const stub = chunks.map((c) => `#include <${c}>`).join('\n')
  const u = { uTime: { value: 0 }, uState: { value: null }, uLit0: { value: null } } as never
  const patched = (name: string, mat: THREE.Material) => {
    const shader = { uniforms: {}, vertexShader: stub, fragmentShader: stub } as unknown as THREE.WebGLProgramParametersWithUniforms
    mat.onBeforeCompile(shader, null as never)
    sources.push([`${name} vertex`, shader.vertexShader], [`${name} fragment`, shader.fragmentShader])
  }
  patched('terrain', materials.makeTerrainMaterial(u))
  patched('terrain depth', materials.makeTerrainDepthMaterial(u))
  const plants = materials.plantDepthMaterials(u)
  patched('plant depth', plants.instanced)
  const wind = new THREE.MeshStandardMaterial()
  materials.windPatch(wind, u, 0.1, 'test')
  patched('plants', wind)
  const road = new THREE.MeshStandardMaterial()
  materials.fogPatch(road, u, 'test')
  patched('road', road)
  for (const [name, mat] of [['water', materials.makeWaterMaterial(u)], ['mist', makeMist(u).material as THREE.ShaderMaterial]] as const)
    sources.push([`${name} vertex`, mat.vertexShader], [`${name} fragment`, mat.fragmentShader])
  assert.ok(sources.length >= 20, `${sources.length} shader sources`)
  for (const [name, src] of sources) assert.deepEqual(computedIndices(src), [], `${name} indexes an array with a computed index (C3)`)
})

test('ash and haze reuse the cloud noise, on seen ground only', async () => {
  const { ASH_GLSL, makeTerrainMaterial } = await import('../src/world/materials.ts')
  assert.match(ASH_GLSL, /float td_ash\(float cloud\)/)
  assert.match(ASH_GLSL, /vec3 td_haze\(vec3 c, vec3 wpos, float seen, float cloud\)/)
  assert.ok(!ASH_GLSL.includes('rr_snoise'), 'ash draws its own noise')
  // C7: the seen share (remembered and in sight) must pass 0.5 before ash or haze show.
  assert.match(ASH_GLSL, /smoothstep\(0\.5, 1\.0, \(f\.w\.z \+ f\.w\.w\) \/ td_sum\(f\)\)/)
  const stub = ['common', 'color_fragment', 'normal_fragment_maps', 'emissivemap_fragment', 'opaque_fragment'].map((c) => `#include <${c}>`).join('\n')
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: stub } as unknown as THREE.WebGLProgramParametersWithUniforms
  makeTerrainMaterial({} as never).onBeforeCompile(shader, null as never)
  const frag = shader.fragmentShader
  assert.equal(frag.split('rr_cloud(').length - 1, 2, 'rr_cloud: its definition and one call')
  assert.match(frag, /td_ash\(td_cl\) \* td_seen/)
  assert.match(frag, /td_haze\(gl_FragColor\.rgb, vWPos, td_seen, td_cl\)/)
  // ?perf=1's grain switch skips the cloud, not the ash and haze: they read 0 for it.
  const grain = frag.slice(frag.indexOf('#ifndef TD_OFF_GRAIN'), frag.indexOf('#endif', frag.indexOf('#ifndef TD_OFF_GRAIN')))
  assert.ok(grain.includes('rr_cl = rr_cloud(') && !grain.includes('float rr_cl') && !grain.includes('td_ash'), grain)
})

test('the Hush colour has one source', async () => {
  const { readFileSync } = await import('node:fs')
  const { DUSK, FOG_LOOK } = await import('../src/world/materials.ts')
  assert.equal(FOG_LOOK.DUSK.getHexString(), new THREE.Color(DUSK).getHexString())
  for (const f of ['src/scenes/WorldScene.tsx', 'src/scenes/models/landmarks.ts']) {
    assert.ok(!/['"]#14[0-9a-f]{4}['"]/i.test(readFileSync(f, 'utf8')), `${f} carries its own dusk literal`)
  }
})

// Warmth round lit beacons (§3.7). Offset "row,col" keys, as run.lit holds them; their cells are in the valley.
const centreOf = (k: string) => {
  const { q, r } = toAxial(unkey(k))
  assert.ok(VALLEY[`${q},${r}`], `${k} is in the valley`)
  return hexCenter(q, r)
}
const isFar = (v: THREE.Vector3) => v.x === 1e4 && v.y === 0 && v.z === 1e4
const LIT = ['5,4', '10,7', '15,3', '18,9']

test('no beacons, no warmth', () => {
  const p = litPositions([], VALLEY)
  assert.equal(p.length, 3)
  for (const v of p) assert.ok(isFar(v), `${v.toArray()}`)
})

test('two lit beacons fill the first two slots', () => {
  const p = litPositions(LIT.slice(0, 2), VALLEY)
  for (let i = 0; i < 2; i++) {
    const c = centreOf(LIT[i])
    assert.ok(Math.abs(p[i].x - c.x) < 1e-6 && Math.abs(p[i].z - c.z) < 1e-6, `slot ${i} ${p[i].toArray()} against ${c.x},${c.z}`)
  }
  assert.ok(isFar(p[2]))
})

test('four lit keeps the first three, in order', () => {
  const p = litPositions(LIT, VALLEY)
  for (let i = 0; i < 3; i++) {
    const c = centreOf(LIT[i])
    assert.ok(Math.abs(p[i].x - c.x) < 1e-6 && Math.abs(p[i].z - c.z) < 1e-6, `slot ${i}`)
  }
})

test('an unknown key leaves its slot far', () => {
  const p = litPositions(['99,99', LIT[0]], VALLEY)
  assert.ok(isFar(p[0]))
  const c = centreOf(LIT[0])
  assert.ok(Math.abs(p[1].x - c.x) < 1e-6 && Math.abs(p[1].z - c.z) < 1e-6)
  assert.ok(isFar(p[2]))
})

test('warmth falls off over about 2.5 hexes', () => {
  assert.equal(WARM_RADIUS, 2.5 * SQRT3)
  const p = litPositions([LIT[0]], VALLEY)
  const c = centreOf(LIT[0])
  assert.equal(warmthAt(c, p), 1)
  assert.ok(warmthAt({ x: c.x + 1.5 * SQRT3, z: c.z }, p) >= 0.5)
  assert.equal(warmthAt({ x: c.x + 3 * SQRT3, z: c.z }, p), 0)
  assert.equal(warmthAt(c, litPositions([], VALLEY)), 0)
  // The nearest beacon wins (the maximum, not the sum).
  const two = litPositions([LIT[0], LIT[0]], VALLEY)
  assert.equal(warmthAt({ x: c.x + 1.5 * SQRT3, z: c.z }, two), warmthAt({ x: c.x + 1.5 * SQRT3, z: c.z }, p))
})

test('the warmth GLSL mirrors warmthAt, three beacons written out', () => {
  assert.match(WARMTH_GLSL, /float td_warmth\(vec2 xz\)/)
  for (const u of ['uLit0', 'uLit1', 'uLit2']) assert.match(WARMTH_GLSL, new RegExp(`uniform vec3 ${u};`))
  assert.ok(WARMTH_GLSL.includes(WARM_RADIUS.toFixed(4)), 'the radius is WARM_RADIUS')
  assert.ok(WARMTH_GLSL.includes('mix(vec3(1.0), vec3(1.08, 1.0, 0.9), w)'), 'the warm tint')
  assert.ok(WARMTH_GLSL.includes('1.0 + 0.6 * w'), 'the restored saturation')
})

test('ground and plants warm only where seen (C7)', async () => {
  const { makeTerrainMaterial, windPatch } = await import('../src/world/materials.ts')
  const stub = ['common', 'color_fragment', 'normal_fragment_maps', 'emissivemap_fragment', 'opaque_fragment'].map((c) => `#include <${c}>`).join('\n')
  const lit = { uLit0: { value: new THREE.Vector3() }, uLit1: { value: new THREE.Vector3() }, uLit2: { value: new THREE.Vector3() } }
  const terrain = { uniforms: {}, vertexShader: '', fragmentShader: stub } as unknown as THREE.WebGLProgramParametersWithUniforms
  makeTerrainMaterial(lit as never).onBeforeCompile(terrain, null as never)
  for (const u of Object.keys(lit)) assert.ok(u in terrain.uniforms, `terrain has ${u}`)
  const frag = terrain.fragmentShader
  const unseen = frag.indexOf('td_unseen(rr_fog.w.x')
  const warm = frag.indexOf('td_warm(gl_FragColor.rgb, td_warmth(vWPos.xz) * td_seen)')
  assert.ok(unseen > 0 && warm > unseen, 'the ground warms after the unseen tint, by its seen share')
  const plants = { uniforms: {}, vertexShader: stub, fragmentShader: stub } as unknown as THREE.WebGLProgramParametersWithUniforms
  const mat = new THREE.MeshStandardMaterial()
  windPatch(mat, { uTime: { value: 0 }, uState: { value: null }, ...lit } as never, 0.1, 'test')
  mat.onBeforeCompile(plants, null as never)
  for (const u of Object.keys(lit)) assert.ok(u in plants.uniforms, `plants have ${u}`)
  const pf = plants.fragmentShader
  const tint = pf.indexOf('td_tint(diffuseColor.rgb')
  const pw = pf.indexOf('td_warm(diffuseColor.rgb, td_warmth(rr_wpos.xz) * td_seenShare(td_one(rr_fog)))')
  assert.ok(tint > 0 && pw > tint, 'plants warm after their fog tint, by their seen share')
})
