import { CREDIT_USD, OP_COST_SCALE, RACK_UTILIZATION, SIM_TIME_SCALE, TRAFFIC_SCALE } from '../config'
import type { GameState, ModelDef, ServerHardwareDef, ServerSpec, Tower, TowerDef } from '../core/types'
import { FRAMEWORK_GB } from '../config'
import { HARDWARE_DEFS, MODEL_DEFS } from './content'
import { resolveModel } from './models'
import { alignmentTax } from './safety'

export { resolveModel }

/** Owned level of an upgrade (0 if not bought). */
export function lvl(s: GameState, id: string): number {
  return s.upgrades[id] ?? 0
}

/**
 * A server's serving stack: the rack hardware plus the deployed model.
 * Hardware and model both live on the Tower instance (upgradable / swappable);
 * the TowerDef only describes what the building ships as.
 */
export interface Loadout {
  hw: ServerHardwareDef | null
  model: ModelDef | null
}

/** The live loadout of a placed server. Resolves derived checkpoints via `resolveModel`. */
export function loadoutOf(s: GameState, t: Tower): Loadout {
  return {
    hw: t.hwId ? (HARDWARE_DEFS[t.hwId] ?? null) : null,
    model: t.modelId ? resolveModel(s, t.modelId) : null,
  }
}

/** Build-bar preview: the rack as it ships (default model included). */
export function defLoadout(def: TowerDef): Loadout {
  return {
    hw: def.hardwareId ? (HARDWARE_DEFS[def.hardwareId] ?? null) : null,
    model: def.defaultModelId ? (MODEL_DEFS[def.defaultModelId] ?? null) : null,
  }
}

export function loadout(s: GameState, hwId: string | undefined, modelId: string | undefined): Loadout {
  return {
    hw: hwId ? (HARDWARE_DEFS[hwId] ?? null) : null,
    model: modelId ? resolveModel(s, modelId) : null,
  }
}

export function serverSpec(lo: Loadout): ServerSpec {
  return lo.model?.spec ?? 'general'
}

/** INT4 PTQ active (s.infra.weightQuantBytes dropped to 0.5): the quality-tax / KV-element switch (§4.5). */
function int4On(s: GameState): boolean {
  return s.infra.weightQuantBytes <= 0.5
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

/**
 * Bytes per weight param after PTQ weight-quant (§4.5/§5.6). The deploy default
 * is the model's authored `weightBytes` (FP16=2); serving-layer PTQ lowers it to
 * `s.infra.weightQuantBytes` (FP8=1, INT4/NVFP4=0.5) when that is the more
 * aggressive (smaller) precision. This is the SINGLE quant action point: it feeds
 * VRAM and the decode bandwidth term, but NOT the W4A16 compute roof (we pick the
 * matching tensor rate). A QAT-derived checkpoint authors a low `weightBytes`
 * directly, so `min` lets either path win.
 */
function bytesPerParam(s: GameState, model: ModelDef): number {
  return Math.min(model.weightBytes, s.infra.weightQuantBytes)
}

/** Resident weight memory in GB = paramsTotalB × bytesPerParam (§5.6; MoE = all experts resident). */
function modelMemory(s: GameState, model: ModelDef): number {
  return model.paramsTotalB * bytesPerParam(s, model)
}

/** Whichever tensor-core rate matches the deploy precision (TFLOPS). */
function tensorTflops(s: GameState, hw: ServerHardwareDef, model: ModelDef): number {
  // FP8 / INT4 deploys run on the FP8 tensor cores; FP16 on the bf16 rate.
  return bytesPerParam(s, model) < 2 ? hw.fp8Tflops : hw.bf16Tflops
}

export function serverModelMemory(s: GameState, lo: Loadout): number {
  return lo.model ? modelMemory(s, lo.model) : 0
}

/** Weights + framework overhead must fit HBM (§6.2). */
export function serverFitsMemory(s: GameState, lo: Loadout): boolean {
  if (!lo.hw || !lo.model) return false
  return modelMemory(s, lo.model) + FRAMEWORK_GB <= lo.hw.hbmGb
}

/** Deployable right now: the weights fit VRAM AND the model's methods are unlocked. */
export function serverDeployable(s: GameState, lo: Loadout): boolean {
  return !!lo.model && serverFitsMemory(s, lo) && methodsUnlocked(s, lo.model)
}

/**
 * Correctness on one traffic axis: the checkpoint's per-task aptitude plus
 * the upgrade chain. Fine-tuning is model polish; Reasoning buys quality
 * with thinking tokens; Quantization is cheaper serving at a small quality
 * risk; Distillation makes the student faster but it never quite matches
 * the teacher.
 */
export function serverQualityVs(s: GameState, lo: Loadout, axis: ServerSpec): number {
  if (!lo.model) return 0
  // FP8 is effectively lossless (ACL'25); INT4 PTQ pays a small flat quality tax
  // here and a steep long-context tax in combat (see updateCombat). The +quality
  // buff `scale_pretrain` and the GQA tax are GONE in P3c: model polish is the
  // Post-Training Studio (P3b) and GQA/MLA are model attributes (R4), not the tree.
  const int4Tax = int4On(s) ? 2 : 0
  // §3.2 alignment tax (P3d): an aligned model trades capability for safety — a
  // hard-refusal model pays the steepest tax; a safe-completion model pays less
  // (the §3.1 Pareto point). Applied ON TOP of qualityBy, never baked into it.
  return lo.model.qualityBy[axis] - int4Tax - alignmentTax(lo.model)
}

/** Peak correctness (the model's specialty axis) — what the dashboards show. */
export function serverQuality(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  return serverQualityVs(s, lo, lo.model.spec)
}

/** FlashAttention long-context bonus to the effective window (fraction), from s.infra.kv. */
function flashCtxBonus(s: GameState): number {
  return 0.14 * s.infra.kv.flash + 0.06 * prefixLevel(s)
}

/** KV-cache / prefix-cache research level (0..2) derived from the prefix hit ceiling. */
function prefixLevel(s: GameState): number {
  // prefixHitCeil 0 → 0, 0.6 → 1, 0.85 → 2 (the two KV-Cache research steps).
  const c = s.infra.kv.prefixHitCeil
  return c >= 0.85 ? 2 : c > 0 ? 1 : 0
}

/**
 * The hard context window in REAL TOKENS: a prompt longer than the model's
 * advertised window (×FlashAttention bonus) cannot be served AT ALL (§1.2).
 * With real 128K+ windows this rarely triggers — long context now bites via
 * the KV budget, not a hard reject.
 */
export function serverCtxWindowTokens(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  return lo.model.contextWindowK * 1000 * (1 + flashCtxBonus(s))
}

/** Long-context capability score (0..~100) for UI: derived from the real window (K) + research. */
export function serverContext(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  // map the real window (K tokens, log-ish) to the legacy 0..100 capability score
  const fromWindow = Math.min(100, 22 * Math.log2(Math.max(1, lo.model.contextWindowK)))
  return fromWindow + 14 * s.infra.kv.flash + 6 * prefixLevel(s)
}

/**
 * KV-cache footprint (GB) of ONE in-flight request at a given REAL sequence
 * length (§5.6): 2 × layers × kvHeads × headDim × contextLen × bytesPerElem.
 * MLA stores a compact latent → ×0.067 (DeepSeek MLA −93.3%, §4.6); GQA/MQA are
 * reflected naturally by the model's low kvHeads — there is NO global GQA ×0.4
 * any more (R4: grouped/latent attention is a model attribute, not a tech node).
 * The KV-element bytes come from `s.infra.kv.quantBytes` (FP16=2 → FP8=1 → INT4 0.5).
 */
export function kvPerReqGb(s: GameState, model: ModelDef, contextLen: number): number {
  // KV-quant research (s.infra.kv.quantBytes) sets the per-element width.
  const bytesPerElem = s.infra.kv.quantBytes
  let kv = (2 * model.layers * model.kvHeads * model.headDim * Math.max(1, contextLen) * bytesPerElem) / 1e9
  if (model.attn === 'MLA') kv *= 0.067
  // FlashAttention / KV-Cache (prefix) research shave per-request KV overhead a little.
  kv *= Math.max(0.55, 1 - 0.08 * s.infra.kv.flash) * Math.max(0.6, 1 - 0.12 * prefixLevel(s))
  return kv
}

/**
 * KV memory utilization (§4.2): pre-PagedAttention allocators waste 60–80% of KV
 * memory (SOSP'23 measured 20–38% useful), paged block allocation recovers 96%.
 * Read straight from `s.infra.kv.utilization` (0.55 default → 0.96 after paged).
 */
export function kvUtilization(s: GameState): number {
  return s.infra.kv.utilization
}

/** USABLE VRAM for KV: (HBM − weights − framework) × allocator quality (§6.2). */
export function kvFreeGb(s: GameState, lo: Loadout): number {
  if (!lo.hw || !lo.model) return 0
  return Math.max(0, lo.hw.hbmGb - modelMemory(s, lo.model) - FRAMEWORK_GB) * kvUtilization(s)
}

/**
 * Decode aggregate ceiling (tok/s) at b=1: bandwidth-bound, §5.7.
 *   decodeTokS_b1 = HBM_BW / (2 × activeB × bytesPerParam)
 */
export function decodeTokSb1(s: GameState, lo: Loadout): number {
  if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) return 0
  const bytes = bytesPerParam(s, lo.model)
  const hbmBytesPerSec = lo.hw.hbmTbs * 1e12
  return hbmBytesPerSec / (2 * lo.model.paramsActiveB * 1e9 * bytes)
}

/**
 * Compute roof (tok/s): the ceiling decode hits as batch grows large (§5.7).
 *   computeRoofTokS = aggTflops / (2 × activeB)
 * Uses the tensor rate that matches the deploy precision.
 */
export function computeRoofTokS(s: GameState, lo: Loadout): number {
  if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) return 0
  const aggTflops = tensorTflops(s, lo.hw, lo.model) * 1e12
  return aggTflops / (2 * lo.model.paramsActiveB * 1e9)
}

/**
 * Prefill rate (tok/s) for a prompt of `inputTokens`: compute-bound GEMM with
 * O(n²) attention → super-linear penalty for long prompts (§1.1#63 / §6.2):
 *   superlinear(n) = 1 + n/16000
 *   prefillTokS(n) = aggTflops / (2 × activeB × superlinear(n))
 */
export function prefillTokS(s: GameState, lo: Loadout, inputTokens: number): number {
  if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) return 0
  const aggTflops = tensorTflops(s, lo.hw, lo.model) * 1e12
  const superlinear = 1 + Math.max(0, inputTokens) / 16000
  return aggTflops / (2 * lo.model.paramsActiveB * 1e9 * superlinear)
}

/**
 * Engine throughput multiplier (§4.9): vLLM (tier 0) = 1.0, SGLang (tier 1) =
 * 1.10, TensorRT-LLM (tier 2) = 1.25 — the real ~10–30% kernel lead of TRT-LLM.
 */
function engineMul(s: GameState): number {
  return s.infra.engineTier === 2 ? 1.25 : s.infra.engineTier === 1 ? 1.1 : 1
}

/**
 * Batch-independent speed multiplier on tok/s (§4.1/§4.9). Scheduler throughput
 * (multi-step scheduling + bigger-rack utilization, `s.infra.throughput`) and the
 * inference engine tier lift everything. Speculative decoding is NOT here — it is
 * batch-dependent and applied only on decode via `specMul`.
 */
function speedMul(s: GameState, lo: Loadout): number {
  if (!lo.model) return 0
  return (1 + 0.12 * s.infra.throughput) * engineMul(s)
}

/**
 * Speculative-decoding multiplier on the DECODE rate (§4.4, EAGLE-3.1, batch-
 * dependent): the draft saves bandwidth only while the rack is memory-bound, so
 * the gain fades as batch grows and is GONE at batch ≥32 (RedHat: turn it off):
 *   batch ≤1 → 2.0 · ≤4 → 1.7 · ≤16 → 1.66 · <32 → lerp(1.66→1.0) · ≥32 → 1.0.
 * Disabled (no research) → 1.0.
 */
function specMul(s: GameState, batch: number): number {
  if (!s.infra.spec.enabled) return 1
  const b = Math.max(1, batch)
  if (b <= 1) return 2.0
  if (b <= 4) return 1.7
  if (b <= 16) return 1.66
  if (b >= 32) return 1.0
  // 16 < b < 32: lerp 1.66 → 1.0 as batch climbs to the cutoff
  return 1.66 + (1.0 - 1.66) * ((b - 16) / (32 - 16))
}

/** Bandwidth multiplier on decode tok/s: FlashAttention raises the effective decode ceiling. */
function bwMul(s: GameState): number {
  return 1 + 0.1 * s.infra.kv.flash
}

/**
 * PREFILL rate (real tok/s) for ingesting `inputTokens`: compute-bound GEMM,
 * super-linear in prompt length. Serializes the rack; gains nothing from batching
 * or speculative decoding (a prefill technique, not a decode one).
 */
export function serverPrefillSpeed(s: GameState, lo: Loadout, inputTokens: number): number {
  return prefillTokS(s, lo, inputTokens) * speedMul(s, lo)
}

/**
 * Aggregate DECODE rate (real tok/s) on a rack running `batch` concurrent
 * requests: bandwidth-bound, linear in batch until it saturates the compute
 * roof (§5.7). FlashAttention raises the effective bandwidth ceiling; speculative
 * decoding lifts it most at b=1 and fades to nothing by b≥32 (§4.4).
 */
export function serverAggDecodeTokS(s: GameState, lo: Loadout, batch: number): number {
  const spec = specMul(s, batch)
  const b1 = decodeTokSb1(s, lo) * speedMul(s, lo) * bwMul(s) * spec
  const roof = computeRoofTokS(s, lo) * speedMul(s, lo) * spec
  return Math.min(b1 * Math.max(1, batch), roof)
}

/** Per-user DECODE rate (real tok/s): the aggregate throughput shared across the batch (§5.7). */
export function serverPerUserDecodeTokS(s: GameState, lo: Loadout, batch: number): number {
  const n = Math.max(1, batch)
  return serverAggDecodeTokS(s, lo, n) / n
}

/** Headline speed for friendly UI: the per-user decode rate at a representative small batch. */
export function serverSpeed(s: GameState, lo: Loadout): number {
  if (!lo.model || !lo.hw) return 0
  return serverPerUserDecodeTokS(s, lo, 1)
}

/** UI/test compute ceiling (real tok/s): the compute roof at the deploy precision. */
export function serverComputeCeiling(s: GameState, lo: Loadout): number {
  return computeRoofTokS(s, lo) * speedMul(s, lo)
}

/** UI/test bandwidth ceiling (real tok/s): b=1 decode rate, FlashAttention + spec-decode boosted. */
export function serverBandwidthCeiling(s: GameState, lo: Loadout): number {
  return decodeTokSb1(s, lo) * speedMul(s, lo) * bwMul(s) * specMul(s, 1)
}

/** INT4's real weak spot: quality collapses on long-context requests (>8K real tokens). */
export function int4ContextPenalty(s: GameState, contextLenTokens: number): number {
  return int4On(s) && contextLenTokens > 8000 ? 6 : 0
}

/**
 * Phase-asymmetric thermal throttling (Splitwise/ISCA'24): decode is more
 * memory-bound than prefill, so it keeps a SLIGHT edge under a thermal cap — but
 * only slight. A previous ×0.25 left decode at ~84% even at the throttle floor, so
 * overheating was nearly free; ×0.85 makes decode track the cap closely (≈32% at the
 * 0.2 floor, ≈58% at a half-throttle), so under-cooling a hot fleet really bites and
 * Cooling becomes a must-buy, while prefill still takes the full hit (combat.ts).
 */
export function decodeThrottle(throttle: number): number {
  return 1 - (1 - throttle) * 0.85
}

/**
 * REAL electrical draw of a rack in kW (§6.5): its aggregate nameplate TDP
 * (tdpWatts = tdpWattsPerGpu × gpus) × a utilization factor, in kW. The serving
 * infra modifiers still apply on top: FP8/INT4 weight-quant cut draw (−15% / −5%);
 * the throughput lift pushes utilization (and the meter) up; Speculative Decoding
 * keeps a draft model hot and burns verify compute on the frontier tier. So an
 * H100 rack reads ~0.56 kW, a DGX-H200 pod ~4.5 kW, an NVL72 ~57.6 kW — real kW.
 */
export function serverPower(s: GameState, lo: Loadout): number {
  if (!lo.hw) return 0
  const fp8 = s.infra.weightQuantBytes <= 1
  const reduce = (fp8 ? 0.85 : 1) * (int4On(s) ? 0.95 : 1)
  let mul = 1 + 0.05 * s.infra.throughput
  if (lo.model?.tier === 'frontier' && s.infra.spec.enabled) mul *= 1 + 0.08 * s.infra.spec.level
  const kw = (lo.hw.tdpWatts / 1000) * RACK_UTILIZATION
  return kw * reduce * mul
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

/**
 * Upper bound on concurrent batch SLOTS this rack will schedule (the scheduler
 * gate). The real KV budget caps batch further at runtime (combat recomputes
 * maxBatch each tick); effective batch = min(serverTargets, maxBatch).
 */
export function serverTargets(s: GameState, lo: Loadout): number {
  if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) return 0
  // Before Continuous Batching is researched (s.infra.scheduling.batch=false),
  // scheduling is request-level: one request per rack at a time (the pre-Orca world).
  if (!s.infra.scheduling.batch) return 1
  // With continuous batching, the scheduler offers up to hw.targets concurrent
  // slots; multi-step scheduling adds extra slots; the real KV budget caps the
  // effective batch each tick in combat.
  return lo.hw.targets + s.infra.scheduling.multiStep
}

/** Router boost (§4.10): KV-aware routing (Dynamo) roughly doubles matched-server effectiveness. */
export function routeBonus(s: GameState, def: TowerDef): number {
  return (def.routeBonus ?? 0) * (1 + (s.infra.routing.kvAware ? 0.8 : 0))
}

/** Cache hit chance (§4.2): prefix-cache research lifts the per-server hit rate. */
export function cacheChance(s: GameState, def: TowerDef): number {
  return Math.min(0.95, (def.cacheChance ?? 0) + 0.2 * prefixLevel(s))
}

/* ------------------------------------------------------------------ *
 *  GUARDRAILS (§3.3) — the second-layer external safety buildings.     *
 *  guard_encoder / guard_mod have a FIXED check latency; guard_llm     *
 *  runs the REAL §6 roofline on its OWN rack ([fix M8]) so its latency  *
 *  is a real (shorter) inference time and it draws real power/heat.     *
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
    isReasoning: false,
    quality: 80,
    qualityBy: { chat: 80, coding: 60, reasoning: 70, general: 80, agentic: 60 },
    layers: 48,
    kvHeads: 8,
    headDim: 128,
    attn: 'GQA',
    weightBytes: 2,
    contextWindowK: 32,
    alignment: { safety: 90, refusalStyle: 'safe-completion', overRefusal: 0.02 },
    instructFollow: 90,
    desc: 'Internal guardrail inference body.',
  }
  return { hw, model }
}

/**
 * §3.3 [fix M8] the guardrail's check latency in REAL ms. encoder/moderation use the
 * FIXED `checkLatencyMs`; the generative family (guard_llm) computes a REAL (shorter)
 * 12B inference time on its own rack via the §6 roofline — prefill ~300 input tokens
 * + decode ~24 output tokens (a short safe/unsafe verdict). Dynamic, not a constant.
 */
export function guardLatencyMs(s: GameState, spec: NonNullable<TowerDef['guardrail']>): number {
  if (!spec.runsOnRoofline) return spec.checkLatencyMs ?? 0
  const lo = guardLoadout(spec)
  if (!lo) return spec.checkLatencyMs ?? 0
  // a guardrail judgement is a short LLM inference: ingest the prompt (~300 tok),
  // then emit a tiny verdict (~24 tok). Real prefill + decode seconds → ms (§0.4).
  const guardInTok = 300
  const guardOutTok = 24
  const prefillRate = serverPrefillSpeed(s, lo, guardInTok)
  const perUserDecode = serverPerUserDecodeTokS(s, lo, 1)
  const prefillSec = prefillRate > 0 ? guardInTok / prefillRate : 0
  const decodeSec = perUserDecode > 0 ? (guardOutTok - 1) / perUserDecode : 0
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
 *  REAL ECONOMY (§6.6) — token-priced income, real $/GPU-hr operating  *
 *  cost. 1 credit = $CREDIT_USD; a sprite = TRAFFIC_SCALE real streams. *
 *  Both income and the wall-clock bill carry TRAFFIC_SCALE so the real  *
 *  $/Mtoken identity is exact and an IDLE rack still bleeds (§6.6).     *
 * ------------------------------------------------------------------ */

/** Real datacenter seconds that elapse per board second (§0.4 dual clock). */
export const REAL_SEC_PER_BOARD_SEC = SIM_TIME_SCALE

/**
 * Operating cost (credits per BOARD second) for one online rack: its real
 * $/GPU-hr × real-hours-of-wall-clock, scaled by TRAFFIC_SCALE (a sprite stands
 * for that many real streams / GPU-shares) and converted to credits. This is a
 * FIXED cost by wall-clock — it bills whether the rack serves anything or not,
 * so an idle/over-provisioned rack bleeds (the utilization penalty, §6.6).
 */
export function rackOperatingCostPerSec(hw: ServerHardwareDef): number {
  const realHoursPerBoardSec = REAL_SEC_PER_BOARD_SEC / 3600
  return (hw.gpuHrUsd * realHoursPerBoardSec * TRAFFIC_SCALE * OP_COST_SCALE) / CREDIT_USD
}

/**
 * Token-priced revenue (credits) for serving one request's full input+output at
 * the given $/Mtok prices, scaled by TRAFFIC_SCALE and the market multiplier,
 * converted to credits (§6.6). REPLACES the old flat reward on a clean serve.
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
