// Headless end-to-end playtest of the BUILT game (`pnpm preview` first, then `pnpm e2e`).
//
// It plays real waves through the real input paths — build hotkeys (Q–P) and board
// clicks, Space to start, `.`/Z to cycle and upgrade racks, [ ] for tabs, PgUp/PgDn,
// G for coverage rings, Esc / arrows / Enter through the system hub and Settings, H for
// the hotkey sheet, L / K for the Training Lab and Model Overview, the checkpoint card's
// DEPLOY ×n — and reads the outcome through `window.__game` (the snapshot getter and
// panel visibility), never through pixel guesses. Four scenarios cover both languages ×
// both display modes and capture every surface a player meets: title, build board, NEXT
// WAVE card (incl. a single-entry surge), rack inspect + deploy picker, live wave,
// request inspector, wave report (Expert ledger / Normal summary), hotkey sheet,
// Training Lab (Infra + Studio), Model Overview + lineage, the rollout card, every
// Settings tab, and the end screen. Fails on any page error, console error or broken
// assertion.
//
//   node scripts/screenshot.mjs [url]          (default http://127.0.0.1:4173/)
//   GPTD_SHOTS=/some/dir node scripts/screenshot.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = process.argv.slice(2).find((arg) => arg !== '--') || 'http://127.0.0.1:4173/'
const OUT = process.env.GPTD_SHOTS || '/tmp/gptd-shots'
mkdirSync(OUT, { recursive: true })

// board geometry (src/config.ts): a 1280×720 viewport renders the 1280×720 design 1:1
const GRID_X = 64
const GRID_Y = 96
const TILE = 48
const tile = (col, row) => [GRID_X + (col + 0.5) * TILE, GRID_Y + (row + 0.5) * TILE]
// build hotkeys follow BUILD_ORDER (src/sim/content.ts)
const BUILD = {
  edge: 'KeyQ',
  frontier: 'KeyW',
  router: 'KeyE',
  cache: 'KeyR',
  encoder: 'KeyT',
  llmGuard: 'KeyY',
  power: 'KeyU',
  cooling: 'KeyI',
  liquid: 'KeyO',
  lab: 'KeyP',
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
})

const errors = []
const assert = (cond, msg) => {
  if (!cond) {
    errors.push('ASSERT FAILED: ' + msg)
    console.log('  ✗ ' + msg)
  } else console.log('  ✓ ' + msg)
}

/**
 * One scenario = a fresh browser context with the language / display mode preset in
 * localStorage (exactly what the in-game toggles persist) and the guided tutorial
 * skipped so the Codex bubble does not cover the board.
 */
async function scenario(name, { lang, mode, tutorial = false }, body) {
  console.log(`\n=== ${name} (${lang}, ${mode}) ===`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(
    ([l, m, tut]) => {
      try {
        localStorage.setItem('gptd_lang', l)
        localStorage.setItem('gptd_mode', m)
        if (!tut) localStorage.setItem('gptd_tut_done', '1')
      } catch {
        /* storage blocked: defaults */
      }
    },
    [lang, mode, tutorial],
  )
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e?.message || e}`))
  const h = helpers(page, name)
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await h.wait(1200)
  try {
    await body(h)
  } catch (e) {
    errors.push(`[${name}] threw: ${e?.stack || e}`)
    await h.shot('zz-failure')
  }
  await ctx.close()
}

function helpers(page, name) {
  const wait = (ms) => page.waitForTimeout(ms)
  const snap = () => page.evaluate(() => window.__game?.snapshot ?? null)
  /** a presentation fact read off the live Game (panel visibility, the open tab …) */
  const peek = (fn, arg) => page.evaluate(fn, arg)
  const press = async (code, ms = 80) => {
    await page.keyboard.press(code)
    await wait(ms)
  }
  const click = async (x, y, ms = 90) => {
    await page.mouse.click(x, y)
    await wait(ms)
  }
  const shot = (label) =>
    page.screenshot({ path: `${OUT}/${name}-${label}.png` }).then(() => console.log('  shot:', `${name}-${label}`))
  /** pick a build tool by hotkey, click each tile, then drop the tool (Esc) */
  const build = async (code, cells) => {
    await press(code)
    for (const [c, r] of cells) await click(...tile(c, r))
    // Esc drops a held tool; with nothing held it would open the system hub instead
    if (await peek(() => window.__game.selectedDefId != null)) await press('Escape')
  }
  async function waitPhase(target, timeoutMs) {
    const t0 = Date.now()
    let s = await snap()
    while (Date.now() - t0 < timeoutMs) {
      s = await snap()
      if (s && (Array.isArray(target) ? target.includes(s.phase) : s.phase === target)) return s
      await wait(250)
    }
    return s
  }
  /** Space starts the wave; a low-cash warning arms START, so a second Space confirms. */
  const startWave = async () => {
    await press('Space', 150)
    if ((await snap())?.phase === 'build') await press('Space', 150)
  }
  /**
   * Build only while the run stays solvent: place `code` on `cells` when cash covers its
   * nominal `cost` (build bar price) per tile plus `reserve` for the next wave's bill.
   */
  const buildIfAffordable = async (code, cells, cost, reserve = 20) => {
    const free = []
    for (const [c, r] of cells) {
      const taken = await peek(([cc, rr]) => window.__game.state.towers.some((t) => t.col === cc && t.row === rr), [c, r])
      if (!taken) free.push([c, r])
    }
    const cash = (await snap())?.cash ?? 0
    if (!free.length || cash < cost * free.length + reserve) return false
    await build(code, free)
    await deselect()
    return true
  }
  /** the hardware tier of every rack, in id order */
  const rackTiers = () =>
    peek(() => window.__game.state.towers.filter((t) => t.def.kind === 'server').map((t) => t.hwId))
  /** click each rack and upgrade it one hardware tier (Z); returns how many moved up */
  const upgradeAllRacks = async () => {
    const racks = await peek(() =>
      window.__game.state.towers.filter((t) => t.def.kind === 'server').map((t) => [t.col, t.row]),
    )
    const before = await rackTiers()
    for (const [c, r] of racks) {
      // drop the previous selection first: its inspect panel docks over the board's edge
      await deselect()
      await click(...tile(c, r), 60)
      await press('KeyZ', 60)
    }
    await deselect()
    const after = await rackTiers()
    const moved = after.filter((hw, i) => hw !== before[i]).length
    assert(moved > 0, `${name}: Z upgrades the clicked rack (${moved}/${racks.length} racks moved up a tier)`)
    return moved
  }
  /** jump the campaign so the next wave is a single-entry surge (Matsu Cable Cut, lane 2) and capture it */
  const surgePreview = async () => {
    await deselect()
    await peek(() => {
      window.__game.state.waveIndex = 4
    })
    await wait(400)
    const lane = await peek(() => window.__game.preview?.surgeLane ?? null)
    assert(lane !== null, `${name}: the NEXT WAVE preview names the surge lane (${lane})`)
    await shot('build-surge')
  }
  /** let the game loop run two frames (panels re-lay out on the frame after a state change) */
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  /** clear any selection / tool without opening the system hub, and wait until the panels close */
  const deselect = async () => {
    await peek(() => {
      const g = window.__game
      g.selectedDefId = null
      g.selectedTowerId = null
      g.selectedRequestId = null
    })
    await frames()
  }
  /** cycle a selected rack's inspect tabs with ] until `tab` is open */
  const inspectTab = async (tab) => {
    for (let i = 0; i < 3; i++) {
      if ((await peek(() => window.__game.inspect.tab)) === tab) return true
      await press('BracketRight', 120)
    }
    return (await peek(() => window.__game.inspect.tab)) === tab
  }
  /** Esc → hub, ↓↓ Enter → Settings, then every tab with ], then back out */
  const settingsTour = async () => {
    await deselect()
    await press('Escape', 200)
    assert(await peek(() => window.__game.systemMenuOpen), `${name}: Esc opens the system hub`)
    await shot('hub')
    await press('ArrowDown')
    await press('ArrowDown')
    await press('Enter', 250)
    assert(await peek(() => window.__game.settingsPanel.visible), `${name}: Enter on Settings opens it`)
    // start from the first tab whatever was remembered
    for (let i = 0; i < 4 && (await peek(() => window.__game.settingsPanel.current)) !== 0; i++) await press('BracketRight')
    for (const tab of ['audio', 'display', 'a11y', 'gameplay']) {
      await shot(`settings-${tab}`)
      await press('BracketRight', 150)
    }
    await press('Escape', 150) // settings → hub
    await press('Escape', 150) // hub → board
    assert(!(await peek(() => window.__game.systemMenuOpen)), `${name}: Esc closes the hub`)
  }
  /** the starter fleet: Edge racks on all four ingress lanes + power and cooling */
  const starterFleet = async () => {
    await build(BUILD.edge, [
      [4, 2],
      [5, 2],
      [8, 2],
      [9, 0],
      [10, 0],
      [4, 8],
      [5, 8],
      [8, 8],
      [18, 8],
      [19, 8],
    ])
    await build(BUILD.power, [
      [2, 4],
      [2, 8],
    ])
    await build(BUILD.cooling, [
      [6, 4],
      [14, 8],
    ])
  }
  /** once packets are on the board, pause and open the request inspector on one (clicked on the board) */
  const inspectRequest = async () => {
    const find = () =>
      peek(() => {
        const s = window.__game.state
        if (s.phase !== 'wave') return null
        const onTower = (r) => s.towers.some((t) => Math.hypot(t.x - r.x, t.y - r.y) < 30)
        const r = s.requests.find((q) => q.alive && !onTower(q))
        return r ? { x: r.x, y: r.y } : null
      })
    let p = null
    for (let i = 0; i < 60 && !p; i++) {
      p = await find()
      if (!p) await wait(150)
    }
    if (!p) {
      assert(false, `${name}: a live packet appeared to inspect`)
      return
    }
    await press('Space', 150) // pause: the packet holds still
    p = (await find()) ?? p
    await click(p.x, p.y, 300)
    const open = await peek(() => window.__game.requestInspect.view.visible)
    assert(open, `${name}: clicking a packet opens the request inspector`)
    await shot('request-inspector')
    await deselect()
    if ((await snap())?.paused) await press('Space', 150) // resume
  }
  /** end the run (SLA to zero mid-wave) and capture the end screen after its hold */
  const endScreen = async () => {
    const s = await snap()
    if (s?.phase === 'build') await startWave()
    await wait(600)
    await peek(() => {
      window.__game.state.meters.sla = 0
    })
    const lost = await waitPhase('lost', 15000)
    assert(lost?.phase === 'lost', `${name}: the run ends when SLA hits zero`)
    // the core shatters first, then the end screen (a ~1.2 s board-time hold; slow headless frames stretch it)
    let shown = false
    for (let i = 0; i < 40 && !shown; i++) {
      await wait(250)
      shown = await peek(() => window.__game.overlay.view.visible)
    }
    assert(shown, `${name}: the end screen shows after the hold`)
    await wait(300)
    await shot('end-screen')
  }
  return {
    page,
    wait,
    snap,
    peek,
    press,
    click,
    shot,
    build,
    buildIfAffordable,
    waitPhase,
    startWave,
    upgradeAllRacks,
    surgePreview,
    deselect,
    inspectTab,
    settingsTour,
    starterFleet,
    inspectRequest,
    endScreen,
  }
}

// ---------------------------------------------------------------------------------
// 1. English · Expert — the full loop: build, two waves, research, a Studio run that
//    mints a checkpoint, the model table, every panel, and the end screen.
// ---------------------------------------------------------------------------------
await scenario('en-expert', { lang: 'en', mode: 'expert' }, async (h) => {
  await h.shot('title')
  await h.press('Space', 400) // Space on the title = START
  const s0 = await h.snap()
  assert(s0?.phase === 'build' && s0.mode === 'expert', `run started in Expert (${s0?.phase}/${s0?.mode})`)
  await h.starterFleet()
  await h.upgradeAllRacks() // an L4 misses the interactive TPOT; an L40S serves chat cleanly
  const s1 = await h.snap()
  assert(s1.towers >= 14, `starter fleet placed by hotkeys (${s1.towers} buildings)`)
  await h.press('Period', 120)
  assert((await h.peek(() => window.__game.selectedTowerId)) != null, '. selects a rack')
  await h.deselect()
  await h.wait(150)
  assert(await h.peek(() => window.__game.nextWave.view.visible), 'NEXT WAVE card shows in the build phase')
  await h.shot('build-next-wave')

  // rack inspect: overview, then the deploy picker ([ ] cycles the tabs)
  await h.click(...tile(4, 2), 200)
  assert(await h.peek(() => window.__game.inspect.view.visible), 'clicking a rack opens its inspect panel')
  await h.shot('inspect-overview')
  assert(await h.inspectTab('deploy'), '] reaches the Deploy tab')
  await h.shot('inspect-deploy-picker')
  await h.press('PageDown', 150)
  assert((await h.peek(() => window.__game.inspect.scroll)) > 0, 'PgDn pages the deploy picker')
  await h.press('PageUp', 100)
  assert(await h.inspectTab('stats'), '] reaches the Telemetry tab (Expert)')
  await h.shot('inspect-telemetry')
  await h.deselect()

  // coverage rings (G) and the hotkey sheet (H)
  await h.press('KeyG', 150)
  await h.shot('ranges-on')
  await h.press('KeyG', 100)
  await h.press('KeyH', 250)
  assert(await h.peek(() => window.__game.hotkeys.visible), 'H opens the hotkey sheet')
  await h.shot('hotkeys')
  await h.press('KeyH', 150)

  await h.startWave() // 1×: the live shot catches packets on the lanes
  await h.wait(2500)
  await h.shot('wave1-live')
  await h.press('Digit6') // 6× for the rest of the wave
  const w1 = await h.waitPhase('build', 60000)
  assert(w1?.phase === 'build' && w1.report === 1, `wave 1 cleared and its report settled (${w1?.phase}, report ${w1?.report})`)
  assert(w1.served > 0, `wave 1 served requests (${w1.served})`)
  assert(await h.peek(() => window.__game.report.view.visible), 'the wave report shows after the wave')
  await h.shot('wave1-report-expert')

  // Training Lab: Infra research by keyboard, then the Studio
  await h.build(BUILD.lab, [[2, 6]])
  await h.press('KeyL', 300)
  assert(await h.peek(() => window.__game.trainingOpen), 'L opens the Training Lab')
  for (let i = 0; i < 3 && (await h.peek(() => window.__game.training.tab)) !== 'infra'; i++) await h.press('BracketRight', 150)
  await h.press('ArrowDown', 150) // focus the first research card
  await h.press('Enter', 200) // research it (Data permitting)
  await h.shot('training-infra')
  await h.press('PageDown', 150)
  await h.shot('training-infra-paged')
  await h.press('BracketRight', 250)
  assert((await h.peek(() => window.__game.training.tab)) === 'studio', '] switches to the Studio')
  await h.shot('training-studio')
  await h.press('KeyL', 200)
  assert(!(await h.peek(() => window.__game.trainingOpen)), 'L closes the Training Lab')

  // a guard on the core lanes now; a router and a cache once the bank can carry them
  await h.buildIfAffordable(BUILD.encoder, [[10, 4]], 14)
  await h.buildIfAffordable(BUILD.router, [[6, 2]], 24)
  await h.buildIfAffordable(BUILD.cache, [[16, 2]], 20)
  await h.shot('build-expanded')
  await h.press('Digit1')
  await h.startWave()
  await h.inspectRequest()
  await h.press('Digit6')
  const w2 = await h.waitPhase('build', 60000)
  assert(w2?.phase === 'build' && w2.wave >= 2, `wave 2 cleared (${w2?.phase} at wave ${w2?.wave})`)

  // a Studio SFT run on the rack's model (the Game action the TRAIN button calls)
  const base = await h.peek(() => {
    const g = window.__game
    const rack = g.state.towers.find((t) => t.def.kind === 'server' && t.modelId)
    return rack ? rack.modelId : null
  })
  const started = await h.peek((id) => window.__game.doPostTrain([id], 'sft', 'chat', 1), base)
  assert(started, `Studio started an SFT run on ${base}`)
  for (let w = 0; w < 4; w++) {
    if ((await h.snap())?.derived >= 1) break
    await h.buildIfAffordable(BUILD.router, [[6, 2]], 24, 30)
    await h.buildIfAffordable(BUILD.cache, [[16, 2]], 20, 30)
    await h.startWave()
    await h.waitPhase('build', 60000)
  }
  const sTrain = await h.snap()
  assert(sTrain.derived >= 1, `the Studio minted a derived checkpoint (${sTrain.derived})`)
  await h.shot('build-after-checkpoint')

  // the checkpoint card's one-click rollout: DEPLOY ×n puts it on every rack it fits
  const derivedId = await h.peek(() => Object.keys(window.__game.state.derivedModels)[0] ?? null)
  if (derivedId) {
    await h.peek((id) => window.__game.rolloutNotice(id), derivedId)
    await h.wait(500)
    await h.shot('notice-rollout')
    const btn = await h.peek(() => {
      const card = window.__game.notices.cards.find((c) => c.notice?.action)
      if (!card) return null
      const b = card.actBtn.getBounds()
      return [b.x + b.width / 2, b.y + b.height / 2]
    })
    assert(!!btn, 'a new checkpoint card offers DEPLOY ×n')
    if (btn) {
      await h.click(btn[0], btn[1], 300)
      const running = await h.peek(
        (id) => window.__game.state.towers.filter((t) => t.def.kind === 'server' && t.modelId === id).length,
        derivedId,
      )
      assert(running > 0, `DEPLOY ×n rolled the checkpoint out (${running} racks run it)`)
    }
  }

  // Model Overview (K): the table, the derived row by keyboard, the lineage view
  await h.press('KeyK', 300)
  assert(await h.peek(() => window.__game.modelsOpen), 'K opens the Model Overview')
  await h.press('BracketRight', 150) // filter: Base
  await h.press('BracketRight', 150) // filter: Derived
  await h.press('ArrowDown', 200) // select the first row
  await h.shot('models-derived')
  await h.peek(() => (window.__game.models.showLineage = true))
  await h.wait(250)
  await h.shot('models-lineage')
  await h.peek(() => (window.__game.models.showLineage = false))
  await h.press('Escape', 150) // letters type a filter query in the table, so Esc closes it
  assert(!(await h.peek(() => window.__game.modelsOpen)), 'Esc closes the Model Overview')
  // K toggles it closed again while no filter query is being typed
  await h.press('KeyK', 300)
  assert(await h.peek(() => window.__game.modelsOpen), 'K reopens the Model Overview')
  await h.press('KeyK', 300)
  assert(!(await h.peek(() => window.__game.modelsOpen)), 'K closes the Model Overview (no query typed)')

  await h.settingsTour()
  await h.endScreen()
})

// ---------------------------------------------------------------------------------
// 2. 正體中文 · Normal — the plain-language surfaces.
// ---------------------------------------------------------------------------------
await scenario('zh-normal', { lang: 'zh-TW', mode: 'normal' }, async (h) => {
  await h.shot('title')
  await h.press('Space', 400)
  await h.starterFleet()
  await h.upgradeAllRacks()
  await h.shot('build-next-wave')
  await h.click(...tile(4, 2), 200)
  await h.shot('inspect-overview')
  assert(await h.inspectTab('deploy'), 'zh Normal: ] reaches the Deploy tab')
  await h.shot('inspect-deploy-picker')
  await h.deselect()
  await h.startWave()
  await h.wait(1500)
  await h.shot('wave1-live')
  await h.inspectRequest()
  await h.press('Digit6')
  const w1 = await h.waitPhase('build', 60000)
  assert(w1?.phase === 'build', 'zh Normal: wave 1 cleared')
  assert(await h.peek(() => window.__game.report.view.visible), 'zh Normal: the plain-language wave summary shows')
  await h.shot('wave1-summary-normal')
  await h.press('KeyH', 250)
  await h.shot('hotkeys')
  await h.press('KeyH', 150)
  await h.build(BUILD.lab, [[2, 6]])
  await h.press('KeyL', 300)
  await h.shot('training')
  await h.press('BracketRight', 250)
  await h.shot('training-next-tab')
  await h.press('KeyL', 200)
  await h.settingsTour()
  await h.endScreen()
})

// ---------------------------------------------------------------------------------
// 3. English · Normal — the request inspector and the Normal wave summary in English.
// ---------------------------------------------------------------------------------
await scenario('en-normal', { lang: 'en', mode: 'normal' }, async (h) => {
  await h.press('Space', 400)
  await h.starterFleet()
  await h.upgradeAllRacks()
  await h.shot('build-next-wave')
  await h.startWave()
  await h.inspectRequest()
  await h.press('Digit6')
  const w1 = await h.waitPhase('build', 60000)
  assert(w1?.phase === 'build', 'en Normal: wave 1 cleared')
  await h.shot('wave1-summary-normal')
  await h.surgePreview()
  await h.endScreen()
})

// ---------------------------------------------------------------------------------
// 4. 正體中文 · Expert — the Expert ledger, deploy picker and model table in zh-TW.
// ---------------------------------------------------------------------------------
await scenario('zh-expert', { lang: 'zh-TW', mode: 'expert' }, async (h) => {
  await h.press('Space', 400)
  await h.starterFleet()
  await h.upgradeAllRacks()
  await h.click(...tile(4, 2), 200)
  assert(await h.inspectTab('deploy'), 'zh Expert: ] reaches the Deploy tab')
  await h.shot('inspect-deploy-picker')
  await h.deselect()
  await h.startWave()
  await h.wait(2500)
  await h.shot('wave1-live')
  await h.press('Digit6')
  const w1 = await h.waitPhase('build', 60000)
  assert(w1?.phase === 'build' && w1.report === 1, 'zh Expert: wave 1 cleared with a report')
  await h.shot('wave1-report-expert')
  await h.press('KeyK', 300)
  await h.shot('models')
  await h.press('Escape', 150)
  await h.surgePreview()
  await h.endScreen()
})

await browser.close()
console.log('\nerrors:', errors.length)
for (const e of errors) console.log('  ' + e)
process.exit(errors.length ? 1 : 0)
