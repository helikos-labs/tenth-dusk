// Tenth Dusk's ground palette (§15.5): the Rift & Root table's keys with dusk values, muted moss, ochre, slate and
// peat. The blight keys colour the marsh, which reuses the engine's sunken blight profile (§15.3).
import * as THREE from 'three'

const col = (hex: string) => new THREE.Color(hex)

export const PALETTE = {
  grass: col('#4f5a3a'),
  grassLight: col('#66704a'),
  grassDark: col('#363f28'),
  /** Sun-dried drifts in the meadows. Not in the brief: a dusk shade between grass and heathDry. */
  grassDry: col('#6c6a48'),
  forest: col('#2b3a2e'),
  forestDark: col('#1c271f'),
  /** Old wood: forest, darker. Not in the brief: forest's shades taken down a step. */
  oldwood: col('#1f2a22'),
  oldwoodDark: col('#131b15'),
  rock: col('#5c6170'),
  rockDark: col('#3f434f'),
  rockLight: col('#858a96'),
  snow: col('#dfe3ea'),
  /** Wind-packed snow and drifts in hollows: a cold blue-grey. Not in the brief: snow's shade at dusk. */
  snowShade: col('#b2bdcc'),
  /** Not in the brief: between rock and rockLight. */
  scree: col('#6e717b'),
  sand: col('#8f8466'),
  /** Not in the brief: sand, darker and wet. */
  wetSand: col('#6b634b'),
  mud: col('#4a4433'),
  reedBank: col('#56603a'),
  bed: col('#26343d'),
  heath: col('#6a6448'),
  heathDry: col('#7a7350'),
  /** Marsh (the engine's blight profile). */
  blight: col('#3e4a37'),
  blightDark: col('#2c3527'),
  blightLight: col('#56603a'),
  /** Water: shallow and deep, a deep slate-teal at dusk. */
  water: col('#2e4a55'),
  waterDeep: col('#1d2f38'),
}
