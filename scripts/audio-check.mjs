// Offline audio regression: bundles the shipped audio modules (src/audio/harness.ts →
// mixer, voice policy, recipes, music), renders them in headless Chrome through
// OfflineAudioContext, and measures loudness (BS.1770 LUFS), sample peak and clipping.
// Fails (exit 1) when the mix hierarchy regresses (a failure cue no louder than a
// routine serve), when a 12× late-game stream clips or grows too loud, or when the
// music loses its headroom. No server or built dist needed.
//
//   pnpm audio:check              # tables + PASS/FAIL
//   pnpm audio:check --json       # machine-readable report
//   pnpm audio:check --wav DIR    # also write every render as a 48 kHz mono WAV
import { build } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter((a) => a !== '--')
const wavIdx = args.indexOf('--wav')
const wavDir = wavIdx >= 0 ? resolve(args[wavIdx + 1] ?? 'audio-renders') : null
const asJson = args.includes('--json')

const built = await build({
  configFile: false,
  root: ROOT,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(ROOT, 'src/audio/harness.ts'),
      formats: ['iife'],
      name: 'GPTD_AUDIO_CHECK',
      fileName: () => 'harness.js',
    },
  },
})
const outputs = (Array.isArray(built) ? built : [built]).flatMap((b) => b.output)
const chunk = outputs.find((o) => o.type === 'chunk')
if (!chunk) throw new Error('audio-check: bundling src/audio/harness.ts produced no chunk')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
let report
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: chunk.code })
  report = await page.evaluate((wav) => window.GPTD_AUDIO_CHECK.runLevelCheck({ wav }), !!wavDir)
  if (errors.length) throw new Error('audio-check: page errors\n' + errors.join('\n'))
} finally {
  await browser.close()
}

function writeWav(path, samples, sr = 48000) {
  const b = Buffer.alloc(44 + samples.length * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples.length * 2, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sr, 24)
  b.writeUInt32LE(sr * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2)
  writeFileSync(path, b)
}

if (wavDir && report.wavs) {
  mkdirSync(wavDir, { recursive: true })
  for (const [name, samples] of Object.entries(report.wavs)) writeWav(resolve(wavDir, `${name}.wav`), samples)
}
delete report.wavs

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(
    '\nPer-cue levels at default settings (pan center): sample peak dBFS, max momentary loudness LUFS',
  )
  console.table(report.cues)
  console.log('Late-game event streams through the voice policy (6 s):')
  console.table(report.streams)
  console.log('Music scenes (9 s):')
  console.table(report.music)
  for (const c of report.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
  if (wavDir) console.log(`\nWAV renders written to ${wavDir}`)
}

const failed = report.checks.filter((c) => !c.pass)
if (failed.length) {
  console.error(`\naudio-check: ${failed.length} check(s) failed`)
  process.exit(1)
}
