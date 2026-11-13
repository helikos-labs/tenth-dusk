// Look check (ART-DIRECTION §6): the built app's world at phone size, as a picture to look at. Serves dist/ with
// `vite preview`, opens ?test=1&seed=REACH1 at 390 × 844 (deviceScaleFactor 1), starts a new journey, waits for
// window.__worldReady plus 3 s, hides every .td-layer that has no canvas, and saves tests/e2e/out/look-world.png, with the
// vignette and grain (.td-atmos, §3.8), which must never take a tap. No falling ash over the unseen (C7, §3.6): two
// pictures 600 ms apart differ by a mean under 6 levels over a 120 × 120 box of the unseen mist at the top centre (the
// mist moves slowly), and in it and in a box of the unseen mist just beyond the seen ground (where the flakes' box
// reaches) fewer than 20 pixels change by over 40 levels (the mist alone moves a pixel by at most about 35; a flake
// over it by up to about 95). Then it
// walks to the nearest reachable wood, zooms in on it and saves look-trees.png, asserting the trees stand out from
// the ground (mean of the brightest 15% of a 56 × 56 box at least 1.25 × its median luminance). Last, the warmth of lit
// beacons (§3.7): the save edited (rules/save.ts's format, as flow.mjs's push step does) so one beacon is lit and the
// land round it seen, the hero 4 hexes below it (out of the lantern's reach), a reload and Continue, then the same with
// it unlit. For the first beacon off the west edge (in the sun) it saves look-warm.png, and for the zone's first (in the
// wall ring's shade) look-warm-shade.png. Warmth is ΣR ÷ ΣB over a 40 × 40 box. For both, the ground just in front of
// the beacon must be at least 1.05 × warmer lit than unlit (and gain 2 levels of R − B); in the sun, the beacon's box
// and that ground box must also be 1.05 × the boxes 4 hexes across on seen land.
// Run after `npm run build`: node tests/e2e/look.mjs   (Playwright must resolve, as in smoke.mjs)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(APP, 'tests', 'e2e', 'out')
const PORT = 4181
const URL = `http://localhost:${PORT}/?test=1&seed=REACH1`
const READY_MS = 180_000
const SAVE_KEY = 'tenth-dusk.save.v1'

const errors = []
const fail = (why) => {
  errors.push(why)
}

/** Hide every HUD or screen layer without a canvas, so a picture shows the bare world. */
const bareWorld = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('.td-layer')) if (!el.querySelector('canvas')) el.style.display = 'none'
  })

/**
 * The warmth of each box of a PNG screenshot: ΣR ÷ ΣB over its pixels (luminance-weighted, so near-black pixels, where
 * one 8-bit step moves a per-pixel ratio by several per cent, count for little), mean R − B, and the mean RGB.
 */
const warmthOf = (page, png, boxes) =>
  page.evaluate(
    async ({ data, boxes }) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
      return boxes.map((box) => {
        const cv = new OffscreenCanvas(box.width, box.height)
        const ctx = cv.getContext('2d')
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
        const px = ctx.getImageData(0, 0, box.width, box.height).data
        const rgb = [0, 0, 0]
        const n = px.length / 4
        for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) rgb[k] += px[i + k]
        return { rb: rgb[0] / Math.max(rgb[2], 1), rMinusB: (rgb[0] - rgb[2]) / n, rgb: rgb.map((v) => Math.round(v / n)) }
      })
    },
    { data: png.toString('base64'), boxes },
  )

/** A 40 × 40 box centred on a screen point, kept on the screen. */
const box40 = ([x, y]) => ({ x: Math.min(390 - 40, Math.max(0, Math.round(x - 20))), y: Math.min(844 - 40, Math.max(0, Math.round(y - 20))), width: 40, height: 40 })

const show = (w) => `R/B ${w.rb.toFixed(3)}, R−B ${w.rMinusB.toFixed(1)} (rgb ${w.rgb})`

/** Reload the page and continue the saved run, then show the bare world. */
async function continueRun(page) {
  await page.reload()
  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  await page.waitForTimeout(3000)
  await bareWorld(page)
  await page.waitForTimeout(500)
}

/**
 * One lit beacon in the saved run (the beacon `pick` chooses: 'shade', the zone's first, in its first column, which the
 * west wall ring shades from the low sun; or 'sun', the first off that edge). The save is edited: that beacon lit, a
 * hex 4 across on its row (the same depth, so the same distance fog) to compare with, the hero on the row 4 below, at
 * least 4 hexes from both (beyond the lantern's light), and every hex within 5 of the three in sight. Then a reload and
 * Continue, a picture, and the same with the beacon unlit.
 */
async function warmth(page, pick, picture) {
  const plan = await page.evaluate(
    ({ k, pick }) => {
      const cells = [...window.__run.zone.cells.values()].filter((c) => !c.wall)
      const ax = (c) => ({ q: c.col + (c.row + (c.row & 1)) / 2, r: -c.row })
      const dist = (a, b) => {
        const [p, q] = [ax(a), ax(b)]
        return (Math.abs(p.q - q.q) + Math.abs(p.r - q.r) + Math.abs(p.q - q.q + p.r - q.r)) / 2
      }
      const beacons = cells.filter((c) => c.landmark === 'beacon')
      const beacon = pick === 'shade' ? beacons.find((c) => c.col === 0) : beacons.find((c) => c.col > 0)
      if (!beacon) return { why: `no beacon for the ${pick} check` }
      const across = cells.filter((c) => c.row === beacon.row && dist(c, beacon) === 4 && c.terrain !== 'river' && c.terrain !== 'lake')
      across.sort((a, b) => (b.terrain === beacon.terrain) - (a.terrain === beacon.terrain))
      const cold = across[0]
      if (!cold) return { why: `no land 4 hexes across from the beacon at ${beacon.row},${beacon.col}` }
      const spots = cells.filter((c) => c.row === beacon.row - 4 && !c.landmark && dist(c, beacon) >= 4 && dist(c, cold) >= 4)
      spots.sort((a, b) => Math.abs(dist(a, beacon) - dist(a, cold)) - Math.abs(dist(b, beacon) - dist(b, cold)))
      const at = spots[0]
      if (!at) return { why: 'nowhere for the hero 4 rows below the beacon' }
      const f = JSON.parse(localStorage.getItem(k))
      const key = (c) => `${c.row},${c.col}`
      f.run.lit = [key(beacon)]
      f.run.at = { row: at.row, col: at.col }
      const fog = new Map(f.run.fog)
      for (const c of cells) if ([beacon, cold, at].some((o) => dist(c, o) <= 5)) fog.set(key(c), 3)
      f.run.fog = [...fog]
      localStorage.setItem(k, JSON.stringify(f))
      return { beacon: { row: beacon.row, col: beacon.col }, cold: { row: cold.row, col: cold.col }, at: key(at) }
    },
    { k: SAVE_KEY, pick },
  )
  if (plan.why) return fail(plan.why)
  const b = plan.beacon
  const c = plan.cold
  const name = `beacon ${b.row},${b.col} (${pick})`
  // At the beacon, 4 hexes across, and on the ground just in front of each (towards the camera), clear of the tower and
  // its fire.
  const boxes = async () => [
    box40(await page.evaluate((o) => window.__project(o.row, o.col), b)),
    box40(await page.evaluate((o) => window.__project(o.row, o.col), c)),
    box40(await page.evaluate((o) => window.__project(o.row, o.col, 0, 0.9), b)),
    box40(await page.evaluate((o) => window.__project(o.row, o.col, 0, 0.9), c)),
  ]
  await continueRun(page)
  const lit = await page.evaluate(() => window.__run.lit)
  if (lit.length !== 1) fail(`${name}: the save did not load with one beacon lit (${JSON.stringify(lit)})`)
  const png = await page.screenshot({ path: join(OUT, picture) })
  console.log(`saved ${join(OUT, picture)} (${name}, compared with ${c.row},${c.col}, hero at ${plan.at})`)
  const [warm, cold, warmGround, coldGround] = await warmthOf(page, png, await boxes())
  // The control: the same save with the beacon unlit, the same boxes.
  await page.evaluate((k) => {
    const f = JSON.parse(localStorage.getItem(k))
    f.run.lit = []
    localStorage.setItem(k, JSON.stringify(f))
  }, SAVE_KEY)
  await continueRun(page)
  const [, , unlitGround] = await warmthOf(page, await page.screenshot(), await boxes())
  console.log(`${name}: at the beacon ${show(warm)}; 4 hexes across ${show(cold)}`)
  console.log(`${name}: ground before it lit ${show(warmGround)}; unlit ${show(unlitGround)}; 4 hexes across ${show(coldGround)}`)
  const atLeast = (what, a, k) => {
    if (a.rb < 1.05 * k.rb) fail(`${name}: ${what}: ΣR/ΣB ${a.rb.toFixed(3)} < 1.05 × ${k.rb.toFixed(3)}`)
  }
  // Lit against unlit (the same box, the same ground: only the warmth changes), for both beacons. In the sun, also the
  // beacon and the ground before it against the hex 4 across (in the shade that hex is in the sun, so no fair match).
  atLeast('the ground before it, lit against unlit', warmGround, unlitGround)
  if (warmGround.rMinusB < unlitGround.rMinusB + 2) fail(`${name}: lit, the ground before it gains under 2 levels of R − B`)
  if (pick === 'sun') {
    atLeast('the beacon against the hex 4 across', warm, cold)
    atLeast('the ground before it against the ground 4 across', warmGround, coldGround)
  }
}

/**
 * Boxes over the unseen mist at the start (REACH1, the hero at 0,4 near the bottom edge): 120 × 120 at the top centre,
 * and 120 × 120 just beyond the seen ground, where flakes would show if the fog didn't hide them (the flakes' box,
 * ashfall.ts ASH.box, round the hero doesn't reach the top centre).
 */
const UNSEEN_TOP = { x: 135, y: 40, width: 120, height: 120 }
const UNSEEN_NEAR = { x: 135, y: 300, width: 120, height: 120 }

/**
 * No falling ash over the unseen (C7): a second picture 600 ms after `first`. Over UNSEEN_TOP the mean absolute
 * difference per channel must be under 6 levels (the mist moves slowly); over both boxes fewer than 20 pixels may
 * change by over 40 levels in any channel (measured with the fog's gate on the flakes switched off: about 75 do).
 */
async function unseenStill(page, first) {
  await page.waitForTimeout(600)
  const second = await page.screenshot()
  for (const [name, box] of [['top centre', UNSEEN_TOP], ['beyond the seen ground', UNSEEN_NEAR]]) {
    const d = await boxDiff(page, first, second, box)
    console.log(`unseen ${name} 600 ms apart: mean |Δ| ${d.mean.toFixed(2)}, ${d.jumps} pixels change by over 40 (rgb ${d.rgb})`)
    if (box === UNSEEN_TOP && d.mean >= 6) fail(`the unseen ${name} changes by a mean of ${d.mean.toFixed(2)} levels in 600 ms (at most 6)`)
    if (d.jumps >= 20) fail(`${d.jumps} pixels of the unseen ${name} jump by over 40 levels in 600 ms (falling ash over the unseen?)`)
  }
}

/** Over `box` of two PNG screenshots: the mean absolute difference per channel, how many pixels change by over 40 in
 * any channel, and the first's mean RGB. */
const boxDiff = (page, first, second, box) =>
  page.evaluate(
    async ({ a, b, box }) => {
      const read = async (data) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
        const cv = new OffscreenCanvas(box.width, box.height)
        const ctx = cv.getContext('2d')
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
        return ctx.getImageData(0, 0, box.width, box.height).data
      }
      const [p, q] = [await read(a), await read(b)]
      let sum = 0
      let jumps = 0
      for (let i = 0; i < p.length; i += 4) {
        let most = 0
        for (let k = 0; k < 3; k++) {
          const v = Math.abs(p[i + k] - q[i + k])
          sum += v
          most = Math.max(most, v)
        }
        if (most > 40) jumps++
      }
      const n = p.length / 4
      return { mean: sum / (3 * n), jumps, rgb: [0, 1, 2].map((k) => Math.round(p.filter((_, i) => i % 4 === k).reduce((s, v) => s + v, 0) / n)) }
    },
    { a: first.toString('base64'), b: second.toString('base64'), box },
  )

async function waitForServer(url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`vite preview did not answer at ${url}`)
}

if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`FAIL port ${PORT} is already in use`)
  process.exit(1)
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
server.stderr.on('data', (d) => process.stderr.write(d))
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    // already gone
  }
}
let browser
try {
  await waitForServer(`http://localhost:${PORT}/`, 30_000)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => fail(`page error: ${e.message}`))
  await page.goto(URL)
  for (const name of ['Start a new journey', 'Take up the lantern', 'Begin']) await page.getByRole('button', { name, exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  await page.waitForTimeout(3000)
  // The bare world: every HUD or screen layer without a canvas out of the picture.
  await bareWorld(page)
  await page.waitForTimeout(300)
  mkdirSync(OUT, { recursive: true })
  const first = await page.screenshot({ path: join(OUT, 'look-world.png') })
  console.log(`saved ${join(OUT, 'look-world.png')}`)
  await unseenStill(page, first)
  const atmos = await page.evaluate(() => {
    const el = document.querySelector('.td-atmos')
    return el && { pointerEvents: getComputedStyle(el).pointerEvents, hidden: el.getAttribute('aria-hidden') }
  })
  if (!atmos) fail('no .td-atmos layer over the world')
  else if (atmos.pointerEvents !== 'none' || atmos.hidden !== 'true') fail(`.td-atmos: pointer-events ${atmos.pointerEvents}, aria-hidden ${atmos.hidden}`)
  // Close shot of a wood: zoom in over the nearest reachable forest hex (the hero stays where it is), and measure.
  const wood = await page.evaluate(() => {
    const at = window.__run.at
    const cells = window.__reach.map((k) => window.__run.zone.cells.get(k)).filter((c) => c.terrain === 'forest')
    cells.sort((a, b) => Math.hypot(a.row - at.row, a.col - at.col) - Math.hypot(b.row - at.row, b.col - at.col))
    return cells[0] ? { row: cells[0].row, col: cells[0].col } : null
  })
  if (!wood) fail('no reachable forest hex to take a close shot of')
  else {
    const [cx, cy] = await page.evaluate((w) => window.__project(w.row, w.col), wood)
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120)
    await page.waitForTimeout(2500)
    await bareWorld(page)
    await page.waitForTimeout(500)
    const [bx, by] = await page.evaluate((w) => window.__project(w.row, w.col), wood)
    const box = { x: Math.max(0, Math.round(bx - 28)), y: Math.max(0, Math.round(by - 28)), width: 56, height: 56 }
    const png = await page.screenshot({ path: join(OUT, 'look-trees.png') })
    console.log(`saved ${join(OUT, 'look-trees.png')} (wood at ${wood.row},${wood.col}, box ${box.x},${box.y})`)
    const lum = await page.evaluate(
      async ({ data, box }) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
        const cv = new OffscreenCanvas(box.width, box.height)
        const ctx = cv.getContext('2d')
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
        const px = ctx.getImageData(0, 0, box.width, box.height).data
        const ls = []
        for (let i = 0; i < px.length; i += 4) ls.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])
        ls.sort((a, b) => a - b)
        const top = ls.slice(Math.floor(ls.length * 0.85))
        return { top: top.reduce((a, b) => a + b, 0) / top.length, median: ls[Math.floor(ls.length / 2)] }
      },
      { data: png.toString('base64'), box },
    )
    console.log(`wood box luminance: top 15% mean ${lum.top.toFixed(1)}, median ${lum.median.toFixed(1)}, ratio ${(lum.top / Math.max(lum.median, 1)).toFixed(2)}`)
    if (lum.top < 1.25 * lum.median) fail(`trees do not stand out: top 15% ${lum.top.toFixed(1)} < 1.25 × median ${lum.median.toFixed(1)}`)
  }
  await warmth(page, 'sun', 'look-warm.png')
  await warmth(page, 'shade', 'look-warm-shade.png')
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
for (const e of errors) console.error(`FAIL ${e}`)
console.log(errors.length ? 'look: FAIL' : 'look: PASS')
process.exit(errors.length ? 1 : 0)
