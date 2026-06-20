/**
 * Reusable settings widgets (docs/SYSTEM-MENU.md §8): Slider, SegmentedControl,
 * Toggle. They render with the shared theme palette and emit plain onChange
 * callbacks; persistence/side-effects are the caller's job (the SettingsPanel
 * writes to the SettingsStore).
 */
import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js'
import { COLORS } from '../config'
import { UIButton } from './theme'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** A horizontal 0..1 slider with a draggable knob. */
export class Slider extends Container {
  private g = new Graphics()
  private _w: number
  private _v: number
  private accent: number
  private dragging = false
  private onChange: (v: number) => void
  private onCommit?: (v: number) => void

  constructor(opts: {
    w: number
    value: number
    onChange: (v: number) => void
    onCommit?: (v: number) => void
    accent?: number
  }) {
    super()
    this._w = opts.w
    this._v = clamp01(opts.value)
    this.accent = opts.accent ?? COLORS.sla
    this.onChange = opts.onChange
    this.onCommit = opts.onCommit
    this.addChild(this.g)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = { contains: (x: number, y: number) => x >= -8 && x <= this._w + 8 && y >= -4 && y <= 24 }
    this.on('pointerdown', (e: FederatedPointerEvent) => {
      this.dragging = true
      this.setFromEvent(e)
    })
    this.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) this.setFromEvent(e)
    })
    const end = (): void => {
      if (this.dragging) {
        this.dragging = false
        this.onCommit?.(this._v)
      }
    }
    this.on('pointerup', end)
    this.on('pointerupoutside', end)
    this.redraw()
  }

  get value(): number {
    return this._v
  }
  setValue(v: number): this {
    this._v = clamp01(v)
    this.redraw()
    return this
  }

  private setFromEvent(e: FederatedPointerEvent): void {
    const p = this.toLocal(e.global)
    const x = Math.max(0, Math.min(this._w, p.x))
    this._v = this._w > 0 ? x / this._w : 0
    this.redraw()
    this.onChange(this._v)
  }

  private redraw(): void {
    const y = 10
    const h = 6
    const g = this.g
    g.clear()
    g.roundRect(0, y - h / 2, this._w, h, 3).fill({ color: 0x0a0e14, alpha: 0.95 })
    g.roundRect(0, y - h / 2, Math.max(h, this._v * this._w), h, 3).fill({ color: this.accent })
    const kx = this._v * this._w
    g.circle(kx, y, 8).fill({ color: COLORS.textBright })
    g.circle(kx, y, 8).stroke({ width: 2, color: this.accent })
  }
}

/** A row of mutually-exclusive segment buttons. */
export class SegmentedControl<T> extends Container {
  private segs: { value: T; btn: UIButton }[] = []
  private _value: T
  private onChange: (v: T) => void

  constructor(opts: {
    options: { value: T; label: string }[]
    value: T
    onChange: (v: T) => void
    segW?: number
    h?: number
    gap?: number
    accent?: number
  }) {
    super()
    this._value = opts.value
    this.onChange = opts.onChange
    const segW = opts.segW ?? 88
    const h = opts.h ?? 30
    const gap = opts.gap ?? 6
    const accent = opts.accent ?? COLORS.sla
    opts.options.forEach((o, i) => {
      const btn = new UIButton({ w: segW, h, accent, onTap: () => this.select(o.value) })
      btn.x = i * (segW + gap)
      btn.setTitle(o.label).layout(0, 0, true)
      btn.setActive(o.value === this._value)
      this.addChild(btn)
      this.segs.push({ value: o.value, btn })
    })
  }

  get value(): T {
    return this._value
  }

  select(v: T): void {
    if (v === this._value) return
    this._value = v
    this.refresh()
    this.onChange(v)
  }

  setValue(v: T): this {
    this._value = v
    this.refresh()
    return this
  }

  setEnabled(e: boolean): this {
    for (const s of this.segs) s.btn.setEnabled(e)
    return this
  }

  /** Re-localize segment titles (call on language change). */
  relabel(labelOf: (v: T) => string): this {
    for (const s of this.segs) s.btn.setTitle(labelOf(s.value)).layout(0, 0, true)
    return this
  }

  private refresh(): void {
    for (const s of this.segs) s.btn.setActive(s.value === this._value)
  }
}

/** A boolean switch (sliding knob). */
export class Toggle extends Container {
  private g = new Graphics()
  private _on: boolean
  private _w: number
  private _h: number
  private accent: number
  private onChange: (v: boolean) => void

  constructor(opts: { value: boolean; onChange: (v: boolean) => void; w?: number; h?: number; accent?: number }) {
    super()
    this._on = opts.value
    this._w = opts.w ?? 46
    this._h = opts.h ?? 24
    this.accent = opts.accent ?? COLORS.good
    this.onChange = opts.onChange
    this.addChild(this.g)
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointertap', () => {
      this._on = !this._on
      this.redraw()
      this.onChange(this._on)
    })
    this.redraw()
  }

  get value(): boolean {
    return this._on
  }
  setValue(v: boolean): this {
    this._on = v
    this.redraw()
    return this
  }
  setEnabled(e: boolean): this {
    this.eventMode = e ? 'static' : 'none'
    this.alpha = e ? 1 : 0.5
    return this
  }

  private redraw(): void {
    const r = this._h / 2
    const g = this.g
    g.clear()
    g.roundRect(0, 0, this._w, this._h, r).fill({ color: this._on ? this.accent : 0x1a2233, alpha: 0.9 })
    g.roundRect(0.5, 0.5, this._w - 1, this._h - 1, r).stroke({
      width: 1,
      color: this._on ? this.accent : COLORS.panelEdge,
    })
    const kx = this._on ? this._w - r : r
    g.circle(kx, r, r - 3).fill({ color: COLORS.textBright })
  }
}
