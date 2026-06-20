import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_W, HUD_H } from '../config'
import type { GameState } from '../core/types'
import { isExpert } from '../mode'
import { WAVES } from '../sim/content'
import { isBrownout, isLiquidGated, isThrottling } from '../sim/power'
import { addTooltip } from './tooltip'
import { getLang, t, waveName } from '../i18n'
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

export interface HudCallbacks {
  onPause: () => void
  onSpeed: () => void
  onMute: () => void
  /** open the system menu / settings hub. */
  onSettings: () => void
  /** §5.2 S7: open the ModelOverview modal (Expert Mode). */
  onModels: () => void
  /** §5.2 S2: toggle the floating telemetry panel (Expert Mode). */
  onMetrics: () => void
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
  private dataVal = label('', 13, COLORS.data, 'bold')
  private powerVal = label('', 11, COLORS.power)
  private coolVal = label('', 11, COLORS.cooling)
  private waveText = label('', 15, COLORS.textBright, 'bold')
  private phaseText = label('', 12, COLORS.textDim)
  private warnText = label('', 12, COLORS.danger, 'bold')
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

  constructor(cb: HudCallbacks) {
    this.view.addChild(this.bg, this.bars)
    drawPanel(this.bg, 0, 0, DESIGN_W, HUD_H, { radius: 0, alpha: 0.96 })
    this.bg.rect(0, HUD_H - 2, DESIGN_W, 2).fill({ color: COLORS.laneGlow, alpha: 0.5 })

    this.add(this.lblTrust, 16, 8)
    this.add(this.lblSla, 16, 50)
    // bars narrowed to 118 — value sits just right of the shorter bar, and the
    // whole CASH / POWER / HEAT cluster shifts left so the wave title gets more room.
    this.add(this.trustVal, 142, 26)
    this.add(this.slaVal, 142, 68)
    this.add(this.lblCash, 206, 8)
    this.add(this.cashVal, 206, 24)
    this.add(this.dataVal, 206, 64)
    this.add(this.lblPower, 326, 8)
    this.add(this.powerVal, 444, 24)
    this.add(this.lblHeat, 326, 50)
    this.add(this.coolVal, 444, 66)
    addTooltip(this.lblPower, () => ({ title: t('metric.power.full', undefined, 'Power'), body: t('metric.power.ref') }))
    addTooltip(this.lblHeat, () => ({ title: t('metric.cooling.full', undefined, 'Cooling'), body: t('metric.cooling.ref') }))
    this.add(this.waveText, TITLE_LEFT, 18)
    this.add(this.phaseText, TITLE_LEFT, 44)
    this.add(this.warnText, TITLE_LEFT, 66)

    // Row 1: the playback/control cluster — Pause · Speed · Mute · ⚙ (settings),
    // tightened (w48/step54) and right-aligned so the wave-title band runs as wide
    // as possible. Music volume + language moved into Settings (the ⚙ hub).
    const step = 54
    const bx = DESIGN_W - 4 * step - 12
    this.btnPause = this.ctrl(bx, cb.onPause)
    this.btnSpeed = this.ctrl(bx + step, cb.onSpeed)
    this.btnMute = this.ctrl(bx + step * 2, cb.onMute)
    this.btnSettings = this.ctrl(bx + step * 3, cb.onSettings)
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
    this.btnModels = new UIButton({ w: r2w, h: 26, accent: COLORS.data, onTap: cb.onModels })
    this.btnModels.x = DESIGN_W - 18 - r2w
    this.btnModels.y = r2y
    this.btnMetrics = new UIButton({ w: r2w, h: 26, accent: COLORS.good, onTap: cb.onMetrics })
    this.btnMetrics.x = this.btnModels.x - 8 - r2w
    this.btnMetrics.y = r2y
    this.view.addChild(this.btnMetrics, this.btnModels)
    addTooltip(this.btnMetrics, () => ({
      title: t('metric.telemetry.title', undefined, 'Fleet Telemetry'),
      body: t('metric.goodput.ref'),
    }))
  }

  private add(t2: Text, x: number, y: number): Text {
    t2.x = x
    t2.y = y
    this.view.addChild(t2)
    return t2
  }

  private ctrl(x: number, onTap: () => void): UIButton {
    const b = new UIButton({ w: 48, h: 30, onTap, accent: COLORS.sla })
    b.x = x
    b.y = 14
    b.layout(0, 7)
    this.view.addChild(b)
    return b
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

  /** Build the "Wave n/total — name" title, truncating the NAME with an ellipsis so
   *  the whole line fits `maxW` (the full name still shows in the next-wave banner
   *  and the wave report). Cached by `key` so the fit loop runs only on a change. */
  private fitWaveTitle(key: string, n: number, total: string | number, name: string, maxW: number): void {
    if (key === this.titleKey) return
    this.titleKey = key
    let nm = name
    this.waveText.text = t('hud.wave', { n, total, name: nm })
    while (nm.length > 1 && this.waveText.width > maxW) {
      nm = nm.slice(0, -1)
      this.waveText.text = t('hud.wave', { n, total, name: nm.trimEnd() + '…' })
    }
    this.titleStr = this.waveText.text
  }

  update(
    s: GameState,
    ui: { paused: boolean; speed: number; muted: boolean; metricsOpen?: boolean },
  ): void {
    const g = this.bars
    g.clear()
    bar(g, 16, 26, 118, 14, s.meters.trust / 100, COLORS.trust, s.meters.trust < 25)
    bar(g, 16, 68, 118, 14, s.meters.sla / 100, COLORS.sla, s.meters.sla < 25)
    bar(g, 326, 26, 112, 14, s.power.cap ? s.power.used / s.power.cap : 0, COLORS.power, s.power.used > s.power.cap)
    bar(g, 326, 68, 112, 14, s.cooling.cap ? s.cooling.used / s.cooling.cap : 0, COLORS.cooling, s.cooling.used > s.cooling.cap)

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

    const idx = Math.max(0, s.waveIndex)
    const band = this.statusBand()
    const maxTitleW = Math.max(80, band.right - band.left)
    if (s.waveIndex < 0) {
      this.titleKey = ''
      this.waveText.text = t('hud.prelaunch')
      this.phaseText.text = t('hud.prelaunchSub')
    } else {
      const fullName =
        idx < WAVES.length ? waveName(WAVES[idx], idx) : (s.currentWave?.name ?? `Surge ${idx - WAVES.length + 1}`)
      const total = s.endless ? '∞' : WAVES.length
      const n = s.waveIndex + 1
      this.fitWaveTitle(`${n}|${total}|${getLang()}|${fullName}|${maxTitleW}`, n, total, fullName, maxTitleW)
      this.waveText.text = this.titleStr
      this.phaseText.text = s.phase === 'wave' ? t('hud.serving') : t('hud.build')
    }

    let warn = ''
    if (isLiquidGated(s)) warn = t('hud.liquidGate')
    else if (isBrownout(s)) warn = t('hud.brownout')
    else if (isThrottling(s)) warn = t('hud.throttle')
    this.warnText.text = warn

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
      .layout(0, 18)
    this.btnSpeed
      .setTitle(ui.speed + '×')
      .setActive(ui.speed > 1)
      .layout(0, 14)
    this.btnMute.setTitle('').setActive(ui.muted).layout()
    this.drawSpeaker(this.muteIcon, ui.muted)
    this.btnSettings.setTitle('').layout()
  }
}
