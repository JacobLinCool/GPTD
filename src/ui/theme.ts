import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'
import { COLORS } from '../config'

export const FONT = 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace'

export function textStyle(
  size: number,
  fill: number = COLORS.text,
  weight: 'normal' | 'bold' = 'normal',
): TextStyleOptions {
  return { fontFamily: FONT, fontSize: size, fill, fontWeight: weight, letterSpacing: 0 }
}

export function label(
  text: string,
  size = 14,
  fill: number = COLORS.text,
  weight: 'normal' | 'bold' = 'normal',
): Text {
  const t = new Text({ text, style: textStyle(size, fill, weight) })
  t.resolution = 2
  return t
}

/** Draw a rounded "glass" panel into a Graphics. */
export function drawPanel(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: number; alpha?: number; edge?: number; radius?: number } = {},
): void {
  const { fill = COLORS.panel, alpha = 0.92, edge = COLORS.panelEdge, radius = 8 } = opts
  g.roundRect(x, y, w, h, radius).fill({ color: fill, alpha })
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius).stroke({ width: 1, color: edge, alpha: 0.9 })
}

export interface ButtonOpts {
  w: number
  h: number
  onTap: () => void
  radius?: number
  accent?: number
}

/** A reusable interactive button with bg, optional icon child, and two text lines. */
export class UIButton extends Container {
  readonly bg = new Graphics()
  private titleText = label('', 13, COLORS.text, 'bold')
  private subText = label('', 11, COLORS.textDim)
  private _w: number
  private _h: number
  private _accent: number
  private _radius: number
  enabled = true
  active = false
  hovered = false
  iconHost = new Container()

  constructor(opts: ButtonOpts) {
    super()
    this._w = opts.w
    this._h = opts.h
    this._accent = opts.accent ?? COLORS.sla
    this._radius = opts.radius ?? 7
    this.addChild(this.bg, this.iconHost, this.titleText, this.subText)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerover', () => {
      this.hovered = true
      this.redraw()
    })
    this.on('pointerout', () => {
      this.hovered = false
      this.redraw()
    })
    this.on('pointertap', () => {
      if (this.enabled) opts.onTap()
    })
    this.redraw()
  }

  setTitle(t: string): this {
    this.titleText.text = t
    return this
  }
  setSub(t: string): this {
    this.subText.text = t
    return this
  }
  setAccent(c: number): this {
    this._accent = c
    this.redraw()
    return this
  }
  setEnabled(e: boolean): this {
    if (this.enabled !== e) {
      this.enabled = e
      this.redraw()
    }
    return this
  }
  setActive(a: boolean): this {
    if (this.active !== a) {
      this.active = a
      this.redraw()
    }
    return this
  }

  /** Card layout: title pinned top-left, description wrapped beneath it. */
  layoutCard(pad = 12, subSize = 11): void {
    this.subText.style.fontSize = subSize
    this.subText.style.wordWrap = true
    this.subText.style.wordWrapWidth = this._w - pad * 2
    this.subText.style.lineHeight = subSize + 4
    this.titleText.x = pad
    this.titleText.y = pad
    this.subText.x = pad
    this.subText.y = pad + this.titleText.height + 5
    this.iconHost.x = pad
    this.iconHost.y = this._h / 2
  }

  /** Layout text lines; call after setting title/sub. iconW reserves left space. */
  layout(iconW = 0, pad = 9, center = false): void {
    const textW = Math.max(24, this._w - pad * 2 - iconW)
    this.fitText(this.titleText, textW, 13, 9)
    this.fitText(this.subText, textW, 11, 8)
    const tx = center ? (this._w - this.titleText.width) / 2 : pad + iconW
    this.titleText.x = tx
    this.subText.x = center ? (this._w - this.subText.width) / 2 : pad + iconW
    if (this.subText.text) {
      this.titleText.y = this._h / 2 - this.titleText.height - 1
      this.subText.y = this._h / 2 + 1
    } else {
      this.titleText.y = (this._h - this.titleText.height) / 2
    }
    this.iconHost.x = pad + iconW / 2
    this.iconHost.y = this._h / 2
  }

  /** Compact build-card layout: icon above, title and price centered below. */
  layoutIconCard(iconY = 24, titleY = 43, subY = 60): void {
    const textW = Math.max(24, this._w - 10)
    this.fitText(this.titleText, textW, 12, 9)
    this.fitText(this.subText, textW, 10, 8)
    this.iconHost.x = this._w / 2
    this.iconHost.y = iconY
    this.titleText.x = (this._w - this.titleText.width) / 2
    this.titleText.y = titleY
    this.subText.x = (this._w - this.subText.width) / 2
    this.subText.y = subY
  }

  private fitText(t: Text, maxW: number, baseSize: number, minSize: number): void {
    t.style.fontSize = baseSize
    if (!t.text || t.width <= maxW) return
    const next = Math.max(minSize, Math.floor((baseSize * maxW) / t.width))
    t.style.fontSize = next
  }

  redraw(): void {
    const g = this.bg
    g.clear()
    const base = this.active ? 0x1a2c44 : this.hovered && this.enabled ? 0x182640 : COLORS.panel
    g.roundRect(0, 0, this._w, this._h, this._radius).fill({ color: base, alpha: this.enabled ? 0.96 : 0.55 })
    g.roundRect(0.5, 0.5, this._w - 1, this._h - 1, this._radius).stroke({
      width: this.active ? 2 : 1,
      color: this.active ? this._accent : COLORS.panelEdge,
      alpha: this.enabled ? 1 : 0.5,
    })
    this.titleText.alpha = this.enabled ? 1 : 0.5
    this.subText.alpha = this.enabled ? 1 : 0.4
    this.iconHost.alpha = this.enabled ? 1 : 0.5
  }
}
