// Part B roster generator — expands the in-game roster from the hand-authored 30 to ~100 by
// selecting open-weight models on the per-size-bucket Pareto frontier of the 5 capability axes
// (so the ladder spans scales AND each scale offers non-dominated trade-offs), then emitting a
// full RosterEntry for each via the arch resolver (scripts/resolve-arch.mjs).
//
// Outputs (run: `node scripts/gen-roster.mjs`):
//   - src/sim/roster.generated.ts   — the generated RosterEntry[] (confidence: low/medium arch)
//   - data/roster-aa-map.json       — adds {generatedId: aaSlug} so `build`/`catalog` join them
// THEN run `node scripts/aa-sync.mjs build` to regenerate the 6-cell benchmark file for all ~100.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveArch, loadCatalog } from './resolve-arch.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = JSON.parse(readFileSync(join(ROOT, 'data', 'aa-snapshot.json'), 'utf8')).data
const MAP_PATH = join(ROOT, 'data', 'roster-aa-map.json')
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
const cat = loadCatalog()
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')

const NEEDED = ['gpqa', 'ifbench', 'lcr', 'scicode', 'terminalbench_hard', 'hle']
const BLEND = {
  chat: [['ifbench', 0.6], ['gpqa', 0.2], ['lcr', 0.2]],
  general: [['gpqa', 0.6], ['ifbench', 0.2], ['lcr', 0.2]],
  coding: [['scicode', 0.6], ['terminalbench_hard', 0.2], ['ifbench', 0.2]],
  reasoning: [['hle', 0.6], ['gpqa', 0.2], ['lcr', 0.2]],
  agentic: [['terminalbench_hard', 0.6], ['ifbench', 0.2], ['lcr', 0.2]],
}
const AXES = Object.keys(BLEND)
// open-weight creators (gpt-oss is OpenAI's only open line)
const OPEN = ['meta', 'alibaba', 'qwen', 'deepseek', 'mistral', 'google', 'microsoft', 'nvidia', 'z.ai', 'zhipu',
  'moonshot', 'minimax', 'allenai', 'ibm', 'cohere', 'xai', 'tencent', 'baidu', 'stepfun', 'reka', 'nous',
  'upstage', 'lg', 'servicenow', 'liquid', 'arcee', 'ai21', '01.ai', 'databricks', 'internlm']
const isOpen = (m) => {
  const c = (m.model_creator?.name || '').toLowerCase()
  if (c === 'openai') return (m.slug || '').startsWith('gpt-oss')
  return OPEN.some((k) => c.includes(k))
}
const comp = (e, axis) => BLEND[axis].reduce((s, [k, w]) => s + (e[k] ?? 0) * 100 * w, 0)
const bucketOf = (p) => (p <= 4 ? 0 : p <= 15 ? 1 : p <= 40 ? 2 : p <= 120 ? 3 : p <= 400 ? 4 : 5)
const BUCKET_NAME = ['≤4B', '4-15B', '15-40B', '40-120B', '120-400B', '>400B']
// per-bucket Pareto caps. Mid/large are supply-limited (all distinct quality open models there);
// the plentiful small tiers are drawn a bit deeper to reach ~100 total without redundant variants.
const TARGET_NEW = [20, 24, 30, 22, 16, 12]

// hand-authored roster = the non-generated map entries; ALL g_ entries are regenerated each run.
const handModels = Object.fromEntries(Object.entries(map.models).filter(([id]) => !id.startsWith('g_')))
const handSlugs = new Set(Object.values(handModels))
// base-model key: strip variant/effort/date suffixes so reasoning/non-reasoning/high/low/dated
// variants of the same model collapse to one (keep the version + size).
const baseKey = (slug) =>
  slug.toLowerCase()
    .replace(/-(reasoning|non-reasoning|thinking|instruct|chat|base|high|low|max|terminus|preview|it)\b/g, '')
    .replace(/-\d{4}\b/g, '')
    .replace(/-+/g, '-').replace(/-$/, '')
const handBaseKeys = new Set([...handSlugs].map(baseKey))
const isMultimodal = (s) => /\b(vl|omni|vision|audio|image|multimodal)\b/.test(s.replace(/-/g, ' '))

// ---- candidate pool: open · all-6 benchmarks · parseable params · text-only · not a hand-roster model/variant ----
const cand = []
for (const m of SNAP) {
  const e = m.evaluations || {}
  if (!NEEDED.every((b) => e[b] != null)) continue
  if (!isOpen(m)) continue
  if (handSlugs.has(m.slug) || handBaseKeys.has(baseKey(m.slug))) continue // skip hand-roster models + their variants
  if (isMultimodal(m.slug)) continue // text-serving game: drop VL/omni/vision
  const arch = resolveArch({ developer: m.model_creator?.name, name: m.name, slug: m.slug }, cat[norm(m.name.split('(')[0])] || cat[norm(m.slug)])
  if (arch.paramsTotalB == null) continue
  m._arch = arch
  m._c = Object.fromEntries(AXES.map((a) => [a, comp(e, a)]))
  m._bucket = bucketOf(arch.paramsTotalB)
  m._base = baseKey(m.slug)
  cand.push(m)
}
// dedup variants: ONE model per base key (highest summed composite; prefer the reasoning variant)
const byBase = new Map()
for (const m of cand) {
  const score = AXES.reduce((s, x) => s + m._c[x], 0) + (/reasoning|thinking/.test(m.slug) && !/non-reasoning/.test(m.slug) ? 5 : 0)
  const cur = byBase.get(m._base)
  if (!cur || score > cur._score) { m._score = score; byBase.set(m._base, m) }
}
const pool = [...byBase.values()]

// ---- per-bucket Pareto selection on the 5 caps ----
const dominates = (a, b) => AXES.every((x) => a._c[x] >= b._c[x]) && AXES.some((x) => a._c[x] > b._c[x])
function paretoPick(items, k) {
  const out = []
  let rem = items.slice()
  while (rem.length && out.length < k) {
    const front = rem.filter((x) => !rem.some((y) => y !== x && dominates(y, x)))
    // within a layer, prefer higher summed capability (tie-break) for a stronger ladder
    front.sort((a, b) => AXES.reduce((s, x) => s + b._c[x] - a._c[x], 0))
    for (const x of front) { if (out.length < k) out.push(x) }
    rem = rem.filter((x) => !front.includes(x))
  }
  return out
}

const selected = []
for (let b = 0; b < 6; b++) {
  const inBucket = pool.filter((m) => m._bucket === b)
  const picked = paretoPick(inBucket, TARGET_NEW[b])
  selected.push(...picked)
}

// ---- derive RosterEntry fields ----
const ALIGN = {
  llama: [62, 'hard-refusal', 0.13], 'qwen-dense': [58, 'hard-refusal', 0.12], 'qwen-moe': [58, 'hard-refusal', 0.12],
  'qwen-next': [58, 'hard-refusal', 0.12], gemma: [70, 'hard-refusal', 0.15], mistral: [55, 'hard-refusal', 0.1],
  phi: [55, 'hard-refusal', 0.1], gptoss: [84, 'safe-completion', 0.03], 'glm-air': [60, 'hard-refusal', 0.11],
  'glm-mla': [60, 'hard-refusal', 0.11], deepseek: [60, 'hard-refusal', 0.11], kimi: [60, 'hard-refusal', 0.11],
  minimax: [60, 'hard-refusal', 0.11], nemotron: [64, 'hard-refusal', 0.12], default: [55, 'hard-refusal', 0.12],
}
const usedIds = new Set(Object.keys(map.models))
const idFor = (slug) => {
  let base = 'g_' + slug.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28)
  let id = base, i = 2
  while (usedIds.has(id)) id = `${base}_${i++}`
  usedIds.add(id)
  return id
}
const tierOf = (arch, c) => {
  const peak = Math.max(...AXES.map((a) => c[a]))
  if (arch.paramsTotalB >= 100 || peak >= 70) return 'frontier'
  if (c.coding >= c.reasoning && c.coding >= 28) return 'coding'
  if (arch.paramsTotalB <= 16) return 'small'
  return 'general'
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const entries = []
const newMap = {}
for (const m of selected) {
  const a = m._arch, c = m._c
  const id = idFor(m.slug)
  newMap[id] = m.slug
  const spec = AXES.reduce((best, x) => (c[x] > c[best] ? x : best), AXES[0])
  const tier = tierOf(a, c)
  const al = ALIGN[a.family] || ALIGN.default
  const dev = m.model_creator?.name || 'Unknown'
  const lic = a.license || (a.family === 'gptoss' ? 'Apache 2.0' : 'open-weight (see model card)')
  const name = m.name.replace(/\s*\((?:high|low|reasoning|non-reasoning|max|max effort|high effort)\)\s*$/i, '').trim()
  entries.push(
    `  { id: '${id}', name: '${esc(name)}', tier: '${tier}', variant: 'instruct', spec: '${spec}',\n` +
    `    paramsTotalB: ${a.paramsTotalB}, paramsActiveB: ${a.paramsActiveB}, isMoE: ${!!a.isMoE}, isReasoning: ${!!a.isReasoning},\n` +
    `    layers: ${a.layers}, kvHeads: ${a.kvHeads}, headDim: ${a.headDim}, attn: '${a.attn}',\n` +
    `    bench: {}, alignment: { safety: ${al[0]}, refusalStyle: '${al[1]}', overRefusal: ${al[2]} }, instructFollow: 85,\n` +
    `    real: { developer: '${esc(dev)}', license: '${esc(lic)}', openWeights: true, released: '${m.release_date || '—'}', contextWindowK: ${a.contextWindowK}, confidence: '${a.confidence}', source: 'hf:${esc(m.slug)}' },\n` +
    `    desc: '${esc(name)} — ${a.isMoE ? `MoE ${a.paramsTotalB}B/${a.paramsActiveB}B-active` : `${a.paramsTotalB}B dense`}, ${a.attn}; auto-generated entry (arch confidence: ${a.confidence}).' },`,
  )
}

// ---- write generated roster + extend the map ----
const out =
  `// AUTO-GENERATED by \`node scripts/gen-roster.mjs\` — do NOT edit by hand.\n` +
  `// ${entries.length} open-weight models selected on the per-size-bucket Pareto frontier of the\n` +
  `// 5 capability axes (Artificial Analysis). Architecture is resolved by scripts/resolve-arch.mjs\n` +
  `// (params/license from MODEL-CATALOG + name-parse; KV-arch from family defaults — confidence:low).\n` +
  `// Benchmarks come from src/sim/roster.bench.generated.ts (merged in content.ts). Regenerate both\n` +
  `// after a snapshot refresh. The hand-authored 30 (high confidence) stay in content.ts ROSTER.\n` +
  `import type { RosterEntry } from './content'\n\n` +
  `export const GENERATED_ROSTER: RosterEntry[] = [\n${entries.join('\n')}\n]\n`
writeFileSync(join(ROOT, 'src', 'sim', 'roster.generated.ts'), out)

// rebuild the map: hand-authored models (non-g_) + freshly generated g_ entries
map.models = { ...handModels, ...newMap }
writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n')

console.log(`✓ selected ${selected.length} new models; wrote src/sim/roster.generated.ts + extended data/roster-aa-map.json`)
console.log(`  per bucket (target → picked):`)
for (let b = 0; b < 6; b++) console.log(`    ${BUCKET_NAME[b].padEnd(9)} ${TARGET_NEW[b]} → ${selected.filter((m) => m._bucket === b).length}`)
console.log(`  total roster after: ${Object.keys(map.models).length}`)
