import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CUT, cutHeight, NO_CUT } from '../src/world/materials.ts'

// The hero's feet at (0, 0.1, 0); the camera's view down to them rises 1.7 per unit toward the camera (+z).
const cut = new THREE.Vector4(0, 0.1, 0, 1.7)

test('the camera cutaway lowers ground rising into the view of the hero, toward the camera only', () => {
  // A peak a hex toward the camera is cut to the plane CUT.drop under the view.
  assert.ok(Math.abs(cutHeight(4.3, 1, cut) - (0.1 - CUT.drop + 1.7)) < 1e-9)
  // Ground under the plane, ground beyond the hero and ground with no cut stand as they are.
  assert.equal(cutHeight(0.5, 1, cut), 0.5)
  assert.equal(cutHeight(4.3, -1, cut), 4.3)
  assert.equal(cutHeight(4.3, 1, NO_CUT), 4.3)
  // It fades in from the hero's feet: no step there.
  assert.equal(cutHeight(4.3, 0, cut), 4.3)
  assert.ok(cutHeight(4.3, CUT.fade / 2, cut) < 4.3 && cutHeight(4.3, CUT.fade / 2, cut) > 0.1 - CUT.drop + 1.7 * (CUT.fade / 2))
})
