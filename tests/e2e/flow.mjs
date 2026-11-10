// Flow test (Task 13): the game's screens around the world, at phone size, in the built app. Serves dist/ with
// `vite preview` and drives Chromium (SwiftShader WebGL) with ?test=1 (R6). First, a new journey without `&seed=` gets
// a fresh seed (6 capitals and digits). Then, for each of a fixed list of seeds (SEEDS, through `&seed=`, R19 and R21;
// or the seeds given on the command line), in a fresh browser context:
//   1. clear storage; Title → "Start a new journey" → name "Ash" → "Take up the lantern" → "Begin";
//   2. the HUD shows "DAY 1 / 10" and "6 / 6";
//   3. a hex 2 away tapped twice: the hero walks there and the steps fall;
//   4. a reload, then "Continue": the same day and steps, and "Ash" in the Pack;
//   5. a tap on a peaks wall hex the Hush hasn't taken (a seen one if any): the chip "Can't cross";
//   6. Camp ("Read the stars" disabled, with its note, R23), Rest and Tend, "Sleep until dawn": "DAY 2 / 10" and
//      "6 / 6";
//   6b. the save edited so the Hush is 6 rows ahead, a reload, Continue, a camp: the hero is pushed off the sunk row
//      and the chip tells it (R24); after a reload and Continue the chip does not show again; back to the title;
//   7. at 360 × 640 the HUD's top bar, tracker and bottom bar don't overlap; at 844 × 390, "Turn your phone upright";
//   8. corrupt text under the save key and a reload: "Start a new journey" shows and the text is set aside under
//      `…corrupt`.
// Fails on any console error or page error. Saves a picture of each screen at 390 × 844 and at 360 × 640 in
// tests/e2e/out/ (flow-<size>-<screen>.png), for the first seed; the night HUD and both chapter ends come from the save,
// edited. Run after `npm run build`: node tests/e2e/flow.mjs [SEED ...]
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
const PORT = 4180
const BASE = `http://localhost:${PORT}/?test=1`
/**
 * Chapter 1 zones the flow runs on: each has a hex 2 away the hero can reach from the start (some seeds have none, so a
 * random seed made the walk step flaky).
 */
const SEEDS = process.argv.length > 2 ? process.argv.slice(2) : ['REACH1', 'JS388J', 'ILLWZA']
/** Pictures are saved for the first seed only. */
let pictures = true
const SAVE_KEY = 'tenth-dusk.save.v1'
/** WebGL on SwiftShader is slow: the world can take a while to build and draw. */
const READY_MS = 180_000
const SEEN_MS = 10_000

const errors = []
const fail = (why) => {
  errors.push(why)
  console.error(`FAIL ${why}`)
}
const pass = (what) => console.log(`ok ${what}`)

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

/** Whether text (exactly, a whole element's text) shows within SEEN_MS. */
const shows = (page, text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: SEEN_MS })
    .then(() => true, () => false)
const expectText = async (page, text, what) => ((await shows(page, text)) ? pass(`${what}: "${text}"`) : fail(`${what}: "${text}" does not show`))
const press = (page, name) => page.getByRole('button', { name, exact: true }).click({ timeout: SEEN_MS })
/**
 * A picture of the screen, once its fade-ins are done (every finite animation finished; SwiftShader's frames are slow)
 * and `wait` ms more; `settle` false for the chip, which fades out.
 */
const shot = async (page, size, name, settle = true, wait = 300) => {
  if (!pictures) return
  if (settle) {
    await page
      .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity), null, { timeout: SEEN_MS, polling: 100 })
      .catch(() => console.log(`(${name}: animations still running)`))
    await page.waitForTimeout(wait)
  }
  const path = join(OUT, `flow-${size}-${name}.png`)
  await page.screenshot({ path })
  console.log(`saved ${path}`)
}
const worldReady = (page) => page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
const save = (page) => page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)

// The hexes 2 away from a hex (offset coordinates, odd rows shifted right).
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
async function tapUntilPreview(page, from) {
  for (const o of twoAway(from)) {
    await page.evaluate(({ row, col }) => window.__tap(row, col), o)
    await page.waitForTimeout(150)
    if ((await page.evaluate(() => window.__preview?.length ?? 0)) > 1) return o
  }
  return null
}
/**
 * Taps a peaks hex of the wall ring that the Hush hasn't taken (at or above the run's sunkBelow; a sunk one rightly
 * says "Lost to the Hush"), one the hero has seen or remembers if there is one, else the nearest; returns it.
 */
const tapPeaksWall = (page) =>
  page.evaluate(() => {
    const run = window.__run
    const cube = ({ row, col }) => {
      const q = col + (row + (row & 1)) / 2
      return [q, -row, row - q]
    }
    const far = (c) => Math.max(...cube(c).map((v, i) => Math.abs(v - cube(run.at)[i])))
    const seen = (c) => (run.fog.get(`${c.row},${c.col}`) ?? 0) >= 2
    const c = [...run.zone.cells.values()]
      .filter((c) => c.wall && c.terrain === 'peaks' && c.row >= run.sunkBelow)
      .sort((a, b) => Number(seen(b)) - Number(seen(a)) || far(a) - far(b))[0]
    window.__tap(c.row, c.col)
    return { row: c.row, col: c.col, seen: seen(c) }
  })

/**
 * The night HUD and the two chapter ends, each from the current save changed: a picture of each; the save is put back.
 */
async function savedScreens(page, size) {
  const kept = await save(page)
  const variants = [
    ['night', { night: true, steps: 0, nightSteps: 3 }],
    ['end-hearth', { status: 'hearth' }],
    ['end-expired', { status: 'expired' }],
  ]
  for (const [name, patch] of variants) {
    await page.evaluate(({ k, text, patch }) => {
      const f = JSON.parse(text)
      Object.assign(f.run, patch)
      localStorage.setItem(k, JSON.stringify(f))
    }, { k: SAVE_KEY, text: kept, patch })
    await page.reload()
    await press(page, 'Continue')
    if (name === 'night') {
      await worldReady(page)
      await expectText(page, 'Night 3', `night steps at ${size}`)
    } else if (name === 'end-hearth') {
      await expectText(page, 'The hearth takes the ember. It burns bright again.', `chapter end (hearth) at ${size}`)
    } else {
      await expectText(page, 'The ember gutters out. The Hush takes the Reach.', `chapter end (expired) at ${size}`)
      await expectText(page, 'Your journey goes on, marked by this loss.', `chapter end (expired) at ${size}`)
    }
    await shot(page, size, name)
  }
  await page.evaluate(({ k, text }) => localStorage.setItem(k, text), { k: SAVE_KEY, text: kept })
  await page.reload()
}

/**
 * The save edited so the furthest row is 6 ahead of the hero (the Hush will take their row at dawn), then a camp: the
 * hero is pushed, and the chip says so; after a reload and Continue it does not show again.
 */
async function pushed(page, size) {
  const kept = await save(page)
  await page.evaluate(({ k, text }) => {
    const f = JSON.parse(text)
    f.run.furthestRow = f.run.at.row + 6
    localStorage.setItem(k, JSON.stringify(f))
  }, { k: SAVE_KEY, text: kept })
  await page.reload()
  await press(page, 'Continue')
  await worldReady(page)
  const from = await page.evaluate(() => window.__run.at)
  await press(page, 'Camp')
  await page.getByRole('button', { name: /^Rest/ }).click()
  await press(page, 'Sleep until dawn')
  const line = 'The Hush rises · Ash wakes further on'
  if (await shows(page, line)) pass(`chip after a dawn push: "${line}"`)
  else fail(`no chip "${line}" after a dawn push`)
  await shot(page, size, 'pushed', false)
  const to = await page.evaluate(() => window.__run.at)
  if (to.row > from.row) pass(`pushed from ${from.row},${from.col} to ${to.row},${to.col}`)
  else fail(`the hero was not pushed (${from.row},${from.col} → ${to.row},${to.col})`)
  await page.reload()
  await press(page, 'Continue')
  await worldReady(page)
  await page.waitForTimeout(1500)
  if (await page.locator('.td-notice').count()) fail('the push chip shows again after a reload')
  else pass('no chip repeats after a reload')
  // Back to the title, so this page's world stops drawing while the next page runs (SwiftShader is shared).
  await page.reload()
}

/** A new journey without `&seed=`: its seed is fresh, 6 capitals and digits. */
async function freshSeed(browser) {
  const context = await newContext(browser)
  const page = await context.newPage()
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await press(page, 'Start a new journey')
  await press(page, 'Take up the lantern')
  // The world (and its test hooks) mounts with the chapter intro.
  await page.waitForFunction(() => !!window.__run, null, { timeout: SEEN_MS, polling: 100 })
  const seed = await page.evaluate(() => window.__run.zone.seed)
  if (/^[A-Z0-9]{6}$/.test(seed) && !SEEDS.includes(seed)) pass(`a fresh seed for the journey: ${seed}`)
  else fail(`the journey's seed is ${JSON.stringify(seed)}, not a fresh 6 capitals and digits`)
  await context.close()
}

/** A browser context at 390 × 844 that fails the test on any console error or page error. */
async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  context.on('console', (m) => {
    if (m.type() === 'error') fail(`console error: ${m.text()}`)
  })
  context.on('weberror', (e) => fail(`page error: ${e.error().message}`))
  return context
}

/** Steps 1 to 8 on `seed`'s zone, in a fresh context. */
async function flow(browser, seed) {
  const URL = `${BASE}&seed=${seed}`
  const context = await newContext(browser)
  const page = await context.newPage()
  const S = '390x844'

  // 1. A new journey.
  await page.goto(URL)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expectText(page, 'Tenth Dusk', 'title')
  if (await page.getByRole('button', { name: 'Continue' }).count()) fail('the title offers "Continue" without a save')
  await shot(page, S, 'title')
  await press(page, 'Start a new journey')
  await expectText(page, 'Name your Lampwright', 'naming')
  const field = page.getByRole('textbox')
  if ((await field.inputValue()) !== 'Wren') fail(`the name field starts as "${await field.inputValue()}", not "Wren"`)
  await shot(page, S, 'name')
  await field.fill('Ash')
  await press(page, 'Take up the lantern')
  await expectText(page, 'Book I · The Saltreach', 'chapter intro')
  await expectText(page, 'Chapter 1 · The Reach Road', 'chapter intro')
  await expectText(page, 'The ember lasts ten dusks. Reach the hearth of the Reach before it dies.', 'chapter intro')
  await shot(page, S, 'intro')
  await press(page, 'Begin')
  await worldReady(page)
  await page.waitForTimeout(1000)
  const seed0 = await page.evaluate(() => window.__run.zone.seed)
  if (seed0 !== seed) fail(`the journey's seed is ${JSON.stringify(seed0)}, not ${seed}`)

  // 2. The HUD.
  await expectText(page, 'DAY 1 / 10', 'HUD day')
  await expectText(page, '6 / 6', 'HUD steps')
  await expectText(page, 'The Reach Road', 'HUD chapter')
  await expectText(page, 'Light the beacons 0/3', 'tracker')
  await expectText(page, 'Reach the hearth', 'tracker')
  await expectText(page, '30 / 30', 'HUD vigour')
  await shot(page, S, 'world')

  // 3. A walk of 2.
  const at = await page.evaluate(() => window.__run.at)
  const target = await tapUntilPreview(page, at)
  if (!target) throw new Error('no hex 2 away shows a path preview')
  await page.waitForTimeout(600)
  await shot(page, S, 'preview')
  await page.evaluate(({ row, col }) => window.__tap(row, col), target)
  await page.waitForFunction(({ row, col }) => window.__run.at.row === row && window.__run.at.col === col, target, { timeout: 30_000, polling: 100 })
  await page.waitForTimeout(800)
  const walked = await page.evaluate(() => ({ day: window.__run.day, steps: window.__run.steps }))
  if (walked.steps < 6) pass(`walked to ${target.row},${target.col}: steps 6 → ${walked.steps}`)
  else fail(`the steps did not fall (${walked.steps})`)
  await expectText(page, `${walked.steps} / 6`, 'HUD steps after the walk')
  await shot(page, S, 'walked')

  // 4. A reload keeps the run.
  await page.reload()
  await expectText(page, 'Tenth Dusk', 'title after a reload')
  await press(page, 'Continue')
  await worldReady(page)
  await expectText(page, `DAY ${walked.day} / 10`, 'HUD day after a reload')
  await expectText(page, `${walked.steps} / 6`, 'HUD steps after a reload')
  await press(page, 'Pack')
  await expectText(page, 'Ash', 'the hero name in the Pack')
  await shot(page, S, 'pack-gear')
  await page.getByRole('tab', { name: /^Satchel/ }).click()
  await expectText(page, 'Relics arrive in the next update', 'Pack relics note')
  await shot(page, S, 'pack-satchel')
  await press(page, 'Close')

  // 5. A wall.
  const wall = await tapPeaksWall(page)
  await expectText(page, "Can't cross", `chip on the peaks wall hex ${wall.row},${wall.col} (${wall.seen ? 'seen' : 'unseen'})`)
  // A second blocked tap while the chip shows: a new chip (its fade starts again), not the old one kept. Both taps in
  // one evaluate, so the first chip can't time out in between.
  const fresh = await page.evaluate((c) => {
    const chip = () => [...document.querySelectorAll('.td-chip')].find((el) => el.textContent === "Can't cross")
    const first = chip()
    window.__tap(c.row, c.col)
    return new Promise((done) => setTimeout(() => done(!!first && !first.isConnected && !!chip()), 100))
  }, wall)
  if (fresh) pass('a repeat blocked tap shows a fresh chip')
  else fail('a repeat blocked tap kept the old chip, whose fade has run on')
  await shot(page, S, 'blocked', false)

  // 6. A night's camp.
  await press(page, 'Camp')
  await expectText(page, 'Tend the night', 'camp sheet')
  if (await page.getByRole('button', { name: /^Read the stars/ }).isDisabled()) pass('"Read the stars" is disabled')
  else fail('"Read the stars" can be picked in M1')
  await expectText(page, 'Reading the stars arrives in the next update', 'camp sheet note')
  await page.getByRole('button', { name: /^Rest/ }).click()
  await page.getByRole('button', { name: /^Tend the ember/ }).click()
  const picks = await page.evaluate(() => (['camp', 'cave'].includes(window.__run.zone.cells.get(`${window.__run.at.row},${window.__run.at.col}`).landmark) ? 3 : 2))
  await expectText(page, `Choose ${picks} · 2 / ${picks}`, 'camp count')
  await shot(page, S, 'camp')
  await press(page, 'Sleep until dawn')
  await expectText(page, 'DAY 2 / 10', 'HUD day after camp')
  await expectText(page, '6 / 6', 'HUD steps after camp')
  await shot(page, S, 'dawn')

  await savedScreens(page, S)

  // 6b. A dawn push, told by a chip, once.
  await pushed(page, S)

  // 7. A small phone, then landscape.
  const small = await context.newPage()
  await small.setViewportSize({ width: 360, height: 640 })
  const T = '360x640'
  await small.goto(URL)
  await expectText(small, 'Tenth Dusk', 'title at 360 × 640')
  await shot(small, T, 'title')
  await press(small, 'Continue')
  await worldReady(small)
  await small.waitForTimeout(1000)
  const boxes = {}
  for (const part of ['top', 'tracker', 'bottom']) boxes[part] = await small.locator(`[data-hud="${part}"]`).boundingBox()
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  const inside = (a) => a.x >= 0 && a.y >= 0 && a.x + a.width <= 360 && a.y + a.height <= 640
  for (const [a, b] of [['top', 'tracker'], ['top', 'bottom'], ['tracker', 'bottom']]) {
    if (!boxes[a] || !boxes[b]) fail(`no HUD ${!boxes[a] ? a : b} at 360 × 640`)
    else if (overlap(boxes[a], boxes[b])) fail(`the HUD's ${a} and ${b} overlap at 360 × 640`)
    else pass(`HUD ${a} and ${b} apart at 360 × 640`)
  }
  for (const [part, b] of Object.entries(boxes)) if (b && !inside(b)) fail(`the HUD's ${part} runs off a 360 × 640 screen`)
  await shot(small, T, 'world')
  const wallSmall = await tapPeaksWall(small)
  await expectText(small, "Can't cross", `chip at 360 × 640 on the peaks wall hex ${wallSmall.row},${wallSmall.col}`)
  await shot(small, T, 'blocked', false)
  await press(small, 'Camp')
  await small.getByRole('button', { name: /^Rest/ }).click()
  await shot(small, T, 'camp')
  await press(small, 'Close')
  await press(small, 'Pack')
  await shot(small, T, 'pack-gear')
  await small.getByRole('tab', { name: /^Satchel/ }).click()
  await shot(small, T, 'pack-satchel')
  await press(small, 'Close')

  await small.setViewportSize({ width: 844, height: 390 })
  await expectText(small, 'Turn your phone upright', 'upright overlay at 844 × 390')
  await shot(small, '844x390', 'upright')
  await small.setViewportSize({ width: 360, height: 640 })
  if (await small.getByText('Turn your phone upright').isVisible()) fail('the upright overlay stays in portrait')

  await savedScreens(small, T)
  await press(small, 'Start a new journey')
  await shot(small, T, 'name')
  await press(small, 'Take up the lantern')
  await expectText(small, 'Chapter 1 · The Reach Road', 'chapter intro at 360 × 640')
  await shot(small, T, 'intro')

  // 8. A corrupt save.
  await small.evaluate((k) => localStorage.setItem(k, '{"v":1,"savedAt":'), SAVE_KEY)
  await small.reload()
  await expectText(small, 'Start a new journey', 'title after a corrupt save')
  if (await small.getByRole('button', { name: 'Continue' }).count()) fail('the title offers "Continue" for a corrupt save')
  const aside = await small.evaluate((k) => localStorage.getItem(`${k}.corrupt`), SAVE_KEY)
  if (aside === '{"v":1,"savedAt":') pass('the corrupt save is set aside under …corrupt')
  else fail(`…corrupt holds ${JSON.stringify(aside)}`)
  await context.close()
}

let browser
try {
  mkdirSync(OUT, { recursive: true })
  await waitForServer(`http://localhost:${PORT}/`, 30_000)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  await freshSeed(browser)
  for (const seed of SEEDS) {
    console.log(`--- seed ${seed}`)
    await flow(browser, seed)
    pictures = false
  }
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
console.log(errors.length ? `flow: FAIL (${errors.length})` : 'flow: PASS')
process.exit(errors.length ? 1 : 0)
