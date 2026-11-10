// Book I, The Saltreach: authored chapter skeletons (§4.1, §14.1).
import type { ChapterSkeleton } from '../rules/gen.ts'

export const CHAPTER1: ChapterSkeleton = {
  id: 'b1c1',
  name: 'The Reach Road',
  rows: 17,
  cols: 9,
  wallDepth: 4,
  walls: { west: 'peaks', east: 'sea', north: 'peaks', south: 'peaks' },
  weights: { meadow: 0.36, heath: 0.12, forest: 0.22, hills: 0.12, marsh: 0.1, mountain: 0.05, lake: 0.03 },
  riverRows: [7, 9],
  start: { row: 0, col: 4 },
  hearth: { row: 16, col: 4 },
  beaconRows: [4, 8, 12],
}
