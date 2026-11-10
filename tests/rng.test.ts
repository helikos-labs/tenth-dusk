import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashSeed, int, next } from '../src/rules/rng.ts'

test('mulberry32 is deterministic and in [0,1)', () => {
  let s = hashSeed('REACH1'); const a: number[] = []
  for (let i = 0; i < 1000; i++) { const [v, n] = next(s); a.push(v); s = n }
  assert.ok(a.every((v) => v >= 0 && v < 1))
  let t = hashSeed('REACH1'); const [v0] = next(t); assert.equal(v0, a[0])
  assert.notEqual(hashSeed('REACH1'), hashSeed('REACH2'))
})
test('int stays in range', () => { let s = 7; for (let i = 0; i < 500; i++) { const [v, n] = int(s, 6); assert.ok(Number.isInteger(v) && v >= 0 && v < 6); s = n } })
