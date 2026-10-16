// Artificial Analysis model-data sync — the SOP for refreshing GPTD's model benchmarks.
//
// GPTD's per-model capability (`qualityBy`) is calibrated from six real public benchmark cells
// (src/sim/calibrate.ts). Artificial Analysis re-runs, re-scores and retires evals over time, so
// the refresh is a fixed pipeline on a FROZEN reference scale (scripts/aa-cells.mjs explains the
// resolution order: reference → latest/equated → bridge):
//
//   1. snapshot — pull the full AA model list to data/aa-snapshot.json (the LATEST snapshot; the
//                 reference data/aa-reference-2026-06-21.json is never touched). Needs AA_API_KEY.
//   2. bridges  — fit the same-UUID equating + the cross-benchmark bridges on both snapshots and
//                 write data/aa-bridges.json (committed, so builds are deterministic and reviewable).
//   3. build    — resolve every pinned roster model by AA UUID (refusing a recycled or renamed slug)
//                 and emit src/sim/roster.bench.generated.ts: the six canonical cells, the display-
//                 only successor cells, per-cell provenance, and AA's serving telemetry — plus, for
//                 every HYBRID checkpoint (data/model-thinking.json), its instant-mode cells: from
//                 its `instant` pin when AA measured the Non-reasoning row, else the pair fit.
//   4. report   — read-only: bridged cells with their uncertainty, pin problems, unpinned checkpoints.
//   5. catalog  — refresh the `Benchmarks —` lines in docs/MODEL-CATALOG.md (bridged values labelled).
//   6. table    — regenerate the human-readable data/aa-snapshot-full.{csv,md} views of the latest snapshot.
//
// AA gives benchmarks + developer + release date + serving telemetry. Architecture, license and
// context window come from Hugging Face (scripts/arch-sync.mjs → data/model-arch.json).
//
// Usage: node scripts/aa-sync.mjs <snapshot|bridges|build|report|catalog|table>

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROOT, BRIDGES_PATH, LATEST_PATH, CANONICAL, SUCCESSOR, LABEL,
  loadSnapshots, loadBridges, fitBridges, resolveCells, emitCell, perfOf, pinnedModels, pinProblem, recordOf,
  instantFromThinking, thinkingByAaId,
} from './aa-cells.mjs'

const AA_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models'
const GENERATED = join(ROOT, 'src', 'sim', 'roster.bench.generated.ts')
const CATALOG = join(ROOT, 'docs', 'MODEL-CATALOG.md')
const ARCH = join(ROOT, 'data', 'model-arch.json')

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
  const body = await res.text()
  const json = JSON.parse(body)
  if (!Array.isArray(json.data)) throw new Error('unexpected AA response shape')
  writeFileSync(LATEST_PATH, body) // verbatim, like the committed reference
  console.log(`✓ wrote ${LATEST_PATH} — ${json.data.length} models (next: bridges, then build)`)
}

function bridges() {
  const snaps = loadSnapshots()
  const fits = fitBridges(snaps)
  const out = {
    _comment:
      'Fitted by `node scripts/aa-sync.mjs bridges` (scripts/aa-cells.mjs). equating maps a re-scored latest cell back to the reference scale (ref = a + b·latest, fitted on same-UUID pairs; identity = AA froze the cell). bridges are OLS fits on measured reference-scale cells, tried in order (first whose predictors are all measured and n ≥ minN); a bridged value is clamped to the target\'s observed range. tb21Era imputes Terminal-Bench 2.1 (fitted on releases since `since`) before the TB-Hard bridge when a model has neither.',
    reference: snaps.map.referenceSnapshot,
    latest: 'data/aa-snapshot.json',
    models: { reference: snaps.refRows.length, latest: snaps.latestRows.length },
    ...fits,
  }
  writeFileSync(BRIDGES_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(`✓ wrote ${BRIDGES_PATH}`)
  for (const [k, e] of Object.entries(fits.equating)) console.log(`  equate ${LABEL[k].padEnd(8)} ${e.kind === 'identity' ? `identity (frozen, n=${e.n})` : `ref = ${e.a} + ${e.b}·latest  (n=${e.n}, r=${e.r}, sd=${e.sd})`}`)
  for (const [t, list] of Object.entries(fits.bridges)) {
    for (const f of list) console.log(`  bridge ${LABEL[t].padEnd(8)} ← ${f.preds.map((p) => LABEL[p]).join('+').padEnd(22)} n=${String(f.n).padStart(3)} R=${f.R} sd=${f.sd}`)
  }
  for (const f of fits.tb21Era.fits) console.log(`  impute TB-2.1 (≥${fits.tb21Era.since}) ← ${f.preds.map((p) => LABEL[p]).join('+').padEnd(16)} n=${String(f.n).padStart(3)} R=${f.R} sd=${f.sd}`)
  for (const [k, f] of Object.entries(fits.instant.fits)) console.log(`  instant ${LABEL[k].padEnd(8)} = ${f.a} + ${f.b}·thinking  (n=${f.n} of ${fits.instant.pairs} pairs, R=${f.R}, sd=${f.sd})`)
}

/**
 * The instant-mode cells of a hybrid: its instant pin resolved like any pin (a canonical cell
 * the Non-reasoning row cannot resolve falls back to the pair fit), or — with no pin — the pair
 * fit applied to its thinking cells. `src` per cell: the pin's provenance, or 'pairfit sd=<x>'.
 */
function resolveInstant(snaps, fits, pin, thinking) {
  if (!fits.instant) throw new Error('data/aa-bridges.json has no instant pair fit — run: node scripts/aa-sync.mjs bridges')
  const derived = instantFromThinking(fits.instant, thinking.cells)
  const pairSrc = (k) => `pairfit sd=${fits.instant.fits[k].sd}`
  if (!pin.instant) {
    return { via: null, cells: derived, src: Object.fromEntries(Object.keys(derived).map((k) => [k, pairSrc(k)])), sd: {} }
  }
  const r = resolveCells(snaps, fits, pin.instant.aaId)
  for (const k of CANONICAL) {
    if (r.cells[k] != null || derived[k] == null) continue
    r.cells[k] = derived[k]
    r.src[k] = pairSrc(k)
  }
  return { via: recordOf(snaps, pin.instant.aaId).name, ...r }
}

/** Resolve every pinned roster model; throws on a recycled/renamed slug. */
function resolveRoster() {
  const snaps = loadSnapshots()
  const fits = loadBridges()
  const modes = thinkingByAaId()
  const problems = []
  const rows = []
  for (const [id, pin] of pinnedModels(snaps.map)) {
    const p = pinProblem(snaps, id, pin)
    if (p) { problems.push(p); continue }
    const mode = modes.get(pin.aaId)?.mode
    if (!mode) { problems.push(`${id}: AA ${pin.aaId} is not listed under any data/model-arch.json checkpoint`); continue }
    if (pin.instant && mode !== 'hybrid') { problems.push(`${id}: has an instant pin but its checkpoint is '${mode}' in data/model-thinking.json`); continue }
    const r = resolveCells(snaps, fits, pin.aaId)
    const instant = mode === 'hybrid' ? resolveInstant(snaps, fits, pin, r) : null
    rows.push({ id, pin, mode, rec: recordOf(snaps, pin.aaId), ...r, instant })
  }
  return { snaps, fits, rows, problems }
}

const tsKey = (s) => (/^[a-z_][a-z0-9_]*$/i.test(s) ? s : `'${s}'`)
const tsStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function build() {
  const { snaps, rows, problems } = resolveRoster()
  if (problems.length) throw new Error(`pin problems — fix data/roster-aa-map.json:\n  ${problems.join('\n  ')}`)
  const cells = Object.entries(snaps.map.benchmarkCells).filter(([k]) => !k.startsWith('_')) // [field, aaKey]
  const succ = Object.entries(SUCCESSOR) // [aaKey, field]
  const bench = []
  const source = []
  const meta = []
  const instBench = []
  const instSource = []
  const instVia = []
  for (const r of rows) {
    if (r.instant) {
      const body = []
      const prov = []
      for (const [field, key] of cells) {
        const v = r.instant.cells[key]
        if (v == null) throw new Error(`${r.id}: hybrid with no instant ${LABEL[key]} cell`)
        const src = r.instant.src[key]
        body.push(`${field}: ${emitCell(snaps, r.pin.instant?.aaId, key, v, src)}`)
        if (src !== 'ref') prov.push(`${field}: ${tsStr(r.instant.sd[key] != null ? `${src} sd=${r.instant.sd[key]}` : src)}`)
      }
      instBench.push(`  ${r.id}: { ${body.join(', ')} }, // ${r.pin.instant?.slug ?? 'pair fit'}`)
      if (prov.length) instSource.push(`  ${r.id}: { ${prov.join(', ')} },`)
      instVia.push(`  ${tsKey(r.id)}: ${tsStr(r.instant.via ?? '')},`)
    }
    const body = []
    const prov = []
    for (const [field, key] of cells) {
      if (r.cells[key] == null) continue
      body.push(`${field}: ${emitCell(snaps, r.pin.aaId, key, r.cells[key], r.src[key])}`)
      if (r.src[key] !== 'ref') prov.push(`${field}: ${tsStr(r.sd[key] != null ? `${r.src[key]} sd=${r.sd[key]}` : r.src[key])}`)
    }
    for (const [key, field] of succ) if (r.cells[key] != null) body.push(`${field}: ${emitCell(snaps, r.pin.aaId, key, r.cells[key], r.src[key])}`)
    bench.push(`  ${r.id}: { ${body.join(', ')} }, // ${r.pin.slug}`)
    if (prov.length) source.push(`  ${r.id}: { ${prov.join(', ')} },`)
    const perf = perfOf(snaps, r.pin.aaId)
    const m = [`name: ${tsStr(r.rec.name)}`, `released: ${tsStr(r.rec.release_date ?? '')}`]
    if (perf) m.push(`ttftS: ${perf.ttftS}`, `ttfatS: ${perf.ttfatS}`, `tps: ${perf.tps}`)
    meta.push(`  ${tsKey(r.id)}: { ${m.join(', ')} },`)
  }
  const out =
    `// AUTO-GENERATED by \`node scripts/aa-sync.mjs build\` — do NOT edit by hand.\n` +
    `// Source: Artificial Analysis (https://artificialanalysis.ai) — data/aa-reference-2026-06-21.json (the\n` +
    `// calibration reference scale) + data/aa-snapshot.json (latest), resolved per cell by scripts/aa-cells.mjs\n` +
    `// with the committed fits in data/aa-bridges.json. content.ts merges AA_BENCH OVER each roster entry's\n` +
    `// hand-authored \`bench\`. Refresh: \`node scripts/aa-sync.mjs snapshot && … bridges && … build\`.\n` +
    `import type { BenchInputs } from './calibrate'\n\n` +
    `/** Benchmark cells per roster id (reference scale, 0–100 %): the six canonical cells + display-only successors. */\n` +
    `export const AA_BENCH: Record<string, Partial<BenchInputs>> = {\n${bench.join('\n')}\n}\n\n` +
    `/**\n * Provenance of every canonical cell that is NOT a reference-snapshot measurement (display-only):\n` +
    ` * 'latest' = measured in the latest snapshot (a frozen eval), 'eq' = re-scored and equated back to the\n` +
    ` * reference scale, 'bridge:<predictors> sd=<x>' = estimated from measured cells (≈, with its residual sd).\n */\n` +
    `export const AA_BENCH_SOURCE: Record<string, Partial<Record<keyof BenchInputs, string>>> = {\n${source.join('\n')}\n}\n\n` +
    `/** AA's display name + release date for the pinned variant, and its serving telemetry on AA's 1K-token prompt\n` +
    ` *  (time to first token, time to first ANSWER token, output tok/s) when a provider was measured. */\n` +
    `export const AA_META: Record<string, { name: string; released: string; ttftS?: number; ttfatS?: number; tps?: number }> = {\n${meta.join('\n')}\n}\n\n` +
    `/**\n * INSTANT-MODE cells (thinking off) of every HYBRID checkpoint (data/model-thinking.json), same reference\n` +
    ` * scale: resolved from its \`instant\` pin (AA's Non-reasoning row of the same checkpoint) or, without one,\n` +
    ` * the per-cell pair fit in data/aa-bridges.json applied to its thinking cells. content.ts calibrates\n` +
    ` * qualityByInstant from these through the same curves as qualityBy.\n */\n` +
    `export const AA_BENCH_INSTANT: Record<string, Partial<BenchInputs>> = {\n${instBench.join('\n')}\n}\n\n` +
    `/** Provenance of every instant cell that is not a reference measurement: as AA_BENCH_SOURCE, plus 'pairfit sd=<x>'. */\n` +
    `export const AA_BENCH_INSTANT_SOURCE: Record<string, Partial<Record<keyof BenchInputs, string>>> = {\n${instSource.join('\n')}\n}\n\n` +
    `/** The AA row each hybrid's instant vector was measured on ('' = derived from the pair fit). */\n` +
    `export const AA_INSTANT_VIA: Record<string, string> = {\n${instVia.join('\n')}\n}\n`
  writeFileSync(GENERATED, out)
  console.log(`✓ wrote ${GENERATED} — ${rows.length} models, ${source.length} with non-reference cells, ${instBench.length} hybrids with an instant vector (${rows.filter((r) => r.instant?.via).length} pinned, ${rows.filter((r) => r.instant && !r.instant.via).length} pair-fit)`)
}

function report() {
  const { snaps, rows, problems } = resolveRoster()
  const f = (x) => (x == null ? '    —' : x.toFixed(1).padStart(5))
  const mark = (r, k) => (r.src[k]?.startsWith('bridge') ? '≈' : r.src[k] === 'eq' ? '~' : ' ')
  console.log(`\n=== AA → GPTD roster cells (${rows.length} pinned; reference scale) — ≈ bridged, ~ equated ===`)
  console.log(`${'id'.padEnd(34)} ${CANONICAL.map((k) => LABEL[k].padStart(6)).join('')}`)
  for (const r of rows) console.log(`${r.id.padEnd(34)} ${CANONICAL.map((k) => f(r.cells[k]) + mark(r, k)).join('')}`)
  const hybrids = rows.filter((r) => r.instant)
  console.log(`\n=== instant mode (thinking off) of the ${hybrids.length} hybrid checkpoints — ≈ bridged, ~ equated, ƒ pair fit ===`)
  const markI = (r, k) => (r.instant.src[k]?.startsWith('pairfit') ? 'ƒ' : r.instant.src[k]?.startsWith('bridge') ? '≈' : r.instant.src[k] === 'eq' ? '~' : ' ')
  for (const r of hybrids) console.log(`${r.id.padEnd(34)} ${CANONICAL.map((k) => f(r.instant.cells[k]) + markI(r, k)).join('')}  ${r.instant.via ?? '(pair fit)'}`)
  const bridged = rows.flatMap((r) => CANONICAL.filter((k) => r.src[k]?.startsWith('bridge')).map((k) => `${r.id}.${LABEL[k]} ${r.src[k]} (sd ${r.sd[k]})`))
  console.log(`\nbridged cells (${bridged.length}):\n  ${bridged.join('\n  ') || 'none'}`)
  console.log(`\npin problems (${problems.length}): ${problems.join('; ') || 'none'}`)
  // checkpoints with open-weight evidence that no roster id pins yet (gen-roster candidates)
  if (existsSync(ARCH)) {
    const arch = JSON.parse(readFileSync(ARCH, 'utf8')).models
    const pinned = new Set(pinnedModels(snaps.map).map(([, p]) => p.aaId))
    const free = Object.entries(arch).filter(([, e]) => !Object.values(e.aa ?? {}).some((u) => pinned.has(u))).map(([repo]) => repo)
    console.log(`unpinned checkpoints in data/model-arch.json (${free.length}): ${free.join(', ') || 'none'}`)
  }
}

/** Roster display names (id → name), read from the hand-authored + generated roster sources. */
function rosterNames() {
  const out = {}
  for (const f of ['content.ts', 'roster.generated.ts']) {
    const src = readFileSync(join(ROOT, 'src', 'sim', f), 'utf8')
    for (const m of src.matchAll(/id: '([^']+)', name: '((?:[^'\\]|\\.)*)'/g)) out[m[1]] = m[2].replace(/\\'/g, "'")
  }
  return out
}

// Refresh the `Benchmarks —` lines of docs/MODEL-CATALOG.md: roster entries (matched through the
// catalog aliases, roster names and AA names) get the resolved reference-scale cells, a bridged value
// reads `≈74.8 (bridged)`; other catalog entries keep a best-effort exact-name match (display only).
function catalog() {
  const { snaps, rows } = resolveRoster()
  const cfg = snaps.map
  const aliases = cfg.catalogAliases || {}
  const names = rosterNames()
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const fmtV = (v) => String(Math.round(v * 10) / 10)
  const byName = {}
  for (const r of rows) {
    const cands = [aliases[r.id], names[r.id], r.rec.name, r.rec.name.replace(/\s*\([^)]*\)\s*$/, '')].filter(Boolean)
    for (const n of cands) byName[norm(n)] ??= r
  }
  const exact = new Map()
  for (const m of snaps.latestRows) { exact.set(norm(m.slug), m); const nm = norm(m.name.split('(')[0]); if (!exact.has(nm)) exact.set(nm, m) }
  const lines = readFileSync(CATALOG, 'utf8').split('\n')
  let curName = null
  let hits = 0
  let bestEffort = 0
  let total = 0
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### (.+?)\s*★?\s*$/)
    if (h) { curName = h[1].trim(); continue }
    if (!lines[i].startsWith('Benchmarks')) continue
    total++
    const key = curName ? norm(curName) : ''
    const r = byName[key]
    let body
    if (r) {
      hits++
      body = CANONICAL.map((k) => (r.cells[k] == null ? `${LABEL[k]} —` : r.src[k].startsWith('bridge') ? `${LABEL[k]} ≈${fmtV(r.cells[k])} (bridged)` : `${LABEL[k]} ${fmtV(r.cells[k])}`)).join(' · ')
    } else {
      const m = exact.get(key)
      if (m) bestEffort++
      body = CANONICAL.map((k) => `${LABEL[k]} ${m?.evaluations?.[k] != null ? fmtV(m.evaluations[k] * 100) : '—'}`).join(' · ')
    }
    lines[i] = `Benchmarks — ${body}  `
  }
  writeFileSync(CATALOG, lines.join('\n'))
  console.log(`✓ updated ${CATALOG} — ${total} benchmark lines: ${hits} roster (resolved), ${bestEffort} best-effort exact-name, ${total - hits - bestEffort} blank`)
}

// The flat, human-readable views of the latest snapshot (sorted by release date).
const TABLE_KEYS = [
  ['artificial_analysis_intelligence_index', 'AA-Intel', true], ['artificial_analysis_coding_index', 'AA-Code', true], ['artificial_analysis_math_index', 'AA-Math', true],
  ['mmlu_pro', 'MMLU-Pro'], ['gpqa', 'GPQA'], ['hle', 'HLE'], ['livecodebench', 'LiveCodeBench'], ['scicode', 'SciCode'], ['math_500', 'MATH-500'], ['aime', 'AIME'],
  ['aime_25', "AIME'25"], ['ifbench', 'IFBench'], ['lcr', 'LCR'], ['terminalbench_hard', 'TB-Hard'], ['terminalbench_v2_1', 'TB-v2.1'], ['terminalbench_v4_0', 'TB-v4.0'],
  ['tau2', 'τ²-bench'], ['tau_banking', 'τ-bank'],
]
function table() {
  const rows = JSON.parse(readFileSync(LATEST_PATH, 'utf8')).data
  const sorted = rows.map((m, i) => [m, i]).sort(([a, i], [b, j]) => (a.release_date || '').localeCompare(b.release_date || '') || i - j).map(([m]) => m)
  const val = (m, [k, , index]) => { const v = m.evaluations?.[k]; return v == null ? null : index ? v : Number(v.toFixed(3)) }
  const csv = [['release_date', 'name', 'creator', 'slug', ...TABLE_KEYS.map(([k]) => k)].join(',')]
  const md = [
    `# Artificial Analysis snapshot — full table (${rows.length} models)`, '',
    'Sorted by release date. AA-Intel/Code/Math are 0–100 indices; other benchmarks are raw 0–1 scores; blank/— = absent in snapshot. This is a view of the LATEST snapshot (data/aa-snapshot.json); the calibration reference scale is data/aa-reference-2026-06-21.json.', '',
    `| Release | Model | Creator | ${TABLE_KEYS.map(([, l]) => l).join(' | ')} |`,
    `|${Array(TABLE_KEYS.length + 3).fill('---').join('|')}|`,
  ]
  const q = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  for (const m of sorted) {
    const vs = TABLE_KEYS.map((t) => val(m, t))
    csv.push([m.release_date ?? '', q(m.name), q(m.model_creator?.name ?? ''), m.slug, ...vs.map((v) => (v == null ? '' : v))].join(','))
    md.push(`| ${m.release_date ?? '—'} | ${m.name} | ${m.model_creator?.name ?? '—'} | ${vs.map((v) => (v == null ? '—' : v)).join(' | ')} |`)
  }
  writeFileSync(join(ROOT, 'data', 'aa-snapshot-full.csv'), csv.join('\n') + '\n')
  writeFileSync(join(ROOT, 'data', 'aa-snapshot-full.md'), md.join('\n') + '\n')
  console.log(`✓ wrote data/aa-snapshot-full.{csv,md} — ${rows.length} models`)
}

const cmd = process.argv[2]
try {
  if (cmd === 'snapshot') await snapshot()
  else if (cmd === 'bridges') bridges()
  else if (cmd === 'build') build()
  else if (cmd === 'report') report()
  else if (cmd === 'catalog') catalog()
  else if (cmd === 'table') table()
  else { console.error('usage: node scripts/aa-sync.mjs <snapshot|bridges|build|report|catalog|table>'); process.exit(1) }
} catch (e) {
  console.error('✗', e.message)
  process.exit(1)
}

