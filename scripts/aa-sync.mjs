// Artificial Analysis model-data sync — the SOP for refreshing GPTD's model benchmarks.
//
// GPTD's per-model capability (`qualityBy`) is calibrated from real public benchmarks
// (src/sim/calibrate.ts). Those numbers drift monthly as the open-weight frontier moves.
// This script makes the refresh a fixed, repeatable pipeline instead of hand-copying:
//
//   1. snapshot — pull the FULL Artificial Analysis model list to data/aa-snapshot.json
//                 (a committed copy of AA; ~540 models). Needs AA_API_KEY (in .env).
//   2. report   — join the snapshot to our curated roster (data/roster-aa-map.json) and
//                 diff AA's current benchmark numbers against the hand-authored values in
//                 src/sim/content.ts. Flags: missing-from-snapshot, incomplete evals
//                 (the models we DON'T want), and drift. Read-only — changes nothing.
//
// AA gives us the benchmark cells that feed qualityBy (+ developer + release date). It does
// NOT give architecture (params/MoE/layers/attn), license, or context window — those stay
// hand-authored in content.ts. AA also has no SWE-bench, so the agentic axis is sourced from
// terminalbench_hard (see data/roster-aa-map.json axisBenchmarks).
//
// Usage:
//   node scripts/aa-sync.mjs snapshot     # refresh data/aa-snapshot.json from the API
//   node scripts/aa-sync.mjs report       # diff snapshot vs content.ts (read-only)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = join(ROOT, 'data', 'aa-snapshot.json')
const MAP = join(ROOT, 'data', 'roster-aa-map.json')
const CONTENT = join(ROOT, 'src', 'sim', 'content.ts')
const AA_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models'

const loadEnv = () => {
  const f = join(ROOT, '.env')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function snapshot() {
  loadEnv()
  const key = process.env.AA_API_KEY
  if (!key) throw new Error('AA_API_KEY not set (put it in .env)')
  process.stdout.write(`fetching ${AA_URL} …\n`)
  const res = await fetch(AA_URL, { headers: { 'x-api-key': key } })
  if (!res.ok) throw new Error(`AA API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (!Array.isArray(json.data)) throw new Error('unexpected AA response shape')
  writeFileSync(SNAPSHOT, JSON.stringify(json, null, 2))
  console.log(`✓ wrote ${SNAPSHOT} — ${json.data.length} models`)
}

// Parse the hand-authored `bench` cells out of content.ts ROSTER (read-only, regex —
// the report only needs the numeric inputs, not the whole TS).
function parseCurrentBench() {
  const src = readFileSync(CONTENT, 'utf8')
  const start = src.indexOf('const ROSTER')
  const end = src.indexOf('export const MODEL_DEFS')
  const region = src.slice(start, end > start ? end : undefined)
  const out = {}
  const re = /id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?bench:\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(region))) {
    const [, id, name, body] = m
    const cell = (k) => {
      const mm = body.match(new RegExp(`${k}:\\s*(-?[\\d.]+)`))
      return mm ? parseFloat(mm[1]) : null
    }
    out[id] = {
      name,
      mmluPro: cell('mmluPro'),
      gpqaDiamond: cell('gpqaDiamond'),
      liveCodeBench: cell('liveCodeBench'),
      aime: cell('aime'),
      sweBench: cell('sweBench'),
    }
  }
  return out
}

// The per-axis weighted blend (mirrors src/sim/calibrate.ts BLEND — keep in sync).
const BLEND = {
  chat: [['ifBench', 0.6], ['gpqaDiamond', 0.2], ['lcr', 0.2]],
  general: [['gpqaDiamond', 0.6], ['ifBench', 0.2], ['lcr', 0.2]],
  coding: [['sciCode', 0.6], ['terminalBenchHard', 0.2], ['ifBench', 0.2]],
  reasoning: [['hle', 0.6], ['gpqaDiamond', 0.2], ['lcr', 0.2]],
  agentic: [['terminalBenchHard', 0.6], ['ifBench', 0.2], ['lcr', 0.2]],
}
const CELL_LABEL = { gpqaDiamond: 'GPQA-D', ifBench: 'IFBench', lcr: 'LCR', sciCode: 'SciCode', terminalBenchHard: 'TB-Hard', hle: 'HLE' }

function report() {
  if (!existsSync(SNAPSHOT)) throw new Error(`no snapshot — run: node scripts/aa-sync.mjs snapshot`)
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).data
  const cfg = JSON.parse(readFileSync(MAP, 'utf8'))
  const CELLS = Object.entries(cfg.benchmarkCells).filter(([k]) => !k.startsWith('_'))
  const bySlug = new Map(snap.map((m) => [m.slug, m]))
  const v100 = (e, aaKey) => (e[aaKey] == null ? null : e[aaKey] * 100)
  const f = (x) => (x == null ? '  —' : x.toFixed(0).padStart(4))

  const rows = []
  const missing = []
  const incomplete = []
  for (const [ourId, slug] of Object.entries(cfg.models)) {
    const aa = bySlug.get(slug)
    if (!aa) { missing.push(`${ourId} -> ${slug}`); continue }
    const e = aa.evaluations || {}
    const cells = {}
    const lacks = []
    for (const [field, aaKey] of CELLS) { const x = v100(e, aaKey); cells[field] = x; if (x == null) lacks.push(field) }
    if (lacks.length) incomplete.push(`${ourId} (missing: ${lacks.join(', ')})`)
    const comp = {}
    for (const [axis, blend] of Object.entries(BLEND)) comp[axis] = blend.reduce((s, [fld, w]) => s + (cells[fld] ?? 0) * w, 0)
    rows.push({ ourId, cells, comp })
  }

  console.log(`\n=== AA → GPTD roster benchmark report (${rows.length}/${Object.keys(cfg.models).length} joined) ===`)
  console.log(`raw cells: ${CELLS.map(([k]) => CELL_LABEL[k]).join(' ')}   |   composite axes: gen chat cod rea agt\n`)
  for (const r of rows) {
    const cellStr = CELLS.map(([field]) => f(r.cells[field])).join(' ')
    const compStr = ['general', 'chat', 'coding', 'reasoning', 'agentic'].map((a) => f(r.comp[a])).join(' ')
    console.log(`${r.ourId.padEnd(22)} ${cellStr}  |  ${compStr}`)
  }
  console.log(`\nmissing from snapshot (${missing.length}): ${missing.join('; ') || 'none'}`)
  console.log(`incomplete — missing ≥1 of the 6 (${incomplete.length}): ${incomplete.join('; ') || 'none'}`)
}

// Generate src/sim/roster.bench.generated.ts: the AA-sourced benchmark cells per
// roster id (the cells AA actually has; nulls omitted). content.ts merges these
// over each model's hand-authored `bench` (AA wins; manual fills AA's gaps).
const GENERATED = join(ROOT, 'src', 'sim', 'roster.bench.generated.ts')
function build() {
  if (!existsSync(SNAPSHOT)) throw new Error(`no snapshot — run: node scripts/aa-sync.mjs snapshot`)
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).data
  const cfg = JSON.parse(readFileSync(MAP, 'utf8'))
  // BenchInputs field -> AA eval key (the cells calibrate.ts blends per axis).
  const CELLS = Object.entries(cfg.benchmarkCells).filter(([k]) => !k.startsWith('_'))
  const bySlug = new Map(snap.map((m) => [m.slug, m]))
  const cell = (e, key) => (e[key] == null ? undefined : Math.round(e[key] * 1000) / 10)

  const lines = []
  let joined = 0
  for (const [ourId, slug] of Object.entries(cfg.models)) {
    const aa = bySlug.get(slug)
    if (!aa) { console.warn(`  ! ${ourId} -> ${slug} not in snapshot — skipped`); continue }
    const e = aa.evaluations || {}
    const body = CELLS.map(([field, aaKey]) => [field, cell(e, aaKey)])
      .filter(([, v]) => v != null)
      .map(([field, v]) => `${field}: ${v}`)
      .join(', ')
    lines.push(`  ${ourId}: { ${body} }, // ${slug}`)
    joined++
  }

  const out =
    `// AUTO-GENERATED by \`node scripts/aa-sync.mjs build\` — do NOT edit by hand.\n` +
    `// Source: Artificial Analysis (https://artificialanalysis.ai), data/aa-snapshot.json.\n` +
    `// These are the benchmark cells AA currently publishes per model; content.ts merges\n` +
    `// them OVER each roster entry's hand-authored \`bench\` (AA wins; manual fills the gaps).\n` +
    `// Refresh: \`node scripts/aa-sync.mjs snapshot && node scripts/aa-sync.mjs build\`.\n` +
    `import type { BenchInputs } from './calibrate'\n\n` +
    `export const AA_BENCH: Record<string, Partial<BenchInputs>> = {\n${lines.join('\n')}\n}\n`
  writeFileSync(GENERATED, out)
  console.log(`✓ wrote ${GENERATED} — ${joined} models`)
}

// Refresh the per-model benchmark lines in docs/MODEL-CATALOG.md for the IN-GAME ROSTER
// (the 30 models in the curated map) from the AA snapshot, and rename the SWE-bench column
// to Terminal-Bench Hard (the agentic axis source). Roster entries get fresh AA numbers (a
// cell AA lacks keeps its current value); every OTHER catalog entry keeps its MMLU-Pro/GPQA/
// AIME/LiveCodeBench cells but has its old SWE-bench number cleared to `—` (it would be
// mislabelled under the renamed column). Only the `Benchmarks —` lines are touched.
const CATALOG = join(ROOT, 'docs', 'MODEL-CATALOG.md')
function catalog() {
  if (!existsSync(SNAPSHOT)) throw new Error(`no snapshot — run: node scripts/aa-sync.mjs snapshot`)
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).data
  const cfg = JSON.parse(readFileSync(MAP, 'utf8'))
  const CELLS = Object.entries(cfg.benchmarkCells).filter(([k]) => !k.startsWith('_')) // [field, aaKey]
  const current = parseCurrentBench() // roster id -> { name, … } from content.ts
  const aliases = cfg.catalogAliases || {}
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const fmt = (v) => (v == null ? '—' : String(Math.round(v * 1000) / 10))
  const cellsOf = (aa) => {
    const e = aa.evaluations || {}
    const o = {}
    for (const [field, aaKey] of CELLS) o[field] = e[aaKey] ?? null // 0..1
    return o
  }

  // roster: pinned via the curated map (alias-aware), reliable.
  const bySlug = new Map(snap.map((m) => [m.slug, m]))
  const rosterCells = {}
  for (const [id, slug] of Object.entries(cfg.models)) {
    const aa = bySlug.get(slug)
    const name = aliases[id] ?? current[id]?.name
    if (aa && name) rosterCells[norm(name)] = cellsOf(aa)
  }
  // non-roster: best-effort EXACT normalized-name match (display only; never feeds the game).
  const byName = new Map()
  for (const m of snap) {
    byName.set(norm(m.slug), m)
    const nm = norm(m.name.split('(')[0])
    if (!byName.has(nm)) byName.set(nm, m)
  }

  const lines = readFileSync(CATALOG, 'utf8').split('\n')
  let curName = null
  let rewritten = 0
  let rosterHit = 0
  let nonHit = 0
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### (.+?)\s*★?\s*$/)
    if (h) { curName = h[1].trim(); continue }
    if (!lines[i].startsWith('Benchmarks')) continue
    rewritten++
    const key = curName ? norm(curName) : ''
    let cells = rosterCells[key]
    if (cells) rosterHit++
    else { const aa = byName.get(key); if (aa) { cells = cellsOf(aa); nonHit++ } }
    const body = CELLS.map(([field]) => `${CELL_LABEL[field]} ${cells ? fmt(cells[field]) : '—'}`).join(' · ')
    lines[i] = `Benchmarks — ${body}  `
  }
  writeFileSync(CATALOG, lines.join('\n'))
  console.log(`✓ updated ${CATALOG} — ${rewritten} benchmark lines → ${CELLS.map(([f]) => CELL_LABEL[f]).join('/')}`)
  console.log(`  roster filled from AA: ${rosterHit}; non-roster best-effort exact-name: ${nonHit}; blank: ${rewritten - rosterHit - nonHit}`)
}

const cmd = process.argv[2]
try {
  if (cmd === 'snapshot') await snapshot()
  else if (cmd === 'report') report()
  else if (cmd === 'build') build()
  else if (cmd === 'catalog') catalog()
  else { console.error('usage: node scripts/aa-sync.mjs <snapshot|report|build|catalog>'); process.exit(1) }
} catch (e) {
  console.error('✗', e.message)
  process.exit(1)
}
