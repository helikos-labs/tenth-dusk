// A calm full screen for when the world can't be shown (R25): a small printed page with what happened and "Return to
// title". The save is never touched here, so the title offers to continue the journey.
import { Ornament, Page } from './Page.tsx'

export default function Calm({ heading, text, onReturn }: { heading: string; text: string; onReturn: () => void }) {
  return (
    <main className="td-layer td-book td-book-notice" role="alert">
      <Page small>
        <h1 className="td-heading">{heading}</h1>
        <Ornament />
        <p className="td-prose">{text}</p>
        <div className="td-menu">
          <button type="button" className="td-seal" onClick={onReturn}>
            <span>Return to title</span>
          </button>
        </div>
      </Page>
    </main>
  )
}
