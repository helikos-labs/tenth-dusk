// What the rules did, told in the HUD's chip slot (R24): the cold and the leeches that cost vigour, a fall back to the
// last camp (it costs a day), the Hush sinking the rows behind, a dawn push off a sunk row and a beacon lit. The HUD
// shows the newest event the player hasn't been told, one at a time; useGame counts the events already told.
import type { RunEvent } from '../rules/run.ts'

/** The chip's line for an event, with the hero's name; null for an event the HUD doesn't tell. */
export function eventCopy(e: RunEvent, name: string): string | null {
  switch (e.kind) {
    case 'cold':
      return 'The cold bites · −2 vigour'
    case 'leeches':
      return 'Leeches in the mire · −2 vigour'
    case 'fell':
      return `${name} falls · wakes at camp, a day lost`
    case 'pushed':
      return `The Hush rises · ${name} wakes further on`
    case 'sunk':
      return 'The Hush takes the land behind'
    case 'beacon':
      return 'Beacon lit · +1 max ember'
    default:
      return null
  }
}

/** The line for the newest of `events` after the first `seen` that has one, or null. */
export function newestNotice(events: RunEvent[], seen: number, name: string): string | null {
  for (let i = events.length - 1; i >= seen; i--) {
    const line = eventCopy(events[i], name)
    if (line) return line
  }
  return null
}
