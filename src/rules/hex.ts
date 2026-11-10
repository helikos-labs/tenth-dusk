// Hex maths. Offset coords: rows rise forward (up the screen), odd rows shifted right.
export type Off = { row: number; col: number }
export type Ax = { q: number; r: number }
type Cube = { x: number; y: number; z: number }

const z0 = (n: number): number => (n === 0 ? 0 : n) // normalise -0

export function toAxial(o: Off): Ax {
  return { q: z0(o.col + (o.row + (o.row & 1)) / 2), r: z0(-o.row) }
}

export function toOffset(a: Ax): Off {
  const row = -a.r
  return { row: z0(row), col: z0(a.q - (row + (row & 1)) / 2) }
}

export const key = (o: Off): string => `${o.row},${o.col}`

export function unkey(k: string): Off {
  const [row, col] = k.split(',').map(Number)
  return { row, col }
}

const DIRS: Ax[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
]

export function neighbours(o: Off): Off[] {
  const a = toAxial(o)
  return DIRS.map((d) => toOffset({ q: a.q + d.q, r: a.r + d.r }))
}

const toCube = (o: Off): Cube => {
  const a = toAxial(o)
  return { x: a.q, z: a.r, y: -a.q - a.r }
}

export function distance(a: Off, b: Off): number {
  const p = toCube(a), q = toCube(b)
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z))
}

function roundCube(c: Cube): Cube {
  let x = Math.round(c.x), y = Math.round(c.y), z = Math.round(c.z)
  const dx = Math.abs(x - c.x), dy = Math.abs(y - c.y), dz = Math.abs(z - c.z)
  if (dx > dy && dx > dz) x = -y - z
  else if (dy > dz) y = -x - z
  else z = -x - y
  return { x, y, z }
}

export function line(a: Off, b: Off): Off[] {
  const n = distance(a, b)
  // ε nudge so exact ties break the same way every time
  const p = toCube(a), q = toCube(b)
  const s = { x: p.x + 1e-6, y: p.y + 2e-6, z: p.z - 3e-6 }
  const e = { x: q.x + 1e-6, y: q.y + 2e-6, z: q.z - 3e-6 }
  const out: Off[] = []
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n
    const c = roundCube({
      x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t, z: s.z + (e.z - s.z) * t,
    })
    out.push(toOffset({ q: c.x, r: c.z }))
  }
  return out
}
