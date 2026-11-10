// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/layout.ts, adapted for Tenth Dusk.
// Where things stand inside a hex on the 3D board: a spot on dry land inside the province.
//
// ORGANIC CONCEPT: a hex is drawn as its warped province (field.ts), which on its narrowest side reaches only 0.4 from
// the centre. So every spot is checked against the province drawn there (`placeInside`): the spot's parts, and a ring of
// MARGIN round each, must lie in the province, or the spot is pulled toward the centre in steps (and, with `swing`,
// turned round it to keep clear of the spots already taken there).
import type { Hex } from './adapter.ts'
import { INRADIUS, WARP, hexCenter, type Field, type Pt } from './field.ts'

const ORIGIN: Pt = { x: 0, z: 0 }

/** How far inside its province a placed thing keeps: a ring this wide round each of its parts must lie in it too. */
export const MARGIN = 0.08

/** Pull steps toward the centre (a share of the wanted offset) and turns round it (radians). */
const PULLS = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0]
const SWINGS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]
const RING: Pt[] = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 4), z: Math.sin((i * Math.PI) / 4) }))

/**
 * Points this close to a hex centre lie in its province whatever the warp does (the warp moves a point less than its
 * cap, and the hex's edge is INRADIUS away), and on dry land: the coast keeps KEEP.min (0.62) from a rim hex's centre,
 * so its signed distance there is at least (0.62 − 0.41) × 1.4 / 2.5 (field.ts: the contour's slope over its scale's
 * largest), more than MARGIN.
 */
export const SURE = INRADIUS - WARP.max

/** True if world point (x, z) lies in the drawn province of hex h. Compares coordinates, since the field may have been
 * built from an earlier board than the one on the table. */
export function inProvince(field: Field, h: Hex, x: number, z: number): boolean {
  const c = field.provinceAt(x, z)
  return !!c && c.q === h.q && c.r === h.r
}

/**
 * True if a spot at world point (x, z) fits in the province of hex h: each of its parts (`footprint`, offsets from the
 * spot) and a ring of `margin` round each lie in the province, on dry land. A land province is dry up to its border
 * (land meets a lake above the water), except on the rim, where a bay of the sea can cut in (never within KEEP.min of
 * the centre): there each part keeps `margin` from the coast as well.
 */
export function fits(field: Field, h: Hex, x: number, z: number, footprint: Pt[] = [ORIGIN], margin = MARGIN): boolean {
  const c = hexCenter(h.q, h.r)
  const rim = Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) >= field.radius
  for (const f of footprint) {
    const px = x + f.x
    const pz = z + f.z
    if (Math.hypot(px - c.x, pz - c.z) + margin < SURE) continue
    if (!inProvince(field, h, px, pz)) return false
    for (const d of RING) if (!inProvince(field, h, px + d.x * margin, pz + d.z * margin)) return false
    // The coast's signed distance is a true distance near the coast (field.ts), so one probe covers the ring.
    if (rim && field.probe(px, pz).s < margin) return false
  }
  return true
}

/** A spot already used in a hex (world point), and how far other things keep from it. */
export interface Taken extends Pt {
  gap: number
}

export interface PlaceOpts {
  /** Offsets of the thing's parts round its spot (a stack's figures, a row of tokens); just the spot by default. */
  footprint?: Pt[]
  margin?: number
  /** Spots to keep clear of, if the province leaves room. */
  taken?: Taken[]
  /** Whether the spot may also turn round the centre to keep clear of `taken` (otherwise it only moves inward). */
  swing?: boolean
}

/**
 * Where something that wants to stand at offset `want` from the centre of hex h stands on the organic map (a world
 * point): the first spot, in order of how far it moves from `want`, that fits in the drawn province (`fits`) and keeps
 * clear of `taken`. Spots are pulled toward the centre in steps and, with `swing`, turned round it; if none keeps clear,
 * the one that fits with the most room wins. The centre always fits a footprint within 0.3 of it (the province reaches
 * at least 0.4 from its centre, whatever the warp does, and is dry there).
 */
export function placeInside(field: Field, h: Hex, want: Pt, o: PlaceOpts = {}): Pt {
  const c = hexCenter(h.q, h.r)
  const { footprint = [ORIGIN], margin = MARGIN, taken = [], swing = false } = o
  const tries: { x: number; z: number; cost: number }[] = []
  for (const t of PULLS)
    for (const a of swing && Math.hypot(want.x, want.z) * t > 0.05 ? SWINGS : [0]) {
      const ox = (want.x * Math.cos(a) - want.z * Math.sin(a)) * t
      const oz = (want.x * Math.sin(a) + want.z * Math.cos(a)) * t
      tries.push({ x: c.x + ox, z: c.z + oz, cost: Math.hypot(ox - want.x, oz - want.z) })
    }
  tries.sort((a, b) => a.cost - b.cost)
  let best: Pt = c
  let bestRoom = -Infinity
  for (const p of tries) {
    let room = Infinity
    for (const t of taken) room = Math.min(room, Math.hypot(p.x - t.x, p.z - t.z) - t.gap)
    // A spot without room only matters if it beats the roomiest so far; checking that it fits costs more.
    if (room < 0 && room <= bestRoom) continue
    if (!fits(field, h, p.x, p.z, footprint, margin)) continue
    if (room >= 0) return { x: p.x, z: p.z }
    best = { x: p.x, z: p.z }
    bestRoom = room
  }
  return best
}

/** Where something standing at the centre of hex h stands on the organic map: a spot on dry land inside its province. */
export const dryInside = (field: Field, h: Hex): Pt => placeInside(field, h, ORIGIN)
