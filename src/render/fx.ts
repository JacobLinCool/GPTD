import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { COLORS } from '../config'
import { clamp01, easeInQuad, easeOutBack, easeOutCubic, fxDensity, fxLevel, reducedMotion } from './anim'
import { ParticleSystem } from './particles'
import { PopupLayer } from './popups'
import type { GlyphName, ParticleFrame, TextureFactory } from './textures'

/** HUD meters a board event can move (the fly-to-meter chips' destinations). */
export type Meter = 'cash' | 'trust' | 'sla'

interface Stamp {
  sp: Sprite
  x: number
  y: number
  age: number
  life: number
  /** final integer scale (pixel glyphs only scale by whole numbers) */
  scale: number
  rise: number
  slam: boolean
}
interface Ring {
  x: number
  y: number
  r0: number
  r1: number
  age: number
  life: number
  color: number
  width: number
}
interface Chip {
  sp: Sprite
  x0: number
  y0: number
  cx: number
  cy: number
  meter: Meter
  age: number
  life: number
}

const STAMP_CAP = 48
const RING_CAP = 16
const CHIP_CAP = 32
const CHIPS_PER_SEC = 6

/**
 * Board effects engine. Everything high-count lives on pooled, atlas-backed
 * primitives: one ParticleContainer for particles and scan/link lines, pooled glyph
 * sprites for outcome stamps, one bitmap-font layer for popups, and one Graphics
 * for the (few) expanding shockwave rings. Effects advance in real seconds and
 * scale their particle counts by an FX budget (FX level × 1/√speed × board density).
 */
export class FxManager {
  /** board-space effects (inside the shaken world view) */
  readonly view = new Container()
  /** screen-space chips that fly to the HUD meters (above the HUD, never shaken) */
  readonly screen = new Container()
  readonly particles: ParticleSystem
  readonly popups: PopupLayer
  private ringsG = new Graphics()
  private stampHost = new Container()
  private stamps: Stamp[] = []
  private stampSpare: Sprite[] = []
  private rings: Ring[] = []
  private ringsDrawn = false
  private chips: Chip[] = []
  private chipSpare: Sprite[] = []
  private chipStamps: Record<Meter, number[]> = { cash: [], trust: [], sla: [] }
  private clock = 0
  private speed = 1
  /** live request count (density LOD input), set by the world each frame */
  crowd = 0
  /**
   * Where each HUD meter sits (design px). Defaults follow the HUD layout; the HUD
   * owner can rebind this to its live anchors.
   */
  meterAnchor: (m: Meter) => { x: number; y: number } = (m) =>
    m === 'cash' ? { x: 236, y: 36 } : m === 'trust' ? { x: 74, y: 30 } : { x: 74, y: 72 }
  /** called when a chip lands (the HUD owner can bump the meter). */
  onChipLand: (m: Meter) => void = () => {}

  constructor(private factory: TextureFactory) {
    this.particles = new ParticleSystem(factory.atlasTexture())
    this.popups = new PopupLayer((k) => factory.glyph(k as GlyphName))
    this.view.addChild(this.ringsG, this.particles.view, this.stampHost, this.popups.view)
    this.view.eventMode = 'none'
    this.screen.eventMode = 'none'
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.popups.setSpeed(speed)
  }

  /**
   * FX budget: how many of n particles to actually emit. Scales with the FX level,
   * 1/√speed (12× would otherwise multiply volume twelvefold) and board density.
   */
  budget(n: number): number {
    const crowd = this.crowd > 350 ? 0.35 : this.crowd > 150 ? 0.6 : 1
    const v = (n * fxDensity() * crowd) / Math.sqrt(Math.max(1, this.speed))
    // stochastic rounding keeps small bursts alive on average instead of zeroing them
    const whole = Math.floor(v)
    return whole + (Math.random() < v - whole ? 1 : 0)
  }

  frame(name: ParticleFrame): Texture {
    return this.factory.particle(name)
  }
  glyph(name: GlyphName): Texture {
    return this.factory.glyph(name)
  }

  /** A burst of particles (budgeted). */
  burst(
    x: number,
    y: number,
    color: number,
    n: number,
    speed: number,
    frame: ParticleFrame = 'sq2',
    life = 0.6,
    gravity = 140,
  ): void {
    const k = this.budget(n)
    if (k > 0) this.particles.burst(this.factory.particle(frame), x, y, k, speed, color, life, gravity)
  }

  /** Shards flying outward from a ring (a hazard ring shattering, a cracked shield). */
  shatter(x: number, y: number, radius: number, color: number, n = 8): void {
    const k = this.budget(n)
    const tex = this.factory.particle('shard')
    for (let i = 0; i < k; i++) {
      const a = (i / Math.max(1, k)) * Math.PI * 2 + Math.random() * 0.4
      this.particles.spawn(tex, x + Math.cos(a) * radius, y + Math.sin(a) * radius, {
        vx: Math.cos(a) * 70,
        vy: Math.sin(a) * 70,
        g: 60,
        drag: 2,
        life: 0.45,
        s0: 1,
        s1: 0.5,
        spin: 10,
        tint: color,
      })
    }
  }

  /** A fading 1-px line (guard scan beam, link flash). Kept at minimal FX: it carries meaning. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number,
    life = 0.14,
    alpha = 0.85,
    width = 1,
  ): void {
    this.particles.line(this.factory.particle('px'), x1, y1, x2, y2, color, life, alpha, width)
  }

  /** Soft additive-looking glow puff (flares, flashes). */
  glow(x: number, y: number, color: number, size: number, life = 0.35): void {
    if (fxLevel() === 'minimal') return
    this.particles.spawn(this.factory.particle('glow'), x, y, {
      life,
      s0: size / 16,
      s1: (size * 1.4) / 16,
      alpha: 0.9,
      tint: color,
    })
  }

  /**
   * An outcome / cause glyph stamp: pops (or slams) in at an integer scale, holds,
   * rises a little and fades. Glyph stamps always show — even at minimal FX — since
   * they carry the outcome's meaning independent of colour.
   */
  stamp(
    glyph: GlyphName,
    x: number,
    y: number,
    color: number,
    opts: { scale?: number; life?: number; rise?: number; slam?: boolean } = {},
  ): void {
    if (this.stamps.length >= STAMP_CAP) this.finishStamp(0)
    const sp = this.stampSpare.pop() ?? new Sprite()
    sp.texture = this.factory.glyph(glyph)
    sp.anchor.set(0.5)
    sp.tint = color
    sp.alpha = 1
    this.stampHost.addChild(sp)
    this.stamps.push({
      sp,
      x,
      y,
      age: 0,
      life: (opts.life ?? 0.7) * (this.speed >= 6 ? 0.6 : 1),
      scale: opts.scale ?? 2,
      rise: opts.rise ?? 10,
      slam: opts.slam ?? false,
    })
  }

  /** Expanding shockwave ring (core hits, unsafe flares, build dust). */
  ring(x: number, y: number, r0: number, r1: number, color: number, life = 0.4, width = 2): void {
    if (this.rings.length >= RING_CAP) this.rings.shift()
    this.rings.push({ x, y, r0, r1, age: 0, life, color, width })
  }

  /** Board popup (see PopupLayer). */
  popup(
    text: string,
    color: number,
    x: number,
    y: number,
    key?: string,
    icon?: GlyphName,
    big = false,
  ): void {
    if (fxLevel() === 'minimal') return
    this.popups.show(text, color, x, y, key, icon, big)
  }

  /** Aggregated clean-serve income popup. */
  cash(amount: number, x: number, y: number): void {
    if (fxLevel() === 'minimal') return
    this.popups.cash(amount, x, y)
  }

  /**
   * A chip that flies from a board point to a HUD meter (coins → Cash, red shards →
   * Trust, amber shards → SLA), at most CHIPS_PER_SEC per meter so a busy board
   * shows causality without a swarm.
   */
  chip(meter: Meter, x: number, y: number): void {
    if (fxLevel() === 'minimal' || reducedMotion()) return
    const st = this.chipStamps[meter]
    while (st.length && this.clock - st[0] > 1) st.shift()
    if (st.length >= CHIPS_PER_SEC) return
    st.push(this.clock)
    if (this.chips.length >= CHIP_CAP) this.finishChip(0)
    const sp = this.chipSpare.pop() ?? new Sprite()
    sp.texture = meter === 'cash' ? this.factory.glyph('coin') : this.factory.particle('shard')
    sp.anchor.set(0.5)
    sp.scale.set(meter === 'cash' ? 1 : 2)
    sp.tint = meter === 'cash' ? COLORS.cash : meter === 'trust' ? COLORS.danger : COLORS.warn
    sp.alpha = 1
    this.screen.addChild(sp)
    const to = this.meterAnchor(meter)
    // control point: up and toward the meter, so chips arc instead of sliding
    this.chips.push({
      sp,
      x0: x,
      y0: y,
      cx: (x + to.x) / 2,
      cy: Math.min(y, to.y) - 60,
      meter,
      age: 0,
      life: 0.55,
    })
  }

  update(dt: number): void {
    this.clock += dt
    this.particles.update(dt)
    this.popups.update(dt)
    const calm = reducedMotion()
    // stamps
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i]
      s.age += dt
      const k = s.age / s.life
      if (k >= 1) {
        this.finishStamp(i)
        continue
      }
      let sc = s.scale
      if (!calm) {
        if (s.slam) sc = s.age < 0.1 ? s.scale * (1.8 - 0.8 * (s.age / 0.1)) : s.scale
        else sc = s.age < 0.16 ? s.scale * Math.max(0.2, easeOutBack(s.age / 0.16)) : s.scale
      }
      s.sp.scale.set(sc)
      s.sp.x = Math.round(s.x)
      s.sp.y = Math.round(s.y - (calm ? 0 : s.rise * easeOutCubic(k)))
      s.sp.alpha = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35
    }
    // rings
    if (this.rings.length || this.ringsDrawn) this.ringsG.clear()
    this.ringsDrawn = this.rings.length > 0
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      const k = r.age / r.life
      if (k >= 1) {
        this.rings.splice(i, 1)
        continue
      }
      const rad = r.r0 + (r.r1 - r.r0) * easeOutCubic(k)
      this.ringsG.circle(r.x, r.y, rad).stroke({ width: r.width, color: r.color, alpha: 0.85 * (1 - k) })
    }
    // chips
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i]
      c.age += dt
      const k = clamp01(c.age / c.life)
      if (k >= 1) {
        this.onChipLand(c.meter)
        this.finishChip(i)
        continue
      }
      const e = easeInQuad(k)
      const to = this.meterAnchor(c.meter)
      const u = 1 - e
      c.sp.x = u * u * c.x0 + 2 * u * e * c.cx + e * e * to.x
      c.sp.y = u * u * c.y0 + 2 * u * e * c.cy + e * e * to.y
    }
  }

  /** Drop every live effect (a new run, a state swap). */
  clear(): void {
    this.particles.clear()
    this.popups.clear()
    while (this.stamps.length) this.finishStamp(this.stamps.length - 1)
    while (this.chips.length) this.finishChip(this.chips.length - 1)
    this.rings.length = 0
    this.ringsG.clear()
  }

  /** live counts for the perf overlay */
  stats(): { particles: number; popups: number; stamps: number } {
    return { particles: this.particles.count, popups: this.popups.count, stamps: this.stamps.length }
  }

  private finishStamp(i: number): void {
    const s = this.stamps[i]
    this.stamps.splice(i, 1)
    this.stampHost.removeChild(s.sp)
    if (this.stampSpare.length < STAMP_CAP) this.stampSpare.push(s.sp)
    else s.sp.destroy()
  }

  private finishChip(i: number): void {
    const c = this.chips[i]
    this.chips.splice(i, 1)
    this.screen.removeChild(c.sp)
    if (this.chipSpare.length < CHIP_CAP) this.chipSpare.push(c.sp)
    else c.sp.destroy()
  }
}
