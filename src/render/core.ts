import { Container, Graphics, Sprite } from 'pixi.js'
import { COLORS, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { GameState } from '../core/types'
import { CORE_POS } from '../sim/pathing'
import { FlashLimiter, reducedMotion, shakeEnabled } from './anim'
import type { FxManager } from './fx'
import type { TextureFactory } from './textures'

/** Trust band → the core's colour (the core IS Trust). */
export function trustColor(trust: number): number {
  return trust > 50 ? COLORS.core : trust > 25 ? COLORS.warn : COLORS.danger
}

/**
 * The Trust Core: a neutral-grey crystal tinted by the trust band, crack overlays
 * below 50 / 25 / 10 trust, a heartbeat glow that quickens as trust falls, and a
 * hit reaction scaled by the real Trust damage (white flash through the flash
 * limiter, a shockwave ring, and a board shake when the setting allows). Below 25
 * trust the board edge pulses with a faint red vignette.
 */
export class CoreView {
  readonly view = new Container()
  /** the board-edge vignette (added above the board by the world) */
  readonly edge = new Graphics()
  private glow = new Graphics()
  private base: Sprite
  private crack: Sprite
  private flash: Sprite
  private motes: Sprite[] = []
  private stage = 0
  private clock = 0
  private flashT = 0
  private edgeFlash = 0
  /** current board-shake amplitude in px (read by the world) */
  shake = 0
  readonly limiter = new FlashLimiter(3)

  constructor(
    private factory: TextureFactory,
    private fx: FxManager,
  ) {
    this.base = new Sprite(factory.core())
    this.base.anchor.set(0.5)
    this.base.position.set(CORE_POS.x, CORE_POS.y)
    this.crack = new Sprite()
    this.crack.anchor.set(0.5)
    this.crack.position.set(CORE_POS.x, CORE_POS.y)
    this.crack.visible = false
    this.flash = new Sprite(factory.particle('glow'))
    this.flash.anchor.set(0.5)
    this.flash.position.set(CORE_POS.x, CORE_POS.y)
    this.flash.blendMode = 'add'
    this.flash.visible = false
    for (let i = 0; i < 3; i++) {
      const m = new Sprite(factory.particle('sq2'))
      m.anchor.set(0.5)
      this.motes.push(m)
    }
    this.view.addChild(this.glow, ...this.motes, this.base, this.crack, this.flash)
    this.view.eventMode = 'none'
    this.edge.eventMode = 'none'
    // the vignette frame is drawn once; only its alpha animates
    const x = GRID_X - 8
    const y = GRID_Y - 8
    const w = GRID_COLS * TILE + 16
    const h = GRID_ROWS * TILE + 16
    for (let i = 0; i < 6; i++)
      this.edge
        .rect(x + i * 2, y + i * 2, w - i * 4, h - i * 4)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.5 - i * 0.08 })
    this.edge.tint = COLORS.danger
    this.edge.alpha = 0
  }

  /**
   * A Trust hit at the core (a leak / breach / no-capacity drop) or anywhere on
   * the board (an unsafe answer delivered by a rack). `dTrust` is the real loss.
   */
  hit(dTrust: number, severe: boolean): void {
    const dmg = Math.abs(dTrust)
    if (dmg <= 0) return
    const big = Math.min(1, dmg / 8)
    this.fx.ring(
      CORE_POS.x,
      CORE_POS.y,
      18,
      34 + 44 * big,
      severe ? COLORS.danger : 0xffffff,
      0.42,
      severe ? 3 : 2,
    )
    // one limiter decision covers both flashes: at most 3/s together, none under Reduce Flashing
    const flash = this.limiter.allow(this.clock)
    if (flash) this.flashT = 0.15
    if (shakeEnabled()) this.shake = Math.min(4, this.shake + (severe ? 1.5 + dmg * 0.6 : 1))
    else if (flash) this.edgeFlash = 0.12 // no shake: the board border flashes instead (same budget)
  }

  /** Celebration sparkle (wave clear / win). */
  sparkle(big = false): void {
    this.fx.burst(
      CORE_POS.x,
      CORE_POS.y,
      big ? COLORS.cash : 0xcfe6ff,
      big ? 40 : 14,
      big ? 160 : 90,
      'spark',
      big ? 1.1 : 0.7,
      big ? 60 : 20,
    )
    if (big) this.fx.ring(CORE_POS.x, CORE_POS.y, 10, 120, COLORS.cash, 0.8, 2)
  }

  /** Run lost: the core shatters. */
  shatter(): void {
    this.stage = 3
    this.crack.texture = this.factory.coreCrack(3)
    this.crack.visible = true
    this.fx.shatter(CORE_POS.x, CORE_POS.y, 18, COLORS.danger, 24)
    this.fx.ring(CORE_POS.x, CORE_POS.y, 20, 140, COLORS.danger, 0.9, 3)
    if (shakeEnabled()) this.shake = 4
  }

  reset(): void {
    this.shake = 0
    this.flashT = 0
    this.edgeFlash = 0
    this.stage = -1
    this.limiter.reset()
  }

  sync(s: GameState, dt: number): void {
    this.clock += dt
    const trust = s.meters.trust
    const col = trustColor(trust)
    const calm = reducedMotion()
    // heartbeat: ~1.2 Hz healthy → ~3.4 Hz near collapse
    const rate = 1.2 + (1 - Math.min(1, trust / 100)) * 2.2
    const beat = calm ? 0 : Math.max(0, Math.sin(this.clock * Math.PI * 2 * rate)) ** 3
    const g = this.glow
    g.clear()
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.9 * (1 + beat * 0.14)).fill({ color: col, alpha: 0.11 })
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.6 * (1 + beat * 0.1)).fill({ color: col, alpha: 0.14 })
    this.base.tint = col
    this.base.scale.set(1 + beat * 0.03)
    const stage = trust < 10 ? 3 : trust < 25 ? 2 : trust < 50 ? 1 : 0
    if (stage !== this.stage) {
      this.stage = stage
      this.crack.visible = stage > 0
      if (stage > 0) this.crack.texture = this.factory.coreCrack(stage as 1 | 2 | 3)
    }
    this.crack.scale.copyFrom(this.base.scale)
    // three data motes orbit the core; they speed up as trust falls (static under reduced motion)
    const orbit = calm ? 0 : this.clock * (0.8 + (1 - Math.min(1, trust / 100)) * 1.6)
    for (let i = 0; i < this.motes.length; i++) {
      const a = orbit + (i / this.motes.length) * Math.PI * 2
      const m = this.motes[i]
      m.position.set(Math.round(CORE_POS.x + Math.cos(a) * 40), Math.round(CORE_POS.y + Math.sin(a) * 16))
      m.tint = col
      m.alpha = 0.85
    }
    // hit flash
    if (this.flashT > 0) {
      this.flashT -= dt
      this.flash.visible = true
      this.flash.alpha = Math.max(0, this.flashT / 0.15)
      this.flash.scale.set(5)
    } else this.flash.visible = false
    // shake decay
    this.shake *= Math.exp(-dt * 18)
    if (this.shake < 0.05) this.shake = 0
    // board-edge vignette below 25 trust (beats with the heart), or a one-frame border flash
    let edge = trust < 25 && s.phase === 'wave' ? 0.18 + 0.22 * beat : 0
    if (this.edgeFlash > 0) {
      this.edgeFlash -= dt
      edge = Math.max(edge, 0.55)
    }
    this.edge.alpha = edge
    this.edge.visible = edge > 0 // a full-board quad: never draw it invisible
  }
}
