// The world follows the zone: bounds round the zone and its wall ring, a lattice in budget over them (§15.3, §15.6),
// and no sea inside the zone.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAPTER1 } from '../src/data/book1.ts'
import { generateZone } from '../src/rules/gen.ts'
import { zoneToWorld } from '../src/world/adapter.ts'
import { buildField, hexCenter } from '../src/world/field.ts'
import { LATTICE, latticeFor } from '../src/world/terrainMesh.ts'

const world = () => zoneToWorld(generateZone(CHAPTER1, 'REACH1'))

test('bounds wrap the zone and its wall ring', () => {
  const f = buildField(world())
  assert.ok(f.bounds.inner.maxX - f.bounds.inner.minX > 9 * Math.sqrt(3) - 1)
  assert.ok(f.bounds.maxZ - f.bounds.minZ > (17 + 8) * 1.5 - 1)
})

test('lattice stays in budget: ≤ 46k vertices at detail 1, ≤ 26k at 0.75 (§15.6)', () => {
  const b = buildField(world()).bounds
  // The brief's `pts.length / 2` is the vertex count; a Lattice keeps its points as x and z arrays.
  assert.ok(latticeFor(1, b).x.length <= 46_000)
  assert.ok(latticeFor(0.75, b).x.length <= 26_000)
})

test('no sea inside the zone: every non-wall cell centre is land or its own water terrain', () => {
  const w = world()
  const f = buildField(w)
  let n = 0
  for (const c of Object.values(w)) {
    if (c.wall) continue
    const p = hexCenter(c.q, c.r)
    assert.equal(f.probe(p.x, p.z).ground, c.terrain, `cell ${c.q},${c.r}`)
    n++
  }
  assert.equal(n, 17 * 9)
})

test('the lattice is one sheet over the rounded outline: faces up, no overlaps, 2.5× coarser in the wall ring (§15.3)', () => {
  const b = buildField(world()).bounds
  const L = latticeFor(1, b)
  let area = 0
  const fine: number[] = []
  const coarse: number[] = []
  const g = LATTICE.FINE_MARGIN + 1
  for (let t = 0; t < L.tris.length; t += 3) {
    const [p, q, r] = [L.tris[t], L.tris[t + 1], L.tris[t + 2]]
    const a = ((L.x[r] - L.x[q]) * (L.z[p] - L.z[q]) - (L.z[r] - L.z[q]) * (L.x[p] - L.x[q])) / -2
    assert.ok(a > 0, `triangle ${t / 3} faces down or is flat`)
    area += a
    const edge = Math.hypot(L.x[p] - L.x[q], L.z[p] - L.z[q])
    const xs = [L.x[p], L.x[q], L.x[r]]
    const zs = [L.z[p], L.z[q], L.z[r]]
    const inside = xs.every((x) => x > b.inner.minX && x < b.inner.maxX) && zs.every((z) => z > b.inner.minZ && z < b.inner.maxZ)
    const outside = xs.every((x) => x < b.inner.minX - g || x > b.inner.maxX + g) || zs.every((z) => z < b.inner.minZ - g || z > b.inner.maxZ + g)
    if (inside) fine.push(edge)
    else if (outside) coarse.push(edge)
  }
  // The rounded rectangle round the bounds; the lattice's ragged edge falls short of it by under a coarse step.
  const m = LATTICE.OUTER_MARGIN
  const k = LATTICE.CORNER
  const outline = (b.maxX - b.minX + 2 * m) * (b.maxZ - b.minZ + 2 * m) - (4 - Math.PI) * k * k
  assert.ok(area <= outline && area > outline * 0.97, `the triangles cover ${area.toFixed(1)} of ${outline.toFixed(1)}`)
  const median = (v: number[]) => v.sort((p, q) => p - q)[Math.floor(v.length / 2)]
  const ratio = median(coarse) / median(fine)
  assert.ok(Math.abs(ratio - LATTICE.COARSE) < 0.05, `the wall ring's step is ${ratio.toFixed(2)}× the zone's`)
})
