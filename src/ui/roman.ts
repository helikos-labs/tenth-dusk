// Roman numerals for the day plate and the beacon tally (1 to 39; the book never counts higher).
const NUMERALS: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]

export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 39) throw new RangeError(`roman(${n}): out of 1 to 39`)
  let out = ''
  for (const [v, s] of NUMERALS) {
    while (n >= v) {
      out += s
      n -= v
    }
  }
  return out
}
