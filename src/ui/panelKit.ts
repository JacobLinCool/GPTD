/**
 * ui/panelKit.ts — small shared helpers for the information panels (inspect,
 * wave report, model overview, studio, research lists).
 *
 *  DragScroll    wheel + press-and-drag scrolling for a clipped list, with a tap
 *                guard so the release that ends a drag never clicks a row
 *  setButton     re-lays out a UIButton only when its copy changed (layout()
 *                re-measures and re-rasterizes its text on every call)
 *  fitLabel      memoized shrink-then-ellipsize of a Text into a width
 *  uiPref        per-viewer panel state (open tab, sort, collapsed report) kept
 *                in localStorage; it degrades to the default when storage fails
 *
 * Presentation only — nothing here reads or writes GameState.
 */
import type { Container, FederatedPointerEvent, FederatedWheelEvent, Text } from 'pixi.js'
import type { UIButton } from './theme'

/* ------------------------------------------------------------------ *
 *  Wheel + drag scrolling                                            *
 * ------------------------------------------------------------------ */

export interface DragScrollOpts {
  get: () => number
  /** receives the unclamped target offset; the owner clamps it. */
  set: (v: number) => void
  /** design px scrolled per wheel delta unit. */
  wheelScale?: number
  /** px the pointer must travel before a press becomes a drag (taps stay taps). */
  threshold?: number
}

export class DragScroll {
  private armed = false
  private dragging = false
  private startY = 0
  private startVal = 0
  private suppressUntil = 0

  /** `host` must not move while scrolling (the clipped content inside it does). */
  constructor(
    private host: Container,
    private opts: DragScrollOpts,
  ) {
    if (host.eventMode === 'none' || host.eventMode === 'auto' || host.eventMode === 'passive') host.eventMode = 'static'
    host.on('wheel', (e: FederatedWheelEvent) => {
      opts.set(opts.get() + e.deltaY * (opts.wheelScale ?? 0.45))
    })
    host.on('pointerdown', (e: FederatedPointerEvent) => {
      this.armed = true
      this.dragging = false
      this.startY = this.localY(e)
      this.startVal = opts.get()
    })
    host.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (!this.armed) return
      const dy = this.localY(e) - this.startY
      if (!this.dragging && Math.abs(dy) < (opts.threshold ?? 6)) return
      this.dragging = true
      opts.set(this.startVal - dy)
    })
    const end = (): void => {
      if (this.dragging) this.suppressUntil = performance.now() + 120
      this.armed = false
      this.dragging = false
    }
    host.on('pointerup', end)
    host.on('pointerupoutside', end)
  }

  private localY(e: FederatedPointerEvent): number {
    return this.host.toLocal(e.global).y
  }

  /** True during and right after a drag — row taps check this so a drag never clicks. */
  get swallowTap(): boolean {
    return this.dragging || performance.now() < this.suppressUntil
  }
}

/* ------------------------------------------------------------------ *
 *  Memoized button / label layout                                    *
 * ------------------------------------------------------------------ */

const buttonKeys = new WeakMap<UIButton, string>()

/**
 * Set a button's title + sub and lay it out — but only when that copy changed,
 * so a panel can call this every frame without re-measuring its text.
 */
export function setButton(btn: UIButton, title: string, sub = '', align: 'center' | 'left' = 'center'): void {
  const key = `${align}\u0000${title}\u0000${sub}`
  if (buttonKeys.get(btn) === key) return
  buttonKeys.set(btn, key)
  btn.setTitle(title).setSub(sub)
  if (align === 'center') btn.layout(0, 0, true)
  else btn.layout(0, 8)
}

/** Forget a button's memo (call after changing its geometry or font). */
export function invalidateButton(btn: UIButton): void {
  buttonKeys.delete(btn)
}

const labelKeys = new WeakMap<Text, string>()

/**
 * Fit `text` into `maxW`: shrink the font down to `minSize`, then ellipsize.
 * Memoized per Text on (text, width, sizes), so unchanged labels cost nothing.
 */
export function fitLabel(t: Text, text: string, maxW: number, size: number, minSize = Math.max(8, size - 2)): void {
  const key = `${text}\u0000${maxW}\u0000${size}\u0000${minSize}`
  if (labelKeys.get(t) === key) return
  labelKeys.set(t, key)
  t.style.fontSize = size
  t.text = text
  if (!text || t.width <= maxW) return
  t.style.fontSize = Math.max(minSize, Math.floor((size * maxW) / Math.max(1, t.width)))
  if (t.width <= maxW) return
  let lo = 0
  let hi = text.length
  let best = ''
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const candidate = text.slice(0, mid).trimEnd() + '…'
    t.text = candidate
    if (t.width <= maxW) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  t.text = best || '…'
}

/* ------------------------------------------------------------------ *
 *  Per-viewer panel state                                            *
 * ------------------------------------------------------------------ */

const PREF_KEY = 'gptd_ui_panels'
let prefs: Record<string, string> | null = null

function loadPrefs(): Record<string, string> {
  if (prefs) return prefs
  prefs = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREF_KEY) : null
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') prefs[k] = v
    }
  } catch {
    /* storage blocked or corrupt: keep the defaults */
  }
  return prefs
}

/** A remembered panel choice, constrained to `allowed` (falls back to `fallback`). */
export function uiPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const v = loadPrefs()[key]
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback
}

export function setUiPref(key: string, value: string): void {
  const p = loadPrefs()
  if (p[key] === value) return
  p[key] = value
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* non-persistent session: the choice still holds until reload */
  }
}
