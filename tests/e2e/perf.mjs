// Performance check (Task 14, §1 S3, §15.6): the built app at 390 × 844 with ?perf=1&detail=0.75 (and ?test=1, R6;
// seed REACH1, a known zone), in Chromium on SwiftShader. Starts a journey (title, name, intro), waits for
// window.__worldReady, then walks 10 moves through window.__tap (a tap previews, a second tap walks; when no move is
// left the hero camps, Rest and Tend). The first move's taps are real pointer clicks, timed through the raycast.
// Asserts:
//   - no long task over 100 ms (PerformanceObserver 'longtask') after __worldReady;
//   - __worldReady arrives under 8 s from navigation under SwiftShader (the phone target of 3 s is checked by hand);
//   - the scene keeps drawing at rest (the overlay's fps is above 0; phones draw on demand) and the drawn hero reaches
//     each hex the run moves to (window.__heroAt);
//   - no shader program is compiled during the walk (renderer.info.programs before and after);
//   - the ?perf=1 overlay shows its numbers.
// Prints the overlay's numbers (fps, worst frame, long tasks, time to world) and each long task; saves tests/e2e/out/perf.png. Run after `npm run build`: node tests/e2e/perf.mjs
// Requires Playwright with Chromium installed outside the app, as smoke.mjs does.
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
const URL = `http://localhost:${PORT}/?test=1&perf=1&detail=0.75&seed=REACH1`
/** The world must be ready this soon after navigation, under SwiftShader. */
const READY_LIMIT_MS = 8000
/** No main-thread task over this in play (§1 S3). */
const LONG_MS = 100
const MOVES = 10
/** How long the test waits for anything at all (SwiftShader is slow). */
const WAIT_MS = 60_000

const errors = []
const fail = (why) => {
  errors.push(why)
  console.error(`FAIL ${why}`)
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

const cube = ({ row, col }) => {
  const q = col + (row + (row & 1)) / 2
  return [q, -row, row - q]
}
const dist = (a, b) => Math.max(...cube(a).map((v, i) => Math.abs(v - cube(b)[i])))

/** The overlay's numbers, from its data attributes. */
const overlay = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-perf]')
    return el ? { ...el.dataset, text: el.innerText.split('\n').join(' · ') } : null
  })

let browser
try {
  await waitForServer(`http://localhost:${PORT}/`, 30_000)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('console', (m) => {
    if (m.type() === 'error') fail(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => fail(`page error: ${e.message}`))
  // Every long task, from navigation on, with its start (performance.now() ms) and what the browser blames.
  await page.addInitScript(() => {
    window.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, ms: e.duration, by: e.attribution?.[0]?.containerType ?? '' })
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.goto(URL)
  for (const name of ['Start a new journey', 'Take up the lantern', 'Begin']) await page.getByRole('button', { name, exact: true }).click({ timeout: 10_000 })
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: 180_000, polling: 100 })
  // The overlay's own time to world (navigation to __worldReady).
  await page.waitForFunction(() => document.querySelector('[data-perf]')?.dataset.world, null, { timeout: 5000 }).catch(() => {})
  const atReady = await overlay(page)
  if (!atReady) throw new Error('no ?perf=1 overlay ([data-perf]) shows')
  const readyMs = Number(atReady.world)
  console.log(`world ready ${readyMs.toFixed(0)} ms after navigation (${Number(atReady.worldFromStart).toFixed(0)} ms after the world started)`)
  if (!(readyMs < READY_LIMIT_MS)) fail(`__worldReady took ${readyMs.toFixed(0)} ms (limit ${READY_LIMIT_MS})`)
  const readyAt = readyMs
  const programsBefore = await page.evaluate(() => window.__programs())
  await page.waitForTimeout(1500)
  // At rest the scene still draws (SwiftShader takes about a second a frame here, so a 1-second count can read 0 now
  // and then: any reading above 0 within 10 s will do).
  const drawing = await page
    .waitForFunction(() => Number(document.querySelector('[data-perf]')?.dataset.fps) > 0, null, { timeout: 10_000, polling: 250 })
    .then(() => true, () => false)
  if (!drawing) fail('the overlay shows 0 fps at rest for 10 s: the scene stopped drawing')
  console.log(`overlay at rest: ${(await overlay(page)).text}`)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, 'perf.png') })
  console.log(`saved ${join(OUT, 'perf.png')}`)

  // The walk: 10 moves, each to a neighbouring reachable hex (the first that leads furthest from where the hero has been);
  // the first through real pointer clicks, timed through the raycast.
  const visited = new Set()
  const tapMs = []
  let moves = 0
  let camps = 0
  for (let guard = 0; moves < MOVES && guard < 40; guard++) {
    const { at, reach } = await page.evaluate(() => ({ at: window.__run.at, reach: window.__reach }))
    visited.add(`${at.row},${at.col}`)
    const next = reach
      .map((k) => k.split(',').map(Number))
      .map(([row, col]) => ({ row, col }))
      .filter((o) => dist(o, at) === 1)
      .sort((a, b) => Number(visited.has(`${a.row},${a.col}`)) - Number(visited.has(`${b.row},${b.col}`)) || b.row - a.row)[0]
    if (!next) {
      // No move left today: camp (Rest and Tend) and walk on at dawn.
      await page.getByRole('button', { name: 'Camp', exact: true }).click({ timeout: WAIT_MS })
      await page.getByRole('button', { name: /^Rest/ }).click({ timeout: WAIT_MS })
      await page.getByRole('button', { name: /^Tend the ember/ }).click({ timeout: WAIT_MS })
      await page.getByRole('button', { name: 'Sleep until dawn', exact: true }).click({ timeout: WAIT_MS })
      camps++
      await page.waitForTimeout(500)
      continue
    }
    if (moves === 0) {
      for (let i = 0; i < 2; i++) {
        const [x, y] = await page.evaluate(({ row, col }) => window.__project(row, col), next)
        await page.mouse.click(x, y)
        await page.waitForTimeout(300)
        const t = await page.evaluate(() => window.__lastTap)
        tapMs.push(t.ms)
        if (t.row !== next.row || t.col !== next.col) fail(`a real tap on ${next.row},${next.col} named ${t.row},${t.col}`)
      }
    } else {
      await page.evaluate(({ row, col }) => window.__tap(row, col), next)
      await page.waitForTimeout(100)
      await page.evaluate(({ row, col }) => window.__tap(row, col), next)
    }
    await page.waitForFunction(({ row, col }) => window.__run.at.row === row && window.__run.at.col === col, next, { timeout: WAIT_MS, polling: 50 })
    // The drawn hero gets there too (its spot lies within a hex's circumradius, 1, of the hex's centre): frames go on
    // while the hero walks.
    const arrived = await page
      .waitForFunction(
        ({ row, col }) => {
          const q = col + (row + (row & 1)) / 2
          const r = -row
          const [x, , z] = window.__heroAt()
          return Math.hypot(x - Math.sqrt(3) * (q + r / 2), z - 1.5 * r) < 1
        },
        next,
        { timeout: WAIT_MS, polling: 50 },
      )
      .then(() => true, () => false)
    if (!arrived) fail(`the drawn hero did not reach ${next.row},${next.col} (at ${await page.evaluate(() => window.__heroAt().map((v) => v.toFixed(2)).join(', '))})`)
    // The camera settles.
    await page.waitForTimeout(900)
    moves++
  }
  if (moves < MOVES) fail(`walked only ${moves} of ${MOVES} moves`)
  await page.waitForTimeout(1000)
  const programsAfter = await page.evaluate(() => window.__programs())
  const end = await overlay(page)
  const longs = await page.evaluate(() => window.__longTasks)
  const inPlay = longs.filter((l) => l.start >= readyAt)

  console.log(`walked ${moves} moves (${camps} camp${camps === 1 ? '' : 's'}) to ${await page.evaluate(() => `${window.__run.at.row},${window.__run.at.col}`)}`)
  console.log(`real taps: raycast and pick ${tapMs.map((m) => `${m.toFixed(1)} ms`).join(', ')}`)
  console.log(`shader programs: ${programsBefore} at world ready, ${programsAfter} after the walk`)
  console.log(`long tasks (≥ 50 ms): ${longs.length} in all, ${inPlay.length} after world ready`)
  for (const l of longs) console.log(`  ${l.start >= readyAt ? 'PLAY' : 'load'} at ${l.start.toFixed(0)} ms: ${l.ms.toFixed(0)} ms`)
  console.log(`overlay: fps ${end.fps}, worst frame ${end.worst} ms (last 10 s), long tasks ${end.long} (${end.longInPlay} in play), world ${Number(end.world).toFixed(0)} ms`)
  console.log(`overlay text: ${end.text}`)

  const over = inPlay.filter((l) => l.ms > LONG_MS)
  if (over.length) fail(`${over.length} long task(s) over ${LONG_MS} ms after world ready: ${over.map((l) => `${l.ms.toFixed(0)} ms at ${l.start.toFixed(0)}`).join(', ')}`)
  if (programsAfter > programsBefore) fail(`${programsAfter - programsBefore} shader program(s) compiled during the walk`)
  for (const k of ['fps', 'worst', 'long', 'world']) if (!(Number(end[k]) >= 0)) fail(`the overlay shows no ${k} (${end[k]})`)
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
console.log(errors.length ? 'perf: FAIL' : 'perf: PASS')
process.exit(errors.length ? 1 : 0)
