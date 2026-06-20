// Architecture resolver — fills the model-architecture fields the roster needs but the
// Artificial Analysis API does NOT provide (params, KV-cache architecture, license).
// This is the Part B "arch-data blocker" solution: it composes three sources, best → worst
// confidence, so every selected open-weight model gets a full, deterministic RosterEntry:
//
//   1. CATALOG (docs/MODEL-CATALOG.md) — fact-checked params / context / license (where present).
//   2. NAME-PARSE — total/active params from "235B-A22B"-style names; MoE/reasoning flags.
//   3. FAMILY DEFAULTS — KV-cache architecture (attn / headDim / kvHeads) + a layers heuristic,
//      keyed on the model family. KV-arch is rarely published by AA, so it is approximated by
//      family (the BLUEPRINT's "representative + family analogy"); resolved entries are marked
//      `confidence: 'low'` on these fields.
//
// `node scripts/resolve-arch.mjs validate` checks the resolver against the 30 hand-authored
// roster entries (ground truth) and prints accuracy — run it after editing the family table.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Family KV-cache architecture defaults {attn, headDim, kvHeads}. Calibrated from the
// hand-authored roster + public model cards; `validate` measures the residual error.
export const FAMILY_ARCH = {
  llama: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'qwen-dense': { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'qwen-moe': { attn: 'GQA', headDim: 128, kvHeads: 8 }, // newer Qwen MoE use 8 (older 30B-A3B used 4)
  'qwen-next': { attn: 'GQA', headDim: 128, kvHeads: 2 },
  gemma: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  mistral: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  phi: { attn: 'GQA', headDim: 128, kvHeads: 10 },
  gptoss: { attn: 'GQA', headDim: 64, kvHeads: 8 },
  'glm-air': { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'glm-mla': { attn: 'MLA', headDim: 128, kvHeads: 128 },
  deepseek: { attn: 'MLA', headDim: 128, kvHeads: 128 },
  kimi: { attn: 'MLA', headDim: 128, kvHeads: 128 },
  minimax: { attn: 'MLA', headDim: 128, kvHeads: 8 },
  nemotron: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  default: { attn: 'GQA', headDim: 128, kvHeads: 8 },
}

/** Detect the model family from creator + name/slug. */
export function familyOf(developer, nameOrSlug) {
  const d = (developer || '').toLowerCase()
  const s = (nameOrSlug || '').toLowerCase()
  if (d.includes('deepseek') || s.includes('deepseek')) return 'deepseek'
  if (d.includes('moonshot') || s.includes('kimi')) return 'kimi'
  if (d.includes('minimax') || s.includes('minimax')) return 'minimax'
  if (d.includes('nvidia') || s.includes('nemotron')) return 'nemotron'
  if (s.includes('gpt-oss')) return 'gptoss'
  if (s.includes('glm') || d.includes('zhipu') || d.includes('z.ai')) {
    if (s.includes('air')) return 'glm-air'
    if (/glm[ -]?(5|6|4\.6)/.test(s)) return 'glm-mla' // GLM-4.6+/5.x use MLA
    return 'glm-air'
  }
  if (s.includes('gemma') || d.includes('google')) return 'gemma'
  if (s.includes('phi') || d.includes('microsoft')) return 'phi'
  if (d.includes('mistral') || /mistral|devstral|magistral/.test(s)) return 'mistral'
  if (s.includes('llama') || d.includes('meta')) return 'llama'
  if (s.includes('qwen') || d.includes('alibaba')) {
    if (s.includes('next')) return 'qwen-next'
    if (/a\d+(\.\d+)?b/.test(s)) return 'qwen-moe'
    return 'qwen-dense'
  }
  return 'default'
}

/** Layers heuristic (the fuzziest field — architecture choice, not a size law). */
function layersOf(fam, totalB, nameOrSlug) {
  const s = (nameOrSlug || '').toLowerCase()
  if (fam === 'nemotron') return /nano|ultra/.test(s) ? 8 : Math.round(40 + 14 * Math.log10(Math.max(1, totalB))) // nano/ultra are hybrid-Mamba (few attn layers); Super-class are normal-depth
  if (fam === 'deepseek' || fam === 'kimi') return 61
  if (fam === 'glm-mla') return 92
  if (fam === 'minimax') return 62
  if (fam === 'gptoss') return totalB < 60 ? 24 : 36
  if (totalB <= 2) return 16
  if (totalB <= 10) return 36
  if (totalB <= 16) return 42
  if (totalB <= 35) return 60
  if (totalB <= 85) return 72
  if (totalB <= 140) return 60
  return 90
}

/** Parse total/active params (B) from a model name/slug. */
export function parseParams(nameOrSlug) {
  const s = nameOrSlug.toLowerCase()
  const flat = s.replace(/-/g, ' ')
  const totM = flat.match(/(\d+(?:\.\d+)?)\s*b\b/)
  const actM = s.match(/a(\d+(?:\.\d+)?)\s*b\b/) // "...-a22b" / "a3b"
  return { totalB: totM ? parseFloat(totM[1]) : null, activeB: actM ? parseFloat(actM[1]) : null }
}

/** Parse params/context/license from a MODEL-CATALOG.md entry header (the high-confidence source). */
export function loadCatalog() {
  const md = readFileSync(join(ROOT, 'docs', 'MODEL-CATALOG.md'), 'utf8').split('\n')
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out = {}
  let name = null
  for (const line of md) {
    const h = line.match(/^### (.+?)\s*★?\s*$/)
    if (h) { name = h[1].trim(); continue }
    if (!name || !line.startsWith('**')) continue
    // e.g. "**Meta** · 2024-09 · License · 120B/12B Latent-MoE · 256K ctx · spec: x · lineage: y · confidence: z"
    const tot = line.match(/(\d+(?:\.\d+)?)\s*[bB]\b/)
    const act = line.match(/\/\s*(\d+(?:\.\d+)?)\s*[bB]\b/) || line.match(/[aA](\d+(?:\.\d+)?)\s*[bB]\b/)
    const ctx = line.match(/(\d+(?:\.\d+)?)\s*[kK]\s*ctx/)
    const lic = line.match(/\*\*[^*]+\*\*\s*·\s*[^·]+·\s*([^·]+?)\s*·/)
    out[norm(name)] = {
      totalB: tot ? parseFloat(tot[1]) : null,
      activeB: act ? parseFloat(act[1]) : null,
      ctxK: ctx ? parseFloat(ctx[1]) : null,
      license: lic ? lic[1].trim() : null,
    }
    name = null
  }
  return out
}

/**
 * Resolve the full architecture for a model. `catalogEntry` (from loadCatalog) is used for
 * params/context/license when present (highest confidence); name-parse + family fill the rest.
 */
export function resolveArch({ developer, name, slug }, catalogEntry) {
  const fam = familyOf(developer, slug || name)
  const fa = FAMILY_ARCH[fam]
  const np = parseParams(slug || name)
  const totalB = catalogEntry?.totalB ?? np.totalB ?? null
  const activeB = catalogEntry?.activeB ?? np.activeB ?? totalB // dense → active = total
  const isMoE = activeB != null && totalB != null && activeB < totalB - 0.01
  const s = (slug || name || '').toLowerCase()
  const isReasoning = /reasoning|thinking|-r1|magistral|deepseek-r/.test(s)
  return {
    paramsTotalB: totalB,
    paramsActiveB: activeB,
    isMoE,
    isReasoning,
    layers: layersOf(fam, totalB ?? 8, slug || name),
    kvHeads: fa.kvHeads,
    headDim: fa.headDim,
    attn: fa.attn,
    contextWindowK: catalogEntry?.ctxK ?? 128,
    license: catalogEntry?.license ?? null,
    family: fam,
    confidence: catalogEntry ? 'medium' : 'low', // KV-arch is always family-approx → never 'high'
  }
}

// ---- self-validation against the hand-authored 30 (ground truth in content.ts) ----
function validate() {
  const src = readFileSync(join(ROOT, 'src', 'sim', 'content.ts'), 'utf8')
  const region = src.slice(src.indexOf('const ROSTER'), src.indexOf('export const MODEL_DEFS'))
  const cat = loadCatalog()
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  // anchor on each entry's id+name, then slice the entry block and pull its fields
  const anchors = [...region.matchAll(/id:\s*'([^']+)',\s*name:\s*'([^']+)'/g)]
  let n = 0
  let attnOk = 0
  let hdOk = 0
  let kvOk = 0
  let kvWithin2x = 0
  let paramsOk = 0
  const bad = []
  for (let i = 0; i < anchors.length; i++) {
    const block = region.slice(anchors[i].index, i + 1 < anchors.length ? anchors[i + 1].index : region.length)
    const name = anchors[i][2]
    const g = (re) => { const m = block.match(re); return m ? m[1] : null }
    const tB = g(/paramsTotalB:\s*([\d.]+)/)
    const lay = g(/layers:\s*(\d+)/)
    const kvH = g(/kvHeads:\s*(\d+)/)
    const hd = g(/headDim:\s*(\d+)/)
    const attn = g(/attn:\s*'([^']+)'/)
    const dev = g(/real:\s*R\('([^']+)'/)
    if (!attn || !dev || !lay) continue
    const r = resolveArch({ developer: dev, name, slug: name }, cat[norm(name)])
    n++
    if (r.attn === attn) attnOk++
    if (r.headDim === +hd) hdOk++
    if (r.kvHeads === +kvH) kvOk++
    if (Math.abs((r.paramsTotalB ?? 0) - +tB) <= +tB * 0.1 + 0.5) paramsOk++
    const real = +lay * +kvH * +hd
    const res = r.layers * r.kvHeads * r.headDim
    const ratio = res / real
    if (ratio >= 0.5 && ratio <= 2) kvWithin2x++
    else bad.push(`${name}: KV ${ratio.toFixed(2)}× (real ${real} vs ${res})`)
  }
  console.log(`\n=== resolveArch validation vs ${n} hand-authored roster models ===`)
  console.log(`  params total (±10%): ${paramsOk}/${n}`)
  console.log(`  attn:    ${attnOk}/${n}`)
  console.log(`  headDim: ${hdOk}/${n}`)
  console.log(`  kvHeads: ${kvOk}/${n}`)
  console.log(`  KV-product within 2×: ${kvWithin2x}/${n}`)
  if (bad.length) console.log(`  KV >2× off (confidence:low layers):\n    ${bad.join('\n    ')}`)
}

if (process.argv[2] === 'validate') validate()
