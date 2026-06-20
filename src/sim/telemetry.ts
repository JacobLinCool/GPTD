import type { GameState, Request, WaveReport, WaveStats, WaveTypeStat } from '../core/types'

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
    answered: 0,
    goodput: 0,
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

/** The terminal outcomes (R9 / §2.5): six + over_refused (§3.6). */
export type Outcome = 'served' | 'sloMiss' | 'bad' | 'unservable' | 'unsafe' | 'overRefused' | 'leaked'

/**
 * Record the final outcome of one request. ANSWERED requests (served / sloMiss /
 * bad — the model actually computed a reply) log service latency measured from
 * first hardware contact, not spawn time, and feed the rolling req/s window.
 * Goodput counts only clean `served` (within SLO);
 * `sloMiss` is answered-but-late (excluded from Goodput, §1.3). `unservable`
 * (context-window reject) and `leaked` never computed a reply.
 */
export function recordOutcome(s: GameState, r: Request, kind: Outcome, pay: number): void {
  const ws = s.waveStats
  if (!ws) return
  const row = typeRow(ws, r.def.id)
  ws[kind]++
  row[kind]++
  ws.cashIn += pay
  row.cash += pay
  if (kind === 'served' || kind === 'sloMiss' || kind === 'bad') {
    ws.latencies.push(r.e2elReal)
    ws.recentServes.push(s.time)
    // Goodput denominator = answered; numerator = answered AND within SLO. A
    // served-but-late request is answered (in the denominator) but does NOT count
    // toward Goodput (sloViolated latched on the request, §1.3/§6.4).
    ws.answered++
    if (kind === 'served' && !r.sloViolated) ws.goodput++
  }
}

export function recordCacheHit(s: GameState): void {
  if (s.waveStats) s.waveStats.cacheHits++
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
  // Goodput: % of answered requests that met their class SLO (§1.3/§6.4).
  const goodputPct = ws.answered ? (100 * ws.goodput) / ws.answered : 100
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
    goodputPct,
    duration: s.waveTime,
    byType: ws.byType,
  }
}
