// Seeded PRNG (mulberry32). State is a plain number threaded through game state so every run replays from its seed.

/** FNV-1a over the string's UTF-16 code units. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/** Returns [value in [0,1), next state]. */
export function next(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

/** Returns [integer v with 0 <= v < n, next state]. */
export function int(state: number, n: number): [number, number] {
  const [v, s] = next(state)
  return [Math.floor(v * n), s]
}
