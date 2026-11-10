// Smoke test (§17): the built app renders the zone's world at phone size. Serves dist/ with `vite preview`, opens it at
// 390 × 844 in Chromium on SwiftShader, starts a new journey (title, name, intro), waits for window.__worldReady
// (exposed with ?test=1, R4 and R6), and fails on any console error or page error, or when the canvas's centre
// 50 × 50 pixels are all one colour. Saves
// tests/e2e/out/world.png. Then checks the default zoom (the hero's hex is at least 44 CSS px wide and tall, §1 S4),
// taps reachable hexes (flat and sloped) and the start's waystone for real (pointer clicks), checking the hex each
// names, taps a hex 2 away twice (a preview, then a walk) and checks that the hero moved and the steps left dropped; with a
// new preview showing where the steps left allow one, saves tests/e2e/out/walk.png (and the first preview,
// preview.png). Last, loses the WebGL context (window.__loseContext, WEBGL_lose_context, §16 and R25): "Restoring the
// world…" shows, then a new canvas draws the world again (__worldReady, the centre check) with the hero where they
// stood; saves tests/e2e/out/restored.png. Run after `npm run build`: node tests/e2e/smoke.mjs
// Requires Playwright with Chromium installed outside the app (not a dependency of it): `require('playwright')` must
// resolve, as it does in the cloud sessions' environment (NODE_PATH points at the pre-installed copy).
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(APP, 'tests', 'e2e', 'out')
const PORT = 4179
// A known zone: chapter 1 for seed REACH1 (a new journey's seed is fresh each time without `seed`).
const URL = `http://localhost:${PORT}/?test=1&seed=REACH1`
/** WebGL on SwiftShader is slow: the world can take a while to build and draw. */
const READY_MS = 180_000

const errors = []
const fail = (why) => {
  errors.push(why)
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`vite preview did not answer at ${url}`)
}

// A server left on the port would be tested in place of this build.
if (await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)) {
  console.error(`FAIL port ${PORT} is already in use`)
  process.exit(1)
}
// Its own process group, so stopping it stops vite and not only npx.
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
let code = 1
try {
  await waitForServer(`http://localhost:${PORT}/`, 30_000)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => fail(`page error: ${e.message}`))
  const t0 = Date.now()
  await page.goto(URL)
  // A new journey (a fresh browser has no save): the title, the hero's default name, the chapter intro.
  for (const name of ['Start a new journey', 'Take up the lantern', 'Begin']) await page.getByRole('button', { name, exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  // A few frames more, so the plants and shadows that came with the world are on screen too.
  await page.waitForTimeout(1500)
  console.log(`world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // The canvas's centre 50 × 50 pixels, as the screen shows them, read back through a 2D canvas.
  const centreColours = async () => {
    const box = await page.locator('canvas').boundingBox()
    if (!box) throw new Error('no canvas')
    const clip = { x: Math.round(box.x + box.width / 2 - 25), y: Math.round(box.y + box.height / 2 - 25), width: 50, height: 50 }
    const centre = (await page.screenshot({ clip })).toString('base64')
    return page.evaluate(async (png) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      return seen.size
    }, centre)
  }
  const colours = await centreColours()
  console.log(`${colours} colours in the canvas's centre 50 × 50`)
  if (colours <= 1) fail('the canvas centre is one colour: nothing drawn')

  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, 'world.png') })
  console.log(`saved ${join(OUT, 'world.png')}`)

  // The default zoom (§1 S4): the hero's hex on screen, its width (between its centre and its neighbour's in the
  // row) and its height (corner to corner), at least 44 CSS px.
  const at = await page.evaluate(() => window.__run.at)
  const hex = await page.evaluate(({ row, col }) => {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    const p = window.__project
    return { width: d(p(row, col), p(row, col + 1)), height: d(p(row, col, 0, -1), p(row, col, 0, 1)) }
  }, at)
  console.log(`hero's hex at the default zoom: ${hex.width.toFixed(1)} × ${hex.height.toFixed(1)} CSS px`)
  if (Math.min(hex.width, hex.height) < 44) fail(`a hex is under 44 px at the default zoom (${hex.width.toFixed(1)} × ${hex.height.toFixed(1)})`)

  // Real taps (a pointer click on the canvas, through the raycast and the warp): on the centre of a reachable hex, the
  // preview ends there; on the hilliest reachable hex likewise; on the start's waystone, a Landmark taller than its
  // hex is deep at this pitch, the tap names the waystone's hex, not the ground behind it.
  const click = async (o, dy = 0) => {
    const [x, y] = await page.evaluate(({ o, dy }) => window.__project(o.row, o.col, 0, 0, dy), { o, dy })
    await page.mouse.click(x, y)
    await page.waitForTimeout(400)
  }
  const reach = await page.evaluate(() =>
    window.__reach.map((k) => {
      const c = window.__run.zone.cells.get(k)
      return { row: c.row, col: c.col, level: c.level, terrain: c.terrain }
    }),
  )
  const flat = reach.find((c) => c.level === 0) ?? reach[0]
  const hill = [...reach].sort((a, b) => b.level - a.level)[0]
  for (const [what, o] of [['flat', flat], ['sloped', hill]]) {
    await click(o)
    const end = await page.evaluate(() => window.__preview?.at(-1) ?? null)
    const ok = end && end.row === o.row && end.col === o.col
    console.log(`real tap on ${what} hex ${o.row},${o.col} (${o.terrain}, level ${o.level}): preview ends at ${end ? `${end.row},${end.col}` : 'nothing'}`)
    if (!ok) fail(`a real tap on ${o.row},${o.col} did not preview a path to it`)
  }
  // (The waystone is too short for the ground behind its top to lie in another hex, so the check is that the
  // Landmark itself was hit, which is what keeps a tall one from naming the hex behind it.)
  await click(at, 1.0)
  const named = await page.evaluate(() => window.__lastTap)
  console.log(`real tap on the start waystone (1.0 above ${at.row},${at.col}): named ${named.row},${named.col} by the ${named.via}`)
  if (named.row !== at.row || named.col !== at.col || named.via !== 'landmark') {
    fail(`a tap on the waystone at ${at.row},${at.col} named ${named.row},${named.col} by the ${named.via}`)
  }
  // The hero's own hex is not reachable: the preview is cleared.
  if (await page.evaluate(() => window.__preview)) fail('a tap on the hero’s own hex left a preview')

  // Tap a hex 2 away (the first that previews a path), then tap it again: the hero walks there.
  const cube = ({ row, col }) => {
    const q = col + (row + (row & 1)) / 2
    return [q, -row, row - q]
  }
  const dist = (a, b) => Math.max(...cube(a).map((v, i) => Math.abs(v - cube(b)[i])))
  const twoAway = (from) => {
    const out = []
    for (let row = from.row - 2; row <= from.row + 2; row++)
      for (let col = from.col - 3; col <= from.col + 3; col++) if (dist(from, { row, col }) === 2) out.push({ row, col })
    return out
  }
  const tapUntilPreview = async (from) => {
    for (const o of twoAway(from)) {
      await page.evaluate(({ row, col }) => window.__tap(row, col), o)
      await page.waitForTimeout(200)
      const n = await page.evaluate(() => window.__preview?.length ?? 0)
      if (n > 1) return o
    }
    return null
  }
  const before = await page.evaluate(() => ({ hero: window.__heroAt(), steps: window.__run.steps }))
  const target = await tapUntilPreview(at)
  if (!target) throw new Error('no hex 2 away shows a path preview')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'preview.png') })
  await page.evaluate(({ row, col }) => window.__tap(row, col), target)
  await page.waitForFunction(({ row, col }) => window.__run.at.row === row && window.__run.at.col === col, target, { timeout: 30_000, polling: 100 })
  // The last move's walk, and a frame or two.
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => ({ hero: window.__heroAt(), steps: window.__run.steps }))
  const moved = Math.hypot(after.hero[0] - before.hero[0], after.hero[2] - before.hero[2])
  console.log(`walked to ${target.row},${target.col}: hero moved ${moved.toFixed(2)} units, steps ${before.steps} → ${after.steps}`)
  if (moved < 1) fail(`the hero did not move (${moved.toFixed(2)} units)`)
  if (!(after.steps < before.steps)) fail(`the steps left did not drop (${before.steps} → ${after.steps})`)

  // A new preview from where the hero stands, for the picture.
  if (!(await tapUntilPreview(target))) console.log('no further preview from there (picture without a path)')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'walk.png') })
  console.log(`saved ${join(OUT, 'walk.png')}`)

  // A lost WebGL context: "Restoring the world…", then the scene remounts on a new canvas and draws the world again.
  const stood = await page.evaluate(() => window.__run.at)
  const lost = await page.evaluate(() => {
    window.__lostCanvas = document.querySelector('canvas')
    return window.__loseContext()
  })
  if (!lost) throw new Error('no WEBGL_lose_context to lose the context with')
  const restoring = page.getByText('Restoring the world…', { exact: true })
  if (await restoring.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) console.log('context lost: "Restoring the world…" shows')
  else fail('a lost context does not show "Restoring the world…"')
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  await page.waitForTimeout(1500)
  const remounted = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return !!c && c !== window.__lostCanvas && !window.__lostCanvas.isConnected
  })
  const back = await centreColours()
  const at2 = await page.evaluate(() => window.__run.at)
  console.log(`context restored: a new canvas ${remounted}, ${back} colours in its centre, the hero at ${at2.row},${at2.col}`)
  if (!remounted) fail('the scene did not remount on a new canvas after the context came back')
  if (back <= 1) fail('the restored canvas centre is one colour: nothing drawn')
  if (at2.row !== stood.row || at2.col !== stood.col) fail(`the hero moved from ${stood.row},${stood.col} to ${at2.row},${at2.col} over the context loss`)
  if (await restoring.isVisible()) fail('"Restoring the world…" stays after the world is back')
  await page.screenshot({ path: join(OUT, 'restored.png') })
  console.log(`saved ${join(OUT, 'restored.png')}`)
  code = errors.length ? 1 : 0
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
for (const e of errors) console.error(`FAIL ${e}`)
console.log(code === 0 && !errors.length ? 'smoke: PASS' : 'smoke: FAIL')
process.exit(errors.length ? 1 : code)
