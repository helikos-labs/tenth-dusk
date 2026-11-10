// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/flora.ts, adapted for Tenth Dusk.
// Which flowers grow in a field. Each Grassland hex has a main kind and a second kind, fixed by its coordinates, so the
// world's meadows differ from each other and stay the same all game. Heath grows its own: heather, ling and gorse.
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

export const HEATH_FLOWERS = [
  { name: 'heather', color: '#8e5a8a' },
  { name: 'ling', color: '#b088b0' },
  { name: 'bell heather', color: '#a0457e' },
  { name: 'gorse', color: '#d6a930' },
]

/** A field's main and second flower, from the meadow's kinds or, on `heath`, the heath's. */
export function flowersOf(q: number, r: number, heath = false) {
  const kinds = heath ? HEATH_FLOWERS : FLOWERS
  const main = kinds[Math.floor(hash01(q, r, 7) * kinds.length)]
  let second = kinds[Math.floor(hash01(q, r, 8) * kinds.length)]
  if (second === main) second = kinds[(kinds.indexOf(main) + (heath ? 1 : 3)) % kinds.length]
  return { main, second }
}
