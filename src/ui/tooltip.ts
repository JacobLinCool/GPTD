/**
 * ui/tooltip.ts — a single hover-tooltip singleton (§5.3).
 *
 * Any interactive display element can register a tooltip provider; after the
 * pointer rests on it for ~800 ms a small panel appears showing
 *   NAME · VALUE UNIT
 *   one-line formula / §ref
 * sourced from the shared `metric.*` i18n group. The tooltip lives on its own
 * top-most container the Game adds to the root, so it always draws above panels.
 *
 * Pure presentation: it reads provider callbacks (which read GameState) and never
 * mutates anything.
 */
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { drawPanel, label } from './theme'

const DELAY_MS = 800
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

class TooltipLayer {
  readonly view = new Container()
  private bg = new Graphics()
  private titleT = label('', 12, COLORS.textBright, 'bold')
  private valueT = label('', 13, COLORS.sla, 'bold')
  private bodyT = label('', 11, COLORS.textDim)
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: { spec: () => TooltipSpec; gx: number; gy: number } | null = null

  constructor() {
    this.view.addChild(this.bg, this.titleT, this.valueT, this.bodyT)
    this.view.visible = false
    this.view.eventMode = 'none'
    this.bodyT.style.wordWrap = true
    this.bodyT.style.wordWrapWidth = MAXW - 20
    this.bodyT.style.lineHeight = 14
  }

  /** Bind a Pixi element so resting on it for DELAY_MS pops the tooltip. */
  attach(el: Container, spec: () => TooltipSpec): void {
    if (el.eventMode === 'none' || el.eventMode === 'auto') el.eventMode = 'static'
    el.on('pointerover', (e: FederatedPointerEvent) => this.arm(spec, e.global.x, e.global.y))
    el.on('pointermove', (e: FederatedPointerEvent) => {
      // keep the latest cursor pos for placement until it actually shows
      if (this.pending) {
        this.pending.gx = e.global.x
        this.pending.gy = e.global.y
      }
    })
    el.on('pointerout', () => this.dismiss())
    el.on('pointerdown', () => this.dismiss())
  }

  private arm(spec: () => TooltipSpec, gx: number, gy: number): void {
    this.dismiss()
    this.pending = { spec, gx, gy }
    this.timer = setTimeout(() => this.show(), DELAY_MS)
  }

  private dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = null
    this.view.visible = false
  }

  private show(): void {
    if (!this.pending) return
    const { spec, gx, gy } = this.pending
    let s: TooltipSpec
    try {
      s = spec()
    } catch {
      return
    }
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
  }
}

let layer: TooltipLayer | null = null

/** The shared tooltip layer (created on first use). Add `tooltip().view` to the root. */
export function tooltip(): TooltipLayer {
  if (!layer) layer = new TooltipLayer()
  return layer
}

/** Convenience: attach a tooltip provider to an element. */
export function addTooltip(el: Container, spec: () => TooltipSpec): void {
  tooltip().attach(el, spec)
}
