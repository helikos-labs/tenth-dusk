// The look of the screens (ART-DIRECTION §4): the materials and type are read as text from the stylesheet and the page.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dialSweep } from '../src/ui/dial.ts'
import { roman } from '../src/ui/roman.ts'

const css = readFileSync(new URL('../src/ui/screens.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

const token = (name: string): string => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  assert.ok(m, `token ${name} is a hex colour`)
  return m[1]
}
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('no backdrop-filter', () => {
  assert.ok(!css.includes('backdrop-filter'))
})

test('old fonts gone', () => {
  for (const text of [css, html]) assert.ok(!/Barlow|Cormorant/.test(text))
})

test('new fonts loaded', () => {
  for (const f of ['IM+Fell+English', 'IM+Fell+English+SC', 'EB+Garamond']) assert.ok(html.includes(f), f)
  assert.ok(html.includes('display=swap'))
})

test('ink contrast', () => {
  const lo = token('--td-vellum-lo')
  for (const name of ['--td-ink', '--td-ink-soft', '--td-rubric']) {
    const c = contrast(token(name), lo)
    assert.ok(c >= 4.5, `${name} on vellum-lo is ${c.toFixed(2)}`)
  }
  const plate = contrast(token('--td-plate'), token('--td-iron-mid'))
  assert.ok(plate >= 4.5, `plate label on iron is ${plate.toFixed(2)}`)
})

test('materials exist', () => {
  for (const sel of ['.td-vellum', '.td-iron', '.td-rivets::before', '.td-rivets::after', '.td-seal']) {
    assert.ok(css.includes(sel), sel)
  }
  for (const t of ['--td-paper', '--td-iron', '--td-wood', '--td-grain', '--td-fell', '--td-fell-sc', '--td-garamond']) {
    assert.ok(css.includes(`${t}:`), t)
  }
})

test('reduced motion', () => {
  const m = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)
  assert.ok(m, 'a reduced-motion block')
  assert.match(m[1], /\.td-layer \*/)
  assert.match(m[1], /transition:\s*none/)
  assert.match(m[1], /animation:\s*none/)
})

test('roman numerals', () => {
  for (const [n, r] of [[1, 'I'], [3, 'III'], [4, 'IV'], [9, 'IX'], [10, 'X'], [14, 'XIV'], [39, 'XXXIX']] as const) assert.equal(roman(n), r)
  for (const n of [0, 40, -1, 1.5]) assert.throws(() => roman(n), n.toString())
})

test('the dial sweep', () => {
  assert.equal(dialSweep(1, 10), 1)
  assert.equal(dialSweep(10, 10), 0.1)
  assert.equal(dialSweep(11, 10), 0)
  assert.equal(dialSweep(0, 10), 1)
})

test('the gauge values use lining tabular Garamond figures', () => {
  const rule = /\.td-gauge-value \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.match(rule, /font-family:\s*var\(--td-garamond\)/)
  assert.match(rule, /lining-nums/)
  assert.match(rule, /tabular-nums/)
})

test('the wax seal label reads on the seal\'s lightest stop (C5)', () => {
  const face = /\.td-seal::before \{([^}]*)\}/.exec(css)?.[1] ?? ''
  const stops = [...face.matchAll(/radial-gradient\([^,]*,\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
  assert.equal(stops.length, 1, 'the seal face is one radial gradient starting at its lightest stop')
  const label = /\.td-seal > \* \{[^}]*?color:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]
  assert.ok(label, 'the seal label has a hex colour')
  const c = contrast(label, stops[0])
  assert.ok(c >= 4.5, `seal label on its lightest stop is ${c.toFixed(2)}`)
})

test('the retired glass and 500-weight label styles are gone', () => {
  assert.ok(!css.includes('.td-glass {'))
  assert.ok(!/\.td-label \{[^}]*font-weight:\s*[56]00/.test(css))
})

test('the disabled camp gain keeps 4.5:1 on vellum', () => {
  const rule = /\.td-entry:disabled \.td-gain \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.ok(!/opacity/.test(rule), 'no opacity on the disabled gain')
  const colour = /color:\s*var\((--td-[a-z-]+)\)/.exec(rule)?.[1]
  assert.ok(colour, 'the disabled gain names a token colour')
  const c = contrast(token(colour), token('--td-vellum-lo'))
  assert.ok(c >= 4.5, `disabled gain on vellum-lo is ${c.toFixed(2)}`)
})
