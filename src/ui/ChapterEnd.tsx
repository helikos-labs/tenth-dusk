// The chapter's end (§5.1): the hearth reached, or the ember out (the journey goes on with a scar). In M1 "Continue"
// returns to the title.
import type { RunState } from '../rules/run.ts'
import type { GameAction } from './useGame.ts'
import { DropCap, Ornament, Page } from './Page.tsx'

export default function ChapterEnd({ run, act }: { run: RunState; act: (a: GameAction) => void }) {
  const hearth = run.status === 'hearth'
  return (
    <main className="td-layer td-book td-book-fit td-over-world">
      <Page fit>
        <p className="td-over">
          Chapter <span className="td-fig">1</span> · The Reach Road
        </p>
        <Ornament />
        {hearth ? (
          <p className="td-prose">
            <DropCap text="The hearth takes the ember. It burns bright again." />
          </p>
        ) : (
          <>
            <p className="td-prose">
              <DropCap text="The ember gutters out. The Hush takes the Reach." />
            </p>
            <p className="td-prose td-quiet">Your journey goes on, marked by this loss.</p>
          </>
        )}
        <div className="td-menu">
          <button type="button" className="td-seal" onClick={() => act({ t: 'continue' })}>
            <span>Continue</span>
          </button>
        </div>
      </Page>
    </main>
  )
}
