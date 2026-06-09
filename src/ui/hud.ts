import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_W, HUD_H } from '../config'
import type { GameState } from '../core/types'
import { WAVES } from '../sim/content'
import { isBrownout, isThrottling } from '../sim/power'
import { drawPanel, label, UIButton } from './theme'

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

export interface HudCallbacks {
  onPause: () => void
  onSpeed: () => void
  onMute: () => void
  onMusic: () => void
}

export class Hud {
  readonly view = new Container()
  private bg = new Graphics()
  private bars = new Graphics()
  private trustVal = label('', 12, COLORS.trust, 'bold')
  private slaVal = label('', 12, COLORS.sla, 'bold')
  private cashVal = label('', 20, COLORS.cash, 'bold')
  private dataVal = label('', 13, COLORS.data, 'bold')
  private powerVal = label('', 11, COLORS.power)
  private coolVal = label('', 11, COLORS.cooling)
  private waveText = label('', 15, COLORS.textBright, 'bold')
  private phaseText = label('', 12, COLORS.textDim)
  private warnText = label('', 12, COLORS.danger, 'bold')
  private btnPause: UIButton
  private btnSpeed: UIButton
  private btnMute: UIButton
  private btnMusic: UIButton

  constructor(cb: HudCallbacks) {
    this.view.addChild(this.bg, this.bars)
    drawPanel(this.bg, 0, 0, DESIGN_W, HUD_H, { radius: 0, alpha: 0.96 })
    this.bg.rect(0, HUD_H - 2, DESIGN_W, 2).fill({ color: COLORS.laneGlow, alpha: 0.5 })

    const labels = [
      ['TRUST', 16, 8, COLORS.trust],
      ['SLA', 16, 50, COLORS.sla],
    ] as const
    for (const [t, x, y, c] of labels) this.add(label(t, 11, c as number), x, y)

    this.add(this.trustVal, 188, 26)
    this.add(this.slaVal, 188, 68)

    this.add(label('CASH', 11, COLORS.textDim), 248, 8)
    this.add(this.cashVal, 248, 24)
    this.add(this.dataVal, 248, 64)

    this.add(label('POWER', 11, COLORS.textDim), 392, 8)
    this.add(this.powerVal, 510, 24)
    this.add(label('HEAT', 11, COLORS.textDim), 392, 50)
    this.add(this.coolVal, 510, 66)

    this.add(this.waveText, 600, 18)
    this.add(this.phaseText, 600, 44)
    this.add(this.warnText, 600, 66)

    const bx = DESIGN_W - 4 * 62 - 12
    this.btnPause = this.ctrl(bx, cb.onPause)
    this.btnSpeed = this.ctrl(bx + 62, cb.onSpeed)
    this.btnMute = this.ctrl(bx + 124, cb.onMute)
    this.btnMusic = this.ctrl(bx + 186, cb.onMusic)
  }

  private add(t: Text, x: number, y: number): Text {
    t.x = x
    t.y = y
    this.view.addChild(t)
    return t
  }

  private ctrl(x: number, onTap: () => void): UIButton {
    const b = new UIButton({ w: 56, h: 30, onTap, accent: COLORS.sla })
    b.x = x
    b.y = 14
    b.layout(0, 7)
    this.view.addChild(b)
    return b
  }

  update(s: GameState, ui: { paused: boolean; speed: number; muted: boolean; musicOn: boolean }): void {
    const g = this.bars
    g.clear()
    bar(g, 16, 26, 168, 14, s.meters.trust / 100, COLORS.trust, s.meters.trust < 25)
    bar(g, 16, 68, 168, 14, s.meters.sla / 100, COLORS.sla, s.meters.sla < 25)
    bar(
      g,
      392,
      26,
      112,
      14,
      s.power.cap ? s.power.used / s.power.cap : 0,
      COLORS.power,
      s.power.used > s.power.cap,
    )
    bar(
      g,
      392,
      68,
      112,
      14,
      s.cooling.cap ? s.cooling.used / s.cooling.cap : 0,
      COLORS.cooling,
      s.cooling.used > s.cooling.cap,
    )

    this.trustVal.text = Math.ceil(s.meters.trust).toString()
    this.slaVal.text = Math.ceil(s.meters.sla).toString()
    this.cashVal.text = '$' + Math.floor(s.meters.cash)
    this.dataVal.text = '◆ ' + Math.floor(s.data) + ' data'
    this.powerVal.text = s.power.used.toFixed(0) + '/' + s.power.cap.toFixed(0)
    this.coolVal.text = s.cooling.used.toFixed(0) + '/' + s.cooling.cap.toFixed(0)

    const idx = Math.max(0, s.waveIndex)
    const w = WAVES[Math.min(idx, WAVES.length - 1)]
    if (s.waveIndex < 0) {
      this.waveText.text = 'Pre-launch'
      this.phaseText.text = 'Build your first servers'
    } else {
      this.waveText.text = `Wave ${s.waveIndex + 1}/${WAVES.length} — ${w.name}`
      this.phaseText.text = s.phase === 'wave' ? 'Serving live traffic…' : 'Build phase'
    }

    let warn = ''
    if (isBrownout(s)) warn = '⚡ BROWNOUT — add Power'
    else if (isThrottling(s)) warn = '❄ THROTTLING — add Cooling'
    this.warnText.text = warn

    this.btnPause
      .setTitle(ui.paused ? '▶' : '❚❚')
      .setActive(ui.paused)
      .layout(0, 18)
    this.btnSpeed
      .setTitle(ui.speed + '×')
      .setActive(ui.speed > 1)
      .layout(0, 14)
    this.btnMute
      .setTitle(ui.muted ? '🔇' : '🔊')
      .setActive(ui.muted)
      .layout(0, 12)
    this.btnMusic.setTitle('♪').setActive(ui.musicOn).layout(0, 20)
  }
}
