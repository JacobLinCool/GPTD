import { BitmapText, Container, Graphics, Sprite, type Texture } from 'pixi.js'
import { COLORS, TILE } from '../config'
import type { GameState, Tower } from '../core/types'
import { isExpert } from '../mode'
import { modelName, t } from '../i18n'
import { getSettings } from '../settings'
import { HARDWARE_DEFS } from '../sim/content'
import {
  hasLiquidLoop,
  hwNeedsLiquid,
  loadoutOf,
  serverBandwidthCeiling,
  serverComputeCeiling,
  serverFitsMemory,
  serverTargets,
} from '../sim/effects'
import { clamp01, easeInQuad, easeOutBack, easeOutCubic, reducedMotion } from './anim'
import type { FxManager } from './fx'
import { POP_FONT } from './popups'
import { BAR_PREFILL } from './requests'
import { TOWER_PX, type TextureFactory } from './textures'

/** LED colours of a rack's batch slots. */
export const LED_FREE = 0x2c384c
export const LED_DECODE = 0x5fd7ff
export const LED_PREFILL = BAR_PREFILL
const LED_STALL = 0x56606e
const MAX_LEDS = 8
/** Heat / throttle accent (distinct from every hardware stripe and the training scan). */
const HEAT = 0xff7a45
const TRAIN_SCAN = 0xe8ecff

/** Why a rack is dark or degraded (power cut vs missing liquid loop vs thermal throttle). */
export type RackCause = 'power' | 'liquid' | 'heat' | null
export function rackCause(t: Tower, liquidLoop: boolean): RackCause {
  if (t.def.kind !== 'server') return t.online ? null : 'power'
  if (!t.online) return hwNeedsLiquid(t.hwId ? HARDWARE_DEFS[t.hwId] : null) && !liquidLoop ? 'liquid' : 'power'
  return t.throttle < 1 ? 'heat' : null
}

type AnimKind = 'build' | 'upgrade' | 'deploy' | 'role' | 'powerDown' | 'powerUp'
interface RackAnim {
  kind: AnimKind
  age: number
  life: number
  /** upgrade: the outgoing hardware texture, wiped away by a scanline */
  oldTex?: Texture
}

interface TowerVis {
  id: number
  sp: Sprite
  overlay: Container
  leds: Sprite[]
  cause: Sprite
  kvBg: Sprite
  kvFill: Sprite
  scan: Sprite
  glow: Sprite
  fan: Sprite | null
  wipe: Sprite | null
  wipeMask: Graphics | null
  tag: BitmapText | null
  hwId: string | undefined
  modelId: string | undefined
  role: string | undefined
  online: boolean
  slots: number
  slotsAt: number
  tagKey: string
  tagText: string
  anim: RackAnim | null
  flash: number
  flashColor: number
  kick: number
  moteT: number
}

interface Ghost {
  sp: Sprite
  age: number
  x: number
  y: number
}

/**
 * Racks and support buildings. Rack state is shown as physical state, not tints:
 * batch-slot LEDs (cyan decoding, amber prefill, grey = decodes stalled behind an
 * unchunked prefill), an Expert KV-fill gauge, a cause icon over dark or degraded
 * racks (⚡ power cut, 💧 liquid gate, 🌡 throttle + heat glow and motes), and a
 * training scanline. Build / sell / upgrade / deploy / role changes animate from
 * renderer diffs, so they also play for agent and demo actions.
 */
export class RackLayer {
  readonly view = new Container()
  private towers = new Container()
  private overlays = new Container()
  private tags = new Container()
  private vis = new Map<number, TowerVis>()
  private ghosts: Ghost[] = []
  private clock = 0
  /** the first sync after a reset builds the board silently (no drop-in for every rack) */
  private quiet = true
  private lastKick = new Map<number, number>()

  constructor(
    private factory: TextureFactory,
    private fx: FxManager,
  ) {
    this.view.addChild(this.towers, this.overlays, this.tags)
    this.view.eventMode = 'none'
  }

  spriteOf(id: number): Sprite | null {
    return this.vis.get(id)?.sp ?? null
  }

  /** guard / cache reaction: a short additive flash in a colour. */
  flash(id: number, color: number): void {
    const v = this.vis.get(id)
    if (!v) return
    v.flash = 0.18
    v.flashColor = color
  }

  /** a request completed on this rack: a one-frame kick (≤ 4/s per rack). */
  kick(id: number): void {
    const v = this.vis.get(id)
    if (!v) return
    const last = this.lastKick.get(id) ?? -1
    if (this.clock - last < 0.25) return
    this.lastKick.set(id, this.clock)
    v.kick = 0.08
  }

  reset(): void {
    for (const v of this.vis.values()) this.destroyVis(v)
    this.vis.clear()
    for (const g of this.ghosts) g.sp.destroy()
    this.ghosts.length = 0
    this.lastKick.clear()
    this.quiet = true
  }

  /** Diff the tower list against the sprites and draw every rack's live state. */
  sync(s: GameState, dt: number, hoverId: number | null, selectedId: number | null): void {
    this.clock += dt
    const calm = reducedMotion()
    const expert = isExpert()
    const seen = new Set<number>()
    const tagCounts = new Map<string, number>()
    const liquidLoop = hasLiquidLoop(s)
    const flashMul = getSettings().a11y.reduceFlashing ? 0.45 : 1
    for (const tw of s.towers) {
      seen.add(tw.id)
      let v = this.vis.get(tw.id)
      if (!v) {
        v = this.make(tw)
        this.vis.set(tw.id, v)
        if (!this.quiet) this.startAnim(v, 'build', 0.26)
      }
      this.diff(s, tw, v)
      this.drawTower(s, tw, v, dt, calm, expert, rackCause(tw, liquidLoop), flashMul)
      if (expert && tw.def.kind === 'server') {
        this.refreshTag(s, tw, v)
        tagCounts.set(v.tagKey, (tagCounts.get(v.tagKey) ?? 0) + 1)
      }
    }
    // Expert tags only where a rack differs from the fleet majority, or on hover/selection.
    let majority = ''
    let best = 0
    for (const [k, n] of tagCounts) {
      if (n <= best) continue
      best = n
      majority = k
    }
    for (const v of this.vis.values()) {
      if (!v.tag) continue
      v.tag.visible = expert && (v.tagKey !== majority || v.id === hoverId || v.id === selectedId)
    }
    for (const [id, v] of this.vis) {
      if (seen.has(id)) continue
      this.sellGhost(v)
      this.destroyVis(v)
      this.vis.delete(id)
    }
    this.updateGhosts(dt)
    this.quiet = false
  }

  /** State diffs → animations (upgrade wipe, deploy sweep, role flip, power down/up). */
  private diff(s: GameState, tw: Tower, v: TowerVis): void {
    if (tw.def.kind === 'server') {
      if (tw.hwId !== v.hwId) {
        const oldTex = v.sp.texture
        v.sp.texture = this.factory.tower(tw.def, tw.hwId)
        if (!this.quiet && v.hwId) {
          this.startAnim(v, 'upgrade', 0.32, oldTex)
          const from = HARDWARE_DEFS[v.hwId]
          const to = tw.hwId ? HARDWARE_DEFS[tw.hwId] : undefined
          if (from && to)
            this.fx.popup(
              `${shortGpu(from.gpuModel)} → ${shortGpu(to.gpuModel)}`,
              to.color,
              tw.x,
              tw.y - 24,
              `upg${tw.id}:${tw.hwId}`, // a chained upgrade stacks its own tier pair, never folds into "×N"
            )
          this.fx.burst(tw.x, tw.y - 6, to?.color ?? COLORS.white, 10, 70, 'spark', 0.5, -40)
        }
        v.hwId = tw.hwId
        v.slotsAt = -1
      }
      if (tw.modelId !== v.modelId) {
        if (!this.quiet && v.modelId !== undefined && tw.modelId) {
          this.startAnim(v, 'deploy', 0.42)
          const m = loadoutOf(s, tw).model
          if (m) this.fx.popup(modelName(m), COLORS.data, tw.x, tw.y - 24, 'dep' + tw.id, 'download')
        }
        v.modelId = tw.modelId
        v.slotsAt = -1
      }
      if (tw.role !== v.role) {
        if (!this.quiet) this.startAnim(v, 'role', 0.22)
        v.role = tw.role
      }
    }
    if (tw.online !== v.online) {
      if (!this.quiet) this.startAnim(v, tw.online ? 'powerUp' : 'powerDown', tw.online ? 0.3 : 0.32)
      v.online = tw.online
    }
  }

  private drawTower(
    s: GameState,
    tw: Tower,
    v: TowerVis,
    dt: number,
    calm: boolean,
    expert: boolean,
    cause: RackCause,
    flashMul: number,
  ): void {
    const sp = v.sp
    let sx = 1
    let sy = 1
    let dy = 0
    let alpha = tw.online ? 1 : 0.62
    let tint = tw.online ? 0xffffff : 0x55607a
    if (tw.training) tint = 0x9aa3bd
    // --- one-shot animations ---
    const a = v.anim
    if (a) {
      a.age += dt
      const k = clamp01(a.age / a.life)
      if (!calm) {
        if (a.kind === 'build') {
          const e = easeOutBack(k)
          sx = sy = 1.35 - 0.35 * e
          if (k < 0.15) alpha = k / 0.15
        } else if (a.kind === 'role') {
          sx = Math.abs(Math.cos(k * Math.PI))
        } else if (a.kind === 'powerDown') {
          dy = Math.round(easeOutCubic(k))
        }
      }
      if (a.kind === 'upgrade') this.drawWipe(v, a, k)
      if (k >= 1) this.endAnim(v)
    }
    if (v.kick > 0) {
      v.kick -= dt
      if (!calm) sy *= 0.94
    }
    sp.scale.set(sx, sy)
    sp.x = Math.round(tw.x)
    sp.y = Math.round(tw.y) + dy
    sp.tint = tint
    sp.alpha = alpha
    const ox = sp.x
    const oy = sp.y
    // --- additive flash (guards, power-up blink, deploy sweep) ---
    let glowA = 0
    let glowTint = v.flashColor
    let glowScale = 3
    if (v.flash > 0) {
      v.flash -= dt
      glowA = Math.max(0, v.flash / 0.18) * 0.9 * flashMul
    }
    if (a && a.kind === 'powerUp') {
      glowA = Math.max(glowA, (1 - a.age / a.life) * 0.7)
      glowTint = 0xffffff
    }
    if (cause === 'heat' && tw.online) {
      const p = calm ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 3 + tw.id)
      if (glowA < 0.25 + 0.15 * p) {
        glowA = 0.25 + 0.15 * p
        glowTint = HEAT
        glowScale = 3.2
      }
      v.moteT -= dt
      if (v.moteT <= 0 && !calm) {
        v.moteT = 0.6 + Math.random() * 0.6
        if (this.fx.budget(1) > 0)
          this.fx.particles.spawn(this.fx.frame('px'), ox + (Math.random() - 0.5) * 24, oy - 12, {
            vy: -18,
            life: 0.9,
            s0: 2,
            s1: 1,
            alpha: 0.8,
            tint: HEAT,
          })
      }
    }
    // (an upgrade wipe owns the glow sprite as its scanline while it plays)
    if (!(a && a.kind === 'upgrade' && v.anim)) v.glow.visible = glowA > 0.01
    if (v.glow.visible && !(a && a.kind === 'upgrade' && v.anim)) {
      v.glow.position.set(ox, oy)
      v.glow.tint = glowTint
      v.glow.alpha = glowA
      v.glow.scale.set(glowScale)
    }
    // --- cooling fan blades spin with the cooling load ---
    if (v.fan) {
      v.fan.position.set(ox, oy - 1)
      const load = s.cooling.cap > 0 ? clamp01(s.cooling.used / s.cooling.cap) : 0
      if (!calm && tw.online) v.fan.rotation += dt * (1.5 + 10 * load)
      v.fan.alpha = alpha
    }
    if (tw.def.kind !== 'server') {
      v.cause.visible = !tw.online
      if (!tw.online) this.placeCause(v, 'power', ox, oy, calm)
      else if (!calm) this.ambient(s, tw, v, dt, ox, oy)
      return
    }
    // --- batch-slot LEDs ---
    if (this.clock - v.slotsAt > 0.25 || v.slotsAt < 0) {
      v.slotsAt = this.clock
      v.slots = Math.min(MAX_LEDS, serverTargets(s, loadoutOf(s, tw)))
    }
    const n = v.slots
    const decodeN = tw.decodeIds ? tw.decodeIds.length : Math.round(tw.load * n)
    const prefill = tw.prefillId != null
    const stalled = prefill && decodeN > 0 && !s.infra.scheduling.chunked
    const w = n <= 4 ? 4 : 2
    const step = n <= 4 ? 6 : 3
    const span = n * step - (step - w)
    const lx = ox - Math.floor(span / 2)
    const down = a && a.kind === 'powerDown' ? clamp01(a.age / a.life) : tw.online ? 0 : 1
    for (let i = 0; i < MAX_LEDS; i++) {
      const led = v.leds[i]
      if (i >= n) {
        led.visible = false
        continue
      }
      led.visible = true
      led.position.set(lx + i * step, oy + 13)
      led.scale.set(w, 2)
      let c = LED_FREE
      if (tw.online && !tw.training) {
        if (i < decodeN) c = stalled ? LED_STALL : LED_DECODE
        else if (prefill && i === decodeN) c = LED_PREFILL
      }
      // power-down: LEDs go out left to right
      if (down > 0 && i / n < down) c = LED_FREE
      led.tint = c
      led.alpha = c === LED_PREFILL && stalled && !calm ? (Math.sin(this.clock * 18) > 0 ? 1 : 0.35) : 1
    }
    // --- Expert KV gauge on the rack edge ---
    const kv = tw.kvFrac
    const showKv = expert && tw.online && kv !== undefined && !tw.training
    v.kvBg.visible = v.kvFill.visible = showKv
    if (showKv) {
      const h = 22
      v.kvBg.position.set(ox + 17, oy - 12)
      v.kvBg.scale.set(2, h)
      const fh = Math.round(h * clamp01(kv))
      v.kvFill.position.set(ox + 17, oy - 12 + h - fh)
      v.kvFill.scale.set(2, fh)
      v.kvFill.tint = kv >= 0.92 ? COLORS.danger : kv >= 0.75 ? COLORS.warn : COLORS.good
    }
    // --- training scanline ---
    v.scan.visible = !!tw.training
    if (tw.training) {
      const ph = calm ? 0.5 : (this.clock * 0.9 + tw.id * 0.37) % 1
      v.scan.position.set(ox - 14, oy - 14 + Math.round(ph * 26))
      v.scan.scale.set(28, 2)
      v.scan.alpha = 0.75
    }
    // --- cause icon over dark / degraded racks ---
    v.cause.visible = cause !== null
    if (cause) this.placeCause(v, cause, ox, oy, calm)
  }

  /** Ambient life: lab bubbles while research runs, power-plant sparks near the capacity wall. */
  private ambient(s: GameState, tw: Tower, v: TowerVis, dt: number, ox: number, oy: number): void {
    const researching = !!(s.research.infra || s.research.posttrain || s.research.eval)
    const strained = tw.def.kind === 'power' && s.power.cap > 0 && s.power.used / s.power.cap > 0.85
    if (!(tw.def.kind === 'lab' && researching) && !strained) return
    v.moteT -= dt
    if (v.moteT > 0) return
    v.moteT = tw.def.kind === 'lab' ? 0.7 + Math.random() * 0.5 : 0.35 + Math.random() * 0.4
    if (this.fx.budget(1) <= 0) return
    if (tw.def.kind === 'lab') {
      this.fx.particles.spawn(this.fx.frame('dot'), ox + (Math.random() - 0.5) * 8, oy - 4, {
        vy: -16,
        vx: (Math.random() - 0.5) * 6,
        life: 1,
        s0: 0.6,
        s1: 1,
        alpha: 0.8,
        tint: COLORS.data,
      })
    } else {
      this.fx.burst(ox + (Math.random() - 0.5) * 14, oy - 8, COLORS.power, 3, 50, 'px', 0.3, 0)
    }
  }

  private placeCause(
    v: TowerVis,
    cause: Exclude<RackCause, null>,
    ox: number,
    oy: number,
    calm: boolean,
  ): void {
    v.cause.texture = this.factory.glyph(
      cause === 'power' ? 'bolt' : cause === 'liquid' ? 'droplet' : 'thermo',
    )
    v.cause.tint = cause === 'power' ? COLORS.power : cause === 'liquid' ? COLORS.cooling : HEAT
    v.cause.position.set(ox + 12, oy - 13)
    // dark racks flicker their cause every ~1.5 s; a throttled rack holds steady
    v.cause.alpha = cause === 'heat' || calm ? 1 : (this.clock + v.id * 0.13) % 1.5 < 1.2 ? 1 : 0.3
  }

  /** Upgrade: a bright scanline wipes the old tier's texture away, top to bottom. */
  private drawWipe(v: TowerVis, a: RackAnim, k: number): void {
    if (!a.oldTex) return
    if (!v.wipe) {
      v.wipe = new Sprite(a.oldTex)
      v.wipe.anchor.set(0.5)
      v.wipeMask = new Graphics()
      v.wipe.mask = v.wipeMask
      this.overlays.addChild(v.wipe, v.wipeMask)
    }
    const sp = v.sp
    v.wipe.position.set(sp.x, sp.y)
    const top = sp.y - TOWER_PX / 2
    const cut = top + Math.round(TOWER_PX * easeInQuad(k))
    v.wipeMask!.clear()
      .rect(sp.x - TOWER_PX / 2, cut, TOWER_PX, sp.y + TOWER_PX / 2 - cut)
      .fill({ color: 0xffffff })
    v.glow.visible = true
    v.glow.position.set(sp.x, cut)
    v.glow.tint = 0xffffff
    v.glow.alpha = 0.8
    v.glow.scale.set(2.6, 0.35)
  }

  private startAnim(v: TowerVis, kind: AnimKind, life: number, oldTex?: Texture): void {
    if (v.anim) this.endAnim(v)
    v.anim = { kind, age: 0, life, oldTex }
    if (kind === 'build') {
      this.fx.ring(v.sp.x || 0, v.sp.y || 0, 6, TILE * 0.7, COLORS.textDim, 0.35, 1.5)
    } else if (kind === 'deploy') {
      v.flash = 0.18
      v.flashColor = COLORS.data
    }
  }

  private endAnim(v: TowerVis): void {
    if (v.wipe) {
      v.wipe.destroy()
      v.wipeMask?.destroy()
      v.wipe = null
      v.wipeMask = null
    }
    v.anim = null
  }

  /** A sold building lifts and shrinks away (the sim removed it this frame). */
  private sellGhost(v: TowerVis): void {
    if (this.quiet) return
    const sp = new Sprite(v.sp.texture)
    sp.anchor.set(0.5)
    sp.position.set(v.sp.x, v.sp.y)
    this.towers.addChild(sp)
    this.ghosts.push({ sp, age: 0, x: v.sp.x, y: v.sp.y })
    this.fx.burst(v.sp.x, v.sp.y + 8, COLORS.textDim, 8, 50, 'sq2', 0.5, -20)
  }

  private updateGhosts(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]
      g.age += dt
      const k = g.age / 0.26
      if (k >= 1) {
        g.sp.destroy()
        this.ghosts.splice(i, 1)
        continue
      }
      g.sp.y = Math.round(g.y - 6 * easeOutCubic(k))
      g.sp.scale.set(1 - k)
      g.sp.alpha = 1 - k * 0.5
    }
  }

  /** Expert roofline tag (CMP / BW / FIT? / T), recomputed on loadout change or at 4 Hz. */
  private refreshTag(s: GameState, tw: Tower, v: TowerVis): void {
    const key = `${tw.hwId}|${tw.modelId}|${tw.role ?? ''}|${tw.training ? 1 : 0}|${s.infra.weightQuantBytes}`
    if (key !== v.tagText || !v.tag) {
      v.tagText = key
      const lo = loadoutOf(s, tw)
      const fits = serverFitsMemory(s, lo)
      const computeBound = serverComputeCeiling(s, lo) <= serverBandwidthCeiling(s, lo)
      const kind = tw.training ? 'T' : !fits ? 'F' : computeBound ? 'C' : 'B'
      v.tagKey = kind
      if (!v.tag) {
        v.tag = new BitmapText({ text: '', style: { fontFamily: POP_FONT, fontSize: 9 } })
        v.tag.anchor.set(1, 0)
        this.tags.addChild(v.tag)
      }
      v.tag.text =
        kind === 'T'
          ? t('world.tagTraining')
          : kind === 'F'
            ? t('world.tagNoFit')
            : kind === 'C'
              ? t('world.tagCompute')
              : t('world.tagBandwidth')
      v.tag.tint =
        kind === 'T'
          ? COLORS.data
          : kind === 'F'
            ? COLORS.danger
            : kind === 'C'
              ? COLORS.power
              : COLORS.cooling
    }
    v.tag.position.set(Math.round(tw.x + TILE / 2 - 3), Math.round(tw.y - TILE / 2 + 1))
  }

  /** Re-read the tag strings after a language switch. */
  refreshLanguage(): void {
    for (const v of this.vis.values()) v.tagText = ''
  }

  private make(tw: Tower): TowerVis {
    const sp = new Sprite(this.factory.tower(tw.def, tw.hwId))
    sp.anchor.set(0.5)
    sp.position.set(Math.round(tw.x), Math.round(tw.y))
    this.towers.addChild(sp)
    const overlay = new Container()
    this.overlays.addChild(overlay)
    const px = this.factory.particle('px')
    const pix = (tint: number): Sprite => {
      const s = new Sprite(px)
      s.tint = tint
      s.visible = false
      overlay.addChild(s)
      return s
    }
    const leds: Sprite[] = []
    if (tw.def.kind === 'server') for (let i = 0; i < MAX_LEDS; i++) leds.push(pix(LED_FREE))
    const kvBg = pix(0x0a0e14)
    kvBg.alpha = 0.85
    const kvFill = pix(COLORS.good)
    const scan = pix(TRAIN_SCAN)
    const glow = new Sprite(this.factory.particle('glow'))
    glow.anchor.set(0.5)
    glow.blendMode = 'add'
    glow.visible = false
    overlay.addChildAt(glow, 0)
    const cause = new Sprite()
    cause.anchor.set(0.5)
    cause.visible = false
    overlay.addChild(cause)
    let fan: Sprite | null = null
    if (tw.def.kind === 'cooling') {
      fan = new Sprite(this.factory.fanBlades(tw.def))
      fan.anchor.set(0.5, 0.5 - 1 / TOWER_PX)
      overlay.addChild(fan)
    }
    return {
      id: tw.id,
      sp,
      overlay,
      leds,
      cause,
      kvBg,
      kvFill,
      scan,
      glow,
      fan,
      wipe: null,
      wipeMask: null,
      tag: null,
      hwId: tw.hwId,
      modelId: tw.modelId,
      role: tw.role,
      online: tw.online,
      slots: 0,
      slotsAt: -1,
      tagKey: '',
      tagText: '',
      anim: null,
      flash: 0,
      flashColor: 0xffffff,
      kick: 0,
      moteT: Math.random(),
    }
  }

  private destroyVis(v: TowerVis): void {
    this.endAnim(v)
    v.sp.destroy()
    v.overlay.destroy({ children: true })
    v.tag?.destroy()
  }
}

/** "H100-class" → "H100", "DGX H200 (8× H200)" → "DGX H200". */
function shortGpu(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').replace(/-class$/, '')
}
