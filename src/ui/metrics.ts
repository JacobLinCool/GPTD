/**
 * ui/metrics.ts — the READ-ONLY display-metric compute layer (§5.5).
 *
 * Every value here is computed the SAME way the deterministic sim computes it
 * (sim/effects.ts + sim/combat.ts), so the dashboards never drift from reality.
 * The module is PURE (no PixiJS / DOM) and is unit-tested against the §6 worked
 * examples. It must NEVER mutate GameState; it only reads it (AGENTS.md §2).
 *
 * Latency is reported as `effLatencyMs` (§0.4) — the concurrency-amortized
 * EQUIVALENT latency the sim judges SLOs against (per-user decode = aggregate
 * throughput / batch), NOT the bare b=1 latency. That is why a high-concurrency,
 * low-OSL chat request can fall back inside its SLO while a long-OSL reasoning
 * request stays tight — exactly the function Goodput is.
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
} from '../core/types'
import {
  computeRoofTokS,
  decodeThrottle,
  decodeTokSb1,
  guardLatencyMs,
  hasLiquidLoop,
  hwNeedsLiquid,
  int4ContextPenalty,
  kvFreeGb,
  kvPerReqGb,
  type Loadout,
  loadout,
  loadoutOf,
  rackOperatingCostPerSec,
  resolveModel,
  serverAggDecodeTokS,
  serverComputeCeiling,
  serverBandwidthCeiling,
  serverContext,
  serverCtxWindowTokens,
  serverDeployable,
  serverFitsMemory,
  serverModelMemory,
  serverPerUserDecodeTokS,
  serverPower,
  serverPrefillSpeed,
  serverQuality,
  serverQualityVs,
  serverTargets,
} from '../sim/effects'
import { HARDWARE_DEFS, HARDWARE_TIERS, REQUEST_TYPES, WAVES } from '../sim/content'
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

/** Which roof binds the rack at the deploy precision (§5.7). */
export type BindingRoof = 'compute' | 'bandwidth'

/* ------------------------------------------------------------------ *
 *  Per-rack roofline / throughput metrics                            *
 * ------------------------------------------------------------------ */

export interface RooflineMetrics {
  /** raw b=1 decode tok/s (bandwidth-bound, §5.7) — the §6 worked-example basis. */
  decodeTokSb1: number
  /** raw compute roof tok/s (the ceiling decode hits as batch grows, §5.7). */
  computeRoofTokS: number
  /** prefill tok/s for a representative prompt (compute-bound GEMM, super-linear). */
  prefillTokS: number
  /** UI compute ceiling (compute roof × engine/throughput muls). */
  computeCeiling: number
  /** UI bandwidth ceiling (b=1 decode × FlashAttn + spec-decode muls). */
  bandwidthCeiling: number
  /** which roof binds at the deploy precision: compute (low) vs bandwidth (high b=1). */
  binding: BindingRoof
  /** fits VRAM (weights + framework ≤ HBM). */
  fits: boolean
}

export function rooflineOf(s: GameState, lo: Loadout, sampleInputTokens = 1500): RooflineMetrics {
  const fits = serverFitsMemory(s, lo)
  const cc = serverComputeCeiling(s, lo)
  const bc = serverBandwidthCeiling(s, lo)
  return {
    decodeTokSb1: decodeTokSb1(s, lo),
    computeRoofTokS: computeRoofTokS(s, lo),
    prefillTokS: serverPrefillSpeed(s, lo, sampleInputTokens),
    computeCeiling: cc,
    bandwidthCeiling: bc,
    // the rack is compute-bound when its compute roof is the lower ceiling.
    binding: cc <= bc ? 'compute' : 'bandwidth',
    fits,
  }
}

/* ------------------------------------------------------------------ *
 *  VRAM breakdown (weights + KV + headroom, §5.6)                    *
 * ------------------------------------------------------------------ */

export interface VramBreakdown {
  /** total HBM (GB) on the rack. */
  totalGb: number
  /** resident weight memory (GB) = paramsTotalB × bytesPerParam. */
  weightsGb: number
  /** framework / activation overhead (GB) before KV. */
  frameworkGb: number
  /** usable KV budget (GB) = (HBM − weights − framework) × allocator quality. */
  kvFreeGb: number
  /** unused headroom (GB) the allocator does not reclaim. */
  headroomGb: number
}

export function vramOf(s: GameState, lo: Loadout): VramBreakdown {
  const totalGb = lo.hw?.hbmGb ?? 0
  const weightsGb = serverModelMemory(s, lo)
  const kvUsable = kvFreeGb(s, lo)
  // headroom = whatever HBM the KV allocator does not turn into usable KV.
  const headroomGb = Math.max(0, totalGb - weightsGb - FRAMEWORK_GB - kvUsable)
  return { totalGb, weightsGb, frameworkGb: FRAMEWORK_GB, kvFreeGb: kvUsable, headroomGb }
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
 *  Effective batch — mirrors combat.ts admission (serverTargets ∩ KV) *
 * ------------------------------------------------------------------ */

/**
 * The effective decode batch a rack would run at a representative sequence length,
 * matching combat.ts: the scheduler offers `serverTargets` slots, the KV budget
 * caps it further (each in-flight request reserves kvPerReqGb at its contextLen).
 * Pass `contextLen` (default a mid-length 8K seq) to size the KV reservation.
 */
export function effectiveBatch(s: GameState, lo: Loadout, contextLen = 8000): number {
  if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) return 0
  const slots = serverTargets(s, lo)
  if (slots <= 1) return slots
  const budget = kvFreeGb(s, lo)
  const per = kvPerReqGb(s, lo.model, contextLen)
  if (per <= 0) return slots
  // the first admit is always allowed (combat.ts), so KV caps at floor(budget/per) but ≥1.
  const kvCap = Math.max(1, Math.floor(budget / per))
  return Math.max(1, Math.min(slots, kvCap))
}

/* ------------------------------------------------------------------ *
 *  effLatencyMs (§0.4) — concurrency-amortized equivalent latency     *
 * ------------------------------------------------------------------ */

export interface LatencyMetrics {
  /** time-to-first-token (ms): prefill of the input prompt at the rack's prefill rate. */
  ttftMs: number
  /** time-per-output-token (ms): 1 / per-user decode rate at the effective batch. */
  tpotMs: number
  /** end-to-end latency (ms): ttft + (outputTokens − 1) × tpot. */
  e2elMs: number
  /** per-user decode rate (tok/s) at the effective batch (§5.7). */
  perUserDecodeTokS: number
  /** aggregate decode rate (tok/s) across the whole batch (§5.7). */
  aggDecodeTokS: number
  /** the effective batch this latency assumes. */
  batch: number
}

/**
 * The §0.4 concurrency-amortized latency of serving one request of (input,output)
 * tokens on this rack, at the effective batch. This is the EXACT quantity the sim
 * judges SLOs against (combat.ts: `tpotReal = 1/perUserDecode`, `e2elReal` accrues
 * at that rate). TTFT excludes lane transit / queue contention (those are runtime
 * state) — it is the rack's own prefill time for the prompt.
 */
export function latencyOf(s: GameState, lo: Loadout, inputTokens: number, outputTokens: number): LatencyMetrics {
  const contextLen = inputTokens + Math.max(0, outputTokens)
  const batch = Math.max(1, effectiveBatch(s, lo, contextLen))
  const prefillRate = serverPrefillSpeed(s, lo, inputTokens)
  const perUser = serverPerUserDecodeTokS(s, lo, batch)
  const agg = serverAggDecodeTokS(s, lo, batch)
  const ttftSec = prefillRate > 0 ? inputTokens / prefillRate : Infinity
  const tpotSec = perUser > 0 ? 1 / perUser : Infinity
  const decodeSec = outputTokens > 0 ? (outputTokens - 1) * tpotSec : 0
  return {
    ttftMs: ttftSec * 1000,
    tpotMs: tpotSec * 1000,
    e2elMs: (ttftSec + decodeSec) * 1000,
    perUserDecodeTokS: perUser,
    aggDecodeTokS: agg,
    batch,
  }
}

/** Whether a rack would meet a request type's SLO at the effective batch (§6.4). */
export function meetsSlo(s: GameState, lo: Loadout, def: RequestTypeDef): boolean {
  const lat = latencyOf(s, lo, def.inputTokens, def.outputTokens)
  const cls = LAT_CLASS_SLO[def.latClass]
  const ttftBound = def.ttftSloMs ?? cls.ttftMs
  if (lat.ttftMs > ttftBound) return false
  if (lat.tpotMs > cls.tpotMs) return false
  if (def.e2elSloMs !== undefined && lat.e2elMs > def.e2elSloMs) return false
  return true
}

/* ------------------------------------------------------------------ *
 *  $/Mtoken (§5.8) — ($/GPU-hr × 3600) / (aggTokS × 1e6)             *
 * ------------------------------------------------------------------ */

/**
 * Unit serving cost in real USD per MILLION tokens (§5.8). The identity is the
 * GPU-hour bill amortized over the tokens that hour produces:
 *   tokens/hour = aggTokS × 3600
 *   $/Mtoken    = ($/GPU-hr / (aggTokS × 3600)) × 1e6
 *               = ($/GPU-hr × 1e6) / (aggTokS × 3600)
 * Worked example (§5.8): $3/GPU-hr at 500 tok/s, 100% util → 3/(500×3600)×1e6
 *   = $1.667/Mtoken. `aggTokS` is the AGGREGATE decode throughput (all batch
 * slots), since the wall-clock bill is shared across every token the rack emits.
 */
export function dollarsPerMtoken(gpuHrUsd: number, aggTokS: number): number {
  if (aggTokS <= 0) return Infinity
  return (gpuHrUsd * 1e6) / (aggTokS * 3600)
}

/**
 * The rack's serving cost in $/Mtoken at its effective batch — the real number the
 * S3/S5 dashboards show. Uses the rack's $/GPU-hr and aggregate decode throughput.
 */
export function rackDollarsPerMtoken(s: GameState, lo: Loadout, contextLen = 8000): number {
  if (!lo.hw) return Infinity
  const batch = Math.max(1, effectiveBatch(s, lo, contextLen))
  const agg = serverAggDecodeTokS(s, lo, batch)
  return dollarsPerMtoken(lo.hw.gpuHrUsd, agg)
}

/** The §5.8 worked example uses the H100 $/GPU-hr (per-GPU, not aggregate) basis. */

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
  /** real operating burn in credits per board-second (Σ online racks' $/GPU-hr). */
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
  const goodputPct = ws ? honestGoodputPct(ws) : 100
  // rolling RPS over the telemetry window (matches sim/telemetry answersPerSec).
  const WINDOW = 5
  const rps = ws ? ws.recentServes.length / WINDOW : 0
  const ages = s.requests.filter((r) => r.alive).map(inServiceElapsedSec)
  ages.sort((a, b) => a - b)
  const p95WaitSec = ages.length ? ages[Math.min(ages.length - 1, Math.ceil(ages.length * 0.95) - 1)] : 0

  const servers = onlineServers(s)
  let dpmSum = 0
  let dpmN = 0
  let burn = 0
  for (const tw of servers) {
    const lo = loadoutOf(s, tw)
    if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) continue
    const dpm = rackDollarsPerMtoken(s, lo)
    if (Number.isFinite(dpm)) {
      dpmSum += dpm
      dpmN++
    }
    burn += rackOperatingCostPerSec(lo.hw)
  }
  return {
    goodputPct,
    rps,
    inflight: s.requests.filter((r) => r.alive).length,
    p95WaitSec,
    dollarsPerMtoken: dpmN ? dpmSum / dpmN : 0,
    kvUtilPct: s.infra.kv.utilization * 100,
    fleetUtilPct: s.utilization * 100,
    burnPerSec: burn * s.modifiers.powerPrice,
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

/** Hidden reasoning tokens a model emits per answer (0 = an instruct model). */
export function modelThinkTokens(m: ModelDef | null | undefined): number {
  return (m as (ModelDef & { thinkTokens?: number }) | null | undefined)?.thinkTokens ?? 0
}

/** How much of a thinking model's budget an archetype triggers (0 until the sim defines `thinkMul`). */
function typeThinkMul(def: RequestTypeDef): number {
  return (def as RequestTypeDef & { thinkMul?: number }).thinkMul ?? 0
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
    ttfatMs: (def as RequestTypeDef & { ttfatSloMs?: number }).ttfatSloMs ?? Infinity,
  }
}

export interface TypeFit {
  /** meets every latency bound of its class at the rack's effective batch. */
  fast: boolean
  /** the first bound it would miss (null = on time). */
  slowBy: SloCause | null
  /** answers correctly: effective quality on the judged axis clears the difficulty. */
  smart: boolean
  /** effQ − difficulty (≥ 0 = a correct answer). */
  margin: number
  /** effective quality on the judged axis after the long-context and INT4 penalties. */
  effQ: number
  /** the prompt fits the context window (else the request is unservable). */
  window: boolean
  lat: LatencyMetrics
  /** time to the first answer token (ms): TTFT plus any hidden thinking. */
  ttfatMs: number
  /** end-to-end time (ms) including hidden thinking tokens. */
  e2elMs: number
}

/**
 * Would this rack serve this archetype cleanly? The same three gates combat
 * applies — the latency bounds of its class (TTFT/TPOT/E2E, plus time to first
 * answer for thinking models), the judged-axis quality margin (combat's
 * scoreQuality: qualityBy − contextGap×0.45 − INT4 long-context tax), and the
 * hard context window — evaluated at the rack's effective batch.
 */
export function typeFit(s: GameState, lo: Loadout, e: TrafficEntry): TypeFit {
  const lat = latencyOf(s, lo, e.inputTokens, e.outputTokens)
  const think = modelThinkTokens(lo.model) * typeThinkMul(e.def)
  const thinkMs = Number.isFinite(lat.tpotMs) ? think * lat.tpotMs : think > 0 ? Infinity : 0
  const ttfatMs = lat.ttftMs + thinkMs
  const e2elMs = lat.e2elMs + thinkMs
  const b = sloBoundsOf(e.def)
  let slowBy: SloCause | null = null
  if (lat.ttftMs > b.ttftMs) slowBy = 'ttft'
  else if (ttfatMs > b.ttfatMs) slowBy = 'ttfat'
  else if (e.outputTokens > 0 && lat.tpotMs > b.tpotMs) slowBy = 'tpot'
  else if (e2elMs > b.e2elMs) slowBy = 'e2el'
  const ctxGap = Math.max(0, e.context - serverContext(s, lo))
  const effQ =
    serverQualityVs(s, lo, e.def.primaryAxis) - ctxGap * 0.45 - int4ContextPenalty(s, e.inputTokens + e.outputTokens)
  const margin = effQ - e.difficulty
  const win = serverCtxWindowTokens(s, lo)
  return {
    fast: slowBy === null,
    slowBy,
    smart: margin >= 0,
    margin,
    effQ,
    window: win <= 0 || e.inputTokens <= win,
    lat,
    ttfatMs,
    e2elMs,
  }
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
  /** per-user decode tok/s on this rack at its effective batch (a 1.5K-in / 256-out request). */
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
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id)
    if (!m) continue
    const lo = loadout(s, tw.hwId, id)
    const current = tw.modelId === id
    const fits = current || serverDeployable(s, lo)
    const think = modelThinkTokens(m)
    const c: DeployCandidate = {
      model: m,
      fits,
      current,
      needGb: serverModelMemory(s, { hw: null, model: m }) + FRAMEWORK_GB,
      needHw: fits ? null : smallestRackFor(s, m),
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
      const ref = latencyOf(s, lo, 1500, 256)
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
  const a: Loadout = { hw: from, model }
  const b: Loadout = { hw: to, model }
  const pa = latencyOf(s, a, 1500, 256).perUserDecodeTokS
  const pb = latencyOf(s, b, 1500, 256).perUserDecodeTokS
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
    (t) => t.hwId === tw.hwId && t.modelId !== modelId && serverDeployable(s, loadout(s, t.hwId, modelId)),
  )
}

/** Every rack on the board where `modelId` fits and is not already deployed (the one-click rollout). */
export function rolloutTargets(s: GameState, modelId: string): Tower[] {
  return serversById(s).filter((t) => t.modelId !== modelId && serverDeployable(s, loadout(s, t.hwId, modelId)))
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
    const reach = rackRangeTiles(t) * TILE
    if (d2 <= reach * reach && d2 < nearD) {
      near = t
      nearD = d2
    }
  }
  return near
}

/** A building's reach in tiles; a rack reaches as far as its CURRENT hardware tier. */
export function rackRangeTiles(t: Tower): number {
  if (t.def.kind === 'server' && t.hwId) return HARDWARE_DEFS[t.hwId]?.range ?? t.def.range
  return t.def.range
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
    const batch = Math.max(1, rack.batch ?? effectiveBatch(s, lo, r.contextLen))
    const perUser = serverPerUserDecodeTokS(s, lo, batch) * decodeThrottle(rack.throttle)
    tpotMs = perUser > 0 ? 1000 / perUser : Infinity
  }
  let rackQ: number | null = null
  let ctxPenalty = 0
  if (lo && fits) {
    ctxPenalty = Math.max(0, r.context - serverContext(s, lo)) * 0.45 + int4ContextPenalty(s, r.contextLen)
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
