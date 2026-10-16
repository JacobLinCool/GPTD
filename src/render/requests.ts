import { Container, Sprite } from 'pixi.js'
import { COLORS, LAT_CLASS_SLO, SIM_DT } from '../config'
import type { GameState, Outcome, Request } from '../core/types'
import { isExpert } from '../mode'
import { outcomeColor } from '../outcomes'
import { LANE_PATHS } from '../sim/pathing'
import { clamp01, easeInQuad, easeOutBack, easeOutCubic, hash01, reducedMotion } from './anim'
import { REQ_PX, type GlyphName, type TextureFactory } from './textures'

/** Density thresholds for request level-of-detail (with ±20 hysteresis). */
const LOD_CHIP = 150
const LOD_DOT = 350
const LOD_HYST = 20
/** Max dying sprites playing their resolve animation at once (oldest finishes instantly). */
const DYING_CAP = 48
/** Lateral crowd spread (px, ±) so a queue reads as a crowd instead of one overprinted sprite. */
const SPREAD = 5
const BAR_W = REQ_PX - 4

/** Colors of the two-phase progress bar. */
export const BAR_PREFILL = 0xffb454
export const BAR_THINK = 0xb48cff
const BAR_BG = 0x0a0e14
const BAR_LATE = 0x6c86a8

interface ReqVis {
  id: number
  sp: Sprite
  barBg: Sprite
  barPre: Sprite
  barThink: Sprite
  barDec: Sprite
  tick: Sprite
  budget: Sprite
  pip: Sprite
  badge: Sprite
  ring: Sprite
  // interpolation samples (sim positions at two sim times) + the rendered position
  px: number
  py: number
  cx: number
  cy: number
  tp: number
  tc: number
  rx: number
  ry: number
  /** lateral offset unit (perpendicular to the lane at the current segment) */
  nx: number
  ny: number
  spread: number
  born: number
  prefillDone: boolean
  tickT: number
  /** motion direction (unit) for the over-refused bounce */
  dx: number
  dy: number
}

interface Dying {
  v: ReqVis
  outcome: Outcome | null
  age: number
  life: number
  x: number
  y: number
}

/**
 * The in-flight request layer. Pooled sprites per request: the packet, a two-phase
 * progress bar (prefill → hidden thinking → answer decode), one cause badge (hazard
 * open > too long > late > wrong-so-far), and a pulsing hazard ring. Positions are
 * interpolated between the last two sim samples, so motion is smooth on any refresh
 * rate. A request that resolves keeps its sprite for a short, cause-coded animation.
 */
export class RequestLayer {
  readonly view = new Container()
  private packets = new Container()
  private decor = new Container()
  private vis = new Map<number, ReqVis>()
  private spare: ReqVis[] = []
  private dying: Dying[] = []
  private deaths = new Map<number, Outcome>()
  private lod: 0 | 1 | 2 = 0
  private clock = 0
  private lastTime = -1
  /** a new request appeared on a lane (ingress portal flash) */
  onSpawn: (laneId: number) => void = () => {}

  constructor(private factory: TextureFactory) {
    this.view.addChild(this.packets, this.decor)
    this.view.eventMode = 'none'
  }

  /** Rendered (interpolated) position of a live or dying request. */
  posOf(id: number): { x: number; y: number } | null {
    const v = this.vis.get(id)
    if (v) return { x: v.rx, y: v.ry }
    for (const d of this.dying) if (d.v.id === id) return { x: d.x, y: d.y }
    return null
  }

  /** Nearest live request to (x, y) within r, by RENDERED position. */
  pick(x: number, y: number, r: number): number | null {
    let best: number | null = null
    let bd = r * r
    for (const v of this.vis.values()) {
      const d = (v.rx - x) ** 2 + (v.ry - y) ** 2
      if (d < bd) {
        bd = d
        best = v.id
      }
    }
    return best
  }

  /** The outcome a request resolved with (from the outcome event), read when its sprite dies. */
  noteDeath(id: number, outcome: Outcome): void {
    this.deaths.set(id, outcome)
  }

  get liveCount(): number {
    return this.vis.size
  }

  /**
   * @param alpha interpolation fraction between the previous and current sim step
   * @param active ids being prefilled/decoded this tick (breathing + bar LOD)
   */
  sync(
    s: GameState,
    dt: number,
    alpha: number,
    speed: number,
    active: Set<number>,
    selectedId: number | null,
  ): void {
    this.clock += dt
    const calm = reducedMotion()
    const n = s.requests.length
    // density LOD with hysteresis
    if (this.lod === 0 && n > LOD_CHIP + LOD_HYST) this.lod = 1
    else if (this.lod === 1 && n > LOD_DOT + LOD_HYST) this.lod = 2
    else if (this.lod === 2 && n < LOD_DOT - LOD_HYST) this.lod = 1
    else if (this.lod === 1 && n < LOD_CHIP - LOD_HYST) this.lod = 0
    const timeMoved = s.time !== this.lastTime
    this.lastTime = s.time
    const expert = isExpert()
    const seen = new Set<number>()
    for (const r of s.requests) {
      if (!r.alive) continue
      seen.add(r.id)
      let v = this.vis.get(r.id)
      if (!v) {
        v = this.acquire(r, s.time)
        this.vis.set(r.id, v)
        this.onSpawn(r.laneId)
      } else if (timeMoved && (r.x !== v.cx || r.y !== v.cy)) {
        v.px = v.cx
        v.py = v.cy
        v.tp = v.tc
        v.cx = r.x
        v.cy = r.y
        v.tc = s.time
        const mx = v.cx - v.px
        const my = v.cy - v.py
        const ml = Math.hypot(mx, my)
        if (ml > 0.01) {
          v.dx = mx / ml
          v.dy = my / ml
        }
      }
      // render one sim step behind, interpolated: f=alpha when exactly one step passed
      const span = v.tc - v.tp
      const target = v.tc - (1 - alpha) * SIM_DT
      const f = span > 1e-9 ? clamp01((target - v.tp) / span) : 1
      const age = this.clock - v.born
      const spreadIn = clamp01(age / 0.25)
      this.laneNormal(r, v, dt)
      v.rx = v.px + (v.cx - v.px) * f + v.nx * v.spread * spreadIn
      v.ry = v.py + (v.cy - v.py) * f + v.ny * v.spread * spreadIn
      this.drawPacket(r, v, dt, age, calm, active.has(r.id), expert, selectedId === r.id)
    }
    for (const [id, v] of this.vis) {
      if (seen.has(id)) continue
      this.vis.delete(id)
      this.startDying(v, this.deaths.get(id) ?? null, speed)
      this.deaths.delete(id)
    }
    // stale death notes (a request that died before it was ever drawn)
    if (this.deaths.size > 64) this.deaths.clear()
    this.updateDying(dt, calm)
  }

  /** Drop everything (state swap / restart). */
  reset(): void {
    for (const v of this.vis.values()) this.release(v)
    this.vis.clear()
    for (const d of this.dying) this.release(d.v)
    this.dying.length = 0
    this.deaths.clear()
    this.lastTime = -1
  }

  /** Ease the lateral-spread normal toward the current lane segment's (no jump at corners). */
  private laneNormal(r: Request, v: ReqVis, dt: number): void {
    const lane = LANE_PATHS[r.laneId]
    if (!lane) return
    for (const seg of lane.segments) {
      if (r.dist <= seg.acc + seg.len) {
        const len = seg.len || 1
        const tx = -(seg.b.y - seg.a.y) / len
        const ty = (seg.b.x - seg.a.x) / len
        if (v.nx === 0 && v.ny === 0) {
          v.nx = tx
          v.ny = ty
        } else {
          const k = Math.min(1, dt * 10)
          v.nx += (tx - v.nx) * k
          v.ny += (ty - v.ny) * k
        }
        return
      }
    }
  }

  private drawPacket(
    r: Request,
    v: ReqVis,
    dt: number,
    age: number,
    calm: boolean,
    active: boolean,
    expert: boolean,
    selected: boolean,
  ): void {
    const sp = v.sp
    // spawn pop 0 → 1.15 → 1 over 160 ms; then a 1-px walk bob, or a gentle
    // breathing while a rack is generating this request's tokens.
    let scale = 1
    let bob = 0
    if (!calm) {
      if (age < 0.16) scale = Math.max(0.05, easeOutBack(age / 0.16))
      else if (active) scale = 1 + 0.025 * (1 + Math.sin(this.clock * 14 + v.id))
      else bob = Math.sin(this.clock * 9 + v.id) >= 0 ? 0 : 1
    }
    // reduced motion: the spawn is a short fade instead of a pop
    sp.alpha = calm ? clamp01(age / 0.16) : 1
    const lodScale = this.lod === 2 ? 0.5 : this.lod === 1 ? 0.75 : 1
    sp.scale.set(scale * lodScale)
    sp.x = Math.round(v.rx)
    sp.y = Math.round(v.ry) + bob
    const y0 = sp.y
    // ---- two-phase bar: prefill (left) → thinking → answer decode (right) ----
    const showBar = selected || this.lod === 0 || (this.lod === 1 && active)
    v.barBg.visible = v.barPre.visible = v.barDec.visible = showBar
    v.barThink.visible = false
    v.tick.visible = false
    if (showBar) {
      const bx = sp.x - BAR_W / 2
      const by = y0 - Math.round((REQ_PX * lodScale) / 2) - 5
      const hasDecode = r.maxWork > 0
      const lin = Math.log2(1 + r.tokensIn)
      const lout = hasDecode ? Math.log2(1 + r.tokensOut) : 0
      const preFrac = hasDecode ? Math.min(0.8, Math.max(0.2, lin / (lin + lout || 1))) : 1
      const preW = Math.round(BAR_W * preFrac)
      const decW = BAR_W - preW
      const preProg = r.tokensIn > 0 ? clamp01(1 - r.prefill / r.tokensIn) : 1
      const decProg = hasDecode ? clamp01(1 - r.work / r.maxWork) : 0
      const late = r.sloViolated
      v.barBg.position.set(bx, by)
      v.barBg.scale.set(BAR_W, 3)
      v.barPre.position.set(bx, by)
      v.barPre.scale.set(Math.max(0, Math.round(preW * preProg)), 3)
      v.barPre.tint = late ? BAR_LATE : BAR_PREFILL
      const think = hasDecode ? clamp01((r.thinkTokens ?? 0) / r.maxWork) : 0
      const thinkW = Math.round(decW * think)
      if (thinkW > 0) {
        v.barThink.visible = true
        v.barThink.position.set(bx + preW, by)
        v.barThink.scale.set(Math.round(thinkW * clamp01(decProg / think)), 3)
        v.barThink.tint = late ? BAR_LATE : BAR_THINK
      }
      const ansW = decW - thinkW
      const ansProg = think >= 1 ? 0 : clamp01((decProg - think) / (1 - think))
      v.barDec.position.set(bx + preW + thinkW, by)
      v.barDec.scale.set(Math.round(ansW * ansProg), 3)
      v.barDec.tint = late ? BAR_LATE : r.def.color
      // TTFT moment: a white tick flashes at the phase boundary
      const done = r.prefill <= 0
      if (done && !v.prefillDone) v.tickT = 0.25
      v.prefillDone = done
      if (v.tickT > 0 && hasDecode) {
        v.tick.visible = true
        v.tick.position.set(bx + preW - 1, by - 1)
        v.tick.alpha = clamp01(v.tickT / 0.25)
      }
    } else v.prefillDone = r.prefill <= 0
    if (v.tickT > 0) v.tickT -= dt
    // ---- TTFT budget: a hairline under the bar that drains while the prompt waits ----
    const ttftBound = r.def.ttftSloMs ?? LAT_CLASS_SLO[r.def.latClass].ttftMs
    const queued = r.prefill > 0 && r.queueSec > 0 && Number.isFinite(ttftBound)
    v.budget.visible = showBar && queued && !r.sloViolated
    if (v.budget.visible) {
      const left = clamp01(1 - (r.queueSec * 1000) / ttftBound)
      v.budget.position.set(sp.x - BAR_W / 2, y0 - Math.round((REQ_PX * lodScale) / 2) - 1)
      v.budget.scale.set(Math.max(1, Math.round(BAR_W * left)), 1)
      v.budget.tint = left > 0.5 ? COLORS.good : left > 0.2 ? COLORS.warn : COLORS.danger
    }
    // ---- routed pip: a router tagged this request for capability-aware dispatch ----
    v.pip.visible = r.routed && this.lod < 2
    if (v.pip.visible)
      v.pip.position.set(
        sp.x - Math.round((REQ_PX * lodScale) / 2) - 1,
        y0 - Math.round((REQ_PX * lodScale) / 2) - 1,
      )
    // ---- one cause badge, by priority ----
    const hazardOpen = r.safetyRisk > 0 && !r.safetyCleared
    let glyph: GlyphName | null = null
    let color: number = COLORS.text
    if (hazardOpen) {
      glyph = 'hazard'
      color = outcomeColor('unsafe')
    } else if (r.windowBlocked && !r.fitSeen) {
      glyph = 'overflow'
      color = outcomeColor('unservable')
    } else if (r.sloViolated) {
      glyph = 'clock'
      color = outcomeColor('sloMiss')
    } else if (expert && r.work < r.maxWork && r.bestQuality < 0) {
      glyph = 'question'
      color = outcomeColor('bad')
    }
    if (glyph) {
      v.badge.visible = true
      v.badge.texture = this.factory.glyph(glyph)
      v.badge.tint = color
      v.badge.x = sp.x + Math.round((REQ_PX * lodScale) / 2) - 1
      v.badge.y = y0 - Math.round((REQ_PX * lodScale) / 2) + 1
      // hazard + wrong blink; late / too long hold steady
      v.badge.alpha =
        calm || (glyph !== 'hazard' && glyph !== 'question')
          ? 1
          : 0.55 + 0.45 * Math.abs(Math.sin(this.clock * 4.7))
    } else v.badge.visible = false
    // ---- hazard ring: a 1.5 Hz pulse while a hazard is open ----
    if (hazardOpen && this.lod === 0) {
      v.ring.visible = true
      v.ring.position.set(sp.x, y0)
      const pulse = calm ? 0 : 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 3)
      v.ring.scale.set(((REQ_PX + 4) / 16) * lodScale * (1 + pulse * 0.12))
      v.ring.alpha = 0.4 + 0.4 * pulse
    } else v.ring.visible = false
  }

  private startDying(v: ReqVis, outcome: Outcome | null, speed: number): void {
    v.barBg.visible = v.barPre.visible = v.barThink.visible = v.barDec.visible = false
    v.tick.visible = v.badge.visible = v.ring.visible = v.budget.visible = v.pip.visible = false
    if (this.dying.length >= DYING_CAP) {
      const old = this.dying.shift()!
      this.release(old.v)
    }
    const base = outcome === 'leaked' || outcome === 'unsafe' ? 0.42 : outcome === 'served' ? 0.26 : 0.36
    this.dying.push({ v, outcome, age: 0, life: base * (speed >= 6 ? 0.5 : 1), x: v.rx, y: v.ry })
  }

  /** The motion carries the cause: crisp pop, late slump, wrong glitch, refused bounce… */
  private updateDying(dt: number, calm: boolean): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]
      d.age += dt
      const k = d.age / d.life
      if (k >= 1) {
        this.dying.splice(i, 1)
        this.release(d.v)
        continue
      }
      const sp = d.v.sp
      sp.tint = 0xffffff
      if (calm || !d.outcome) {
        sp.alpha = 1 - k
        sp.scale.set(1)
        continue
      }
      let x = d.x
      let y = d.y
      let sx = 1
      let sy = 1
      let alpha = 1 - easeInQuad(k)
      switch (d.outcome) {
        case 'served': // squash, then pop up and vanish
          if (k < 0.3) {
            sx = 1 + 0.3 * (k / 0.3)
            sy = 1 - 0.4 * (k / 0.3)
          } else {
            const q = (k - 0.3) / 0.7
            sx = sy = 1.3 * (1 - q)
            y -= 6 * easeOutCubic(q)
          }
          alpha = 1
          break
        case 'sloMiss': // slump: sag and sink, desaturating toward the late tint
          sy = 1 - 0.3 * easeOutCubic(k)
          sx = 1 + 0.1 * k
          y += 4 * easeOutCubic(k)
          sp.tint = 0x9fb1c8
          break
        case 'bad': // two-frame horizontal glitch, then greyed out
          x += Math.floor(d.age * 40) % 2 === 0 ? -2 : 2
          sp.tint = 0x7f8a99
          break
        case 'overRefused': // turned away: bounce back against the lane direction
          x -= d.v.dx * 8 * easeOutBack(Math.min(1, k * 1.6))
          y -= d.v.dy * 8 * easeOutBack(Math.min(1, k * 1.6))
          break
        case 'unservable': // squeezed: the prompt does not fit the window
          sx = 1 - 0.7 * k
          sy = 1 + 0.25 * k
          sp.tint = 0x9aa5b8
          break
        case 'unsafe': // flare
          sx = sy = 1 + 0.4 * easeOutCubic(k)
          sp.tint = k < 0.4 ? 0xffd0d8 : 0xff3b5c
          break
        case 'leaked': // dive into the core
          sx = sy = 1 - easeInQuad(k)
          sp.rotation = k * 2.4
          break
      }
      sp.position.set(Math.round(x), Math.round(y))
      sp.scale.set(sx, sy)
      sp.alpha = alpha
    }
  }

  private acquire(r: Request, time: number): ReqVis {
    const v = this.spare.pop() ?? this.make()
    v.id = r.id
    v.sp.texture = this.factory.request(r.def)
    v.sp.visible = true
    v.sp.alpha = 1
    v.sp.rotation = 0
    v.sp.tint = 0xffffff
    v.px = v.cx = v.rx = r.x
    v.py = v.cy = v.ry = r.y
    v.tp = v.tc = time
    v.nx = 0
    v.ny = 0
    v.dx = 1
    v.dy = 0
    v.spread = (hash01(r.id) * 2 - 1) * SPREAD
    v.born = this.clock
    v.prefillDone = r.prefill <= 0
    v.tickT = 0
    for (const s of [v.barBg, v.barPre, v.barThink, v.barDec, v.tick, v.budget, v.pip, v.badge, v.ring])
      s.visible = false
    this.packets.addChild(v.sp)
    this.decor.addChild(v.ring, v.barBg, v.barPre, v.barThink, v.barDec, v.tick, v.budget, v.pip, v.badge)
    return v
  }

  private release(v: ReqVis): void {
    this.packets.removeChild(v.sp)
    this.decor.removeChild(v.ring, v.barBg, v.barPre, v.barThink, v.barDec, v.tick, v.budget, v.pip, v.badge)
    if (this.spare.length < 512) this.spare.push(v)
  }

  private make(): ReqVis {
    const px = this.factory.particle('px')
    const bar = (tint: number, alpha = 1): Sprite => {
      const s = new Sprite(px)
      s.tint = tint
      s.alpha = alpha
      return s
    }
    const sp = new Sprite()
    sp.anchor.set(0.5)
    const tick = bar(0xffffff)
    tick.scale.set(1, 5)
    const pip = bar(COLORS.power)
    pip.scale.set(3, 3)
    const badge = new Sprite()
    badge.anchor.set(0.5)
    const ring = new Sprite(this.factory.particle('ring'))
    ring.anchor.set(0.5)
    ring.tint = COLORS.danger
    return {
      id: 0,
      sp,
      barBg: bar(BAR_BG, 0.85),
      barPre: bar(BAR_PREFILL),
      barThink: bar(BAR_THINK),
      barDec: bar(0xffffff),
      tick,
      budget: bar(COLORS.good),
      pip,
      badge,
      ring,
      px: 0,
      py: 0,
      cx: 0,
      cy: 0,
      tp: 0,
      tc: 0,
      rx: 0,
      ry: 0,
      nx: 0,
      ny: 0,
      spread: 0,
      born: 0,
      prefillDone: false,
      tickT: 0,
      dx: 1,
      dy: 0,
    }
  }
}
