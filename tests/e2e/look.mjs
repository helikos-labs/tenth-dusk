// Look check (ART-DIRECTION §6): the built app's world at phone size, as a picture to look at. Serves dist/ with
// `vite preview`, opens ?test=1&seed=REACH1 at 390 × 844 (deviceScaleFactor 1), starts a new journey, waits for
// window.__worldReady plus 3 s, hides every .td-layer that has no canvas, and saves tests/e2e/out/look-world.png.
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
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await browser?.close()
  stop()
}
for (const e of errors) console.error(`FAIL ${e}`)
console.log(errors.length ? 'look: FAIL' : 'look: PASS')
process.exit(errors.length ? 1 : 0)
