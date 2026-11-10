// Flow test (Task 13): the game's screens around the world, at phone size, in the built app. Serves dist/ with
// `vite preview` and drives Chromium (SwiftShader WebGL) with ?test=1 (R6):
//   1. clear storage; Title → "Start a new journey" → name "Ash" → "Take up the lantern" → "Begin";
//   2. the HUD shows "DAY 1 / 10" and "6 / 6";
//   3. a hex 2 away tapped twice: the hero walks there and the steps fall;
//   4. a reload, then "Continue": the same day and steps, and "Ash" in the Pack;
//   5. a tap on a peaks wall hex: the chip "Can't cross";
//   6. Camp, Rest and Tend, "Sleep until dawn": "DAY 2 / 10" and "6 / 6";
//   7. at 360 × 640 the HUD's top bar, tracker and bottom bar don't overlap; at 844 × 390, "Turn your phone upright";
//   8. corrupt text under the save key and a reload: "Start a new journey" shows and the text is set aside under
//      `…corrupt`.
// Fails on any console error or page error. Saves a picture of each screen at 390 × 844 and at 360 × 640 in
// tests/e2e/out/ (flow-<size>-<screen>.png); the night HUD and both chapter ends come from the save, edited. Run after `npm run build`: node tests/e2e/flow.mjs
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
const URL = `http://localhost:${PORT}/?test=1`
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
/** Taps a peaks hex of the wall ring; returns it. */
const tapPeaksWall = (page) =>
  page.evaluate(() => {
    const c = [...window.__run.zone.cells.values()].find((c) => c.wall && c.terrain === 'peaks')
    window.__tap(c.row, c.col)
    return { row: c.row, col: c.col }
  })

/**
 * The night HUD and the two chapter ends, each from the current save changed: a picture of each; the save is put back.
 */
async function savedScreens(page, size) {
  const kept = await save(page)
  const variants = [
    ['night', { night: true, steps: 0, nightSteps: 2 }],
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
      await expectText(page, 'Night 2 / 2', `night steps at ${size}`)
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

let browser
try {
  mkdirSync(OUT, { recursive: true })
  await waitForServer(`http://localhost:${PORT}/`, 30_000)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  context.on('console', (m) => {
    if (m.type() === 'error') fail(`console error: ${m.text()}`)
  })
  context.on('weberror', (e) => fail(`page error: ${e.error().message}`))
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
  const seed = await page.evaluate(() => window.__run.zone.seed)
  if (/^[A-Z0-9]{6}$/.test(seed)) pass(`a fresh seed for the journey: ${seed}`)
  else fail(`the journey's seed is ${JSON.stringify(seed)}, not 6 capitals and digits`)

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
  await expectText(page, "Can't cross", `chip on the peaks wall hex ${wall.row},${wall.col}`)
  await shot(page, S, 'blocked', false)

  // 6. A night's camp.
  await press(page, 'Camp')
  await expectText(page, 'Tend the night', 'camp sheet')
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
  await tapPeaksWall(small)
  await expectText(small, "Can't cross", 'chip at 360 × 640')
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
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
console.log(errors.length ? `flow: FAIL (${errors.length})` : 'flow: PASS')
process.exit(errors.length ? 1 : 0)
