// Smoke test (§17): the built app renders the zone's world at phone size. Serves dist/ with `vite preview`, opens it at
// 390 × 844 in Chromium on SwiftShader, waits for window.__worldReady (exposed with ?test=1, R4 and R6), and fails on
// any console error or page error, or when the canvas's centre 50 × 50 pixels are all one colour. Saves
// tests/e2e/out/world.png. Run after `npm run build`: node tests/e2e/smoke.mjs
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
const URL = `http://localhost:${PORT}/?test=1`
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
  await page.waitForFunction(() => window.__worldReady === true, null, { timeout: READY_MS, polling: 250 })
  // A few frames more, so the plants and shadows that came with the world are on screen too.
  await page.waitForTimeout(1500)
  console.log(`world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // The canvas's centre 50 × 50 pixels, as the screen shows them, read back through a 2D canvas.
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  const clip = { x: Math.round(box.x + box.width / 2 - 25), y: Math.round(box.y + box.height / 2 - 25), width: 50, height: 50 }
  const centre = (await page.screenshot({ clip })).toString('base64')
  const colours = await page.evaluate(async (png) => {
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
  console.log(`${colours} colours in the canvas's centre 50 × 50`)
  if (colours <= 1) fail('the canvas centre is one colour: nothing drawn')

  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, 'world.png') })
  console.log(`saved ${join(OUT, 'world.png')}`)
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
