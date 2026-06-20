/**
 * ui/metricsPanel.ts — S2 floating telemetry panel (§5.2). Toggled by the `
 * key (or the HUD METRICS button), it replaces the always-on LiveOpsStrip that
 * used to overlap the IncidentBanner. It is a NON-blocking floating overlay: the
 * sim keeps running underneath, so the player watches the trends live, Grafana
 * style — six time-series LineCharts (Goodput, RPS, p95, $/Mtoken, KV util,
 * Fleet util) over the MetricsHistory ring buffer, each with its current value.
 *
 * Pure presentation over MetricsHistory; no GameState access (Game samples the
 * history and hands it in). Expert Mode only (the caller gates visibility).
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { LineChart } from './charts'
import { fmtDollarsPerMtoken } from './metrics'
import type { MetricSample, MetricsHistory } from './metricsHistory'
import { drawPanel, label } from './theme'
import { t } from '../i18n'

interface Spec {
  key: keyof MetricSample
  capKey: string
  color: number
  fmt: (v: number) => string
  opts: { max?: number; threshold?: number; thresholdDir?: 'above' | 'below' }
}

const SPECS: Spec[] = [
  { key: 'goodput', capKey: 'metric.goodput', color: COLORS.good, fmt: (v) => v.toFixed(0) + '%', opts: { max: 100, threshold: 90, thresholdDir: 'below' } },
  { key: 'rps', capKey: 'metric.rps', color: COLORS.sla, fmt: (v) => v.toFixed(1) + ' /s', opts: {} },
  { key: 'p95', capKey: 'metric.p95', color: COLORS.warn, fmt: (v) => v.toFixed(1) + ' s', opts: { threshold: 6, thresholdDir: 'above' } },
  { key: 'dpmt', capKey: 'metric.dpmt', color: COLORS.cash, fmt: (v) => fmtDollarsPerMtoken(v), opts: {} },
  { key: 'kvUtil', capKey: 'metric.kvutil', color: COLORS.cooling, fmt: (v) => v.toFixed(0) + '%', opts: { max: 100 } },
  { key: 'fleetUtil', capKey: 'metric.fleetutil', color: COLORS.power, fmt: (v) => v.toFixed(0) + '%', opts: { max: 100, threshold: 30, thresholdDir: 'below' } },
]

const PAD = 24
const COLS = 2
const ROWS = 3
const COL_GAP = 24
const ROW_GAP = 14
const CHART_H = 64
const CAP_H = 18
const W = 720
const H = PAD * 2 + 40 + ROWS * (CAP_H + 12 + CHART_H) + (ROWS - 1) * ROW_GAP

interface Cell {
  chart: LineChart
  cap: ReturnType<typeof label>
  val: ReturnType<typeof label>
  spec: Spec
}

export class MetricsPanel {
  readonly view = new Container()
  private bg = new Graphics()
  private title = label('', 15, COLORS.textBright, 'bold')
  private hint = label('', 11, COLORS.textDim)
  private empty = label('', 13, COLORS.textDim)
  private cells: Cell[] = []
  private readonly chartW = (W - PAD * 2 - COL_GAP) / COLS

  constructor() {
    this.view.x = Math.round((DESIGN_W - W) / 2)
    this.view.y = Math.round((DESIGN_H - H) / 2)
    this.view.addChild(this.bg, this.title, this.hint, this.empty)
    this.title.x = PAD
    this.title.y = PAD - 4
    this.hint.x = W - PAD
    this.hint.y = PAD
    this.empty.x = PAD
    this.empty.y = PAD + 40

    const top = PAD + 40
    for (let i = 0; i < SPECS.length; i++) {
      const spec = SPECS[i]
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const cellX = PAD + col * (this.chartW + COL_GAP)
      const cellY = top + row * (CAP_H + 12 + CHART_H + ROW_GAP)
      const cap = label('', 11, COLORS.textDim)
      cap.x = cellX
      cap.y = cellY
      const val = label('', 14, spec.color, 'bold')
      val.y = cellY - 2
      const chart = new LineChart(this.chartW, CHART_H)
      chart.x = cellX
      chart.y = cellY + CAP_H
      this.view.addChild(cap, val, chart)
      this.cells.push({ chart, cap, val, spec })
    }
    this.view.visible = false
  }

  update(history: MetricsHistory): void {
    this.bg.clear()
    drawPanel(this.bg, 0, 0, W, H, { alpha: 0.97 })
    this.title.text = t('metric.telemetry.title')
    this.hint.text = t('metric.telemetry.hint')
    this.hint.x = W - PAD - this.hint.width

    const latest = history.latest
    this.empty.visible = history.size === 0
    if (this.empty.visible) this.empty.text = t('metric.telemetry.empty')

    for (const c of this.cells) {
      const series = history.series(c.spec.key)
      c.cap.text = t(c.spec.capKey)
      c.chart.draw(series, c.spec.color, '', c.spec.opts)
      c.chart.visible = series.length > 0
      const v = latest ? latest[c.spec.key] : null
      c.val.text = v == null ? '—' : c.spec.fmt(v)
      c.val.x = c.cap.x + c.cap.width + 10
    }
  }
}
