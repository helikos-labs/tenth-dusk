// The camp sheet (§5.1): the night's actions, 2 of them (3 at a safe camp), then sleep until dawn. Reading the stars
// shows, disabled, until rumour pins are drawn (M2, R23); the rules still record rumours.
import { useState } from 'react'
import { campOptions, type NightAction, type RunState } from '../rules/run.ts'
import type { GameAction } from './useGame.ts'

const OPTIONS: { id: NightAction; name: string; text: string; gain?: string; later?: boolean }[] = [
  { id: 'rest', name: 'Rest', text: 'Recover ', gain: '+10 vigour' },
  { id: 'tend', name: 'Tend the ember', text: 'Restore ', gain: '+2 ember' },
  { id: 'forage', name: 'Forage', text: 'Find food' },
  { id: 'stars', name: 'Read the stars', text: 'Reveal ', gain: 'one rumour', later: true },
]

export default function CampSheet({ run, act }: { run: RunState; act: (a: GameAction) => void }) {
  const { picks } = campOptions(run)
  const [chosen, setChosen] = useState<NightAction[]>([])
  const full = chosen.length >= picks
  const toggle = (id: NightAction) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < picks ? [...c, id] : c))
  return (
    <div className="td-layer td-sheet-back">
      <div className="td-corner">
        <button type="button" className="td-close" aria-label="Close" onClick={() => act({ t: 'closeCamp' })}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <section className="td-sheet td-glass td-fade" aria-labelledby="td-camp-title">
        <div className="td-sheet-head">
          <h2 id="td-camp-title" className="td-sheet-title">
            Tend the night
          </h2>
          <span className="td-label">
            Choose {picks} · {chosen.length} / {picks}
          </span>
        </div>
        <div className="td-options">
          {OPTIONS.map((o) => {
            const on = chosen.includes(o.id)
            return (
              <button key={o.id} type="button" className="td-option" aria-pressed={on} disabled={o.later || (full && !on)} onClick={() => toggle(o.id)}>
                <span className="td-option-name">{o.name}</span>
                <span className="td-option-text">
                  {o.text}
                  {o.gain && <span className="td-gain">{o.gain}</span>}
                </span>
              </button>
            )
          })}
        </div>
        <p className="td-note">Reading the stars arrives in the next update</p>
        <button type="button" className="td-primary" disabled={chosen.length === 0} onClick={() => act({ t: 'camp', actions: chosen })}>
          Sleep until dawn
        </button>
      </section>
    </div>
  )
}
