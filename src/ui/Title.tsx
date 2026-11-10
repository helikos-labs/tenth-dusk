// The title (§16): the game's name over a small ember; "Continue" when there is a save, and "Start a new journey".
import type { GameAction } from './useGame.ts'

export default function Title({ canContinue, act }: { canContinue: boolean; act: (a: GameAction) => void }) {
  return (
    <main className="td-layer td-screen">
      <div className="td-title-mark td-fade">
        <div className="td-flame" aria-hidden="true" />
        <h1 className="td-title">Tenth Dusk</h1>
      </div>
      <div className="td-screen-body td-fade-late">
        {canContinue && (
          <button type="button" className="td-primary" onClick={() => act({ t: 'continue' })}>
            Continue
          </button>
        )}
        <button type="button" className={canContinue ? 'td-secondary' : 'td-primary'} onClick={() => act({ t: 'new' })}>
          Start a new journey
        </button>
      </div>
    </main>
  )
}
