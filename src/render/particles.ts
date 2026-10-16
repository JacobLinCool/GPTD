import { Particle, ParticleContainer, type Texture } from 'pixi.js'

/** Per-particle motion state (parallel to the container's particleChildren). */
interface PState {
  vx: number
  vy: number
  /** gravity (px/s²); negative rises */
  g: number
  /** velocity damping per second (0 = none) */
  drag: number
  life: number
  max: number
  s0: number
  s1: number
  a0: number
  spin: number
  /** stretched line particles keep their x-scale (length) and only fade */
  line: boolean
}

export interface ParticleSpec {
  vx?: number
  vy?: number
  g?: number
  drag?: number
  life: number
  /** start / end scale (uniform) */
  s0?: number
  s1?: number
  alpha?: number
  rotation?: number
  spin?: number
  tint: number
}

/**
 * The board's single particle pool: one Pixi ParticleContainer (one draw call),
 * a fixed capacity, swap-remove (no O(n) splice), and oldest-first recycling when
 * the cap is hit. Every frame it advances in REAL seconds, so effects keep their
 * length at 12× instead of vanishing in one sim step.
 */
export class ParticleSystem {
  readonly view: ParticleContainer<Particle>
  private states: PState[] = []
  private spare: Particle[] = []
  private dirty = false

  constructor(
    atlas: Texture,
    private cap = 900,
  ) {
    this.view = new ParticleContainer({
      texture: atlas,
      dynamicProperties: { position: true, vertex: true, rotation: true, uvs: true, color: true },
    })
    this.view.eventMode = 'none'
  }

  get count(): number {
    return this.view.particleChildren.length
  }

  spawn(frame: Texture, x: number, y: number, sp: ParticleSpec): void {
    const parts = this.view.particleChildren
    if (parts.length >= this.cap) this.removeAt(0) // recycle the oldest
    const p = this.spare.pop() ?? new Particle({ texture: frame, anchorX: 0.5, anchorY: 0.5 })
    p.texture = frame
    p.anchorX = 0.5
    p.anchorY = 0.5
    p.x = x
    p.y = y
    const s0 = sp.s0 ?? 1
    p.scaleX = s0
    p.scaleY = s0
    p.rotation = sp.rotation ?? 0
    p.tint = sp.tint
    p.alpha = sp.alpha ?? 1
    parts.push(p)
    this.states.push({
      vx: sp.vx ?? 0,
      vy: sp.vy ?? 0,
      g: sp.g ?? 0,
      drag: sp.drag ?? 0,
      life: sp.life,
      max: sp.life,
      s0,
      s1: sp.s1 ?? s0,
      a0: sp.alpha ?? 1,
      spin: sp.spin ?? 0,
      line: false,
    })
    this.dirty = true
  }

  /** A stretched 1-px line from (x1,y1) to (x2,y2) that fades out (scan beams, links). */
  line(
    frame: Texture,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    tint: number,
    life: number,
    alpha = 0.9,
    width = 1,
  ): void {
    const parts = this.view.particleChildren
    if (parts.length >= this.cap) this.removeAt(0)
    const p = this.spare.pop() ?? new Particle({ texture: frame })
    p.texture = frame
    p.anchorX = 0
    p.anchorY = 0.5
    p.x = x1
    p.y = y1
    p.scaleX = Math.hypot(x2 - x1, y2 - y1) / frame.width
    p.scaleY = width / frame.height
    p.rotation = Math.atan2(y2 - y1, x2 - x1)
    p.tint = tint
    p.alpha = alpha
    parts.push(p)
    this.states.push({
      vx: 0,
      vy: 0,
      g: 0,
      drag: 0,
      life,
      max: life,
      s0: 1,
      s1: 1,
      a0: alpha,
      spin: 0,
      line: true,
    })
    this.dirty = true
  }

  /** Burst of n particles of one frame with random directions (presentation-only randomness). */
  burst(
    frame: Texture,
    x: number,
    y: number,
    n: number,
    speed: number,
    tint: number,
    life = 0.6,
    gravity = 140,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.4 + Math.random() * 0.8)
      this.spawn(frame, x, y, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.25,
        g: gravity,
        drag: 1.5,
        life: life * (0.7 + Math.random() * 0.5),
        s0: 1,
        s1: 0.6,
        tint,
        spin: (Math.random() - 0.5) * 8,
      })
    }
  }

  update(dt: number): void {
    const parts = this.view.particleChildren
    for (let i = parts.length - 1; i >= 0; i--) {
      const st = this.states[i]
      st.life -= dt
      if (st.life <= 0) {
        this.removeAt(i)
        continue
      }
      const p = parts[i]
      const k = 1 - st.life / st.max
      if (!st.line) {
        if (st.drag > 0) {
          const d = Math.max(0, 1 - st.drag * dt)
          st.vx *= d
          st.vy *= d
        }
        st.vy += st.g * dt
        p.x += st.vx * dt
        p.y += st.vy * dt
        if (st.spin) p.rotation += st.spin * dt
        const s = st.s0 + (st.s1 - st.s0) * k
        p.scaleX = s
        p.scaleY = s
      }
      // hold, then fade over the last 40% of life
      p.alpha = st.a0 * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4)
    }
    if (this.dirty) {
      this.view.update()
      this.dirty = false
    }
  }

  private removeAt(i: number): void {
    const parts = this.view.particleChildren
    const last = parts.length - 1
    const p = parts[i]
    if (i !== last) {
      parts[i] = parts[last]
      this.states[i] = this.states[last]
    }
    parts.pop()
    this.states.pop()
    if (this.spare.length < 256) this.spare.push(p)
    this.dirty = true
  }

  clear(): void {
    const parts = this.view.particleChildren
    for (const p of parts) if (this.spare.length < 256) this.spare.push(p)
    parts.length = 0
    this.states.length = 0
    this.view.update()
    this.dirty = false
  }
}
