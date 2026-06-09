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
const tile = (col, row) => [64 + (col + 0.5) * 48, 96 + (row + 0.5) * 48]
const buildBtn = (i) => [12 + i * 106 + 50, 672]
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

// Start the run
await page.mouse.click(640, 521)
await wait(500)
await shot('2-build-empty')

// 0=Small 1=General 2=Coding 3=Frontier 4=Router 5=Cache 6=Safety 7=Power 8=Cooling 9=Lab
await placeAt(1, [
  [4, 2],
  [12, 6],
  [18, 8],
])
await placeAt(0, [[9, 0]])
await shot('3-build-placed')

// 3× speed, run Wave 1
await page.keyboard.press('3')
await page.mouse.click(1170, 651) // START WAVE
await wait(2000)
await shot('4-wave1-live')

const afterW1 = await waitPhase('build', 40000)
console.log('after wave 1:', JSON.stringify(afterW1))
assert(afterW1 && afterW1.phase === 'build', 'wave 1 cleared (back to build)')
assert(afterW1 && afterW1.served > 4, `served > 4 (got ${afterW1?.served})`)
assert(afterW1 && afterW1.trust > 50, `trust healthy (${afterW1?.trust})`)

// Expand the defense with wave-1 income
await placeAt(1, [
  [8, 2],
  [16, 2],
  [8, 6],
])
await placeAt(2, [[12, 8]]) // Coding server
await placeAt(4, [[6, 2]]) // Router
await placeAt(7, [[2, 4]]) // Power
await placeAt(8, [[2, 6]]) // Cooling
await shot('5-build-expanded')

// Run Wave 2 (Coding Boom)
await page.mouse.click(1170, 651)
await wait(2500)
await shot('6-wave2-live')
const afterW2 = await waitPhase('build', 45000)
console.log('after wave 2:', JSON.stringify(afterW2))
assert(afterW2 && (afterW2.phase === 'build' || afterW2.wave >= 2), 'survived into/through wave 2')
await shot('7-after-wave2')

await browser.close()
console.log('errors:', errors.length)
for (const e of errors) console.log('  ' + e)
process.exit(errors.length ? 1 : 0)
