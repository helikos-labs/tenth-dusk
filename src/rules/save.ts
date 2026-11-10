import type { Off } from './hex.ts'
import { generateZone } from './gen.ts'
import type { ChapterSkeleton } from './gen.ts'
import { cellAt } from './zone.ts'
import type { Fog } from './sight.ts'
import type { RunEvent, RunState } from './run.ts'
import type { Hero } from '../data/kit.ts'
import { CHAPTER1 } from '../data/book1.ts'

export const SAVE_KEY = 'tenth-dusk.save.v1'
export const SAVE_VERSION = 1

export interface SaveFile { v: number; savedAt: number; run: unknown }
export type LoadResult = { ok: true; run: RunState } | { ok: false; reason: 'empty' | 'corrupt' | 'newer' }

// Upgrades a save from version n to n + 1. Empty at v1.
export const MIGRATIONS: Record<number, (old: unknown) => unknown> = {}

const CHAPTERS: Record<string, ChapterSkeleton> = { b1c1: CHAPTER1 }

export function serialise(s: RunState): string {
  const { zone, fog, ...rest } = s
  const file: SaveFile = {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    run: { ...rest, zone: { chapter: zone.chapter, seed: zone.seed }, fog: [...fog.entries()] },
  }
  return JSON.stringify(file)
}

type Rec = Record<string, unknown>
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const int = (x: unknown): x is number => Number.isInteger(x)
const nat = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0
const str = (x: unknown): x is string => typeof x === 'string'
const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every(str)
const off = (x: unknown): x is Off => isRec(x) && int(x.row) && int(x.col)

const EVENT_KINDS = ['moved', 'beacon', 'cold', 'leeches', 'fell', 'sunk', 'camped', 'hearth', 'expired', 'pushed']
const STATUSES = ['walking', 'hearth', 'expired']
const SLOTS = ['weapon', 'shield', 'lantern', 'cloak', 'boots', 'charm']

function validHero(h: unknown): h is Hero {
  if (!isRec(h)) return false
  if (!str(h.name) || !nat(h.vigour) || !nat(h.maxVigour) || !nat(h.ember) || !nat(h.maxEmber)) return false
  if (!isRec(h.gear)) return false
  for (const [slot, g] of Object.entries(h.gear)) {
    if (!SLOTS.includes(slot) || !isRec(g) || !str(g.id) || ![1, 2, 3, 4].includes(g.tier as number)) return false
  }
  return Array.isArray(h.satchel) && h.satchel.every((i) => isRec(i) && str(i.id) && nat(i.n))
}

const validEvent = (e: unknown): e is RunEvent =>
  isRec(e) && str(e.kind) && EVENT_KINDS.includes(e.kind) && off(e.at) && int(e.day)

function revive(raw: unknown): RunState | null {
  if (!isRec(raw)) return null
  const z = raw.zone
  if (!isRec(z) || !str(z.chapter) || !str(z.seed)) return null
  if (!Object.hasOwn(CHAPTERS, z.chapter)) return null
  if (!int(raw.day) || raw.day < 1 || !nat(raw.steps) || !nat(raw.nightSteps) || !int(raw.furthestRow) || !int(raw.sunkBelow) || !num(raw.rng)) return null
  if (typeof raw.night !== 'boolean') return null
  if (!off(raw.at) || !off(raw.lastCamp)) return null
  if (!str(raw.status) || !STATUSES.includes(raw.status)) return null
  if (!validHero(raw.hero)) return null
  if (!strs(raw.lit) || !strs(raw.rumours) || !strs(raw.scars)) return null
  if (!Array.isArray(raw.events) || !raw.events.every(validEvent)) return null
  if (!Array.isArray(raw.fog)) return null
  const fog = new Map<string, Fog>()
  for (const e of raw.fog) {
    if (!Array.isArray(e) || e.length !== 2 || !str(e[0]) || ![0, 1, 2, 3].includes(e[1])) return null
    if (!/^-?\d+,-?\d+$/.test(e[0])) return null
    fog.set(e[0], e[1] as Fog)
  }
  let zone
  try {
    zone = generateZone(CHAPTERS[z.chapter], z.seed)
  } catch {
    return null
  }
  if (!cellAt(zone, raw.at) || !cellAt(zone, raw.lastCamp)) return null
  for (const k of fog.keys()) if (!zone.cells.has(k)) return null
  return { ...(raw as unknown as RunState), zone, fog }
}

export function load(text: string | null): LoadResult {
  if (text === null || text === '') return { ok: false, reason: 'empty' }
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
  if (!isRec(file) || !int(file.v) || file.v < 1 || !num(file.savedAt)) return { ok: false, reason: 'corrupt' }
  if (file.v > SAVE_VERSION) return { ok: false, reason: 'newer' }
  let run: unknown = file.run
  try {
    for (let v = file.v; v < SAVE_VERSION; v++) {
      const step = MIGRATIONS[v]
      if (!step) return { ok: false, reason: 'corrupt' }
      run = step(run)
    }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
  const out = revive(run)
  return out ? { ok: true, run: out } : { ok: false, reason: 'corrupt' }
}
