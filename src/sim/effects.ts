import {
  ALLREDUCE_US,
  ALLTOALL_US,
  COHORT_STREAMS,
  ENGINE_MAX_STREAMS,
  CREDIT_USD,
  FLASH_ACTIVATION_CREDIT_GB,
  FLASH_KV_READ_GAIN,
  FLASH_PREFILL_GAIN,
  FRAMEWORK_GB,
  IDLE_POWER_FRAC,
  LONGCTX_FILL_FREE,
  LONGCTX_MAX_PENALTY,
  LONGCTX_SKILL_RELIEF,
  MAX_TP,
  MBU_DECODE,
  MFU_DECODE,
  MFU_PREFILL,
  MOE_SHARED_FRAC,
  MULTISTEP_STEPS,
  OFFLOAD_HIT_BONUS,
  OFFLOAD_HIT_CAP,
  PCIE_RELOAD_GBPS,
  POWER_USD_PER_KWH,
  PP_BUBBLE_MS,
  PP_HOP_US,
  PUE_AIR,
  PUE_LIQUID,
  RACK_UTILIZATION,
  RACKS_PER_TILE,
  RADIX_HIT_BONUS,
  RADIX_HIT_CAP,
  SIM_TIME_SCALE,
  SPEC_DRAFT_TOKENS,
  SPEC_DRAFT_VRAM_FRAC,
  SPEC_DRAFT_VRAM_MIN_GB,
  STEP_OVERHEAD_MS,
  TP_EFFICIENCY,
  TRAFFIC_SCALE,
  TRTLLM_KERNEL_GAIN,
} from '../config'
import type {
  AnswerMode,
  CapabilityAxis,
  GameState,
  ModelDef,
  RequestTypeDef,
  ServerHardwareDef,
  ServerSpec,
  Tower,
  TowerDef,
  WeightFormat,
} from '../core/types'
import { HARDWARE_DEFS, MODEL_DEFS } from './content'
import { resolveModel } from './models'
import { alignmentTax } from './safety'

export { resolveModel }
export type { WeightFormat }

/** Owned level of an upgrade (0 if not bought). */
export function lvl(s: GameState, id: string): number {
  return s.upgrades[id] ?? 0
}

/**
 * A compact fingerprint of every researched switch that changes serving physics (weight
 * formats, parallelism, KV, scheduling, decoding, engine). UI caches key on it so a
 * readout re-derives exactly when the numbers behind it can have moved.
 */
export function servingStackKey(s: GameState): string {
  const i = s.infra
  const b = (v: boolean): string => (v ? '1' : '0')
  return (
    b(i.quant.fp8) +
    b(i.quant.int4) +
    b(i.quant.nvfp4) +
    b(i.par.tp) +
    b(i.par.pp) +
    b(i.par.dp) +
    b(i.par.ep) +
    b(i.scheduling.batch) +
    b(i.scheduling.chunked) +
    i.scheduling.multiStep +
    b(i.spec.enabled) +
    i.engineTier +
    i.kv.flash +
    '|' +
    i.kv.quantBytes +
    '|' +
    i.kv.utilization +
    '|' +
    i.kv.offloadGb +
    b(i.disagg) +
    b(i.loraSlots > 0)
  )
}

/**
 * A server's serving stack: the rack hardware, the deployed model and the weight format
 * it is served in. Hardware, model and precision all live on the Tower instance
 * (upgradable / swappable / switchable); the TowerDef only describes what ships.
 */
export interface Loadout {
  hw: ServerHardwareDef | null
  model: ModelDef | null
  /** the rack's chosen weight format; undefined = auto (the best researched one that costs no quality). */
  precision?: WeightFormat
}

/** The live loadout of a placed server. Resolves derived checkpoints via `resolveModel`. */
export function loadoutOf(s: GameState, t: Tower): Loadout {
  return {
    hw: t.hwId ? (HARDWARE_DEFS[t.hwId] ?? null) : null,
    model: t.modelId ? resolveModel(s, t.modelId) : null,
    precision: t.precision,
  }
}

/** Build-bar preview: the rack as it ships (default model included). */
export function defLoadout(def: TowerDef): Loadout {
  return {
    hw: def.hardwareId ? (HARDWARE_DEFS[def.hardwareId] ?? null) : null,
    model: def.defaultModelId ? (MODEL_DEFS[def.defaultModelId] ?? null) : null,
  }
}

export function loadout(
  s: GameState,
  hwId: string | undefined,
  modelId: string | undefined,
  precision?: WeightFormat,
): Loadout {
  return {
    hw: hwId ? (HARDWARE_DEFS[hwId] ?? null) : null,
    model: modelId ? resolveModel(s, modelId) : null,
    precision,
  }
}

export function serverSpec(lo: Loadout): ServerSpec {
  return lo.model?.spec ?? 'general'
}

/**
 * §4.10 the full weights a checkpoint runs on: a LoRA / DoRA / QLoRA adapter is a few
 * low-rank matrices on top of its base, so it resolves to that base's weights (recursively);
 * every other checkpoint is its own weights.
 */
export function adapterRoot(s: GameState, model: ModelDef): string {
  let m = model
  for (let depth = 0; depth < 32 && m.lineage?.relation === 'adapter'; depth++) {
    const base = resolveModel(s, m.lineage.baseModelIds[0])
    if (!base) break
    m = base
  }
  return m.id
}

/**
 * §4.10 Multi-LoRA serving (S-LoRA / Punica): two checkpoints that share the same base
 * weights — a base and its adapters, or two adapters of one base — are co-resident on a rack,
 * so switching between them is an adapter swap, not a weight reload (it can happen mid-wave).
 * Needs the Multi-LoRA research.
 */
export function loraSiblings(
  s: GameState,
  a: ModelDef | null | undefined,
  b: ModelDef | null | undefined,
): boolean {
  if (!a || !b || s.infra.loraSlots <= 0 || a.id === b.id) return false
  if (a.lineage?.relation !== 'adapter' && b.lineage?.relation !== 'adapter') return false
  return adapterRoot(s, a) === adapterRoot(s, b)
}

/**
 * Method gating is GONE in P3c: MoE/Reasoning are MODEL attributes, not tech
 * nodes (R4/§4). A sparse model deploys whenever its (large) weights fit VRAM —
 * naturally gated by needing a big rack; a thinking model's gain is already in
 * its benchmarked `qualityBy`. So every model whose VRAM fits is deployable.
 * Kept as an always-true seam so deploy/UI call sites stay stable.
 */
export function methodsUnlocked(_s: GameState, _model: ModelDef): boolean {
  return true
}

/* ------------------------------------------------------------------ *
 *  WEIGHT FORMATS (§4.5) — chosen PER RACK among the researched ones.   *
 *    bf16  2 B/param · the BF16 tensor rate                            *
 *    fp8   1 B/param · the FP8 rate (W8A8) · effectively lossless       *
 *    int4  ≈0.53 B/param (4 bits + group scales) · the BF16 rate (W4A16 *
 *          dequantizes for its GEMMs) · −2 quality, −6 above 8K tokens  *
 *    nvfp4 ≈0.56 B/param (4 bits + an FP8 scale per 16) · the FP4 rate  *
 *          (W4A4, Blackwell Tensor Cores only) · −1, −2 above 8K tokens *
 *  A checkpoint released at low precision stays at its native bytes and *
 *  pays no tax there (it was benchmarked that way). Auto = the fastest  *
 *  researched format that costs no quality and fits.                   *
 * ------------------------------------------------------------------ */

export const WEIGHT_FORMATS: readonly WeightFormat[] = ['bf16', 'fp8', 'int4', 'nvfp4']
const FORMAT_BYTES: Record<WeightFormat, number> = { bf16: 2, fp8: 1, int4: 0.53, nvfp4: 0.5625 }
/** Flat PTQ quality tax and the long-context (>8K tokens) tax of a format that quantizes below the release precision. */
const PTQ_TAX: Record<WeightFormat, { flat: number; longCtx: number }> = {
  bf16: { flat: 0, longCtx: 0 },
  fp8: { flat: 0, longCtx: 0 },
  int4: { flat: 2, longCtx: 6 },
  nvfp4: { flat: 1, longCtx: 2 },
}
const NO_TAX = { flat: 0, longCtx: 0 } as const
/** Above this many tokens a 4-bit PTQ checkpoint loses extra quality (its real weak spot). */
const PTQ_LONGCTX_TOKENS = 8000
/** INT4 KV cache: above this many tokens the quantized cache costs a little accuracy (KIVI / KVQuant). */
const KV_INT4_LONGCTX_TOKENS = 32000
const KV_INT4_LONGCTX_TAX = 2

/** Precision class (bits per weight) of a bytes/param figure: 16-bit, 8-bit or 4-bit (block scales included). */
function precisionBits(bytesPerParam: number): 16 | 8 | 4 {
  return bytesPerParam >= 1.5 ? 16 : bytesPerParam >= 0.75 ? 8 : 4
}

/** Blackwell racks (B200 / GB200) carry FP4 Tensor Cores — the only home of NVFP4. */
export function isBlackwell(hw: ServerHardwareDef | null | undefined): boolean {
  return (hw?.fp4TflopsPerGpu ?? 0) > 0
}

/** Has the fleet researched this weight format? (BF16 is the baseline.) */
export function formatResearched(s: GameState, fmt: WeightFormat): boolean {
  return fmt === 'bf16' || s.infra.quant[fmt]
}

/**
 * The format a checkpoint was RELEASED in, as this hardware runs it: BF16, FP8, or a 4-bit
 * release (MXFP4 / INT4-QAT / FP4) — on FP4 Tensor Cores where the rack has them, else
 * dequantized for BF16 GEMMs. A model always runs in its own release format, no research needed.
 */
export function nativeFormat(model: ModelDef, hw: ServerHardwareDef | null | undefined): WeightFormat {
  const bits = precisionBits(model.nativeWeightBytes)
  return bits === 16 ? 'bf16' : bits === 8 ? 'fp8' : isBlackwell(hw) ? 'nvfp4' : 'int4'
}

/**
 * Can a rack of this hardware serve in this format: researched (FP4 also needs Blackwell
 * hardware), or the model's own release format.
 */
export function formatAvailable(
  s: GameState,
  hw: ServerHardwareDef | null | undefined,
  fmt: WeightFormat,
  model?: ModelDef | null,
): boolean {
  if (model && nativeFormat(model, hw) === fmt) return true
  if (!formatResearched(s, fmt)) return false
  return fmt !== 'nvfp4' || isBlackwell(hw)
}

/** The formats a rack of this hardware may be set to (for this model when given). */
export function availableFormats(
  s: GameState,
  hw: ServerHardwareDef | null | undefined,
  model?: ModelDef | null,
): WeightFormat[] {
  return WEIGHT_FORMATS.filter((f) => formatAvailable(s, hw, f, model))
}

/** Resident bytes per weight param in a format: the release precision is never inflated. */
function residentBytes(model: ModelDef, fmt: WeightFormat): number {
  return Math.min(model.nativeWeightBytes, FORMAT_BYTES[fmt])
}

/** Does serving this model in this format quantize it BELOW its release precision (post-training quantization)? */
export function formatQuantizes(model: ModelDef, fmt: WeightFormat): boolean {
  return precisionBits(residentBytes(model, fmt)) < precisionBits(model.nativeWeightBytes)
}

/**
 * The quality this format costs this checkpoint: nothing at or above its release precision
 * (it was benchmarked that way) and nothing for FP8 (effectively lossless, ACL'25); a 4-bit
 * PTQ of a 16/8-bit release pays a flat tax plus a long-context one.
 */
export function formatQualityTax(model: ModelDef, fmt: WeightFormat): { flat: number; longCtx: number } {
  return formatQuantizes(model, fmt) ? PTQ_TAX[fmt] : NO_TAX
}

/** A format that costs this checkpoint no quality at all (what auto may pick). */
export function formatLossless(model: ModelDef, fmt: WeightFormat): boolean {
  const t = formatQualityTax(model, fmt)
  return t.flat === 0 && t.longCtx === 0
}

/** Dense tensor rate per GPU (TFLOPS) the format's GEMMs run at: its ACTIVATION precision. */
function formatTflopsPerGpu(hw: ServerHardwareDef, fmt: WeightFormat): number {
  switch (fmt) {
    case 'fp8':
      return hw.fp8TflopsPerGpu
    case 'nvfp4':
      return hw.fp4TflopsPerGpu > 0 ? hw.fp4TflopsPerGpu : hw.fp8TflopsPerGpu
    default:
      return hw.bf16TflopsPerGpu // bf16, and int4 W4A16 (weights dequantize to BF16)
  }
}

/** Ranking key for auto: the faster tensor rate first, then the smaller weights. */
function formatRank(hw: ServerHardwareDef | null, model: ModelDef, fmt: WeightFormat): number {
  const rate = hw ? formatTflopsPerGpu(hw, fmt) : fmt === 'fp8' ? 2 : 1
  return rate * 10 - residentBytes(model, fmt)
}

/**
 * The format a rack serves its model in: the rack's explicit setting when it is still
 * available there, otherwise auto — the fastest researched format that costs no quality,
 * preferring one that fits (a model that fits only in a lossy format needs an explicit
 * setting: the player chooses to pay that quality).
 */
export function servingFormat(s: GameState, lo: Loadout): WeightFormat {
  if (lo.precision && formatAvailable(s, lo.hw, lo.precision, lo.model)) return lo.precision
  return autoFormat(s, lo.hw, lo.model)
}

/** The auto format for a model on a hardware tier (see servingFormat). */
export function autoFormat(s: GameState, hw: ServerHardwareDef | null, model: ModelDef | null): WeightFormat {
  if (!model) return 'bf16'
  const cands = availableFormats(s, hw, model)
    .filter((f) => formatLossless(model, f))
    .sort((a, b) => formatRank(hw, model, b) - formatRank(hw, model, a))
  if (!hw) return cands[0] ?? 'bf16'
  return cands.find((f) => planFor(s, hw, model, f).fits) ?? cands[0] ?? 'bf16'
}

/** Resident bytes per weight param on this rack (VRAM, the decode bandwidth term). */
export function bytesPerParam(s: GameState, lo: Loadout): number {
  return lo.model ? residentBytes(lo.model, servingFormat(s, lo)) : 0
}

/**
 * A lossy post-training quantization below the checkpoint's NATIVE precision on this rack:
 * only a 4-bit format on a model released (and benchmarked) at 8 or 16 bits. A natively
 * 4-bit release — gpt-oss's MXFP4, an INT4-QAT checkpoint, DeepSeek-V4's FP4 experts, a
 * Studio QAT run — pays nothing in a 4-bit format; FP8 is effectively lossless (ACL'25).
 */
export function ptqBelowNative(s: GameState, lo: Loadout): boolean {
  return !!lo.model && !formatLossless(lo.model, servingFormat(s, lo))
}

/* ------------------------------------------------------------------ *
 *  MODEL-PARALLEL GROUPS (§4.7) — a multi-GPU rack is not one perfect   *
 *  accelerator. A model copy spans the smallest power-of-two group of   *
 *  GPUs whose HBM holds it; the rack's remaining GPUs run more copies.  *
 *    · per-stream speed is that group's: tensor parallelism splits a    *
 *      layer over ≤ 8 GPUs at an efficiency < 1 plus an all-reduce      *
 *      floor per layer; GPUs beyond 8 (pipeline stages) add memory and  *
 *      pipelined concurrency, never per-user speed;                     *
 *    · copies (replicas) add concurrency, never per-user speed.         *
 *  Research: before Tensor Parallelism a model must fit ONE GPU; TP     *
 *  lets a copy span up to 8; Pipeline Parallelism beyond 8.             *
 * ------------------------------------------------------------------ */

export interface ParallelPlan {
  /** a copy fits an allowed group (else not deployable on this rack). */
  fits: boolean
  /** why it does not fit: 'vram' (no group on this rack holds it), or the parallelism research it needs. */
  blocker: 'vram' | 'tp' | 'pp' | null
  /** GPUs per model copy (a power of two). */
  g: number
  /** tensor-parallel degree a stream is split across: min(g, 8). */
  tpDeg: number
  /** pipeline stages per copy (g / 8 beyond 8 GPUs). */
  stages: number
  /** model copies on the rack. */
  replicas: number
  /** independent decode lanes = replicas × pipeline stages (pipelined microbatches). */
  lanes: number
  /** the weight format the plan serves in. */
  format: WeightFormat
  /** resident weights of ONE copy (GB). */
  weightGb: number
  /** speculative-decoding draft head per copy (GB). */
  draftGb: number
  /** usable KV memory of ONE copy (GB): (group HBM − weights − draft − framework) × allocator utilization. */
  kvGbPerReplica: number
}

const NO_PLAN: ParallelPlan = {
  fits: false,
  blocker: 'vram',
  g: 1,
  tpDeg: 1,
  stages: 1,
  replicas: 0,
  lanes: 0,
  format: 'bf16',
  weightGb: 0,
  draftGb: 0,
  kvGbPerReplica: 0,
}

/** Per-GPU runtime overhead before KV (framework, CUDA graphs, activations; FlashAttention saves some). */
export function frameworkGbPerGpu(s: GameState): number {
  return FRAMEWORK_GB - (s.infra.kv.flash > 0 ? FLASH_ACTIVATION_CREDIT_GB : 0)
}

/** The parallel plan of a model on a hardware tier in a given format. */
function planFor(s: GameState, hw: ServerHardwareDef, model: ModelDef, format: WeightFormat): ParallelPlan {
  const weightGb = model.paramsTotalB * residentBytes(model, format)
  const draftGb = s.infra.spec.enabled ? Math.max(SPEC_DRAFT_VRAM_MIN_GB, SPEC_DRAFT_VRAM_FRAC * weightGb) : 0
  const fw = frameworkGbPerGpu(s)
  let need = 0
  for (let g = 1; g <= hw.gpus; g *= 2) {
    if (weightGb + draftGb + g * fw < g * hw.hbmGbPerGpu) {
      need = g
      break
    }
  }
  if (!need) return { ...NO_PLAN, format, weightGb, draftGb }
  const maxG = !s.infra.par.tp ? 1 : !s.infra.par.pp ? Math.min(MAX_TP, hw.gpus) : hw.gpus
  if (need > maxG)
    return { ...NO_PLAN, blocker: need <= MAX_TP ? 'tp' : 'pp', format, weightGb, draftGb, g: need }
  const tpDeg = Math.min(need, MAX_TP)
  const stages = need / tpDeg
  const replicas = Math.floor(hw.gpus / need)
  const kvGbPerReplica = (need * hw.hbmGbPerGpu - weightGb - draftGb - need * fw) * s.infra.kv.utilization
  return {
    fits: true,
    blocker: null,
    g: need,
    tpDeg,
    stages,
    replicas,
    lanes: replicas * stages,
    format,
    weightGb,
    draftGb,
    kvGbPerReplica,
  }
}

/** The rack's parallel plan for its deployed model and weight format. */
export function rackPlan(s: GameState, lo: Loadout): ParallelPlan {
  if (!lo.hw || !lo.model) return NO_PLAN
  return planFor(s, lo.hw, lo.model, servingFormat(s, lo))
}

/** Resident weight memory of one model copy in GB = paramsTotalB × bytesPerParam (§5.6; MoE = all experts resident). */
export function serverModelMemory(s: GameState, lo: Loadout): number {
  return lo.model ? lo.model.paramsTotalB * bytesPerParam(s, lo) : 0
}

/** A copy of the weights + draft + per-GPU framework fits an allowed GPU group of the rack (§6.2, §4.7). */
export function serverFitsMemory(s: GameState, lo: Loadout): boolean {
  return rackPlan(s, lo).fits
}

/** Deployable right now: the weights fit an allowed group AND the model's methods are unlocked. */
export function serverDeployable(s: GameState, lo: Loadout): boolean {
  return !!lo.model && serverFitsMemory(s, lo) && methodsUnlocked(s, lo.model)
}

/**
 * Why a model cannot deploy on a rack (null = it can): 'vram' — no GPU group on this rack
 * holds the weights; 'tp' — it would span GPUs of this rack but needs Tensor Parallelism;
 * 'pp' — it needs more than 8 GPUs and Pipeline Parallelism.
 */
export function deployBlocker(s: GameState, lo: Loadout): 'vram' | 'tp' | 'pp' | null {
  if (!lo.hw || !lo.model) return 'vram'
  return rackPlan(s, lo).blocker
}

/* ------------------------------------------------------------------ *
 *  ANSWER QUALITY (§6.4) — the model's per-axis aptitude, minus the     *
 *  costs the serving choices impose (PTQ, alignment, long context).    *
 * ------------------------------------------------------------------ */

/** The flat quality tax this rack's weight format costs its model. */
export function ptqTax(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  const fmt = servingFormat(s, lo)
  return formatQualityTax(lo.model, fmt).flat
}

/* ------------------------------------------------------------------ *
 *  THINKING MODE (§1.4) — the engine's per-request policy. A hybrid    *
 *  checkpoint has thinking switched off for interactive traffic (the   *
 *  serving stack's enable_thinking=False): it answers chat, code       *
 *  completion and the jailbreak probes riding that traffic at once,    *
 *  with its instant-mode capability; everything else it thinks about.  *
 * ------------------------------------------------------------------ */

/**
 * The mode a model answers one request of this archetype in: a 'never' model and a prompt-only
 * request (an embedding generates no text) are instant, an 'always' model thinks, and a hybrid
 * answers interactive traffic (latency class IN) instantly and thinks about everything else.
 */
export function answerMode(model: ModelDef, def: Pick<RequestTypeDef, 'latClass' | 'outputTokens'>): AnswerMode {
  if (model.thinking === 'never' || def.outputTokens <= 0) return 'instant'
  if (model.thinking === 'always') return 'thinking'
  return def.latClass === 'IN' ? 'instant' : 'thinking'
}

/**
 * The capability vector an answer in this mode is judged with: a hybrid's instant answers use
 * its instant-mode vector; every other answer (and every single-mode model) its `qualityBy`.
 */
export function qualityIn(model: ModelDef, mode: AnswerMode): Record<CapabilityAxis, number> {
  return mode === 'instant' && model.qualityByInstant ? model.qualityByInstant : model.qualityBy
}

/**
 * Correctness on one traffic axis: the checkpoint's benchmarked aptitude in the answer's mode
 * (`qualityBy` — thinking capability for a thinker — unless `mode` asks for a hybrid's instant
 * one), minus the PTQ tax of the rack's weight format and the §3.2 alignment tax (an aligned
 * model trades capability for safety; a safe-completion model pays less — the §3.1 Pareto point).
 */
export function serverQualityVs(s: GameState, lo: Loadout, axis: ServerSpec, mode: AnswerMode = 'thinking'): number {
  if (!lo.model) return 0
  return qualityIn(lo.model, mode)[axis] - ptqTax(s, lo) - alignmentTax(lo.model)
}

/** Peak correctness (the model's specialty axis) — what the dashboards show. */
export function serverQuality(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  return serverQualityVs(s, lo, lo.model.spec)
}

/**
 * The hard context window in REAL TOKENS: a sequence (prompt + the answer it will
 * produce) longer than the model's trained window cannot be served AT ALL (§1.2).
 */
export function serverCtxWindowTokens(_s: GameState, lo: Loadout): number {
  return lo.model ? lo.model.contextWindowK * 1000 : 0
}

/**
 * §1.2 the quality a long sequence costs on this rack, in quality points:
 *   · window fill — none below LONGCTX_FILL_FREE of the window, then rising to
 *     LONGCTX_MAX_PENALTY × (1 − LONGCTX_SKILL_RELIEF × longCtx) at a full window, so a
 *     1M-window model with strong long-context skill barely notices a 100K prompt that
 *     a 128K model struggles with;
 *   · a 4-bit PTQ format's long-context weak spot (above 8K tokens);
 *   · an INT4 KV cache's small loss above 32K tokens.
 */
export function longContextPenalty(s: GameState, lo: Loadout, contextLen: number): number {
  return lo.model ? longContextPenaltyFor(s, lo.model, servingFormat(s, lo), contextLen) : 0
}

/** `longContextPenalty` for a model already resolved to its serving format (the combat hot path). */
export function longContextPenaltyFor(
  s: GameState,
  m: ModelDef,
  fmt: WeightFormat,
  contextLen: number,
): number {
  const window = m.contextWindowK * 1000
  const fill = window > 0 ? contextLen / window : 1
  const ramp = Math.min(1, Math.max(0, (fill - LONGCTX_FILL_FREE) / (1 - LONGCTX_FILL_FREE)))
  let pen = LONGCTX_MAX_PENALTY * (1 - LONGCTX_SKILL_RELIEF * m.longCtx) * ramp ** 1.5
  if (contextLen > PTQ_LONGCTX_TOKENS) pen += formatQualityTax(m, fmt).longCtx
  if (contextLen > KV_INT4_LONGCTX_TOKENS && s.infra.kv.quantBytes <= 0.5) pen += KV_INT4_LONGCTX_TAX
  return pen
}

/* ------------------------------------------------------------------ *
 *  KV CACHE (§5.6) — the concurrency budget.                            *
 * ------------------------------------------------------------------ */

/**
 * KV-cache footprint (GB) of ONE stream at a given REAL sequence length:
 *   kv = kvBytesPerToken × contextLen × (quantBytes / 2) + kvStateMbPerReq
 * `kvBytesPerToken` is BF16 and architecture-true (config.json → data/model-arch.json):
 * MLA stores one latent + rope per layer, CSA/HCA a compressed entry, and the sliding-
 * window and linear/SSM layers of a hybrid none — their bounded windows and recurrent
 * state are `kvStateMbPerReq`. KV-quant research (FP16 = 2 → FP8 = 1 → INT4 0.5) narrows
 * the growing part.
 */
export function kvPerReqGb(s: GameState, model: ModelDef, contextLen: number): number {
  const growing = (model.kvBytesPerToken * Math.max(1, contextLen) * (s.infra.kv.quantBytes / 2)) / 1e9
  return growing + model.kvStateMbPerReq / 1000
}

/** The growing KV of `tokens` shared prefix tokens (GB) — what prefix sharing stores once. */
export function kvSharedGb(s: GameState, model: ModelDef, tokens: number): number {
  return (model.kvBytesPerToken * Math.max(0, tokens) * (s.infra.kv.quantBytes / 2)) / 1e9
}

/**
 * KV of a cohort of `streams` concurrent streams at `contextLen`, where `sharedTokens` of
 * every prompt is a prefix the streams share: prefix blocks are ref-counted and stored once
 * (vLLM APC / SGLang radix), so each extra stream adds only its unique part.
 */
export function cohortKvGb(
  s: GameState,
  model: ModelDef,
  contextLen: number,
  streams: number,
  sharedTokens = 0,
): number {
  if (streams <= 0) return 0
  const one = kvPerReqGb(s, model, contextLen)
  const shared = Math.min(kvSharedGb(s, model, sharedTokens), one)
  return one + (streams - 1) * (one - shared)
}

/**
 * KV memory utilization (§4.2): pre-PagedAttention allocators waste 60–80% of KV
 * memory (SOSP'23 measured 20–38% useful), paged block allocation recovers 96%.
 */
export function kvUtilization(s: GameState): number {
  return s.infra.kv.utilization
}

/** USABLE KV memory of the whole rack (GB): every copy's (group HBM − weights − draft − framework) × utilization. */
export function kvFreeGb(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  return p.fits ? p.replicas * p.kvGbPerReplica : 0
}

/* ------------------------------------------------------------------ *
 *  PREFILL (§1.1/§6.2) — compute-bound prompt ingestion, one prompt     *
 *  at a time per lane, super-linear in prompt length.                   *
 * ------------------------------------------------------------------ */

function tpEff(tpDeg: number): number {
  return TP_EFFICIENCY[tpDeg] ?? TP_EFFICIENCY[MAX_TP]
}

/** Engine kernel efficiency: TensorRT-LLM's compiled kernels run closer to the roof. */
function engineEff(s: GameState): number {
  return s.infra.engineTier === 2 ? TRTLLM_KERNEL_GAIN : 1
}

/**
 * Prefill rate (real tok/s) of ONE prompt of `inputTokens` on one lane of the rack:
 * the group's tensor rate at the format's activation precision × TP efficiency × MFU,
 * over 2 FLOPs per active param per token, with the O(n²) attention term
 * (FlashAttention softens it):
 *   superlinear(n) = 1 + n / (16000 × (1 + 0.5·flash))
 *   prefillTokS(n) = tflops × tpDeg × tpEff × MFU_PREFILL / (2 × activeB × superlinear(n))
 */
export function prefillTokS(s: GameState, lo: Loadout, inputTokens: number): number {
  return prefillRateOn(s, lo, rackPlan(s, lo), inputTokens)
}

/** `prefillTokS` on an already-computed parallel plan (the combat hot path). */
export function prefillRateOn(s: GameState, lo: Loadout, p: ParallelPlan, inputTokens: number): number {
  if (!p.fits || !lo.hw || !lo.model) return 0
  const flops =
    formatTflopsPerGpu(lo.hw, p.format) * 1e12 * p.tpDeg * tpEff(p.tpDeg) * engineEff(s) * MFU_PREFILL
  const superlinear = 1 + Math.max(0, inputTokens) / (16000 * (1 + FLASH_PREFILL_GAIN * s.infra.kv.flash))
  return flops / (2 * lo.model.paramsActiveB * 1e9 * superlinear)
}

/** The prefill rate combat runs a prompt at (alias kept for the UI mirrors). */
export function serverPrefillSpeed(s: GameState, lo: Loadout, inputTokens: number): number {
  return prefillTokS(s, lo, inputTokens)
}

/**
 * Extra TTFT a prompt pays on this rack beyond its prefill compute (seconds): the
 * pipeline bubble of a multi-stage copy, and the wait for the next scheduler call under
 * multi-step scheduling (new requests join a running batch only every N steps).
 */
export function admissionDelaySec(s: GameState, lo: Loadout, stepSec: number): number {
  const p = rackPlan(s, lo)
  const bubble = ((Math.max(1, p.stages) - 1) * PP_BUBBLE_MS) / 1000
  const multi = s.infra.scheduling.multiStep > 0 ? (MULTISTEP_STEPS / 2) * stepSec : 0
  return bubble + multi
}

/* ------------------------------------------------------------------ *
 *  DECODE (§5.7) — one step emits a token for every stream in a lane:   *
 *    step = max(t_mem, t_comp) + comm + overhead                       *
 *    t_mem  = (weights read + every stream's KV) / (group BW × MBU)     *
 *    t_comp = streams × 2 × activeB / (group FLOPS × MFU)               *
 *  so per-user tok/s = 1/step falls as the batch (and its contexts)    *
 *  grow, while aggregate = streams/step rises toward the compute roof. *
 *  An MoE reads only its active experts for one token, but a batch      *
 *  touches the union of everyone's experts: weights read climb from     *
 *  activeB toward totalB as the batch grows.                            *
 * ------------------------------------------------------------------ */

/** What one decode lane is carrying this step. */
export interface LaneLoad {
  /** concurrent streams in the lane (≥ 1 for the step math). */
  streams: number
  /** KV resident for those streams (GB) — every step re-reads it. */
  kvGb: number
  /** background prefill compute per step (seconds): the cohorts' other prompts being ingested. */
  bgPrefillSec: number
  /** chunked prefill / a decode-pool rack: prefill compute overlaps the memory-bound step instead of adding to it. */
  overlapPrefill: boolean
  /** streams on the whole rack (expert parallelism pools the experts across copies). */
  rackStreams?: number
  /** mean tokens a speculative step yields for these streams (by axis acceptance; 1 = no speculation). */
  specTokens?: number
  /** thermal throttle (1 = full clocks). */
  throttle?: number
}

export interface LaneStep {
  /** wall seconds of one decode step. */
  stepSec: number
  /** speculative decoding runs this step (the engine turns it off once it stops paying). */
  specOn: boolean
  /** the step's compute (the batch's GEMMs, verified drafts included) outlasts its HBM reads. */
  computeBound: boolean
}

/**
 * Speculative decoding (§4.4, EAGLE): mean tokens one verify step yields, by how
 * predictable the traffic is — code accepts the most drafts, open reasoning the fewest.
 */
const SPEC_TOKENS: Record<CapabilityAxis, number> = {
  coding: 2.4,
  chat: 2.0,
  general: 2.0,
  agentic: 1.9,
  reasoning: 1.7,
}

/** Tokens a speculative step yields on this axis (1 = speculative decoding not researched). */
export function specTokensFor(s: GameState, axis: CapabilityAxis): number {
  return s.infra.spec.enabled ? SPEC_TOKENS[axis] : 1
}

/**
 * Thermal throttling (Splitwise/ISCA'24): decode is memory-bound, so it keeps a SLIGHT
 * edge under a thermal cap — but only slight. ×0.85 makes the memory-bound part track
 * the cap closely (≈32% at the 0.2 floor, ≈58% at a half-throttle), while the compute-
 * bound parts (prefill, a compute-bound decode batch) take the full hit.
 */
export function decodeThrottle(throttle: number): number {
  return 1 - (1 - throttle) * 0.85
}

/**
 * §4.8 wide expert parallelism runs on this rack: an MoE served as several copies, with
 * Expert Parallelism researched, shards its experts across the copies and pools their batch.
 * (Inside one tensor-parallel copy every GPU already reads only its slice of each expert.)
 */
export function wideEp(s: GameState, m: ModelDef, p: ParallelPlan): boolean {
  return s.infra.par.ep && m.isMoE && m.paramsTotalB > m.paramsActiveB && p.replicas > 1
}

/**
 * Weights one decode step reads (GB): a dense model its weights; an MoE its always-on part
 * (attention, embeddings, shared experts — MOE_SHARED_FRAC of the active params) plus the
 * union of the routed experts its batch touches. Each token picks its own experts, so a batch
 * of b streams reads routedTotal × (1 − (1 − routedActive/routedTotal)^b) of them, climbing
 * from activeB toward totalB as the batch grows.
 */
function weightsReadGb(
  s: GameState,
  m: ModelDef,
  bytes: number,
  streams: number,
  p: ParallelPlan,
  rackStreams: number,
): number {
  if (!m.isMoE || m.paramsTotalB <= m.paramsActiveB) return m.paramsActiveB * bytes
  const shared = MOE_SHARED_FRAC * m.paramsActiveB
  const routedTotal = m.paramsTotalB - shared
  const f = (m.paramsActiveB - shared) / routedTotal
  const union = (b: number): number => routedTotal * (1 - (1 - f) ** Math.max(1, b))
  // wide EP: each copy holds 1/replicas of the experts and serves the whole rack's batch for
  // them, so it reads its share of the union that batch touches (DeepSeek's EP deployment).
  if (wideEp(s, m, p)) return (shared + union(Math.max(streams, rackStreams)) / p.replicas) * bytes
  return (shared + union(streams)) * bytes
}

/** Fixed per-step time (s): TP all-reduces, wide-EP all-to-alls, pipeline hops and the scheduler overhead. */
function stepFixedSec(s: GameState, m: ModelDef, p: ParallelPlan): number {
  let t = STEP_OVERHEAD_MS / (s.infra.scheduling.multiStep > 0 ? MULTISTEP_STEPS : 1) / 1000
  if (p.tpDeg > 1) t += 2 * m.layers * ALLREDUCE_US * 1e-6
  if (wideEp(s, m, p)) t += 2 * m.layers * ALLTOALL_US * 1e-6
  if (p.stages > 1) t += (p.stages - 1) * PP_HOP_US * 1e-6
  return t
}

/** One decode step of a lane of this rack (see the section header). */
export function laneStep(s: GameState, lo: Loadout, p: ParallelPlan, load: LaneLoad): LaneStep {
  const m = lo.model
  const hw = lo.hw
  if (!m || !hw || !p.fits) return { stepSec: Infinity, specOn: false, computeBound: false }
  const bytes = residentBytes(m, p.format)
  const eff = tpEff(p.tpDeg) * engineEff(s)
  const bw = hw.hbmTbsPerGpu * 1e12 * p.tpDeg * eff * MBU_DECODE
  const flops = formatTflopsPerGpu(hw, p.format) * 1e12 * p.tpDeg * eff * MFU_DECODE
  const b = Math.max(1, load.streams)
  const wGb = weightsReadGb(s, m, bytes, b, p, load.rackStreams ?? b)
  const kvRead = load.kvGb / (s.infra.kv.flash > 0 ? FLASH_KV_READ_GAIN : 1)
  const thr = Math.max(1e-3, load.throttle ?? 1)
  const dThr = decodeThrottle(thr)
  const tMem = ((wGb + kvRead) * 1e9) / bw / dThr
  const tComp = (b * 2 * m.paramsActiveB * 1e9) / flops / thr
  const bg = load.bgPrefillSec / thr
  const fixed = stepFixedSec(s, m, p)
  const combine = (mem: number, comp: number): number =>
    load.overlapPrefill ? Math.max(mem, comp + bg) : Math.max(mem, comp) + bg
  const plain = combine(tMem, tComp) + fixed
  const g = load.specTokens ?? 1
  if (g > 1) {
    // the draft head proposes SPEC_DRAFT_TOKENS tokens (a small extra read each), the
    // target verifies them all in one step: memory is shared, compute grows with the
    // drafts — so speculation pays at low batch and loses once the step turns compute-bound.
    const draft = (SPEC_DRAFT_TOKENS * SPEC_DRAFT_VRAM_FRAC * m.paramsActiveB * bytes * 1e9) / bw / dThr
    const verify = tComp * (SPEC_DRAFT_TOKENS + 1)
    const spec = combine(tMem + draft, verify) + fixed
    if (g / spec > 1 / plain) return { stepSec: spec, specOn: true, computeBound: verify >= tMem + draft }
  }
  return { stepSec: plain, specOn: false, computeBound: tComp >= tMem }
}

/* ------------------------------------------------------------------ *
 *  RACK-LEVEL ESTIMATES — the same lane math for a representative load  *
 *  (dashboards, the deploy picker, tests). Combat computes the live     *
 *  lanes from the sprites it actually admitted.                         *
 * ------------------------------------------------------------------ */

/** The representative sequence length (tokens) the headline speed figures assume. */
export const REF_CONTEXT_TOKENS = 2048

export interface RackLoadOptions {
  /** prompt / generated tokens of the archetype (background prefill per output token); default: no prefill load. */
  inputTokens?: number
  outputTokens?: number
  /** the judged axis (speculative acceptance); default chat. */
  axis?: CapabilityAxis
  /** prompt tokens served from the prefix cache (fewer to prefill; shared KV). */
  cachedTokens?: number
  /** thermal throttle; default 1. */
  throttle?: number
}

export interface RackLoadEstimate {
  /** request sprites assumed on the rack. */
  sprites: number
  /** concurrent streams those sprites place on the rack (each a cohort, capped by KV). */
  streams: number
  /** wall seconds of one decode step. */
  stepSec: number
  /** per-user decode tok/s of one stream. */
  perUserTokS: number
  /** the rack's aggregate decode tok/s (every stream on every lane). */
  aggTokS: number
  specOn: boolean
  /** the decode step is compute-bound at this load (else the HBM reads bind). */
  computeBound: boolean
  /** the cohort is short of COHORT_STREAMS streams because KV ran out. */
  kvLimited: boolean
}

/**
 * How a rack's scheduler splits its model copies (§4.7): with Data Parallelism (or a single
 * copy) the whole rack is ONE group — requests are load-balanced over every lane and the
 * pooled KV; without it each copy is its own group, and a request's cohort stays on the copy
 * it landed on.
 */
export interface SchedGroups {
  /** independent scheduling groups on the rack. */
  count: number
  /** decode lanes per group (copies × pipeline stages it spans). */
  lanes: number
  /** usable KV per group (GB). */
  kvGb: number
  /** request sprites one group batches. */
  slots: number
}

/**
 * Request sprites one decode lane batches: the engine's batch cap in cohorts with Continuous
 * Batching (ENGINE_MAX_STREAMS), one static batch before it. KV admits each further.
 */
export function spritesPerLane(s: GameState): number {
  return s.infra.scheduling.batch ? Math.max(1, Math.floor(ENGINE_MAX_STREAMS / COHORT_STREAMS)) : 1
}

export function schedGroups(s: GameState, p: ParallelPlan): SchedGroups {
  const perLane = spritesPerLane(s)
  if (s.infra.par.dp || p.replicas <= 1)
    return { count: 1, lanes: p.lanes, kvGb: p.replicas * p.kvGbPerReplica, slots: p.lanes * perLane }
  return { count: p.replicas, lanes: p.stages, kvGb: p.kvGbPerReplica, slots: p.stages * perLane }
}

/**
 * Streams of a cohort that fit `freeGb` of KV at `contextLen`, with `sharedTokens` of each
 * prompt stored once (prefix sharing): the first stream holds its whole sequence, every
 * further one only its unique part. 0 when not even one stream fits.
 */
export function cohortFit(
  s: GameState,
  model: ModelDef,
  contextLen: number,
  freeGb: number,
  sharedTokens = 0,
): number {
  const one = kvPerReqGb(s, model, contextLen)
  if (one > freeGb) return 0
  const extra = one - Math.min(kvSharedGb(s, model, sharedTokens), one)
  return extra <= 1e-12 ? COHORT_STREAMS : Math.min(COHORT_STREAMS, 1 + Math.floor((freeGb - one) / extra))
}

/**
 * §5.7 background prefill per decode step (seconds): a decoding cohort's OTHER streams
 * arrive and ingest their prompts over the answer they generate — (k − 1) unique prompts per
 * `outTokens` steps, at the lane's prefill rate. Combat runs the leader's own prompt as the
 * request's TTFT; a steady-state estimate passes `withLeader` to spread all k prompts.
 */
export function cohortPrefillSec(
  s: GameState,
  lo: Loadout,
  p: ParallelPlan,
  k: number,
  tokensIn: number,
  sharedTokens: number,
  outTokens: number,
  withLeader = false,
): number {
  const prompts = withLeader ? k : k - 1
  if (prompts <= 0 || outTokens <= 0) return 0
  const rate = prefillRateOn(s, lo, p, tokensIn)
  return rate > 0 ? (prompts * Math.max(0, tokensIn - sharedTokens)) / outTokens / rate : 0
}

/**
 * Serve `sprites` sprites of one archetype at `contextLen` on this rack, placed the way the
 * scheduler places them (one group, or one copy each without Data Parallelism): each brings
 * a COHORT_STREAMS-stream cohort while the group's KV lasts. The estimate reports the
 * busiest group — the speed its users see.
 */
export function rackLoadEstimate(
  s: GameState,
  lo: Loadout,
  sprites: number,
  contextLen = REF_CONTEXT_TOKENS,
  opt: RackLoadOptions = {},
): RackLoadEstimate {
  const p = rackPlan(s, lo)
  const m = lo.model
  const none: RackLoadEstimate = {
    sprites,
    streams: 0,
    stepSec: Infinity,
    perUserTokS: 0,
    aggTokS: 0,
    specOn: false,
    computeBound: false,
    kvLimited: false,
  }
  if (!p.fits || !m || !lo.hw) return none
  const grp = schedGroups(s, p)
  const n = Math.max(1, sprites)
  const cached = Math.max(0, opt.cachedTokens ?? 0)
  // the busiest group's sprites, each admitted with as much of its cohort as the KV left holds
  const mine = Math.min(grp.slots, Math.ceil(n / grp.count))
  let free = grp.kvGb
  let streams = 0
  let cohorts = 0
  let kvGb = 0
  let bg = 0
  const inTok = opt.inputTokens ?? 0
  const outTok = opt.outputTokens ?? 0
  for (let i = 0; i < mine; i++) {
    const k = cohortFit(s, m, contextLen, free, cached)
    if (k <= 0) break
    const kv = cohortKvGb(s, m, contextLen, k, cached)
    free -= kv
    kvGb += kv
    streams += k
    cohorts++
    bg += cohortPrefillSec(s, lo, p, k, inTok, cached, outTok, true)
  }
  if (streams <= 0) return none
  // every sprite the rack holds, at the busiest group's mean cohort
  const rackStreams = (streams / cohorts) * Math.min(n, grp.count * cohorts)
  const lanes = Math.max(1, grp.lanes)
  const g = specTokensFor(s, opt.axis ?? 'chat')
  const step = laneStep(s, lo, p, {
    streams: streams / lanes,
    kvGb: kvGb / lanes,
    bgPrefillSec: bg / lanes,
    overlapPrefill: s.infra.scheduling.chunked,
    rackStreams,
    specTokens: g,
    throttle: opt.throttle,
  })
  const perUser = (step.specOn ? g : 1) / step.stepSec
  return {
    sprites: n,
    streams: rackStreams,
    stepSec: step.stepSec,
    perUserTokS: perUser,
    aggTokS: perUser * rackStreams,
    specOn: step.specOn,
    computeBound: step.computeBound,
    kvLimited: streams < mine * COHORT_STREAMS,
  }
}

/** Per-user decode tok/s with `sprites` cohorts at `contextLen` on the rack (§5.7). */
export function serverPerUserDecodeTokS(
  s: GameState,
  lo: Loadout,
  sprites = 1,
  contextLen = REF_CONTEXT_TOKENS,
): number {
  return rackLoadEstimate(s, lo, sprites, contextLen).perUserTokS
}

/** The rack's aggregate decode tok/s with `sprites` cohorts at `contextLen` (§5.7). */
export function serverAggDecodeTokS(
  s: GameState,
  lo: Loadout,
  sprites = 1,
  contextLen = REF_CONTEXT_TOKENS,
): number {
  return rackLoadEstimate(s, lo, sprites, contextLen).aggTokS
}

/** Headline speed: per-user tok/s with one cohort on the rack (the lightest real load). */
export function serverSpeed(s: GameState, lo: Loadout): number {
  return serverPerUserDecodeTokS(s, lo, 1)
}

/**
 * Single-stream decode ceiling (tok/s): one stream alone on a lane, reading the active
 * weights at the group's bandwidth (no KV, no speculation) — the fastest a user can ever
 * be served on this rack:
 *   1 / ( activeB × bytes / (BW_gpu × tpDeg × tpEff × MBU) + comm + overhead )
 */
export function decodeTokSb1(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  if (!p.fits) return 0
  const step = laneStep(s, lo, p, { streams: 1, kvGb: 0, bgPrefillSec: 0, overlapPrefill: false })
  return 1 / step.stepSec
}

/** Compute roof (tok/s): the rack's aggregate decode ceiling as the batch grows without bound (every lane). */
export function computeRoofTokS(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  if (!p.fits || !lo.hw || !lo.model) return 0
  const flops =
    formatTflopsPerGpu(lo.hw, p.format) * 1e12 * p.tpDeg * tpEff(p.tpDeg) * engineEff(s) * MFU_DECODE
  return (p.lanes * flops) / (2 * lo.model.paramsActiveB * 1e9)
}

/** UI/test compute ceiling (real tok/s): the rack's aggregate compute roof. */
export function serverComputeCeiling(s: GameState, lo: Loadout): number {
  return computeRoofTokS(s, lo)
}

/** UI/test bandwidth ceiling (real tok/s): the single-stream ceiling, speculative decoding included. */
export function serverBandwidthCeiling(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  if (!p.fits) return 0
  const g = specTokensFor(s, 'chat')
  const step = laneStep(s, lo, p, {
    streams: 1,
    kvGb: 0,
    bgPrefillSec: 0,
    overlapPrefill: false,
    specTokens: g,
  })
  return (step.specOn ? g : 1) / step.stepSec
}

/**
 * Request sprites this rack's scheduler batches: every lane takes the engine's batch cap in
 * cohorts once Continuous Batching is researched (one static batch before it). KV admits
 * each sprite, and caps its cohort, at runtime (combat).
 */
export function serverTargets(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  if (!p.fits || !lo.hw) return 0
  return p.lanes * spritesPerLane(s)
}

/**
 * The hidden reasoning tokens a model spends on one request of an archetype: its thinking budget ×
 * the archetype's thinkMul in thinking mode, 0 in instant mode (an instruct model, or a hybrid on
 * interactive traffic).
 */
export function hiddenTokensFor(
  model: ModelDef | null | undefined,
  def: Pick<RequestTypeDef, 'latClass' | 'outputTokens' | 'thinkMul'>,
): number {
  if (!model || answerMode(model, def) === 'instant') return 0
  return Math.round(model.thinkTokens * Math.max(0, def.thinkMul))
}

/* ------------------------------------------------------------------ *
 *  POWER (§6.5) — real kW.                                              *
 * ------------------------------------------------------------------ */

/**
 * REAL electrical draw of a rack in kW (§6.5): its aggregate nameplate TDP × a
 * utilization factor. Lower-precision GEMMs do the same work for less energy (FP8 −15%,
 * 4-bit a further −5%), and Speculative Decoding keeps a draft head hot and burns verify
 * compute on every rack (+8%). An H100 rack reads ~0.56 kW, a DGX-H200 ~4.5 kW, an
 * NVL72 ~57.6 kW — real kW.
 */
export function serverPower(s: GameState, lo: Loadout): number {
  if (!lo.hw) return 0
  const fmt = lo.model ? servingFormat(s, lo) : 'bf16'
  const reduce = fmt === 'fp8' ? 0.85 : fmt === 'int4' || fmt === 'nvfp4' ? 0.85 * 0.95 : 1
  const spec = s.infra.spec.enabled ? 1 + 0.08 * s.infra.spec.level : 1
  return (lo.hw.tdpWatts / 1000) * RACK_UTILIZATION * reduce * spec
}

/** REAL heat a rack rejects in kW (§6.5): ≈all electrical power becomes heat. */
export function serverHeat(s: GameState, lo: Loadout): number {
  return serverPower(s, lo)
}

/** True for racks whose accelerator TDP tier mandates direct liquid cooling (§5.5). */
export function hwNeedsLiquid(hw: ServerHardwareDef | null | undefined): boolean {
  return hw?.cooling === 'liquid'
}

/** §5.5 hard gate (OQ-G8): a liquid-cooled rack needs at least one Liquid Cooling Loop. */
export function hasLiquidLoop(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'cooling_liquid')
}

/* ------------------------------------------------------------------ *
 *  ROUTING & PREFIX CACHE (§4.2 / §4.10)                                *
 * ------------------------------------------------------------------ */

/**
 * A router's routing weight (§4.10). The sim reads it only as the "routing is active"
 * signal `s.routingPower`; what a router DOES is capability-aware dispatch (combat.ts)
 * plus, with KV-aware routing, a higher prefix-cache hit chance (`prefixHitChance`).
 * It never speeds decode: per-token speed is set by HBM bytes per token, not topic.
 */
export function routeBonus(s: GameState, def: TowerDef): number {
  return (def.routeBonus ?? 0) * (1 + (s.infra.routing.kvAware ? 0.8 : 0))
}

/**
 * One cache's hit chance (§4.2): prefix-cache research lifts it. Capped at
 * CACHE_HIT_CAP — even a fully-researched cache misses a real share of traffic, since
 * unique prompts don't share a cached prefix. A hit skips only the shared-prefix share
 * of the prefill (combat.ts), so this is a TTFT-acceleration rate, not a free-serve rate.
 */
export function cacheChance(s: GameState, def: TowerDef): number {
  return Math.min(CACHE_HIT_CAP, (def.cacheChance ?? 0) + 0.2 * prefixLevel(s))
}

/** KV-cache / prefix-cache research level (0..2) derived from the prefix hit ceiling. */
function prefixLevel(s: GameState): number {
  const c = s.infra.kv.prefixHitCeil
  return c >= 0.85 ? 2 : c > 0 ? 1 : 0
}

/**
 * §4.2 the workload's prefix-reuse ceiling. A request's prefix is either resident in a
 * cache or it is not, so overlapping caches combine as the BEST one, never as independent
 * rolls, and no number of caches lifts the hit chance past this cap.
 */
export const CACHE_HIT_CAP = 0.7

/**
 * §4.10 KV-aware routing (NVIDIA Dynamo) steers a ROUTED request to the replica that
 * already holds its prefix: it recovers this share of the would-be misses, up to the
 * researched prefix-hit ceiling (`s.infra.kv.prefixHitCeil`, the dossier's 60–85% band).
 */
export const KV_ROUTE_MISS_RECOVERY = 0.5

/**
 * The prefix-cache hit chances of one request at a rack whose best covering cache offers
 * `bestChance` (§4.2/§4.9/§4.10), split by the tier the prefix is found in:
 *   · hbm — resident on the GPUs (SGLang's RadixAttention reuses more of it; KV-aware
 *     routing recovers part of the misses of routed traffic);
 *   · offload — evicted to the CPU/SSD tier with KV Offloading, reloaded over PCIe.
 */
export function prefixHitTiers(
  s: GameState,
  bestChance: number,
  routed: boolean,
): { hbm: number; offload: number } {
  let hbm = Math.min(CACHE_HIT_CAP, Math.max(0, bestChance))
  if (hbm <= 0) return { hbm: 0, offload: 0 }
  if (s.infra.engineTier === 1) hbm = Math.min(RADIX_HIT_CAP, hbm + RADIX_HIT_BONUS)
  if (routed && s.infra.routing.kvAware) {
    const ceil = Math.max(hbm, CACHE_HIT_CAP, s.infra.kv.prefixHitCeil)
    hbm = Math.min(ceil, hbm + (1 - hbm) * KV_ROUTE_MISS_RECOVERY)
  }
  const offload =
    s.infra.kv.offloadGb > 0 ? Math.max(0, Math.min(OFFLOAD_HIT_CAP, hbm + OFFLOAD_HIT_BONUS) - hbm) : 0
  return { hbm, offload }
}

/** The total prefix-cache hit chance of one request (both tiers). Rolled ONCE per request (combat.ts). */
export function prefixHitChance(s: GameState, bestChance: number, routed: boolean): number {
  const t = prefixHitTiers(s, bestChance, routed)
  return t.hbm + t.offload
}

/** Seconds to reload `tokens` of cached prefix KV from the offload tier over PCIe. */
export function offloadReloadSec(s: GameState, model: ModelDef, tokens: number): number {
  return kvSharedGb(s, model, tokens) / PCIE_RELOAD_GBPS
}

/**
 * A placed tower's coverage radius in tiles. A server reaches as far as its CURRENT
 * hardware tier (an in-place upgrade extends it); every other building uses its build entry.
 */
export function towerRangeTiles(t: Tower): number {
  if (t.def.kind === 'server' && t.hwId) return HARDWARE_DEFS[t.hwId]?.range ?? t.def.range
  return t.def.range
}

/* ------------------------------------------------------------------ *
 *  GUARDRAILS (§3.3) — the second-layer external safety buildings.     *
 *  guard_encoder / guard_mod have a FIXED check latency; guard_llm     *
 *  runs the REAL §6 roofline on its OWN rack ([fix M8]) so its latency  *
 *  is a real (shorter) inference time, and that rack draws real power   *
 *  and pays its own GPU-hours.                                          *
 * ------------------------------------------------------------------ */

/** The generative guardrail's own serving loadout (its fixed rack + a 12B-active "model" body). */
export function guardLoadout(spec: NonNullable<TowerDef['guardrail']>): Loadout | null {
  if (!spec.runsOnRoofline || !spec.guardHardwareId || spec.guardParamsActiveB === undefined) return null
  const hw = HARDWARE_DEFS[spec.guardHardwareId] ?? null
  if (!hw) return null
  // a synthetic dense FP16 model body sized to the guardrail's active params (§6.2 basis).
  const model: ModelDef = {
    id: `__guard_${spec.archetype}`,
    name: 'Guardrail Model',
    tier: 'general',
    variant: 'instruct',
    spec: 'general',
    origin: 'base',
    paramsTotalB: spec.guardParamsActiveB,
    paramsActiveB: spec.guardParamsActiveB,
    isMoE: false,
    thinking: 'never',
    isReasoning: false,
    thinkTokens: 0,
    quality: 80,
    qualityBy: { chat: 80, coding: 60, reasoning: 70, general: 80, agentic: 60 },
    layers: 48,
    kvLayers: 48,
    kvHeads: 8,
    headDim: 128,
    attn: 'GQA',
    kvBytesPerToken: 2 * 48 * 8 * 128 * 2,
    kvStateMbPerReq: 0,
    nativeWeightBytes: 2,
    contextWindowK: 32,
    longCtx: 0.5,
    alignment: { safety: 90, refusalStyle: 'safe-completion', overRefusal: 0.02 },
    instructFollow: 90,
    desc: 'Internal guardrail inference body.',
  }
  return { hw, model }
}

/** A guardrail judgement: ingest the prompt (~300 tokens), emit a tiny safe/unsafe verdict (~24 tokens). */
const GUARD_IN_TOKENS = 300
const GUARD_OUT_TOKENS = 24

/**
 * §3.3 [fix M8] the guardrail's check latency in REAL ms. encoder/moderation use the
 * FIXED `checkLatencyMs`; the generative family (guard_llm) computes a REAL (shorter)
 * 12B inference on its own rack via the §6 roofline: the verdict prompt's prefill + the
 * verdict tokens decoded while one cohort of checks shares the rack.
 */
export function guardLatencyMs(s: GameState, spec: NonNullable<TowerDef['guardrail']>): number {
  if (!spec.runsOnRoofline) return spec.checkLatencyMs ?? 0
  const lo = guardLoadout(spec)
  if (!lo) return spec.checkLatencyMs ?? 0
  const prefillRate = serverPrefillSpeed(s, lo, GUARD_IN_TOKENS)
  const perUser = rackLoadEstimate(s, lo, 1, GUARD_IN_TOKENS + GUARD_OUT_TOKENS).perUserTokS
  const prefillSec = prefillRate > 0 ? GUARD_IN_TOKENS / prefillRate : 0
  const decodeSec = perUser > 0 ? (GUARD_OUT_TOKENS - 1) / perUser : 0
  return (prefillSec + decodeSec) * 1000
}

/** §6.5 real electrical draw (kW) of a generative guardrail's own rack; 0 for encoder/moderation. */
export function guardPower(s: GameState, spec: NonNullable<TowerDef['guardrail']>): number {
  const lo = guardLoadout(spec)
  return lo ? serverPower(s, lo) : 0
}

/** §6.5 real heat (kW) a generative guardrail's rack rejects (≈ its power); 0 otherwise. */
export function guardHeat(s: GameState, spec: NonNullable<TowerDef['guardrail']>): number {
  return guardPower(s, spec)
}

/** Data yield multiplier from owning Training Labs. */
export function dataMult(s: GameState): number {
  const labs = s.towers.reduce((n, t) => n + (t.def.kind === 'lab' ? 1 : 0), 0)
  return 1 + 0.25 * labs
}

export function hasLab(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'lab')
}

/* ------------------------------------------------------------------ *
 *  REAL ECONOMY (§6.6) — token-priced income, a real wall-clock bill.   *
 *  1 credit = $CREDIT_USD. A sprite is TRAFFIC_SCALE requests and a     *
 *  board rack RACKS_PER_TILE real racks (the cohort identity), so the   *
 *  bill one rack pays is RACKS_PER_TILE × its real $/hour and the       *
 *  tokens they produce are TRAFFIC_SCALE × the sprites' progress: the   *
 *  $/Mtoken a rack card shows is the rate its cash flow obeys. The bill *
 *  has two lines:                                                       *
 *    · GPU-hours — the real per-GPU-hour rate minus the electricity it  *
 *      embeds (amortization, maintenance, colo, network): every online  *
 *      rack pays it, busy or idle;                                      *
 *    · energy — the kW actually drawn (idle racks draw less) × PUE (air *
 *      ~1.4, direct liquid ~1.15) × $/kWh; power-price incidents scale  *
 *      only this line.                                                  *
 * ------------------------------------------------------------------ */

/** Real datacenter seconds that elapse per board second (§0.4 dual clock). */
export const REAL_SEC_PER_BOARD_SEC = SIM_TIME_SCALE

/** Facility power usage effectiveness of a rack's cooling class. */
export function pueOf(hw: ServerHardwareDef): number {
  return hw.cooling === 'liquid' ? PUE_LIQUID : PUE_AIR
}

/** The non-energy share of a rack's real $/hour: its GPU-hour rate minus the electricity a fully loaded rack burns. */
export function gpuHourUsdPerHr(hw: ServerHardwareDef): number {
  const nameplateKw = (hw.tdpWatts / 1000) * RACK_UTILIZATION
  return Math.max(0, hw.gpuHrUsd - nameplateKw * pueOf(hw) * POWER_USD_PER_KWH)
}

/** kW a rack actually draws for the bill: idle racks still burn IDLE_POWER_FRAC of nameplate; a throttled one less. */
export function billedKw(s: GameState, lo: Loadout, load = 1, throttle = 1): number {
  const l = Math.min(1, Math.max(0, load))
  return (
    serverPower(s, lo) * (IDLE_POWER_FRAC + (1 - IDLE_POWER_FRAC) * l) * Math.min(1, Math.max(0, throttle))
  )
}

/** A rack's electricity in real $/hour at the base price (facility PUE included). */
export function energyUsdPerHr(s: GameState, lo: Loadout, load = 1, throttle = 1): number {
  return lo.hw ? billedKw(s, lo, load, throttle) * pueOf(lo.hw) * POWER_USD_PER_KWH : 0
}

/** One REAL rack's full $/hour right now (GPU-hours + energy at the live power price). */
export function rackHourlyUsd(s: GameState, lo: Loadout, load = 1, throttle = 1): number {
  if (!lo.hw) return 0
  return gpuHourUsdPerHr(lo.hw) + energyUsdPerHr(s, lo, load, throttle) * s.modifiers.powerPrice
}

/** Real $/hour of one real rack → credits per BOARD second for the whole tile (RACKS_PER_TILE racks). */
function usdPerHrToCredits(usdPerHr: number): number {
  return (usdPerHr * (REAL_SEC_PER_BOARD_SEC / 3600) * RACKS_PER_TILE) / CREDIT_USD
}

/** GPU-hour line (credits per board second) of one online board rack. */
export function rackGpuCostPerSec(hw: ServerHardwareDef): number {
  return usdPerHrToCredits(gpuHourUsdPerHr(hw))
}

/** Energy line (credits per board second, base price) of one online board rack. */
export function rackEnergyCostPerSec(s: GameState, lo: Loadout, load = 1, throttle = 1): number {
  return usdPerHrToCredits(energyUsdPerHr(s, lo, load, throttle))
}

/**
 * The whole operating bill (credits per BOARD second) of one online board rack at the live
 * power price: GPU-hours + energy × powerPrice. It bills by WALL-CLOCK, so an idle or
 * over-provisioned rack still bleeds (the utilization penalty, §6.6).
 */
export function rackOperatingCostPerSec(s: GameState, lo: Loadout, load = 1, throttle = 1): number {
  if (!lo.hw) return 0
  return rackGpuCostPerSec(lo.hw) + rackEnergyCostPerSec(s, lo, load, throttle) * s.modifiers.powerPrice
}

/** One tower's operating bill right now (credits per BOARD second), split into its two lines. */
export interface TowerOpex {
  /** the GPU-hour line (amortization, maintenance, colo). */
  gpu: number
  /** the energy line, at the live power price. */
  energy: number
  /** the rack hardware's real capex (USD) this tower carries (0 for non-GPU buildings). */
  capexUsd: number
}

const NO_OPEX: TowerOpex = { gpu: 0, energy: 0, capexUsd: 0 }

/**
 * §6.6 what one tower bills per board second — the single rule updateEconomy, the next-wave
 * bill preview and the live burn readout share. A serving rack bills while it is online and
 * powered (a requisitioned training rack runs flat out; a browned-out one is dark); its
 * energy line follows how busy it is (`load`, default its live batch occupancy). The
 * generative guardrail runs its own GPU rack and bills it the same way, fully loaded.
 * Every other building is free to run.
 */
export function towerOpexPerSec(s: GameState, t: Tower, load?: number): TowerOpex {
  if (t.def.kind === 'guardrail' && t.def.guardrail?.runsOnRoofline) {
    const glo = guardLoadout(t.def.guardrail)
    if (!glo?.hw) return NO_OPEX
    if (!t.online) return { gpu: 0, energy: 0, capexUsd: glo.hw.capexUsd }
    return {
      gpu: rackGpuCostPerSec(glo.hw),
      energy: rackEnergyCostPerSec(s, glo, 1, 1) * s.modifiers.powerPrice,
      capexUsd: glo.hw.capexUsd,
    }
  }
  if (t.def.kind !== 'server') return NO_OPEX
  const lo = loadoutOf(s, t)
  if (!lo.hw) return NO_OPEX
  if (!t.online || t.throttle <= 0) return { gpu: 0, energy: 0, capexUsd: lo.hw.capexUsd }
  const busy = t.training ? 1 : (load ?? t.load)
  return {
    gpu: rackGpuCostPerSec(lo.hw),
    energy: rackEnergyCostPerSec(s, lo, busy, t.throttle) * s.modifiers.powerPrice,
    capexUsd: lo.hw.capexUsd,
  }
}

/**
 * Real serving cost in USD per MILLION output tokens of a rack serving `aggTokS` (§5.8):
 *   $/Mtoken = rack $/hour × 1e6 / (aggTokS × 3600)
 * The same identity the cash flow runs on (RACKS_PER_TILE racks, TRAFFIC_SCALE requests).
 */
export function dollarsPerMtokenAt(s: GameState, lo: Loadout, aggTokS: number, load = 1): number {
  if (aggTokS <= 0) return Infinity
  return (rackHourlyUsd(s, lo, load) * 1e6) / (aggTokS * 3600)
}

/**
 * Token-priced revenue (credits) for serving one request's input+output at the given
 * $/Mtok prices, scaled by TRAFFIC_SCALE and the market multiplier (§6.6).
 */
export function serveRevenue(
  s: GameState,
  tokensIn: number,
  tokensOut: number,
  pricePerMtokIn: number,
  pricePerMtokOut: number,
): number {
  const revenueUsd = (tokensIn * pricePerMtokIn + tokensOut * pricePerMtokOut) / 1e6
  return (TRAFFIC_SCALE * revenueUsd * s.marketPriceMul) / CREDIT_USD
}
