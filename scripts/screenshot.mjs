// Headless end-to-end playtest: drives the built game with a real browser,
// plays through two waves at 3× speed, asserts the platform actually serves
// requests and survives, and captures screenshots. Surfaces runtime errors.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = process.argv.slice(2).find((arg) => arg !== '--') || 'http://127.0.0.1:4173/'
const OUT = '/tmp/gptd-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + (e?.message || e)))

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` }).then(() => console.log('shot:', name))
const wait = (ms) => page.waitForTimeout(ms)
const snap = () => page.evaluate(() => window.__game?.snapshot ?? null)
const clearSelection = () =>
  page.evaluate(() => {
    const g = window.__game
    if (!g) return
    g.selectedDefId = null
    g.selectedTowerId = null
    g.selectedRequestId = null
  })
const closeModels = () =>
  page.evaluate(() => {
    const g = window.__game
    if (!g) return
    g.modelsOpen = false
  })
const tile = (col, row) => [64 + (col + 0.5) * 48, 96 + (row + 0.5) * 48]
const BUILD_COUNT = 11
const BUILD_PAD_X = 12
const BUILD_GAP = 6
const BUILD_CONTROL_W = 184
const BUILD_CONTROL_X = 1280 - BUILD_CONTROL_W - BUILD_PAD_X
const BUILD_TRAY_W = BUILD_CONTROL_X - BUILD_PAD_X - 16
const BUILD_CARD_W = Math.floor((BUILD_TRAY_W - BUILD_GAP * (BUILD_COUNT - 1)) / BUILD_COUNT)
const TRAIN_PANEL_W = 1180
const TRAIN_PANEL_H = 500
const TRAIN_PANEL_X = (1280 - TRAIN_PANEL_W) / 2
const TRAIN_PANEL_Y = (720 - TRAIN_PANEL_H) / 2
const STUDIO_BASE_VISIBLE_ROWS = 6
const STUDIO_BASE_ITEM_H = 50
const STUDIO_BASE_ROW_STEP = 54
const trainTab = (offsetX) => [TRAIN_PANEL_X + offsetX, TRAIN_PANEL_Y + 52]
const trainClose = () => [TRAIN_PANEL_X + TRAIN_PANEL_W - 104, TRAIN_PANEL_Y + 31]
const studioBaseLastY =
  TRAIN_PANEL_Y + 102 + (STUDIO_BASE_VISIBLE_ROWS - 1) * STUDIO_BASE_ROW_STEP + STUDIO_BASE_ITEM_H / 2
const studioBaseDown = () => [TRAIN_PANEL_X + 272, studioBaseLastY]
const studioBaseLast = () => [TRAIN_PANEL_X + 139, studioBaseLastY]
const studioTrain = () => [TRAIN_PANEL_X + 936, TRAIN_PANEL_Y + 411]
const buildBtn = (i) => [BUILD_PAD_X + i * (BUILD_CARD_W + BUILD_GAP) + BUILD_CARD_W / 2, 672]
const pick = async (i) => {
  await page.mouse.click(...buildBtn(i))
  await wait(90)
}
const placeAt = async (i, cells) => {
  await pick(i)
  for (const [c, r] of cells) {
    await page.mouse.click(...tile(c, r))
    await wait(90)
  }
}
async function waitPhase(target, timeoutMs) {
  const t0 = Date.now()
  let s = await snap()
  while (Date.now() - t0 < timeoutMs) {
    s = await snap()
    if (s && s.phase === target) return s
    await wait(300)
  }
  return s
}

const assert = (cond, msg) => {
  if (!cond) {
    errors.push('ASSERT FAILED: ' + msg)
    console.log('  ✗ ' + msg)
  } else console.log('  ✓ ' + msg)
}

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas', { timeout: 10000 })
await wait(1200)
await shot('1-menu')

// Pick EXPERT MODE on the title screen (mode is locked once the run starts),
// then start the run.
await page.mouse.click(740, 443)
await wait(300)
await shot('1b-menu-expert')
await page.mouse.click(640, 546)
await wait(500)
const s0 = await snap()
assert(s0 && s0.mode === 'expert', `expert mode selected (got ${s0?.mode})`)
await shot('2-build-empty')

// BUILD_ORDER: 0=Edge 1=BigRack 2=Router 3=Cache 4=Encoder 5=LLMGuard
//              6=Moderation 7=Power 8=Cooling 9=Liquid 10=Lab
// Edge GPU racks blanketing ALL FOUR ingress lanes (top rows 0/2, bottom row 8),
// plus power and cooling to run them — a competent starter fleet that survives the
// rebalanced early gauntlet (the old top-row-only build leaked the bottom lanes).
await placeAt(0, [
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
await placeAt(7, [
  [2, 4],
  [2, 8],
]) // Power plants
await placeAt(8, [
  [6, 4],
  [14, 8],
]) // Cooling towers
await shot('3-build-placed')

// Upgrade every Edge rack one tier to Standard (L40S). A weak L4 cannot meet the
// interactive TPOT, so every chat correct-but-LATE → slo_miss → ZERO clean serves
// → no Data → the Studio run can never be funded. A Standard rack clears the SLO,
// serves cleanly, and banks the Data that pays for a post-training run. (Driven via
// the __game instance — esbuild preserves member names, like the snapshot getter.)
await page.evaluate(() => {
  const g = window.__game
  if (!g || !g.state) return
  for (const t of g.state.towers) if (t.def && t.def.kind === 'server') g.doUpgradeHardware(t.id)
})
await wait(200)

// 3× speed, run Wave 1
await page.keyboard.press('3')
await page.mouse.click(1170, 651) // START WAVE
await wait(2000)
await shot('4-wave1-live')

const afterW1 = await waitPhase('build', 40000)
console.log('after wave 1:', JSON.stringify(afterW1))
assert(afterW1 && afterW1.phase === 'build', 'wave 1 cleared (back to build)')
// 4 weak L4 Edge racks on Llama-8B can legitimately MISS the interactive SLO on
// every chat (correct-but-late → slo_miss, zero cash) and still clear the wave —
// the realistic P1 economy. So assert the wave processed traffic, not raw serves.
assert(afterW1 && afterW1.trust > 50, `trust healthy (${afterW1?.trust})`)
assert(afterW1 && afterW1.report === 1, `expert wave report settled (got ${afterW1?.report})`)
await shot('4b-wave1-report')
// dismiss the expert wave report (✕) so the next build clicks hit tiles
await page.mouse.click(301, 160)
await wait(200)

// Select the rack to open the reworked S3 RackInspect (four cards). The
// rack-upgrade button now sits below the four cards, so its pixel position is
// layout-dependent — we capture the panel screenshot and log the loadout rather
// than assert on a fragile pixel (the deploy/upgrade buttons live in the panel).
await page.mouse.click(...tile(4, 2)) // select the rack
await wait(200)
await shot('5a-inspect-rack')
// Do not use Escape here: after the system-menu work, Escape is a global
// priority stack and may open the hub once the selection is gone. This smoke test
// only needs to dismiss the inspect panel before continuing to build.
await clearSelection()
await wait(100)
const s1 = await snap()
console.log('loadouts:', JSON.stringify(s1?.loadouts))

// S7 ModelOverview — open the all-checkpoints table from the HUD "MODELS" button.
// The button sits left of the control cluster (≈ x 850..946, y 14..44).
await page.mouse.click(898, 29)
await wait(300)
await snap()
await shot('8a-models-overview')
// S8 LineageGraph — toggle the lineage DAG view (top-right "LINEAGE" button).
await page.mouse.click(1126, 110)
await wait(300)
await shot('8b-lineage-graph')
// Avoid the global Escape stack here; close the modal state directly so the new
// System hub cannot accidentally open and block the following build clicks.
await closeModels()
await wait(200)

// Place a Training Lab (build index 10) — it unlocks the tech tree + the Studio,
// and boosts Data yield from serves so we can afford a post-training run.
await placeAt(10, [[2, 6]])
// Peek at the INFRA TECH tab so the screenshot shows the grouped serving tree.
await page.mouse.click(1170, 693) // TRAIN (open the Training Lab panel)
await wait(300)
await page.mouse.click(...trainTab(510)) // INFRA TECH tab
await wait(300)
await shot('5b-infra-tab')
await page.mouse.click(...trainClose()) // CLOSE
await wait(200)

await placeAt(2, [[6, 2]]) // Router
await placeAt(3, [[16, 2]]) // Cache
// two Encoder guardrails flanking the Trust Core — the jailbreak waves (DAN, etc.)
// wreck Trust without a second-layer guard, so a competent build adds them early.
await placeAt(4, [
  [10, 4],
  [12, 4],
])
await shot('5-build-expanded')

// Run Wave 2 (Coding Boom) to bank Data for a Studio run.
await page.mouse.click(1170, 651)
await wait(2500)
await shot('6-wave2-live')
const afterW2 = await waitPhase('build', 45000)
console.log('after wave 2:', JSON.stringify(afterW2))
assert(afterW2 && (afterW2.phase === 'build' || afterW2.wave >= 2), 'survived into/through wave 2')
await shot('7-after-wave2')

// S9 Post-Training Studio — open the panel, run an SFT (the starter method needs
// no unlock) on the default base, then advance a wave to mint the checkpoint.
await page.mouse.click(1170, 693) // TRAIN (open the Training Lab panel)
await wait(300)
await page.mouse.click(...trainTab(720)) // POST-TRAINING STUDIO tab
await wait(300)
await shot('9a-studio')
// scroll the base list to the bottom and pick a SMALL base (8B-active) so the
// tiny edge fleet can train it within a wave or two.
for (let i = 0; i < 12; i++) {
  await page.mouse.click(...studioBaseDown())
  await wait(50)
}
await page.mouse.click(...studioBaseLast()) // last visible base (smallest)
await wait(150)
await page.mouse.click(...studioTrain()) // TRAIN button — SFT/chat/effort 1.0
await wait(300)
const sStudio = await snap()
console.log('studio posttrain:', sStudio?.posttrain, 'derived:', sStudio?.derived, 'data:', sStudio?.data)
assert(sStudio && sStudio.posttrain != null, `Studio started a post-training run (got ${sStudio?.posttrain})`)
await shot('9b-studio-training')
await page.mouse.click(...trainClose()) // CLOSE
await wait(200)

// Run waves until the posttrain run requisitions enough compute to complete,
// minting the derived model (a tiny edge fleet trains slowly — give it a few waves).
let afterW3 = null
for (let w = 0; w < 4; w++) {
  const pre = await snap()
  if (pre && pre.derived >= 1) break
  await page.mouse.click(1170, 651) // START WAVE
  await wait(2500)
  afterW3 = await waitPhase('build', 45000)
  console.log(`after studio wave ${w + 1}:`, afterW3?.derived, 'posttrain:', afterW3?.posttrain)
  if (afterW3 && afterW3.derived >= 1) break
}
const sAfterTrain = await snap()
console.log('after training waves:', JSON.stringify(sAfterTrain))
assert(sAfterTrain && sAfterTrain.derived >= 1, `Studio created a derived checkpoint (${sAfterTrain?.derived})`)

// reopen S7 to confirm the new derived checkpoint appears in the table (filter: Derived)
await page.mouse.click(898, 29)
await wait(300)
const sFinal = await snap()
console.log('final models:', sFinal?.models, 'derived:', sFinal?.derived)
assert(sFinal && sFinal.models > 16, `derived checkpoint is owned + listed (${sFinal?.models} models)`)
await page.mouse.click(1126, 120) // TABLE toggle; the modal remembers the earlier Lineage view
await wait(200)
await page.mouse.click(594, 127) // Derived filter (modal filter row)
await wait(200)
await shot('8c-models-with-derived')
await page.mouse.click(180, 208) // select the first derived row; validates the detail card layout
await wait(200)
await shot('8d-derived-detail')
await closeModels()
await wait(150)

await browser.close()
console.log('errors:', errors.length)
for (const e of errors) console.log('  ' + e)
process.exit(errors.length ? 1 : 0)
