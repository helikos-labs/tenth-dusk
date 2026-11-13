// The chapter's opening (§3, §4.1), a printed page over the world as it builds behind it.
import type { GameAction } from './useGame.ts'
import { DropCap, Ornament, Page } from './Page.tsx'

export default function ChapterIntro({ act }: { act: (a: GameAction) => void }) {
  return (
    <main className="td-layer td-book td-over-world">
      <Page>
        <p className="td-over">Book I · The Saltreach</p>
        <h1 className="td-heading">Chapter 1 · The Reach Road</h1>
        <Ornament />
        <p className="td-prose">
          <DropCap text="The ember lasts ten dusks. Reach the hearth of the Reach before it dies." />
        </p>
        <div className="td-menu">
          <button type="button" className="td-seal" onClick={() => act({ t: 'begin' })}>
            <span>Begin</span>
          </button>
        </div>
      </Page>
    </main>
  )
}
