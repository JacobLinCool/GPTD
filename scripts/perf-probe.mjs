// Late-game render perf probe. Serves the built `dist/` through request interception
// (no port), fast-forwards the production demo to a late wave, then samples frame time,
// game.tick (sim + board sync) and renderer.render CPU at 1× and 12×. Optionally pins a
// late wave's traffic onto a weak board (--stress) to load the board with packets.
// Exits non-zero when the per-frame CPU p95 (tick + render) exceeds the budget.
//
//   pnpm build && node scripts/perf-probe.mjs [--wave 85] [--stress] [--swift] [--budget 4]
import { chromium } from 'playwright'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const DIST = opt('--dist', 'dist')
const STRESS = flag('--stress')
const WAVE = Number(opt('--wave', STRESS ? 8 : 85))
const SWIFT = flag('--swift')
const BUDGET = Number(opt('--budget', SWIFT ? 12 : 4))
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST}/ — run \`pnpm build\` first`)
  process.exit(2)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: SWIFT
    ? ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: SWIFT ? 1 : 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('http://gptd.local/**', (route) => {
  let p = decodeURIComponent(new URL(route.request().url()).pathname)
  if (p === '/' || p === '') p = '/index.html'
  const f = join(DIST, p)
  if (!existsSync(f)) return route.fulfill({ status: 404, body: 'not found' })
  return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' } })
})
await page.goto('http://gptd.local/index.html')
await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 })
await page.evaluate(() => window.__game.startDemo())
const reached = await page.evaluate(
  ({ wave, stress }) => {
    const g = window.__game
    const t0 = performance.now()
    while (performance.now() - t0 < 300000) {
      g.tick(50)
      const s = g.state
      if (s.phase === 'lost') break
      if (s.waveIndex + 1 >= wave && s.phase === 'wave' && s.waveTime > 4) break
    }
    if (stress) {
      // a late wave's spawn table against this (weaker) board; the meters are pinned below
      g.demoActive = false
      let guard = 0
      while (g.state.phase !== 'build' && guard++ < 20000) g.tick(50)
      g.state.waveIndex = 84
      g.doStartWave()
    }
    g.demoActive = false
    return { wave: g.state.waveIndex + 1, phase: g.state.phase, towers: g.state.towers.length }
  },
  { wave: WAVE, stress: STRESS },
)
console.log('board', JSON.stringify(reached))

const runs = []
for (const speed of [1, 12]) {
  const r = await page.evaluate(async (speed) => {
    const g = window.__game
    g.speed = speed
    const renderer = g.factory.renderer
    const render = renderer.render.bind(renderer)
    const tick = g.tick.bind(g)
    const rt = []
    const tt = []
    renderer.render = (...a) => {
      const t = performance.now()
      const out = render(...a)
      rt.push(performance.now() - t)
      return out
    }
    g.tick = (ms) => {
      const t = performance.now()
      tick(ms)
      tt.push(performance.now() - t)
    }
    const ft = []
    let last = performance.now()
    let maxReq = 0
    await new Promise((done) => {
      const f = (now) => {
        ft.push(now - last)
        last = now
        const s = g.state
        s.meters.trust = s.meters.sla = 100
        s.meters.cash = Math.max(s.meters.cash, 1e6)
        maxReq = Math.max(maxReq, s.requests.length)
        if (ft.length < 250) requestAnimationFrame(f)
        else done()
      }
      requestAnimationFrame(f)
    })
    renderer.render = render
    g.tick = tick
    const stat = (a) => {
      const b = [...a].sort((x, y) => x - y)
      return { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +b[Math.floor(b.length * 0.95)].toFixed(2) }
    }
    const n = Math.min(tt.length, rt.length)
    const cpu = Array.from({ length: n - 10 }, (_, i) => tt[i + 10] + rt[i + 10])
    return { speed, maxReq, frame: stat(ft.slice(10)), tick: stat(tt.slice(10)), render: stat(rt.slice(10)), cpu: stat(cpu), board: g.world.stats() }
  }, speed)
  console.log(JSON.stringify(r))
  runs.push(r)
}
await browser.close()
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'))
  process.exit(1)
}
const worst = Math.max(...runs.map((r) => r.cpu.p95))
console.log(`cpu p95 ${worst.toFixed(2)} ms (budget ${BUDGET} ms)`)
process.exit(worst > BUDGET ? 1 : 0)
