// A calm full screen for when the world can't be shown (R25): a guttered flame, what happened, and "Return to title".
// The save is never touched here, so the title offers to continue the journey.
export default function Calm({ heading, text, onReturn }: { heading: string; text: string; onReturn: () => void }) {
  return (
    <main className="td-layer td-screen" role="alert">
      <div className="td-title-mark td-fade">
        <div className="td-flame td-out" aria-hidden="true" />
      </div>
      <div className="td-screen-body td-fade-late">
        <h1 className="td-heading">{heading}</h1>
        <p className="td-prose">{text}</p>
        <button type="button" className="td-primary" onClick={onReturn}>
          Return to title
        </button>
      </div>
    </main>
  )
}
