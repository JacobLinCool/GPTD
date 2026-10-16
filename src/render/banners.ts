import { BitmapText, Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_W, GRID_Y, TILE } from '../config'
import { clamp01, easeInQuad, easeOutCubic, reducedMotion } from './anim'
import { POP_FONT, ensurePopFont } from './popups'

const IN = 0.22
const HOLD = 1.1
const OUT = 0.22

interface BannerSpec {
  title: string
  sub?: string
  chip?: string
  stamp?: string
  accent: number
  /** count-up target for the sub line (clear bonus), formatted by `fmtSub` */
  countTo?: number
  fmtSub?: (v: number) => string
}

/**
 * Wave beats on the board: a title card slides in when a wave starts ("WAVE 23 ·
 * The Cheap-Token Price War" with its era chip, a red BOSS stamp on boss waves) and
 * a clear card when it ends (the clear bonus counting up). It sits in the board's
 * upper third — above the core, below the incident banner — and never shakes. At
 * high speed the cards shorten; at 12× only the lane portals mark the beat.
 */
export class BannerLayer {
  readonly view = new Container()
  private panel = new Graphics()
  private title: BitmapText
  private sub: BitmapText
  private chip: BitmapText
  private stamp: BitmapText
  private spec: BannerSpec | null = null
  private age = 0
  private dur = 1
  private y = Math.round(GRID_Y + TILE * 2.7)

  constructor() {
    ensurePopFont()
    const text = (size: number) =>
      new BitmapText({ text: '', style: { fontFamily: POP_FONT, fontSize: size } })
    this.title = text(20)
    this.sub = text(12)
    this.chip = text(11)
    this.stamp = text(13)
    this.title.anchor.set(0.5)
    this.sub.anchor.set(0.5)
    this.chip.anchor.set(0.5)
    this.stamp.anchor.set(0.5)
    this.view.addChild(this.panel, this.chip, this.stamp, this.title, this.sub)
    this.view.eventMode = 'none'
    this.view.visible = false
  }

  /** Show a card; `speed` shortens it (≥3× halves, ≥12× skips it entirely). */
  show(spec: BannerSpec, speed: number): void {
    if (speed >= 12) return
    this.spec = spec
    this.age = 0
    this.dur = speed >= 3 ? 0.5 : 1
    this.title.text = spec.title
    this.title.tint = 0xffffff
    this.sub.text = spec.countTo !== undefined && spec.fmtSub ? spec.fmtSub(0) : (spec.sub ?? '')
    this.sub.tint = spec.accent
    this.chip.text = spec.chip ?? ''
    this.chip.tint = COLORS.textDim
    this.stamp.text = spec.stamp ?? ''
    this.stamp.tint = 0xffffff
    this.layout()
    this.view.visible = true
  }

  clear(): void {
    this.spec = null
    this.view.visible = false
  }

  private layout(): void {
    const spec = this.spec!
    const tw = this.title.width
    const sw = this.sub.text ? this.sub.width : 0
    const stampW = spec.stamp ? this.stamp.width + 16 : 0
    const w = Math.round(Math.max(tw + stampW, sw, 160) + 48)
    const hasSub = !!this.sub.text
    const h = hasSub ? 58 : 40
    const g = this.panel
    g.clear()
    g.rect(-w / 2, -h / 2, w, h).fill({ color: COLORS.panel, alpha: 0.9 })
    g.rect(-w / 2, -h / 2, w, 2).fill({ color: spec.accent })
    g.rect(-w / 2, h / 2 - 2, w, 2).fill({ color: spec.accent, alpha: 0.6 })
    g.rect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1).stroke({ width: 1, color: COLORS.panelEdge })
    const ty = hasSub ? -9 : 0
    this.title.position.set(Math.round(stampW / 2), ty)
    if (spec.stamp) {
      const sx = Math.round(-tw / 2 - 10 + stampW / 2 - this.stamp.width / 2)
      g.rect(sx - this.stamp.width / 2 - 5, ty - 9, this.stamp.width + 10, 18).fill({ color: COLORS.danger })
      this.stamp.position.set(sx, ty)
    }
    this.sub.position.set(0, 14)
    // era chip hangs off the panel's top edge
    if (spec.chip) {
      const cw = this.chip.width + 12
      g.rect(-cw / 2, -h / 2 - 9, cw, 14).fill({ color: COLORS.bg, alpha: 0.95 })
      g.rect(-cw / 2 + 0.5, -h / 2 - 8.5, cw - 1, 13).stroke({ width: 1, color: spec.accent, alpha: 0.8 })
      this.chip.position.set(0, -h / 2 - 2)
    }
  }

  update(dt: number): void {
    const spec = this.spec
    if (!spec) return
    this.age += dt
    const inT = IN * this.dur
    const holdT = HOLD * this.dur
    const outT = OUT * this.dur
    const total = inT + holdT + outT
    if (this.age >= total) {
      this.clear()
      return
    }
    const calm = reducedMotion()
    let dx = 0
    let alpha = 1
    if (this.age < inT) {
      const k = easeOutCubic(this.age / inT)
      dx = calm ? 0 : -40 * (1 - k)
      alpha = k
    } else if (this.age > inT + holdT) {
      const k = easeInQuad((this.age - inT - holdT) / outT)
      dx = calm ? 0 : 40 * k
      alpha = 1 - k
    }
    this.view.position.set(Math.round(DESIGN_W / 2 + dx), this.y)
    this.view.alpha = alpha
    if (spec.countTo !== undefined && spec.fmtSub) {
      const k = clamp01((this.age - inT * 0.5) / (holdT * 0.6))
      this.sub.text = spec.fmtSub(spec.countTo * easeOutCubic(k))
    }
  }
}
