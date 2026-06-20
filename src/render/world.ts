import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { COLORS, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { GameState, TowerDef } from '../core/types'
import { isExpert } from '../mode'
import { prefersReducedMotion } from '../settings'
import { t } from '../i18n'
import {
  loadoutOf,
  serverBandwidthCeiling,
  serverComputeCeiling,
  serverFitsMemory,
  serverSpec,
} from '../sim/effects'
import { CORE_POS, LANE_PATHS, isBuildable, isPathTile, tileCenter, worldToTile } from '../sim/pathing'
import type { FxManager } from './fx'
import { TextureFactory } from './textures'

const TOWER_SIZE = 40
const REQ_SIZE = 24

export interface WorldView {
  selectedId: number | null
  /** S4: the request packet selected for the RequestInspector (Expert Mode). */
  selectedRequestId?: number | null
  buildDef: TowerDef | null
  canAfford: boolean
}

export class WorldRenderer {
  readonly view = new Container()
  private bg = new Graphics()
  private lane = new Graphics()
  private hint = new Graphics()
  private rangeG = new Graphics()
  private towerHost = new Container()
  private overlayG = new Graphics()
  private routeG = new Graphics()
  private requestHost = new Container()
  private barsG = new Graphics()
  private teleG = new Graphics()
  private tagHost = new Container()
  private coreGlow = new Graphics()
  private coreSprite: Sprite
  private interact = new Graphics()

  private towerSprites = new Map<number, Sprite>()
  /** which rack tier each server sprite was baked for (re-texture on upgrade) */
  private towerHw = new Map<number, string>()
  private requestSprites = new Map<number, Sprite>()
  private tagSprites = new Map<number, Text>()
  hoverCol = -1
  hoverRow = -1
  onTileTap: (col: number, row: number) => void = () => {}
  /** S4: report the nearest request packet to a tap (when no build tool is active). */
  onRequestTap: (id: number) => void = () => {}
  private lastState: GameState | null = null

  constructor(
    private factory: TextureFactory,
    fx: FxManager,
  ) {
    // The core is a board-floor feature: it sits just above the lane glow but
    // BELOW towers/requests, so a tower built on the tile directly above/below
    // the core (its 1.3-tile sprite overspills ~7px each side) isn't clipped.
    this.coreSprite = new Sprite(this.factory.core())
    this.coreSprite.anchor.set(0.5)
    this.coreSprite.width = TILE * 1.3
    this.coreSprite.height = TILE * 1.3
    this.coreSprite.x = CORE_POS.x
    this.coreSprite.y = CORE_POS.y
    this.view.addChild(
      this.bg,
      this.lane,
      this.coreGlow,
      this.coreSprite,
      this.hint,
      this.rangeG,
      this.towerHost,
      this.overlayG,
      this.teleG,
      this.tagHost,
      this.routeG,
      this.requestHost,
      this.barsG,
      fx.view,
      this.interact,
    )

    this.buildStatic()
    this.setupInteraction()
  }

  private buildStatic(): void {
    const g = this.bg
    // floor
    g.rect(GRID_X - 8, GRID_Y - 8, GRID_COLS * TILE + 16, GRID_ROWS * TILE + 16).fill({ color: COLORS.bg })
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const x = GRID_X + c * TILE
        const y = GRID_Y + r * TILE
        if (isPathTile(c, r)) continue
        const build = isBuildable(c, r)
        g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill({
          color: build ? COLORS.tileBuild : COLORS.tile,
          alpha: 0.6,
        })
        g.rect(x + 1, y + 1, TILE - 2, TILE - 2).stroke({ width: 1, color: COLORS.bgGrid, alpha: 0.8 })
      }
    }
    // lane conduit — each lane is ONE continuous path with round joins/caps so
    // corners turn cleanly (no butt-cap offset boxes), and the floor is OPAQUE so
    // overlapping lanes redraw the same colour instead of stacking into brighter
    // patches. A thin centerline glow rides on top.
    const l = this.lane
    const LANE_FLOOR = 0x152b4b // laneFloor blended with laneEdge, drawn opaque
    for (const lane of LANE_PATHS) {
      l.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) l.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      l.stroke({ width: TILE - 6, color: LANE_FLOOR, cap: 'round', join: 'round' })
    }
    for (const lane of LANE_PATHS) {
      l.moveTo(lane.waypoints[0].x, lane.waypoints[0].y)
      for (let i = 1; i < lane.waypoints.length; i++) l.lineTo(lane.waypoints[i].x, lane.waypoints[i].y)
      l.stroke({ width: 4, color: COLORS.laneGlow, alpha: 0.4, cap: 'round', join: 'round' })
    }
    // ingress markers
    for (const lane of LANE_PATHS) {
      const entry = lane.waypoints[0]
      l.circle(entry.x, entry.y, 5).fill({ color: COLORS.laneGlow, alpha: 0.8 })
    }
  }

  private setupInteraction(): void {
    this.interact
      .rect(GRID_X, GRID_Y, GRID_COLS * TILE, GRID_ROWS * TILE)
      .fill({ color: 0xffffff, alpha: 0.0001 })
    this.interact.eventMode = 'static'
    this.interact.cursor = 'crosshair'
    this.interact.on('pointermove', (e) => {
      const p = this.view.toLocal(e.global)
      const { col, row } = worldToTile(p.x, p.y)
      this.hoverCol = col
      this.hoverRow = row
    })
    this.interact.on('pointerout', () => {
      this.hoverCol = -1
      this.hoverRow = -1
    })
    this.interact.on('pointertap', (e) => {
      const p = this.view.toLocal(e.global)
      // S4: if a request packet is right under the tap (and the tile is empty of a
      // tower / no build tool), open the RequestInspector for it. Tower/tile taps
      // still win when a server occupies that tile.
      const req = this.pickRequest(p.x, p.y)
      const { col, row } = worldToTile(p.x, p.y)
      const onTower =
        col >= 0 &&
        row >= 0 &&
        !!this.lastState?.towers.some((t) => t.col === col && t.row === row)
      if (req != null && !onTower) {
        this.onRequestTap(req)
        return
      }
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) this.onTileTap(col, row)
    })
  }

  /** Nearest alive request within a small radius of (x,y), or null. */
  private pickRequest(x: number, y: number): number | null {
    if (!this.lastState) return null
    let best: number | null = null
    let bd = (REQ_SIZE * 0.8) ** 2
    for (const r of this.lastState.requests) {
      if (!r.alive) continue
      const dx = r.x - x
      const dy = r.y - y
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = r.id
      }
    }
    return best
  }

  sync(s: GameState, wv: WorldView, dt: number): void {
    this.lastState = s
    this.syncTowers(s)
    this.syncRequests(s)
    this.drawOverlays(s, wv)
    this.drawRouting(s)
    this.drawBars(s, wv.selectedRequestId ?? null)
    this.drawTelemetry(s)
    this.drawHint(s, wv)
    this.updateCore(s, dt)
  }

  /**
   * Expert Mode rack telemetry: a live load bar under each server and a
   * roofline-bottleneck tag in its corner (compute-bound / bandwidth-bound /
   * model does not fit VRAM). Display-only — reads the same sim the Normal
   * Mode player runs.
   */
  private drawTelemetry(s: GameState): void {
    const g = this.teleG
    g.clear()
    const expert = isExpert()
    const seen = new Set<number>()
    if (expert) {
      for (const tw of s.towers) {
        if (tw.def.kind !== 'server') continue
        seen.add(tw.id)
        let tag = this.tagSprites.get(tw.id)
        if (!tag) {
          tag = new Text({
            text: '',
            style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10, fontWeight: 'bold' },
          })
          tag.resolution = 2
          tag.anchor.set(1, 0)
          this.tagHost.addChild(tag)
          this.tagSprites.set(tw.id, tag)
        }
        const lo = loadoutOf(s, tw)
        const fits = serverFitsMemory(s, lo)
        const cc = serverComputeCeiling(s, lo)
        const bc = serverBandwidthCeiling(s, lo)
        const computeBound = cc <= bc
        tag.text = tw.training
          ? t('world.tagTraining')
          : !fits
            ? t('world.tagNoFit')
            : computeBound
              ? t('world.tagCompute')
              : t('world.tagBandwidth')
        tag.style.fill = tw.training
          ? COLORS.data
          : !fits
            ? COLORS.danger
            : computeBound
              ? COLORS.power
              : COLORS.cooling
        tag.x = tw.x + TILE / 2 - 3
        tag.y = tw.y - TILE / 2 + 2
        // live batch-slot load while serving
        if (s.phase === 'wave' && tw.online) {
          const w = TILE - 12
          const x = tw.x - w / 2
          const y = tw.y + TILE / 2 - 7
          g.rect(x, y, w, 3).fill({ color: 0x0a0e14, alpha: 0.85 })
          if (tw.load > 0) {
            g.rect(x, y, w * tw.load, 3).fill({
              color: tw.load >= 1 ? COLORS.warn : COLORS.good,
              alpha: 0.95,
            })
          }
        }
      }
    }
    for (const [id, tag] of this.tagSprites) {
      if (!expert || !seen.has(id)) {
        tag.destroy()
        this.tagSprites.delete(id)
      }
    }
  }

  /** Routing lines: each routed request is steered toward its best-matching server. */
  private drawRouting(s: GameState): void {
    const g = this.routeG
    g.clear()
    if (s.routingPower <= 0) return
    const servers = s.towers.filter((t) => t.def.kind === 'server' && t.online && !t.training)
    if (!servers.length) return
    const maxD2 = (6 * TILE) ** 2
    for (const r of s.requests) {
      if (!r.alive || !r.routed || r.work <= 0) continue
      let best: { x: number; y: number } | null = null
      let bd = maxD2
      for (const t of servers) {
        if (serverSpec(loadoutOf(s, t)) !== r.def.primaryAxis) continue
        const dx = t.x - r.x
        const dy = t.y - r.y
        const d = dx * dx + dy * dy
        if (d < bd) {
          bd = d
          best = t
        }
      }
      if (!best) continue
      g.moveTo(r.x, r.y).lineTo(best.x, best.y).stroke({ width: 1, color: r.def.color, alpha: 0.3 })
      g.circle(best.x, best.y, 3).stroke({ width: 1, color: r.def.color, alpha: 0.45 })
      // a packet flowing from request toward its assigned server
      const f = (s.time * 1.6 + (r.id % 11) / 11) % 1
      g.circle(r.x + (best.x - r.x) * f, r.y + (best.y - r.y) * f, 2).fill({
        color: r.def.color,
        alpha: 0.85,
      })
    }
  }

  private syncTowers(s: GameState): void {
    const seen = new Set<number>()
    for (const t of s.towers) {
      seen.add(t.id)
      let sp = this.towerSprites.get(t.id)
      if (sp && t.def.kind === 'server' && t.hwId && this.towerHw.get(t.id) !== t.hwId) {
        // rack tier upgraded in place — re-bake the sprite
        sp.destroy()
        this.towerSprites.delete(t.id)
        sp = undefined
      }
      if (!sp) {
        sp = new Sprite(this.factory.tower(t.def, t.hwId))
        sp.anchor.set(0.5)
        sp.width = TOWER_SIZE
        sp.height = TOWER_SIZE
        sp.x = t.x
        sp.y = t.y
        this.towerHost.addChild(sp)
        this.towerSprites.set(t.id, sp)
        if (t.hwId) this.towerHw.set(t.id, t.hwId)
      }
      // muzzle pop
      const pop = t.muzzle > 0 ? 1 + t.muzzle * 0.6 : 1
      sp.width = TOWER_SIZE * pop
      sp.height = TOWER_SIZE * pop
      if (!t.online) sp.tint = 0x55607a
      else if (t.training) sp.tint = 0xc792ea // requisitioned for a training run
      else if (t.def.kind === 'server' && t.throttle < 1) sp.tint = 0xff9a7a
      else sp.tint = 0xffffff
      sp.alpha = t.online ? 1 : 0.7
    }
    for (const [id, sp] of this.towerSprites) {
      if (!seen.has(id)) {
        sp.destroy()
        this.towerSprites.delete(id)
        this.towerHw.delete(id)
      }
    }
  }

  private syncRequests(s: GameState): void {
    const seen = new Set<number>()
    for (const r of s.requests) {
      if (!r.alive) continue
      seen.add(r.id)
      let sp = this.requestSprites.get(r.id)
      if (!sp) {
        sp = new Sprite(this.factory.request(r.def))
        sp.anchor.set(0.5)
        sp.width = REQ_SIZE
        sp.height = REQ_SIZE
        this.requestHost.addChild(sp)
        this.requestSprites.set(r.id, sp)
      }
      sp.x = r.x
      sp.y = r.y
      if (r.cacheFlash > 0) sp.tint = COLORS.cooling
      else if (r.hitFlash > 0) sp.tint = 0xffffff
      else sp.tint = 0xffffff
      const scale = r.hitFlash > 0 ? 1.12 : 1
      sp.width = REQ_SIZE * scale
      sp.height = REQ_SIZE * scale
    }
    for (const [id, sp] of this.requestSprites) {
      if (!seen.has(id)) {
        sp.destroy()
        this.requestSprites.delete(id)
      }
    }
  }

  private drawBars(s: GameState, selectedRequestId: number | null): void {
    const g = this.barsG
    g.clear()
    for (const r of s.requests) {
      if (!r.alive) continue
      const w = REQ_SIZE - 4
      const x = r.x - w / 2
      const y = r.y - REQ_SIZE / 2 - 6
      const frac = Math.max(0, Math.min(1, r.work / r.maxWork))
      g.rect(x, y, w, 3).fill({ color: 0x0a0e14, alpha: 0.8 })
      g.rect(x, y, w * frac, 3).fill({ color: r.def.color })
      // uncleared safety risk: red danger ring
      if (r.safetyRisk > 0 && !r.safetyCleared) {
        g.circle(r.x, r.y, REQ_SIZE / 2 + 2).stroke({ width: 1.5, color: COLORS.danger, alpha: 0.9 })
      }
      // routed tag
      if (r.routed) {
        g.rect(r.x + REQ_SIZE / 2 - 3, y - 3, 4, 4).fill({ color: COLORS.power, alpha: 0.9 })
      }
      // S4 selection ring
      if (selectedRequestId === r.id) {
        g.circle(r.x, r.y, REQ_SIZE / 2 + 4).stroke({ width: 2, color: COLORS.sla, alpha: 0.95 })
      }
    }
  }

  private drawOverlays(s: GameState, wv: WorldView): void {
    const g = this.overlayG
    g.clear()
    // faint aura rings for support buildings (cache/router buff servers in range)
    for (const t of s.towers) {
      if (!t.online) continue
      if (t.def.kind === 'cache' || t.def.kind === 'router') {
        g.circle(t.x, t.y, t.def.range * TILE).stroke({ width: 1, color: t.def.color, alpha: 0.16 })
      }
    }
    for (const t of s.towers) {
      if (!t.online) {
        // offline X
        const d = TOWER_SIZE / 2 - 4
        g.moveTo(t.x - d, t.y - d)
          .lineTo(t.x + d, t.y + d)
          .stroke({ width: 2, color: COLORS.danger, alpha: 0.8 })
        g.moveTo(t.x + d, t.y - d)
          .lineTo(t.x - d, t.y + d)
          .stroke({ width: 2, color: COLORS.danger, alpha: 0.8 })
      }
    }
    if (wv.selectedId != null) {
      const t = s.towers.find((x) => x.id === wv.selectedId)
      if (t) {
        g.rect(t.x - TILE / 2, t.y - TILE / 2, TILE, TILE).stroke({ width: 2, color: COLORS.sla, alpha: 0.9 })
        if (t.def.range > 0) {
          g.circle(t.x, t.y, t.def.range * TILE).fill({ color: COLORS.sla, alpha: 0.06 })
          g.circle(t.x, t.y, t.def.range * TILE).stroke({ width: 1.5, color: COLORS.sla, alpha: 0.4 })
        }
      }
    }
  }

  private drawHint(s: GameState, wv: WorldView): void {
    const g = this.hint
    g.clear()
    if (!wv.buildDef) return
    const { hoverCol: c, hoverRow: r } = this
    if (c < 0 || r < 0 || c >= GRID_COLS || r >= GRID_ROWS) return
    const occupied = s.towers.some((t) => t.col === c && t.row === r)
    const ok = isBuildable(c, r) && !occupied && wv.canAfford
    const x = GRID_X + c * TILE
    const y = GRID_Y + r * TILE
    const col = ok ? COLORS.good : COLORS.danger
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill({ color: col, alpha: 0.16 })
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).stroke({ width: 1.5, color: col, alpha: 0.8 })
    if (wv.buildDef.range > 0) {
      const ctr = tileCenter(c, r)
      g.circle(ctr.x, ctr.y, wv.buildDef.range * TILE).stroke({ width: 1, color: col, alpha: 0.4 })
    }
  }

  private updateCore(s: GameState, _dt: number): void {
    const g = this.coreGlow
    g.clear()
    const trust = s.meters.trust / 100
    const col = trust > 0.5 ? COLORS.core : trust > 0.25 ? COLORS.warn : COLORS.danger
    const pulse = prefersReducedMotion() ? 1 : 1 + Math.sin(s.time * 4) * 0.12
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.9 * pulse).fill({ color: col, alpha: 0.12 })
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.6 * pulse).fill({ color: col, alpha: 0.12 })
    this.coreSprite.tint = col
  }
}
