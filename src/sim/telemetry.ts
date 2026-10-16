import type {
  GameState,
  Outcome,
  RefusedBy,
  Request,
  SloCause,
  WaveReport,
  WaveStats,
  WaveTypeStat,
} from '../core/types'

/** How far back (seconds) the rolling answers window reaches (drives req/s). */
export const TELEMETRY_WINDOW = 5

export function newWaveStats(waveIndex: number): WaveStats {
  return {
    waveIndex,
    served: 0,
    sloMiss: 0,
    bad: 0,
    unservable: 0,
    unsafe: 0,
    overRefused: 0,
    leaked: 0,
    cacheHits: 0,
    cashIn: 0,
    powerCost: 0,
    latencies: [],
    ttfts: [],
    total: 0,
    answered: 0,
    answeredInSlo: 0,
    goodput: 0,
    trustLostBy: {},
    slaLostBy: {},
    sloCauses: {},
    overRefusedBy: {},
    guardCaught: 0,
    selfHandled: 0,
    recentServes: [],
    byType: {},
  }
}

function typeRow(ws: WaveStats, id: string): WaveTypeStat {
  let row = ws.byType[id]
  if (!row) {
    row = { served: 0, sloMiss: 0, bad: 0, unservable: 0, unsafe: 0, overRefused: 0, leaked: 0, cash: 0 }
    ws.byType[id] = row
  }
  return row
}

/** Add a positive amount to one outcome's slot of a ledger. */
export function addToLedger<K extends string>(ledger: Partial<Record<K, number>>, key: K, amount: number): void {
  if (amount <= 0) return
  ledger[key] = (ledger[key] ?? 0) + amount
}

/** What one terminal outcome did, beyond its kind (all optional). */
export interface OutcomeRecord {
  /** credits earned. */
  pay: number
  /** meter deltas actually applied (negative = loss). */
  dTrust: number
  dSla: number
  cause?: SloCause
  refusedBy?: RefusedBy
}

/**
 * Record the final outcome of one request into the live wave telemetry: per-type
 * counts, revenue, the Trust/SLA ledgers, SLO-miss causes and who over-refused.
 * Every outcome counts toward `total` (the Goodput denominator); a request that got a
 * computed answer (it reached a first token: served, sloMiss, bad, unsafe) also logs
 * its service latency, measured from first hardware contact, and feeds the req/s window.
 */
export function recordOutcome(s: GameState, r: Request, kind: Outcome, rec: OutcomeRecord): void {
  const ws = s.waveStats
  if (!ws) return
  const row = typeRow(ws, r.def.id)
  ws[kind]++
  row[kind]++
  ws.total++
  ws.cashIn += rec.pay
  row.cash += rec.pay
  addToLedger(ws.trustLostBy, kind, -rec.dTrust)
  addToLedger(ws.slaLostBy, kind, -rec.dSla)
  if (kind === 'served') ws.goodput++
  if (kind === 'sloMiss' && rec.cause) ws.sloCauses[rec.cause] = (ws.sloCauses[rec.cause] ?? 0) + 1
  if (kind === 'overRefused' && rec.refusedBy) ws.overRefusedBy[rec.refusedBy] = (ws.overRefusedBy[rec.refusedBy] ?? 0) + 1
  const answered =
    r.prefillDoneAt !== undefined && (kind === 'served' || kind === 'sloMiss' || kind === 'bad' || kind === 'unsafe')
  if (answered) {
    ws.latencies.push(r.e2elReal)
    ws.recentServes.push(s.time)
    ws.answered++
    if (!r.sloViolated) ws.answeredInSlo++
  }
}

export function recordCacheHit(s: GameState): void {
  if (s.waveStats) s.waveStats.cacheHits++
}

/** A hazard cleared by a guardrail (layer 2). */
export function recordGuardCatch(s: GameState): void {
  if (s.waveStats) s.waveStats.guardCaught++
}

/** A hazard self-handled by the serving model's alignment (layer 1). */
export function recordSelfHandle(s: GameState): void {
  if (s.waveStats) s.waveStats.selfHandled++
}

/** Record time-to-first-token: first hardware contact to prefill completion. */
export function recordTtft(s: GameState, r: Request): void {
  if (s.waveStats) s.waveStats.ttfts.push(r.ttftReal)
}

export function recordPowerCost(s: GameState, cost: number): void {
  if (s.waveStats) s.waveStats.powerCost += cost
}

/** Drop rolling-window entries older than TELEMETRY_WINDOW seconds. */
export function pruneRecent(s: GameState): void {
  const ws = s.waveStats
  if (!ws) return
  const cutoff = s.time - TELEMETRY_WINDOW
  while (ws.recentServes.length && ws.recentServes[0] < cutoff) ws.recentServes.shift()
}

/** Answers per second over the rolling window. */
export function answersPerSec(s: GameState): number {
  return s.waveStats ? s.waveStats.recentServes.length / TELEMETRY_WINDOW : 0
}

/**
 * Goodput (§5.5, DistServe SLO goodput): % of ALL resolved requests served correctly,
 * safely and within their SLO. Timeouts, refusals, breaches and context rejects are in
 * the denominator — a wave where everything leaks reads 0%, not 100%. The ONE formula
 * shared by the wave report, the live LiveOps gauge and the agent bridge.
 */
export function goodputPctOf(ws: Pick<WaveStats, 'goodput' | 'total'>): number {
  return ws.total ? (100 * ws.goodput) / ws.total : 100
}

/** Secondary latency view: % of ANSWERED requests that met every latency bound of their SLO. */
export function sloAttainPctOf(ws: Pick<WaveStats, 'answered' | 'answeredInSlo'>): number {
  return ws.answered ? (100 * ws.answeredInSlo) / ws.answered : 100
}

/** p95 in-service elapsed time (seconds) of requests currently in flight. */
export function inflightP95Wait(s: GameState): number {
  const ages = s.requests.filter((r) => r.alive).map((r) => (r.prefillDoneAt === undefined ? r.queueSec : r.e2elReal))
  if (!ages.length) return 0
  ages.sort((a, b) => a - b)
  return ages[Math.min(ages.length - 1, Math.ceil(ages.length * 0.95) - 1)]
}

/** Settle the live wave telemetry into a final report. */
export function finalizeReport(s: GameState, clearBonus: number): WaveReport | null {
  const ws = s.waveStats
  if (!ws) return null
  const lat = [...ws.latencies].sort((a, b) => a - b)
  const avg = lat.length ? lat.reduce((n, v) => n + v, 0) / lat.length : 0
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)] : 0
  const tt = [...ws.ttfts].sort((a, b) => a - b)
  const avgTtft = tt.length ? tt.reduce((n, v) => n + v, 0) / tt.length : 0
  const p95Ttft = tt.length ? tt[Math.min(tt.length - 1, Math.ceil(tt.length * 0.95) - 1)] : 0
  return {
    waveIndex: ws.waveIndex,
    served: ws.served,
    sloMiss: ws.sloMiss,
    bad: ws.bad,
    unservable: ws.unservable,
    unsafe: ws.unsafe,
    overRefused: ws.overRefused,
    leaked: ws.leaked,
    cacheHits: ws.cacheHits,
    cashIn: ws.cashIn,
    clearBonus,
    powerCost: ws.powerCost,
    avgLatency: avg,
    p95Latency: p95,
    avgTtft,
    p95Ttft,
    goodputPct: goodputPctOf(ws),
    sloAttainPct: sloAttainPctOf(ws),
    duration: s.waveTime,
    byType: ws.byType,
    total: ws.total,
    trustLostBy: { ...ws.trustLostBy },
    slaLostBy: { ...ws.slaLostBy },
    sloCauses: { ...ws.sloCauses },
    overRefusedBy: { ...ws.overRefusedBy },
    guardCaught: ws.guardCaught,
    selfHandled: ws.selfHandled,
  }
}
