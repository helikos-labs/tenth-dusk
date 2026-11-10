import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { makeHero } from '../src/scenes/models/hero.ts'
import { makeLandmark } from '../src/scenes/models/landmarks.ts'
import { prepareNow } from '../src/world/models/kit.ts'

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
