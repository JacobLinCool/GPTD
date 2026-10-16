import { Container, Graphics, Sprite } from 'pixi.js'
import { COLORS, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { GameState } from '../core/types'
import { CAMPAIGN_THEMES } from '../sim/campaign-data'
import { LANE_PATHS, isBuildable, isPathTile, posAt } from '../sim/pathing'
import { clamp01, easeInOutSine, fxLevel, reducedMotion } from './anim'
import type { FxManager } from './fx'
import type { TextureFactory } from './textures'

const LANE_FLOOR = 0x152b4b // laneFloor blended with laneEdge, drawn opaque
const FLOW_SPACING = 36
/** seconds a lane stays "live" after its last spawn */
const LIVE_HOLD = 1.6

/** Era accent for the lane glow: 2023 blue → 2024 teal → 2025 violet → 2026 amber. */
function eraColor(waveIndex: number): number {
  const era = CAMPAIGN_THEMES[Math.min(waveIndex, CAMPAIGN_THEMES.length - 1)]?.era ?? ''
  if (era.startsWith('2023')) return 0x2b6cff
  if (era.startsWith('2024')) return 0x1fb5c4
  if (era.startsWith('2025')) return 0x8a63ff
  return 0xffa040
}
function mixColor(a: number, b: number, k: number): number {
  const m = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k)
  return (m(16) << 16) | (m(8) << 8) | m(0)
}

interface Portal {
  glow: Sprite
  ring: Sprite
  flash: number
  live: number
}

/**
 * The board floor and the four ingress lanes. The static floor sits in its own
 * render group (its ~500 tile shapes are never rebuilt). On top: chevrons that flow
 * toward the core during a wave (brighter on lanes that are taking traffic), ingress
 * portals that flash on every spawn, the surge / funnel lane highlight, and a light
 * sweep into the core when a wave is cleared.
 */
export class LaneLayer {
  readonly floor = new Container({ isRenderGroup: true })
  readonly view = new Container()
  private glowG = new Graphics()
  private surgeG = new Graphics()
  private flow = new Container()
  private chevrons: Sprite[][] = []
  private portals: Portal[] = []
  private clock = 0
  private phase = 0
  private surgeKey = ''
  private surgeLanes: number[] = []
  private preview: number[] | null = null
  private eraFrom = 0x2b6cff
  private eraTo = 0x2b6cff
  private eraT = 1
  private sweeps: { lane: number; t: number }[] = []

  constructor(
    private factory: TextureFactory,
    private fx: FxManager,
  ) {
    this.buildFloor()
    this.view.addChild(this.surgeG, this.flow)
    this.view.eventMode = 'none'
    const chev = factory.particle('chevron')
    for (const lane of LANE_PATHS) {
      const row: Sprite[] = []
      const n = Math.ceil(lane.length / FLOW_SPACING)
      for (let i = 0; i < n; i++) {
        const sp = new Sprite(chev)
        sp.anchor.set(0.5)
        sp.tint = 0x8fb4ff
        sp.visible = false
        this.flow.addChild(sp)
        row.push(sp)
      }
      this.chevrons.push(row)
      const entry = lane.waypoints[0]
      const glow = new Sprite(factory.particle('glow'))
      glow.anchor.set(0.5)
      glow.position.set(entry.x, entry.y)
      glow.blendMode = 'add'
      const ring = new Sprite(factory.particle('ring'))
      ring.anchor.set(0.5)
      ring.position.set(entry.x, entry.y)
      this.view.addChild(glow, ring)
      this.portals.push({ glow, ring, flash: 0, live: 0 })
    }
  }

  private buildFloor(): void {
    const g = new Graphics()
    g.rect(GRID_X - 8, GRID_Y - 8, GRID_COLS * TILE + 16, GRID_ROWS * TILE + 16).fill({ color: COLORS.bg })
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (isPathTile(c, r)) continue
        const x = GRID_X + c * TILE
        const y = GRID_Y + r * TILE
        g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill({
          color: isBuildable(c, r) ? COLORS.tileBuild : COLORS.tile,
          alpha: 0.6,
        })
        g.rect(x + 1, y + 1, TILE - 2, TILE - 2).stroke({ width: 1, color: COLORS.bgGrid, alpha: 0.8 })
      }
    }
    // each lane is ONE continuous path with round joins/caps, OPAQUE so overlapping
    // lanes redraw the same colour instead of stacking into brighter patches.
    for (const lane of LANE_PATHS) {
      g.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) g.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      g.stroke({ width: TILE - 6, color: LANE_FLOOR, cap: 'round', join: 'round' })
    }
    // the centerline glow is drawn white and TINTED, so the era palette can shift it
    const l = this.glowG
    for (const lane of LANE_PATHS) {
      l.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) l.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      l.stroke({ width: 4, color: 0xffffff, alpha: 0.4, cap: 'round', join: 'round' })
    }
    l.tint = COLORS.laneGlow
    this.floor.addChild(g, l)
  }

  /** A request spawned on this lane: flash its portal. */
  spawned(lane: number): void {
    const p = this.portals[lane]
    if (!p) return
    p.flash = 0.25
    p.live = LIVE_HOLD
  }

  /** The upcoming wave's ingress lanes (shell preview during the build phase); null = unknown. */
  setPreview(lanes: number[] | null): void {
    this.preview = lanes
  }

  /** A wave started: crossfade the era tint, remember its surge lane. */
  waveStart(s: GameState, surgeLane: number | undefined): void {
    this.eraFrom = this.currentEra()
    this.eraTo = eraColor(s.waveIndex)
    this.eraT = 0
    this.preview = surgeLane !== undefined ? [surgeLane] : null
  }

  /** A wave cleared: a bright sweep runs down every lane into the core. */
  waveClear(): void {
    this.preview = null
    if (fxLevel() === 'minimal') return
    this.sweeps = LANE_PATHS.map((l) => ({ lane: l.id, t: 0 }))
  }

  reset(): void {
    this.sweeps.length = 0
    this.preview = null
    this.surgeKey = ''
    this.eraFrom = this.eraTo = eraColor(0)
    this.eraT = 0
    for (const p of this.portals) p.flash = p.live = 0
  }

  private currentEra(): number {
    return mixColor(this.eraFrom, this.eraTo, clamp01(this.eraT))
  }

  sync(s: GameState, dt: number, speed: number): void {
    this.clock += dt
    const calm = reducedMotion()
    const wave = s.phase === 'wave'
    // era tint crossfade (1 s)
    if (this.eraT < 1) {
      this.eraT += dt
      this.glowG.tint = this.currentEra()
    } else if (this.eraT >= 1 && this.glowG.tint !== this.eraTo) this.glowG.tint = this.eraTo
    // funnel / surge lanes: an incident's lane window, else the wave's pinned surge lane
    const funnel = s.laneWindow.length ? s.laneWindow : (this.preview ?? [])
    this.drawSurge(funnel)
    // portals
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i]
      if (p.flash > 0) p.flash -= dt
      if (p.live > 0) p.live -= dt
      const inFunnel = funnel.length > 0 && funnel.includes(i)
      const dim = funnel.length > 0 && !inFunnel
      const live = wave && p.live > 0
      const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 2.2 + i)
      const bloom = live ? 1.2 : inFunnel ? 1 : 0.7
      const f = clamp01(p.flash / 0.25)
      p.ring.scale.set((bloom + 0.06 * pulse + 0.35 * f) * 1.1)
      p.ring.tint = inFunnel ? COLORS.warn : COLORS.laneGlow
      p.ring.alpha = dim ? 0.15 : 0.45 + 0.3 * pulse * (live ? 1 : 0.5) + 0.25 * f
      p.glow.scale.set(bloom * 1.6 + f)
      p.glow.tint = inFunnel ? COLORS.warn : COLORS.laneGlow
      p.glow.alpha = dim ? 0.05 : (live ? 0.45 : 0.22) + 0.35 * f
    }
    // flow chevrons toward the core (waves only)
    const showFlow = wave && fxLevel() !== 'minimal'
    if (!calm) this.phase += dt * 22 * Math.sqrt(Math.max(1, speed))
    for (let li = 0; li < LANE_PATHS.length; li++) {
      const lane = LANE_PATHS[li]
      const row = this.chevrons[li]
      const live = this.portals[li].live > 0 || (funnel.length > 0 && funnel.includes(li))
      const alpha = funnel.length > 0 && !funnel.includes(li) ? 0.08 : live ? 0.42 : 0.16
      // place by REMAINING distance so lanes that share their tail draw on the same points
      const off = FLOW_SPACING - (this.phase % FLOW_SPACING)
      for (let i = 0; i < row.length; i++) {
        const sp = row[i]
        const rem = i * FLOW_SPACING + off
        if (!showFlow || rem > lane.length - 6) {
          sp.visible = false
          continue
        }
        const d = lane.length - rem
        const a = posAt(d, li)
        const b = posAt(Math.min(lane.length, d + 2), li)
        sp.visible = true
        sp.position.set(Math.round(a.x), Math.round(a.y))
        sp.rotation = Math.atan2(b.y - a.y, b.x - a.x)
        sp.alpha = alpha
      }
    }
    // clear sweep
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i]
      sw.t += dt / 0.7
      if (sw.t >= 1) {
        this.sweeps.splice(i, 1)
        continue
      }
      const lane = LANE_PATHS[sw.lane]
      const p = posAt(lane.length * easeInOutSine(sw.t), sw.lane)
      this.fx.particles.spawn(this.factory.particle('sq3'), p.x, p.y, {
        life: 0.35,
        s0: 1.5,
        s1: 0.5,
        alpha: 0.9,
        tint: 0xcfe6ff,
      })
    }
  }

  private drawSurge(lanes: number[]): void {
    const key = lanes.join(',')
    if (key === this.surgeKey) {
      if (lanes.length)
        this.surgeG.alpha = reducedMotion() ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 2.4))
      return
    }
    this.surgeKey = key
    this.surgeLanes = lanes
    const g = this.surgeG
    g.clear()
    if (!lanes.length) return
    // dim every lane outside the funnel, then highlight the funnel lane(s) on top
    for (const lane of LANE_PATHS) {
      if (lanes.includes(lane.id)) continue
      g.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) g.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      g.stroke({ width: TILE - 8, color: COLORS.bg, alpha: 0.45, cap: 'round', join: 'round' })
    }
    for (const id of lanes) {
      const lane = LANE_PATHS[id]
      if (!lane) continue
      g.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) g.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      g.stroke({ width: 10, color: COLORS.warn, alpha: 0.22, cap: 'round', join: 'round' })
    }
  }

  /** Lanes currently highlighted as the funnel/surge (for tests and the gallery). */
  get highlighted(): readonly number[] {
    return this.surgeLanes
  }
}
