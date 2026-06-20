import { COLORS, CREDIT_USD } from '../config'
import type {
  AlignmentProfile,
  ServerSpec,
  IncidentDef,
  InfraNodeDef,
  MethodRecipe,
  ModelDef,
  PostTrainMethod,
  RequestTypeDef,
  ResearchDef,
  ServerHardwareDef,
  TowerDef,
  UpgradeDef,
  WaveDef,
} from '../core/types'
import { calibrateRecipes, qualityFromBenchmarks, type BenchInputs } from './calibrate'
import { buildCampaign, CAMPAIGN_THEMES, themedIncidentId } from './campaign'

/* ------------------------------------------------------------------ *
 *  REQUEST TAXONOMY — the enemies, redesigned (P3a) by ROOT PROPERTY.  *
 *  The old thematic types ("Enterprise", "Bot Swarm") are gone: their  *
 *  defining traits were never request *kinds*, they were PROPERTIES    *
 *  (price, latClass, volume). The 9 archetypes below span the real     *
 *  workload-physics space (§1.4/§2):                                   *
 *    pure-prefill (embed) · balanced (chat) · prefill-heavy            *
 *    interactive (comp) · prefill-heavy long-context (rag, summ) ·     *
 *    extreme-decode (reason) · agentic loop (agent) · decode-heavy     *
 *    no-SLO (batch) · adversarial hazard carrier (jailbreak).          *
 *                                                                      *
 *  Each carries a per-axis `difficulty` vector (§6.4/R8) judged against *
 *  the model's `qualityBy[primaryAxis]`; the old scalar `complexity`   *
 *  retired ([fix M2]). Legacy `work`/`context`/`reward` survive only   *
 *  for the contextGap term and endless-scaling math.                   *
 * ------------------------------------------------------------------ */

export const REQUEST_TYPES: Record<string, RequestTypeDef> = {
  embed: {
    id: 'embed',
    name: 'Embedding',
    glyph: '⋯',
    color: 0x8595ad,
    work: 1,
    inputTokens: 2000,
    outputTokens: 0,
    latClass: 'TO',
    speed: 1.7,
    primaryAxis: 'general',
    difficulty: { general: 10 },
    context: 18,
    prefixShare: 0.3,
    safetyRisk: 0,
    reward: 1,
    pricePerMtokIn: 0.05,
    pricePerMtokOut: 0.1,
    trustPenalty: 1,
    slaPenalty: 1,
    data: 0,
    cacheable: true,
    desc: 'Pure prefill, no generation — served the instant the prompt is ingested. Worthless alone, a flood in volume.',
  },
  chat: {
    id: 'chat',
    name: 'Interactive Chat',
    glyph: '?',
    color: 0x6fe0ff,
    work: 42,
    inputTokens: 512,
    outputTokens: 256,
    latClass: 'IN',
    speed: 1.45,
    primaryAxis: 'chat',
    difficulty: { chat: 18 },
    context: 8,
    prefixShare: 0.4,
    safetyRisk: 0,
    reward: 6,
    pricePerMtokIn: 0.3,
    pricePerMtokOut: 0.9,
    trustPenalty: 2,
    slaPenalty: 3,
    data: 1,
    cacheable: true,
    desc: 'Balanced, high-volume interactive traffic. A small model on a fast rack soaks these all day.',
  },
  comp: {
    id: 'comp',
    name: 'Code Completion',
    glyph: '{}',
    color: 0x7ee787,
    work: 28,
    inputTokens: 1500,
    outputTokens: 150,
    latClass: 'IN',
    ttftSloMs: 200,
    speed: 1.4,
    primaryAxis: 'coding',
    difficulty: { coding: 56 },
    context: 26,
    prefixShare: 0.5,
    safetyRisk: 0,
    reward: 9,
    pricePerMtokIn: 1,
    pricePerMtokOut: 3,
    trustPenalty: 4,
    slaPenalty: 4,
    data: 2,
    cacheable: true,
    desc: 'Prefill-heavy, latency-critical inline suggestions (TTFT 200 ms). A weak model ships bad code and bleeds Trust.',
  },
  rag: {
    id: 'rag',
    name: 'RAG / Long-Context QA',
    glyph: '≡',
    color: 0x4fd6c4,
    work: 90,
    inputTokens: 8000,
    outputTokens: 512,
    latClass: 'NR',
    speed: 0.95,
    primaryAxis: 'general',
    difficulty: { general: 50, reasoning: 44 },
    context: 64,
    prefixShare: 0.6,
    safetyRisk: 0,
    reward: 14,
    pricePerMtokIn: 1,
    pricePerMtokOut: 2,
    trustPenalty: 4,
    slaPenalty: 6,
    data: 3,
    cacheable: true,
    desc: 'Huge retrieved prompt. A Cache / KV Cache makes the prefill survivable; a small window rejects it outright.',
  },
  summ: {
    id: 'summ',
    name: 'Summarization',
    glyph: '¶',
    color: 0x4fb6d6,
    work: 70,
    inputTokens: 12000,
    outputTokens: 400,
    latClass: 'NR',
    speed: 0.9,
    primaryAxis: 'general',
    difficulty: { general: 44 },
    context: 76,
    prefixShare: 0.2,
    safetyRisk: 0,
    reward: 13,
    pricePerMtokIn: 1,
    pricePerMtokOut: 2,
    trustPenalty: 3,
    slaPenalty: 5,
    data: 3,
    cacheable: false,
    desc: 'Extreme prompt, modest output, little reusable prefix — a relentless prefill bill that strains the context window.',
  },
  reason: {
    id: 'reason',
    name: 'Reasoning (long CoT)',
    glyph: 'Σ',
    color: 0xc792ea,
    work: 200,
    inputTokens: 512,
    outputTokens: 6000,
    latClass: 'NR',
    speed: 0.82,
    primaryAxis: 'reasoning',
    difficulty: { reasoning: 82 },
    context: 48,
    prefixShare: 0.1,
    safetyRisk: 0,
    reward: 30,
    pricePerMtokIn: 1,
    pricePerMtokOut: 5,
    trustPenalty: 6,
    slaPenalty: 5,
    data: 3,
    cacheable: false,
    desc: 'Extreme decode (long chain-of-thought). Only a thinking model clears the hardest reasoning lane.',
  },
  agent: {
    id: 'agent',
    name: 'Agentic Task',
    glyph: '⌖',
    color: 0xb084f5,
    work: 120,
    inputTokens: 6000,
    outputTokens: 800,
    latClass: 'NR',
    e2elSloMs: 9000,
    speed: 0.76,
    primaryAxis: 'agentic',
    difficulty: { agentic: 82, reasoning: 66 },
    context: 70,
    prefixShare: 0.7,
    toolUse: true,
    // §3.4 agents are prompt-INJECTION targets: a malicious tool/document can hijack
    // the loop. A moderate injection hazard — the hardest category to self-handle.
    hazards: { injection: 0.3 },
    safetyRisk: 0.3,
    reward: 46,
    pricePerMtokIn: 3,
    pricePerMtokOut: 12,
    trustPenalty: 7,
    slaPenalty: 11,
    data: 4,
    cacheable: true,
    desc: 'Autonomous multi-step tool use (SWE-bench-grade). Benchmarks have not saturated — only a true frontier model, or one you trained yourself, closes the loop.',
  },
  batch: {
    id: 'batch',
    name: 'Batch / Offline Gen',
    glyph: '▤',
    color: 0x8aa0c0,
    work: 140,
    inputTokens: 1000,
    outputTokens: 4000,
    latClass: 'TO',
    speed: 1.0,
    primaryAxis: 'general',
    difficulty: { general: 40 },
    context: 22,
    prefixShare: 0.1,
    safetyRisk: 0,
    reward: 10,
    pricePerMtokIn: 0.5,
    pricePerMtokOut: 1.5,
    trustPenalty: 1,
    slaPenalty: 2,
    data: 4,
    cacheable: false,
    desc: 'Decode-heavy offline generation with no latency SLO — pure throughput and $/token. Soak it whenever racks are free.',
  },
  jailbreak: {
    id: 'jailbreak',
    name: 'Adversarial Prompt',
    glyph: '!',
    color: 0xff5d5d,
    work: 40,
    inputTokens: 600,
    outputTokens: 400,
    latClass: 'IN',
    speed: 1.18,
    primaryAxis: 'general',
    difficulty: { general: 38 },
    context: 22,
    prefixShare: 0.1,
    // §3.4 the adversarial hazard carrier: a severe jailbreak attempt. A high-safety
    // model may self-handle it (layer 1); otherwise a guardrail must catch it (layer 2),
    // or an unsafe answer reaches the core and wrecks Trust.
    hazards: { jailbreak: 0.9 },
    safetyRisk: 0.9,
    reward: 7,
    pricePerMtokIn: 0.5,
    pricePerMtokOut: 1.5,
    trustPenalty: 12,
    slaPenalty: 3,
    data: 1,
    cacheable: false,
    desc: 'The hazard carrier: a jailbreak the model must self-handle or a guardrail must catch, or an unsafe answer wrecks Trust.',
  },
}

export const REQUEST_LIST = Object.values(REQUEST_TYPES)

/* ------------------------------------------------------------------ *
 *  HARDWARE & MODELS — you build racks; you deploy models onto them.  *
 *  Hardware tiers are neutral: what a rack is good at comes from the  *
 *  model loaded on it. Racks upgrade in place along HARDWARE_TIERS.   *
 * ------------------------------------------------------------------ */

/**
 * Real accelerator ladder (§5.2–5.5). Each entry carries PER-GPU specs and a
 * `gpus` count; aggregate fields (bf16Tflops / fp8Tflops / hbmGb / hbmTbs /
 * tdpWatts) are filled at load = perGpu × gpus. The abstract power-system
 * fields (powerDraw / heat / cost / range / color / accent / desc) are kept
 * unchanged for the existing power system this phase.
 */
type HwSpec = Omit<
  ServerHardwareDef,
  'bf16Tflops' | 'fp8Tflops' | 'hbmGb' | 'hbmTbs' | 'tdpWatts' | 'gpuHrUsd' | 'cost'
>

/**
 * Build cost in credits, derived from REAL capex (§6.6): cost = capexUsd /
 * CREDIT_USD, rounded sensibly. An Edge L4 node is ~5 credits; an NVL72 is ~3000.
 * Single-GPU tiers use DEPLOYED-NODE capex (GPU + chassis/CPU/NIC, ~1.6–2× the
 * bare card), not the bare-die price — that is the real cost to rack one, and it
 * stops the low tiers from being near-free. Cluster tiers are already node-level.
 */
const costFromCapex = (capexUsd: number): number => Math.max(1, Math.round(capexUsd / CREDIT_USD))

const HW_SPECS: Record<string, HwSpec> = {
  hw_edge: {
    id: 'hw_edge', name: 'Edge GPU Rack', gpuModel: 'L4-class', gpus: 1,
    bf16TflopsPerGpu: 121, fp8TflopsPerGpu: 242, hbmGbPerGpu: 24, hbmTbsPerGpu: 0.3,
    tdpWattsPerGpu: 72, cooling: 'air', capexUsd: 5000, gpuHrUsdPerGpu: 0.4,
    targets: 2, powerDraw: 2, heat: 2, range: 2.8, color: 0x6fe0ff, accent: 0xbff4ff,
    desc: 'A single L4-class accelerator. Cheap and cool, but 24 GB and modest bandwidth cap model size.',
  },
  hw_standard: {
    id: 'hw_standard', name: 'Standard GPU Rack', gpuModel: 'L40S-class', gpus: 1,
    bf16TflopsPerGpu: 362, fp8TflopsPerGpu: 733, hbmGbPerGpu: 48, hbmTbsPerGpu: 0.864,
    tdpWattsPerGpu: 350, cooling: 'air', capexUsd: 16000, gpuHrUsdPerGpu: 1.0,
    targets: 2, powerDraw: 3, heat: 3, range: 3.0, color: 0x5b8cff, accent: 0xc3d4ff,
    desc: 'An L40S-class card: 48 GB and solid compute for a mid-size model with moderate batching.',
  },
  hw_perf: {
    id: 'hw_perf', name: 'Performance GPU Rack', gpuModel: 'H100-class', gpus: 1,
    bf16TflopsPerGpu: 989, fp8TflopsPerGpu: 1979, hbmGbPerGpu: 80, hbmTbsPerGpu: 3.35,
    tdpWattsPerGpu: 700, cooling: 'air', capexUsd: 48000, gpuHrUsdPerGpu: 3.0,
    targets: 2, powerDraw: 4, heat: 4, range: 3.0, color: 0x7ee787, accent: 0xd2ffce,
    desc: 'A single H100-class GPU: 80 GB HBM3 and ~3.35 TB/s — the bandwidth that makes decode fly.',
  },
  hw_frontier: {
    id: 'hw_frontier', name: 'Frontier GPU Rack', gpuModel: 'H200-class', gpus: 1,
    bf16TflopsPerGpu: 989, fp8TflopsPerGpu: 1979, hbmGbPerGpu: 141, hbmTbsPerGpu: 4.8,
    tdpWattsPerGpu: 700, cooling: 'air', capexUsd: 60000, gpuHrUsdPerGpu: 3.2,
    targets: 2, powerDraw: 6, heat: 6, range: 3.3, color: 0xc792ea, accent: 0xf0d9ff,
    desc: 'An H200-class GPU: same compute as H100 but 141 GB and 4.8 TB/s — fits a 70B unquantized.',
  },
  // --- giant-model clusters (upgrade-only): the only homes for 100B+ checkpoints ---
  hw_pod: {
    id: 'hw_pod', name: 'DGX H200', gpuModel: 'DGX H200 (8× H200)', gpus: 8,
    bf16TflopsPerGpu: 989, fp8TflopsPerGpu: 1979, hbmGbPerGpu: 141, hbmTbsPerGpu: 4.8,
    tdpWattsPerGpu: 700, cooling: 'liquid', capexUsd: 320000, gpuHrUsdPerGpu: 3.2,
    targets: 2, powerDraw: 10, heat: 10, range: 3.4, color: 0xffb86c, accent: 0xffe0b8,
    desc: 'Eight H200s as one node: 1.1 TB of pooled HBM and 38 TB/s aggregate. Fits a 200B-class model.',
  },
  hw_superpod: {
    id: 'hw_superpod', name: 'DGX B200', gpuModel: 'DGX B200 (8× B200)', gpus: 8,
    bf16TflopsPerGpu: 2250, fp8TflopsPerGpu: 4500, hbmGbPerGpu: 192, hbmTbsPerGpu: 8.0,
    tdpWattsPerGpu: 1000, cooling: 'liquid', capexUsd: 500000, gpuHrUsdPerGpu: 5.0,
    targets: 3, powerDraw: 16, heat: 16, range: 3.5, color: 0xff7ab6, accent: 0xffc4de,
    desc: 'Eight Blackwell B200s: 1.5 TB HBM and 64 TB/s. 700B-class checkpoints live here.',
  },
  hw_giga: {
    id: 'hw_giga', name: 'GB200 NVL72', gpuModel: 'GB200 NVL72 (72× B200)', gpus: 72,
    bf16TflopsPerGpu: 2250, fp8TflopsPerGpu: 4500, hbmGbPerGpu: 192, hbmTbsPerGpu: 8.0,
    tdpWattsPerGpu: 1000, cooling: 'liquid', capexUsd: 3000000, gpuHrUsdPerGpu: 5.0,
    targets: 3, powerDraw: 26, heat: 26, range: 3.6, color: 0xf5e663, accent: 0xfdf6b8,
    desc: 'A 72-GPU NVL72 rack acting as one accelerator: 13.8 TB HBM, 576 TB/s. Serves a 2T model unquantized.',
  },
}

export const HARDWARE_DEFS: Record<string, ServerHardwareDef> = {}
for (const id of Object.keys(HW_SPECS)) {
  const h = HW_SPECS[id]
  HARDWARE_DEFS[id] = {
    ...h,
    cost: costFromCapex(h.capexUsd),
    bf16Tflops: h.bf16TflopsPerGpu * h.gpus,
    fp8Tflops: h.fp8TflopsPerGpu * h.gpus,
    hbmGb: h.hbmGbPerGpu * h.gpus,
    hbmTbs: h.hbmTbsPerGpu * h.gpus,
    tdpWatts: h.tdpWattsPerGpu * h.gpus,
    gpuHrUsd: h.gpuHrUsdPerGpu * h.gpus,
  }
}

/** In-place upgrade path: a rack climbs one tier at a time, paying the cost difference. */
export const HARDWARE_TIERS = ['hw_edge', 'hw_standard', 'hw_perf', 'hw_frontier', 'hw_pod', 'hw_superpod', 'hw_giga']

/* ------------------------------------------------------------------ *
 *  MODELS — real open-weight checkpoints. Open weights are a free      *
 *  DOWNLOAD, so deploying one costs nothing. What gates a model is     *
 *  rack VRAM (it must fit `paramsTotalB`) and METHOD unlocks: a sparse *
 *  (MoE) model needs the MoE research, a thinking (reasoning) model    *
 *  needs the Reasoning research, before it can be deployed. qualityBy  *
 *  is calibrated from public benchmarks (Artificial Analysis / model   *
 *  cards) via calibrate.ts. Custom checkpoints you finetune/pretrain   *
 *  in the Model Lab are added the same way.                            *
 * ------------------------------------------------------------------ */

/** Format a billions-of-params count: 8 → "8B", 1000 → "1T". */
export const sizeLabel = (p: number): string =>
  p >= 1000 ? `${Number((p / 1000).toFixed(p % 1000 ? 1 : 0))}T` : `${p}B`

interface RosterEntry {
  id: string
  name: string
  tier: ModelDef['tier']
  variant: ModelDef['variant']
  spec: ServerSpec
  paramsTotalB: number
  paramsActiveB: number
  isMoE?: boolean
  isReasoning?: boolean
  // --- real architecture (feeds the §5.6 KV / §6.2 roofline formulas) ---
  layers: number
  kvHeads: number
  headDim: number
  attn: ModelDef['attn']
  bench: BenchInputs
  /**
   * §3.4/§OQ-G12 hand-filled intrinsic alignment + instruction-following (no
   * public safety benchmark to calibrate against). Optional: omitted → the
   * instruct-variant defaults below (safety 55 / hard-refusal / overRefusal 0.15
   * / instructFollow 85). The full per-model roster safety table is P3d.
   */
  alignment?: AlignmentProfile
  instructFollow?: number
  real: Omit<NonNullable<ModelDef['real']>, 'benchmarks'>
  desc: string
}

/** §3.4 instruct-variant alignment fallback (hand-filled, grounded; the per-model roster is below). */
const INSTRUCT_ALIGNMENT: AlignmentProfile = { safety: 55, refusalStyle: 'hard-refusal', overRefusal: 0.15 }
const INSTRUCT_INSTRUCT_FOLLOW = 85

/**
 * §3.4 the per-model first-layer alignment roster (OQ-G12, hand-filled — no public
 * safety benchmark to calibrate against). The crucial teaching contrast is the
 * gpt-oss family's SAFE-COMPLETION style (high safety, LOW over-refusal, low tax)
 * vs everyone else's HARD-REFUSAL. Base variants are barely aligned (safety is a
 * post-training property, §3.1).
 */
const AL = (safety: number, refusalStyle: AlignmentProfile['refusalStyle'], overRefusal: number): AlignmentProfile => ({
  safety,
  refusalStyle,
  overRefusal,
})
const ALIGN_LLAMA = AL(62, 'hard-refusal', 0.13) // Meta safety SFT
const ALIGN_QWEN = AL(58, 'hard-refusal', 0.12) // Qwen alignment
const ALIGN_GPTOSS = AL(84, 'safe-completion', 0.03) // §3.1 OpenAI family (the Pareto point)
const ALIGN_GEMMA = AL(70, 'hard-refusal', 0.15) // Google, conservative
const ALIGN_INSTRUCT = AL(55, 'hard-refusal', 0.1) // general instruct (phi/mistral/devstral)
const ALIGN_FRONTIER = AL(60, 'hard-refusal', 0.11) // frontier instruct (glm/deepseek/kimi)
const ALIGN_NEMOTRON = AL(64, 'hard-refusal', 0.12) // NVIDIA Llama-based

const R = (
  developer: string,
  license: string,
  openWeights: boolean,
  released: string,
  contextWindowK: number,
  confidence: 'high' | 'medium' | 'low',
  source: string,
  /** §6.5/[fix H6] real lineage edge: the roster base this model genuinely derives from. */
  baseModelId?: string,
  relation?: NonNullable<RosterEntry['real']>['relation'],
): RosterEntry['real'] => ({ developer, license, openWeights, released, contextWindowK, confidence, source, baseModelId, relation })

/**
 * The curated roster (2025–2026 open-weight models). Benchmark inputs are
 * Artificial-Analysis / model-card figures; a few coding/general cells are
 * filled with documented approximations (confidence 'medium'). Tune in playtest
 * via the calibration curves in calibrate.ts — never hand-edit qualityBy.
 */
const ROSTER: RosterEntry[] = [
  // --- SMALL (≤21B → Edge/Standard racks). The free baseline; dense ones are
  //     deployable from turn one (no method needed). ---
  {
    id: 'llama31_8b', name: 'Llama 3.1 8B Instruct', tier: 'small', variant: 'instruct', spec: 'chat',
    paramsTotalB: 8, paramsActiveB: 8, layers: 32, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 48.3, gpqaDiamond: 30.4, humanEval: 72.6 }, alignment: ALIGN_LLAMA,
    real: R('Meta', 'Llama 3.1 Community', true, '2024-Q3', 128, 'high', 'hf:meta-llama/Llama-3.1-8B-Instruct'),
    desc: 'The reliable free baseline. Soaks chat all day; ships bad code and cannot reason.',
  },
  {
    id: 'qwen3_8b', name: 'Qwen3 8B', tier: 'small', variant: 'instruct', spec: 'chat',
    paramsTotalB: 8.2, paramsActiveB: 8.2, layers: 36, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 56.7, gpqaDiamond: 44.4, liveCodeBench: 29 }, alignment: ALIGN_QWEN,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q2', 32, 'medium', 'hf:Qwen/Qwen3-8B'),
    desc: 'A stronger small generalist than Llama-8B; still no real coding or hard reasoning.',
  },
  {
    id: 'phi4_14b', name: 'Phi-4 14B', tier: 'small', variant: 'instruct', spec: 'general',
    paramsTotalB: 14, paramsActiveB: 14, layers: 40, kvHeads: 10, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 70.4, gpqaDiamond: 56.1, humanEval: 82.6 }, alignment: ALIGN_INSTRUCT, instructFollow: 80,
    real: R('Microsoft', 'MIT', true, '2024-Q4', 16, 'high', 'hf:microsoft/phi-4'),
    desc: 'A synthetic-data outlier: punches to enterprise-grade knowledge from 14B, but a tiny 16k window.',
  },
  {
    id: 'gptoss_20b', name: 'gpt-oss 20B', tier: 'small', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 20.9, paramsActiveB: 3.6, isMoE: true, isReasoning: true,
    layers: 24, kvHeads: 8, headDim: 64, attn: 'GQA',
    bench: { mmluPro: 66, gpqaDiamond: 71.5, aime: 92.1, liveCodeBench: 54 }, alignment: ALIGN_GPTOSS, instructFollow: 86,
    real: R('OpenAI', 'Apache-2.0', true, '2025-Q3', 131, 'high', 'hf:openai/gpt-oss-20b'),
    desc: 'A reasoning model in a 3.6B-active body. Needs MoE + Reasoning unlocked, then it punches far above its size.',
  },
  // --- STANDARD / PERFORMANCE (24–120B → Perf/Frontier/Pod racks) ---
  {
    id: 'gemma3_27b', name: 'Gemma 3 27B', tier: 'general', variant: 'instruct', spec: 'general',
    paramsTotalB: 27, paramsActiveB: 27, layers: 62, kvHeads: 16, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 67.5, gpqaDiamond: 42.4, liveCodeBench: 29.7 }, alignment: ALIGN_GEMMA, instructFollow: 88,
    real: R('Google', 'Gemma', true, '2025-Q1', 128, 'high', 'hf:google/gemma-3-27b-it'),
    desc: 'A dense generalist that just clears coding; not a reasoning model.',
  },
  {
    id: 'mistral_small_24b', name: 'Mistral Small 3.2 24B', tier: 'general', variant: 'instruct', spec: 'general',
    paramsTotalB: 24, paramsActiveB: 24, layers: 40, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 69.1, gpqaDiamond: 46.1, humanEval: 92.9 }, alignment: ALIGN_INSTRUCT, instructFollow: 80,
    real: R('Mistral AI', 'Apache-2.0', true, '2025-Q2', 128, 'medium', 'hf:mistralai/Mistral-Small-3.2-24B-Instruct-2506'),
    desc: 'A balanced dense workhorse: chat, light code, enterprise — but not the hardest reasoning.',
  },
  {
    id: 'devstral_24b', name: 'Devstral Small 24B', tier: 'coding', variant: 'coding', spec: 'coding',
    paramsTotalB: 24, paramsActiveB: 24, layers: 40, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { sweBench: 53.6, mmluPro: 62, gpqaDiamond: 42 }, alignment: ALIGN_INSTRUCT, instructFollow: 80,
    real: R('Mistral AI', 'Apache-2.0', true, '2025-Q3', 128, 'high', 'hf:mistralai/Devstral-Small-2507'),
    desc: 'A dedicated code model: strong on coding traffic, ordinary elsewhere.',
  },
  {
    id: 'qwen3_32b', name: 'Qwen3 32B', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 32.8, paramsActiveB: 32.8, isReasoning: true,
    layers: 64, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 78.6, gpqaDiamond: 68.9, liveCodeBench: 65.7, aime: 72.9 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q2', 128, 'high', 'hf:Qwen/Qwen3-32B'),
    desc: 'A dense thinking model: with Reasoning unlocked it clears every lane, including the hardest reasoning.',
  },
  {
    id: 'qwen3_30b_a3b', name: 'Qwen3 30B-A3B', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 30.5, paramsActiveB: 3.3, isMoE: true, isReasoning: true,
    layers: 48, kvHeads: 4, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 80.9, gpqaDiamond: 73.4, liveCodeBench: 66, aime: 85 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q3', 262, 'high', 'hf:Qwen/Qwen3-30B-A3B-Instruct-2507'),
    desc: 'Frontier-grade answers at 3.3B active — the MoE dream. Fits a mid rack, serves like a tiny model.',
  },
  {
    id: 'llama33_70b', name: 'Llama 3.3 70B Instruct', tier: 'general', variant: 'instruct', spec: 'general',
    paramsTotalB: 70, paramsActiveB: 70, layers: 80, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 68.9, gpqaDiamond: 50.5, humanEval: 88.4 }, alignment: ALIGN_LLAMA,
    real: R('Meta', 'Llama 3.3 Community', true, '2024-Q4', 128, 'high', 'hf:meta-llama/Llama-3.3-70B-Instruct'),
    desc: 'A strong dense generalist — great chat and enterprise, but it is not a coder or a reasoner.',
  },
  {
    id: 'gptoss_120b', name: 'gpt-oss 120B', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 117, paramsActiveB: 5.1, isMoE: true, isReasoning: true,
    layers: 36, kvHeads: 8, headDim: 64, attn: 'GQA',
    bench: { mmluPro: 73, gpqaDiamond: 80.1, aime: 92.5, liveCodeBench: 63 }, alignment: ALIGN_GPTOSS, instructFollow: 86,
    real: R('OpenAI', 'Apache-2.0', true, '2025-Q3', 131, 'high', 'hf:openai/gpt-oss-120b'),
    desc: 'Frontier reasoning at 5.1B active. Needs a Pod to hold 117B of weights, then serves astonishingly cheap.',
  },
  {
    id: 'glm45_air', name: 'GLM-4.5-Air', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 106, paramsActiveB: 12, isMoE: true, isReasoning: true,
    layers: 46, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 81.4, gpqaDiamond: 71.7, sweBench: 57.6 }, alignment: ALIGN_FRONTIER, instructFollow: 83,
    real: R('Z.ai (Zhipu)', 'MIT', true, '2025-Q3', 128, 'high', 'hf:zai-org/GLM-4.5-Air'),
    desc: 'A lighter frontier MoE: strong across the board at 12B active.',
  },
  // --- FRONTIER (200B+ → SuperPod/GigaCluster). Top of the quality scale. ---
  {
    id: 'qwen3_235b', name: 'Qwen3 235B-A22B Thinking', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 235, paramsActiveB: 22, isMoE: true, isReasoning: true,
    layers: 94, kvHeads: 4, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 84.4, gpqaDiamond: 81.1, liveCodeBench: 74.1, aime: 92.3, sweBench: 64 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q3', 262, 'high', 'hf:Qwen/Qwen3-235B-A22B-Thinking-2507'),
    desc: 'Open frontier reasoning at 22B active. Clears everything with margin.',
  },
  {
    id: 'deepseek_v31', name: 'DeepSeek-V3.1', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 671, paramsActiveB: 37, isMoE: true, isReasoning: true,
    layers: 61, kvHeads: 128, headDim: 128, attn: 'MLA',
    bench: { mmluPro: 84.4, gpqaDiamond: 80.1, liveCodeBench: 74.8, sweBench: 66 }, alignment: ALIGN_FRONTIER, instructFollow: 83,
    real: R('DeepSeek', 'MIT', true, '2025-Q3', 128, 'high', 'hf:deepseek-ai/DeepSeek-V3.1'),
    desc: '671B of weights, 37B active. A SuperPod-class checkpoint that answers anything.',
  },
  {
    // Nemotron-3-Super-120B-A12B: a real NVIDIA open model (Mar 2026) trained FROM
    // SCRATCH (NVIDIA's own base, NOT Llama-derived) — a 120B/12B Latent-MoE (hybrid
    // Mamba-2 + MoE + attention). Benchmarks are the official model-card figures
    // (MODEL-CATALOG.md). It is the player's GRPO-agentic base in the §1.5 [H2] lesson.
    id: 'nemotron_super', name: 'Nemotron-3-Super-120B-A12B', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 120, paramsActiveB: 12, isMoE: true, isReasoning: true,
    layers: 80, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 83.73, gpqaDiamond: 79.23, aime: 90.21, liveCodeBench: 81.19, sweBench: 60.47 }, alignment: ALIGN_NEMOTRON, instructFollow: 84,
    real: R('NVIDIA', 'NVIDIA Nemotron Open Model', true, '2026-Q1', 256, 'high', 'hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16'),
    desc: 'NVIDIA\'s from-scratch 120B/12B Latent-MoE reasoner (hybrid Mamba-2 + MoE). Frontier-grade reasoning at 12B active — fits a Pod and serves cheap; the player\'s GRPO-agentic base.',
  },
  {
    id: 'kimi_k2', name: 'Kimi K2 Thinking', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 1000, paramsActiveB: 32, isMoE: true, isReasoning: true,
    layers: 61, kvHeads: 128, headDim: 128, attn: 'MLA',
    bench: { mmluPro: 84.6, gpqaDiamond: 84.5, liveCodeBench: 83.1, sweBench: 71.3, aime: 99.1 }, alignment: ALIGN_FRONTIER, instructFollow: 83,
    real: R('Moonshot AI', 'Modified MIT', true, '2025-Q4', 256, 'high', 'hf:moonshotai/Kimi-K2-Thinking'),
    desc: 'A trillion params, 32B active. The open coding/reasoning ceiling — only a GigaCluster holds it.',
  },
  /* ------------------------------------------------------------------ *
   *  2026 CATALOG ADDITIONS (small → large). Real open-weight models    *
   *  pulled from Artificial Analysis + official model cards (see        *
   *  MODEL-CATALOG.md). Some 2026 frontier MoEs use approximate KV arch  *
   *  where the lab did not publish layer/head internals (confidence on   *
   *  the entry's `real`). qualityBy still auto-calibrates from `bench`.   *
   * ------------------------------------------------------------------ */
  {
    id: 'llama32_1b', name: 'Llama 3.2 1B Instruct', tier: 'small', variant: 'instruct', spec: 'chat',
    paramsTotalB: 1.23, paramsActiveB: 1.23, layers: 16, kvHeads: 8, headDim: 64, attn: 'GQA',
    bench: { gpqaDiamond: 27.2 }, alignment: ALIGN_LLAMA,
    real: R('Meta', 'Llama 3.2 Community', true, '2024-Q3', 128, 'high', 'hf:meta-llama/Llama-3.2-1B-Instruct', 'llama31_8b', 'finetune'),
    desc: 'Meta\'s tiny on-device model, pruned + distilled from Llama 3.1. Runs on almost anything; only good for light rewriting and summarization.',
  },
  {
    id: 'qwen3_4b_2507', name: 'Qwen3-4B-Instruct-2507', tier: 'small', variant: 'instruct', spec: 'general',
    paramsTotalB: 4, paramsActiveB: 4, layers: 36, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 69.6, gpqaDiamond: 62, aime: 47.4, liveCodeBench: 35.1 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q3', 262, 'high', 'hf:Qwen/Qwen3-4B-Instruct-2507'),
    desc: 'A remarkably strong 4B non-thinking model with a 256K window — punches far above its size on knowledge and code. The modern edge workhorse.',
  },
  {
    id: 'nemotron_nano_9b', name: 'Nemotron Nano 9B v2', tier: 'small', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 9, paramsActiveB: 9, isReasoning: true,
    layers: 4, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { gpqaDiamond: 64, aime: 72.1, liveCodeBench: 71.1 }, alignment: ALIGN_NEMOTRON, instructFollow: 84,
    real: R('NVIDIA', 'NVIDIA Open Model', true, '2025-Q3', 128, 'high', 'hf:nvidia/NVIDIA-Nemotron-Nano-9B-v2'),
    desc: 'A from-scratch hybrid Mamba-2/Transformer reasoner (only four attention layers → tiny KV, up to ~6× the throughput). Strong reasoning for 9B; fits an edge rack.',
  },
  {
    id: 'gemma3_12b', name: 'Gemma 3 12B', tier: 'small', variant: 'instruct', spec: 'general',
    paramsTotalB: 12, paramsActiveB: 12, layers: 48, kvHeads: 8, headDim: 256, attn: 'GQA',
    bench: { mmluPro: 60.6, gpqaDiamond: 40.9, liveCodeBench: 24.6 }, alignment: ALIGN_GEMMA, instructFollow: 88,
    real: R('Google', 'Gemma', true, '2025-Q1', 128, 'high', 'hf:google/gemma-3-12b-it'),
    desc: 'A balanced multimodal generalist with a 128K window and a vision encoder. Solid chat across 140+ languages; not a reasoner or a coder.',
  },
  {
    id: 'qwen3_coder_30b', name: 'Qwen3-Coder-30B-A3B', tier: 'coding', variant: 'coding', spec: 'agentic',
    paramsTotalB: 30.5, paramsActiveB: 3.3, isMoE: true,
    layers: 48, kvHeads: 4, headDim: 128, attn: 'GQA',
    bench: { sweBench: 51.6 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q3', 262, 'high', 'hf:Qwen/Qwen3-Coder-30B-A3B-Instruct'),
    desc: 'Agentic coding at 3.3B active — a local coding-agent MoE that drives shell/editor tool loops on commodity hardware. A 262K window.',
  },
  {
    id: 'nemotron3_nano_30b', name: 'Nemotron 3 Nano 30B-A3B', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 30, paramsActiveB: 3.5, isMoE: true, isReasoning: true,
    layers: 6, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 78.3, gpqaDiamond: 73, aime: 89.1, liveCodeBench: 68.3, sweBench: 38.8 }, alignment: ALIGN_NEMOTRON, instructFollow: 84,
    real: R('NVIDIA', 'NVIDIA Nemotron Open Model', true, '2025-Q4', 256, 'high', 'hf:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16'),
    desc: 'The efficient member of NVIDIA\'s from-scratch Nemotron 3 line: a hybrid Mamba-2 + MoE reasoner, ~3.5B active, six attention layers (tiny KV). Frontier-grade reasoning, cheap to serve.',
  },
  {
    id: 'qwen36_27b', name: 'Qwen3.6-27B', tier: 'general', variant: 'instruct', spec: 'coding',
    paramsTotalB: 27, paramsActiveB: 27, isReasoning: true,
    layers: 64, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 86.2, gpqaDiamond: 87.8, aime: 94.1, liveCodeBench: 83.9, sweBench: 77.2 }, alignment: ALIGN_QWEN, instructFollow: 86,
    real: R('Alibaba', 'Apache-2.0', true, '2026-Q2', 262, 'medium', 'hf:Qwen/Qwen3.6-27B'),
    desc: 'A dense 27B thinking model (hybrid Gated DeltaNet + attention) that matches far larger MoEs on agentic coding (SWE-bench 77). The 2026 open leader under ~150B.',
  },
  {
    id: 'qwen3_next_80b', name: 'Qwen3-Next-80B-A3B Thinking', tier: 'general', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 80, paramsActiveB: 3, isMoE: true, isReasoning: true,
    layers: 48, kvHeads: 2, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 82.7, gpqaDiamond: 77.2, aime: 87.8, liveCodeBench: 68.7 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2025-Q3', 262, 'high', 'hf:Qwen/Qwen3-Next-80B-A3B-Thinking'),
    desc: 'Ultra-sparse next-gen MoE: 80B of weights, only ~3B active across 512 experts. Flagship-class reasoning at a tiny active cost; needs the VRAM but serves cheap.',
  },
  {
    id: 'qwen35_122b', name: 'Qwen3.5-122B-A10B', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 122, paramsActiveB: 10, isMoE: true, isReasoning: true,
    layers: 62, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 86.7, gpqaDiamond: 86.6, aime: 91.3, liveCodeBench: 78.9, sweBench: 72 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2026-Q1', 262, 'high', 'hf:Qwen/Qwen3.5-122B-A10B'),
    desc: 'The mid-tier Qwen3.5 MoE: 122B total, 10B active, multimodal thinking. Frontier-level scores that fit a Pod and serve at 10B active.',
  },
  {
    id: 'glm_5_2', name: 'GLM-5.2', tier: 'frontier', variant: 'instruct', spec: 'agentic',
    paramsTotalB: 753, paramsActiveB: 40, isMoE: true, isReasoning: true,
    layers: 92, kvHeads: 128, headDim: 128, attn: 'MLA',
    bench: { gpqaDiamond: 91.2, aime: 99.2 }, alignment: ALIGN_FRONTIER, instructFollow: 84,
    real: R('Z.ai (Zhipu)', 'MIT', true, '2026-Q2', 1000, 'medium', 'hf:zai-org/GLM-5.2'),
    desc: 'The open-weight leader on the Artificial Analysis index (2026): a 753B/40B sparse-attention MoE with a 1M window, tuned for long-horizon agentic coding. A SuperPod/Giga checkpoint.',
  },
  {
    id: 'deepseek_v4_pro', name: 'DeepSeek-V4-Pro', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 1600, paramsActiveB: 49, isMoE: true, isReasoning: true,
    layers: 61, kvHeads: 128, headDim: 128, attn: 'MLA',
    bench: { mmluPro: 87.5, gpqaDiamond: 90.1, aime: 95.2, liveCodeBench: 93.5, sweBench: 80.6 }, alignment: ALIGN_FRONTIER, instructFollow: 84,
    real: R('DeepSeek', 'MIT', true, '2026-Q2', 1000, 'high', 'hf:deepseek-ai/DeepSeek-V4-Pro'),
    desc: 'DeepSeek\'s 1.6-trillion-param V4 flagship, 49B active, with a new hybrid compressed-attention architecture and a 1M window. The open ceiling — only an NVL72 holds it.',
  },
  {
    id: 'minimax_m3', name: 'MiniMax-M3', tier: 'frontier', variant: 'instruct', spec: 'agentic',
    paramsTotalB: 428, paramsActiveB: 23, isMoE: true, isReasoning: true,
    layers: 62, kvHeads: 8, headDim: 128, attn: 'MLA',
    bench: { gpqaDiamond: 92.9 }, alignment: ALIGN_FRONTIER, instructFollow: 84,
    real: R('MiniMax', 'MiniMax Community', true, '2026-Q2', 1000, 'medium', 'hf:MiniMaxAI/MiniMax-M3'),
    desc: 'An agentic frontier MoE on MiniMax Sparse Attention: 428B/23B with a 1M window and ~10–16× faster long-context serving than M2. Built for tool-using agents.',
  },
  {
    id: 'qwen35_397b', name: 'Qwen3.5-397B-A17B', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 397, paramsActiveB: 17, isMoE: true, isReasoning: true,
    layers: 80, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 87.8, gpqaDiamond: 88.4, aime: 91.3, liveCodeBench: 83.6, sweBench: 76.4 }, alignment: ALIGN_QWEN, instructFollow: 84,
    real: R('Alibaba', 'Apache-2.0', true, '2026-Q1', 262, 'high', 'hf:Qwen/Qwen3.5-397B-A17B'),
    desc: 'The Qwen3.5 flagship: a 397B/17B multimodal reasoning MoE (512 experts). Clears every lane with margin at only 17B active.',
  },
  {
    id: 'nemotron3_ultra_550b', name: 'Nemotron 3 Ultra 550B-A55B', tier: 'frontier', variant: 'instruct', spec: 'reasoning',
    paramsTotalB: 550, paramsActiveB: 55, isMoE: true, isReasoning: true,
    layers: 8, kvHeads: 8, headDim: 128, attn: 'GQA',
    bench: { mmluPro: 86.8, gpqaDiamond: 87, liveCodeBench: 89, sweBench: 70.7 }, alignment: ALIGN_NEMOTRON, instructFollow: 84,
    real: R('NVIDIA', 'OpenMDW v1.1', true, '2026-Q2', 262, 'high', 'hf:nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16'),
    desc: 'NVIDIA\'s from-scratch frontier flagship: a 550B/55B Latent-MoE (hybrid Mamba-2 + MoE + attention) — the strongest US open-weight model on the AA index at launch.',
  },
]

/** Per-tier baseline that fills any qualityBy axis a model has no benchmark for.
 *  agentic floors are deliberately low — without a real SWE-bench score a model
 *  is assumed weak at autonomous/agentic work (the un-saturated frontier lane). */
const QUALITY_FLOOR: Record<ModelDef['tier'], Record<ServerSpec, number>> = {
  small: { chat: 30, coding: 25, reasoning: 30, general: 30, agentic: 20 },
  general: { chat: 55, coding: 45, reasoning: 50, general: 55, agentic: 40 },
  coding: { chat: 50, coding: 60, reasoning: 45, general: 50, agentic: 55 },
  frontier: { chat: 85, coding: 80, reasoning: 85, general: 85, agentic: 70 },
}

export const MODEL_DEFS: Record<string, ModelDef> = {}
for (const e of ROSTER) {
  const qualityBy = qualityFromBenchmarks(e.bench, QUALITY_FLOOR[e.tier])
  MODEL_DEFS[e.id] = {
    id: e.id,
    name: e.name,
    tier: e.tier,
    variant: e.variant,
    spec: e.spec,
    origin: 'base',
    paramsTotalB: e.paramsTotalB,
    paramsActiveB: e.paramsActiveB,
    isMoE: !!e.isMoE,
    isReasoning: !!e.isReasoning,
    quality: qualityBy[e.spec],
    qualityBy,
    layers: e.layers,
    kvHeads: e.kvHeads,
    headDim: e.headDim,
    attn: e.attn,
    weightBytes: 2,
    contextWindowK: e.real.contextWindowK,
    // §3.4/§OQ-G12 hand-filled intrinsic alignment + instruction-following (P3d consumes them).
    alignment: e.alignment ?? { ...INSTRUCT_ALIGNMENT },
    instructFollow: e.instructFollow ?? INSTRUCT_INSTRUCT_FOLLOW,
    desc: e.desc,
    real: { ...e.real, benchmarks: e.bench },
  }
}

/** Open-weight checkpoints are free to own from the start (the weights are a download). */
export const OPEN_MODEL_IDS = ROSTER.map((e) => e.id)

/* ------------------------------------------------------------------ *
 *  DERIVED CHECKPOINTS — the closed `ft_agent`/`pt_giga` cards are     *
 *  GONE (P3b). Their role is now PLAYER-CREATED in the Post-Training    *
 *  Studio (§1): a GRPO-agentic run on a frontier base is your agentic   *
 *  specialist; the endless quality ceiling is a deep, iterative         *
 *  finetune-of-a-finetune chain. Derived models live in                *
 *  `s.derivedModels`, resolved via `resolveModel(s,id)` (sim/models.ts). *
 * ------------------------------------------------------------------ */

export const MODEL_LIST = Object.values(MODEL_DEFS)
/** The small dense instruct model every new rack ships with. */
export const DEFAULT_MODEL_ID = 'llama31_8b'
/** Bootstrap: every open model is owned (free) from the start; VRAM + method gate use. */
export const STARTER_MODELS = OPEN_MODEL_IDS

/* ------------------------------------------------------------------ *
 *  POST-TRAINING STUDIO (§1) — the 12-method recipe table, data-driven. *
 *  Each post-training run produces a NEW derived ModelDef (I1); the     *
 *  recipe constants (gainScale/gainCap/taxScale/forgetScale, 48 values) *
 *  are autoplay-calibratable game curves, NOT first principles          *
 *  ([fix C4]). See `deriveQuality` in sim/models.ts.                    *
 * ------------------------------------------------------------------ */

/** Shared adapter (PEFT) target set: lora/qlora/dora all train these axes. */
const PEFT_TARGETS = ['chat', 'coding', 'reasoning', 'general', 'agentic'] as const

/**
 * The authored recipe table. Wrapped by `calibrateRecipes` (P5: a validating
 * pass-through that asserts the §6.3 band-displacement ordering and returns it
 * unchanged) so the constants cannot silently drift out of balance.
 */
const METHOD_RECIPES_RAW: Record<PostTrainMethod, MethodRecipe> = {
  // CPT — continued pre-training: the heaviest finetune (§2.1 "~SFT 10–100×"),
  // broad domain/long-context capability, but huge catastrophic forgetting.
  cpt: {
    id: 'cpt', name: 'Continued Pre-Training', relation: 'finetune',
    allowedTargets: ['domain', 'longctx', 'general'],
    costCompute: 60, costData: 40,
    gainScale: 22 /* autoplay-calibratable (P5) */,
    gainCap: 40 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.5 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_cpt',
    desc: 'Continued pre-training on a big corpus. Broad capability and long-context gains, but the highest catastrophic forgetting.',
  },
  // RLHF — four models co-running, the priciest preference method (§2.4); biggest
  // alignment tax (raises safety but hurts general capability + over-refusal).
  rlhf: {
    id: 'rlhf', name: 'RLHF', relation: 'finetune',
    allowedTargets: ['safety', 'chat', 'general'],
    costCompute: 40, costData: 14,
    gainScale: 14 /* autoplay-calibratable (P5) */,
    gainCap: 16 /* autoplay-calibratable (P5) */,
    taxScale: 0.6 /* autoplay-calibratable (P5) */,
    forgetScale: 0.12 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_pref',
    desc: 'Reinforcement learning from human feedback. Strong safety/chat alignment — but the steepest capability tax and rising over-refusal.',
  },
  // GRPO — RL for reasoning/agentic (PPO −40–60% memory, §2.4); the strongest
  // reasoning/agentic gainScale; cold-starts a thinking model (§2.5).
  grpo: {
    id: 'grpo', name: 'GRPO (Reasoning RL)', relation: 'finetune',
    allowedTargets: ['reasoning', 'agentic'],
    costCompute: 18, costData: 8,
    gainScale: 28 /* autoplay-calibratable (P5) */,
    gainCap: 40 /* autoplay-calibratable (P5) */,
    taxScale: 0.05 /* autoplay-calibratable (P5) */,
    forgetScale: 0.15 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_rl',
    desc: 'Group-relative policy optimization. Turns a base model into a thinker and is the strongest path to reasoning/agentic capability.',
  },
  // CAI — Constitutional AI: medium-high safety, LOW tax, and it REDUCES
  // over-refusal (safe-completion style, §2.4).
  cai: {
    id: 'cai', name: 'Constitutional AI', relation: 'finetune',
    allowedTargets: ['safety'],
    costCompute: 16, costData: 9,
    gainScale: 12 /* autoplay-calibratable (P5) */,
    gainCap: 14 /* autoplay-calibratable (P5) */,
    taxScale: 0.25 /* autoplay-calibratable (P5) */,
    forgetScale: 0.08 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_cai',
    desc: 'AI feedback against a constitution. A Pareto safety gain: raises safety AND lowers over-refusal (safe-completion).',
  },
  // Distill — teacher → smaller student base; caps at min(teacher, student capacity),
  // reshapes deploy fields to the student (§2.6).
  distill: {
    id: 'distill', name: 'Distillation', relation: 'finetune',
    allowedTargets: ['reasoning', 'coding', 'agentic'],
    costCompute: 12, costData: 16,
    gainScale: 24 /* autoplay-calibratable (P5) */,
    gainCap: 999 /* effective cap is min(teacher, student-capacity) at derive time */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.04 /* autoplay-calibratable (P5) */,
    reshapesDeployment: true, requiresTech: 'pt_distill',
    desc: 'Distill a big teacher into a smaller student base: cheaper to serve, but the student never quite matches the teacher.',
  },
  // DPO — direct preference optimization: medium, cheaper than RLHF (§2.4).
  dpo: {
    id: 'dpo', name: 'DPO', relation: 'finetune',
    allowedTargets: ['chat', 'general', 'safety'],
    costCompute: 10, costData: 11,
    gainScale: 12 /* autoplay-calibratable (P5) */,
    gainCap: 12 /* autoplay-calibratable (P5) */,
    taxScale: 0.08 /* autoplay-calibratable (P5) */,
    forgetScale: 0.06 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_pref',
    desc: 'Direct preference optimization. A lighter, cheaper alternative to RLHF for chat/general/safety alignment.',
  },
  // SFT — supervised fine-tuning: the baseline, NO research needed (the starter, §2.2).
  sft: {
    id: 'sft', name: 'Supervised Fine-Tuning', relation: 'finetune',
    allowedTargets: ['chat', 'coding', 'general', 'longctx'],
    costCompute: 6, costData: 8,
    gainScale: 16 /* autoplay-calibratable (P5) */,
    gainCap: 14 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.08 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, /* no requiresTech — the starter method */
    desc: 'Supervised fine-tuning on curated data. The baseline finetune; no research needed to run it.',
  },
  // QAT — quantization-aware training: compresses deploy (weightBytes→0.5), small
  // quality hit; reshapes deploy fields (§2.7). Does not target a quality axis.
  qat: {
    id: 'qat', name: 'Quantization-Aware Training', relation: 'quantized',
    allowedTargets: ['general'],
    costCompute: 6, costData: 3,
    gainScale: 0 /* autoplay-calibratable (P5) */,
    gainCap: 0 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0 /* autoplay-calibratable (P5) */,
    reshapesDeployment: true, requiresTech: 'pt_qat',
    desc: 'Train for INT4 inference: half the weight memory and faster decode, at −2 quality. A per-model quant distinct from serving-layer PTQ.',
  },
  // DoRA — weight-decomposed LoRA: slightly above LoRA (§2.3).
  dora: {
    id: 'dora', name: 'DoRA', relation: 'adapter',
    allowedTargets: [...PEFT_TARGETS],
    costCompute: 1.4, costData: 6,
    gainScale: 14 /* autoplay-calibratable (P5) */,
    gainCap: 10 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.03 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_lora',
    desc: 'Weight-decomposed low-rank adaptation. A touch stronger than LoRA at slightly higher cost; tiny forgetting.',
  },
  // LoRA — the cheapest adapter (§2.3): one band of capability, near-zero forgetting.
  lora: {
    id: 'lora', name: 'LoRA', relation: 'adapter',
    allowedTargets: [...PEFT_TARGETS],
    costCompute: 1, costData: 5,
    gainScale: 12 /* autoplay-calibratable (P5) */,
    gainCap: 8 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.02 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_lora',
    desc: 'Low-rank adaptation: the cheapest, lowest-risk finetune. One band of capability with almost no forgetting.',
  },
  // QLoRA — quantized-base LoRA: the lowest barrier (§2.3).
  qlora: {
    id: 'qlora', name: 'QLoRA', relation: 'adapter',
    allowedTargets: [...PEFT_TARGETS],
    costCompute: 0.8, costData: 5,
    gainScale: 11 /* autoplay-calibratable (P5) */,
    gainCap: 8 /* autoplay-calibratable (P5) */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0.02 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_lora',
    desc: 'LoRA over a quantized base: the lowest hardware barrier of all, for cheap iterative tuning.',
  },
  // Merge — average two upstream models (§2.6): no retraining, no forgetting, no gainScale.
  merge: {
    id: 'merge', name: 'Model Merge', relation: 'merge',
    allowedTargets: [...PEFT_TARGETS, 'safety', 'longctx', 'domain'],
    costCompute: 0.2, costData: 0,
    gainScale: 0 /* n/a — merge averages upstream axes */,
    gainCap: 0 /* n/a */,
    taxScale: 0 /* autoplay-calibratable (P5) */,
    forgetScale: 0 /* autoplay-calibratable (P5) */,
    reshapesDeployment: false, requiresTech: 'pt_merge',
    desc: 'Average the weights of two models (same family). No retraining, no forgetting — blend two specialists into one.',
  },
}

/** The recipe table, run through the P5 validating calibration pass (§6.3). */
export const METHOD_RECIPES: Record<PostTrainMethod, MethodRecipe> = calibrateRecipes(METHOD_RECIPES_RAW)

/* ------------------------------------------------------------------ *
 *  INFRA TECH TREE (§4) — serving/infra ONLY. The 22 InfraNodeDef       *
 *  cover the real serving chain (scheduling → KV memory → decoding →    *
 *  weight-quant → parallelism → routing → multi-LoRA → engine). They    *
 *  are RESEARCH (data + requisitioned compute on the infra track, R6),  *
 *  the SINGLE source of truth for serving physics: on completion        *
 *  `applyInfraEffects(s, def.effects)` mutates `s.infra`.               *
 *                                                                      *
 *  What is NOT here (P3c removals): GQA/MLA + MoE sparsity + reasoning   *
 *  are MODEL attributes (R4), not nodes; the +quality `scale_pretrain`  *
 *  buff is gone (model polish is the Post-Training Studio, P3b).        *
 * ------------------------------------------------------------------ */

/** Sizing target: a project wants a training cluster that finishes within ~one wave. */
export const RESEARCH_TARGET_SECONDS = 60
/** Never requisition more than this share of total fleet FLOPS. */
export const RESEARCH_MAX_SHARE = 0.45

/**
 * The 22 infra nodes. `effects` is a flat key→number bag interpreted by
 * `applyInfraEffects` (sim/research.ts). `requires`/`conflicts` are node ids.
 */
export const INFRA_NODES: Record<string, InfraNodeDef> = {}
function infra(def: Omit<InfraNodeDef, 'level'> & { level?: number }): void {
  INFRA_NODES[def.id] = { level: 1, ...def }
}

// --- scheduling (§4.1/§4.3) ---
infra({
  id: 'inf_batching', category: 'scheduling', name: 'Continuous Batching', i18nKey: 'inf_batching',
  effects: { schedBatch: 1 }, requires: [], dataCost: 8, compute: 600,
  optimizes: ['throughput', 'cost'], coupling: 'pure-infra', sourceRef: '§4.1',
})
infra({
  id: 'inf_multistep', category: 'scheduling', name: 'Multi-Step Scheduling', i18nKey: 'inf_multistep',
  effects: { multiStep: 1, throughput: 1 }, requires: ['inf_batching'], dataCost: 12, compute: 1200,
  optimizes: ['throughput', 'latency'], coupling: 'pure-infra', sourceRef: '§4.1',
})
infra({
  id: 'inf_chunked', category: 'scheduling', name: 'Chunked Prefill', i18nKey: 'inf_chunked',
  effects: { chunked: 1 }, requires: ['inf_paged'], conflicts: ['inf_disagg'], dataCost: 22, compute: 2500,
  optimizes: ['throughput', 'latency'], coupling: 'pure-infra', sourceRef: '§4.3',
})
infra({
  id: 'inf_disagg', category: 'scheduling', name: 'P/D Disaggregation', i18nKey: 'inf_disagg',
  effects: { disagg: 1 }, requires: ['inf_par_pp'], conflicts: ['inf_chunked'], dataCost: 40, compute: 3000,
  optimizes: ['latency', 'cost'], coupling: 'pure-infra', sourceRef: '§4.3',
})

// --- kv-memory (§4.2) ---
infra({
  id: 'inf_paged', category: 'kv-memory', name: 'PagedAttention', i18nKey: 'inf_paged',
  effects: { kvUtilization: 0.96 }, requires: ['inf_batching'], dataCost: 18, compute: 1500,
  optimizes: ['memory', 'throughput'], coupling: 'pure-infra', sourceRef: '§4.2',
})
infra({
  id: 'inf_prefix', category: 'kv-memory', name: 'Prefix Caching', i18nKey: 'inf_prefix',
  effects: { prefixHitCeil: 0.85 }, requires: ['inf_paged'], dataCost: 14, compute: 1100,
  optimizes: ['latency', 'memory'], coupling: 'pure-infra', sourceRef: '§4.2',
})
infra({
  id: 'inf_flash', category: 'kv-memory', name: 'FlashAttention', i18nKey: 'inf_flash',
  effects: { flash: 1 }, requires: ['inf_paged'], dataCost: 14, compute: 1300,
  optimizes: ['latency', 'memory'], coupling: 'pure-infra', sourceRef: '§4.2',
})
infra({
  id: 'inf_kvquant_fp8', category: 'kv-memory', name: 'FP8 KV Cache', i18nKey: 'inf_kvquant_fp8',
  effects: { kvQuantBytes: 1 }, requires: ['inf_paged'], dataCost: 12, compute: 1200,
  optimizes: ['memory', 'latency'], coupling: 'infra-model', sourceRef: '§4.2',
})
infra({
  id: 'inf_kvquant_int4', category: 'kv-memory', name: 'INT4 KV Cache', i18nKey: 'inf_kvquant_int4',
  effects: { kvQuantBytes: 0.5 }, requires: ['inf_kvquant_fp8'], dataCost: 16, compute: 1800,
  optimizes: ['memory'], coupling: 'infra-model', sourceRef: '§4.2',
})
infra({
  id: 'inf_offload', category: 'kv-memory', name: 'KV Offloading (LMCache)', i18nKey: 'inf_offload',
  effects: { offloadGb: 64 }, requires: ['inf_paged'], dataCost: 14, compute: 1200,
  optimizes: ['memory', 'latency'], coupling: 'pure-infra', sourceRef: '§4.2',
})

// --- decoding (§4.4) ---
infra({
  id: 'inf_spec', category: 'decoding', name: 'Speculative Decoding (EAGLE)', i18nKey: 'inf_spec',
  effects: { specEnabled: 1, specLevel: 1 }, requires: ['inf_batching'], dataCost: 16, compute: 2200,
  optimizes: ['latency'], coupling: 'infra-model', sourceRef: '§4.4',
})

// --- weight-quant (PTQ, §4.5; distinct from per-model QAT) ---
infra({
  id: 'inf_wq_fp8', category: 'weight-quant', name: 'FP8 Weight Quant', i18nKey: 'inf_wq_fp8',
  effects: { weightQuantBytes: 1 }, requires: ['inf_batching'], dataCost: 10, compute: 900,
  optimizes: ['memory', 'cost'], coupling: 'infra-model', sourceRef: '§4.5',
})
infra({
  id: 'inf_wq_int4', category: 'weight-quant', name: 'INT4 Weight Quant (AWQ/GPTQ)', i18nKey: 'inf_wq_int4',
  effects: { weightQuantBytes: 0.5 }, requires: ['inf_wq_fp8'], dataCost: 14, compute: 1400,
  optimizes: ['memory', 'cost'], coupling: 'infra-model', sourceRef: '§4.5',
})
infra({
  id: 'inf_wq_nvfp4', category: 'weight-quant', name: 'NVFP4 (Blackwell)', i18nKey: 'inf_wq_nvfp4',
  effects: { weightQuantBytes: 0.5 }, requires: ['inf_wq_int4'], dataCost: 18, compute: 2400,
  optimizes: ['memory', 'throughput'], coupling: 'infra-model', sourceRef: '§4.5', requiresBlackwell: true,
})

// --- parallelism (§4.7) ---
infra({
  id: 'inf_par_tp', category: 'parallelism', name: 'Tensor Parallelism', i18nKey: 'inf_par_tp',
  effects: { parTp: 1 }, requires: ['inf_paged'], dataCost: 16, compute: 1600,
  optimizes: ['latency'], coupling: 'pure-infra', sourceRef: '§4.7',
})
infra({
  id: 'inf_par_pp', category: 'parallelism', name: 'Pipeline Parallelism', i18nKey: 'inf_par_pp',
  effects: { parPp: 1 }, requires: ['inf_par_tp'], dataCost: 14, compute: 1400,
  optimizes: ['memory'], coupling: 'pure-infra', sourceRef: '§4.7',
})
infra({
  id: 'inf_par_dp', category: 'parallelism', name: 'Data Parallelism', i18nKey: 'inf_par_dp',
  effects: { parDp: 1, throughput: 1 }, requires: ['inf_par_tp'], dataCost: 12, compute: 1200,
  optimizes: ['throughput'], coupling: 'pure-infra', sourceRef: '§4.7',
})
infra({
  id: 'inf_par_ep', category: 'parallelism', name: 'Expert Parallelism (MoE)', i18nKey: 'inf_par_ep',
  effects: { parEp: 1 }, requires: ['inf_par_tp'], dataCost: 16, compute: 1800,
  optimizes: ['cost'], coupling: 'infra-model', sourceRef: '§4.8',
})

// --- routing (§4.10) ---
infra({
  id: 'inf_routing', category: 'routing', name: 'KV-Aware Routing (Dynamo)', i18nKey: 'inf_routing',
  effects: { routingKvAware: 1 }, requires: ['inf_prefix'], dataCost: 12, compute: 1100,
  optimizes: ['latency', 'cost'], coupling: 'pure-infra', sourceRef: '§4.10',
})

// --- multi-lora (§4.10) ---
infra({
  id: 'inf_multilora', category: 'multi-lora', name: 'Multi-LoRA Serving (S-LoRA)', i18nKey: 'inf_multilora',
  effects: { loraSlots: 2000 }, requires: ['inf_paged'], dataCost: 12, compute: 1000,
  optimizes: ['throughput', 'cost'], coupling: 'pure-infra', sourceRef: '§4.10',
})

// --- engine (§4.9) ---
infra({
  id: 'inf_engine_sglang', category: 'engine', name: 'SGLang Engine', i18nKey: 'inf_engine_sglang',
  effects: { engineTier: 1, throughput: 1 }, requires: ['inf_batching'], dataCost: 10, compute: 900,
  optimizes: ['throughput'], coupling: 'pure-infra', sourceRef: '§4.9',
})
infra({
  id: 'inf_engine_trtllm', category: 'engine', name: 'TensorRT-LLM Engine', i18nKey: 'inf_engine_trtllm',
  effects: { engineTier: 2 }, requires: ['inf_engine_sglang'], dataCost: 16, compute: 1800,
  optimizes: ['throughput', 'latency'], coupling: 'pure-infra', sourceRef: '§4.9',
})

export const INFRA_LIST = Object.values(INFRA_NODES)

/* ------------------------------------------------------------------ *
 *  RESEARCH DEFS — the infra track runs both (a) the 22 infra nodes    *
 *  above (effects applied to s.infra) and (b) the post-training METHOD  *
 *  UNLOCKS (§1.3): one-time "we can now run this method" gates that set *
 *  a pt_* flag a recipe's `requiresTech` checks (distinct from RUNNING  *
 *  a recipe). Both run on the infra research track / engine.           *
 * ------------------------------------------------------------------ */

export const RESEARCH_DEFS: Record<string, ResearchDef> = {}
function tech(
  id: string,
  name: string,
  techId: string,
  dataCost: number,
  compute: number,
  requires: string[],
  desc: string,
): void {
  RESEARCH_DEFS[id] = { id, kind: 'tech', name, techId, dataCost, compute, requires, desc }
}

// Each infra node becomes a ResearchDef so the existing infra-track engine + the
// R&D panel drive it; `techId === node.id` marks it researched (completeResearch
// detects an INFRA_NODES id and calls applyInfraEffects instead of a counter buff).
for (const n of INFRA_LIST) {
  RESEARCH_DEFS[n.id] = {
    id: n.id, kind: 'tech', name: n.name, techId: n.id,
    dataCost: n.dataCost, compute: n.compute, requires: n.requires, desc: '',
  }
}

// --- POST-TRAINING METHOD UNLOCKS (§1.3) — gate flags (pt_lora / pt_pref / …)
//     a recipe's `requiresTech` checks. sft needs no unlock (the starter). ---
tech(
  'r_pt_lora', 'PEFT: LoRA / QLoRA / DoRA', 'pt_lora', 10, 800, ['inf_batching'],
  'Parameter-efficient fine-tuning. Unlocks the cheapest adapter methods in the Post-Training Studio: LoRA, QLoRA and DoRA.',
)
tech(
  'r_pt_pref', 'Preference Optimization', 'pt_pref', 16, 1500, ['r_pt_lora'],
  'Train on human/AI preferences. Unlocks DPO and RLHF in the Studio — the foundation of safety and chat alignment.',
)
tech(
  'r_pt_rl', 'Reasoning RL (GRPO)', 'pt_rl', 18, 2000, ['r_pt_pref'],
  'Reinforcement learning for reasoning. Unlocks GRPO in the Studio — the strongest path to a thinking/agentic model.',
)
tech(
  'r_pt_cai', 'Constitutional AI', 'pt_cai', 14, 1400, ['r_pt_pref'],
  'AI-feedback alignment against a constitution. Unlocks CAI in the Studio — a Pareto safety gain (raises safety, lowers over-refusal).',
)
tech(
  'r_pt_cpt', 'Continued Pre-Training', 'pt_cpt', 22, 3000, ['inf_batching'],
  'Heavy domain / long-context continued pre-training. Unlocks CPT in the Studio — broad capability at the cost of forgetting.',
)
tech(
  'r_pt_distill', 'Distillation', 'pt_distill', 14, 1800, ['r_pt_rl'],
  'Distil a big teacher into a smaller student base. Unlocks Distillation in the Studio — cheaper-to-serve specialists.',
)
tech(
  'r_pt_merge', 'Model Merging', 'pt_merge', 8, 600, ['r_pt_lora'],
  'Average two same-family checkpoints. Unlocks Model Merge in the Studio — blend specialists with no retraining.',
)
tech(
  'r_pt_qat', 'Quantization-Aware Training', 'pt_qat', 10, 1200, ['inf_batching'],
  'Train a model for INT4 inference. Unlocks QAT in the Studio — per-model compression to half the weight memory.',
)

/* ------------------------------------------------------------------ *
 *  RED-TEAM EVAL (§3.6 [fix M4]) — a dev-time, one-time adversarial    *
 *  EVAL on the third research track (NOT a per-request serving knob).   *
 *  v1/v2 stack: each level bumps the `eval_redteam` counter, which (a)   *
 *  reduces guardrail over-refusal convexity (OVERREF_K ×0.7, XSTest:    *
 *  judge by intent not keywords), (b) UNLOCKS a harder detection        *
 *  category (v1 → injection, v2 → pii), and (c) adds a small +0.02      *
 *  recall ("calibrating the threshold, not improving the model").       *
 * ------------------------------------------------------------------ */
function evalNode(id: string, name: string, dataCost: number, compute: number, requires: string[], desc: string): void {
  RESEARCH_DEFS[id] = { id, kind: 'eval', name, techId: 'eval_redteam', dataCost, compute, requires, desc }
}
evalNode(
  'r_eval_redteam_v1', 'Red-Team Eval', 14, 1200, ['inf_batching'],
  'A dev-time adversarial evaluation. Calibrates guardrails to judge by intent (XSTest), cutting over-refusal, and unlocks prompt-injection detection.',
)
evalNode(
  'r_eval_redteam_v2', 'Red-Team Eval II', 18, 1800, ['r_eval_redteam_v1'],
  'A deeper red-team campaign. Further cuts over-refusal, adds a touch more recall, and unlocks PII-leak detection.',
)

export const RESEARCH_LIST = Object.values(RESEARCH_DEFS)

/* ------------------------------------------------------------------ *
 *  TOWERS & BUILDINGS — you build neutral GPU racks; what a rack is   *
 *  good at comes from the model you deploy on it (inspect panel).     *
 *  Every new rack ships with the free Llama-3.1-8B starter preloaded. *
 * ------------------------------------------------------------------ */

export const TOWER_DEFS: Record<string, TowerDef> = {
  srv_edge: {
    id: 'srv_edge',
    name: 'Edge GPU Rack',
    kind: 'server',
    cost: HARDWARE_DEFS.hw_edge.cost,
    range: HARDWARE_DEFS.hw_edge.range,
    color: HARDWARE_DEFS.hw_edge.color,
    accent: HARDWARE_DEFS.hw_edge.accent,
    hardwareId: 'hw_edge',
    defaultModelId: DEFAULT_MODEL_ID,
    tagline: 'Small rack · Llama-3.1-8B included',
    desc: 'A low-power starter rack, Llama-3.1-8B preloaded. Upgrade the rack in place and deploy any bigger open model your VRAM (and unlocked methods) allow.',
  },
  srv_frontier: {
    id: 'srv_frontier',
    name: 'Frontier GPU Rack',
    kind: 'server',
    cost: HARDWARE_DEFS.hw_frontier.cost,
    range: HARDWARE_DEFS.hw_frontier.range,
    color: HARDWARE_DEFS.hw_frontier.color,
    accent: HARDWARE_DEFS.hw_frontier.accent,
    hardwareId: 'hw_frontier',
    defaultModelId: DEFAULT_MODEL_ID,
    tagline: 'Big rack · 70B-ready',
    desc: 'A large accelerator rack that fits a 70B model unquantized. Ships with Llama-3.1-8B; deploy something worthy of it.',
  },
  router: {
    id: 'router',
    name: 'Router',
    kind: 'router',
    // §6.6: support-building costs rescaled to the real credit economy (where racks
    // are capex/1000) so they stay proportionate to the rack ladder.
    cost: 24,
    range: 3.6,
    color: 0xff9f43,
    accent: 0xffd9a8,
    routeBonus: 0.45,
    powerDraw: 0.2,
    heat: 0.2,
    tagline: 'Smart traffic assignment',
    desc: 'Reads each request and steers it to the right server. Boosts matched servers and is the heart of a smart build.',
  },
  cache: {
    id: 'cache',
    name: 'Cache',
    kind: 'cache',
    cost: 20,
    range: 3.0,
    color: 0x4fd6c4,
    accent: 0xc7fff5,
    cacheChance: 0.5,
    powerDraw: 0.2,
    heat: 0.2,
    tagline: 'Buffs servers · instant hits',
    desc: 'Aura: gives Serving Towers in range a chance to instantly answer cacheable traffic (Embedding, Chat, Code Completion, RAG, Agentic). Overlap it with your servers.',
  },
  // §3.3 the three external guardrail families — the key real contrast: a BERT
  // encoder is milliseconds; a generative 12B guardrail is a full (shorter) inference
  // (one to two orders slower). The single old Safety Gate is replaced by these.
  guard_encoder: {
    id: 'guard_encoder',
    name: 'Prompt Guard (encoder)',
    kind: 'guardrail',
    cost: 14,
    range: 2.9,
    color: 0xff6b9d,
    accent: 0xffc8dd,
    powerDraw: 0.1,
    heat: 0.1,
    guardrail: {
      archetype: 'encoder',
      side: 'input',
      catches: ['jailbreak', 'injection'],
      checkLatencyMs: 92, // Prompt Guard 86M: a single BERT forward, ms-scale (NOT the roofline)
      runsOnRoofline: false,
      baseRecall: 0.975,
    },
    tagline: 'Input-side · jailbreak + injection · 92 ms',
    desc: 'A lightweight BERT encoder (Prompt Guard 86M): a single millisecond-scale forward pass on the INPUT. Catches jailbreak and prompt injection. Cheap — it does not occupy your racks.',
  },
  guard_llm: {
    id: 'guard_llm',
    name: 'Llama Guard (generative)',
    kind: 'guardrail',
    cost: 40,
    range: 3.0,
    color: 0xf06595,
    accent: 0xffb3cf,
    guardrail: {
      archetype: 'generative',
      side: 'both',
      catches: ['jailbreak', 'injection', 'harmful', 'pii'],
      runsOnRoofline: true, // [fix M8] a full (shorter) 12B inference on its OWN rack
      guardParamsActiveB: 12, // Llama Guard 4 12B
      guardHardwareId: 'hw_perf', // an H100-class rack of its own (OQ-G16: independent tile)
      baseRecall: 0.92,
    },
    tagline: 'Both sides · all hazards · a real 12B inference',
    desc: 'A generative 12B guardrail (Llama Guard 4) on its OWN H100 rack: each check is a full (shorter) LLM inference that draws real power and adds real latency — one to two orders slower than the encoder. Catches all four hazards, input and output.',
  },
  guard_mod: {
    id: 'guard_mod',
    name: 'Moderation API',
    kind: 'guardrail',
    cost: 18,
    range: 2.9,
    color: 0xe064a8,
    accent: 0xffc0e0,
    powerDraw: 0.1,
    heat: 0.1,
    guardrail: {
      archetype: 'moderation',
      side: 'both',
      catches: ['harmful', 'pii'],
      checkLatencyMs: 120, // vendor-hosted (OpenAI omni moderation): off your racks
      runsOnRoofline: false,
      baseRecall: 0.88,
    },
    tagline: 'Both sides · harmful + PII · vendor-hosted',
    desc: 'A vendor-hosted moderation pass (OpenAI omni): a 120 ms extra model call on someone else’s racks. Catches harmful content and PII leakage on input and output — but not jailbreaks.',
  },
  power: {
    id: 'power',
    name: 'Power Plant',
    kind: 'power',
    cost: 18,
    range: 0,
    color: 0xffb454,
    accent: 0xffe0a8,
    // §6.5 real kW: a substation block big enough for ~14 H100 racks (0.56 kW each).
    power: 8,
    tagline: '+8 kW power capacity',
    desc: 'Raises electricity capacity (kW). Without enough power your GPU Racks brown out and go dark.',
  },
  cooling: {
    id: 'cooling',
    name: 'Cooling Tower',
    kind: 'cooling',
    cost: 18,
    range: 0,
    color: 0x59c2ff,
    accent: 0xc4ecff,
    // §6.5 real kW: an air-cooled chiller block, matched to the Power Plant.
    cooling: 8,
    tagline: '+8 kW cooling capacity',
    desc: 'Raises heat capacity (kW). Over the limit, every GPU Rack thermally throttles and serves slower.',
  },
  cooling_liquid: {
    id: 'cooling_liquid',
    name: 'Liquid Cooling Loop',
    kind: 'cooling_liquid',
    cost: 90,
    range: 0,
    color: 0x36e0e0,
    accent: 0xb6fffb,
    // §5.5: a direct-liquid loop sized for a high-density rack — an NVL72 is ~58 kW
    // served. ENABLES liquid-cooled racks (DGX/NVL72) and adds large kW (gated hard).
    cooling: 60,
    tagline: 'Enables liquid racks · +60 kW',
    desc: 'Direct liquid cooling (DLC). REQUIRED before any DGX/NVL72 rack (≥1000 W/GPU) can run — those racks cannot be served at all without a loop. Also adds large cooling capacity.',
  },
  lab: {
    id: 'lab',
    name: 'Training Lab',
    kind: 'lab',
    cost: 36,
    range: 0,
    color: 0xb084f5,
    accent: 0xe6d6ff,
    tagline: 'Unlocks the tech tree',
    desc: 'Required to train. Improves Data yield and opens the infra research tree and Post-Training Studio between waves.',
  },
}

export const BUILD_ORDER = [
  'srv_edge',
  'srv_frontier',
  'router',
  'cache',
  'guard_encoder',
  'guard_llm',
  'guard_mod',
  'power',
  'cooling',
  'cooling_liquid',
  'lab',
]

/* ------------------------------------------------------------------ *
 *  WAVES — the escalating campaign.                                  *
 * ------------------------------------------------------------------ */

export const WAVES: WaveDef[] = buildCampaign(CAMPAIGN_THEMES)

/**
 * The DETERMINISTIC between-wave incident a campaign wave forces (overriding the
 * random roll), so a real event lands its signature consequence — DeepSeek's
 * price war, a grid power crunch, the EU AI Act audit, a viral GPU melt. Returns
 * null for 'none' / structural single-lane-surge waves and for endless surges
 * (index past the campaign), where the random roll applies instead.
 */
export function themedIncidentForWave(index: number): string | null {
  const theme = CAMPAIGN_THEMES[index]
  return theme ? themedIncidentId(theme.special) : null
}

/* ------------------------------------------------------------------ *
 *  TECH TREE — four competing paths sharing Cash + Data.             *
 * ------------------------------------------------------------------ */

/**
 * §6.6: cash costs were authored for the old flat-points economy; in the real
 * credit economy (racks = capex/1000) they are rescaled so an upgrade is on the
 * order of a mid rack, not 10× one. Data costs are unchanged (a separate currency).
 */
const UPGRADE_CASH_SCALE = 0.25

// P3c: the serving cash upgrades (scale_*/eff_*/prod_*) migrated into the typed
// s.infra research tree. P3d: the SAFETY cash upgrades (saf_rlhf / saf_redteam) are
// ALSO gone — RLHF is a Studio post-training METHOD (P3b; safety alignment is now
// per-model) and red-teaming is a dev-time EVAL on the eval track (§3.6, below), not
// a per-request serving knob. There are no cash UPGRADES left this phase.
const UPGRADE_DEFS_RAW: UpgradeDef[] = []

/** Upgrades with cash costs rescaled into the real credit economy (§6.6). */
export const UPGRADES: UpgradeDef[] = UPGRADE_DEFS_RAW.map((u) => ({
  ...u,
  cashCost: Math.max(1, Math.round(u.cashCost * UPGRADE_CASH_SCALE)),
}))

export const UPGRADE_MAP: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]))

export const TECH_PATHS = [
  { id: 'scale', name: 'Scale', color: COLORS.danger, theme: 'Bigger models, more throughput.' },
  { id: 'efficiency', name: 'Efficiency', color: COLORS.cooling, theme: 'Do more with less power.' },
  { id: 'safety', name: 'Safety', color: 0xff6b9d, theme: 'Resist abuse, keep Trust.' },
  { id: 'product', name: 'Product', color: COLORS.warn, theme: 'Routing, cache, system design.' },
] as const

/* ------------------------------------------------------------------ *
 *  INCIDENTS — between-wave events that force adaptation.             *
 * ------------------------------------------------------------------ */

export const INCIDENTS: IncidentDef[] = [
  /* --- single-entry surges: a cable cut / outage funnels the wave's un-pinned
   *     traffic through ONE randomly-chosen ingress (concentrate), so local
   *     capacity at that lane decides the run (§ network reroute). --- */
  {
    id: 'inc_cable_cut',
    name: 'Undersea Cable Severed',
    icon: '🪢',
    concentrate: 1,
    mods: { volume: 1.15 },
    desc: 'A trans-regional submarine cable is cut. Surviving links cannot spread the load — every request funnels through a single ingress this wave.',
  },
  {
    id: 'inc_cloudflare_outage',
    name: 'Edge Provider Outage',
    icon: '🌩',
    concentrate: 1,
    mods: { volume: 1.3 },
    desc: 'A shared CDN/edge provider fails, then recovers into a retry thundering-herd. Traffic collapses onto one front door, then surges.',
  },
  {
    id: 'inc_crowdstrike',
    name: 'Global IT Meltdown',
    icon: '💾',
    concentrate: 1,
    mods: { volume: 1.2 },
    desc: 'A faulty vendor update bricks fleets worldwide; all traffic reroutes to the surviving region, spiking load on one ingress.',
  },
  /* --- power-price spikes (powerPrice ↑): the operating bill bites harder. --- */
  {
    id: 'inc_pjm_capacity',
    name: 'Capacity Auction Shock',
    icon: '⚡',
    mods: { powerPrice: 1.9 },
    desc: 'The grid capacity auction clears near its cap. Your wholesale power bill jumps and every kW costs more this wave.',
  },
  {
    id: 'inc_gas_turbine_spike',
    name: 'On-Site Fuel Spike',
    icon: '🔥',
    mods: { powerPrice: 1.6 },
    desc: 'On-site gas turbines run flat-out to outrun the grid queue; volatile fuel pricing inflates power cost this wave.',
  },
  {
    id: 'inc_nuclear_ppa',
    name: 'Firm Nuclear PPA Signed',
    icon: '☢',
    good: true,
    mods: { powerPrice: 0.6 },
    desc: 'A long-term nuclear power-purchase agreement locks in cheap firm baseload. Power costs fall this wave.',
  },
  /* --- cooling shortfalls (coolingCap ↓): dense racks throttle. --- */
  {
    id: 'inc_cooling_failure',
    name: 'Liquid Loop Fault',
    icon: '🌡',
    mods: { coolingCap: 0.55 },
    desc: 'A coolant-distribution fault cuts heat-rejection headroom; dense racks throttle until the plumbing recovers.',
  },
  {
    id: 'inc_water_drought',
    name: 'Water-Use Restriction',
    icon: '🚱',
    mods: { coolingCap: 0.65 },
    desc: 'Drought and disclosure rules curb evaporative cooling. Cooling capacity is constrained this wave.',
  },
  /* --- supply / capex shocks (buildCost ↑/↓): racks cost more (or less). --- */
  {
    id: 'inc_h100_shortage',
    name: 'H100 Allocation Crunch',
    icon: '📦',
    mods: { buildCost: 1.8 },
    desc: 'Lead times blow out to 6-11 months; you cannot buy your way out. New rack builds cost far more this wave.',
  },
  {
    id: 'inc_hbm_soldout',
    name: 'HBM Sold Out',
    icon: '🧱',
    mods: { buildCost: 1.6 },
    desc: 'HBM stacks are the gating component and they are sold out. Rack capex spikes this wave.',
  },
  {
    id: 'inc_export_ban',
    name: 'Chip Export Ban',
    icon: '🚫',
    mods: { buildCost: 2.0 },
    desc: 'New export controls close the compliant high-end supply. Accelerators are scarce and build costs surge this wave.',
  },
  {
    id: 'inc_lead_times_ease',
    name: 'Lead Times Ease',
    icon: '📉',
    good: true,
    mods: { buildCost: 0.7 },
    desc: 'CoWoS and HBM capacity ramp; competing parts ship. Rack builds are cheaper this wave.',
  },
  /* --- token-price / revenue shocks (reward ↓): margins collapse. --- */
  {
    id: 'inc_price_war',
    name: 'Token Price War',
    icon: '💸',
    mods: { reward: 0.6 },
    desc: 'A rival collapses token prices. Revenue per request drops this wave — only near-100% utilization stays profitable.',
  },
  {
    id: 'inc_market_shock',
    name: 'DeepSeek Market Shock',
    icon: '📊',
    mods: { reward: 0.7 },
    desc: 'Markets reprice the GPU-capex thesis overnight. Token revenue dips this wave as customers chase cheap open reasoning.',
  },
  /* --- regulatory / safety pressure (safetyDamage ↑): leaks hurt more. --- */
  {
    id: 'inc_regulatory_audit',
    name: 'Regulatory Audit',
    icon: '📋',
    mods: { safetyDamage: 1.6 },
    desc: 'A regulator demands logging, eval and incident reporting. An unsafe answer that slips through costs far more Trust this wave.',
  },
  {
    id: 'inc_jailbreak_storm',
    name: 'Adversarial Suffix Storm',
    icon: '☠',
    mods: { safetyDamage: 1.8 },
    desc: 'Machine-optimized transferable jailbreaks flood in. Every unsafe answer that slips through wrecks Trust harder this wave.',
  },
  /* --- data-integrity hits (instant Data loss at telegraph). --- */
  {
    id: 'inc_data_poisoning',
    name: 'Training-Data Poisoning',
    icon: '🧪',
    mods: {},
    desc: 'Poisoned documents seeded a backdoor in your corpus; you purge the tainted data and lose a chunk of stored Data.',
    instant: (s) => {
      s.data = Math.max(0, Math.floor(s.data * 0.5))
    },
  },
  {
    id: 'inc_contamination',
    name: 'Eval Set Contamination',
    icon: '🦠',
    mods: {},
    desc: 'Benchmark contamination is discovered; you must re-derive quality from clean data, losing accumulated Data.',
    instant: (s) => {
      s.data = Math.max(0, Math.floor(s.data * 0.6))
    },
  },
  /* --- good fortune (banner glows green): a surge you can profit from, or a boon. --- */
  {
    id: 'inc_viral_ghibli',
    name: 'Viral Demand Surge',
    icon: '📈',
    mods: { volume: 1.4, reward: 1.2 },
    desc: 'A feature goes viral — "the GPUs are melting." Request volume explodes far past provisioned capacity, but each clean serve pays more.',
  },
  {
    id: 'inc_enterprise_demo',
    name: 'Enterprise Demo Day',
    icon: '🤝',
    good: true,
    mods: { reward: 1.5 },
    desc: 'A flagship enterprise pilot lands. Clean serves pay a premium this wave — but a single SLO miss is very visible.',
  },
  {
    id: 'inc_demand_lull',
    name: 'Off-Peak Demand Lull',
    icon: '🌙',
    good: true,
    mods: { volume: 0.7 },
    desc: 'A holiday / overnight lull — request volume dips well below peak this wave. A breather to catch up on capacity and research.',
  },
]
