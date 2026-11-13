// The Tenth Dusk look (ART-DIRECTION §3.1-3.2): a drained ground palette, withered flowers, thinned to a third.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PALETTE } from '../src/world/palette.ts'
import { FLOWERS, HEATH_FLOWERS } from '../src/world/flora.ts'
import { buildField } from '../src/world/field.ts'
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
