// The Tenth Dusk look (ART-DIRECTION §3.1-3.2): a drained ground palette, withered flowers, thinned to a third.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PALETTE } from '../src/world/palette.ts'
import { FLOWERS, HEATH_FLOWERS } from '../src/world/flora.ts'
import { buildField } from '../src/world/field.ts'
import { FLOWER_SHARE, plantsFor, reed, stem } from '../src/world/vegetation.ts'
import * as THREE from 'three'
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
