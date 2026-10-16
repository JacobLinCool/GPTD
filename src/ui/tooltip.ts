/**
 * ui/tooltip.ts — a single hover-tooltip singleton (§5.3).
 *
 * Any interactive display element can register a tooltip provider; after the
 * pointer rests on it for ~450 ms (or a ~450 ms long-press on touch) a small
 * panel appears showing
 *   NAME · VALUE UNIT
 *   one-line formula / §ref
 * sourced from the shared `metric.*` i18n group. The tooltip lives on its own
 * top-most container the Game adds to the root, so it always draws above panels.
 * A provider may return null when it has nothing to say right now (e.g. a
 * button that only explains itself while disabled).
 *
 * Pure presentation: it reads provider callbacks (which read GameState) and never
 * mutates anything.
 */
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { drawPanel, label } from './theme'

const DELAY_MS = 450
/** touch: a press held this long shows the tooltip instead of tapping. */
const LONG_PRESS_MS = 450
const MAXW = 260
const BOTTOM_LEFT_SAFE_X = 110

/** What a hovered element exposes to the tooltip (resolved lazily on show). */
export interface TooltipSpec {
  /** short metric name (already localized, e.g. "Time to First Token"). */
  title: string
  /** the live value + unit string (e.g. "412 ms"), optional. */
  value?: string
  /** one-line formula / explanation + a §ref (already localized). */
  body?: string
}

type SpecFn = () => TooltipSpec | null

class TooltipLayer {
  readonly view = new Container()
  private bg = new Graphics()
  private titleT = label('', 12, COLORS.textBright, 'bold')
  private valueT = label('', 13, COLORS.sla, 'bold')
  private bodyT = label('', 11, COLORS.textDim)
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: { spec: SpecFn; gx: number; gy: number; touch: boolean } | null = null
  /** a touch long-press just showed the tooltip — the release must not also tap. */
  private swallowTap = false

  constructor() {
    this.view.addChild(this.bg, this.titleT, this.valueT, this.bodyT)
    this.view.visible = false
    this.view.eventMode = 'none'
    this.bodyT.style.wordWrap = true
    this.bodyT.style.breakWords = true
    this.bodyT.style.wordWrapWidth = MAXW - 20
    this.bodyT.style.lineHeight = 14
  }

  /** Bind a Pixi element so resting on it (or long-pressing it on touch) pops the tooltip. */
  attach(el: Container, spec: SpecFn): void {
    if (el.eventMode === 'none' || el.eventMode === 'auto') el.eventMode = 'static'
    el.on('pointerover', (e: FederatedPointerEvent) => {
      if (e.pointerType !== 'touch') this.arm(spec, e.global.x, e.global.y, false)
    })
    el.on('pointermove', (e: FederatedPointerEvent) => {
      // keep the latest cursor pos for placement until it actually shows
      if (this.pending) {
        this.pending.gx = e.global.x
        this.pending.gy = e.global.y
      }
    })
    el.on('pointerout', (e: FederatedPointerEvent) => {
      if (e.pointerType === 'touch') this.cancelPending()
      else this.dismiss()
    })
    el.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.pointerType === 'touch') this.arm(spec, e.global.x, e.global.y, true)
      else this.dismiss()
    })
    const release = (e: FederatedPointerEvent): void => {
      if (e.pointerType === 'touch') this.cancelPending()
    }
    el.on('pointerup', release)
    el.on('pointerupoutside', release)
  }

  /**
   * True exactly once after a touch long-press showed the tooltip: the caller
   * (a button's tap handler) skips its action so peeking never also activates.
   */
  consumeLongPress(): boolean {
    if (!this.swallowTap) return false
    this.swallowTap = false
    return true
  }

  private arm(spec: SpecFn, gx: number, gy: number, touch: boolean): void {
    this.dismiss()
    if (!tooltipsEnabled) return
    this.pending = { spec, gx, gy, touch }
    this.timer = setTimeout(() => this.show(), touch ? LONG_PRESS_MS : DELAY_MS)
  }

  /** Drop a not-yet-shown tooltip (a visible one stays up). */
  private cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.view.visible) this.pending = null
  }

  /** Hide whatever is showing (e.g. when a modal opens over its anchor). */
  dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = null
    this.swallowTap = false
    this.view.visible = false
  }

  private show(): void {
    this.timer = null
    if (!this.pending) return
    const { spec, gx, gy, touch } = this.pending
    let s: TooltipSpec | null
    try {
      s = spec()
    } catch {
      return
    }
    if (!s) return
    this.titleT.text = s.title
    this.valueT.text = s.value ?? ''
    this.valueT.visible = !!s.value
    this.bodyT.text = s.body ?? ''
    this.bodyT.visible = !!s.body

    const pad = 10
    const contentW = Math.max(
      this.titleT.width,
      this.valueT.visible ? this.valueT.width : 0,
      this.bodyT.visible ? this.bodyT.width : 0,
      120,
    )
    const w = Math.min(MAXW, contentW + pad * 2)
    this.bodyT.style.wordWrapWidth = w - pad * 2
    let y = pad
    this.titleT.x = pad
    this.titleT.y = y
    y += this.titleT.height + 3
    if (this.valueT.visible) {
      this.valueT.x = pad
      this.valueT.y = y
      y += this.valueT.height + 4
    }
    if (this.bodyT.visible) {
      this.bodyT.x = pad
      this.bodyT.y = y
      y += this.bodyT.height + 2
    }
    const h = y + pad - 4
    this.bg.clear()
    drawPanel(this.bg, 0, 0, w, h, { alpha: 0.97, edge: COLORS.laneGlow })

    // Place near the cursor, flipping above controls near the bottom edge and
    // clamping onto the fixed design canvas.
    const parent = this.view.parent
    const local = parent ? parent.toLocal({ x: gx, y: gy }) : { x: gx, y: gy }
    let x = local.x + 14
    let ty = local.y + 14
    const flipped = ty + h > DESIGN_H - 8
    if (flipped) ty = local.y - h - 14
    x = Math.max(8, Math.min(DESIGN_W - w - 8, x))
    if (flipped && local.y > DESIGN_H - 120) x = Math.max(BOTTOM_LEFT_SAFE_X, x)
    ty = Math.max(8, Math.min(DESIGN_H - h - 8, ty))
    this.view.x = x
    this.view.y = ty
    this.view.visible = true
    if (touch) {
      // a long-press peek: the release must not tap, and the next touch anywhere closes it.
      this.swallowTap = true
      try {
        window.addEventListener('pointerdown', () => this.dismiss(), { once: true, capture: true })
      } catch {
        /* non-DOM host */
      }
    }
  }
}

let layer: TooltipLayer | null = null
let tooltipsEnabled = true

/** The shared tooltip layer (created on first use). Add `tooltip().view` to the root. */
export function tooltip(): TooltipLayer {
  if (!layer) layer = new TooltipLayer()
  return layer
}

/** Global on/off (Settings ▸ Gameplay). When off, no tooltip arms or shows. */
export function setTooltipsEnabled(v: boolean): void {
  tooltipsEnabled = v
  if (!v && layer) layer.view.visible = false
}

/** Convenience: attach a tooltip provider to an element (return null for "nothing to show"). */
export function addTooltip(el: Container, spec: () => TooltipSpec | null): void {
  tooltip().attach(el, spec)
}
