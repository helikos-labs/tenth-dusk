// The pack (§11.1): the Lampwright's gear (6 slots) and satchel (8 slots, stacks of up to 3). Relics come in a later
// update; their tab shows, disabled.
import { useState } from 'react'
import type { GearSlot } from '../data/kit.ts'
import type { RunState } from '../rules/run.ts'
import type { GameAction } from './useGame.ts'

const GEAR: { slot: GearSlot; label: string }[] = [
  { slot: 'weapon', label: 'Weapon' },
  { slot: 'shield', label: 'Shield' },
  { slot: 'lantern', label: 'Lantern' },
  { slot: 'cloak', label: 'Cloak' },
  { slot: 'boots', label: 'Boots' },
  { slot: 'charm', label: 'Charm' },
]
const SATCHEL_SLOTS = 8
const TIER = ['', 'I', 'II', 'III', 'IV']
/** Item names; any other id reads as words ("fur-cloak" → "Fur cloak"). */
const NAMES: Record<string, string> = { draught: 'Healing draught' }
const nameOf = (id: string) => NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ')

export default function Pack({ run, act }: { run: RunState; act: (a: GameAction) => void }) {
  const [tab, setTab] = useState<'gear' | 'satchel'>('gear')
  const { hero } = run
  const initial = Array.from(hero.name)[0] ?? ''
  const rest = hero.name.slice(initial.length)
  return (
    <div className="td-layer td-pack">
      <section className="td-folio td-vellum" aria-labelledby="td-pack-title">
        <h2 id="td-pack-title" className="td-folio-title">
          <span className="td-cap">{initial}</span>
          <span>{rest}</span>
        </h2>
        <p className="td-folio-sub">The Lampwright</p>
        <div className="td-folio-rule" />
        <div className="td-tabs" role="tablist">
          <button type="button" role="tab" className="td-tab" aria-selected={tab === 'gear'} onClick={() => setTab('gear')}>
            Gear
          </button>
          <button type="button" role="tab" className="td-tab" aria-selected={tab === 'satchel'} onClick={() => setTab('satchel')}>
            Satchel
            <small>
              {hero.satchel.length}/{SATCHEL_SLOTS}
            </small>
          </button>
          <button type="button" role="tab" className="td-tab" aria-selected={false} disabled>
            Relics
          </button>
        </div>
        <p className="td-note">Relics arrive in the next update</p>
        {tab === 'gear' ? (
          <div className="td-slots td-gear" role="tabpanel">
            {GEAR.map(({ slot, label }) => {
              const g = hero.gear[slot]
              return (
                <div key={slot} className={g ? 'td-slot' : 'td-slot td-empty'}>
                  <span className="td-slot-label">{label}</span>
                  <span className="td-slot-name">{g ? nameOf(g.id) : '—'}</span>
                  {g && <span className="td-tier">{TIER[g.tier]}</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="td-slots td-satchel" role="tabpanel">
            {Array.from({ length: SATCHEL_SLOTS }, (_, i) => {
              const it = hero.satchel[i]
              return (
                <div key={i} className={it ? 'td-slot' : 'td-slot td-empty'}>
                  <span className="td-slot-name">{it ? nameOf(it.id) : ''}</span>
                  {it && <span className="td-count">×{it.n}</span>}
                </div>
              )
            })}
          </div>
        )}
        <div className="td-seal-row">
          <button type="button" className="td-close" aria-label="Close" onClick={() => act({ t: 'closePack' })}>
            Close
          </button>
        </div>
      </section>
    </div>
  )
}
