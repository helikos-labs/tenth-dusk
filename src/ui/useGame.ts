// The game's state between the screens (§16): which screen shows, the run, the path preview and the walk along it, and
// the blocked-tap chip. Every change to the run goes through a rules function; the run is autosaved under SAVE_KEY
// whenever it changes. A save that fails to load (corrupt or from a newer version) is set aside under
// `SAVE_KEY + '.corrupt'`, and the title offers only a new journey.
//
// Walking (§5.1): a first tap on a reachable hex previews its path; a second tap on the same hex walks it, a move
// every STEP_SECONDS, until it arrives or the run refuses a move; taps are ignored mid-walk; a tap anywhere else
// replaces the preview, or clears it and says why the hex can't be reached when the hero can tell.
//
// What the rules did (R24): after each change to the run, the newest event not yet told (notices.ts) shows in the
// chip slot. `seen` counts the run's events already told; a continued save starts with all of them told, so nothing
// shows twice after a reload. A blocked-tap chip takes the slot over.
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { TERRAIN } from '../data/terrain.ts'
import { CHAPTER1 } from '../data/book1.ts'
import { generateZone } from '../rules/gen.ts'
import { key, type Off } from '../rules/hex.ts'
import { camp, campOptions, canMove, move, newRun, path, pressOn, type MoveCheck, type NightAction, type RunState } from '../rules/run.ts'
import { SAVE_KEY, load, serialise } from '../rules/save.ts'
import { cellAt } from '../rules/zone.ts'
import { STEP_SECONDS } from '../scenes/WorldScene.tsx'
import { reachable } from '../scenes/reach.ts'
import { TEST } from '../testHooks.ts'
import { newestNotice } from './notices.ts'

export type Screen = 'title' | 'name' | 'intro' | 'world' | 'camp' | 'pack' | 'end'

export type GameAction =
  | { t: 'new' }
  | { t: 'name'; name: string }
  | { t: 'begin' }
  | { t: 'tap'; at: Off }
  | { t: 'pressOn' }
  | { t: 'openCamp' }
  | { t: 'closeCamp' }
  | { t: 'camp'; actions: NightAction[] }
  | { t: 'pack' | 'closePack' }
  | { t: 'continue' }

export interface Game {
  run: RunState | null
  screen: Screen
  act: (a: GameAction) => void
  /** The blocked-tap chip's text, or none. */
  blocked: string | null
  /** Counts blocked taps: the chip is keyed on it, so a repeat tap shows it afresh. */
  blockedN: number
  /** The line telling what the rules just did, or none (shown when no blocked-tap chip is). */
  notice: string | null
  /** Counts notices: their chip is keyed on it. */
  noticeN: number
  /** The path preview, the hero's hex first, or none. */
  preview: Off[] | null
  /** True while the hero walks a path. */
  walking: boolean
  /** A save the title can continue. */
  canContinue: boolean
}

/** The hero's name: 1 to 16 characters, trimmed. */
export const NAME_MAX = 16
export const DEFAULT_NAME = 'Wren'
/** How long the blocked-tap chip shows. */
const CHIP_MS = 2400
/** How long a notice shows (the .td-notice animation in screens.css). */
const NOTICE_MS = 3600

/** The chip's copy for each reason a move is refused; notAdjacent and over say nothing. */
const BLOCKED: Partial<Record<Extract<MoveCheck, { ok: false }>['reason'], string>> = {
  wall: "Can't cross",
  impassable: "Can't cross",
  offboard: "Can't cross",
  cliff: 'Too steep without a way up',
  steps: 'Not enough steps today',
  sunk: 'Lost to the Hush',
}

/**
 * Why the hero can't go to a tapped hex they can't reach, as the chip says it, or null. Next to the hero it is
 * canMove's reason. Further off it is what the hero can tell from where they stand: the Hush has the row, the hex is
 * the wall or (once seen) water or peaks, or a path in sight runs there but costs more than the steps left. An
 * unseen hex says nothing.
 */
export function blockedCopy(run: RunState, at: Off): string | null {
  if (key(at) === key(run.at)) return null
  const check = canMove(run, at)
  if (check.ok) return null
  if (check.reason !== 'notAdjacent') return BLOCKED[check.reason] ?? null
  const cell = cellAt(run.zone, at)
  if (!cell) return BLOCKED.offboard!
  if (at.row < run.sunkBelow) return BLOCKED.sunk!
  if (cell.wall) return BLOCKED.wall!
  if ((run.fog.get(key(at)) ?? 0) < 2) return null
  if (TERRAIN[cell.terrain].steps === null && !cell.crossing) return BLOCKED.impassable!
  const p = path(run, at)
  const left = run.night ? run.nightSteps : run.steps
  if (p && p.path.every((o) => (run.fog.get(key(o)) ?? 0) >= 2) && p.costs.reduce((a, b) => a + b, 0) > left) return BLOCKED.steps!
  return null
}

/** Whether the hero may press on into the night: whatever rules/run.ts pressOn allows (it changes the run). */
export const canPressOn = (run: RunState): boolean => pressOn(run) !== run

/**
 * A fresh 6-character seed for a new journey: uppercase letters and digits. With ?test=1, `&seed=` fixes it, so the
 * smoke test walks a known zone.
 */
function freshSeed(): string {
  const asked = TEST ? new URLSearchParams(window.location.search).get('seed') : null
  if (asked) return asked
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => ABC[b % ABC.length]).join('')
}

/** Chapter 1 for a fresh seed (another seed if the generator finds no fair zone for one). */
function startRun(name: string): RunState {
  for (let i = 0; ; i++) {
    try {
      return newRun(generateZone(CHAPTER1, freshSeed()), name)
    } catch (e) {
      if (i >= 4) throw e
    }
  }
}

interface State {
  screen: Screen
  run: RunState | null
  preview: Off[] | null
  /** The hexes still to walk into, or null when the hero stands. */
  walk: Off[] | null
  blocked: string | null
  /** Counts blocked taps, so a second tap on a wall shows the chip again for its full time. */
  blockedN: number
  notice: string | null
  noticeN: number
  /** How many of the run's events the player has been told of (or passed over). */
  seen: number
  /** The save the title offers to continue. */
  saved: RunState | null
}

type Internal = GameAction | { t: 'started'; run: RunState } | { t: 'step' } | { t: 'unblock' } | { t: 'unnotice' }

const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      // storage full or blocked: the run goes on unsaved
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k)
    } catch {
      // nothing to remove
    }
  },
}

function boot(): State {
  const text = storage.get(SAVE_KEY)
  const loaded = load(text)
  if (!loaded.ok && loaded.reason !== 'empty' && text !== null) storage.set(`${SAVE_KEY}.corrupt`, text)
  return {
    screen: 'title', run: null, preview: null, walk: null, blocked: null, blockedN: 0, notice: null, noticeN: 0, seen: 0,
    saved: loaded.ok ? loaded.run : null,
  }
}

/** The next move of a walk; it stops when the path ends, the run refuses the move, or the chapter ends. */
function step(s: State): State {
  if (!s.walk || !s.run) return s
  const [next, ...rest] = s.walk
  const after = move(s.run, next)
  if (after === s.run) return { ...s, walk: null, preview: null }
  const ended = after.status !== 'walking'
  const stop = ended || rest.length === 0 || key(after.at) !== key(next)
  return { ...s, run: after, walk: stop ? null : rest, preview: stop ? null : [next, ...rest], screen: ended ? 'end' : s.screen }
}

function tap(s: State, at: Off): State {
  if (s.screen !== 'world' || !s.run || s.walk || s.run.status !== 'walking') return s
  const end = s.preview?.at(-1)
  if (s.preview && end && key(end) === key(at)) return step({ ...s, walk: s.preview.slice(1), blocked: null })
  const preview = reachable(s.run).get(key(at)) ?? null
  const blocked = preview ? null : blockedCopy(s.run, at)
  return { ...s, preview, blocked, blockedN: s.blockedN + (blocked ? 1 : 0), notice: blocked ? null : s.notice }
}

/** After a change: the newest event not yet told, as the notice; every event is told from then on. */
function tell(s: State): State {
  if (!s.run || s.run.events.length <= s.seen) return s
  const notice = newestNotice(s.run.events, s.seen, s.run.hero.name)
  const told = { ...s, seen: s.run.events.length }
  return notice ? { ...told, notice, noticeN: s.noticeN + 1 } : told
}

const reduce = (s: State, a: Internal): State => tell(apply(s, a))

function apply(s: State, a: Internal): State {
  const idle = s.screen === 'world' && !!s.run && !s.walk && s.run.status === 'walking'
  switch (a.t) {
    case 'new':
      return s.screen === 'title' ? { ...s, screen: 'name' } : s
    case 'name':
      return s // started by `act`, which makes the run
    case 'started':
      return s.screen === 'name' ? { ...s, screen: 'intro', run: a.run, saved: null, preview: null, walk: null, blocked: null, notice: null, seen: 0 } : s
    case 'begin':
      return s.screen === 'intro' ? { ...s, screen: 'world' } : s
    case 'continue':
      if (s.screen === 'title' && s.saved) {
        const screen = s.saved.status === 'walking' ? 'world' : 'end'
        return { ...s, run: s.saved, saved: null, screen, notice: null, seen: s.saved.events.length }
      }
      if (s.screen === 'end') return { ...s, screen: 'title', run: null, saved: null, preview: null, walk: null, blocked: null, notice: null, seen: 0 }
      return s
    case 'tap':
      return tap(s, a.at)
    case 'step':
      return step(s)
    case 'unblock':
      return { ...s, blocked: null }
    case 'unnotice':
      return { ...s, notice: null }
    case 'pressOn':
      return idle ? { ...s, run: pressOn(s.run!), preview: null, blocked: null } : s
    case 'openCamp':
      return idle ? { ...s, screen: 'camp', preview: null, blocked: null } : s
    case 'closeCamp':
      return s.screen === 'camp' ? { ...s, screen: 'world' } : s
    case 'camp': {
      if (s.screen !== 'camp' || !s.run) return s
      const { picks } = campOptions(s.run)
      if (a.actions.length < 1 || a.actions.length > picks || new Set(a.actions).size !== a.actions.length) return s
      const run = camp(s.run, a.actions)
      return { ...s, run, screen: run.status === 'walking' ? 'world' : 'end' }
    }
    case 'pack':
      return idle ? { ...s, screen: 'pack', blocked: null } : s
    case 'closePack':
      return s.screen === 'pack' ? { ...s, screen: 'world' } : s
  }
}

export function useGame(): Game {
  const [s, dispatch] = useReducer(reduce, undefined, boot)
  const screen = useRef(s.screen)
  useEffect(() => {
    screen.current = s.screen
  }, [s.screen])

  const act = useCallback((a: GameAction) => {
    if (a.t === 'name') {
      const name = a.name.trim()
      if (screen.current !== 'name' || name.length < 1 || name.length > NAME_MAX) return
      dispatch({ t: 'started', run: startRun(name) })
      return
    }
    // A finished chapter's Continue goes back to the title: the save goes with it (M1 has one chapter).
    if (a.t === 'continue' && screen.current === 'end') storage.remove(SAVE_KEY)
    dispatch(a)
  }, [])

  // Autosave.
  useEffect(() => {
    if (s.run) storage.set(SAVE_KEY, serialise(s.run))
  }, [s.run])

  // The walk: the next move after each STEP_SECONDS.
  useEffect(() => {
    if (!s.walk) return
    const t = window.setTimeout(() => dispatch({ t: 'step' }), STEP_SECONDS * 1000)
    return () => window.clearTimeout(t)
  }, [s.walk])

  // The chip fades after a while.
  useEffect(() => {
    if (!s.blocked) return
    const t = window.setTimeout(() => dispatch({ t: 'unblock' }), CHIP_MS)
    return () => window.clearTimeout(t)
  }, [s.blocked, s.blockedN])

  // So does a notice.
  useEffect(() => {
    if (!s.notice) return
    const t = window.setTimeout(() => dispatch({ t: 'unnotice' }), NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [s.notice, s.noticeN])

  return {
    run: s.run, screen: s.screen, act, blocked: s.blocked, blockedN: s.blockedN, notice: s.notice, noticeN: s.noticeN, preview: s.preview,
    walking: !!s.walk, canContinue: !!s.saved,
  }
}
