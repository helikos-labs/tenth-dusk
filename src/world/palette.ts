// Tenth Dusk's ground palette (§15.5): the Rift & Root table's keys drained to ash-olive, peat and slate (about 40-50% of the old saturation, hue nudged toward ochre). The blight keys colour the marsh, which reuses the engine's sunken blight profile (§15.3).
import * as THREE from 'three'

const col = (hex: string) => new THREE.Color(hex)

export const PALETTE = {
  grass: col('#515548'),
  grassLight: col('#676b5a'),
  grassDark: col('#383c32'),
  /** Sun-dried drifts in the meadows. Not in the brief: a dusk shade between grass and heathDry. */
  grassDry: col('#676658'),
  forest: col('#323832'),
  forestDark: col('#212621'),
  /** Old wood: forest, darker. Not in the brief: forest's shades taken down a step. */
  oldwood: col('#242924'),
  oldwoodDark: col('#171a17'),
  rock: col('#666c6f'),
  rockDark: col('#474b4e'),
  rockLight: col('#8f9497'),
  snow: col('#cfd2d6'),
  /** Wind-packed snow and drifts in hollows: a cold blue-grey. Not in the brief: snow's shade at dusk. */
  snowShade: col('#9ea6b0'),
  /** Not in the brief: between rock and rockLight. */
  scree: col('#767a7c'),
  sand: col('#8a8578'),
  /** Not in the brief: sand, darker and wet. */
  wetSand: col('#676359'),
  mud: col('#47443d'),
  reedBank: col('#575a4a'),
  bed: col('#26343d'),
  heath: col('#656357'),
  heathDry: col('#747162'),
  /** Marsh (the engine's blight profile). */
  blight: col('#434840'),
  blightDark: col('#30332d'),
  blightLight: col('#575a4a'),
  /** Water: shallow and deep, a deep slate-teal at dusk. */
  water: col('#252f33'),
  waterDeep: col('#151c20'),
}
