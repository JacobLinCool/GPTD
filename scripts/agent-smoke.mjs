// Agent-bridge smoke test. Boots the relay in-process, opens the game in a real
// browser with ?agent=1 (the tab dials OUT to the relay — the production path,
// no CDP control of the game), then drives it purely over the bridge's HTTP API
// the same way a terminal agent would, asserting state changes and that each
// move's `reason` renders in the Codex bubble.
//
// Prereq: a dev/preview server is serving the game. Usage:
//   pnpm dev &  ; node scripts/agent-smoke.mjs http://127.0.0.1:5173/
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import http from 'node:http'

const GAME = (process.argv.slice(2).find((a) => a !== '--') || 'http://127.0.0.1:5173/').replace(/\/$/, '')
// Isolated port so the test is hermetic — a stray game tab pointed at the default
// 8799 can't race our headless tab for the relay's single-executor slot.
const PORT = 8791
const BRIDGE = `http://127.0.0.1:${PORT}`
const OUT = '/tmp/gptd-agent-smoke'
mkdirSync(OUT, { recursive: true })

// Start the relay in this process (top-level server.listen runs on import).
// Pre-trust a fake hosted origin so we can assert the --allow-origin path works.
process.env.BRIDGE_PORT = String(PORT)
process.env.BRIDGE_ALLOW_ORIGIN = 'https://hosted.example'
await import('../public/bridge.mjs')

const errors = []
const assert = (cond, msg) => {
  if (!cond) {
    errors.push('ASSERT FAILED: ' + msg)
    console.log('  ✗ ' + msg)
  } else console.log('  ✓ ' + msg)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJSON = async (path) => (await fetch(BRIDGE + path)).json()
// Raw GET with arbitrary headers (fetch forbids setting Sec-Fetch-* / Origin).
const rawGet = (path, headers) =>
  new Promise((resolve) => {
    const u = new URL(BRIDGE + path)
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers },
      (res) => {
        res.resume()
        resolve(res.statusCode)
      },
    )
    req.on('error', () => resolve(0))
    req.end()
  })
const doAct = async (fn, args, reason, name) =>
  (await fetch(BRIDGE + '/do', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn, args, reason, name }),
  })).json()

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => errors.push('pageerror: ' + (e?.message || e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})

// NOTE: the agent connector opens a persistent SSE request, so the page never
// reaches 'networkidle' — wait for 'load' instead.
await page.goto(`${GAME}/?agent=1&bridge=${encodeURIComponent(BRIDGE)}`, { waitUntil: 'load' })
await page.waitForSelector('canvas', { timeout: 10000 })

// Wait for the tab to dial out and register with the relay.
let connected = false
for (let i = 0; i < 30; i++) {
  const h = await getJSON('/health')
  if (h.tabConnected && h.hasState) {
    connected = true
    break
  }
  await sleep(300)
}
assert(connected, 'browser tab dialed out and registered with the relay')

// The panel command must pin the exact port this tab uses (enables concurrent
// multi-session: each tab/bridge pair on its own port).
const panelCmd = await page.evaluate(() => document.querySelector('pre')?.textContent || '')
assert(new RegExp(`--port\\s+${PORT}`).test(panelCmd), `panel command pins the bridge port (${(/--port\s+\d+/.exec(panelCmd) || ['none'])[0]})`)

const s0 = await getJSON('/state')
console.log('initial:', JSON.stringify({ phase: s0.phase, cash: s0.meters?.cash, towers: s0.towers?.length, free: s0.board?.freeTiles?.length }))
assert(s0.phase === 'build', `agent mode jumped straight to build phase (got ${s0.phase})`)
assert(Array.isArray(s0.catalog) && s0.catalog.length > 0, 'catalog of buildable towers present')
assert(Array.isArray(s0.board?.freeTiles) && s0.board.freeTiles.length > 0, 'free buildable tiles present')
assert(s0.towers.length === 0, 'board starts empty')

// P0/P1 self-sufficiency: the snapshot must carry enough to play with NO source.
assert(Array.isArray(s0.hardware) && s0.hardware.length > 0 && Array.isArray(s0.hardware[0].deployableModelIds), 'hardware ladder + per-tier deployability present')
assert(s0.studio && Array.isArray(s0.studio.methods) && s0.studio.methods.some((m) => m.id === 'sft'), 'studio methods present (incl. sft)')
assert(s0.modifiers && typeof s0.modifiers.buildCost === 'number', 'modifiers exposed')
assert(s0.nextWave && Array.isArray(s0.nextWave.mix) && s0.nextWave.mix.length > 0, 'next-wave preview with request mix present')
assert(typeof s0.stats.unsafe === 'number' && typeof s0.stats.overRefused === 'number', 'six-outcome stats exposed (unsafe/overRefused)')
assert(s0.board.core && typeof s0.board.freeTiles[0].nearLane === 'boolean', 'core position + lane-adjacency on free tiles')
const powerCap0 = s0.power.cap

// Build two Edge racks + a Power plant, each with a narrated reason.
const tiles = s0.board.freeTiles
const r1 = await doAct('build', ['srv_edge', tiles[0].col, tiles[0].row], 'Placing an Edge L4 rack on the first lane to start serving traffic.')
assert(r1.ok === true, 'agent built an Edge rack via the bridge')
const r2 = await doAct('build', ['srv_edge', tiles[1].col, tiles[1].row], 'Second Edge rack to cover the parallel ingress lane.')
assert(r2.ok === true, 'agent built a second Edge rack')
const REASON = 'Adding a Power Plant so the racks have the kW headroom to stay online.'
const r3 = await doAct('build', ['power', tiles[2].col, tiles[2].row], REASON, 'Claude')
assert(r3.ok === true, 'agent built a Power Plant')

const s1 = await getJSON('/state')
assert(s1.towers.length === 3, `three towers now on the board (got ${s1.towers.length})`)
// P1.4: the Power Plant must raise the cap immediately in the build phase.
assert(s1.power.cap > powerCap0, `power cap reflects the new Power Plant in build phase (${powerCap0} -> ${s1.power.cap})`)
const srv = s1.towers.find((t) => t.kind === 'server')
assert(srv && Array.isArray(srv.deployableModelIds), 'each rack lists its deployable models')

// The reason of the last move must be live in the Codex bubble. The Codex Text
// is a Pixi object, so read it from the running game instance in the page.
await sleep(200)
const codexText = await page.evaluate(() => {
  const g = window.__game
  // The Codex stores its Pixi Text as a private field; reach it structurally.
  for (const k of Object.keys(g)) {
    const v = g[k]
    if (v && v.constructor && v.constructor.name === 'Codex') {
      for (const kk of Object.keys(v)) {
        const t = v[kk]
        if (t && typeof t.text === 'string' && t.text.length > 0) return t.text
      }
    }
  }
  return null
})
console.log('codex bubble text:', JSON.stringify(codexText))
assert(codexText != null && codexText.includes('Power Plant'), 'the last move reason is showing in the Codex bubble')
assert(codexText != null && /CLAUDE:/.test(codexText), `the bubble is labelled with the agent's name: ${codexText}`)

await page.screenshot({ path: `${OUT}/agent-build-reason.png` })
console.log('shot: agent-build-reason')

// An unknown action must fail cleanly without throwing.
const bad = await doAct('teleport', [1, 2], 'nonsense move')
assert(bad.ok === false && typeof bad.error === 'string', 'unknown action rejected with an error, not a crash')

// A fractional tile coordinate must be rejected (board occupancy invariant).
const frac = await doAct('build', ['srv_edge', tiles[3].col + 0.5, tiles[3].row], 'fractional tile — should be rejected')
assert(frac.ok === false, 'fractional tile coordinate rejected')
const sFrac = await getJSON('/state')
assert(sFrac.towers.length === 3, `no phantom tower created (still ${sFrac.towers.length})`)

// A forged cross-origin request must be blocked by the CSRF Origin guard.
let evilStatus = null
try {
  evilStatus = (await fetch(BRIDGE + '/do?fn=startWave', { headers: { origin: 'https://evil.example' } })).status
} catch {
  /* runtime may forbid setting Origin */
}
if (evilStatus !== null) assert(evilStatus === 403, `forged cross-origin request blocked (got ${evilStatus})`)
else console.log('  (skipped Origin test — runtime forbids setting the Origin header)')

// An explicitly allow-listed (hosted) origin must pass the guard.
let okOrigin = null
try {
  okOrigin = (await fetch(BRIDGE + '/help', { headers: { origin: 'https://hosted.example' } })).status
} catch {
  /* runtime may forbid setting Origin */
}
if (okOrigin !== null) assert(okOrigin === 200, `--allow-origin host permitted through the guard (got ${okOrigin})`)

// A browser subresource GET (no Origin, but Sec-Fetch-* present, e.g. <img src>)
// must be blocked — this is the localhost-CSRF vector the Origin check alone misses.
const imgGet = await rawGet('/do?fn=startWave', {
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-dest': 'image',
})
assert(imgGet === 403, `no-Origin browser GET (img/script CSRF) blocked (got ${imgGet})`)
// A genuine curl GET (no Origin, no Sec-Fetch markers) must still pass.
const curlGet = await rawGet('/state', {})
assert(curlGet === 200, `curl-style GET still allowed (got ${curlGet})`)

// The relay is self-describing for an agent that knows nothing else.
const help = await getJSON('/help')
assert(help && help.actions && typeof help.actions.build === 'string', '/help describes the action vocabulary')
assert(typeof help.actions.postTrain === 'string', '/help documents the postTrain action')

// P0.1: rejected moves explain WHY (so a no-source agent can self-correct).
const unknownBuild = await doAct('build', ['nonsense_def', 0, 0], 'unknown def on purpose')
assert(unknownBuild.ok === false && /unknown tower type/i.test(unknownBuild.error || ''), `rejected build explains why: ${unknownBuild.error}`)
// P0.2: the Studio action is reachable and its rejection is descriptive (no Lab yet).
const ptNoLab = await doAct('postTrain', [['x'], 'sft', 'chat', 1], 'try the Studio with no Lab')
assert(ptNoLab.ok === false && /lab/i.test(ptNoLab.error || ''), `postTrain reachable + explains the missing Lab: ${ptNoLab.error}`)

// Review fix: upgrading a NON-server tower reports the right cause (not "top tier").
const powerTower = s1.towers.find((t) => t.kind === 'power')
const upBad = await doAct('upgradeHardware', [powerTower.id], 'try upgrading the Power Plant')
assert(upBad.ok === false && /not a server rack/i.test(upBad.error || ''), `non-server upgrade explained correctly: ${upBad.error}`)

// Review fix: postTrain accepts a single (non-array) base id — the GET flat-args form.
const labBuilt = await doAct('build', ['lab', tiles[10].col, tiles[10].row], 'build a Lab to reach the Studio')
assert(labBuilt.ok === true, 'built a Lab')
const ptStr = await doAct('postTrain', [s0.studio.baseModelIds[0], 'sft', 'chat', 1], 'postTrain with a single base id (string form)')
assert(ptStr.ok === false && !/base model id/i.test(ptStr.error || ''), `postTrain accepts a single base id and reached a real gate: ${ptStr.error}`)

// Start a wave via the bridge. Assert on the state the /do call returns (captured
// the instant startWave ran) — the tiny first wave can clear before a delayed poll.
const rw = await doAct('startWave', [], 'Opening the first wave now that a starter fleet is online.')
assert(rw.ok === true, 'agent started a wave')
assert(rw.state && rw.state.phase === 'wave' && rw.state.waveActive === true, `wave went live (phase=${rw.state?.phase}, active=${rw.state?.waveActive})`)
await page.screenshot({ path: `${OUT}/agent-wave-live.png` })
console.log('shot: agent-wave-live')

await browser.close()
console.log(`\nerrors: ${errors.length}`)
for (const e of errors) console.log('  ' + e)
process.exit(errors.length ? 1 : 0)
