import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { dressHero, makeHero } from '../src/scenes/models/hero.ts'
import { dimLandmark, makeLandmark } from '../src/scenes/models/landmarks.ts'
import { copyModel, prepareNow } from '../src/world/models/kit.ts'

test('every landmark kind builds, stands on y = 0 and fits in a hex', () => {
  for (const k of ['beacon', 'hearth', 'camp', 'hamlet', 'cave', 'ruins', 'start'] as const) {
    const g = makeLandmark(k); const b = new THREE.Box3().setFromObject(g)
    assert.ok(Math.abs(b.min.y) < 0.02, `${k}: min y ${b.min.y}`); assert.ok(Math.max(b.max.x - b.min.x, b.max.z - b.min.z) <= 1.6, `${k}: footprint`)
  }
  // The lit beacon too.
  const lit = new THREE.Box3().setFromObject(makeLandmark('beacon', true))
  assert.ok(Math.abs(lit.min.y) < 0.02)
  assert.ok(Math.max(lit.max.x - lit.min.x, lit.max.z - lit.min.z) <= 1.6)
})

test('hero is about one hex tall and bakes to ≤ 6 meshes', () => {
  // Its solid parts (meshes; not the lantern's halo sprite or light) stand on y = 0 and reach about 1.0.
  const hero = makeHero()
  hero.updateMatrixWorld(true)
  const b = new THREE.Box3()
  hero.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) b.expandByObject(o, false)
  })
  assert.ok(Math.abs(b.min.y) < 0.02, `min y ${b.min.y}`)
  assert.ok(b.max.y > 0.9 && b.max.y < 1.1, `height ${b.max.y}`)
  // Baked through kit's path (prepare): static parts merge per anchor and look.
  const template = prepareNow('test-hero', makeHero)
  let meshes = 0
  template.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++
  })
  assert.ok(meshes <= 6, `${meshes} meshes`)
  // It carries a lantern light that flickers.
  let light: THREE.PointLight | null = null
  template.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) light = o as THREE.PointLight
  })
  assert.ok(light, 'a lantern point light')
})

test('the dressed hero has an ember see-through twin for each part, drawn before it', () => {
  prepareNow('test-hero-dress', makeHero)
  const hero = dressHero(copyModel('test-hero-dress'))
  const meshes: THREE.Mesh[] = []
  hero.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  const twins = meshes.filter((m) => (m.material as THREE.Material).depthFunc === THREE.GreaterDepth)
  assert.equal(twins.length * 2, meshes.length)
  for (const t of twins) assert.ok(t.renderOrder < meshes.find((m) => m.geometry === t.geometry && m !== t)!.renderOrder)
})

test('a remembered Landmark dims and comes back as it was', () => {
  prepareNow('test-beacon-lit', () => makeLandmark('beacon', true))
  const b = copyModel('test-beacon-lit')
  const before = new Map<THREE.Object3D, THREE.Material>()
  b.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) before.set(o, (o as THREE.Mesh).material as THREE.Material)
  })
  dimLandmark(b, true)
  for (const [o, m] of before) assert.notEqual((o as THREE.Mesh).material, m)
  dimLandmark(b, false)
  for (const [o, m] of before) assert.equal((o as THREE.Mesh).material, m)
})
