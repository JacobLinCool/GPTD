/**
 * ui/charts.ts — reusable PixiJS chart primitives for the Expert surfaces (§5.4).
 *
 * Each primitive is a small self-contained Container with a draw(...) method that
 * re-renders from fresh data every frame. They are pure presentation (no sim
 * mutation) and unit-agnostic — callers pass already-computed metrics + labels.
 *
 *   RooflineBars    prefill compute vs decode bandwidth twin-bars, binding marked
 *   VramBar         stacked weights + KV + headroom bar
 *   QualitySparks   per-axis quality sparkbars (5 axes; agentic highlighted),
 *                   optionally with the difficulty each axis must clear (ticks)
 *   OutcomeBar      the seven-outcome stacked bar (one color per outcome)
 *   GoodputGauge    the Goodput headline gauge (§1.3)
 *   LineChart       a generic series line (used for $/Mtoken, utilization)
 *   HeadroomBar     power-vs-cooling headroom bar with a red threshold at the cap
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from '../config'
import { MODEL_LIST } from '../sim/content'
import { AXES, type OutcomeTally } from './metrics'
import { OUTCOMES, type CapabilityAxis, type Outcome } from '../core/types'
import { outcomeColor } from '../outcomes'
import { label } from './theme'
import { t } from '../i18n'

const TRACK = 0x0a0e14

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255
  const br = (b >> 16) & 255
  const bg = (b >> 8) & 255
  const bb = b & 255
  const m = (x: number, y: number) => Math.round(x + (y - x) * t)
  return (m(ar, br) << 16) | (m(ag, bg) << 8) | m(ab, bb)
}

/* ------------------------------------------------------------------ *
 *  Roofline twin-bars (§5.4): prefill compute vs decode bandwidth     *
 * ------------------------------------------------------------------ */

export class RooflineBars extends Container {
  private g = new Graphics()
  private lblPrefill = label('', 10, COLORS.textDim)
  private lblDecode = label('', 10, COLORS.textDim)
  private valPrefill = label('', 10, COLORS.power, 'bold')
  private valDecode = label('', 10, COLORS.cooling, 'bold')
  private bindTag = label('', 9, COLORS.textBright, 'bold')

  constructor(private w = 320) {
    super()
    this.addChild(this.g, this.lblPrefill, this.lblDecode, this.valPrefill, this.valDecode, this.bindTag)
  }

  /** prefillTokS vs decode aggregate tok/s; binding = the one that physically caps. */
  draw(prefillTokS: number, decodeTokS: number, binding: 'compute' | 'bandwidth', prefillStr: string, decodeStr: string): void {
    const g = this.g
    g.clear()
    const barH = 12
    const gap = 19
    const max = Math.max(prefillTokS, decodeTokS, 1)
    this.valPrefill.text = prefillStr
    this.valDecode.text = decodeStr
    const labelW = 108
    const valueW = Math.max(64, this.valPrefill.width, this.valDecode.width)
    const barX = labelW + 4
    const valueX = this.w - valueW
    const barW = Math.max(48, valueX - barX - 8)

    this.lblPrefill.text = t('rack.roof.prefill')
    this.lblPrefill.x = 0
    this.lblPrefill.y = 0
    this.lblDecode.text = t('rack.roof.decode')
    this.lblDecode.x = 0
    this.lblDecode.y = gap

    const drawBar = (y: number, frac: number, color: number, bound: boolean) => {
      const fillW = Math.max(2, Math.min(barW, barW * frac))
      g.roundRect(barX, y, barW, barH, 3).fill({ color: TRACK, alpha: 0.85 })
      g.roundRect(barX, y, fillW, barH, 3).fill({ color, alpha: bound ? 1 : 0.6 })
      if (bound) {
        // mark the binding roof with a bright cap notch
        g.rect(barX + fillW - 2, y - 2, 3, barH + 4).fill({ color: COLORS.textBright })
      }
    }
    const isPrefillBound = binding === 'compute'
    drawBar(11, prefillTokS / max, COLORS.power, isPrefillBound)
    drawBar(11 + gap, decodeTokS / max, COLORS.cooling, !isPrefillBound)

    this.valPrefill.x = this.w - this.valPrefill.width
    this.valPrefill.y = 12
    this.valDecode.x = this.w - this.valDecode.width
    this.valDecode.y = 12 + gap

    this.bindTag.text = t('rack.roof.binding', {
      kind: binding === 'compute' ? t('rack.roof.binding.compute') : t('rack.roof.binding.bandwidth'),
    })
    this.bindTag.style.fill = binding === 'compute' ? COLORS.power : COLORS.cooling
    this.bindTag.x = 0
    this.bindTag.y = 11 + gap * 2
  }
}

/* ------------------------------------------------------------------ *
 *  VRAM stacked bar (§5.6): weights + KV + headroom                   *
 * ------------------------------------------------------------------ */

export class VramBar extends Container {
  private g = new Graphics()
  private legend = label('', 10, COLORS.textDim)

  constructor(
    private w = 320,
    private rowH = 15,
  ) {
    super()
    this.addChild(this.g, this.legend)
  }

  draw(weightsGb: number, kvGb: number, headroomGb: number, totalGb: number): void {
    const g = this.g
    g.clear()
    const h = 16
    const total = Math.max(totalGb, weightsGb + kvGb + headroomGb, 1)
    let x = 0
    const seg = (gb: number, color: number) => {
      const w = (gb / total) * this.w
      if (w <= 0) return
      g.rect(x, 0, w, h).fill({ color })
      x += w
    }
    g.roundRect(0, 0, this.w, h, 3).fill({ color: TRACK, alpha: 0.85 })
    seg(weightsGb, COLORS.data) // weights — purple
    seg(kvGb, COLORS.cooling) // KV cache — blue
    seg(headroomGb, 0x2a3550) // unused headroom — grey
    g.roundRect(0.5, 0.5, this.w - 1, h - 1, 3).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.8 })
    this.legend.text = t('rack.vram.legend', {
      w: weightsGb.toFixed(0),
      kv: kvGb.toFixed(0),
      free: headroomGb.toFixed(0),
      total: totalGb,
    })
    this.legend.x = 0
    this.legend.y = h + 3
  }
}

/* ------------------------------------------------------------------ *
 *  Per-axis quality sparkbars (§5.4): 5 axes, agentic highlighted     *
 * ------------------------------------------------------------------ */

/**
 * Right end of every quality bar: 100, or the strongest score in the roster
 * (rounded up to 10) so 100+ checkpoints still differ instead of all pinning full.
 */
let qualityScaleCache = 0
export function qualityScale(): number {
  if (!qualityScaleCache) {
    let m = 100
    for (const md of MODEL_LIST) for (const a of AXES) m = Math.max(m, md.qualityBy[a])
    qualityScaleCache = Math.ceil(m / 10) * 10
  }
  return qualityScaleCache
}

export interface SparkOpts {
  /** per-axis difficulty the bar must clear: drawn as a marker; the bar turns red below it. */
  ticks?: Partial<Record<CapabilityAxis, number>>
  /** value at the right end of the track (default 100; raise it so 100+ scores still differ). */
  max?: number
  /** the axis to outline (default agentic, the discriminative one §6.4); null = none. */
  highlight?: CapabilityAxis | null
  /**
   * a second vector marked on each bar as a thin notch (a hybrid's other thinking mode, §1.4):
   * the bar is the vector the axis is judged with, the notch what the other mode would score.
   */
  alt?: Partial<Record<CapabilityAxis, number>> | null
}

export class QualitySparks extends Container {
  private g = new Graphics()
  private labels: Text[] = []
  private vals: Text[] = []
  /** the `alt` vector's value per axis, printed after the bar's own (purple, like its notch). */
  private altVals: Text[] = []

  constructor(
    private w = 320,
    private rowH = 15,
  ) {
    super()
    this.addChild(this.g)
    for (let i = 0; i < AXES.length; i++) {
      const l = label('', 10, COLORS.textDim)
      const v = label('', 10, COLORS.text, 'bold')
      const a = label('', 10, COLORS.data)
      this.labels.push(l)
      this.vals.push(v)
      this.altVals.push(a)
      this.addChild(l, v, a)
    }
  }

  /** qualityBy values; ticks mark what a request needs on that axis (Normal + Expert inspect). */
  draw(quality: Record<CapabilityAxis, number>, opts: SparkOpts = {}): void {
    const g = this.g
    g.clear()
    const barX = 52
    // room after the bar for its value (and the alt vector's, when one is marked)
    const barW = this.w - barX - (opts.alt ? 58 : 36)
    const max = Math.max(1, opts.max ?? 100)
    const hlAxis = opts.highlight === undefined ? 'agentic' : opts.highlight
    AXES.forEach((axis, i) => {
      const y = i * this.rowH
      const q = quality[axis] ?? 0
      const frac = Math.max(0, Math.min(1, q / max))
      const tick = opts.ticks?.[axis]
      const highlight = axis === hlAxis
      // with ticks, only the judged axes carry a pass/fail color; the rest stay neutral
      const judgedView = !!opts.ticks && Object.keys(opts.ticks).length > 0
      const col =
        tick !== undefined
          ? q >= tick
            ? COLORS.good
            : COLORS.danger
          : highlight
            ? COLORS.cash
            : judgedView
              ? COLORS.sla
              : lerpColor(COLORS.danger, COLORS.good, Math.min(1, q / 100))
      const alpha = tick !== undefined || highlight ? 1 : judgedView ? 0.35 : 0.9
      g.roundRect(barX, y + 2, barW, 9, 2).fill({ color: TRACK, alpha: 0.85 })
      g.roundRect(barX, y + 2, Math.max(2, barW * frac), 9, 2).fill({ color: col, alpha })
      const alt = opts.alt?.[axis]
      if (alt !== undefined) {
        const ax = barX + barW * Math.max(0, Math.min(1, alt / max))
        g.rect(Math.round(ax), y + 2, 1, 9).fill({ color: COLORS.data, alpha: 0.95 })
        g.rect(Math.round(ax) - 1, y + 1, 3, 1).fill({ color: COLORS.data, alpha: 0.95 })
        g.rect(Math.round(ax) - 1, y + 11, 3, 1).fill({ color: COLORS.data, alpha: 0.95 })
      }
      if (tick !== undefined) {
        const tx = barX + barW * Math.max(0, Math.min(1, tick / max))
        g.rect(Math.round(tx) - 1, y, 2, 13).fill({ color: COLORS.textBright })
      }
      if (highlight) {
        g.roundRect(barX - 1, y + 1, barW + 2, 11, 3).stroke({ width: 1, color: COLORS.cash, alpha: 0.7 })
      }
      const l = this.labels[i]
      l.text = t('axis.short.' + axis)
      l.style.fill = highlight ? COLORS.cash : tick !== undefined ? COLORS.text : COLORS.textDim
      l.x = 0
      l.y = y
      const v = this.vals[i]
      v.text = q.toFixed(0)
      v.style.fill = tick !== undefined && q < tick ? COLORS.danger : COLORS.text
      v.x = barX + barW + 6
      v.y = y
      const av = this.altVals[i]
      av.text = alt !== undefined ? '▏' + alt.toFixed(0) : ''
      av.x = v.x + v.width + 3
      av.y = y
    })
  }

  get height2(): number {
    return AXES.length * this.rowH
  }
}

/* ------------------------------------------------------------------ *
 *  Seven-outcome stacked bar (wave report, end screen)                *
 * ------------------------------------------------------------------ */

/** Text glyph per outcome for legends — so meaning never rests on color alone. */
export const OUTCOME_CHAR: Record<Outcome, string> = {
  served: '✓',
  sloMiss: '◷',
  bad: '✗',
  unsafe: '⚠',
  overRefused: '⊘',
  unservable: '⇥',
  leaked: '↓',
}

export class OutcomeBar extends Container {
  private g = new Graphics()

  constructor(
    private w = 320,
    private h = 12,
  ) {
    super()
    this.addChild(this.g)
  }

  /** Segments in outcome order, each as wide as its share of every terminal outcome. */
  draw(c: OutcomeTally): void {
    const g = this.g
    g.clear()
    g.roundRect(0, 0, this.w, this.h, 3).fill({ color: TRACK, alpha: 0.85 })
    let total = 0
    for (const o of OUTCOMES) total += c[o]
    if (total > 0) {
      let x = 0
      for (const o of OUTCOMES) {
        const n = c[o]
        if (n <= 0) continue
        const segW = (n / total) * this.w
        g.rect(x, 0, segW, this.h).fill({ color: outcomeColor(o) })
        // a hairline between segments keeps adjacent similar hues apart
        if (x > 0) g.rect(x, 0, 1, this.h).fill({ color: TRACK, alpha: 0.9 })
        x += segW
      }
    }
    g.roundRect(0.5, 0.5, this.w - 1, this.h - 1, 3).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.8 })
  }
}

/* ------------------------------------------------------------------ *
 *  Goodput gauge (§1.3) — the headline                                *
 * ------------------------------------------------------------------ */

export class GoodputGauge extends Container {
  private g = new Graphics()
  private pct = label('', 22, COLORS.good, 'bold')
  private cap = label('', 10, COLORS.textDim)

  constructor(private w = 150) {
    super()
    this.addChild(this.g, this.pct, this.cap)
    this.cap.text = 'GOODPUT'
  }

  /** goodputPct 0..100; green ≥90, amber ≥70, red below. */
  draw(goodputPct: number, caption = 'GOODPUT'): void {
    const g = this.g
    g.clear()
    const frac = Math.max(0, Math.min(1, goodputPct / 100))
    const col = goodputPct >= 90 ? COLORS.good : goodputPct >= 70 ? COLORS.warn : COLORS.danger
    const h = 12
    g.roundRect(0, 24, this.w, h, 4).fill({ color: TRACK, alpha: 0.85 })
    g.roundRect(0, 24, Math.max(2, this.w * frac), h, 4).fill({ color: col })
    // 90% SLO target marker
    g.rect(this.w * 0.9, 22, 2, h + 4).fill({ color: COLORS.textBright, alpha: 0.6 })
    g.roundRect(0.5, 24.5, this.w - 1, h - 1, 4).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.8 })
    this.pct.text = goodputPct.toFixed(0) + '%'
    this.pct.style.fill = col
    this.pct.x = 0
    this.pct.y = -2
    this.cap.text = caption
    this.cap.x = this.pct.width + 8
    this.cap.y = 8
  }
}

/* ------------------------------------------------------------------ *
 *  Generic line chart (§5.4) — $/Mtoken, utilization                  *
 * ------------------------------------------------------------------ */

export class LineChart extends Container {
  private g = new Graphics()
  private cap = label('', 10, COLORS.textDim)

  constructor(
    private w = 200,
    private h = 48,
  ) {
    super()
    this.addChild(this.g, this.cap)
  }

  /**
   * Draw a series in [0,max]; `redBelow`/`redAbove` paint points past a threshold
   * in danger (e.g. $/Mtoken spikes when utilization is low, §5.8; util < 30%).
   */
  draw(
    series: number[],
    color: number,
    caption: string,
    opts: { max?: number; threshold?: number; thresholdDir?: 'above' | 'below' } = {},
  ): void {
    const g = this.g
    g.clear()
    g.roundRect(0, 12, this.w, this.h, 4).fill({ color: TRACK, alpha: 0.7 })
    g.roundRect(0.5, 12.5, this.w - 1, this.h - 1, 4).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.6 })
    this.cap.text = caption
    this.cap.x = 0
    this.cap.y = 0
    if (series.length < 2) {
      if (series.length === 1) {
        const v = series[0]
        const max = opts.max ?? Math.max(v, 1)
        const y = 12 + this.h - (Math.min(v, max) / max) * this.h
        g.circle(this.w - 4, y, 2).fill({ color })
      }
      return
    }
    const max = opts.max ?? Math.max(...series, 1e-9) * 1.1
    const px = (i: number) => (i / (series.length - 1)) * this.w
    const py = (v: number) => 12 + this.h - (Math.min(v, max) / max) * this.h
    // optional threshold line
    if (opts.threshold !== undefined) {
      const ty = py(opts.threshold)
      g.moveTo(0, ty).lineTo(this.w, ty).stroke({ width: 1, color: COLORS.danger, alpha: 0.4 })
    }
    let started = false
    for (let i = 0; i < series.length; i++) {
      const x = px(i)
      const y = py(series[i])
      if (!started) {
        g.moveTo(x, y)
        started = true
      } else g.lineTo(x, y)
    }
    g.stroke({ width: 1.5, color })
    // last point dot, recolored if past the threshold
    const last = series[series.length - 1]
    let dot = color
    if (opts.threshold !== undefined) {
      const past = opts.thresholdDir === 'below' ? last < opts.threshold : last > opts.threshold
      if (past) dot = COLORS.danger
    }
    g.circle(this.w, py(last), 2.5).fill({ color: dot })
  }
}

/* ------------------------------------------------------------------ *
 *  Power-vs-cooling headroom bar (§5.5) — red threshold at the cap    *
 * ------------------------------------------------------------------ */

export class HeadroomBar extends Container {
  private g = new Graphics()
  private lbl = label('', 10, COLORS.textDim)

  constructor(private w = 160) {
    super()
    this.addChild(this.g, this.lbl)
  }

  /** used vs cap (kW); the bar turns red once used > cap (the §5.5 physical cap). */
  draw(usedKw: number, capKw: number, caption: string, color: number): void {
    const g = this.g
    g.clear()
    const h = 12
    const frac = capKw > 0 ? usedKw / capKw : 0
    const over = usedKw > capKw
    g.roundRect(0, 12, this.w, h, 3).fill({ color: TRACK, alpha: 0.85 })
    g.roundRect(0, 12, Math.max(2, this.w * Math.min(1, frac)), h, 3).fill({ color: over ? COLORS.danger : color })
    // red cap threshold line at 100%
    g.rect(this.w - 1, 9, 2, h + 6).fill({ color: COLORS.danger, alpha: 0.8 })
    g.roundRect(0.5, 12.5, this.w - 1, h - 1, 3).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.8 })
    this.lbl.text = caption
    this.lbl.x = 0
    this.lbl.y = 0
  }
}
