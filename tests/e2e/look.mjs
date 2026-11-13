// Look check (ART-DIRECTION §6): the built app's world at phone size, as a picture to look at. Serves dist/ with
// `vite preview`, opens ?test=1&seed=REACH1 at 390 × 844 (deviceScaleFactor 1), starts a new journey, waits for
// window.__worldReady plus 3 s, hides every .td-layer that has no canvas, and saves tests/e2e/out/look-world.png. Then it
// walks to the nearest reachable wood, zooms in on it and saves look-trees.png, asserting the trees stand out from
// the ground (mean of the brightest 15% of a 56 × 56 box at least 1.25 × its median luminance).
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

const errors = []
const fail = (why) => {
  errors.push(why)
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
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.td-layer')) if (!el.querySelector('canvas')) el.style.display = 'none'
  })
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
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('.td-layer')) if (!el.querySelector('canvas')) el.style.display = 'none'
    })
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
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
for (const e of errors) console.error(`FAIL ${e}`)
console.log(errors.length ? 'look: FAIL' : 'look: PASS')
process.exit(errors.length ? 1 : 0)
