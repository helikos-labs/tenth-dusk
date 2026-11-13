// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/flora.ts, adapted for Tenth Dusk.
// Withered: bone, dull mauve and rust (Tenth Dusk, ART-DIRECTION §3.2).
// Which flowers grow in a field. Each Grassland hex has a main kind and a second kind, fixed by its coordinates, so the
// world's meadows differ from each other and stay the same all game. Heath grows its own: heather, ling and gorse.
import { hash01 } from './field.ts'

export const FLOWERS = [
  { name: 'poppy', color: '#8a4a3a' },
  { name: 'cornflower', color: '#6f7488' },
  { name: 'buttercup', color: '#a89a6a' },
  { name: 'lavender', color: '#7e6a86' },
  { name: 'daisy', color: '#c9c3b0' },
  { name: 'clover', color: '#9c7a86' },
  { name: 'marigold', color: '#946a46' },
  { name: 'bluebell', color: '#7c7f94' },
]

export const HEATH_FLOWERS = [
  { name: 'heather', color: '#76607a' },
  { name: 'ling', color: '#8e7a90' },
  { name: 'bell heather', color: '#7a4e62' },
  { name: 'gorse', color: '#9a8450' },
]

/** A field's main and second flower, from the meadow's kinds or, on `heath`, the heath's. */
export function flowersOf(q: number, r: number, heath = false) {
  const kinds = heath ? HEATH_FLOWERS : FLOWERS
  const main = kinds[Math.floor(hash01(q, r, 7) * kinds.length)]
  let second = kinds[Math.floor(hash01(q, r, 8) * kinds.length)]
  if (second === main) second = kinds[(kinds.indexOf(main) + (heath ? 1 : 3)) % kinds.length]
  return { main, second }
}
