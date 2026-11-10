// The chapter's opening (§3, §4.1), over the world as it builds behind it.
import type { GameAction } from './useGame.ts'

export default function ChapterIntro({ act }: { act: (a: GameAction) => void }) {
  return (
    <main className="td-layer td-screen td-over-world">
      <div className="td-screen-body td-fade">
        <p className="td-eyebrow">Book I · The Saltreach</p>
        <h1 className="td-heading">Chapter 1 · The Reach Road</h1>
        <p className="td-prose">The ember lasts ten dusks. Reach the hearth of the Reach before it dies.</p>
        <button type="button" className="td-primary" onClick={() => act({ t: 'begin' })}>
          Begin
        </button>
      </div>
    </main>
  )
}
