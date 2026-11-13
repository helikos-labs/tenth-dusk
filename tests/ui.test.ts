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

test('the name field keeps its pen line when focused: a heavier rubric line of 3 px or more, 3:1 on vellum, no ring', () => {
  assert.ok(!/\.td-field:focus-visible \{[^}]*outline:\s*\d/.test(css), 'no outline boxes the field')
  const field = /\.td-field \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.match(field, /outline:\s*none/)
  const line = Number(/border-bottom:\s*(\d+(?:\.\d+)?)px solid/.exec(field)?.[1])
  const rule = /\.td-field:focus \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.match(rule, /border-bottom-color:\s*var\(--td-rubric\)/)
  const shadow = /box-shadow:\s*0 (\d+(?:\.\d+)?)px 0 var\(--td-rubric\)/.exec(rule)
  assert.ok(shadow, `the focused line is thickened in rubric: ${rule}`)
  assert.ok(line + Number(shadow[1]) >= 3, `the focused line is ${line + Number(shadow[1])} px`)
  for (const paper of ['--td-vellum-hi', '--td-vellum-lo']) {
    const c = contrast(token('--td-rubric'), token(paper))
    assert.ok(c >= 3, `the line on ${paper} is ${c.toFixed(2)}`)
  }
})

test('ember orange stays off focus rings and the book backdrop; the rings reach 3:1', () => {
  for (const m of css.matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
    assert.ok(!/--td-ember|255,\s*1[0-9]{2},\s*[0-9]{1,2}\)/.test(m[2]), `${m[1].trim()} uses ember`)
  }
  const book = /\.td-book \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.ok(!/radial-gradient|--td-ember|255,\s*140/.test(book), `the book backdrop glows: ${book}`)
  const plate = /\.td-tool:focus-visible \{[^}]*outline:\s*2px solid var\((--td-[a-z-]+)\)/.exec(css)?.[1]
  assert.ok(plate, 'the iron plates have a focus ring of a token colour')
  // On the plate's iron and the wood board round it (its darkest and lightest stops).
  for (const ground of [token('--td-iron-mid'), '#3a2d23', '#1e1712']) {
    const c = contrast(token(plate), ground)
    assert.ok(c >= 3, `the plate ring on ${ground} is ${c.toFixed(2)}`)
  }
  const folio = /\.td-close:focus-visible \{[^}]*outline:\s*2px solid var\((--td-[a-z-]+)\)/.exec(css)?.[1]
  assert.equal(folio, '--td-rubric')
})

test('the ember tray keeps one row: 6 to 9 stones fit its 92 px column', () => {
  const column = Number(/\.td-face \{[^}]*grid-template-columns:\s*(\d+)px 1fr \1px/.exec(css)?.[1])
  const tray = /\.td-stones \{([^}]*)\}/.exec(css)?.[1] ?? ''
  assert.ok(!/flex-wrap:\s*wrap/.test(tray), 'the tray does not wrap')
  const m = /--stone:\s*min\((\d+)px, calc\((\d+)px \/ \(([\d.]+) \* var\(--n, 6\) - ([\d.]+)\)\)\)/.exec(tray)
  assert.ok(m, `the stone size follows the count: ${tray}`)
  const [most, room, k, less] = m.slice(1).map(Number)
  const gap = Number(/gap:\s*calc\(([\d.]+) \* var\(--stone\)\)/.exec(tray)?.[1])
  const side = Number(/padding:\s*\d+px (\d+)px/.exec(tray)?.[1])
  assert.equal(room + 2 * side, column, 'the room inside the tray and its padding fill the column')
  assert.ok(Math.abs(gap - (k - 1)) < 1e-9 && less === gap, 'the gap is the share of a stone the formula leaves for it')
  for (let n = 6; n <= 9; n++) {
    const w = Math.min(most, room / (k * n - less))
    const width = n * w + (n - 1) * gap * w
    assert.ok(width <= room + 1e-9, `${n} stones take ${width.toFixed(2)} px of ${room}`)
    assert.ok(w >= 6, `${n} stones are ${w.toFixed(2)} px wide`)
  }
  assert.equal(Math.min(most, room / (k * 6 - less)), 10, 'six stones keep their full 10 px')
})

test('buttons take their face from their own class (font: inherit only at class weight)', () => {
  assert.ok(!/\.td-layer button\s*\{/.test(css), '.td-layer button outweighs .td-close and the like')
  assert.match(css, /\.td-layer :where\(button\) \{[^}]*font: inherit/)
})
