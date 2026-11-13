// The title (§16): a printed title page over the dimmed world: "The First Book", the name, an ornament, an italic line,
// a wax-seal "Start a new journey" and, when there is a save, an italic "Continue".
import type { GameAction } from './useGame.ts'
import { Ornament, Page } from './Page.tsx'

export default function Title({ canContinue, act }: { canContinue: boolean; act: (a: GameAction) => void }) {
  return (
    <main className="td-layer td-book">
      <Page>
        <p className="td-over">The First Book</p>
        <h1 className="td-title">Tenth Dusk</h1>
        <Ornament />
        <p className="td-tag">Ten dusks remain before the last ember dies. Carry the lantern through the Reach.</p>
        <div className="td-menu">
          <button type="button" className="td-seal" onClick={() => act({ t: 'new' })}>
            <span>Start a new journey</span>
          </button>
          {canContinue && (
            <button type="button" className="td-alt" onClick={() => act({ t: 'continue' })}>
              Continue
            </button>
          )}
        </div>
        <p className="td-imprint">Helikos · MMXXVI</p>
      </Page>
    </main>
  )
}
