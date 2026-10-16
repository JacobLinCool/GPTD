// Architecture resolver — the FALLBACK for a checkpoint whose config.json cannot be read.
//
// The roster's architecture comes from Hugging Face config.json files (scripts/arch-sync.mjs →
// data/model-arch.json). This resolver guesses the same fields from the model's name and the
// fact-checked prose in docs/MODEL-CATALOG.md, for drafting a data/model-arch.json entry when a
// config is gated or missing — and it supplies `familyOf`, the family key gen-roster uses for the
// default alignment profile. Sources, best → worst confidence:
//
//   1. CATALOG (docs/MODEL-CATALOG.md) — fact-checked params / context / license / layer counts.
//   2. NAME-PARSE — total/active params from the AA name ("LFM2.5-1.2B", "235B-A22B"); MoE and
//      thinking flags from the name (Reasoning / Thinking / Thinker / R1 / effort tags).
//   3. FAMILY DEFAULTS — the attention design (attn / headDim / kvHeads) of the family; a guessed
//      layer count is always confidence 'low'.
//
//   node scripts/resolve-arch.mjs guess "<AA name>" "<developer>"   draft fields for one model
//   node scripts/resolve-arch.mjs validate                          resolver vs data/model-arch.json

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Family attention defaults {attn, headDim, kvHeads} — the full-attention layers of each family.
export const FAMILY_ARCH = {
  llama: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'qwen-dense': { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'qwen-moe': { attn: 'GQA', headDim: 128, kvHeads: 4 },
  'qwen-next': { attn: 'hybrid-linear', headDim: 256, kvHeads: 2 }, // Qwen3-Next / 3.5 / 3.6 / 3.8: Gated DeltaNet 3:1
  gemma: { attn: 'hybrid-swa', headDim: 256, kvHeads: 8 },
  mistral: { attn: 'GQA', headDim: 128, kvHeads: 8 },
  phi: { attn: 'GQA', headDim: 128, kvHeads: 10 },
  gptoss: { attn: 'hybrid-swa', headDim: 64, kvHeads: 8 },
  'glm-air': { attn: 'GQA', headDim: 128, kvHeads: 8 },
  'glm-mla': { attn: 'MLA', headDim: 576, kvHeads: 1 }, // latent 512 + rope 64
  deepseek: { attn: 'MLA', headDim: 576, kvHeads: 1 }, // DeepSeek's own V2/V3/R1 architectures only
  kimi: { attn: 'MLA', headDim: 576, kvHeads: 1 },
  minimax: { attn: 'GQA', headDim: 128, kvHeads: 8 }, // MiniMax-M2.x is full GQA; M3 GQA + sparse attention
  nemotron: { attn: 'hybrid-linear', headDim: 128, kvHeads: 2 }, // Nemotron-H: Mamba-2 + a few attention layers
  default: { attn: 'GQA', headDim: 128, kvHeads: 8 },
}

/**
 * Detect the model family from creator + name/slug. A DeepSeek DISTILL on another lab's base
 * (R1-Distill-Llama, R1-0528-Qwen3-8B) carries its base's architecture, not DeepSeek's MLA.
 */
export function familyOf(developer, nameOrSlug) {
  const d = (developer || '').toLowerCase()
  const s = (nameOrSlug || '').toLowerCase()
  const distillOnto = /deepseek/.test(s) && /distill|qwen|llama/.test(s)
  if (distillOnto) return /llama/.test(s) ? 'llama' : /a\d+(\.\d+)?b/.test(s) ? 'qwen-moe' : 'qwen-dense'
  if (d.includes('deepseek') || s.includes('deepseek')) return 'deepseek'
  if (d.includes('moonshot') || d === 'kimi' || s.includes('kimi')) return 'kimi'
  if (d.includes('minimax') || s.includes('minimax')) return 'minimax'
  if (d.includes('nvidia') || s.includes('nemotron')) return /llama/.test(s) ? 'llama' : 'nemotron'
  if (s.includes('gpt-oss')) return 'gptoss'
  if (s.includes('glm') || d.includes('zhipu') || d.includes('z.ai') || d === 'z ai') {
    if (s.includes('air')) return 'glm-air'
    if (/glm[ -]?(5|6|4\.6)/.test(s)) return 'glm-mla' // GLM-4.6+/5.x use MLA
    return 'glm-air'
  }
  if (s.includes('gemma') || d.includes('google')) return 'gemma'
  if (s.includes('phi') || d.includes('microsoft')) return 'phi'
  if (d.includes('mistral') || /mistral|devstral|magistral|ministral/.test(s)) return 'mistral'
  if (s.includes('llama') || d.includes('meta')) return 'llama'
  if (s.includes('qwen') || d.includes('alibaba')) {
    if (/next|qwen3[.-]?[5-9]/.test(s)) return 'qwen-next'
    if (/a\d+(\.\d+)?b/.test(s)) return 'qwen-moe'
    return 'qwen-dense'
  }
  return 'default'
}

/**
 * The alignment-profile family: alignment is a POST-TRAINING property, so it follows the lab that
 * post-trained the checkpoint (a DeepSeek distill on Qwen3 keeps DeepSeek's profile; NVIDIA's
 * Llama-Nemotrons keep NVIDIA's), even where the architecture follows the base (familyOf).
 */
export function alignmentFamilyOf(developer, nameOrSlug) {
  const d = (developer || '').toLowerCase()
  if (d.includes('deepseek')) return 'deepseek'
  if (d.includes('nvidia')) return 'nemotron'
  return familyOf(developer, nameOrSlug)
}

/** Parse total/active params (B) from a model name, or a slug whose decimal point became a dash. */
export function parseParams(nameOrSlug) {
  const s = nameOrSlug.toLowerCase().replace(/(\d)-(\d+)b\b/g, '$1.$2b') // slug "lfm2-5-1-2b" → "…1.2b"
  const actM = s.match(/a(\d+(?:\.\d+)?)\s*b\b/) // "…-a22b" / "a3b"
  const totM = s.replace(/a\d+(?:\.\d+)?\s*b\b/, '').match(/(\d+(?:\.\d+)?)\s*([bt])\b/)
  const total = totM ? parseFloat(totM[1]) * (totM[2] === 't' ? 1000 : 1) : null
  return { totalB: total, activeB: actM ? parseFloat(actM[1]) : null }
}

/** A thinking variant by name: "(Reasoning)", Thinking, Thinker, R1, or a reasoning-effort tag. */
export function thinkingByName(name) {
  const s = (name || '').toLowerCase()
  if (s.includes('non-reasoning')) return false
  return /reasoning|thinking|thinker|\br1\b|\((?:low|medium|high|xhigh|max)\b|magistral/.test(s)
}

/** Parse params/context/license/layers from MODEL-CATALOG.md entries (the fact-checked source). */
export function loadCatalog() {
  const md = readFileSync(join(ROOT, 'docs', 'MODEL-CATALOG.md'), 'utf8').split('\n')
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out = {}
  let name = null
  let cur = null
  for (const line of md) {
    const h = line.match(/^### (.+?)\s*★?\s*$/)
    if (h) { name = h[1].trim(); cur = null; continue }
    if (!name) continue
    if (!cur && line.startsWith('**')) {
      // e.g. "**Meta** · 2024-09 · License · 120B/12B Latent-MoE · 256K ctx · spec: x · lineage: y · confidence: z"
      const tot = line.match(/(\d+(?:\.\d+)?)\s*([bBtT])\b/)
      const act = line.match(/\/\s*(\d+(?:\.\d+)?)\s*[bB]\b/) || line.match(/[aA](\d+(?:\.\d+)?)\s*[bB]\b/)
      const ctx = line.match(/(\d+(?:\.\d+)?)\s*([kKmM])\s*ctx/)
      const lic = line.match(/\*\*[^*]+\*\*\s*·\s*[^·]+·\s*([^·]+?)\s*·/)
      cur = out[norm(name)] = {
        totalB: tot ? parseFloat(tot[1]) * (/t/i.test(tot[2]) ? 1000 : 1) : null,
        activeB: act ? parseFloat(act[1]) : null,
        ctxK: ctx ? parseFloat(ctx[1]) * (/m/i.test(ctx[2]) ? 1000 : 1) : null,
        license: lic ? lic[1].trim() : null,
        layers: null,
        attnLayers: null,
      }
      continue
    }
    if (cur && line && !line.startsWith('Benchmarks') && !line.startsWith('[')) {
      // the description prose: "(GQA, 28 layers)", "62 layers", "just four Attention layers"
      const words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
      const al = line.match(/(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+attention layers/i)
      const ly = line.match(/\b(\d{2,3})\s+layers\b/)
      if (al) cur.attnLayers = words[al[1].toLowerCase()] ?? parseInt(al[1], 10)
      if (ly) cur.layers = parseInt(ly[1], 10)
    }
  }
  return out
}

/**
 * Guess the architecture for a model (fallback only). `catalogEntry` (from loadCatalog) wins for
 * params / context / license / layers when present. Unknown fields stay null — never defaulted.
 */
export function resolveArch({ developer, name, slug }, catalogEntry) {
  const fam = familyOf(developer, name || slug)
  const fa = FAMILY_ARCH[fam]
  const np = parseParams(name || slug)
  const totalB = catalogEntry?.totalB ?? np.totalB ?? null
  const activeB = catalogEntry?.activeB ?? np.activeB ?? totalB // dense → active = total
  return {
    paramsTotalB: totalB,
    paramsActiveB: activeB,
    isMoE: activeB != null && totalB != null && activeB < totalB - 0.01,
    isReasoning: thinkingByName(name) || thinkingByName(slug),
    layers: catalogEntry?.layers ?? null,
    kvLayers: catalogEntry?.attnLayers ?? null,
    kvHeads: fa.kvHeads,
    headDim: fa.headDim,
    attn: fa.attn,
    contextWindowK: catalogEntry?.ctxK ?? null,
    license: catalogEntry?.license ?? null,
    family: fam,
    confidence: catalogEntry ? 'medium' : 'low', // never 'high': the KV layout is a family analogy
  }
}

// ---- validation against the config-derived ground truth (data/model-arch.json) ----
async function validate() {
  const { loadArch, derive } = await import('./arch-sync.mjs')
  const { loadSnapshots, recordOf, THINKING_PATH } = await import('./aa-cells.mjs')
  const arch = loadArch().models
  const thinkingModes = JSON.parse(readFileSync(THINKING_PATH, 'utf8')).models
  const snaps = loadSnapshots()
  const cat = loadCatalog()
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  let n = 0
  let attnOk = 0
  let paramsOk = 0
  let thinkOk = 0
  const bad = []
  for (const [repo, e] of Object.entries(arch)) {
    const aaId = Object.values(e.aa ?? {})[0]
    const rec = recordOf(snaps, aaId)
    if (!rec) continue
    // the thinking truth the game uses: the chat template's support (data/model-thinking.json)
    const thinks = thinkingModes[repo]?.mode !== 'never'
    const truth = derive(e)
    const r = resolveArch({ developer: rec.model_creator?.name, name: rec.name, slug: rec.slug }, cat[norm(rec.name.split('(')[0])])
    n++
    if (r.attn === truth.attn) attnOk++
    else bad.push(`${repo}: attn ${r.attn} (truth ${truth.attn})`)
    if (r.paramsTotalB != null && Math.abs(r.paramsTotalB - truth.paramsTotalB) <= truth.paramsTotalB * 0.1 + 0.5) paramsOk++
    if (r.isReasoning === thinks) thinkOk++
  }
  console.log(`\n=== resolveArch fallback vs ${n} config-derived checkpoints (data/model-arch.json) ===`)
  console.log(`  params total (±10%): ${paramsOk}/${n}`)
  console.log(`  attention design:    ${attnOk}/${n}`)
  console.log(`  thinking flag:       ${thinkOk}/${n}`)
  if (bad.length) console.log(`  family attention guesses that miss (a config read is required):\n    ${bad.join('\n    ')}`)
}

function guess(name, developer) {
  const cat = loadCatalog()
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  console.log(JSON.stringify(resolveArch({ developer, name, slug: name }, cat[norm(name.split('(')[0])]), null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'validate') await validate()
  else if (cmd === 'guess' && args[0]) guess(args[0], args[1] ?? '')
  else { console.error('usage: node scripts/resolve-arch.mjs <validate | guess "<name>" "<developer>">'); process.exit(1) }
}
