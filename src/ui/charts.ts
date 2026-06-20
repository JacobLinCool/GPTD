/**
 * ui/charts.ts — reusable PixiJS chart primitives for the Expert surfaces (§5.4).
 *
 * Each primitive is a small self-contained Container with a draw(...) method that
 * re-renders from fresh data every frame. They are pure presentation (no sim
 * mutation) and unit-agnostic — callers pass already-computed metrics + labels.
 *
 *   RooflineBars    prefill compute vs decode bandwidth twin-bars, binding marked
 *   VramBar         stacked weights + KV + headroom bar
 *   QualitySparks   per-axis quality sparkbars (5 axes; agentic highlighted)
 *   GoodputGauge    the Goodput headline gauge (§1.3)
 *   LineChart       a generic series line (used for $/Mtoken, utilization)
 *   HeadroomBar     power-vs-cooling headroom bar with a red threshold at the cap
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from '../config'
import { AXES } from './metrics'
import type { CapabilityAxis } from '../core/types'
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
    this.legend.text = `■ Weights ${weightsGb.toFixed(0)}  ■ KV ${kvGb.toFixed(0)}  ■ Free ${headroomGb.toFixed(0)}  / ${totalGb} GB`
    this.legend.x = 0
    this.legend.y = h + 3
  }
}

/* ------------------------------------------------------------------ *
 *  Per-axis quality sparkbars (§5.4): 5 axes, agentic highlighted     *
 * ------------------------------------------------------------------ */

export class QualitySparks extends Container {
  private g = new Graphics()
  private labels: Text[] = []
  private vals: Text[] = []
  private static SHORT: Record<CapabilityAxis, string> = {
    chat: 'Chat',
    coding: 'Code',
    reasoning: 'Rsn',
    general: 'Gen',
    agentic: 'Agnt',
  }

  constructor(
    private w = 320,
    private rowH = 15,
  ) {
    super()
    this.addChild(this.g)
    for (let i = 0; i < AXES.length; i++) {
      const l = label('', 10, COLORS.textDim)
      const v = label('', 10, COLORS.text, 'bold')
      this.labels.push(l)
      this.vals.push(v)
      this.addChild(l, v)
    }
  }

  /** qualityBy values (0..~100 band). The `agentic` axis is highlighted (§6.4). */
  draw(quality: Record<CapabilityAxis, number>): void {
    const g = this.g
    g.clear()
    const barX = 52
    const barW = this.w - barX - 36
    AXES.forEach((axis, i) => {
      const y = i * this.rowH
      const q = quality[axis] ?? 0
      const frac = Math.max(0, Math.min(1, q / 100))
      const highlight = axis === 'agentic'
      const col = highlight ? COLORS.cash : lerpColor(COLORS.danger, COLORS.good, frac)
      g.roundRect(barX, y + 2, barW, 9, 2).fill({ color: TRACK, alpha: 0.85 })
      g.roundRect(barX, y + 2, Math.max(2, barW * frac), 9, 2).fill({ color: col })
      if (highlight) {
        g.roundRect(barX - 1, y + 1, barW + 2, 11, 3).stroke({ width: 1, color: COLORS.cash, alpha: 0.7 })
      }
      const l = this.labels[i]
      l.text = QualitySparks.SHORT[axis]
      l.style.fill = highlight ? COLORS.cash : COLORS.textDim
      l.x = 0
      l.y = y
      const v = this.vals[i]
      v.text = q.toFixed(0)
      v.x = barX + barW + 6
      v.y = y
    })
  }

  get height2(): number {
    return AXES.length * this.rowH
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
