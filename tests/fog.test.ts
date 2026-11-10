// Fog of war in the state texture (§15.4): texel 2 of each hex slot carries its fog state, wall flag and highlight,
// and the slot grid covers Book I chapter 1 with its wall ring.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAPTER1 } from '../src/data/book1.ts'
import { generateZone } from '../src/rules/gen.ts'
import type { Fog } from '../src/rules/sight.ts'
import { zoneToWorld } from '../src/world/adapter.ts'
import { fogByte, writeFog } from '../src/world/fog.ts'
import { SLOTS, TEXELS, makeStateTexture, slotOf } from '../src/world/materials.ts'

test('fogByte encodes the four states and walls', () => {
  assert.deepEqual(fogByte(0, false), [0, 0, 0, 0])
  assert.deepEqual(fogByte(3, false), [255, 0, 0, 0])
  assert.deepEqual(fogByte(2, true), [170, 0, 0, 255])
  assert.equal(fogByte(1, false)[0], 85)
})

test('writeFog writes texel 2 of each slot only', () => {
  assert.equal(TEXELS, 3)
  const tex = makeStateTexture(4)
  const data = tex.image.data as Uint8Array
  // Texels 0 and 1 of every slot hold something writeFog must leave alone.
  for (let slot = 0; slot < 4; slot++) for (let i = 0; i < 8; i++) data[slot * TEXELS * 4 + i] = 7 + i
  const before = data.slice()
  const version = tex.version
  // Slots by world key "q,r" (R5): offset (0,0) → '0,0', offset (0,1) → '1,0', and an odd row, offset (1,0) → '1,-1'.
  const slots = new Map([
    ['0,0', 0],
    ['1,0', 1],
    ['1,-1', 2],
  ])
  const fog = new Map<string, Fog>([
    ['0,0', 3],
    ['1,0', 2],
  ])
  writeFog(tex, slots, fog, new Set(['0,1']), new Set(['0,0']))
  /** Texel 2 of a slot, its four bytes. */
  const texel2 = (slot: number) => [...data.subarray((slot * 3 + 2) * 4, (slot * 3 + 3) * 4)]
  assert.deepEqual(texel2(0), [255, 0, 255, 0], 'offset (0,0): in sight, highlighted, no wall')
  assert.deepEqual(texel2(1), [0, 0, 0, 255], 'offset (0,1): unseen wall')
  assert.deepEqual(texel2(2), [170, 0, 0, 0], 'offset (1,0): remembered')
  for (let slot = 0; slot < 4; slot++)
    for (let i = 0; i < 8; i++) assert.equal(data[slot * TEXELS * 4 + i], before[slot * TEXELS * 4 + i], `slot ${slot} texel ${i >> 2} unchanged`)
  assert.deepEqual(texel2(3), [0, 0, 0, 0], 'slot 3 not written')
  assert.ok(tex.version > version, 'needsUpdate set')
})

test('slot grid covers Book I chapter 1 with its wall ring', () => {
  const world = zoneToWorld(generateZone(CHAPTER1, 'REACH1'))
  const keys = Object.keys(world)
  assert.equal(keys.length, (CHAPTER1.rows + 2 * CHAPTER1.wallDepth) * (CHAPTER1.cols + 2 * CHAPTER1.wallDepth))
  const seen = new Set<number>()
  for (const k of keys) {
    const { q, r } = world[k]
    const s = slotOf(q, r)
    assert.ok(Number.isInteger(s) && s >= 0 && s < SLOTS, `${k} has slot ${s} of ${SLOTS}`)
    assert.ok(!seen.has(s), `${k} shares slot ${s}`)
    seen.add(s)
  }
})
