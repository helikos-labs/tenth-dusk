/** The fraction of the day dial's arc still lit on a given day of `days`: the whole arc on day 1, the last tenth on day 10. */
export function dialSweep(day: number, days: number): number {
  return Math.min(1, Math.max(0, (days - day + 1) / days))
}
