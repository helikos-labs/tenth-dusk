// Look check (ART-DIRECTION §6): the built app's world at phone size, as a picture to look at. Serves dist/ with
// `vite preview`, opens ?test=1&seed=REACH1 at 390 × 844 (deviceScaleFactor 1), starts a new journey, waits for
// window.__worldReady plus 3 s, hides every .td-layer that has no canvas, and saves tests/e2e/out/look-world.png. Then it
// walks to the nearest reachable wood, zooms in on it and saves look-trees.png, asserting the trees stand out from
// the ground (mean of the brightest 15% of a 56 × 56 box at least 1.25 × its median luminance). Last, the warmth of a lit
// beacon (§3.7): the save edited (rules/save.ts's format, as flow.mjs's push step does) so the first beacon is lit and
// the land round it seen, the hero 4 hexes below it (out of the lantern's reach of both boxes), a reload and Continue;
// it saves look-warm.png and asserts the mean R ÷ B of a 40 × 40 box at the beacon is at least 1.05 × that of a box 4
// hexes across on seen land (and the same for a box on the ground just in front of the beacon, clear of its fire), and
// that this ground box is at least 1.05 × warmer than with the beacon unlit (the same save, `lit` emptied).
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

/** Mean R ÷ B (and mean RGB) over each box of a PNG screenshot. */
const redOverBlue = (page, png, boxes) =>
  page.evaluate(
    async ({ data, boxes }) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
      return boxes.map((box) => {
        const cv = new OffscreenCanvas(box.width, box.height)
        const ctx = cv.getContext('2d')
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
        const px = ctx.getImageData(0, 0, box.width, box.height).data
        let rb = 0
        const rgb = [0, 0, 0]
        const n = px.length / 4
        for (let i = 0; i < px.length; i += 4) {
          rb += px[i] / Math.max(px[i + 2], 1)
          for (let k = 0; k < 3; k++) rgb[k] += px[i + k]
        }
        return { rb: rb / n, rgb: rgb.map((v) => Math.round(v / n)) }
      })
    },
    { data: png.toString('base64'), boxes },
  )

/** A 40 × 40 box centred on a screen point, kept on the screen. */
const box40 = ([x, y]) => ({ x: Math.min(390 - 40, Math.max(0, Math.round(x - 20))), y: Math.min(844 - 40, Math.max(0, Math.round(y - 20))), width: 40, height: 40 })

/**
 * A lit beacon warms the land round it (§3.7). The save is edited: the zone's first beacon lit, a hex 4 across on its
 * row (the same depth, so the same distance fog) to compare with, the hero on the row 4 below, at least 4 hexes from
 * both (beyond the lantern's light), and every hex within 5 of the three in sight. Then a reload and Continue.
 */
async function warmth(page) {
  const plan = await page.evaluate((k) => {
    const cells = [...window.__run.zone.cells.values()].filter((c) => !c.wall)
    const ax = (c) => ({ q: c.col + (c.row + (c.row & 1)) / 2, r: -c.row })
    const dist = (a, b) => {
      const [p, q] = [ax(a), ax(b)]
      return (Math.abs(p.q - q.q) + Math.abs(p.r - q.r) + Math.abs(p.q - q.q + p.r - q.r)) / 2
    }
    // The first beacon off the zone's west edge: the wall ring there shades its first column from the low western sun,
    // and warmth scales the light a hex gets, so in that shade it barely shows.
    const beacons = cells.filter((c) => c.landmark === 'beacon')
    const beacon = beacons.find((c) => c.col > 0) ?? beacons[0]
    if (!beacon) return { why: 'no beacon in the zone' }
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
  }, SAVE_KEY)
  if (plan.why) return fail(plan.why)
  await page.reload()
  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  await page.waitForTimeout(3000)
  await bareWorld(page)
  await page.waitForTimeout(500)
  const lit = await page.evaluate(() => window.__run.lit)
  if (lit.length !== 1) fail(`the save did not load with one beacon lit (${JSON.stringify(lit)})`)
  const b = plan.beacon
  const c = plan.cold
  const boxes = [
    box40(await page.evaluate((o) => window.__project(o.row, o.col), b)),
    box40(await page.evaluate((o) => window.__project(o.row, o.col), c)),
    // Just in front of the beacon (towards the camera), on the ground, clear of the tower and its fire.
    box40(await page.evaluate((o) => window.__project(o.row, o.col, 0, 0.9), b)),
    box40(await page.evaluate((o) => window.__project(o.row, o.col, 0, 0.9), c)),
  ]
  const png = await page.screenshot({ path: join(OUT, 'look-warm.png') })
  console.log(`saved ${join(OUT, 'look-warm.png')} (beacon at ${b.row},${b.col}, compared with ${c.row},${c.col}, hero at ${plan.at})`)
  const [warm, cold, warmGround, coldGround] = await redOverBlue(page, png, boxes)
  const say = (name, w, k) => {
    const ratio = w.rb / k.rb
    console.log(`${name}: R/B ${w.rb.toFixed(3)} (rgb ${w.rgb}) against ${k.rb.toFixed(3)} (rgb ${k.rgb}) 4 hexes across, ×${ratio.toFixed(3)}`)
    if (ratio < 1.05) fail(`${name} is not warmer: R/B ${w.rb.toFixed(3)} < 1.05 × ${k.rb.toFixed(3)}`)
  }
  say('beacon box', warm, cold)
  say('ground before the beacon', warmGround, coldGround)
  // The control: the same save with the beacon unlit. The hex 4 across may be another terrain, so the ground before the
  // beacon must also be warmer lit than unlit (the same box, the same ground: only the warmth changes).
  await page.evaluate((k) => {
    const f = JSON.parse(localStorage.getItem(k))
    f.run.lit = []
    localStorage.setItem(k, JSON.stringify(f))
  }, SAVE_KEY)
  await page.reload()
  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  await page.waitForTimeout(3000)
  await bareWorld(page)
  await page.waitForTimeout(500)
  const unlitBox = box40(await page.evaluate((o) => window.__project(o.row, o.col, 0, 0.9), b))
  const [unlit] = await redOverBlue(page, await page.screenshot(), [unlitBox])
  const gain = warmGround.rb / unlit.rb
  console.log(`ground before the beacon unlit: R/B ${unlit.rb.toFixed(3)} (rgb ${unlit.rgb}), lit ×${gain.toFixed(3)}`)
  if (gain < 1.05) fail(`lighting the beacon does not warm the ground before it: R/B ${warmGround.rb.toFixed(3)} < 1.05 × ${unlit.rb.toFixed(3)} unlit`)
}

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
  await page.screenshot({ path: join(OUT, 'look-world.png') })
  console.log(`saved ${join(OUT, 'look-world.png')}`)
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
  await warmth(page)
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
for (const e of errors) console.error(`FAIL ${e}`)
console.log(errors.length ? 'look: FAIL' : 'look: PASS')
process.exit(errors.length ? 1 : 0)
