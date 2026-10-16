import { Container, Graphics, Text, type FederatedPointerEvent, type TextStyleOptions } from 'pixi.js'
import { COLORS } from '../config'
import { addTooltip, tooltip, type TooltipSpec } from './tooltip'
import { uiSound } from './uiSound'

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
  /** secondary action on a right-click (e.g. step the speed DOWN). */
  onRightTap?: () => void
  /** a tap on the DISABLED button (the caller can explain why, e.g. a denied toast). */
  onDenied?: () => void
  /** hover tooltip for the enabled button (null = none). */
  tooltip?: () => TooltipSpec | null
  /** why the button is disabled right now — shown in its tooltip while disabled. */
  disabledReason?: () => string | null
  /** skip the generic click cue (the action plays its own sound). */
  silent?: boolean
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
  private opts: ButtonOpts
  enabled = true
  active = false
  hovered = false
  /** keyboard focus — drawn with the SAME cue as hover (one indicator, never doubled). */
  focused = false
  iconHost = new Container()
  // two-step "tap again to confirm" arm (Restart / Quit / START-anyway)
  private armedUntil = 0
  private armTimer: ReturnType<typeof setTimeout> | null = null
  private restTitle: string | null = null
  // optional hotkey badge (top-right corner)
  private badgeBg: Graphics | null = null
  private badgeText: Text | null = null
  /** the last layout() call, replayed when arm/disarm swaps the title. */
  private lastLayout: [number, number, boolean] | null = null

  constructor(opts: ButtonOpts) {
    super()
    this.opts = opts
    this._w = opts.w
    this._h = opts.h
    this._accent = opts.accent ?? COLORS.sla
    this._radius = opts.radius ?? 7
    this.addChild(this.bg, this.iconHost, this.titleText, this.subText)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerover', (e: FederatedPointerEvent) => {
      this.hovered = true
      this.redraw()
      if (this.enabled && e.pointerType !== 'touch') uiSound('hover')
    })
    this.on('pointerout', () => {
      this.hovered = false
      this.redraw()
    })
    this.on('pointertap', (e: FederatedPointerEvent) => {
      // a touch long-press that opened the tooltip is a peek, not a press
      if (tooltip().consumeLongPress()) return
      if (e.button === 2) {
        if (this.enabled && opts.onRightTap) {
          if (!opts.silent) uiSound('click')
          opts.onRightTap()
        }
        return
      }
      this.activate()
    })
    if (opts.tooltip || opts.disabledReason) addTooltip(this, () => this.tipSpec())
    this.redraw()
  }

  /** Press the button programmatically (keyboard Enter / hotkeys): runs onTap or the denied path. */
  activate(): void {
    if (this.enabled) {
      if (!this.opts.silent) uiSound('click')
      this.opts.onTap()
    } else {
      uiSound('denied')
      this.opts.onDenied?.()
    }
  }

  /** The combined tooltip: the enabled description, plus the disabled reason when greyed out. */
  private tipSpec(): TooltipSpec | null {
    const base = this.opts.tooltip?.() ?? null
    const why = !this.enabled ? (this.opts.disabledReason?.() ?? null) : null
    if (!why) return base
    if (!base) return { title: why }
    return { ...base, value: why }
  }

  setTitle(t: string): this {
    if (this.isArmed) {
      // keep the confirm prompt up; remember what the caller wants afterwards
      this.restTitle = t
      return this
    }
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
  setFocused(f: boolean): this {
    if (this.focused !== f) {
      this.focused = f
      this.redraw()
    }
    return this
  }

  /** True while a two-step confirm is pending (the next tap commits). */
  get isArmed(): boolean {
    return this.armedUntil > 0 && performance.now() < this.armedUntil
  }

  /**
   * Arm a two-step confirm: swap the title for `prompt` and draw the warn edge
   * for `ms`; it reverts on its own. The caller checks `isArmed` on the next tap.
   */
  arm(prompt: string, ms = 2500): this {
    if (!this.isArmed) this.restTitle = this.titleText.text
    this.titleText.text = prompt
    this.armedUntil = performance.now() + ms
    if (this.armTimer) clearTimeout(this.armTimer)
    this.armTimer = setTimeout(() => this.disarm(), ms)
    uiSound('arm')
    this.relayout()
    this.redraw()
    return this
  }

  /** Drop a pending confirm and restore the resting title. */
  disarm(): this {
    if (this.armTimer) clearTimeout(this.armTimer)
    this.armTimer = null
    if (this.armedUntil === 0) return this
    this.armedUntil = 0
    if (this.restTitle !== null) this.titleText.text = this.restTitle
    this.restTitle = null
    this.relayout()
    this.redraw()
    return this
  }

  private relayout(): void {
    if (this.lastLayout) this.layout(...this.lastLayout)
  }

  /** A small key-cap badge in the top-right corner (null hides it). */
  setHotkey(key: string | null): this {
    if (!key) {
      if (this.badgeBg) this.badgeBg.visible = false
      if (this.badgeText) this.badgeText.visible = false
      return this
    }
    if (!this.badgeBg || !this.badgeText) {
      this.badgeBg = new Graphics()
      this.badgeText = label('', 9, COLORS.textDim, 'bold')
      this.addChild(this.badgeBg, this.badgeText)
    }
    if (this.badgeText.text !== key || !this.badgeText.visible) {
      this.badgeText.text = key
      const w = Math.max(12, Math.ceil(this.badgeText.width) + 6)
      const h = 12
      const x = this._w - w - 3
      const y = 3
      this.badgeBg.clear()
      this.badgeBg.roundRect(x, y, w, h, 3).fill({ color: 0x0a0e14, alpha: 0.85 })
      this.badgeBg.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3).stroke({ width: 1, color: COLORS.panelEdge })
      this.badgeText.x = x + (w - this.badgeText.width) / 2
      this.badgeText.y = y + (h - this.badgeText.height) / 2
    }
    this.badgeBg.visible = true
    this.badgeText.visible = true
    this.badgeBg.alpha = this.badgeText.alpha = this.enabled ? 1 : 0.5
    return this
  }

  /** Card layout: title pinned top-left, description wrapped beneath it. */
  layoutCard(pad = 12, subSize = 11): void {
    this.subText.style.fontSize = subSize
    this.subText.style.wordWrap = true
    this.subText.style.breakWords = true
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
    this.lastLayout = [iconW, pad, center]
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
    const armed = this.isArmed
    // hover and keyboard focus share ONE cue (lifted fill + accent hairline); the
    // active / armed state is the only 2px edge — never two indicators at once.
    const lifted = (this.hovered || this.focused) && this.enabled
    const base = this.active ? 0x1a2c44 : lifted ? 0x182640 : COLORS.panel
    g.roundRect(0, 0, this._w, this._h, this._radius).fill({ color: base, alpha: this.enabled ? 0.96 : 0.55 })
    const edge = armed ? COLORS.warn : this.active || lifted ? this._accent : COLORS.panelEdge
    g.roundRect(0.5, 0.5, this._w - 1, this._h - 1, this._radius).stroke({
      width: this.active || armed ? 2 : 1,
      color: edge,
      alpha: this.enabled ? (lifted && !this.active && !armed ? 0.75 : 1) : 0.5,
    })
    this.titleText.style.fill = armed ? COLORS.warn : COLORS.text
    this.titleText.alpha = this.enabled ? 1 : 0.5
    this.subText.alpha = this.enabled ? 1 : 0.4
    this.iconHost.alpha = this.enabled ? 1 : 0.5
    if (this.badgeBg && this.badgeText) this.badgeBg.alpha = this.badgeText.alpha = this.enabled ? 1 : 0.5
  }
}

/**
 * Keyboard focus over an ordered list of buttons (a column, row, or grid):
 * arrows move the focus, Enter activates. The focus cue is the button's own
 * hover look, so mouse and keyboard never show two indicators.
 */
export class FocusList {
  private index = -1

  constructor(
    private buttons: () => UIButton[],
    private cols = 1,
  ) {}

  /** Move focus; dx/dy in grid steps. The first move lands on the first visible button. */
  move(dx: number, dy: number): void {
    const list = this.visible()
    if (!list.length) return
    let i = this.index
    if (i < 0 || i >= list.length) i = 0
    else i = Math.max(0, Math.min(list.length - 1, i + dx + dy * this.cols))
    for (const b of this.buttons()) b.setFocused(false)
    this.index = i
    list[i].setFocused(true)
  }

  /** Activate the focused button; returns false when nothing is focused. */
  activate(): boolean {
    const b = this.visible()[this.index]
    if (!b) return false
    b.activate()
    return true
  }

  clear(): void {
    for (const b of this.buttons()) b.setFocused(false)
    this.index = -1
  }

  private visible(): UIButton[] {
    return this.buttons().filter((b) => b.visible)
  }
}
