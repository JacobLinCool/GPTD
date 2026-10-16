import { BitmapText, Container, Graphics, Rectangle, Sprite } from 'pixi.js'
import { COLORS, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { GameEvent, GameState, Request, TowerDef } from '../core/types'
import { onLangChange, t, waveName } from '../i18n'
import { outcomeColor } from '../outcomes'
import { CAMPAIGN_THEMES } from '../sim/campaign-data'
import { HARDWARE_DEFS, WAVES } from '../sim/content'
import { defLoadout, serverPower, towerRangeTiles } from '../sim/effects'
import { CORE_POS, LANE_PATHS, isBuildable, posAt, tileCenter, worldToTile } from '../sim/pathing'
import { clamp01, fxLevel, reducedMotion } from './anim'
import { BannerLayer } from './banners'
import { CoreView } from './core'
import { FxManager } from './fx'
import { LaneLayer } from './lanes'
import { POP_FONT, fmtCredits } from './popups'
import { RackLayer } from './racks'
import { RequestLayer } from './requests'
import { StreamLayer } from './streams'
import { REQ_PX, type TextureFactory } from './textures'

export interface WorldView {
  selectedId: number | null
  /** the request packet selected for the RequestInspector (both modes). */
  selectedRequestId?: number | null
  buildDef: TowerDef | null
  canAfford: boolean
}

/** Per-frame timing from the game loop. */
export interface FrameInfo {
  /** fraction of a sim step left in the accumulator (0..1) — drives interpolation */
  alpha: number
  /** current speed multiplier */
  speed: number
  /** the sim is stepping this frame (not paused / in a modal / between waves) */
  running: boolean
}

type OutcomeEvent = Extract<GameEvent, { type: 'outcome' }>

/** Lane sample points every 8 px (shared tails deduplicated) for placement coverage previews. */
const LANE_SAMPLES: { x: number; y: number }[] = (() => {
  const seen = new Set<string>()
  const out: { x: number; y: number }[] = []
  for (const lane of LANE_PATHS) {
    for (let d = 0; d <= lane.length; d += 8) {
      const p = posAt(d, lane.id)
      const k = `${Math.round(p.x)},${Math.round(p.y)}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  }
  return out
})()

const stripBoss = (name: string): string => name.replace(/^\s*(BOSS|頭目)\s*[:：]\s*/i, '')

/**
 * The board renderer. Owns the layered scene (floor, lanes, core, racks, requests,
 * FX, banners) and is the single entry point for sim events (`onEvent`) and per-frame
 * state (`sync`). Every visual reads the sim; nothing here owns a game rule.
 */
export class WorldRenderer {
  /** the board + the unshaken overlays (banners, vignette) */
  readonly view = new Container()
  /** screen-space effects that fly up to the HUD (add ABOVE the HUD) */
  readonly screen: Container
  readonly fx: FxManager
  private board = new Container()
  private lanes: LaneLayer
  private core: CoreView
  private racks: RackLayer
  private requests: RequestLayer
  private streams: StreamLayer
  private banners = new BannerLayer()
  private auraG = new Graphics()
  private hintG = new Graphics()
  private ghost = new Sprite()
  private hintText: BitmapText
  private overlayG = new Graphics()
  private dipG = new Graphics()
  /** pointer hit area over the grid (a hitArea, not a drawn quad: no full-board fill cost) */
  private interact = new Container()

  hoverCol = -1
  hoverRow = -1
  private hoverX = -1
  private hoverY = -1
  onTileTap: (col: number, row: number) => void = () => {}
  /** S4: report the nearest request packet to a tap (when no build tool is active). */
  onRequestTap: (id: number) => void = () => {}
  private lastState: GameState | null = null
  private speed = 1
  private clock = 0
  private rangesOn = false
  private rangeHold = false
  private auraKey = ''
  private hintKey = ''
  private cursor = ''
  private selT = 0
  private selId: number | null = null
  private dipT = -1

  constructor(private factory: TextureFactory) {
    this.fx = new FxManager(factory)
    this.screen = this.fx.screen
    this.lanes = new LaneLayer(factory, this.fx)
    this.core = new CoreView(factory, this.fx)
    this.racks = new RackLayer(factory, this.fx)
    this.requests = new RequestLayer(factory)
    this.streams = new StreamLayer(this.fx)
    this.requests.onSpawn = (lane) => this.lanes.spawned(lane)
    this.hintText = new BitmapText({ text: '', style: { fontFamily: POP_FONT, fontSize: 10 } })
    this.hintText.anchor.set(0.5, 1)
    this.ghost.anchor.set(0.5)
    this.ghost.visible = false
    this.dipG
      .rect(GRID_X - 8, GRID_Y - 8, GRID_COLS * TILE + 16, GRID_ROWS * TILE + 16)
      .fill({ color: 0x000000 })
    this.dipG.visible = false
    this.dipG.eventMode = 'none'
    for (const g of [this.auraG, this.hintG, this.overlayG]) g.eventMode = 'none'
    this.board.addChild(
      this.lanes.floor,
      this.lanes.view,
      this.core.view,
      this.auraG,
      this.hintG,
      this.racks.view,
      this.ghost,
      this.overlayG,
      this.requests.view,
      this.fx.view,
      this.hintText,
      this.dipG,
      this.interact,
    )
    this.view.addChild(this.board, this.core.edge, this.banners.view)
    this.setupInteraction()
    onLangChange(() => {
      this.racks.refreshLanguage()
      this.lanes.refreshLanguage()
      this.hintKey = ''
    })
  }

  // ---- controls the UI shell binds (range key, next-wave preview) ----

  /** Toggle every coverage ring, racks included (the range key). */
  toggleRanges(): boolean {
    this.rangesOn = !this.rangesOn
    return this.rangesOn
  }
  /** Show coverage rings while a modifier key is held. */
  setRangeHold(held: boolean): void {
    this.rangeHold = held
  }
  get rangesVisible(): boolean {
    return this.rangesOn || this.rangeHold
  }
  /** Highlight the upcoming wave's ingress lanes during the build phase (null = none). */
  setIngressPreview(lanes: number[] | null): void {
    this.lanes.setPreview(lanes)
  }

  /** Live object counts (perf overlay). */
  stats(): { requests: number; towers: number; particles: number; popups: number; stamps: number } {
    return {
      requests: this.requests.liveCount,
      towers: this.lastState?.towers.length ?? 0,
      ...this.fx.stats(),
    }
  }

  private setupInteraction(): void {
    this.interact.hitArea = new Rectangle(GRID_X, GRID_Y, GRID_COLS * TILE, GRID_ROWS * TILE)
    this.interact.eventMode = 'static'
    this.interact.cursor = 'default'
    this.interact.on('pointermove', (e) => {
      const p = this.board.toLocal(e.global)
      const { col, row } = worldToTile(p.x, p.y)
      this.hoverCol = col
      this.hoverRow = row
      this.hoverX = p.x
      this.hoverY = p.y
    })
    this.interact.on('pointerout', () => {
      this.hoverCol = -1
      this.hoverRow = -1
      this.hoverX = -1
      this.hoverY = -1
    })
    this.interact.on('pointertap', (e) => {
      const p = this.board.toLocal(e.global)
      // a packet right under the tap opens the RequestInspector, unless a tower
      // occupies that tile (tower / tile taps win there).
      const req = this.requests.pick(p.x, p.y, REQ_PX * 0.8)
      const { col, row } = worldToTile(p.x, p.y)
      const onTower =
        col >= 0 && row >= 0 && !!this.lastState?.towers.some((tw) => tw.col === col && tw.row === row)
      if (req != null && !onTower) {
        this.onRequestTap(req)
        return
      }
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) this.onTileTap(col, row)
    })
  }

  /** Drop every cached sprite and effect (a new run / a swapped GameState). */
  reset(): void {
    this.racks.reset()
    this.requests.reset()
    this.streams.reset()
    this.lanes.reset()
    this.core.reset()
    this.fx.clear()
    this.banners.clear()
    this.auraKey = ''
    this.hintKey = ''
    this.dipT = -1
    this.dipG.visible = false
  }

  sync(
    s: GameState,
    wv: WorldView,
    dt: number,
    frame: FrameInfo = { alpha: 1, speed: 1, running: s.phase === 'wave' },
  ): void {
    // a different GameState object (restart / demo / agent) → never reuse the old sprites
    if (s !== this.lastState) {
      if (this.lastState) this.reset()
      this.lastState = s
    }
    this.clock += dt
    this.speed = frame.speed
    this.fx.setSpeed(frame.speed)
    // who is being worked this tick (breathing, bar LOD)
    const active = new Set<number>()
    if (frame.running) {
      for (const tw of s.towers) {
        if (tw.def.kind !== 'server' || !tw.online) continue
        if (tw.prefillId != null) active.add(tw.prefillId)
        for (const id of tw.decodeIds ?? []) active.add(id)
      }
    }
    const hoverTower = this.hoverTower(s)
    this.lanes.sync(s, dt, frame.speed)
    this.core.sync(s, dt)
    this.racks.sync(s, dt, hoverTower, wv.selectedId)
    this.requests.sync(
      s,
      dt,
      frame.running ? frame.alpha : 1,
      frame.speed,
      active,
      wv.selectedRequestId ?? null,
    )
    if (frame.running) {
      const byId = new Map<number, Request>()
      for (const r of s.requests) byId.set(r.id, r)
      this.streams.sync(s, dt, frame.speed, (id) => this.requests.posOf(id), byId)
    }
    this.fx.crowd = s.requests.length
    this.drawAuras(s, wv, hoverTower)
    this.drawHint(s, wv)
    this.drawOverlay(s, wv, hoverTower, dt)
    this.updateCursor(wv, hoverTower)
    this.updateDip(dt)
    this.fx.update(dt)
    this.banners.update(dt)
    // board shake (the HUD and banners stay still)
    const sh = this.core.shake
    this.board.position.set(
      sh > 0 ? Math.round((Math.random() * 2 - 1) * sh) : 0,
      sh > 0 ? Math.round((Math.random() * 2 - 1) * sh) : 0,
    )
  }

  // ---------------------------------------------------------------- events

  /** Route one sim event to its board effect. */
  onEvent(ev: GameEvent, s: GameState): void {
    switch (ev.type) {
      case 'outcome':
        this.outcome(ev)
        break
      case 'guard':
        this.guard(ev, s)
        break
      case 'selfHandle':
        this.selfHandle(ev, s)
        break
      case 'cache':
        this.cacheHit(ev, s)
        break
      case 'sell':
        if (ev.refund !== undefined && ev.refund > 0)
          this.fx.popup(
            t('fx.refund', { v: fmtCredits(ev.refund) }),
            COLORS.cash,
            ev.x,
            ev.y - 14,
            'refund',
            'coin',
          )
        break
      case 'brownout':
        if (ev.on !== false) this.dip()
        break
      case 'wave-start':
        this.waveStart(ev.index, s, ev.boss, ev.surgeLane)
        break
      case 'wave-clear':
        this.waveClear(ev.index, s, ev.goodputPct)
        break
      case 'research-done':
      case 'posttrain-done':
        for (const tw of s.towers)
          if (tw.def.kind === 'lab') this.fx.burst(tw.x, tw.y - 8, COLORS.data, 12, 50, 'dot', 0.9, -60)
        break
      case 'win':
        this.core.sparkle(true)
        break
      case 'lose':
        this.core.shatter()
        break
    }
  }

  /**
   * One outcome = one cause-coded effect at the request: the popup names what the
   * report will count, the glyph carries it without colour, chips fly to the meter
   * it moved, and core-side losses hit the Trust Core.
   */
  private outcome(ev: OutcomeEvent): void {
    const pos = this.requests.posOf(ev.requestId) ?? { x: ev.x, y: ev.y }
    const { x, y } = pos
    this.requests.noteDeath(ev.requestId, ev.outcome)
    if (ev.towerId != null) this.racks.kick(ev.towerId)
    const col = outcomeColor(ev.outcome)
    const label = t(`fx.${ev.outcome}`)
    const atCore = Math.hypot(x - CORE_POS.x, y - CORE_POS.y) < TILE * 1.2
    if (ev.dTrust < 0) this.fx.chip('trust', x, y)
    if (ev.dSla < 0) this.fx.chip('sla', x, y)
    switch (ev.outcome) {
      case 'served': {
        if (ev.cash > 0) {
          this.fx.cash(ev.cash, x, y)
          this.fx.chip('cash', x, y)
          this.fx.burst(x, y, COLORS.cash, 4, 60, 'sq2', 0.45)
          if (this.fx.budget(1) > 0) this.fx.stamp('check', x, y - 10, col, { scale: 1, life: 0.45, rise: 8 })
        }
        break
      }
      case 'sloMiss': {
        const cause = ev.cause ? t(`fx.cause.${ev.cause}`) : ''
        this.fx.stamp('clock', x, y - 6, col, { scale: 2, life: 0.7 })
        this.fx.popup(
          cause ? t('fx.withCause', { label, cause }) : label,
          col,
          x,
          y - 18,
          'sloMiss:' + (ev.cause ?? ''),
        )
        this.fx.burst(x, y + 4, col, 4, 30, 'sq2', 0.5, 120)
        break
      }
      case 'bad': {
        const axis = ev.axis ? t(`spec.${ev.axis}`) : ''
        this.fx.stamp('cross', x, y - 6, col, { scale: 2, life: 0.7 })
        this.fx.popup(
          axis ? t('fx.withCause', { label, cause: axis }) : label,
          col,
          x,
          y - 18,
          'bad:' + (ev.axis ?? ''),
        )
        this.fx.burst(x, y, 0x8a94a3, 7, 70, 'shard', 0.55)
        break
      }
      case 'unsafe': {
        this.fx.stamp('hazard', x, y - 4, col, { scale: 3, life: 0.85, slam: true, rise: 4 })
        this.fx.glow(x, y, col, 44, 0.4)
        this.fx.ring(x, y, 8, 46, col, 0.45, 2)
        this.fx.popup(label, col, x, y - 22, 'unsafe', undefined, true)
        this.fx.burst(x, y, col, 10, 110, 'shard', 0.6)
        if (!atCore) {
          // a red shard streaks from the delivering rack into the Trust Core
          const dx = CORE_POS.x - x
          const dy = CORE_POS.y - y
          this.fx.particles.spawn(this.fx.frame('shard'), x, y, {
            vx: dx / 0.4,
            vy: dy / 0.4,
            life: 0.4,
            s0: 2,
            s1: 2,
            tint: col,
          })
        }
        this.core.hit(ev.dTrust, true)
        break
      }
      case 'overRefused': {
        const who = ev.refusedBy ? t(`fx.by.${ev.refusedBy}`) : ''
        this.fx.stamp('noentry', x, y - 6, col, { scale: 2, life: 0.7, slam: true })
        this.fx.popup(
          who ? t('fx.withCause', { label, cause: who }) : label,
          col,
          x,
          y - 18,
          'refused:' + (ev.refusedBy ?? ''),
        )
        break
      }
      case 'unservable': {
        this.fx.stamp('overflow', x, y - 6, col, { scale: 2, life: 0.75 })
        this.fx.popup(label, col, x, y - 18, 'unservable')
        this.fx.burst(x, y, col, 8, 40, 'dot', 0.6, -10)
        if (atCore) this.core.hit(ev.dTrust, false)
        break
      }
      case 'leaked': {
        this.fx.stamp('drop', x, y - 8, col, { scale: 2, life: 0.75 })
        this.fx.popup(label, col, x, y - 20, 'leaked')
        this.core.hit(ev.dTrust, false)
        break
      }
    }
  }

  /** Layer 2: a guardrail screened a request — a scan beam, then a catch or a wrongful block. */
  private guard(ev: Extract<GameEvent, { type: 'guard' }>, s: GameState): void {
    const g = s.towers.find((tw) => tw.id === ev.towerId)
    const p = this.requests.posOf(ev.requestId) ?? { x: ev.x, y: ev.y }
    if (ev.result === 'caught') {
      this.racks.flash(ev.towerId, 0x7cf2c8)
      if (g) this.fx.line(g.x, g.y, p.x, p.y, 0x7fe8ff, 0.18, 0.9)
      this.fx.stamp('shield', p.x, p.y - 4, COLORS.good, { scale: 2, life: 0.6 })
      this.fx.shatter(p.x, p.y, REQ_PX / 2 + 2, COLORS.good, 8)
      this.fx.popup(t('fx.blocked'), COLORS.good, p.x, p.y - 18, 'blocked', 'shield')
    } else {
      const col = outcomeColor('overRefused')
      this.racks.flash(ev.towerId, col)
      if (g) this.fx.line(g.x, g.y, p.x, p.y, col, 0.18, 0.8)
    }
  }

  /** Layer 1: the serving model's own alignment cleared a hazard. */
  private selfHandle(ev: Extract<GameEvent, { type: 'selfHandle' }>, s: GameState): void {
    const rack = s.towers.find((tw) => tw.id === ev.towerId)
    const p = this.requests.posOf(ev.requestId) ?? { x: ev.x, y: ev.y }
    this.fx.shatter(p.x, p.y, REQ_PX / 2 + 2, COLORS.good, 6)
    if (rack) {
      this.fx.stamp('shield', rack.x, rack.y - 22, COLORS.sla, { scale: 1, life: 0.7, rise: 12 })
      this.fx.popup(t('fx.selfSafe'), COLORS.sla, rack.x, rack.y - 30, 'selfSafe')
    }
  }

  private cacheHit(ev: Extract<GameEvent, { type: 'cache' }>, s: GameState): void {
    const p = (ev.requestId != null ? this.requests.posOf(ev.requestId) : null) ?? { x: ev.x, y: ev.y }
    this.fx.burst(p.x, p.y, COLORS.cooling, 4, 60, 'spark', 0.45, 0)
    if (this.speed < 6) this.fx.popup(t('fx.cacheHit'), COLORS.cooling, p.x, p.y - 16, 'cache')
    // the cache that holds the prefix spins its disks
    let best = -1
    let bd = Infinity
    for (const tw of s.towers) {
      if (tw.def.kind !== 'cache' || !tw.online) continue
      const d = (tw.x - p.x) ** 2 + (tw.y - p.y) ** 2
      if (d < bd && d <= (towerRangeTiles(tw) * TILE) ** 2) {
        bd = d
        best = tw.id
      }
    }
    if (best >= 0) this.racks.flash(best, COLORS.cooling)
  }

  private waveStart(
    index: number,
    s: GameState,
    boss: boolean | undefined,
    surgeLane: number | undefined,
  ): void {
    const theme = CAMPAIGN_THEMES[index]
    const w = s.currentWave ?? WAVES[index]
    const isBoss = boss ?? theme?.boss ?? false
    const name = w ? stripBoss(waveName(w, index)) : ''
    this.lanes.waveStart(s, surgeLane)
    this.banners.show(
      {
        title: name ? `${t('fx.wave', { n: index + 1 })} · ${name}` : t('fx.wave', { n: index + 1 }),
        chip: theme?.era,
        stamp: isBoss ? t('fx.boss') : undefined,
        accent: isBoss ? COLORS.danger : COLORS.laneGlow,
      },
      this.speed,
    )
  }

  private waveClear(index: number, s: GameState, goodputPct: number | undefined): void {
    this.lanes.waveClear()
    this.core.sparkle(false)
    const bonus = s.lastReport?.clearBonus ?? 0
    const gp = goodputPct ?? s.lastReport?.goodputPct
    const tail = gp !== undefined ? ` · ${t('fx.goodput', { v: Math.round(gp) })}` : ''
    this.banners.show(
      {
        title: t('fx.waveClear', { n: index + 1 }),
        accent: COLORS.good,
        countTo: bonus,
        fmtSub: (v) => t('fx.clearBonus', { v: fmtCredits(v) }) + tail,
      },
      this.speed,
    )
    // every 10th wave: a small confetti burst over the board
    if ((index + 1) % 10 === 0 && fxLevel() !== 'minimal') {
      const palette = [COLORS.cash, COLORS.trust, COLORS.sla, COLORS.data, COLORS.warn]
      for (let i = 0; i < 5; i++)
        this.fx.burst(
          GRID_X + (GRID_COLS * TILE * (i + 0.5)) / 5,
          GRID_Y + 20,
          palette[i],
          10,
          90,
          'sq2',
          1.2,
          160,
        )
    }
  }

  /** Brownout: two quick dark flickers over the board (through the flash limiter). */
  private dip(): void {
    this.dipT = this.core.limiter.allow(this.clock) ? 0 : 0.2
  }

  private updateDip(dt: number): void {
    if (this.dipT < 0) return
    this.dipT += dt
    const k = this.dipT
    this.dipG.alpha = k < 0.07 ? 0.38 : k < 0.12 ? 0.05 : k < 0.2 ? 0.3 : Math.max(0, 0.3 - (k - 0.2) * 1.5)
    this.dipG.visible = true
    if (k > 0.4) {
      this.dipT = -1
      this.dipG.visible = false
    }
  }

  // ---------------------------------------------------------------- overlays

  private hoverTower(s: GameState): number | null {
    if (this.hoverCol < 0) return null
    return s.towers.find((tw) => tw.col === this.hoverCol && tw.row === this.hoverRow)?.id ?? null
  }

  /**
   * Coverage rings: hidden by default (no "circle soup"). A support building's ring
   * shows on hover / selection or while placing a related building; the range key
   * (toggle, or hold Alt) shows every ring at once, the racks' serving reach included.
   * Rebuilt only when the visible set changes.
   */
  private drawAuras(s: GameState, wv: WorldView, hoverId: number | null): void {
    const all = this.rangesOn || this.rangeHold
    const planning = wv.buildDef
      ? ['cache', 'router', 'server', 'guardrail'].includes(wv.buildDef.kind)
      : false
    const ids: number[] = []
    for (const tw of s.towers) {
      if (tw.def.kind === 'server') {
        if (all) ids.push(tw.id)
        continue
      }
      if (tw.def.kind !== 'cache' && tw.def.kind !== 'router' && tw.def.kind !== 'guardrail') continue
      const related =
        planning &&
        (wv.buildDef!.kind === 'server' ? tw.def.kind !== 'guardrail' : tw.def.kind === wv.buildDef!.kind)
      if (all || related || tw.id === hoverId || tw.id === wv.selectedId) ids.push(tw.id)
    }
    // a ring's reach (hardware tier) and online state are part of the key: an upgraded rack redraws
    let key = ''
    for (const id of ids) {
      const tw = s.towers.find((x) => x.id === id)
      if (tw) key += `${id}:${towerRangeTiles(tw)}:${tw.online ? 1 : 0},`
    }
    key += '|' + (wv.selectedId ?? -1)
    if (key === this.auraKey) return
    this.auraKey = key
    const g = this.auraG
    g.clear()
    for (const id of ids) {
      const tw = s.towers.find((x) => x.id === id)
      if (!tw || tw.id === wv.selectedId) continue // the selection draws its own ring
      const r = towerRangeTiles(tw) * TILE
      g.circle(tw.x, tw.y, r).fill({ color: tw.def.color, alpha: 0.035 })
      g.circle(tw.x, tw.y, r).stroke({ width: 1, color: tw.def.color, alpha: tw.online ? 0.38 : 0.15 })
    }
  }

  /**
   * Placement preview: a ghost of the building, its range, the lane stretch it would
   * cover, the racks a cache/router would buff (or a warning that it buffs none), and
   * a rack's projected power. Rebuilt only when the hovered tile or tool changes.
   */
  private drawHint(s: GameState, wv: WorldView): void {
    const def = wv.buildDef
    const c = this.hoverCol
    const r = this.hoverRow
    const inGrid = c >= 0 && r >= 0 && c < GRID_COLS && r < GRID_ROWS
    if (!def || !inGrid) {
      if (this.hintKey !== '') {
        this.hintKey = ''
        this.hintG.clear()
        this.ghost.visible = false
        this.hintText.visible = false
      }
      return
    }
    const occupied = s.towers.some((tw) => tw.col === c && tw.row === r)
    const ok = isBuildable(c, r) && !occupied && wv.canAfford
    const key = `${def.id}|${c}|${r}|${ok}|${s.towers.length}|${s.power.used}|${s.power.cap}`
    if (key === this.hintKey) return
    this.hintKey = key
    const g = this.hintG
    g.clear()
    const x = GRID_X + c * TILE
    const y = GRID_Y + r * TILE
    const ctr = tileCenter(c, r)
    const col = ok ? COLORS.good : COLORS.danger
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill({ color: col, alpha: 0.14 })
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).stroke({ width: 1.5, color: col, alpha: 0.8 })
    this.ghost.texture = this.factory.tower(def, def.hardwareId)
    this.ghost.position.set(ctr.x, ctr.y)
    this.ghost.alpha = 0.55
    this.ghost.tint = ok ? 0xffffff : 0xff8a8a
    this.ghost.visible = true
    let note = ''
    let noteColor: number = COLORS.text
    const rangeT =
      def.kind === 'server' ? (HARDWARE_DEFS[def.hardwareId ?? '']?.range ?? def.range) : def.range
    if (rangeT > 0) {
      const R = rangeT * TILE
      g.circle(ctr.x, ctr.y, R).stroke({ width: 1, color: col, alpha: 0.45 })
      // the lane stretch this building would cover
      for (const p of LANE_SAMPLES) {
        if ((p.x - ctr.x) ** 2 + (p.y - ctr.y) ** 2 > R * R) continue
        g.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill({ color: COLORS.laneGlow, alpha: 0.7 })
      }
      if (def.kind === 'cache' || def.kind === 'router') {
        // a cache / router does nothing alone: link the racks it would buff
        let n = 0
        for (const tw of s.towers) {
          if (tw.def.kind !== 'server') continue
          if ((tw.x - ctr.x) ** 2 + (tw.y - ctr.y) ** 2 > R * R) continue
          n++
          const dx = tw.x - ctr.x
          const dy = tw.y - ctr.y
          const len = Math.hypot(dx, dy)
          for (let d = 6; d < len - 6; d += 8) {
            const k = d / len
            const k2 = Math.min(len - 6, d + 4) / len
            g.moveTo(ctr.x + dx * k, ctr.y + dy * k).lineTo(ctr.x + dx * k2, ctr.y + dy * k2)
          }
          g.stroke({ width: 1, color: def.color, alpha: 0.8 })
        }
        if (n === 0) {
          note = t('world.noRackInRange')
          noteColor = COLORS.warn
        }
      }
    }
    // projected power: the rack's real draw against the substation + plant capacity
    const add = def.kind === 'server' ? serverPower(s, defLoadout(def)) : (def.powerDraw ?? 0)
    if (add > 0 || def.kind === 'power') {
      const cap = s.power.cap + (def.power ?? 0)
      const used = s.power.used + add
      const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))
      const over = used > cap
      note = (note ? note + '  ' : '') + t('world.powerPreview', { used: fmt(used), cap: fmt(cap) })
      if (over) noteColor = COLORS.danger
      else if (noteColor === COLORS.text) noteColor = COLORS.good
    }
    this.hintText.visible = note !== ''
    if (note) {
      this.hintText.text = note
      this.hintText.tint = noteColor
      this.hintText.position.set(Math.round(ctr.x), Math.round(y - 3))
    }
  }

  /** Hover outline, animated selection brackets + range fade-in, the selected-request ring. */
  private drawOverlay(s: GameState, wv: WorldView, hoverId: number | null, dt: number): void {
    const g = this.overlayG
    g.clear()
    if (hoverId != null && hoverId !== wv.selectedId && !wv.buildDef) {
      const tw = s.towers.find((x) => x.id === hoverId)
      if (tw)
        g.rect(tw.x - TILE / 2 + 1, tw.y - TILE / 2 + 1, TILE - 2, TILE - 2).stroke({
          width: 1,
          color: COLORS.text,
          alpha: 0.5,
        })
    }
    if (wv.selectedId !== this.selId) {
      this.selId = wv.selectedId
      this.selT = 0
    }
    if (wv.selectedId != null) {
      const tw = s.towers.find((x) => x.id === wv.selectedId)
      if (tw) {
        this.selT += dt
        const calm = reducedMotion()
        const fade = calm ? 1 : clamp01(this.selT / 0.15)
        const pulse = calm ? 0 : Math.round((Math.sin(this.clock * 5) + 1) * 0.75)
        const h = TILE / 2 + 1 + pulse
        const L = 9
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const cx = tw.x + sx * h
          const cy = tw.y + sy * h
          g.moveTo(cx, cy - sy * L)
            .lineTo(cx, cy)
            .lineTo(cx - sx * L, cy)
        }
        g.stroke({ width: 2, color: COLORS.sla, alpha: 0.95 })
        const R = towerRangeTiles(tw) * TILE
        if (R > 0) {
          g.circle(tw.x, tw.y, R).fill({ color: COLORS.sla, alpha: 0.05 * fade })
          g.circle(tw.x, tw.y, R).stroke({ width: 1.5, color: COLORS.sla, alpha: 0.45 * fade })
        }
      }
    }
    const rid = wv.selectedRequestId
    if (rid != null) {
      const p = this.requests.posOf(rid)
      if (p) g.circle(p.x, p.y, REQ_PX / 2 + 4).stroke({ width: 2, color: COLORS.sla, alpha: 0.95 })
    }
  }

  private updateCursor(wv: WorldView, hoverId: number | null): void {
    let cur = 'default'
    if (wv.buildDef) cur = 'crosshair'
    else if (hoverId != null) cur = 'pointer'
    else if (this.hoverX >= 0 && this.requests.pick(this.hoverX, this.hoverY, REQ_PX * 0.8) != null)
      cur = 'pointer'
    if (cur !== this.cursor) {
      this.cursor = cur
      this.interact.cursor = cur
    }
  }
}
