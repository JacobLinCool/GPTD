/**
 * Dev-only FX gallery (`?fxgallery=1`): the real board renderer driven by SYNTHETIC
 * contract events and display fields, so every outcome, cause, safety layer, rack
 * state and wave beat can be checked without playing to it. Not player-facing.
 *
 * Keys: 1–9 / 0 / q–p fire one scenario · Space toggles the auto cycle · L language ·
 * C colorblind · E Expert/Normal · M reduced motion · F FX level · R ranges.
 * Scripted: `window.__gallery.fire('sloMiss:ttft')`, `.list`, `.setAuto(false)`.
 */
import { Application, BitmapText, Container, Graphics, Sprite } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, TILE } from '../config'
import {
  OUTCOMES,
  type GameEvent,
  type GameState,
  type Outcome,
  type Request,
  type Tower,
} from '../core/types'
import { cycleLang, t } from '../i18n'
import { isExpert, setMode } from '../mode'
import { OUTCOME_STYLE, outcomeColor } from '../outcomes'
import { getSettings, updateSettings } from '../settings'
import { tryBuild } from '../sim/actions'
import { HARDWARE_TIERS, MODEL_LIST } from '../sim/content'
import { towerRangeTiles } from '../sim/effects'
import { CORE_POS, LANE_PATHS, pathLength, posAt } from '../sim/pathing'
import { spawnRequest } from '../sim/spawn'
import { createState } from '../sim/state'
import { POP_FONT } from './popups'
import { TextureFactory } from './textures'
import { WorldRenderer } from './world'

const TYPES = ['chat', 'comp', 'rag', 'reason', 'agent', 'embed', 'summ', 'batch', 'jailbreak']

type Scenario = { name: string; run: () => void }

export class FxGallery {
  readonly root = new Container()
  private factory: TextureFactory
  private world: WorldRenderer
  private s: GameState
  private legend = new Container()
  private caption: BitmapText
  private auto = true
  private timer = 0
  private spawnT = 0
  private cursor = 0
  private scenarios: Scenario[] = []

  constructor(app: Application) {
    this.factory = new TextureFactory(app.renderer)
    this.world = new WorldRenderer(this.factory)
    this.s = this.makeState()
    const bg = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: COLORS.bg })
    this.caption = new BitmapText({ text: '', style: { fontFamily: POP_FONT, fontSize: 14 } })
    this.caption.position.set(16, 16)
    this.root.addChild(bg, this.world.view, this.world.screen, this.legend, this.caption)
    this.buildScenarios()
    this.buildLegend()
    window.addEventListener('keydown', (e) => this.key(e.key))
    ;(window as unknown as { __gallery: unknown }).__gallery = {
      fire: (name: string) => this.fire(name),
      list: this.scenarios.map((x) => x.name),
      setAuto: (b: boolean) => (this.auto = b),
      state: this.s,
      world: this.world,
    }
  }

  /** A board with every building kind and every rack state on it. */
  private makeState(): GameState {
    const s = createState(7)
    s.phase = 'wave'
    s.waveIndex = 22
    s.meters.cash = 1e6
    s.meters.trust = 72
    s.power = { used: 9, cap: 12 }
    s.cooling = { used: 10, cap: 8 }
    s.infra.scheduling.batch = true
    const place = (id: string, c: number, r: number, hw?: string): Tower | null => {
      if (!tryBuild(s, id, c, r)) return null
      const tw = s.towers[s.towers.length - 1]
      if (hw) tw.hwId = hw
      return tw
    }
    HARDWARE_TIERS.forEach((hw, i) => place('srv_edge', 3 + i * 3, 2, hw))
    place('guard_encoder', 4, 4)
    place('guard_llm', 7, 4)
    place('guard_mod', 9, 4)
    place('cache', 13, 4)
    place('router', 17, 4)
    place('srv_edge', 4, 6, 'hw_standard')
    place('srv_edge', 7, 6, 'hw_perf')
    place('srv_edge', 13, 6, 'hw_frontier')
    place('srv_edge', 19, 8, 'hw_perf')
    place('srv_edge', 13, 8, 'hw_standard')
    place('power', 4, 8)
    place('cooling', 7, 8)
    place('lab', 10, 8)
    s.events.length = 0
    return s
  }

  /** Per-frame synthetic sim: move packets, fake prefill/decode, publish rack display fields. */
  private simulate(dt: number): void {
    const s = this.s
    s.time += dt
    s.waveTime += dt
    this.spawnT -= dt
    if (this.spawnT <= 0) {
      this.spawnT = 0.35
      const type = TYPES[Math.floor(Math.random() * TYPES.length)]
      const lane = Math.floor(Math.random() * LANE_PATHS.length)
      const r = spawnRequest(s, type, 1, 1, 1, 1, 1, lane)
      if (type === 'reason' || type === 'agent') r.thinkTokens = Math.round(r.maxWork * 0.45)
      if (type === 'summ' && Math.random() < 0.3) r.windowBlocked = true
      if (Math.random() < 0.15) r.sloViolated = true
      if (Math.random() < 0.15) r.bestQuality = -3
    }
    // rack states: one liquid-gated, one browned out, one throttled, one training
    for (const tw of s.towers) {
      tw.online =
        !(tw.hwId === 'hw_pod' || tw.hwId === 'hw_superpod' || tw.hwId === 'hw_giga') &&
        !(tw.col === 13 && tw.row === 8)
      tw.throttle = tw.col === 4 && tw.row === 6 ? 0.6 : 1
      tw.training = tw.col === 7 && tw.row === 6
      tw.decodeIds = []
      tw.prefillId = null
      tw.batch = 0
      tw.kvFrac = 0
    }
    for (const r of s.requests) {
      if (!r.alive) continue
      r.dist += r.speed * dt * 0.6
      if (r.dist >= pathLength(r.laneId)) {
        this.resolve(
          r,
          r.safetyRisk > 0 && !r.safetyCleared ? 'unsafe' : r.windowBlocked ? 'unservable' : 'leaked',
        )
        continue
      }
      const p = posAt(r.dist, r.laneId)
      r.x = p.x
      r.y = p.y
      // the nearest online rack in range works it
      let rack: Tower | null = null
      let bd = Infinity
      for (const tw of s.towers) {
        if (tw.def.kind !== 'server' || !tw.online || tw.training) continue
        const d = (tw.x - r.x) ** 2 + (tw.y - r.y) ** 2
        if (d < bd && d <= (towerRangeTiles(tw) * TILE) ** 2) {
          bd = d
          rack = tw
        }
      }
      if (!rack || r.windowBlocked) continue
      if (r.prefill > 0) {
        if (rack.prefillId == null) {
          rack.prefillId = r.id
          r.prefill = Math.max(0, r.prefill - r.tokensIn * dt * 1.6)
        }
      } else if (r.work > 0 && (rack.decodeIds?.length ?? 0) < 6) {
        rack.decodeIds!.push(r.id)
        r.work = Math.max(0, r.work - r.maxWork * dt * 0.8)
      }
      rack.batch = rack.decodeIds!.length
      rack.kvFrac = Math.min(1, (rack.batch + (rack.prefillId != null ? 1 : 0)) / 5)
      if (r.prefill <= 0 && r.work <= 0) {
        const o: Outcome = r.sloViolated
          ? 'sloMiss'
          : r.bestQuality < 0
            ? 'bad'
            : r.safetyRisk > 0 && !r.safetyCleared
              ? 'unsafe'
              : 'served'
        this.resolve(r, o, rack)
      }
    }
    s.requests = s.requests.filter((r) => r.alive)
  }

  /** Kill a synthetic request with an outcome event, exactly as the sim contract emits it. */
  private resolve(
    r: Request,
    outcome: Outcome,
    rack?: Tower | null,
    extra: Partial<Extract<GameEvent, { type: 'outcome' }>> = {},
  ): void {
    r.alive = false
    const sev = OUTCOME_STYLE[outcome].severity
    const ev: GameEvent = {
      type: 'outcome',
      requestId: r.id,
      typeId: r.def.id,
      laneId: r.laneId,
      x: r.x,
      y: r.y,
      outcome,
      cash:
        outcome === 'served'
          ? r.def.id === 'chat'
            ? 0.04
            : 0.6 + Math.random() * 2
          : outcome === 'sloMiss'
            ? 0.02
            : 0,
      dTrust:
        outcome === 'served' ? 0.25 : sev >= 2 ? -(sev === 3 ? 6 : 2) : outcome === 'sloMiss' ? -0.5 : -0.4,
      dSla: outcome === 'sloMiss' || outcome === 'leaked' || outcome === 'overRefused' ? -1 : 0,
      cause: outcome === 'sloMiss' ? (['ttft', 'tpot', 'e2el', 'ttfat'] as const)[r.id % 4] : undefined,
      axis: outcome === 'bad' ? r.def.primaryAxis : undefined,
      margin: outcome === 'bad' ? -3 : 2,
      refusedBy: outcome === 'overRefused' ? (r.id % 2 ? 'model' : 'guard') : undefined,
      towerId: rack?.id,
      ...extra,
    }
    this.world.onEvent(ev, this.s)
  }

  private liveRequest(pred: (r: Request) => boolean = () => true): Request | null {
    const live = this.s.requests.filter((r) => r.alive && pred(r))
    return live.length ? live[Math.floor(Math.random() * live.length)] : null
  }

  private buildScenarios(): void {
    const s = this.s
    const out =
      (o: Outcome, extra: Partial<Extract<GameEvent, { type: 'outcome' }>> = {}) =>
      () => {
        const r = this.liveRequest()
        if (r) this.resolve(r, o, null, extra)
      }
    const atCore = (o: Outcome) => () => {
      const r = spawnRequest(s, o === 'unservable' ? 'summ' : 'chat', 1, 1, 1, 1, 1, 0)
      r.x = CORE_POS.x
      r.y = CORE_POS.y
      this.resolve(r, o)
    }
    const guardOf = (arch: string) => s.towers.find((tw) => tw.def.guardrail?.archetype === arch)
    const add: Scenario[] = [
      { name: 'served', run: out('served', { cash: 0.04 }) },
      { name: 'served:big', run: out('served', { cash: 3.4 }) },
      { name: 'sloMiss:ttft', run: out('sloMiss', { cause: 'ttft' }) },
      { name: 'sloMiss:tpot', run: out('sloMiss', { cause: 'tpot' }) },
      { name: 'sloMiss:ttfat', run: out('sloMiss', { cause: 'ttfat' }) },
      { name: 'bad:coding', run: out('bad', { axis: 'coding' }) },
      { name: 'unsafe', run: out('unsafe', { dTrust: -8 }) },
      { name: 'overRefused:model', run: out('overRefused', { refusedBy: 'model' }) },
      { name: 'overRefused:guard', run: out('overRefused', { refusedBy: 'guard' }) },
      { name: 'unservable', run: atCore('unservable') },
      { name: 'leaked', run: atCore('leaked') },
      {
        name: 'guard:caught',
        run: () => {
          const g = guardOf('encoder')
          const r = this.liveRequest((x) => x.def.id === 'jailbreak') ?? this.liveRequest()
          if (!g || !r) return
          r.hazardsOpen = {}
          r.safetyRisk = 0
          r.safetyCleared = true
          this.world.onEvent(
            {
              type: 'guard',
              towerId: g.id,
              requestId: r.id,
              x: r.x,
              y: r.y,
              result: 'caught',
              archetype: 'encoder',
              hazard: 'jailbreak',
            },
            s,
          )
        },
      },
      {
        name: 'guard:overRefused',
        run: () => {
          const g = guardOf('generative')
          const r = this.liveRequest((x) => x.def.id !== 'jailbreak')
          if (!g || !r) return
          this.world.onEvent(
            {
              type: 'guard',
              towerId: g.id,
              requestId: r.id,
              x: r.x,
              y: r.y,
              result: 'overRefused',
              archetype: 'generative',
            },
            s,
          )
          this.resolve(r, 'overRefused', null, { refusedBy: 'guard' })
        },
      },
      {
        name: 'selfHandle',
        run: () => {
          const rack = s.towers.find((tw) => tw.def.kind === 'server' && tw.online)
          const r = this.liveRequest((x) => x.def.id === 'jailbreak') ?? this.liveRequest()
          if (!rack || !r) return
          r.hazardsOpen = {}
          r.safetyRisk = 0
          r.safetyCleared = true
          this.world.onEvent(
            { type: 'selfHandle', towerId: rack.id, requestId: r.id, x: r.x, y: r.y, hazard: 'jailbreak' },
            s,
          )
        },
      },
      {
        name: 'cache',
        run: () => {
          const r = this.liveRequest()
          if (r) this.world.onEvent({ type: 'cache', x: r.x, y: r.y, requestId: r.id }, s)
        },
      },
      {
        name: 'build',
        run: () => {
          const free: [number, number][] = [
            [20, 2],
            [16, 6],
            [10, 6],
            [21, 4],
          ]
          for (const [c, r] of free) if (tryBuild(s, 'srv_edge', c, r)) break
        },
      },
      {
        name: 'upgrade',
        run: () => {
          const tw = s.towers.find((x) => x.def.kind === 'server' && x.col === 19 && x.row === 8)
          if (!tw || !tw.hwId) return
          const i = HARDWARE_TIERS.indexOf(tw.hwId)
          tw.hwId = HARDWARE_TIERS[(i + 1) % 4]
        },
      },
      {
        name: 'deploy',
        run: () => {
          const tw = s.towers.find((x) => x.def.kind === 'server' && x.col === 13 && x.row === 6)
          if (!tw) return
          const m = MODEL_LIST[(MODEL_LIST.findIndex((x) => x.id === tw.modelId) + 1) % MODEL_LIST.length]
          tw.modelId = m.id
        },
      },
      {
        name: 'sell',
        run: () => {
          const i = s.towers.findIndex((x) => x.col === 20 || x.col === 16 || x.col === 10 || x.col === 21)
          if (i < 0) return
          const tw = s.towers[i]
          s.towers.splice(i, 1)
          this.world.onEvent(
            { type: 'sell', x: tw.x, y: tw.y, towerId: tw.id, defId: tw.def.id, refund: 3 },
            s,
          )
        },
      },
      { name: 'brownout', run: () => this.world.onEvent({ type: 'brownout', on: true }, s) },
      { name: 'wave-start', run: () => this.world.onEvent({ type: 'wave-start', index: 21 }, s) },
      {
        name: 'wave-start:boss',
        run: () => this.world.onEvent({ type: 'wave-start', index: 19, boss: true, surgeLane: 2 }, s),
      },
      {
        name: 'wave-clear',
        run: () => {
          s.lastReport = { clearBonus: 46, goodputPct: 87 } as GameState['lastReport']
          this.world.onEvent({ type: 'wave-clear', index: 29, goodputPct: 87 }, s)
        },
      },
      {
        name: 'research-done',
        run: () => this.world.onEvent({ type: 'research-done', id: 'inf_chunked' }, s),
      },
    ]
    this.scenarios = add
  }

  fire(name: string): void {
    this.scenarios.find((x) => x.name === name)?.run()
  }

  private buildLegend(): void {
    this.legend.removeChildren().forEach((c) => c.destroy())
    let x = 16
    for (const o of OUTCOMES) {
      const st = OUTCOME_STYLE[o]
      const g = new Sprite(this.factory.glyph(st.glyph))
      g.scale.set(2)
      g.tint = outcomeColor(o)
      g.position.set(x, DESIGN_H - 34)
      const l = new BitmapText({ text: t(st.labelKey), style: { fontFamily: POP_FONT, fontSize: 12 } })
      l.tint = outcomeColor(o)
      l.position.set(x + 26, DESIGN_H - 32)
      this.legend.addChild(g, l)
      x += 30 + l.width + 18
    }
  }

  private key(k: string): void {
    const idx = '1234567890qwertyuiop'.indexOf(k)
    if (idx >= 0 && idx < this.scenarios.length) return this.scenarios[idx].run()
    if (k === ' ') this.auto = !this.auto
    else if (k === 'l') cycleLang()
    else if (k === 'c') updateSettings('a11y', { colorblind: !getSettings().a11y.colorblind })
    else if (k === 'e') setMode(isExpert() ? 'normal' : 'expert')
    else if (k === 'm') updateSettings('a11y', { reducedMotion: !getSettings().a11y.reducedMotion })
    else if (k === 'f') {
      const lv = getSettings().a11y.fxLevel
      updateSettings('a11y', { fxLevel: lv === 'full' ? 'reduced' : lv === 'reduced' ? 'minimal' : 'full' })
    } else if (k === 'r') this.world.toggleRanges()
    this.buildLegend()
  }

  tick(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000)
    this.simulate(dt)
    if (this.auto) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer = 0.7
        this.scenarios[this.cursor++ % this.scenarios.length].run()
      }
    }
    for (const ev of this.s.events) this.world.onEvent(ev, this.s)
    this.s.events.length = 0
    this.world.sync(
      this.s,
      { selectedId: null, selectedRequestId: null, buildDef: null, canAfford: true },
      dt,
      {
        alpha: 1,
        speed: 1,
        running: true,
      },
    )
    const st = getSettings().a11y
    this.caption.text = `FX GALLERY  auto:${this.auto ? 'on' : 'off'}  mode:${isExpert() ? 'expert' : 'normal'}  fx:${st.fxLevel}  cb:${st.colorblind ? 'on' : 'off'}  rm:${st.reducedMotion ? 'on' : 'off'}`
  }
}
