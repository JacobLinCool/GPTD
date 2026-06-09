import { Container, Graphics, Sprite } from 'pixi.js'
import { COLORS, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { GameState, TowerDef } from '../core/types'
import { CORE_POS, WAYPOINTS, isBuildable, isPathTile, tileCenter, worldToTile } from '../sim/pathing'
import type { FxManager } from './fx'
import { TextureFactory } from './textures'

const TOWER_SIZE = 40
const REQ_SIZE = 24

export interface WorldView {
  selectedId: number | null
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
  private coreGlow = new Graphics()
  private coreSprite: Sprite
  private interact = new Graphics()

  private towerSprites = new Map<number, Sprite>()
  private requestSprites = new Map<number, Sprite>()
  hoverCol = -1
  hoverRow = -1
  onTileTap: (col: number, row: number) => void = () => {}

  constructor(
    private factory: TextureFactory,
    fx: FxManager,
  ) {
    this.view.addChild(
      this.bg,
      this.lane,
      this.coreGlow,
      this.hint,
      this.rangeG,
      this.towerHost,
      this.overlayG,
      this.routeG,
      this.requestHost,
      this.barsG,
      fx.view,
      this.interact,
    )
    this.coreSprite = new Sprite(this.factory.core())
    this.coreSprite.anchor.set(0.5)
    this.coreSprite.width = TILE * 1.3
    this.coreSprite.height = TILE * 1.3
    this.coreSprite.x = CORE_POS.x
    this.coreSprite.y = CORE_POS.y
    this.view.addChild(this.coreSprite)

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
    // lane conduit
    const l = this.lane
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const a = WAYPOINTS[i]
      const b = WAYPOINTS[i + 1]
      l.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: TILE - 6, color: COLORS.laneFloor })
    }
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const a = WAYPOINTS[i]
      const b = WAYPOINTS[i + 1]
      l.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: TILE - 6, color: COLORS.laneEdge, alpha: 0.5 })
      l.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4, color: COLORS.laneGlow, alpha: 0.5 })
    }
    // ingress marker
    const start = WAYPOINTS[0]
    l.circle(start.x + TILE, start.y, 5).fill({ color: COLORS.laneGlow, alpha: 0.8 })
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
      const { col, row } = worldToTile(p.x, p.y)
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) this.onTileTap(col, row)
    })
  }

  sync(s: GameState, wv: WorldView, dt: number): void {
    this.syncTowers(s)
    this.syncRequests(s)
    this.drawOverlays(s, wv)
    this.drawRouting(s)
    this.drawBars(s)
    this.drawHint(s, wv)
    this.updateCore(s, dt)
  }

  /** Routing lines: each routed request is steered toward its best-matching server. */
  private drawRouting(s: GameState): void {
    const g = this.routeG
    g.clear()
    if (s.routingPower <= 0) return
    const servers = s.towers.filter((t) => t.def.kind === 'server' && t.online)
    if (!servers.length) return
    const maxD2 = (6 * TILE) ** 2
    for (const r of s.requests) {
      if (!r.alive || !r.routed || r.work <= 0) continue
      let best: { x: number; y: number } | null = null
      let bd = maxD2
      for (const t of servers) {
        if (t.def.spec !== r.def.affinity) continue
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
      if (!sp) {
        sp = new Sprite(this.factory.tower(t.def))
        sp.anchor.set(0.5)
        sp.width = TOWER_SIZE
        sp.height = TOWER_SIZE
        sp.x = t.x
        sp.y = t.y
        this.towerHost.addChild(sp)
        this.towerSprites.set(t.id, sp)
      }
      // muzzle pop
      const pop = t.muzzle > 0 ? 1 + t.muzzle * 0.6 : 1
      sp.width = TOWER_SIZE * pop
      sp.height = TOWER_SIZE * pop
      if (!t.online) sp.tint = 0x55607a
      else if (t.def.kind === 'server' && t.throttle < 1) sp.tint = 0xff9a7a
      else sp.tint = 0xffffff
      sp.alpha = t.online ? 1 : 0.7
    }
    for (const [id, sp] of this.towerSprites) {
      if (!seen.has(id)) {
        sp.destroy()
        this.towerSprites.delete(id)
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

  private drawBars(s: GameState): void {
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
    const pulse = 1 + Math.sin(s.time * 4) * 0.12
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.9 * pulse).fill({ color: col, alpha: 0.12 })
    g.circle(CORE_POS.x, CORE_POS.y, TILE * 0.6 * pulse).fill({ color: col, alpha: 0.12 })
    this.coreSprite.tint = col
  }
}
