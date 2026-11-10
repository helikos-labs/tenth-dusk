// The 14 × 22 walled valley from the world-engine spike (DESIGN.md §15.2): mountain cells on the rim, a lake to the
// east, a central range with a one-hex pass, and a road running up through it. Rows are listed top first; row i from
// the top is offset row 21 - i. A mountain (level 2), F forest, W water, M meadow, D meadow with a road.
import type { WorldCell } from '../../src/world/adapter.ts'
import { toAxial } from '../../src/rules/hex.ts'

const ROWS =
  'AAAAAAAAAAAAAA AAAAAFFMMAAAAA AAAAFFMDMMFAAA AAAFMMMDMMFFAA AAFFMMMDMWWWAA AAFMMMDMMWWWWA AAAMMMDMFWWWWW AAAAMDMMFFWWWW AAAAADMMMFFWWW AAAAADAAAFFWWW AAAAMDAAMMFWWW AAAFMDMMMMFFWW AAFFMDMMMFFFWW AFFMMDMMWMMFFW AFMMMDMWWWMMFW AFMMDMMWWWMMFF AFFMDMMMWMMFFA AAFMDMMMMMFFAA AAFFDMMFFMMFAA AAAFDMMFFFMAAA AAAFDMMMFFAAAA AAAAAAAAAAAAAA'.split(' ')

const LETTER: Record<string, Pick<WorldCell, 'terrain' | 'level' | 'road'>> = {
  A: { terrain: 'mountain', level: 2 },
  F: { terrain: 'forest', level: 0 },
  W: { terrain: 'water', level: 0 },
  M: { terrain: 'grassland', level: 0 },
  D: { terrain: 'grassland', level: 0, road: 'road' },
}

export const VALLEY: Record<string, WorldCell> = {}
ROWS.forEach((line, i) => {
  const row = ROWS.length - 1 - i
  ;[...line].forEach((ch, col) => {
    const { q, r } = toAxial({ row, col })
    const def = LETTER[ch]
    const cell: WorldCell = { q, r, terrain: def.terrain, level: def.level, wall: false }
    if (def.road) cell.road = def.road
    VALLEY[`${q},${r}`] = cell
  })
})
