/**
 * Motion helpers for the board: easing curves, the comfort settings every effect
 * must honour (reduced motion, screen shake, flash limiting, FX density), and a
 * stable per-id hash for presentation-only variety.
 *
 * Presentation only: nothing here is read by the sim, and the render layer may use
 * wall-clock time and Math.random freely (determinism is a sim invariant).
 */
import { getSettings, type FxLevel } from '../settings'

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3
export const easeInQuad = (t: number): number => t * t
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2
/** Overshoots ~10% then settles — the "pop" used by spawns, builds and stamps. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

/** Hold steady: no bobbing, overshoot, jitter, shake or ambient loops. */
export const reducedMotion = (): boolean => getSettings().a11y.reducedMotion
/** Board shake on core hits (off under reduced motion as well). */
export const shakeEnabled = (): boolean => getSettings().a11y.screenShake && !getSettings().a11y.reducedMotion
export const fxLevel = (): FxLevel => getSettings().a11y.fxLevel
/** Particle/popup density multiplier for the current FX level. */
export function fxDensity(): number {
  const l = fxLevel()
  return l === 'full' ? 1 : l === 'reduced' ? 0.5 : 0
}

/**
 * WCAG 2.3.1 guard: at most three full-brightness flashes per second across the
 * whole board, and none at all when the player asked for reduced flashing. Every
 * additive flash (core hit, brownout dip, guard flash) asks this first; when it
 * declines, the effect falls back to its non-flashing variant (an outline, a glyph).
 */
export class FlashLimiter {
  private stamps: number[] = []
  constructor(private perSecond = 3) {}
  allow(now: number): boolean {
    if (getSettings().a11y.reduceFlashing) return false
    while (this.stamps.length && now - this.stamps[0] > 1) this.stamps.shift()
    if (this.stamps.length >= this.perSecond) return false
    this.stamps.push(now)
    return true
  }
  reset(): void {
    this.stamps.length = 0
  }
}

/** Stable 32-bit hash of an integer id (xorshift-multiply); presentation variety only. */
export function hashId(id: number): number {
  let h = (id ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
/** hashId mapped to [0, 1). */
export const hash01 = (id: number): number => hashId(id) / 4294967296
