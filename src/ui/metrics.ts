/**
 * ui/metrics.ts — the READ-ONLY display-metric compute layer (§5.5).
 *
 * Every value here is computed the SAME way the deterministic sim computes it
 * (sim/effects.ts + sim/combat.ts), so the dashboards never drift from reality.
 * The module is PURE (no PixiJS / DOM) and is unit-tested against the §6 worked
 * examples. It must NEVER mutate GameState; it only reads it (AGENTS.md §2).
 *
 * Latency estimates assume a BUSY rack — ESTIMATE_SPRITES_PER_LANE request cohorts on every
 * decode lane (§5.7), the load an SLO has to survive in a wave: per-user decode speed falls
 * as the batch (and its KV) grows, while the rack's aggregate climbs toward its compute roof.
 * Queueing and contention with other racks are runtime state and are left out.
 */
import { FRAMEWORK_GB, LAT_CLASS_SLO, TILE } from '../config'
import type {
  CapabilityAxis,
  GameState,
  GuardrailSpec,
  ModelDef,
  Outcome,
  Request,
  RequestTypeDef,
  SafetyHazard,
  ServerHardwareDef,
  SloCause,
  Tower,
  WeightFormat,
} from '../core/types'
import {
  admissionDelaySec,
  availableFormats,
  computeRoofTokS,
  decodeTokSb1,
  deployBlocker,
  dollarsPerMtokenAt,
  frameworkGbPerGpu,
  guardLatencyMs,
  hasLiquidLoop,
  hiddenTokensFor,
  hwNeedsLiquid,
  kvFreeGb,
  kvPerReqGb,
  type Loadout,
  loadout,
  loadoutOf,
  longContextPenalty,
  loraSiblings,
  type ParallelPlan,
  ptqTax,
  rackLoadEstimate,
  rackPlan,
  resolveModel,
  serverBandwidthCeiling,
  serverComputeCeiling,
  serverCtxWindowTokens,
  serverDeployable,
  serverFitsMemory,
  serverModelMemory,
  serverPower,
  serverPrefillSpeed,
  serverQuality,
  serverQualityVs,
  spritesPerLane,
  servingFormat,
  towerOpexPerSec,
  towerRangeTiles,
} from '../sim/effects'
import { goodputPctOf } from '../sim/telemetry'
import { HARDWARE_DEFS, HARDWARE_TIERS, WAVES, REQUEST_TYPES } from '../sim/content'
import { hardwareUpgradeCost, nextHardware } from '../sim/actions'
import {
  ALL_HAZARDS,
  categoryUnlocked,
  effRecall,
  overRefuse,
  overrefMul,
  pSelfHandle,
  redteamRecallBonus,
} from '../sim/safety'
import { CREDIT_USD } from '../config'

/** The five capability axes, in display order. `agentic` is the discriminative one (§6.4). */
export const AXES: CapabilityAxis[] = ['chat', 'coding', 'reasoning', 'general', 'agentic']

/** Which roof binds the rack at a busy batch (§5.7). */
export type BindingRoof = 'compute' | 'bandwidth'

/** The representative request the rack cards quote (the ESTIMATE card: 1.5K in / 256 out). */
export const REF_IN_TOKENS = 1500
export const REF_OUT_TOKENS = 256

/**
 * The busy load the estimates assume: request cohorts per decode lane (each COHORT_STREAMS
 * real streams — 2 ≈ 56 concurrent users per model copy), capped by the engine's batch.
 */
export const ESTIMATE_SPRITES_PER_LANE = 2

/** Request sprites a busy rack holds: ESTIMATE_SPRITES_PER_LANE on every lane (one before Continuous Batching). */
function busySprites(s: GameState, lo: Loadout): number {
  const p = rackPlan(s, lo)
  return Math.max(1, p.lanes * Math.min(spritesPerLane(s), ESTIMATE_SPRITES_PER_LANE))
}

/**
 * The mean sequence a decoding stream holds over its answer: its prompt plus half of what it
 * generates (streams in a batch sit at every point of their answers) — the KV the step re-reads.
 */
function midDecodeContext(inputTokens: number, outputTokens: number): number {
  return Math.max(1, Math.round(inputTokens + Math.max(0, outputTokens) / 2))
}

/* ------------------------------------------------------------------ *
 *  Per-rack roofline / throughput metrics                            *
 * ------------------------------------------------------------------ */

export interface RooflineMetrics {
  /** single-stream decode ceiling (tok/s): one user alone on a lane, bandwidth-bound (§5.7). */
  decodeTokSb1: number
  /** the rack's aggregate compute roof (tok/s) — what decode approaches as the batch grows. */
  computeRoofTokS: number
  /** prefill tok/s of a representative prompt on one lane (compute-bound GEMM, super-linear). */
  prefillTokS: number
  /** UI compute ceiling (the aggregate compute roof). */
  computeCeiling: number
  /** UI bandwidth ceiling (the single-stream ceiling, speculative decoding included). */
  bandwidthCeiling: number
  /** which roof binds a busy batch: compute (a big batch of a small model) vs HBM bandwidth. */
  binding: BindingRoof
  /** fits VRAM in an allowed GPU group (weights + draft + framework). */
  fits: boolean
  /** how the model spreads over the rack's GPUs (§4.7). */
  plan: ParallelPlan
}

export function rooflineOf(s: GameState, lo: Loadout, sampleInputTokens = REF_IN_TOKENS): RooflineMetrics {
  const plan = rackPlan(s, lo)
  const full = rackLoadEstimate(s, lo, busySprites(s, lo), midDecodeContext(REF_IN_TOKENS, REF_OUT_TOKENS))
  return {
    decodeTokSb1: decodeTokSb1(s, lo),
    computeRoofTokS: computeRoofTokS(s, lo),
    prefillTokS: serverPrefillSpeed(s, lo, sampleInputTokens),
    computeCeiling: serverComputeCeiling(s, lo),
    bandwidthCeiling: serverBandwidthCeiling(s, lo),
    binding: full.computeBound ? 'compute' : 'bandwidth',
    fits: plan.fits,
    plan,
  }
}

/** One weight-format setting a rack can take (undefined = auto) and what it does to the loaded model. */
export interface FormatChoice {
  /** the rack setting (undefined = auto). */
  setting: WeightFormat | undefined
  /** the format the rack would actually serve in. */
  format: WeightFormat
  /** the loaded model fits the rack in it. */
  fits: boolean
  /** flat quality points it costs the loaded model (0 = lossless). */
  tax: number
}

/**
 * The weight-format settings a rack can switch between (between waves): auto, then every
 * researched format its hardware runs (and the model's own release format). Mirrors
 * actions.setRackPrecision — a choice the model does not fit in is listed but refused there.
 */
export function rackFormatChoices(s: GameState, tw: Tower): FormatChoice[] {
  if (tw.def.kind !== 'server' || !tw.hwId) return []
  const hw = HARDWARE_DEFS[tw.hwId] ?? null
  const model = tw.modelId ? resolveModel(s, tw.modelId) : null
  // a checkpoint released below 16 bits never inflates to BF16: that setting would only
  // repeat its own release format, so it is not offered
  const formats = availableFormats(s, hw, model).filter((f) => !(f === 'bf16' && model && model.nativeWeightBytes < 1.5))
  const settings: (WeightFormat | undefined)[] = [undefined, ...formats]
  return settings.map((setting) => {
    const lo = loadout(s, tw.hwId, tw.modelId, setting)
    return {
      setting,
      format: model ? servingFormat(s, lo) : (setting ?? 'bf16'),
      fits: !model || serverFitsMemory(s, lo),
      tax: model ? ptqTax(s, lo) : 0,
    }
  })
}

/** The next setting a rack's format button cycles to (skipping ones the model would not fit in); null = none. */
export function nextFormatChoice(s: GameState, tw: Tower): FormatChoice | null {
  const choices = rackFormatChoices(s, tw)
  if (choices.length < 2) return null
  const cur = Math.max(0, choices.findIndex((c) => c.setting === tw.precision))
  for (let k = 1; k < choices.length; k++) {
    const c = choices[(cur + k) % choices.length]
    if (c.fits) return c
  }
  return null
}

/** How a model spreads over a rack (Expert readout): GPUs per copy, tensor-parallel degree, stages, copies, format. */
export interface ParallelSummary {
  g: number
  tpDeg: number
  stages: number
  replicas: number
  format: WeightFormat
  /** why it does not deploy here (null = it does). */
  blocker: 'vram' | 'tp' | 'pp' | null
}

export function parallelSummary(s: GameState, lo: Loadout): ParallelSummary {
  const p = rackPlan(s, lo)
  return {
    g: p.g,
    tpDeg: p.tpDeg,
    stages: p.stages,
    replicas: p.replicas,
    format: lo.model ? servingFormat(s, lo) : 'bf16',
    blocker: deployBlocker(s, lo),
  }
}

/* ------------------------------------------------------------------ *
 *  VRAM breakdown (weights + KV + headroom, §5.6)                    *
 * ------------------------------------------------------------------ */

export interface VramBreakdown {
  /** total HBM (GB) on the rack. */
  totalGb: number
  /** resident weight memory (GB) of every model copy on the rack (+ speculative draft heads). */
  weightsGb: number
  /** framework / activation overhead (GB) of the GPUs the copies run on. */
  frameworkGb: number
  /** usable KV budget (GB) of every copy = (group HBM − weights − framework) × allocator quality. */
  kvFreeGb: number
  /** unused headroom (GB): allocator waste plus GPUs no whole copy fits on. */
  headroomGb: number
}

export function vramOf(s: GameState, lo: Loadout): VramBreakdown {
  const totalGb = lo.hw?.hbmGb ?? 0
  const p = rackPlan(s, lo)
  const copies = p.fits ? p.replicas : 0
  const weightsGb = copies > 0 ? copies * (p.weightGb + p.draftGb) : serverModelMemory(s, lo)
  const frameworkGb = (copies > 0 ? copies * p.g : 1) * frameworkGbPerGpu(s)
  const kvUsable = kvFreeGb(s, lo)
  // headroom = whatever HBM the KV allocator does not turn into usable KV (and idle GPUs).
  const headroomGb = Math.max(0, totalGb - weightsGb - frameworkGb - kvUsable)
  return { totalGb, weightsGb, frameworkGb, kvFreeGb: kvUsable, headroomGb }
}

/* ------------------------------------------------------------------ *
 *  Sparsity (active / total, §6.1)                                   *
 * ------------------------------------------------------------------ */

export interface Sparsity {
  totalB: number
  activeB: number
  /** active / total (1.0 for dense; far smaller for MoE). */
  ratio: number
  isMoE: boolean
}

export function sparsityOf(lo: Loadout): Sparsity {
  const m = lo.model
  if (!m) return { totalB: 0, activeB: 0, ratio: 1, isMoE: false }
  return {
    totalB: m.paramsTotalB,
    activeB: m.paramsActiveB,
    ratio: m.paramsTotalB > 0 ? m.paramsActiveB / m.paramsTotalB : 1,
    isMoE: m.isMoE,
  }
}

/* ------------------------------------------------------------------ *
 *  Effective batch — mirrors combat.ts admission (slots ∩ KV)        *
 * ------------------------------------------------------------------ */

/**
 * The real concurrent streams a rack holds when busy (ESTIMATE_SPRITES_PER_LANE cohorts per lane) at a representative sequence
 * length, matching combat.ts: every scheduler slot takes a request cohort (COHORT_STREAMS
 * streams), the KV of the copy it lands on caps the cohort further, and a stream whose KV
 * alone exceeds a copy is never admitted (0).
 */
export function effectiveBatch(
  s: GameState,
  lo: Loadout,
  contextLen = midDecodeContext(REF_IN_TOKENS, REF_OUT_TOKENS),
): number {
  if (!serverFitsMemory(s, lo)) return 0
  return Math.round(rackLoadEstimate(s, lo, busySprites(s, lo), contextLen).streams)
}

/* ------------------------------------------------------------------ *
 *  Latency on a busy rack (§0.4 / §5.7)                               *
 * ------------------------------------------------------------------ */

export interface LatencyMetrics {
  /** time-to-first-token (ms): the prompt's prefill on one lane + the admission wait (pipeline bubble, multi-step). */
  ttftMs: number
  /** time-per-output-token (ms): 1 / per-user decode rate on a busy rack. */
  tpotMs: number
  /** end-to-end latency (ms): ttft + (outputTokens − 1) × tpot. */
  e2elMs: number
  /** per-user decode rate (tok/s) on a busy rack (§5.7). */
  perUserDecodeTokS: number
  /** aggregate decode rate (tok/s) of the whole rack at that batch (§5.7). */
  aggDecodeTokS: number
  /** the real concurrent streams this latency assumes. */
  batch: number
}

/**
 * The latency of serving one request of (input, output) tokens on this rack on a busy rack
 * of such requests — the same lane step combat runs (weights + every stream's KV re-read,
 * the cohorts' background prompts, speculative decoding while it pays) and the same TTFT
 * terms (prefill + admission wait). `axis` sets the speculative acceptance (default chat).
 */
export function latencyOf(
  s: GameState,
  lo: Loadout,
  inputTokens: number,
  outputTokens: number,
  axis: CapabilityAxis = 'chat',
): LatencyMetrics {
  const est = rackLoadEstimate(s, lo, busySprites(s, lo), midDecodeContext(inputTokens, outputTokens), {
    inputTokens,
    outputTokens,
    axis,
  })
  const prefillRate = serverPrefillSpeed(s, lo, inputTokens)
  const perUser = est.perUserTokS
  const ttftSec =
    prefillRate > 0 ? inputTokens / prefillRate + admissionDelaySec(s, lo, Number.isFinite(est.stepSec) ? est.stepSec : 0) : Infinity
  const tpotSec = perUser > 0 ? 1 / perUser : Infinity
  const decodeSec = outputTokens > 0 ? (outputTokens - 1) * tpotSec : 0
  return {
    ttftMs: ttftSec * 1000,
    tpotMs: tpotSec * 1000,
    e2elMs: (ttftSec + decodeSec) * 1000,
    perUserDecodeTokS: perUser,
    aggDecodeTokS: est.aggTokS,
    batch: Math.round(est.streams),
  }
}

/** Whether a rack would meet a request type's SLO on a busy rack (§6.4). */
export function meetsSlo(s: GameState, lo: Loadout, def: RequestTypeDef): boolean {
  const lat = latencyOf(s, lo, def.inputTokens, def.outputTokens, def.primaryAxis)
  const cls = LAT_CLASS_SLO[def.latClass]
  const ttftBound = def.ttftSloMs ?? cls.ttftMs
  if (lat.ttftMs > ttftBound) return false
  if (lat.tpotMs > cls.tpotMs) return false
  if (def.e2elSloMs !== undefined && lat.e2elMs > def.e2elSloMs) return false
  return true
}

/* ------------------------------------------------------------------ *
 *  $/Mtoken (§5.8) — ($/hour × 1e6) / (aggTokS × 3600)               *
 * ------------------------------------------------------------------ */

/**
 * Unit serving cost in real USD per MILLION tokens (§5.8). The identity is the
 * hourly bill amortized over the tokens that hour produces:
 *   tokens/hour = aggTokS × 3600
 *   $/Mtoken    = ($/hour × 1e6) / (aggTokS × 3600)
 * Worked example (§5.8): $3/hour at 500 tok/s, 100% util → 3/(500×3600)×1e6
 *   = $1.667/Mtoken. `aggTokS` is the AGGREGATE decode throughput (every stream
 * the rack serves), since the wall-clock bill is shared across every token it emits.
 */
export function dollarsPerMtoken(usdPerHour: number, aggTokS: number): number {
  if (aggTokS <= 0) return Infinity
  return (usdPerHour * 1e6) / (aggTokS * 3600)
}

/**
 * The rack's serving cost in $/Mtoken (output) on a busy rack of the representative request
 * — the real number the dashboards show AND the rate its cash flow obeys: a board rack bills
 * RACKS_PER_TILE real racks' GPU-hours + energy, and earns on TRAFFIC_SCALE × the tokens its
 * sprites progress, which is those racks' aggregate (the cohort identity, config.ts).
 */
export function rackDollarsPerMtoken(
  s: GameState,
  lo: Loadout,
  contextLen = midDecodeContext(REF_IN_TOKENS, REF_OUT_TOKENS),
): number {
  if (!lo.hw) return Infinity
  const est = rackLoadEstimate(s, lo, busySprites(s, lo), contextLen, {
    inputTokens: REF_IN_TOKENS,
    outputTokens: REF_OUT_TOKENS,
  })
  return dollarsPerMtokenAt(s, lo, est.aggTokS, 1)
}

/* ------------------------------------------------------------------ *
 *  Power vs cooling headroom (§5.5) + fleet aggregates               *
 * ------------------------------------------------------------------ */

/** A rack's real electrical draw (kW) and whether its TDP tier mandates liquid cooling. */
export function rackPowerKw(s: GameState, lo: Loadout): number {
  return serverPower(s, lo)
}

export interface PowerHeadroom {
  usedKw: number
  capKw: number
  /** 0..1 fraction of capacity in use. */
  frac: number
  /** true once draw exceeds the cap (the red threshold, §5.5). */
  overCap: boolean
}

export function powerHeadroom(s: GameState): PowerHeadroom {
  const usedKw = s.power.used
  const capKw = s.power.cap
  return { usedKw, capKw, frac: capKw > 0 ? usedKw / capKw : 0, overCap: usedKw > capKw }
}

export function coolingHeadroom(s: GameState): PowerHeadroom {
  const usedKw = s.cooling.used
  const capKw = s.cooling.cap
  return { usedKw, capKw, frac: capKw > 0 ? usedKw / capKw : 0, overCap: usedKw > capKw }
}

/* ------------------------------------------------------------------ *
 *  Live fleet operations (S2 LiveOpsStrip)                           *
 * ------------------------------------------------------------------ */

export interface FleetMetrics {
  /** Goodput: % of this wave's terminal requests served cleanly (the headline, §1.3). */
  goodputPct: number
  /** requests answered per second over the rolling window. */
  rps: number
  /** in-flight request count. */
  inflight: number
  /** p95 in-service elapsed time (seconds) of requests currently in flight. */
  p95WaitSec: number
  /** mean fleet $/Mtoken across online serving racks (cost telemetry, §5.8). */
  dollarsPerMtoken: number
  /** KV-cache utilization fraction (allocator quality, §4.2). */
  kvUtilPct: number
  /** fleet utilization = servedTokS / theoreticalMax (rolling, §6.6). */
  fleetUtilPct: number
  /** real operating burn in credits per board-second right now (GPU-hours + energy, as updateEconomy bills it). */
  burnPerSec: number
}

/** Online serving racks (placed servers, online, not requisitioned for a training run). */
export function onlineServers(s: GameState): Tower[] {
  return s.towers.filter((t) => t.def.kind === 'server' && t.online && t.throttle > 0 && !t.training)
}

function inServiceElapsedSec(r: Request): number {
  return r.prefillDoneAt === undefined ? r.queueSec : r.e2elReal
}

export function fleetMetrics(s: GameState): FleetMetrics {
  const ws = s.waveStats
  // the ONE Goodput formula the wave report and the agent bridge also use (sim/telemetry)
  const goodputPct = ws ? goodputPctOf(ws) : 100
  // rolling RPS over the telemetry window (matches sim/telemetry answersPerSec).
  const WINDOW = 5
  const rps = ws ? ws.recentServes.length / WINDOW : 0
  const ages = s.requests.filter((r) => r.alive).map(inServiceElapsedSec)
  ages.sort((a, b) => a - b)
  const p95WaitSec = ages.length ? ages[Math.min(ages.length - 1, Math.ceil(ages.length * 0.95) - 1)] : 0

  let dpmSum = 0
  let dpmN = 0
  for (const tw of onlineServers(s)) {
    const lo = loadoutOf(s, tw)
    if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) continue
    const dpm = rackDollarsPerMtoken(s, lo)
    if (Number.isFinite(dpm)) {
      dpmSum += dpm
      dpmN++
    }
  }
  // the bill exactly as updateEconomy charges it this tick (training racks and the
  // generative guardrail's own rack included; the power price scales the energy line)
  let burn = 0
  for (const tw of s.towers) {
    const op = towerOpexPerSec(s, tw)
    burn += op.gpu + op.energy
  }
  return {
    goodputPct,
    rps,
    inflight: s.requests.filter((r) => r.alive).length,
    p95WaitSec,
    dollarsPerMtoken: dpmN ? dpmSum / dpmN : 0,
    kvUtilPct: s.infra.kv.utilization * 100,
    fleetUtilPct: s.utilization * 100,
    burnPerSec: burn,
  }
}

/* ------------------------------------------------------------------ *
 *  Outcome tallies + the honest Goodput (§2.5 / §1.3)                *
 * ------------------------------------------------------------------ */

/** Anything carrying the seven outcome counters (WaveStats, WaveReport, GameStats, WaveTypeStat). */
export type OutcomeTally = { [K in Outcome]: number }

/** Every terminal outcome: served, late, wrong, unsafe, refused, unservable and dropped. */
export function terminalTotal(c: OutcomeTally): number {
  return c.served + c.sloMiss + c.bad + c.unsafe + c.overRefused + c.unservable + c.leaked
}

/**
 * Goodput = clean serves ÷ EVERY terminal outcome — the DistServe / SLO-goodput
 * reading: a refused, breached, rejected or dropped request is not good output.
 * `served` already excludes late answers (those resolve as `sloMiss`). The live
 * gauge, the wave report and the end screen all read this one formula; 100 when
 * nothing has finished yet.
 */
export function honestGoodputPct(c: OutcomeTally): number {
  const total = terminalTotal(c)
  return total > 0 ? (100 * c.served) / total : 100
}

/* ------------------------------------------------------------------ *
 *  Upcoming traffic + per-archetype fit (deploy picker, rack card)   *
 * ------------------------------------------------------------------ */

/** One archetype in the traffic the player is preparing for (the hardest instance of it). */
export interface TrafficEntry {
  def: RequestTypeDef
  /** requests of this archetype the wave spawns (after the incident's volume modifier). */
  count: number
  /** resolved quality line on the judged axis = difficulty[primaryAxis] × complexityMul. */
  difficulty: number
  /** era-scaled context demand (the long-context quality penalty input). */
  context: number
  inputTokens: number
  outputTokens: number
}

export interface UpcomingTraffic {
  /** 0-based index of the wave this traffic belongs to. */
  waveIndex: number
  /** true while that wave is being served (the current wave), false for the next one. */
  live: boolean
  /** archetypes, most numerous first. */
  entries: TrafficEntry[]
  total: number
}

/**
 * The traffic the player is preparing for: the wave being served (wave phase) or
 * the NEXT authored wave (build phase). Mirrors spawnRequest's per-group scaling
 * (complexityMul → difficulty, contextMul → prompt + context, √workMul → prompt,
 * workMul → output) and the telegraphed incident's volume modifier. Endless waves
 * are generated at START, so between endless waves the last one stands in.
 */
export function upcomingTraffic(s: GameState): UpcomingTraffic | null {
  let waveIndex = s.waveIndex
  let live = false
  let groups = s.currentWave?.groups ?? null
  if (s.phase === 'wave' && groups) {
    live = true
  } else {
    waveIndex = s.waveIndex + 1
    groups = waveIndex < WAVES.length ? WAVES[waveIndex].groups : s.endless ? groups : null
  }
  if (!groups) return null
  const byId = new Map<string, TrafficEntry>()
  for (const g of groups) {
    const def = REQUEST_TYPES[g.typeId]
    if (!def) continue
    const workMul = g.workMul ?? 1
    const contextMul = g.contextMul ?? 1
    const count = Math.max(1, Math.round(g.count * s.modifiers.volume))
    const inputTokens = Math.max(1, Math.round(def.inputTokens * contextMul * Math.max(1, Math.sqrt(workMul))))
    const outputTokens = Math.max(def.outputTokens > 0 ? 1 : 0, Math.round(def.outputTokens * workMul))
    const difficulty = (def.difficulty[def.primaryAxis] ?? 0) * (g.complexityMul ?? 1)
    const context = Math.round(def.context * contextMul)
    const e = byId.get(def.id)
    if (!e) {
      byId.set(def.id, { def, count, difficulty, context, inputTokens, outputTokens })
    } else {
      e.count += count
      e.difficulty = Math.max(e.difficulty, difficulty)
      e.context = Math.max(e.context, context)
      e.inputTokens = Math.max(e.inputTokens, inputTokens)
      e.outputTokens = Math.max(e.outputTokens, outputTokens)
    }
  }
  const entries = [...byId.values()].sort((a, b) => b.count - a.count || a.def.id.localeCompare(b.def.id))
  return { waveIndex, live, entries, total: entries.reduce((n, e) => n + e.count, 0) }
}

/** Hidden reasoning tokens a model emits per answer at full effort (0 = an instruct model). */
export function modelThinkTokens(m: ModelDef | null | undefined): number {
  return m?.thinkTokens ?? 0
}

/** Every latency bound a request class is judged against (ms; Infinity = no bound). */
export interface SloBounds {
  ttftMs: number
  tpotMs: number
  e2elMs: number
  /** time to first ANSWER token (thinking models on interactive traffic). */
  ttfatMs: number
}

export function sloBoundsOf(def: RequestTypeDef): SloBounds {
  const cls = LAT_CLASS_SLO[def.latClass]
  return {
    ttftMs: def.ttftSloMs ?? cls.ttftMs,
    tpotMs: cls.tpotMs,
    e2elMs: def.e2elSloMs ?? Infinity,
    ttfatMs: def.ttfatSloMs ?? Infinity,
  }
}

export interface TypeFit {
  /** meets every latency bound of its class on a busy rack. */
  fast: boolean
  /** the first bound it would miss (null = on time). */
  slowBy: SloCause | null
  /** answers correctly: effective quality on the judged axis clears the difficulty. */
  smart: boolean
  /** effQ − difficulty (≥ 0 = a correct answer). */
  margin: number
  /** effective quality on the judged axis after the long-context and quantization penalties. */
  effQ: number
  /** prompt + hidden reasoning + answer fit the context window and one model copy's KV (else unservable). */
  window: boolean
  lat: LatencyMetrics
  /** hidden reasoning tokens this rack's model thinks before answering it (0 = instruct). */
  thinkTokens: number
  /** time to the first answer token (ms): TTFT plus the hidden thinking. */
  ttfatMs: number
  /** end-to-end time (ms) including hidden thinking tokens. */
  e2elMs: number
}

/**
 * Would this rack serve one request of an archetype cleanly? The same gates combat applies,
 * on a busy rack: the latency bounds of its class (TTFT, time to first ANSWER token with a
 * thinking model's hidden reasoning, TPOT over every generated token, E2E), the judged-axis
 * quality margin (qualityBy − the format and alignment taxes − the long-context penalty at the
 * answer's mean sequence), and the hard capacity gates (the full sequence inside the window,
 * one stream's KV inside one model copy).
 */
export function rackFit(
  s: GameState,
  lo: Loadout,
  def: RequestTypeDef,
  inputTokens: number,
  outputTokens: number,
  difficulty: number,
): TypeFit {
  const think = outputTokens > 0 ? hiddenTokensFor(lo.model, def.thinkMul) : 0
  const generated = outputTokens + think
  const lat = latencyOf(s, lo, inputTokens, generated, def.primaryAxis)
  const thinkMs = think > 0 ? (Number.isFinite(lat.tpotMs) ? think * lat.tpotMs : Infinity) : 0
  const ttfatMs = lat.ttftMs + thinkMs
  const b = sloBoundsOf(def)
  let slowBy: SloCause | null = null
  if (lat.ttftMs > b.ttftMs) slowBy = 'ttft'
  else if (ttfatMs > b.ttfatMs) slowBy = 'ttfat'
  else if (generated > 1 && lat.tpotMs > b.tpotMs) slowBy = 'tpot'
  else if (lat.e2elMs > b.e2elMs) slowBy = 'e2el'
  const effQ = lo.model
    ? serverQualityVs(s, lo, def.primaryAxis) - longContextPenalty(s, lo, midDecodeContext(inputTokens, generated))
    : 0
  const margin = effQ - difficulty
  const seq = inputTokens + generated
  const win = serverCtxWindowTokens(s, lo)
  const plan = rackPlan(s, lo)
  const fits = (win <= 0 || seq <= win) && (!lo.model || !plan.fits || kvPerReqGb(s, lo.model, seq) <= plan.kvGbPerReplica)
  return {
    fast: slowBy === null,
    slowBy,
    smart: margin >= 0,
    margin,
    effQ,
    window: fits,
    lat,
    thinkTokens: think,
    ttfatMs,
    e2elMs: lat.e2elMs,
  }
}

/** `rackFit` for an archetype in the upcoming traffic (its hardest instance). */
export function typeFit(s: GameState, lo: Loadout, e: TrafficEntry): TypeFit {
  return rackFit(s, lo, e.def, e.inputTokens, e.outputTokens, e.difficulty)
}

/** The smallest rack tier on the upgrade ladder that holds this model at the current quant. */
export function smallestRackFor(s: GameState, m: ModelDef): ServerHardwareDef | null {
  for (const id of HARDWARE_TIERS) {
    const hw = HARDWARE_DEFS[id]
    if (hw && serverFitsMemory(s, { hw, model: m })) return hw
  }
  return null
}

/** One row of the deploy picker: how this checkpoint would do on THIS rack against the upcoming traffic. */
export interface DeployCandidate {
  model: ModelDef
  /** deployable on this rack now (VRAM fit) — or already loaded. */
  fits: boolean
  current: boolean
  /** weights + framework overhead this model needs at the current quant (GB). */
  needGb: number
  /** the smallest rack tier that would hold it (null = nothing on the ladder). */
  needHw: ServerHardwareDef | null
  /**
   * why it does not deploy on THIS rack: 'vram' (no GPU group holds it), or the parallelism
   * research it needs to span this rack's GPUs ('tp' Tensor / 'pp' Pipeline). null = it fits.
   */
  blocker: 'vram' | 'tp' | 'pp' | null
  /** GPUs one copy would span on this rack (the group the parallelism research must unlock); 0 when it fits. */
  spanGpus: number
  /** mid-wave, a Multi-LoRA adapter swap on the loaded base: deployable now without a weight reload. */
  hotSwap: boolean
  /** per-user decode tok/s on a busy rack of this tier (a 1.5K-in / 256-out request). */
  perUserTokS: number
  tpotMs: number
  /** count-weighted effective quality on the judged axes of the upcoming traffic. */
  judgedQ: number
  /** archetypes it would serve fast ∧ smart ∧ in-window, of those in the upcoming traffic. */
  clears: number
  kinds: number
  /** count-weighted share of upcoming requests it would serve cleanly (0..1). */
  score: number
  safety: number
  overRefusal: number
  /** hidden reasoning tokens per answer (0 = instruct). */
  thinkTokens: number
  thinking: boolean
  /** ★ the best fit for the upcoming traffic on this rack. */
  recommended: boolean
  /** per-archetype verdicts (same order as the traffic entries); empty when it does not fit. */
  fit: TypeFit[]
}

/**
 * Score every owned checkpoint (base + derived) on one rack against the upcoming
 * traffic: VRAM fit (and the tier that would hold it), per-user speed, the judged-
 * axis quality and how many archetypes it would serve cleanly, plus its alignment.
 * Pure; callers memoize it — it is ~50 models × the wave's archetypes.
 */
export function deployCandidates(s: GameState, tw: Tower, traffic: UpcomingTraffic | null): DeployCandidate[] {
  const out: DeployCandidate[] = []
  const entries = traffic?.entries ?? []
  const totalCount = entries.reduce((n, e) => n + e.count, 0)
  const loaded = tw.modelId ? resolveModel(s, tw.modelId) : null
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id)
    if (!m) continue
    const lo = loadout(s, tw.hwId, id, tw.precision)
    const current = tw.modelId === id
    const fits = current || serverDeployable(s, lo)
    const think = modelThinkTokens(m)
    const c: DeployCandidate = {
      model: m,
      fits,
      current,
      hotSwap: s.phase === 'wave' && fits && !current && loraSiblings(s, loaded, m),
      needGb: serverModelMemory(s, { hw: null, model: m }) + FRAMEWORK_GB,
      needHw: fits ? null : smallestRackFor(s, m),
      blocker: fits ? null : deployBlocker(s, lo),
      spanGpus: fits ? 0 : rackPlan(s, lo).g,
      perUserTokS: 0,
      tpotMs: Infinity,
      judgedQ: 0,
      clears: 0,
      kinds: entries.length,
      score: 0,
      safety: m.alignment.safety,
      overRefusal: m.alignment.overRefusal,
      thinkTokens: think,
      thinking: m.isReasoning || think > 0,
      recommended: false,
      fit: [],
    }
    if (fits && serverFitsMemory(s, lo)) {
      const ref = latencyOf(s, lo, REF_IN_TOKENS, REF_OUT_TOKENS)
      c.perUserTokS = ref.perUserDecodeTokS
      c.tpotMs = ref.tpotMs
      if (entries.length) {
        let qSum = 0
        let okCount = 0
        for (const e of entries) {
          const f = typeFit(s, lo, e)
          c.fit.push(f)
          qSum += f.effQ * e.count
          if (f.fast && f.smart && f.window) {
            c.clears++
            okCount += e.count
          }
        }
        c.judgedQ = totalCount ? qSum / totalCount : 0
        c.score = totalCount ? okCount / totalCount : 0
      } else {
        c.judgedQ = serverQuality(s, lo)
      }
    }
    out.push(c)
  }
  let best: DeployCandidate | null = null
  for (const c of out) {
    if (!c.fits || c.score <= 0) continue
    if (
      !best ||
      c.score > best.score ||
      (c.score === best.score && (c.judgedQ > best.judgedQ || (c.judgedQ === best.judgedQ && c.perUserTokS > best.perUserTokS)))
    )
      best = c
  }
  if (best) best.recommended = true
  return out
}

/** What one RACK → upgrade buys: memory, bandwidth (as the decode speed-up of the loaded model), power, $/hr. */
export interface HwUpgradeDelta {
  from: ServerHardwareDef
  to: ServerHardwareDef
  cost: number
  /** per-user decode speed-up with the current model (to ÷ from) at each rack's effective batch. */
  decodeMul: number
  kwFrom: number
  kwTo: number
  /** a liquid-cooled tier with no Liquid Cooling Loop on the board yet. */
  needsLiquid: boolean
}

export function hwUpgradeDelta(s: GameState, tw: Tower): HwUpgradeDelta | null {
  const to = nextHardware(tw)
  const from = tw.hwId ? HARDWARE_DEFS[tw.hwId] : null
  if (!to || !from) return null
  const model = tw.modelId ? resolveModel(s, tw.modelId) : null
  const a: Loadout = { hw: from, model, precision: tw.precision }
  const b: Loadout = { hw: to, model, precision: tw.precision }
  const pa = latencyOf(s, a, REF_IN_TOKENS, REF_OUT_TOKENS).perUserDecodeTokS
  const pb = latencyOf(s, b, REF_IN_TOKENS, REF_OUT_TOKENS).perUserDecodeTokS
  return {
    from,
    to,
    cost: hardwareUpgradeCost(s, tw),
    decodeMul: pa > 0 && pb > 0 ? pb / pa : to.hbmTbs / from.hbmTbs,
    kwFrom: serverPower(s, a),
    kwTo: serverPower(s, b),
    needsLiquid: hwNeedsLiquid(to) && !hasLiquidLoop(s),
  }
}

/** Placed servers in id order — every bulk action walks this order so it stays deterministic. */
function serversById(s: GameState): Tower[] {
  return s.towers.filter((t) => t.def.kind === 'server').sort((a, b) => a.id - b.id)
}

/** Racks of `tw`'s hardware tier (itself included) that could take `modelId` now and do not already run it. */
export function sameTierTargets(s: GameState, tw: Tower, modelId: string): Tower[] {
  return serversById(s).filter(
    (t) => t.hwId === tw.hwId && t.modelId !== modelId && serverDeployable(s, loadout(s, t.hwId, modelId, t.precision)),
  )
}

/** Every rack on the board where `modelId` fits and is not already deployed (the one-click rollout). */
export function rolloutTargets(s: GameState, modelId: string): Tower[] {
  return serversById(s).filter(
    (t) => t.modelId !== modelId && serverDeployable(s, loadout(s, t.hwId, modelId, t.precision)),
  )
}

/** UPGRADE ALL: every rack of `tw`'s tier, the per-rack price, and how many the cash covers in id order. */
export interface UpgradeAllPlan {
  ids: number[]
  each: number
  total: number
  affordable: number
  to: ServerHardwareDef
  needsLiquid: boolean
}

export function upgradeAllPlan(s: GameState, tw: Tower): UpgradeAllPlan | null {
  const to = nextHardware(tw)
  if (!to) return null
  const ids = serversById(s)
    .filter((t) => t.hwId === tw.hwId)
    .map((t) => t.id)
  if (ids.length < 2) return null
  const each = hardwareUpgradeCost(s, tw)
  const affordable = each > 0 ? Math.min(ids.length, Math.floor(Math.max(0, s.meters.cash) / each)) : ids.length
  return { ids, each, total: each * ids.length, affordable, to, needsLiquid: hwNeedsLiquid(to) && !hasLiquidLoop(s) }
}

/* ------------------------------------------------------------------ *
 *  Safety readouts (model layer 1 + guardrail layer 2)               *
 * ------------------------------------------------------------------ */

/** Chance the model's own alignment clears an archetype's hazards at serve time (1 for benign traffic). */
export function selfHandleRate(m: ModelDef, def: RequestTypeDef): number {
  let p = 1
  for (const h of ALL_HAZARDS) {
    const sev = def.hazards?.[h]
    if (sev !== undefined) p *= pSelfHandle(m, h, sev)
  }
  return p
}

export interface GuardStats {
  latencyMs: number
  /** chance it clears one covered hazard at the current threshold (+ red-team calibration). */
  recall: number
  /** chance it wrongly blocks a benign request. */
  overRefusal: number
  /** each hazard it lists, and whether detection for it is unlocked yet. */
  hazards: { hazard: SafetyHazard; unlocked: boolean }[]
}

export function guardStats(s: GameState, spec: GuardrailSpec): GuardStats {
  return {
    latencyMs: guardLatencyMs(s, spec),
    recall: effRecall(spec.baseRecall, s.guardrailThreshold, redteamRecallBonus(s)),
    overRefusal: overRefuse(spec.archetype, s.guardrailThreshold, overrefMul(s)),
    hazards: spec.catches.map((hazard) => ({ hazard, unlocked: categoryUnlocked(s, hazard) })),
  }
}

/* ------------------------------------------------------------------ *
 *  Live request diagnosis (S4 RequestInspector)                       *
 * ------------------------------------------------------------------ */

/** Why an open hazard is (or is not) going to be cleared. */
export type HazardVerdict = 'cleared' | 'locked' | 'noGuard' | 'catchable'

export interface RequestDiagnosis {
  stage: 'queued' | 'prefill' | 'decode' | 'done'
  /** 0..1 progress through prompt ingestion / answer generation. */
  prefillFrac: number
  decodeFrac: number
  /** real ms to first token: the latched value once prefill is done, else the wait so far. */
  ttftMs: number
  ttftFinal: boolean
  /** per-token time (ms) on the rack generating it (null before decode starts). */
  tpotMs: number | null
  e2elMs: number
  bounds: SloBounds
  /** the resolved quality line on the judged axis. */
  difficulty: number
  /** quality lost to the context gap + INT4 long-context tax on the answering rack. */
  ctxPenalty: number
  /** the answering rack's effective quality on the judged axis (null = no rack yet). */
  rackQ: number | null
  /** best margin a rack has scored it with (null = not scored yet). */
  margin: number | null
  guardsPassed: number
  guardMs: number
  thinkTokens: number
  rack: Tower | null
  hazards: { hazard: SafetyHazard; severity: number; verdict: HazardVerdict }[]
  /** the outcome it is heading for if nothing changes. */
  forecast: Outcome
  /** false when a guardrail on its path may still change an `unsafe` forecast. */
  certain: boolean
}

/** The rack answering this request: the sim's latch, else a rack working it last tick, else the nearest in range. */
function answeringRack(s: GameState, r: Request): Tower | null {
  if (r.answeredBy != null) {
    const t = s.towers.find((x) => x.id === r.answeredBy)
    if (t) return t
  }
  let near: Tower | null = null
  let nearD = Infinity
  for (const t of s.towers) {
    if (t.def.kind !== 'server') continue
    if (t.prefillId === r.id || t.decodeIds?.includes(r.id)) return t
    if (!t.online || t.training) continue
    const dx = t.x - r.x
    const dy = t.y - r.y
    const d2 = dx * dx + dy * dy
    const reach = towerRangeTiles(t) * TILE
    if (d2 <= reach * reach && d2 < nearD) {
      near = t
      nearD = d2
    }
  }
  return near
}

export function diagnoseRequest(s: GameState, r: Request): RequestDiagnosis {
  const bounds = sloBoundsOf(r.def)
  const rack = answeringRack(s, r)
  const lo = rack ? loadoutOf(s, rack) : null
  const fits = !!lo && serverFitsMemory(s, lo)
  const prefillDone = r.prefillDoneAt !== undefined
  const stage: RequestDiagnosis['stage'] =
    r.work <= 0 && r.prefill <= 0 ? 'done' : prefillDone ? 'decode' : r.queueSec > 0 || rack ? 'prefill' : 'queued'

  let tpotMs: number | null = null
  if (rack && lo && fits && prefillDone && r.maxWork > 0) {
    // the per-user rate the rack's streams decoded at last tick; else the cohort estimate
    const live = rack.tokS ?? 0
    const perUser =
      live > 0
        ? live
        : rackLoadEstimate(s, lo, Math.max(1, rack.batch ?? 1), r.contextLen, {
            axis: r.def.primaryAxis,
            throttle: rack.throttle,
          }).perUserTokS
    tpotMs = perUser > 0 ? 1000 / perUser : Infinity
  }
  let rackQ: number | null = null
  let ctxPenalty = 0
  if (lo && fits) {
    ctxPenalty = longContextPenalty(s, lo, r.contextLen)
    rackQ = serverQualityVs(s, lo, r.def.primaryAxis) - ctxPenalty
  }
  const judged = r.bestQuality > -900
  const margin = judged ? r.bestQuality : rackQ !== null ? rackQ - r.difficulty : null

  let guardMs = 0
  const seen = r.guardsSeen
  if (seen?.size) {
    for (const t of s.towers) if (seen.has(t.id) && t.def.guardrail) guardMs += guardLatencyMs(s, t.def.guardrail)
  }
  const guards = s.towers.filter((t) => t.def.kind === 'guardrail' && t.online && t.def.guardrail)
  const hazards: RequestDiagnosis['hazards'] = []
  for (const h of ALL_HAZARDS) {
    const severity = r.hazards[h]
    if (severity === undefined) continue
    let verdict: HazardVerdict = 'cleared'
    if (r.hazardsOpen[h] !== undefined) {
      if (!categoryUnlocked(s, h)) verdict = 'locked'
      else if (!guards.some((g) => g.def.guardrail!.catches.includes(h))) verdict = 'noGuard'
      else verdict = 'catchable'
    }
    hazards.push({ hazard: h, severity, verdict })
  }

  const ttftMs = (prefillDone ? r.ttftReal : r.queueSec) * 1000
  const open = hazards.filter((h) => h.verdict !== 'cleared')
  let forecast: Outcome = 'served'
  let certain = true
  if (r.overRefused) forecast = 'overRefused'
  else if (r.windowBlocked && !prefillDone) forecast = 'unservable'
  else if (open.length && !r.safetyCleared) {
    forecast = 'unsafe'
    certain = !open.some((h) => h.verdict === 'catchable')
  } else if (margin !== null && margin < 0) forecast = 'bad'
  else if (
    r.sloViolated ||
    ttftMs > bounds.ttftMs ||
    (tpotMs !== null && tpotMs > bounds.tpotMs) ||
    r.e2elReal * 1000 > bounds.e2elMs
  )
    forecast = 'sloMiss'

  return {
    stage,
    prefillFrac: r.tokensIn > 0 ? 1 - Math.max(0, r.prefill) / r.tokensIn : 1,
    decodeFrac: r.maxWork > 0 ? 1 - Math.max(0, r.work) / r.maxWork : 1,
    ttftMs,
    ttftFinal: prefillDone,
    tpotMs,
    e2elMs: r.e2elReal * 1000,
    bounds,
    difficulty: r.difficulty,
    ctxPenalty,
    rackQ,
    margin,
    guardsPassed: seen?.size ?? 0,
    guardMs,
    thinkTokens: r.thinkTokens ?? 0,
    rack,
    hazards,
    forecast,
    certain,
  }
}

/* ------------------------------------------------------------------ *
 *  Formatting helpers (used by every surface; unit-suffixed)         *
 * ------------------------------------------------------------------ */

/** tok/s with a k suffix above 10k. */
export function fmtTokS(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v >= 10000) return (v / 1000).toFixed(1) + 'k'
  if (v >= 100) return v.toFixed(0)
  return v.toFixed(1)
}

/** A real-ms latency: whole ms under 10s, seconds above. */
export function fmtLatencyMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms >= 10000) return (ms / 1000).toFixed(1) + ' s'
  if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s'
  return ms.toFixed(0) + ' ms'
}

/** $/Mtoken with sensible precision. */
export function fmtDollarsPerMtoken(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v >= 100) return '$' + v.toFixed(0)
  if (v >= 1) return '$' + v.toFixed(2)
  return '$' + v.toFixed(3)
}

/** GB with one decimal under 100. */
export function fmtGb(v: number): string {
  if (v >= 1000) return (v / 1000).toFixed(2) + ' TB'
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' GB'
}

/** kW: 1 decimal under 10, whole at/above. */
export function fmtKw(v: number): string {
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' kW'
}

/** A token count with a k/M suffix. */
export function fmtTokens(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K'
  return v.toFixed(0)
}

/** Convert a credit value back to display USD (for $/GPU-hr style readouts). */
export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD
}
