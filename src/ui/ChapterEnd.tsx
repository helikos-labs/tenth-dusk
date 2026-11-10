// The chapter's end (§5.1): the hearth reached, or the ember out (the journey goes on with a scar). In M1 "Continue"
// returns to the title.
import type { RunState } from '../rules/run.ts'
import type { GameAction } from './useGame.ts'

export default function ChapterEnd({ run, act }: { run: RunState; act: (a: GameAction) => void }) {
  const hearth = run.status === 'hearth'
  return (
    <main className="td-layer td-screen td-over-world">
      <div className="td-title-mark td-fade-late">
        <div className={hearth ? 'td-flame' : 'td-flame td-out'} aria-hidden="true" />
      </div>
      <div className="td-screen-body td-fade-late">
        <p className="td-eyebrow">Chapter 1 · The Reach Road</p>
        {hearth ? (
          <p className="td-prose">The hearth takes the ember. It burns bright again.</p>
        ) : (
          <>
            <p className="td-prose">The ember gutters out. The Hush takes the Reach.</p>
            <p className="td-prose td-quiet">Your journey goes on, marked by this loss.</p>
          </>
        )}
        <button type="button" className="td-primary" onClick={() => act({ t: 'continue' })}>
          Continue
        </button>
      </div>
    </main>
  )
}
