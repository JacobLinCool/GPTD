/**
 * ui/metricsHistory.ts — a rolling time-series buffer for the floating telemetry
 * panel (§5.2). The always-on LiveOpsStrip showed only instantaneous fleet
 * metrics; the Grafana-style panel needs their HISTORY, so the Game controller
 * samples fleetMetrics() on a fixed wave-time cadence into this ring buffer.
 *
 * Sampling is keyed off `s.waveTime` (sim seconds), NOT wall-clock, so the chart
 * spacing is stable regardless of the speed multiplier. The buffer resets when
 * the wave changes. This module never mutates GameState — it only reads it
 * through ui/metrics.ts (AGENTS.md §2), exactly like every other display layer.
 */
import type { GameState } from '../core/types'
import { fleetMetrics } from './metrics'

export interface MetricSample {
  goodput: number
  rps: number
  p95: number
  dpmt: number
  kvUtil: number
  fleetUtil: number
}

/** Ring-buffer length (samples) and wave-seconds between samples. */
const CAP = 180
const SAMPLE_DT = 0.5

export class MetricsHistory {
  private buf: MetricSample[] = []
  private lastWaveIndex = Number.NaN
  private nextSampleAt = 0

  /** Sample fleet metrics on a fixed wave-time cadence; reset when the wave changes. */
  sample(s: GameState): void {
    if (s.phase !== 'wave') return
    if (s.waveIndex !== this.lastWaveIndex) {
      this.lastWaveIndex = s.waveIndex
      this.buf = []
      this.nextSampleAt = 0
    }
    if (s.waveTime < this.nextSampleAt) return
    this.nextSampleAt = s.waveTime + SAMPLE_DT
    const m = fleetMetrics(s)
    this.buf.push({
      goodput: m.goodputPct,
      rps: m.rps,
      p95: m.p95WaitSec,
      dpmt: Number.isFinite(m.dollarsPerMtoken) ? m.dollarsPerMtoken : 0,
      kvUtil: m.kvUtilPct,
      fleetUtil: m.fleetUtilPct,
    })
    if (this.buf.length > CAP) this.buf.shift()
  }

  /** The recorded series for one metric, oldest → newest. */
  series(key: keyof MetricSample): number[] {
    return this.buf.map((s) => s[key])
  }

  get latest(): MetricSample | null {
    return this.buf.length ? this.buf[this.buf.length - 1] : null
  }

  get size(): number {
    return this.buf.length
  }
}
