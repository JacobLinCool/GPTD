/**
 * Game-knowledge context for the in-Codex chat assistant (browsers.ts → Chat tab).
 *
 * Assembles a compact, factual knowledge base from the SAME live data the Codex
 * encyclopedia renders — the loop, request types, the model roster, the hardware
 * ladder, and the research tree — so the assistant answers about THIS game with
 * the real numbers rather than a generic LLM prior. Pure read; imports sim data
 * (reading content is fine — this is a UI/meta-layer module, not under sim/**).
 */
import { CODEX_TECH } from '../ui/browsers'
import { eraTokenRange } from '../sim/campaign'
import { getLang } from '../i18n'
import {
  BUILD_ORDER,
  HARDWARE_DEFS,
  HARDWARE_TIERS,
  MODEL_LIST,
  REQUEST_LIST,
  RESEARCH_LIST,
  sizeLabel,
  TOWER_DEFS,
} from '../sim/content'

const r0 = (v: number): number => Math.round(v)
const fmtTok = (v: number): string => (v >= 1000 ? (v / 1000).toFixed(v < 9500 ? 1 : 0) + 'K' : String(v))

const OVERVIEW = `# GigaPrompt Tower Defense (GPTD)

GPTD is a tower-defense game built on real-world simulation — every number is
grounded in real data. Waves of AI user requests stream from four ingress lanes
toward a central Trust Core. The player builds a serving platform — GPU racks,
models, caches, routers, guardrails, power and cooling — to answer each request
correctly, safely, and within its latency SLO before it reaches the core. A
request that times out or is answered unsafely at the core hurts SLA and Trust.

The board is the metaphor; the numbers are real. The roster is real open-weight
models, each model's capability vector is calibrated from public Artificial
Analysis benchmark scores, and the serving math — rooflines, KV cache, power and
cooling in real kW, token-priced revenue — is grounded in real hardware and pricing.

## Meters
- Trust — reputation. Unsafe answers and timeouts drain it. Hits zero → game over.
- SLA — service level. Late / wrong serves erode it.
- Cash — token revenue funds racks; idle / over-provisioned racks still bleed the operating bill.
- Power (kW) — racks draw real power; over capacity browns out GPUs. Build Power Plants.
- Cooling (kW) — racks emit heat; over capacity thermal-throttles them. Build Cooling Towers.
- Data — research currency earned per served request; spent in the research tree.

## Serving model (how a request is answered)
- Prefill (prompt processing) is compute-bound; decode (token generation) is bandwidth-bound.
- KV cache holds attention state; it is gated by GPU HBM and the model's context window.
- Latency SLO classes: IN interactive (tight TTFT/TPOT), NR near-real-time (relaxed), TO throughput/offline (no hard latency SLO).
- Two-layer safety: a high-safety model can self-handle a hazard (layer 1, no latency); otherwise an in-path guardrail must catch it (layer 2) or an unsafe answer reaches the core.`

function buildingsSection(): string {
  const lines: string[] = ['## Buildings (towers you can place)']
  for (const id of BUILD_ORDER) {
    const d = TOWER_DEFS[id]
    if (!d) continue
    lines.push(`- ${d.name}: ${d.desc}`)
  }
  return lines.join('\n')
}

function requestsSection(): string {
  const lines: string[] = [
    '## Request types (the enemies)',
    'Base tokens shown; later waves scale prompt + output length with the era (end-of-campaign range in parens).',
  ]
  for (const d of REQUEST_LIST) {
    const late = eraTokenRange(d)
    lines.push(
      `- ${d.name} [${d.latClass}, axis ${d.primaryAxis}]: ${d.inputTokens}→${d.outputTokens} tok ` +
        `(late ~${fmtTok(late.input)}→${fmtTok(late.output)}) · $${d.pricePerMtokOut}/Mtok out` +
        `${d.toolUse ? ' · tool use' : ''}${d.cacheable ? ' · cacheable' : ''}. ${d.desc}`,
    )
  }
  return lines.join('\n')
}

function modelsSection(): string {
  const lines: string[] = ['## Model roster (real open-weight checkpoints)']
  for (const m of MODEL_LIST) {
    const size = m.isMoE ? `${sizeLabel(m.paramsTotalB)} total / ${sizeLabel(m.paramsActiveB)} active (MoE)` : sizeLabel(m.paramsTotalB)
    const flags = m.isReasoning ? ' · reasoning' : ''
    const real = m.real
    const prov = real ? `${real.developer}, ${real.released}, ${real.license}, ctx ${m.contextWindowK}k` : ''
    const q = m.qualityBy
    lines.push(
      `- ${m.name} — ${size}${flags} · ${prov} · Q${r0(m.quality)} ` +
        `(chat ${r0(q.chat)}, coding ${r0(q.coding)}, reasoning ${r0(q.reasoning)}, general ${r0(q.general)}, agentic ${r0(q.agentic)})`,
    )
  }
  return lines.join('\n')
}

function hardwareSection(): string {
  const lines: string[] = ['## Hardware ladder (GPU racks)']
  for (const id of HARDWARE_TIERS) {
    const h = HARDWARE_DEFS[id]
    if (!h) continue
    lines.push(
      `- ${h.name} — ${h.gpuModel} ×${h.gpus} · ${r0(h.hbmGb)} GB HBM · ${h.hbmTbs.toFixed(1)} TB/s · ` +
        `bf16 ${r0(h.bf16Tflops)} TF · ${(h.tdpWatts / 1000).toFixed(1)} kW · $${r0(h.capexUsd).toLocaleString()} capex · $${h.gpuHrUsd.toFixed(2)}/GPU-hr`,
    )
  }
  return lines.join('\n')
}

function researchSection(): string {
  const lines: string[] = ['## Research tree (spend Data to unlock)']
  for (const d of RESEARCH_LIST) {
    const explain = CODEX_TECH[d.id] ?? d.desc ?? ''
    lines.push(`- ${d.name} [${d.kind}, ${d.dataCost} data]${explain ? ': ' + explain : ''}`)
  }
  return lines.join('\n')
}

/** Build the full system-context knowledge base (assembled fresh from live data). */
export function buildGameContext(): string {
  return [
    OVERVIEW,
    buildingsSection(),
    requestsSection(),
    modelsSection(),
    hardwareSection(),
    researchSection(),
  ].join('\n\n')
}

/** The chat system prompt: persona + the knowledge base + reply-language hint. */
export function buildSystemPrompt(): string {
  const lang = getLang() === 'zh-TW' ? 'Traditional Chinese (Taiwan, 正體中文)' : 'English'
  return (
    `You are the in-game guide for GigaPrompt Tower Defense (GPTD), a tower-defense ` +
    `game built on a real data-center LLM-inference simulation. Help the player understand the game: the loop, ` +
    `meters, request types, the model roster, the hardware ladder, the research tree, ` +
    `and strategy (what to build, which model to deploy, how to survive deeper waves).\n\n` +
    `Ground every answer in the KNOWLEDGE below — these are the game's real numbers. ` +
    `If the player asks about something not covered, say so briefly rather than inventing it. ` +
    `Keep replies SHORT and conversational — talk like a helpful friend, not a manual. ` +
    `Aim for a sentence or two, or a few quick bullets at most; answer exactly what was asked and stop. ` +
    `Don't dump everything you know or over-explain — expand only if the player asks for more. ` +
    `Reply in the SAME language the player writes in; if that's unclear, default to ${lang}.\n\n` +
    `=== KNOWLEDGE ===\n${buildGameContext()}`
  )
}
