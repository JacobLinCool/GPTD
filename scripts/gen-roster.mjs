// Generated-pool builder — the `g_` half of the roster's candidate pool.
//
// OPEN-WEIGHT EVIDENCE is explicit: a checkpoint enters the pool only if it has a Hugging Face
// repo in data/model-arch.json (keyed by repo, with its architecture read off config.json and the
// Artificial Analysis rows that measure it in `aa`). Every such checkpoint that no hand-authored
// ROSTER entry claims (`hf:` in src/sim/content.ts) becomes a generated RosterEntry:
//   - its AA pin is the strongest variant among its `aa` rows (a thinking variant breaks ties),
//     pinned by AA UUID in data/roster-aa-map.json;
//   - it needs the BRIDGE PREDICTORS measured (HLE and LCR, plus SciCode or GPQA) so every
//     canonical cell can be resolved on the reference scale (scripts/aa-cells.mjs);
//   - its ids are STABLE: an existing `g_` pin keeps its id, new checkpoints are appended.
// There is no per-bucket selection any more: the frontier-tolerance gate in calibrate.ts decides
// at load which candidates are active, and docs/PARETO.md documents the result.
//
// Outputs (run: `node scripts/gen-roster.mjs`, after `aa-sync.mjs bridges` + `arch-sync.mjs build`):
//   - src/sim/roster.generated.ts   the generated RosterEntry[]
//   - data/roster-aa-map.json       new `g_` pins appended
// THEN run `node scripts/aa-sync.mjs build` to regenerate the benchmark cells for every pin.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, MAP_PATH, loadSnapshots, loadBridges, resolveCells, measuredRow, recordOf, pinnedModels, pinProblem } from './aa-cells.mjs'
import { loadArch, derive } from './arch-sync.mjs'
import { alignmentFamilyOf } from './resolve-arch.mjs'

const snaps = loadSnapshots()
const fits = loadBridges()
const map = snaps.map
const arch = loadArch().models

// the per-axis blend (mirrors src/sim/calibrate.ts BLEND) on reference-scale AA keys
const BLEND = {
  chat: [['ifbench', 0.6], ['gpqa', 0.2], ['lcr', 0.2]],
  general: [['gpqa', 0.6], ['ifbench', 0.2], ['lcr', 0.2]],
  coding: [['scicode', 0.6], ['terminalbench_hard', 0.2], ['ifbench', 0.2]],
  reasoning: [['hle', 0.6], ['gpqa', 0.2], ['lcr', 0.2]],
  agentic: [['terminalbench_hard', 0.6], ['ifbench', 0.2], ['lcr', 0.2]],
}
const AXES = Object.keys(BLEND)
const composites = (cells) => Object.fromEntries(AXES.map((a) => [a, BLEND[a].reduce((s, [k, w]) => s + (cells[k] ?? 0) * w, 0)]))
const isThinkingVariant = (name) => !/non-reasoning/i.test(name) && /reasoning|thinking|thinker|\br1\b|\((?:low|medium|high|xhigh|max)\b/i.test(name)
const isMultimodalOnly = (slug) => /\b(vl|omni|vision|audio|image|multimodal)\b/.test(slug.replace(/-/g, ' '))
/** The bridge predictors must be MEASURED so the six canonical cells resolve. */
const hasPredictors = (aaId) => {
  const { row } = measuredRow(snaps, fits.equating, aaId)
  return row.hle != null && row.lcr != null && (row.scicode != null || row.gpqa != null)
}

// hand-authored checkpoints (content.ts ROSTER `hf:`), excluding the generated spread
const content = readFileSync(join(ROOT, 'src', 'sim', 'content.ts'), 'utf8')
const region = content.slice(content.indexOf('const ROSTER: RosterEntry[]'), content.indexOf('...GENERATED_ROSTER'))
const handRepos = new Set([...region.matchAll(/\bhf: '([^']+)'/g)].map((m) => m[1]))
const repoOfAa = new Map()
for (const [repo, e] of Object.entries(arch)) for (const id of Object.values(e.aa ?? {})) repoOfAa.set(id, repo)

const pins = pinnedModels(map)
const handPins = pins.filter(([id]) => !id.startsWith('g_'))
const genPins = pins.filter(([id]) => id.startsWith('g_'))
for (const [id, pin] of pins) {
  const p = pinProblem(snaps, id, pin)
  if (p) throw new Error(p)
}

// existing g_ entries keep their id + pin; their checkpoint must have an arch record
const generated = []
const claimed = new Set(handRepos)
for (const [id, pin] of genPins) {
  const repo = repoOfAa.get(pin.aaId)
  if (!repo) throw new Error(`${id}: AA ${pin.aaId} (${pin.slug}) is not listed under any data/model-arch.json checkpoint`)
  if (claimed.has(repo)) throw new Error(`${id}: checkpoint ${repo} is already claimed`)
  claimed.add(repo)
  generated.push({ id, repo, pin, isNew: false })
}

// new candidates: unclaimed checkpoints with open-weight evidence
const usedIds = new Set(pins.map(([id]) => id))
const idFor = (slug) => {
  const base = 'g_' + slug.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28)
  let id = base
  let i = 2
  while (usedIds.has(id)) id = `${base}_${i++}`
  usedIds.add(id)
  return id
}
const skipped = []
for (const [repo, e] of Object.entries(arch)) {
  if (claimed.has(repo)) continue
  const variants = Object.entries(e.aa ?? {}).filter(([slug]) => !isMultimodalOnly(slug))
  if (!variants.length) { skipped.push(`${repo} (no text AA row)`); continue }
  let best = null
  for (const [slug, aaId] of variants) {
    if (!hasPredictors(aaId)) continue
    const rec = recordOf(snaps, aaId)
    const c = composites(resolveCells(snaps, fits, aaId).cells)
    const score = AXES.reduce((s, a) => s + c[a], 0) + (isThinkingVariant(rec.name) ? 5 : 0)
    if (!best || score > best.score) best = { slug, aaId, score }
  }
  if (!best) { skipped.push(`${repo} (bridge predictors not measured)`); continue }
  claimed.add(repo)
  generated.push({ id: idFor(best.slug), repo, pin: { slug: snaps.latest.byId.get(best.aaId)?.slug ?? best.slug, aaId: best.aaId }, isNew: true })
}

// ---- derive the RosterEntry fields ----
const ALIGN = {
  llama: [62, 'hard-refusal', 0.13], 'qwen-dense': [58, 'hard-refusal', 0.12], 'qwen-moe': [58, 'hard-refusal', 0.12],
  'qwen-next': [58, 'hard-refusal', 0.12], gemma: [70, 'hard-refusal', 0.15], mistral: [55, 'hard-refusal', 0.1],
  phi: [55, 'hard-refusal', 0.1], gptoss: [84, 'safe-completion', 0.03], 'glm-air': [60, 'hard-refusal', 0.11],
  'glm-mla': [60, 'hard-refusal', 0.11], deepseek: [60, 'hard-refusal', 0.11], kimi: [60, 'hard-refusal', 0.11],
  minimax: [60, 'hard-refusal', 0.11], nemotron: [64, 'hard-refusal', 0.12], default: [55, 'hard-refusal', 0.12],
}
const tierOf = (paramsTotalB, c) => {
  const peak = Math.max(...AXES.map((a) => c[a]))
  if (paramsTotalB >= 100 || peak >= 70) return 'frontier'
  if (c.coding >= c.reasoning && c.coding >= 28) return 'coding'
  if (paramsTotalB <= 16) return 'small'
  return 'general'
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`
const ATTN_PHRASE = {
  MHA: () => 'full multi-head attention',
  MQA: () => 'multi-query attention',
  GQA: (d) => `full GQA attention (${kb(d.kvBytesPerToken)} of KV per token)`,
  MLA: (d) => `MLA latent attention (${kb(d.kvBytesPerToken)} of KV per token)`,
  csa: (d) => `compressed sparse attention (${kb(d.kvBytesPerToken)} of KV per token)`,
  'hybrid-linear': (d) => `a linear/SSM hybrid — ${d.kvLayers} of ${d.layers} layers keep KV (${kb(d.kvBytesPerToken)} per token)`,
  'hybrid-swa': (d) => `a sliding-window hybrid — ${d.kvLayers} of ${d.layers} layers keep a growing KV (${kb(d.kvBytesPerToken)} per token)`,
}
const rosterIdOfRepo = new Map()
for (const [id, pin] of handPins) { const r = repoOfAa.get(pin.aaId); if (r) rosterIdOfRepo.set(r, id) }
for (const g of generated) rosterIdOfRepo.set(g.repo, g.id)

const entries = []
for (const g of generated) {
  const e = arch[g.repo]
  const d = derive(e)
  const rec = recordOf(snaps, g.pin.aaId)
  const c = composites(resolveCells(snaps, fits, g.pin.aaId).cells)
  const spec = AXES.reduce((best, a) => (c[a] > c[best] ? a : best), AXES[0])
  const dev = rec.model_creator?.name || 'Unknown'
  const al = ALIGN[alignmentFamilyOf(dev, rec.slug)] || ALIGN.default
  const name = rec.name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const base = e.base ? rosterIdOfRepo.get(e.base) : undefined
  const size = d.isMoE ? `a ${d.paramsTotalB}B MoE with ${d.paramsActiveB}B active` : `${d.paramsTotalB}B dense`
  const precision = d.precision === 'BF16' ? '' : `, released in ${d.precision}`
  entries.push(
    `  { id: '${g.id}', name: '${esc(name)}', tier: '${tierOf(d.paramsTotalB, c)}', variant: 'instruct', spec: '${spec}', hf: '${g.repo}',\n` +
      `    bench: {}, alignment: { safety: ${al[0]}, refusalStyle: '${al[1]}', overRefusal: ${al[2]} }, instructFollow: 85,\n` +
      `    real: { developer: '${esc(dev)}', released: '${rec.release_date || '—'}', confidence: '${d.confidence}'${base ? `, baseModelId: '${base}', relation: 'finetune'` : ''} },\n` +
      `    desc: '${esc(`${name}: ${size} on ${ATTN_PHRASE[d.attn](d)}${precision}.`)}' },`,
  )
}

const out =
  `// AUTO-GENERATED by \`node scripts/gen-roster.mjs\` — do NOT edit by hand.\n` +
  `// ${entries.length} open-weight checkpoints from data/model-arch.json that no hand-authored ROSTER entry claims.\n` +
  `// Architecture comes from MODEL_ARCH (roster.arch.generated.ts, keyed by \`hf\`), benchmarks from AA_BENCH\n` +
  `// (roster.bench.generated.ts); the frontier-tolerance gate in calibrate.ts decides which are active.\n` +
  `import type { RosterEntry } from './content'\n\n` +
  `export const GENERATED_ROSTER: RosterEntry[] = [\n${entries.join('\n')}\n]\n`
writeFileSync(join(ROOT, 'src', 'sim', 'roster.generated.ts'), out)

const newPins = Object.fromEntries(generated.filter((g) => g.isNew).map((g) => [g.id, g.pin]))
map.models = { ...map.models, ...newPins }
writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n')

console.log(`✓ wrote src/sim/roster.generated.ts — ${entries.length} generated entries (${Object.keys(newPins).length} new: ${Object.keys(newPins).join(', ') || 'none'})`)
if (skipped.length) console.log(`  skipped (${skipped.length}): ${skipped.join('; ')}`)
console.log('  next: node scripts/aa-sync.mjs build')
