import type { Off } from './hex.ts'
import { distance, key, neighbours } from './hex.ts'
import { TERRAIN } from '../data/terrain.ts'
import { STARTING_HERO } from '../data/kit.ts'
import type { Hero } from '../data/kit.ts'
import { cellAt, stepCost } from './zone.ts'
import type { Block, Zone } from './zone.ts'
import { reveal, visible } from './sight.ts'
import type { Fog } from './sight.ts'
import { cheapestPath } from './gen.ts'
import { hashSeed } from './rng.ts'

export const STEPS_PER_DAY = 6
export const NIGHT_STEPS = 2
export const LAST_DAY = 10
export const HUSH_DEPTH = 4

export type NightAction = 'rest' | 'tend' | 'forage' | 'stars'
export type MoveCheck = { ok: true; cost: number } | { ok: false; reason: 'notAdjacent' | 'sunk' | 'steps' | 'over' | Block }
export type RunEvent = {
  kind: 'moved' | 'beacon' | 'cold' | 'leeches' | 'fell' | 'sunk' | 'camped' | 'hearth' | 'expired' | 'pushed'
  at: Off
  day: number
}

export interface RunState {
  zone: Zone
  hero: Hero
  at: Off
  day: number
  steps: number
  nightSteps: number
  night: boolean
  furthestRow: number
  sunkBelow: number
  fog: Map<string, Fog>
  lit: string[]
  rumours: string[]
  lastCamp: Off
  status: 'walking' | 'hearth' | 'expired'
  scars: string[]
  rng: number
  events: RunEvent[]
}

const cmpOff = (a: Off, b: Off): number => a.row - b.row || a.col - b.col

function startOf(zone: Zone): Off {
  for (const c of zone.cells.values()) if (c.landmark === 'start') return { row: c.row, col: c.col }
  throw new Error('zone has no start landmark')
}

export function newRun(zone: Zone, heroName: string): RunState {
  const at = startOf(zone)
  return {
    zone, hero: STARTING_HERO(heroName), at, day: 1, steps: STEPS_PER_DAY, nightSteps: 0, night: false,
    furthestRow: at.row, sunkBelow: -1e9, fog: reveal(new Map(), visible(zone, at, false)),
    lit: [], rumours: [], lastCamp: at, status: 'walking', scars: [], rng: hashSeed(zone.seed), events: [],
  }
}

const available = (s: RunState): number => (s.night ? s.nightSteps : s.steps)

export function canMove(s: RunState, to: Off): MoveCheck {
  if (s.status !== 'walking') return { ok: false, reason: 'over' }
  if (!neighbours(s.at).some((n) => n.row === to.row && n.col === to.col)) return { ok: false, reason: 'notAdjacent' }
  if (to.row < s.sunkBelow) return { ok: false, reason: 'sunk' }
  const c = stepCost(s.zone, s.at, to)
  if (typeof c !== 'number') return { ok: false, reason: c.blocked }
  if (c > available(s)) return { ok: false, reason: 'steps' }
  return { ok: true, cost: c }
}

/** The nearest landmark not yet seen and not already a rumour; undefined when none is left. */
function nextRumour(s: RunState): string | undefined {
  const found = [...s.zone.cells.values()]
    .filter((c) => c.landmark && (s.fog.get(key(c)) ?? 0) === 0 && !s.rumours.includes(key(c)))
    .map((c) => ({ row: c.row, col: c.col }))
    .sort((a, b) => distance(s.at, a) - distance(s.at, b) || cmpOff(a, b))[0]
  return found ? key(found) : undefined
}

function addRumour(s: RunState): RunState {
  const r = nextRumour(s)
  return r ? { ...s, rumours: [...s.rumours, r] } : s
}

function fall(s: RunState): RunState {
  const day = s.day + 1
  let out: RunState = {
    ...s, at: s.lastCamp, day, hero: { ...s.hero, vigour: Math.floor(s.hero.maxVigour / 2) },
    steps: STEPS_PER_DAY, night: false, nightSteps: 0,
    events: [...s.events, { kind: 'fell', at: s.lastCamp, day: s.day }],
  }
  if (day > LAST_DAY) {
    out = { ...out, status: 'expired', scars: [...out.scars, s.zone.chapter], events: [...out.events, { kind: 'expired', at: out.at, day }] }
  }
  return { ...out, fog: reveal(out.fog, visible(out.zone, out.at, false)) }
}

export function move(s: RunState, to: Off): RunState {
  const check = canMove(s, to)
  if (!check.ok) return s
  const cell = cellAt(s.zone, to)!
  const events: RunEvent[] = [...s.events, { kind: 'moved', at: to, day: s.day }]
  let out: RunState = {
    ...s, at: to, events, hero: { ...s.hero },
    steps: s.night ? s.steps : s.steps - check.cost,
    nightSteps: s.night ? s.nightSteps - check.cost : s.nightSteps,
    furthestRow: Math.max(s.furthestRow, to.row),
  }
  out.fog = reveal(s.fog, visible(s.zone, to, s.night))
  const gear = s.hero.gear
  if (cell.terrain === 'mountain' && gear.cloak?.id !== 'fur-cloak') {
    out.hero.vigour -= 2
    events.push({ kind: 'cold', at: to, day: s.day })
  }
  if (cell.terrain === 'marsh' && gear.boots?.id !== 'waxed-boots') {
    out.hero.vigour -= 2
    events.push({ kind: 'leeches', at: to, day: s.day })
  }
  if (cell.landmark === 'beacon' && !s.lit.includes(key(to))) {
    out.lit = [...s.lit, key(to)]
    out.hero.maxEmber += 1
    const fog = new Map(out.fog)
    for (const [k, c] of s.zone.cells) {
      const f = fog.get(k) ?? 0
      if (distance(to, c) <= 2 && f !== 1 && f < 2) fog.set(k, 2)
    }
    out.fog = fog
    out = addRumour(out)
    events.push({ kind: 'beacon', at: to, day: s.day })
  }
  if (cell.landmark === 'hearth') {
    out.status = 'hearth'
    events.push({ kind: 'hearth', at: to, day: s.day })
    return out
  }
  if (out.hero.vigour <= 0) return fall(out)
  return out
}

/** The keys of the hexes the Hush has taken. */
function sunkKeys(s: RunState): Set<string> {
  const sunk = new Set<string>()
  for (const [k, c] of s.zone.cells) if (c.row < s.sunkBelow) sunk.add(k)
  return sunk
}

export function path(s: RunState, to: Off): { path: Off[]; costs: number[] } | null {
  return cheapestPath(s.zone, s.at, to, sunkKeys(s))
}

export function pressOn(s: RunState): RunState {
  if (s.status !== 'walking' || s.night) return s
  if (neighbours(s.at).some((n) => canMove(s, n).ok)) return s
  return { ...s, night: true, nightSteps: NIGHT_STEPS + s.steps, steps: 0, fog: reveal(s.fog, visible(s.zone, s.at, true)) }
}

export function campOptions(s: RunState): { safe: boolean; picks: 2 | 3 } {
  const lm = cellAt(s.zone, s.at)?.landmark
  const safe = lm === 'camp' || lm === 'cave'
  return { safe, picks: safe ? 3 : 2 }
}

function dawn(s: RunState): RunState {
  const at = s.at
  if (s.day === LAST_DAY && s.status === 'walking') {
    return { ...s, status: 'expired', scars: [...s.scars, s.zone.chapter], events: [...s.events, { kind: 'expired', at, day: s.day }] }
  }
  let out: RunState = {
    ...s, day: s.day + 1, steps: STEPS_PER_DAY, night: false, nightSteps: 0,
    sunkBelow: Math.max(s.sunkBelow, s.furthestRow - HUSH_DEPTH), events: [...s.events],
  }
  const fog = new Map(out.fog)
  let newlySunk = false
  for (const [k, c] of out.zone.cells) {
    if (c.row < out.sunkBelow) {
      if (fog.get(k) !== 1) newlySunk = true
      fog.set(k, 1)
    }
  }
  out.fog = fog
  if (newlySunk) out.events.push({ kind: 'sunk', at, day: out.day })
  if (at.row < out.sunkBelow) {
    // The nearest unsunk hex the hero can stand on and still walk to the hearth from, however many days it takes
    // (R22), never the hearth itself; only when there is none, the nearest they can stand on.
    const standable = [...out.zone.cells.values()]
      .filter((c) => c.row >= out.sunkBelow && !c.wall && (TERRAIN[c.terrain].steps !== null || c.crossing))
      .map((c) => ({ row: c.row, col: c.col }))
      .sort((a, b) => distance(at, a) - distance(at, b) || cmpOff(a, b))
    const hearth = [...out.zone.cells.values()].find((c) => c.landmark === 'hearth')
    const sunk = sunkKeys(out)
    const reaches = (o: Off) => !!hearth && key(o) !== key(hearth) && cheapestPath(out.zone, o, hearth, sunk) !== null
    const dest = standable.find(reaches) ?? standable[0]
    if (dest) {
      out.at = dest
      out.lastCamp = dest
      out.events.push({ kind: 'pushed', at: dest, day: out.day })
    }
  }
  out.fog = reveal(out.fog, visible(out.zone, out.at, false))
  return out
}

export function camp(s: RunState, actions: NightAction[]): RunState {
  if (s.status !== 'walking') return s
  const { picks } = campOptions(s)
  if (actions.length < 1 || actions.length > picks || new Set(actions).size !== actions.length) {
    throw new Error(`camp needs 1 to ${picks} distinct actions`)
  }
  let out: RunState = { ...s, hero: { ...s.hero, satchel: s.hero.satchel.map((i) => ({ ...i })) } }
  for (const a of actions) {
    if (a === 'rest') out.hero.vigour = Math.min(out.hero.maxVigour, out.hero.vigour + 10)
    else if (a === 'tend') out.hero.ember = Math.min(out.hero.maxEmber, out.hero.ember + 2)
    else if (a === 'forage') {
      const r = out.hero.satchel.find((i) => i.id === 'ration')
      if (!r) out.hero.satchel.push({ id: 'ration', n: 1 })
      else if (r.n < 3) r.n += 1
    } else out = addRumour(out)
  }
  out = { ...out, lastCamp: s.at, events: [...out.events, { kind: 'camped', at: s.at, day: s.day }] }
  return dawn(out)
}
