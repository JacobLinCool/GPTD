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
import { FRAMEWORK_GB, LAT_CLASS_SLO } from '../config'
import type { CapabilityAxis, GameState, Request, RequestTypeDef, Tower } from '../core/types'
import {
  computeRoofTokS,
  decodeTokSb1,
  kvFreeGb,
  kvPerReqGb,
  type Loadout,
  loadoutOf,
  rackOperatingCostPerSec,
  serverAggDecodeTokS,
  serverComputeCeiling,
  serverBandwidthCeiling,
  serverFitsMemory,
  serverModelMemory,
  serverPerUserDecodeTokS,
  serverPower,
  serverPrefillSpeed,
  serverTargets,
} from '../sim/effects'
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
  /** Goodput: % of answered requests within SLO this wave (the headline, §1.3). */
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
  const goodputPct = ws && ws.answered ? (100 * ws.goodput) / ws.answered : 100
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
