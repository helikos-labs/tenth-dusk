// The portrait guard: a phone held sideways (wider than tall, under 1000 px wide) is asked to turn upright. Shown by
// a media query in screens.css, so it follows the screen without a render.
export default function Upright() {
  return (
    <div className="td-layer td-upright" role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M11 18.5h2" />
      </svg>
      <p className="td-heading">Turn your phone upright</p>
    </div>
  )
}
