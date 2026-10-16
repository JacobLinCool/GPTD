import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_W, HUD_H } from '../config'
import { OUTCOMES, type GameState, type IncidentDef, type Outcome } from '../core/types'
import { isExpert } from '../mode'
import { OUTCOME_STYLE, outcomeColor, type OutcomeGlyph } from '../outcomes'
import { getSettings } from '../settings'
import { WAVES } from '../sim/content'
import { isBrownout, isLiquidGated, isThrottling } from '../sim/power'
import type { WavePreview } from '../sim/preview'
import { addTooltip, type TooltipSpec } from './tooltip'
import { getLang, incDesc, incName, t, waveName } from '../i18n'
import { KEY, keyCap } from './help'
import { drawPanel, label, UIButton } from './theme'

/** Left edge of the centered wave-title band (right of the HEAT readout). */
const TITLE_LEFT = 552

function bar(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
  over = false,
): void {
  g.roundRect(x, y, w, h, 3).fill({ color: 0x0a0e14, alpha: 0.85 })
  const f = Math.max(0, Math.min(1, frac))
  if (f > 0) g.roundRect(x, y, Math.max(2, w * f), h, 3).fill({ color: over ? COLORS.danger : color })
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3).stroke({ width: 1, color: COLORS.panelEdge, alpha: 0.8 })
}

/** Format a real-kW meter value: 1 decimal under 10 kW, whole kW at/above. */
function fmtKw(v: number): string {
  return v >= 10 ? v.toFixed(0) : v.toFixed(1)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** A runway in waves: one decimal under 10, whole above, capped at 99+. */
function fmtWaves(w: number): string {
  if (w >= 99.5) return '99+'
  return w >= 10 ? w.toFixed(0) : w.toFixed(1)
}

/**
 * Draw an outcome's pixel glyph (centered on 0,0, ~size px) — the same seven
 * shapes the board popups use, so meaning never rests on hue alone.
 */
export function drawOutcomeGlyph(g: Graphics, glyph: OutcomeGlyph, color: number, size = 10): void {
  g.clear()
  const h = size / 2
  const w = Math.max(1.4, size / 6)
  switch (glyph) {
    case 'check':
      g.moveTo(-h, 0).lineTo(-h * 0.25, h * 0.7).lineTo(h, -h * 0.75).stroke({ width: w, color })
      break
    case 'clock':
      g.circle(0, 0, h).stroke({ width: w * 0.8, color })
      g.moveTo(0, 0).lineTo(0, -h * 0.65).moveTo(0, 0).lineTo(h * 0.5, 0).stroke({ width: w * 0.8, color })
      break
    case 'cross':
      g.moveTo(-h, -h).lineTo(h, h).moveTo(h, -h).lineTo(-h, h).stroke({ width: w, color })
      break
    case 'hazard':
      g.poly([0, -h, h, h * 0.85, -h, h * 0.85]).stroke({ width: w * 0.8, color })
      g.rect(-w * 0.35, -h * 0.35, w * 0.7, h * 0.6).rect(-w * 0.35, h * 0.4, w * 0.7, w * 0.7).fill({ color })
      break
    case 'noentry':
      g.circle(0, 0, h).stroke({ width: w * 0.8, color })
      g.rect(-h * 0.6, -w * 0.5, h * 1.2, w).fill({ color })
      break
    case 'overflow':
      g.rect(-h, -h * 0.2, h * 1.2, h * 1.2).stroke({ width: w * 0.7, color })
      g.moveTo(-h * 0.1, h * 0.1).lineTo(h, -h).stroke({ width: w * 0.8, color })
      g.poly([h, -h, h * 0.25, -h, h, -h * 0.25]).fill({ color })
      break
    case 'drop':
      g.moveTo(0, -h).lineTo(0, h * 0.4).stroke({ width: w * 0.8, color })
      g.poly([-h * 0.6, 0, h * 0.6, 0, 0, h * 0.7]).fill({ color })
      g.rect(-h, h * 0.8, h * 2, w * 0.6).fill({ color })
      break
  }
}

export interface HudCallbacks {
  onPause: () => void
  onSpeed: () => void
  /** right-click on the speed button: step DOWN. */
  onSpeedDown: () => void
  onMute: () => void
  /** open the system menu / settings hub. */
  onSettings: () => void
  /** §5.2 S7: open the ModelOverview modal (Expert Mode). */
  onModels: () => void
  /** §5.2 S2: toggle the floating telemetry panel (Expert Mode). */
  onMetrics: () => void
}

export interface HudUi {
  paused: boolean
  speed: number
  muted: boolean
  metricsOpen?: boolean
  /** the wave START launches next (build phase), for the title / runway / bill. */
  preview: WavePreview | null
  /** the fleet's operating burn (credits per board second). */
  burnPerSec: number
  /** estimated length of a wave (board seconds): the next one in build, the live one mid-wave. */
  waveSec: number
}

/** One live outcome counter in the HUD tally. */
interface TallySlot {
  outcome: Outcome
  view: Container
  glyph: Graphics
  count: Text
  n: number
  flash: number
}

const GLYPH_BOX = 12

/** A HUD meter a board chip can fly to. */
export type HudMeter = 'cash' | 'trust' | 'sla'
/** How long a meter value pops after a chip lands (s). */
const BUMP_SEC = 0.12
/** Resting positions of the meter values (they pop around their center). */
const METER_HOME: Record<HudMeter, { x: number; y: number }> = {
  cash: { x: 206, y: 24 },
  trust: { x: 142, y: 26 },
  sla: { x: 142, y: 68 },
}

export class Hud {
  readonly view = new Container()
  private bg = new Graphics()
  private bars = new Graphics()
  private lblTrust = label('', 11, COLORS.trust)
  private lblSla = label('', 11, COLORS.sla)
  private lblCash = label('', 11, COLORS.textDim)
  private lblPower = label('', 11, COLORS.textDim)
  private lblHeat = label('', 11, COLORS.textDim)
  private trustVal = label('', 12, COLORS.trust, 'bold')
  private slaVal = label('', 12, COLORS.sla, 'bold')
  private cashVal = label('', 20, COLORS.cash, 'bold')
  private runway = label('', 10, COLORS.textDim)
  private dataVal = label('', 13, COLORS.data, 'bold')
  private powerVal = label('', 11, COLORS.power)
  private coolVal = label('', 11, COLORS.cooling)
  private waveText = label('', 15, COLORS.textBright, 'bold')
  private phaseText = label('', 12, COLORS.textDim)
  private warnText = label('', 12, COLORS.danger, 'bold')
  /** the incident the status line names (its hover repeats the full description) */
  private warnIncident: IncidentDef | null = null
  private tally = new Container()
  private slots: TallySlot[] = []
  private tallyPalette = ''
  // cache for the (possibly truncated-to-fit) wave title — only recomputed when
  // the wave / total / phase / language changes, so the fit loop is not per-frame.
  private titleKey = ''
  private titleStr = ''
  private btnModels: UIButton
  private btnMetrics: UIButton
  private btnPause: UIButton
  private btnSpeed: UIButton
  private btnMute: UIButton
  private btnSettings: UIButton
  // hand-drawn speaker / gear glyphs (cleaner than emoji at this size).
  private muteIcon = new Graphics()
  private gearIcon = new Graphics()
  private lastState: GameState | null = null
  private lastUi: HudUi | null = null
  /** seconds left on each meter's landing pop (fly-to-meter chips). */
  private bumps: Record<HudMeter, number> = { cash: 0, trust: 0, sla: 0 }
  private flashG = new Graphics()

  constructor(cb: HudCallbacks) {
    this.view.addChild(this.bg, this.bars, this.flashG)
    drawPanel(this.bg, 0, 0, DESIGN_W, HUD_H, { radius: 0, alpha: 0.96 })
    this.bg.rect(0, HUD_H - 2, DESIGN_W, 2).fill({ color: COLORS.laneGlow, alpha: 0.5 })

    this.add(this.lblTrust, 16, 8)
    this.add(this.lblSla, 16, 50)
    // bars narrowed to 118 — value sits just right of the shorter bar, and the
    // whole CASH / POWER / HEAT cluster shifts left so the wave title gets more room.
    this.add(this.trustVal, METER_HOME.trust.x, METER_HOME.trust.y)
    this.add(this.slaVal, METER_HOME.sla.x, METER_HOME.sla.y)
    this.add(this.lblCash, 206, 8)
    this.add(this.cashVal, METER_HOME.cash.x, METER_HOME.cash.y)
    this.add(this.runway, 206, 48)
    this.add(this.dataVal, 206, 64)
    this.add(this.lblPower, 326, 8)
    this.add(this.powerVal, 444, 24)
    this.add(this.lblHeat, 326, 50)
    this.add(this.coolVal, 444, 66)
    addTooltip(this.warnText, () =>
      this.warnIncident ? { title: incName(this.warnIncident), body: incDesc(this.warnIncident) } : null,
    )
    addTooltip(this.lblPower, () => ({ title: t('metric.power.full', undefined, 'Power'), body: t('metric.power.ref') }))
    addTooltip(this.lblHeat, () => ({ title: t('metric.cooling.full', undefined, 'Cooling'), body: t('metric.cooling.ref') }))
    // meter hot-zones: hovering Trust / SLA explains what drained them last wave
    this.view.addChild(this.hotZone(10, 4, 186, 40, () => this.meterTip('trust')))
    this.view.addChild(this.hotZone(10, 46, 186, 40, () => this.meterTip('sla')))
    this.view.addChild(this.hotZone(202, 44, 116, 18, () => this.runwayTip()))
    this.add(this.waveText, TITLE_LEFT, 18)
    this.add(this.phaseText, TITLE_LEFT, 44)
    this.add(this.warnText, TITLE_LEFT, 66)
    this.buildTally()

    // Row 1: the playback/control cluster — Pause · Speed · Mute · ⚙ (settings),
    // tightened (w48/step54) and right-aligned so the wave-title band runs as wide
    // as possible. Music volume + language moved into Settings (the ⚙ hub).
    const step = 54
    const bx = DESIGN_W - 4 * step - 12
    this.btnPause = this.ctrl(bx, cb.onPause, () => ({
      title: t(this.lastUi?.paused ? 'hud.tip.resume' : 'hud.tip.pause'),
      value: `[${keyCap(KEY.start)}]`,
      body: t('hud.tip.pause.body'),
    }))
    this.btnSpeed = this.ctrl(
      bx + step,
      cb.onSpeed,
      () => ({
        title: t('hud.tip.speed', { v: this.lastUi?.speed ?? 1 }),
        value: `[${keyCap(KEY.speedDown)}] [${keyCap(KEY.speedUp)}]  [1 2 3 6 0]`,
        body: t('hud.tip.speed.body'),
      }),
      cb.onSpeedDown,
    )
    this.btnMute = this.ctrl(bx + step * 2, cb.onMute, () => ({
      title: t(this.lastUi?.muted ? 'hud.tip.unmute' : 'hud.tip.mute'),
      value: `[${keyCap(KEY.mute)}]`,
    }))
    this.btnSettings = this.ctrl(bx + step * 3, cb.onSettings, () => ({
      title: t('hud.tip.system'),
      value: `[${keyCap(KEY.cancel)}]`,
      body: t('hud.tip.system.body'),
    }))
    // vector glyphs, centered in their (48×30) buttons.
    this.muteIcon.x = 24
    this.muteIcon.y = 15
    this.btnMute.addChild(this.muteIcon)
    this.gearIcon.x = 24
    this.gearIcon.y = 15
    this.btnSettings.addChild(this.gearIcon)
    this.drawGear(this.gearIcon)
    // Row 2 (Expert Mode): METRICS + MODELS drop UNDER the control row so the wave
    // title band can run much wider. Right-aligned to share the cluster's edge.
    const r2y = 52
    const r2w = 96
    this.btnModels = new UIButton({
      w: r2w,
      h: 26,
      accent: COLORS.data,
      onTap: cb.onModels,
      tooltip: () => ({ title: t('models.title'), value: `[${keyCap(KEY.models)}]` }),
    })
    this.btnModels.x = DESIGN_W - 18 - r2w
    this.btnModels.y = r2y
    this.btnMetrics = new UIButton({
      w: r2w,
      h: 26,
      accent: COLORS.good,
      onTap: cb.onMetrics,
      tooltip: () => ({
        title: t('metric.telemetry.title', undefined, 'Fleet Telemetry'),
        value: `[${keyCap(KEY.metrics)}]`,
        body: t('metric.goodput.ref'),
      }),
    })
    this.btnMetrics.x = this.btnModels.x - 8 - r2w
    this.btnMetrics.y = r2y
    this.view.addChild(this.btnMetrics, this.btnModels)
  }

  /**
   * Where a fly-to-meter chip lands (design px): the Cash value, the middle of the
   * Trust / SLA bar. The board FX aims its chips here.
   */
  meterAnchor(m: HudMeter): { x: number; y: number } {
    if (m === 'cash') {
      const w = this.cashVal.width / this.cashVal.scale.x
      return { x: METER_HOME.cash.x + Math.max(16, w / 2), y: METER_HOME.cash.y + 12 }
    }
    return { x: 16 + 59, y: m === 'trust' ? 33 : 75 }
  }

  /** A chip landed: the meter's value pops (1.15 → 1 over 120 ms) and its bar edge flashes. */
  bump(m: HudMeter): void {
    this.bumps[m] = BUMP_SEC
  }

  /** Advance the landing pops (scale on the value, a bright edge on the bar). */
  private updateBumps(dt: number): void {
    const a11y = getSettings().a11y
    const calm = a11y.reducedMotion
    const g = this.flashG
    g.clear()
    for (const m of ['cash', 'trust', 'sla'] as const) {
      const left = this.bumps[m]
      const val = m === 'cash' ? this.cashVal : m === 'trust' ? this.trustVal : this.slaVal
      const home = METER_HOME[m]
      if (left <= 0) {
        if (val.scale.x !== 1) {
          val.scale.set(1)
          val.position.set(home.x, home.y)
        }
        continue
      }
      this.bumps[m] = Math.max(0, left - dt)
      const k = this.bumps[m] / BUMP_SEC
      // pop around the value's center (its anchor is the top-left corner)
      const sc = calm ? 1 : 1 + 0.15 * k
      const w0 = val.width / val.scale.x
      const h0 = val.height / val.scale.y
      val.scale.set(sc)
      val.position.set(home.x - (w0 * (sc - 1)) / 2, home.y - (h0 * (sc - 1)) / 2)
      if (a11y.reduceFlashing) continue
      const color = m === 'cash' ? COLORS.cash : m === 'trust' ? COLORS.trust : COLORS.sla
      if (m === 'cash') {
        g.roundRect(this.cashVal.x - 3, this.cashVal.y - 1, this.cashVal.width + 6, 24, 4).stroke({
          width: 1.5,
          color,
          alpha: 0.7 * k,
        })
      } else {
        g.roundRect(16, m === 'trust' ? 26 : 68, 118, 14, 3).stroke({ width: 2, color: COLORS.textBright, alpha: 0.75 * k })
      }
    }
  }

  private add(t2: Text, x: number, y: number): Text {
    t2.x = x
    t2.y = y
    this.view.addChild(t2)
    return t2
  }

  /** An invisible hover target over a HUD region, carrying a tooltip. */
  private hotZone(x: number, y: number, w: number, h: number, spec: () => TooltipSpec | null): Container {
    const z = new Container()
    z.x = x
    z.y = y
    z.eventMode = 'static'
    z.hitArea = { contains: (px: number, py: number) => px >= 0 && px <= w && py >= 0 && py <= h }
    addTooltip(z, spec)
    return z
  }

  private ctrl(x: number, onTap: () => void, tip: () => TooltipSpec, onRightTap?: () => void): UIButton {
    // only Pause is ever disabled (nothing runs between waves)
    const b: UIButton = new UIButton({
      w: 48,
      h: 30,
      onTap,
      onRightTap,
      accent: COLORS.sla,
      tooltip: tip,
      disabledReason: (): string | null => (b === this.btnPause ? t('hud.tip.pauseIdle') : null),
    })
    b.x = x
    b.y = 14
    b.layout(0, 7)
    this.view.addChild(b)
    return b
  }

  /** The seven outcome counters (glyph + count) that replace the phase line during a wave. */
  private buildTally(): void {
    this.tally.y = 44
    this.view.addChild(this.tally)
    for (const o of OUTCOMES) {
      const view = new Container()
      const glyph = new Graphics()
      glyph.x = GLYPH_BOX / 2
      glyph.y = 8
      const count = label('0', 12, COLORS.text, 'bold')
      count.x = GLYPH_BOX + 4
      count.y = 1
      view.addChild(glyph, count)
      view.eventMode = 'static'
      const slot: TallySlot = { outcome: o, view, glyph, count, n: 0, flash: 0 }
      view.hitArea = { contains: (x: number, y: number) => x >= -3 && x <= slot.count.x + slot.count.width + 3 && y >= -2 && y <= 18 }
      addTooltip(view, () => this.tallyTip(o))
      this.slots.push(slot)
      this.tally.addChild(view)
    }
  }

  private tallyTip(o: Outcome): TooltipSpec {
    const st = OUTCOME_STYLE[o]
    const n = this.slots.find((x) => x.outcome === o)?.n ?? 0
    return { title: t(st.labelKey), value: t('hud.tally.count', { n }), body: t(st.causeKey) }
  }

  /** Last-wave + run ledger of what drained Trust / SLA. */
  private meterTip(meter: 'trust' | 'sla'): TooltipSpec {
    const s = this.lastState
    const fmt = (rec: Partial<Record<Outcome, number>> | undefined): string | null => {
      if (!rec) return null
      const parts = OUTCOMES.map((o) => [o, rec[o] ?? 0] as const)
        .filter(([, v]) => v > 0.05)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([o, v]) => `${t(OUTCOME_STYLE[o].labelKey)} −${v.toFixed(v >= 10 ? 0 : 1)}`)
      return parts.length ? parts.join(' · ') : t('hud.ledger.none')
    }
    const rep = s?.lastReport
    const last = fmt(meter === 'trust' ? rep?.trustLostBy : rep?.slaLostBy)
    const run = fmt(meter === 'trust' ? s?.stats.trustLostBy : s?.stats.slaLostBy)
    const lines = [t(meter === 'trust' ? 'hud.trust.body' : 'hud.sla.body')]
    if (last !== null && rep) lines.push(t('hud.ledger.last', { n: rep.waveIndex + 1, v: last }))
    if (run !== null) lines.push(t('hud.ledger.run', { v: run }))
    const v = s ? Math.ceil(meter === 'trust' ? s.meters.trust : s.meters.sla) : 0
    return { title: t(meter === 'trust' ? 'hud.trust.title' : 'hud.sla.title'), value: `${v} / 100`, body: lines.join('\n') }
  }

  private runwayTip(): TooltipSpec {
    const s = this.lastState
    const ui = this.lastUi
    const perWave = (ui?.burnPerSec ?? 0) * (ui?.waveSec ?? 0)
    const lines = [t('hud.runway.body', { bill: perWave >= 10 ? Math.round(perWave) : perWave.toFixed(1) })]
    const p = ui?.preview
    if (s?.phase === 'build' && p && p.projectedBill > 0) {
      lines.push(t('hud.runway.bill', { bill: Math.round(p.projectedBill), cash: Math.floor(s.meters.cash) }))
    }
    return { title: t('hud.runway.title'), body: lines.join('\n') }
  }

  /** A small speaker glyph; muted → dim cone + red cross, else cone + sound chevrons. */
  private drawSpeaker(g: Graphics, muted: boolean): void {
    g.clear()
    const col = muted ? COLORS.textDim : COLORS.text
    g.poly([-8, -2.5, -3.5, -2.5, 0.5, -6.5, 0.5, 6.5, -3.5, 2.5, -8, 2.5]).fill({ color: col })
    if (muted) {
      g.moveTo(4, -5).lineTo(10, 5).moveTo(10, -5).lineTo(4, 5).stroke({ width: 1.6, color: COLORS.danger })
    } else {
      g.moveTo(4, -4).lineTo(7, 0).lineTo(4, 4).stroke({ width: 1.5, color: col })
      g.moveTo(8, -6).lineTo(12, 0).lineTo(8, 6).stroke({ width: 1.5, color: col })
    }
  }

  /** A small cog glyph for the settings button (8 teeth + hub + hole). */
  private drawGear(g: Graphics): void {
    g.clear()
    const col = COLORS.text
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      g.rect(Math.cos(a) * 8 - 1.6, Math.sin(a) * 8 - 1.6, 3.2, 3.2).fill({ color: col })
    }
    g.circle(0, 0, 6).fill({ color: col })
    g.circle(0, 0, 2.4).fill({ color: COLORS.panel })
  }

  /** The horizontal band the centered wave title / phase / warning may occupy:
   *  right of the HEAT readout, left of the row-1 control cluster. The title's main
   *  line sits at button height, so the right edge is the controls' left edge (NOT
   *  the lower row-2 cluster) — that is what kept clipping the long event names. */
  private statusBand(): { left: number; right: number } {
    return { left: TITLE_LEFT, right: this.btnPause.x - 14 }
  }

  private layoutStatus(): void {
    const { left: leftBound, right: rightBound } = this.statusBand()
    const center = (leftBound + rightBound) / 2
    for (const txt of [this.waveText, this.phaseText, this.warnText]) {
      txt.x = Math.round(clamp(center - txt.width / 2, leftBound, Math.max(leftBound, rightBound - txt.width)))
    }
  }

  /** Build the wave title with `key` (hud.wave / hud.next), truncating the NAME with an
   *  ellipsis so the whole line fits `maxW` (the full name still shows in the next-wave
   *  card and the wave report). Cached by `cacheKey` so the fit loop runs only on a change. */
  private fitWaveTitle(cacheKey: string, key: string, n: number, total: string | number, name: string, maxW: number): void {
    if (cacheKey === this.titleKey) return
    this.titleKey = cacheKey
    let nm = name
    this.waveText.text = t(key, { n, total, name: nm })
    while (nm.length > 1 && this.waveText.width > maxW) {
      nm = nm.slice(0, -1)
      this.waveText.text = t(key, { n, total, name: nm.trimEnd() + '…' })
    }
    this.titleStr = this.waveText.text
  }

  /** Live counts of the seven outcomes this wave; a counter blinks once when it climbs. */
  private updateTally(s: GameState, dt: number, maxW: number): void {
    const ws = s.waveStats
    const a11y = getSettings().a11y
    const blink = !a11y.reducedMotion && !a11y.reduceFlashing
    const palette = a11y.colorblind ? 'cb' : 'std'
    let relayout = false
    for (const slot of this.slots) {
      const n = ws ? (ws[slot.outcome] as number) : 0
      if (n !== slot.n) {
        if (n > slot.n && blink) slot.flash = 0.35
        slot.n = n
        slot.count.text = String(n)
        relayout = true
      }
      if (palette !== this.tallyPalette || relayout) {
        drawOutcomeGlyph(slot.glyph, OUTCOME_STYLE[slot.outcome].glyph, outcomeColor(slot.outcome), 10)
      }
      // served stays the calm color; failures dim to the text tone at zero
      slot.count.style.fill = n > 0 ? outcomeColor(slot.outcome) : COLORS.textDim
      slot.view.alpha = n > 0 || slot.outcome === 'served' ? 1 : 0.55
      if (slot.flash > 0) {
        slot.flash = Math.max(0, slot.flash - dt)
        const k = 1 + 0.35 * (slot.flash / 0.35)
        slot.glyph.scale.set(k)
      } else if (slot.glyph.scale.x !== 1) slot.glyph.scale.set(1)
    }
    if (palette !== this.tallyPalette) {
      this.tallyPalette = palette
      relayout = true
    }
    if (!relayout && this.tally.width > 0) return
    const gap = 14
    let x = 0
    for (const slot of this.slots) {
      slot.view.x = x
      x += GLYPH_BOX + 4 + slot.count.width + gap
    }
    const w = x - gap
    const band = this.statusBand()
    const center = (band.left + band.right) / 2
    this.tally.x = Math.round(clamp(center - w / 2, band.left, Math.max(band.left, band.left + maxW - w)))
  }

  update(s: GameState, ui: HudUi, dt = 0): void {
    this.lastState = s
    this.lastUi = ui
    const g = this.bars
    g.clear()
    bar(g, 16, 26, 118, 14, s.meters.trust / 100, COLORS.trust, s.meters.trust < 25)
    bar(g, 16, 68, 118, 14, s.meters.sla / 100, COLORS.sla, s.meters.sla < 25)
    bar(g, 326, 26, 112, 14, s.power.cap ? s.power.used / s.power.cap : 0, COLORS.power, s.power.used > s.power.cap)
    // red when either cooling pool (air, or the liquid loops' own) is over its capacity
    bar(g, 326, 68, 112, 14, s.cooling.cap ? s.cooling.used / s.cooling.cap : 0, COLORS.cooling, isThrottling(s))

    this.lblTrust.text = t('hud.trust')
    this.lblSla.text = t('hud.sla')
    this.lblCash.text = t('hud.cash')
    this.lblPower.text = t('hud.power')
    this.lblHeat.text = t('hud.heat')

    this.trustVal.text = Math.ceil(s.meters.trust).toString()
    this.slaVal.text = Math.ceil(s.meters.sla).toString()
    this.cashVal.text = '$' + Math.floor(s.meters.cash)
    this.dataVal.text = t('hud.data', { n: Math.floor(s.data) })
    this.powerVal.text = fmtKw(s.power.used) + '/' + fmtKw(s.power.cap) + ' kW'
    this.coolVal.text = fmtKw(s.cooling.used) + '/' + fmtKw(s.cooling.cap) + ' kW'

    // runway: how many waves the fleet can keep billing with zero income (cash ÷ per-wave bill).
    const perWave = ui.burnPerSec * ui.waveSec
    const waves = perWave > 0 ? Math.max(0, s.meters.cash) / perWave : Infinity
    this.runway.text = Number.isFinite(waves) ? t('hud.runway', { v: fmtWaves(waves) }) : t('hud.runwayInf')
    this.runway.style.fill = waves < 1 ? COLORS.danger : waves < 2 ? COLORS.warn : COLORS.textDim

    const band = this.statusBand()
    const maxTitleW = Math.max(80, band.right - band.left)
    const live = s.phase === 'wave'
    const p = ui.preview
    if (!live && p && s.phase === 'build') {
      // build phase: the HUD names the wave START launches next
      const total = s.endless ? '∞' : WAVES.length
      const n = p.index + 1
      const name = p.def ? waveName(p.def, p.index) : t('next.endlessTitle', { n: p.surgeNumber })
      this.fitWaveTitle(`next|${n}|${total}|${getLang()}|${name}|${maxTitleW}`, 'hud.next', n, total, name, maxTitleW)
      this.waveText.text = this.titleStr
      this.phaseText.text =
        s.waveIndex < 0
          ? t('hud.prelaunchSub')
          : p.totalRequests > 0
            ? t('hud.buildIncoming', { n: p.totalRequests })
            : t('hud.build')
    } else if (s.waveIndex < 0) {
      this.titleKey = ''
      this.waveText.text = t('hud.prelaunch')
      this.phaseText.text = t('hud.prelaunchSub')
    } else {
      const idx = Math.max(0, s.waveIndex)
      const fullName =
        idx < WAVES.length ? waveName(WAVES[idx], idx) : (s.currentWave?.name ?? `Surge ${idx - WAVES.length + 1}`)
      const total = s.endless ? '∞' : WAVES.length
      const n = s.waveIndex + 1
      this.fitWaveTitle(`wave|${n}|${total}|${getLang()}|${fullName}|${maxTitleW}`, 'hud.wave', n, total, fullName, maxTitleW)
      this.waveText.text = this.titleStr
      this.phaseText.text = live
        ? ''
        : s.phase === 'lost'
          ? t('hud.runLost')
          : s.phase === 'won'
            ? t('hud.runWon')
            : t('hud.build')
    }
    // during a wave the phase line becomes the live outcome tally
    this.tally.visible = live
    this.phaseText.visible = !live
    if (live) this.updateTally(s, dt, maxTitleW)

    // the status line: a power/heat emergency, else PAUSED, else the live incident (the
    // board banner told it in full during the build phase; hover here repeats it)
    let warn = ''
    let warnFill: number = COLORS.danger
    const inc = live ? s.pendingIncident : null
    this.warnIncident = null
    if (isLiquidGated(s)) warn = t('hud.liquidGate')
    else if (isBrownout(s)) warn = t('hud.brownout')
    else if (isThrottling(s)) warn = t('hud.throttle')
    else if (ui.paused && live) {
      warn = t('hud.pausedTag')
      warnFill = COLORS.sla
    } else if (inc) {
      warn = t('hud.incidentLine', { icon: inc.icon, label: t('inc.active'), name: incName(inc) })
      warnFill = inc.good ? COLORS.trust : COLORS.warn
      this.warnIncident = inc
    }
    this.warnText.text = warn
    this.warnText.style.fill = warnFill

    // Row-2 cluster — Expert Mode only (the rich modal/telemetry surfaces are Expert).
    const expert = isExpert()
    this.btnModels.visible = expert
    this.btnMetrics.visible = expert
    if (expert) {
      this.btnModels.setTitle(t('hud.models')).layout(0, 0, true)
      this.btnMetrics.setTitle(t('metric.telemetry')).setActive(!!ui.metricsOpen).layout(0, 0, true)
    }
    this.layoutStatus()

    this.btnPause
      .setTitle(ui.paused ? '▶' : '❚❚')
      .setActive(ui.paused)
      .setEnabled(live)
      .layout(0, 18)
    this.btnSpeed
      .setTitle(ui.speed + '×')
      .setActive(ui.speed > 1)
      .layout(0, 14)
    this.btnMute.setTitle('').setActive(ui.muted).layout()
    this.drawSpeaker(this.muteIcon, ui.muted)
    this.btnSettings.setTitle('').layout()
    this.updateBumps(dt)
  }
}
