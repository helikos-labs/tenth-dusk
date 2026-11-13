// The camp sheet (§5.1): the night's actions, 2 of them (3 at a safe camp), then sleep until dawn. Reading the stars
// shows, disabled, until rumour pins are drawn (M2, R23); the rules still record rumours.
import { useState } from 'react'
import { campOptions, type NightAction, type RunState } from '../rules/run.ts'
import type { GameAction } from './useGame.ts'
import { DropCap } from './Page.tsx'

const TITLE = 'Tend the night'
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
      <section className="td-folio td-vellum" aria-labelledby="td-camp-title">
        <h2 id="td-camp-title" className="td-folio-title">
          <DropCap text={TITLE} />
        </h2>
        <p className="td-folio-sub">The light goes. Choose what to do before you sleep.</p>
        <div className="td-folio-rule">
          <span className="td-folio-count">
            Choose {picks} · {chosen.length} / {picks}
          </span>
        </div>
        <div className="td-entries">
          {OPTIONS.map((o) => {
            const on = chosen.includes(o.id)
            return (
              <button key={o.id} type="button" className="td-entry" aria-pressed={on} disabled={o.later || (full && !on)} onClick={() => toggle(o.id)}>
                <span className="td-box" aria-hidden="true" />
                <span className="td-entry-body">
                  <span className="td-entry-name">{o.name}</span>
                  <span className="td-entry-text">{o.text.trim()}</span>
                </span>
                {o.gain && <span className="td-gain">{o.gain}</span>}
              </button>
            )
          })}
        </div>
        <p className="td-note">Reading the stars arrives in the next update</p>
        <div className="td-seal-row">
          <button type="button" className="td-close" aria-label="Close" onClick={() => act({ t: 'closeCamp' })}>
            Not yet
          </button>
          <button type="button" className="td-seal" disabled={chosen.length === 0} onClick={() => act({ t: 'camp', actions: chosen })}>
            <span>Sleep until dawn</span>
          </button>
        </div>
      </section>
    </div>
  )
}
