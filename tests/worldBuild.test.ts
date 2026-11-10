// Ported from helikos-labs/rift-and-root@7f00e23 tests/worldBuild.test.ts, against the VALLEY fixture.
// The world builder (src/world/worldBuild.ts), which the world worker runs: after hexes change terrain or a Landmark
// comes or goes, its update must equal a full rebuild of the new board (the mesh to float precision, the plants
// exactly) while redoing only what the change can reach; a terrain appearing rebuilds in full; and the main thread's
// client (worldClient.ts) and appliers (terrainMesh.ts, vegetation.ts) must show only the latest board.
//
// Until the lattice follows the zone's bounds (it is still a disc round the origin), the mesh covers only the valley's
// south-west corner, so the inland changes are taken nearest the origin, where they reach the ground.
import assert from 'node:assert/strict'
import test from 'node:test'
import type * as THREE from 'three'
import type { Terrain, WorldCell } from '../src/world/adapter.ts'
import { EDGE_DIR, hexCenter } from '../src/world/field.ts'
import { WARP_TEXELS, hasWarpTexture, makeWarpTexture } from '../src/world/materials.ts'
import { applyTerrain } from '../src/world/terrainMesh.ts'
import { PLANT_KINDS, PlantMeshes } from '../src/world/vegetation.ts'
import { WorldBuilder, mergeUpdates, type WorldUpdate } from '../src/world/worldBuild.ts'
import { WorldClient } from '../src/world/worldClient.ts'
import { VALLEY } from './fixtures/valley.ts'

/** A coarse mesh keeps the tests quick; the reach of a change doesn't depend on the mesh. */
const DETAIL = 0.5

type Board = Record<string, WorldCell>
const key = (c: WorldCell) => `${c.q},${c.r}`
/** True if the hex is on the board's outline (a neighbour is missing). */
const onRim = (b: Board, c: WorldCell) => EDGE_DIR.some((d) => !b[`${c.q + d.q},${c.r + d.r}`])
/** How far the hex's centre lies from the origin, where the mesh is. */
const fromOrigin = (c: WorldCell) => {
  const p = hexCenter(c.q, c.r)
  return Math.hypot(p.x, p.z)
}
const withTerrain = (b: Board, c: WorldCell, terrain: Terrain): Board => ({ ...b, [key(c)]: { ...b[key(c)], terrain } })
const withLandmark = (b: Board, c: WorldCell): Board => ({ ...b, [key(c)]: { ...b[key(c)], landmark: 'hamlet' } })
const without = (b: Board, c: WorldCell): Board => ({ ...b, [key(c)]: { ...b[key(c)], landmark: undefined } })
/** Land that can change terrain, in reading order. */
const land = (b: Board) =>
  Object.values(b)
    .filter((c) => c.terrain !== 'water' && c.terrain !== 'mountain')
    .sort((a, z) => a.r - z.r || a.q - z.q)
/** Land off the outline, nearest the origin first. */
const inlandOf = (b: Board) =>
  land(b)
    .filter((c) => !onRim(b, c))
    .sort((a, z) => fromOrigin(a) - fromOrigin(z))
const next: Record<string, Terrain> = { grassland: 'forest', forest: 'blight', blight: 'grassland' }

/** The world the main thread shows after `shown` equals a full build of the same board. */
function assertSameWorld(shown: WorldUpdate, full: WorldUpdate, what: string) {
  const a = shown.terrain!.arrays
  const b = full.terrain!.arrays
  for (const k of ['position', 'normal', 'color', 'rock', 'coast', 'depth'] as const) {
    const x = a[k]!
    const y = b[k]!
    assert.equal(x.length, y.length, `${what}: ${k}`)
    let worst = 0
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]))
    assert.ok(worst < 1e-6, `${what}: ${k} differs from a full rebuild by ${worst}`)
  }
  assert.deepEqual(a.waterIndex, b.waterIndex, `${what}: the water's triangles`)
  for (const k of PLANT_KINDS) {
    assert.deepEqual(shown.plants![k].matrix, full.plants![k].matrix, `${what}: ${k} plants`)
    assert.deepEqual(shown.plants![k].color, full.plants![k].color, `${what}: ${k} tints`)
  }
}

/** A board with every changeable terrain on it, so a flip moves borders without a terrain appearing or vanishing. */
function mixed(): Board {
  const b = VALLEY
  const l = land(b)
  return withTerrain(withTerrain(b, l[Math.floor(l.length / 2)], 'blight'), l[2], 'forest')
}

test('updates after flips, on the rim and inland, and new Landmarks equal a full rebuild', () => {
  for (const detail of [DETAIL, 0.75]) {
    let board = mixed()
    const live = new WorldBuilder(detail)
    let shown = live.build(board)
    const rim = land(board).filter((c) => onRim(board, c))
    const inland = inlandOf(board)
    const steps = detail === DETAIL ? [rim[0], inland[3], rim[0], inland[10], inland[11], rim[0]] : [inland[6], rim[0]]
    steps.forEach((c, i) => {
      board = withTerrain(board, c, next[board[key(c)].terrain])
      // A Landmark comes, then goes, on another province.
      if (i === 1) board = withLandmark(board, inland[0])
      if (i === 3) board = without(board, inland[0])
      const u = live.build(board)
      assert.equal(u.full, false, `VALLEY: step ${i} needed no full build`)
      shown = mergeUpdates(shown, u)
      assertSameWorld(shown, new WorldBuilder(detail).build(board), `VALLEY at ${detail} step ${i} (${key(c)})`)
    })
  }
})

test('beside a lake that opens into the sea, updates still equal a full rebuild', () => {
  // A rim lake's basin runs on into the sea (field.ts), and its shore meets the coast: flip the land round one.
  let board = mixed()
  const near = (a: WorldCell, c: WorldCell) => Math.abs(a.q - c.q) + Math.abs(a.r - c.r) + Math.abs(a.q + a.r - c.q - c.r) === 2
  const lake = Object.values(board).find((c) => c.terrain === 'water' && onRim(board, c) && land(board).some((n) => near(n, c))) ?? null
  assert.ok(lake, 'no rim lake beside open land')
  const live = new WorldBuilder(DETAIL)
  let shown = live.build(board)
  const beside = land(board).filter((n) => near(n, lake))
  for (const c of beside.slice(0, 3)) {
    board = withTerrain(board, c, next[board[key(c)].terrain])
    const u = live.build(board)
    assert.equal(u.full, false)
    shown = mergeUpdates(shown, u)
    assertSameWorld(shown, new WorldBuilder(DETAIL).build(board), `beside the rim lake ${key(lake)}: ${key(c)}`)
  }
})

test('an update redoes only the ground and provinces a change can reach', () => {
  const board = mixed()
  const live = new WorldBuilder(DETAIL)
  const all = live.build(board).stats.verts
  const c = inlandOf(board)[0]
  const flip = live.build(withTerrain(board, c, c.terrain === 'grassland' ? 'forest' : 'grassland'))
  assert.ok(flip.stats.probed > 0 && flip.stats.probed < all * 0.15, `probed ${flip.stats.probed} of ${all}`)
  // The hex, its 6 neighbours and the 6 two steps away on a diagonal (whose corners just touch the reach).
  assert.ok(flip.stats.provinces <= 13, `${flip.stats.provinces} provinces planted again`)
  assert.ok(flip.terrain && flip.plants)
  // A Landmark changes one clearing: one province's plants, no ground.
  const marked = withLandmark(withTerrain(board, c, c.terrain === 'grassland' ? 'forest' : 'grassland'), land(board)[5])
  const built = live.build(marked)
  assert.equal(built.terrain, undefined)
  assert.equal(built.stats.provinces, 1)
  // Nothing the world shows changed (the hero moved, say): nothing to send.
  const same = live.build({ ...marked })
  assert.equal(same.terrain, undefined)
  assert.equal(same.plants, undefined)
})

test('a terrain appearing on the board or vanishing from it rebuilds the world in full', () => {
  const board = VALLEY
  const live = new WorldBuilder(DETAIL)
  live.build(board)
  const c = land(board).find((x) => x.terrain !== 'blight')!
  assert.ok(!Object.values(board).some((x) => x.terrain === 'blight'), 'the world starts without Blight')
  const blighted = withTerrain(board, c, 'blight')
  assert.equal(live.build(blighted).full, true, 'the first Blight')
  assert.equal(live.build(withTerrain(blighted, c, 'grassland')).full, true, 'the last Blight gone')
})

test('without workers the client builds on this thread, one board at a time, and shows only the latest', async () => {
  const b0 = mixed()
  const l = land(b0)
  const b1 = withTerrain(b0, l[4], next[l[4].terrain])
  const b2 = withTerrain(b1, l[9], next[l[9].terrain])
  const client = new WorldClient()
  const got: WorldUpdate[] = []
  const settle = async (n: number) => {
    for (let i = 0; i < 400 && got.length < n; i++) await new Promise((r) => setTimeout(r, 25))
    await new Promise((r) => setTimeout(r, 50))
  }
  client.start(DETAIL)
  // The first board builds before anyone listens; the second waits and is overtaken by the third, so it is never
  // built, and the first result is held back and folded into the third's, which waits for the listener.
  client.send(b0)
  client.send(b1)
  client.send(b2)
  await settle(1)
  assert.equal(got.length, 0)
  client.listen((u) => got.push(u))
  assert.equal(got.length, 1)
  assert.equal(got[0].full, true)
  assertSameWorld(got[0], new WorldBuilder(DETAIL).build(b2), 'client')
  // A scene that listens anew (mounted again) gets the world in full.
  client.listen((u) => got.push(u))
  await settle(2)
  client.close()
  assert.equal(got.length, 2)
  assert.equal(got[1].full, true)
})

test('a scene that listens anew gets the world in full, even while an update for the last scene waits', async () => {
  const b0 = mixed()
  const l = land(b0)
  const b1 = withTerrain(b0, l[4], next[l[4].terrain])
  const client = new WorldClient()
  const waiting = () => (client as unknown as { held: WorldUpdate | null }).held
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 25))
  }
  client.start(DETAIL)
  const first: WorldUpdate[] = []
  const stop = client.listen((u) => first.push(u))
  client.send(b0)
  await until(() => first.length > 0)
  assert.equal(first[0].full, true)
  // The scene goes; a flip lands while nobody listens, as an update to the world the old scene had.
  stop()
  client.send(b1)
  await until(() => !!waiting())
  assert.equal(waiting()?.full, false)
  // A new scene has no world yet: it must get one in full, not the update meant for the old scene's meshes.
  const fresh: WorldUpdate[] = []
  client.listen((u) => fresh.push(u))
  await until(() => fresh.length > 0)
  client.close()
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].full, true)
  assertSameWorld(fresh[0], new WorldBuilder(DETAIL).build(b1), 'a new scene')
})

test('warp textures are kept for the last few worlds only; an older one is freed', () => {
  const blank = () => new Uint16Array(WARP_TEXELS * WARP_TEXELS * 2)
  const disposed: number[] = []
  const make = (seed: number) => {
    const t = makeWarpTexture(seed, blank())
    t.addEventListener('dispose', () => disposed.push(seed))
    return t
  }
  const texes = [9001, 9002, 9003, 9004, 9005].map(make)
  assert.deepEqual(disposed, [9001, 9002])
  assert.ok(!hasWarpTexture(9001) && !hasWarpTexture(9002) && hasWarpTexture(9003) && hasWarpTexture(9005))
  // A kept world's texture comes back as it is, and counts as the latest used.
  assert.equal(makeWarpTexture(9003), texes[2])
  make(9006)
  assert.deepEqual(disposed, [9001, 9002, 9004])
  assert.ok(hasWarpTexture(9003) && hasWarpTexture(9005) && hasWarpTexture(9006))
})

test('updates swap new arrays into the same geometry and meshes, and upload only what changed', () => {
  const board = mixed()
  const live = new WorldBuilder(DETAIL)
  const first = live.build(board)
  const geo = applyTerrain(null, first.terrain!)
  const plants = new PlantMeshes({ uTime: { value: 0 } })
  plants.set(first.plants!)
  const meshes = [...plants.group.children]
  const c = inlandOf(board)[1]
  const u = live.build(withTerrain(board, c, next[c.terrain]))
  assert.equal(applyTerrain(geo, u.terrain!), geo)
  const pos = geo.surface.getAttribute('position') as THREE.BufferAttribute
  assert.equal(pos.array, u.terrain!.arrays.position)
  const { from, to } = u.terrain!
  assert.deepEqual(pos.updateRanges, [{ start: from * 3, count: (to - from) * 3 }])
  assert.ok(to - from < pos.count / 2, `uploads ${to - from} of ${pos.count} vertices`)
  // A kind keeps its mesh while its plants fit (each is made with room to grow); one that outgrows it gets a new mesh.
  const room = new Map(meshes.map((m) => [(m as THREE.InstancedMesh).material, m as THREE.InstancedMesh]))
  plants.set(u.plants!)
  assert.equal(plants.group.children.length, meshes.length)
  let kept = 0
  for (const m of plants.group.children as THREE.InstancedMesh[]) {
    const was = room.get(m.material)!
    if (m === was) kept++
    assert.equal(m === was, m.count <= was.instanceMatrix.count, `${m.count} plants in a mesh with room for ${was.instanceMatrix.count}`)
  }
  assert.ok(kept >= meshes.length - 2, `${kept} of ${meshes.length} meshes kept`)
  plants.dispose()
})
