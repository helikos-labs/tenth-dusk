// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/flora.ts, adapted for Tenth Dusk.
// Which flowers grow in a field. Each Grassland hex has a main kind and a second kind, fixed by its coordinates, so the
// world's meadows differ from each other and stay the same all game.
import { hash01 } from './field.ts'

export const FLOWERS = [
  { name: 'poppy', color: '#d9342b' },
  { name: 'cornflower', color: '#3d64da' },
  { name: 'buttercup', color: '#f4cf2e' },
  { name: 'lavender', color: '#9b76d8' },
  { name: 'daisy', color: '#f7f4ea' },
  { name: 'clover', color: '#ea8fbb' },
  { name: 'marigold', color: '#f2892a' },
  { name: 'bluebell', color: '#7486e6' },
]

export function flowersOf(q: number, r: number) {
  const main = FLOWERS[Math.floor(hash01(q, r, 7) * FLOWERS.length)]
  let second = FLOWERS[Math.floor(hash01(q, r, 8) * FLOWERS.length)]
  if (second === main) second = FLOWERS[(FLOWERS.indexOf(main) + 3) % FLOWERS.length]
  return { main, second }
}
