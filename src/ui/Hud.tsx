// The HUD over the world (§5, §16): the top bar (the day with the sun's arc across it, the chapter, the ember), the
// tracker, the chip (a blocked tap's, else what the rules just did, R24) and the bottom bar (vigour, the steps left,
// and Move · Camp · Pack · Journal). Move walks the path previewed (as a second tap on its end does), or presses on into
// the night when no move is left by day; Journal waits for a later milestone.
import { useMemo, type CSSProperties } from 'react'
import { LAST_DAY, NIGHT_STEPS, STEPS_PER_DAY, type RunState } from '../rules/run.ts'
import type { Off } from '../rules/hex.ts'
import DayDial from './DayDial.tsx'
import { Icon, type IconName } from './Icons.tsx'
import { roman } from './roman.ts'
import { canPressOn, type GameAction } from './useGame.ts'

interface HudProps {
  run: RunState
  preview: Off[] | null
  walking: boolean
  blocked: string | null
  blockedN: number
  notice: string | null
  noticeN: number
  act: (a: GameAction) => void
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth']
/** An event notice's line split on " · ": the lead in rubric, the rest in ink.  */
const noteLines = (line: string) => {
  const at = line.indexOf(' · ')
  if (at < 0) return line
  return (
    <>
      <b>{line.slice(0, at)}</b>
      {line.slice(at)}
    </>
  )
}

/** One iron plate of the bottom board: an icon over a Fell small-caps label. */
function Plate({
  icon,
  label,
  hot,
  disabled,
  onClick,
}: {
  icon: IconName
  label: string
  hot?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={hot ? 'td-tool td-iron td-rivets td-ready' : 'td-tool td-iron td-rivets'}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={26} />
      <span className="td-tool-label">{label}</span>
    </button>
  )
}

/** "Chapter the Third" from a zone's chapter id ("b1c3"). */
const chapterLine = (id: string): string => {
  const n = Number(/c(\d+)$/.exec(id)?.[1] ?? 1)
  return `Chapter the ${ORDINALS[n - 1] ?? roman(n)}`
}

export default function Hud({ run, preview, walking, blocked, blockedN, notice, noticeN, act }: HudProps) {
  const beacons = useMemo(() => [...run.zone.cells.values()].filter((c) => c.landmark === 'beacon').length, [run.zone])
  const end = preview?.at(-1)
  const night = !end && !walking && canPressOn(run)
  const left = run.night ? run.nightSteps : run.steps
  const segs = run.night ? Math.max(NIGHT_STEPS, run.nightSteps) : STEPS_PER_DAY
  return (
    <div className="td-layer td-hud">
      <div className="td-hud-head">
        <div className="td-top td-iron td-rivets" data-hud="top">
          <header className="td-face td-vellum">
            <div className="td-day">
              <span className="td-sr">
                DAY {run.day} / {LAST_DAY}
              </span>
              <DayDial day={run.day} days={LAST_DAY} />
            </div>
            <div className="td-chapter">
              <div className="td-chapter-line">{chapterLine(run.zone.chapter)}</div>
              <div className="td-chapter-name">The Reach Road</div>
            </div>
            <div className="td-ember" aria-label={`Ember ${run.hero.ember} of ${run.hero.maxEmber}`}>
              <span className="td-ember-label" aria-hidden="true">
                Ember
              </span>
              <span className="td-stones" aria-hidden="true" style={{ '--n': run.hero.maxEmber } as CSSProperties}>
                {Array.from({ length: run.hero.maxEmber }, (_, i) => (
                  <i key={i} className={i < run.hero.ember ? 'td-stone td-lit' : 'td-stone'} />
                ))}
              </span>
            </div>
          </header>
        </div>
        <div className="td-slip-wrap">
          <span className="td-nail" aria-hidden="true" />
          <section className="td-slip td-vellum" data-hud="tracker" aria-label="Goals">
            <div className={run.lit.length >= beacons ? 'td-goal td-done' : 'td-goal'}>
              <span className="td-sr">
                Light the beacons {run.lit.length}/{beacons}
              </span>
              <span aria-hidden="true">Light the beacons</span>
              <span className="td-tally" aria-hidden="true">
                {run.lit.length ? roman(run.lit.length) : '–'} · {beacons ? roman(beacons) : '–'}
              </span>
            </div>
            <div className={run.status === 'hearth' ? 'td-goal td-done' : 'td-goal'}>
              <span>Reach the hearth</span>
            </div>
          </section>
        </div>
      </div>
      <div className="td-hud-foot">
        <div className="td-chip-slot" aria-live="polite">
          {blocked ? (
            <span key={`blocked-${blockedN}`} className="td-chip td-vellum">
              {blocked}
            </span>
          ) : (
            notice && (
              <span key={`notice-${noticeN}`} className="td-chip td-vellum td-notice">
                {noteLines(notice)}
              </span>
            )
          )}
        </div>
        <footer className="td-bottom td-board" data-hud="bottom">
          <div className="td-gauges">
            <div>
              <div className="td-gauge-head">
                <span className="td-label">Vigour</span>
                <span className="td-gauge-value">
                  {run.hero.vigour}
                  <small> / {run.hero.maxVigour}</small>
                </span>
              </div>
              <div className="td-groove">
                <i
                  style={{
                    width: `${(100 * Math.max(0, run.hero.vigour)) / run.hero.maxVigour}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="td-gauge-head">
                <span className="td-label">Steps</span>
                <span className="td-gauge-value">
                  {run.night ? (
                    `Night ${run.nightSteps}`
                  ) : (
                    <>
                      {run.steps}
                      <small> / {STEPS_PER_DAY}</small>
                    </>
                  )}
                </span>
              </div>
              <div className={run.night ? 'td-notches td-night' : 'td-notches'}>
                {Array.from({ length: segs }, (_, i) => (
                  <i key={i} className={i < left ? 'td-lit' : undefined} />
                ))}
              </div>
            </div>
          </div>
          <nav className="td-tools">
            <Plate
              icon="boot"
              label={night ? 'Press on' : 'Move'}
              hot={!!(end || night)}
              disabled={walking || (!end && !night)}
              onClick={() => (end ? act({ t: 'tap', at: end }) : act({ t: 'pressOn' }))}
            />
            <Plate icon="tent" label="Camp" disabled={walking} onClick={() => act({ t: 'openCamp' })} />
            <Plate icon="satchel" label="Pack" disabled={walking} onClick={() => act({ t: 'pack' })} />
            <Plate icon="book" label="Journal" disabled />
          </nav>
        </footer>
      </div>
    </div>
  )
}
