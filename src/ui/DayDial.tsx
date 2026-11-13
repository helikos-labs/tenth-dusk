// The day plate's dial (ART-DIRECTION §4.3): an arc whose ember-coloured fill drains across the days, the sun at its lit
// end, and "III of X" beneath. The sweep is dialSweep(); the words are Roman numerals.
import { dialSweep } from './dial.ts'
import { roman } from './roman.ts'

const CX = 31
const CY = 24
const RX = 26
const RY = 21

export default function DayDial({ day, days }: { day: number; days: number }) {
  const phi = Math.PI * dialSweep(day, days)
  const sx = CX - RX * Math.cos(phi)
  const sy = CY - RY * Math.sin(phi)
  const shown = Math.min(Math.max(day, 1), days)
  return (
    <div className="td-dial" aria-hidden="true">
      <svg viewBox="0 0 62 26">
        <path d="M5 24 A26 21 0 0 1 57 24" fill="none" stroke="rgba(60,40,20,.22)" strokeWidth="4" strokeLinecap="round" />
        {phi > 0.01 && (
          <path d={`M5 24 A26 21 0 0 1 ${sx.toFixed(2)} ${sy.toFixed(2)}`} fill="none" stroke="#b5561e" strokeWidth="4" strokeLinecap="round" />
        )}
        <g stroke="#4e3f2d" strokeWidth="1">
          <line x1="31" y1="1" x2="31" y2="5" />
          <line x1="10" y1="12" x2="13" y2="14" />
          <line x1="52" y1="12" x2="49" y2="14" />
        </g>
        <circle cx={sx.toFixed(2)} cy={sy.toFixed(2)} r="3.4" fill="#ffb35e" stroke="#7a2a0c" strokeWidth="1" />
      </svg>
      <div className="td-dayword">
        <b>{roman(shown)}</b> <i>of</i> {roman(days)}
      </div>
    </div>
  )
}
