import { Application, Container, Graphics } from 'pixi.js'
import { AudioEngine } from './audio/audio'
import { DESIGN_H, DESIGN_W, MAX_STEPS, SIM_DT } from './config'
import type { GameEvent, GameState } from './core/types'
import { FxManager } from './render/fx'
import { TextureFactory } from './render/textures'
import { WorldRenderer } from './render/world'
import { buyUpgrade, sellTower, startWave, tryBuild } from './sim/actions'
import { TOWER_DEFS } from './sim/content'
import { buildCost } from './sim/actions'
import { hasLab } from './sim/effects'
import { isBrownout } from './sim/power'
import { step } from './sim/sim'
import { createState } from './sim/state'
import { Tutorial } from './tutorial'
import { BuildBar } from './ui/buildbar'
import { Codex } from './ui/codex'
import { Hud } from './ui/hud'
import { IncidentBanner, InspectPanel, Overlay, TrainingPanel } from './ui/panels'

export class Game {
  readonly root = new Container()
  private state: GameState
  private factory: TextureFactory
  private fx = new FxManager()
  private world: WorldRenderer
  private hud: Hud
  private buildbar: BuildBar
  private inspect: InspectPanel
  private training: TrainingPanel
  private banner: IncidentBanner
  private overlay: Overlay
  private codex: Codex
  private tutorial: Tutorial
  private audio = new AudioEngine()

  private selectedDefId: string | null = null
  private selectedTowerId: number | null = null
  private trainingOpen = false
  private paused = false
  private speed = 1
  private acc = 0
  private brownoutCd = 0
  private musicOn = true

  constructor(app: Application) {
    this.state = createState((Math.floor(performance.now()) ^ 0x5f3759df) >>> 0)
    this.factory = new TextureFactory(app.renderer)
    this.world = new WorldRenderer(this.factory, this.fx)

    this.hud = new Hud({
      onPause: () => this.togglePause(),
      onSpeed: () => this.cycleSpeed(),
      onMute: () => this.audio.toggleMute(),
      onMusic: () => {
        this.musicOn = this.audio.toggleMusic()
      },
    })
    this.buildbar = new BuildBar(this.factory, {
      onSelect: (id) => this.selectBuild(id),
      onStartWave: () => this.doStartWave(),
      onTrain: () => this.openTraining(),
    })
    this.inspect = new InspectPanel((id) => this.doSell(id))
    this.training = new TrainingPanel(
      (id) => this.doBuy(id),
      () => (this.trainingOpen = false),
    )
    this.banner = new IncidentBanner()
    this.overlay = new Overlay(() => this.onOverlayAction())
    this.codex = new Codex(this.factory, {
      onNext: () => this.tutorial.requestNext(),
      onSkip: () => this.tutorial.skip(),
    })
    this.tutorial = new Tutorial(this.codex)

    const bg = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x0a0e14 })
    this.root.addChild(
      bg,
      this.world.view,
      this.banner.view,
      this.inspect.view,
      this.hud.view,
      this.buildbar.view,
      this.codex.view,
      this.training.view,
      this.overlay.view,
    )

    this.world.onTileTap = (c, r) => this.onTileTap(c, r)
    this.overlay.show('menu', this.state)
    this.installKeys()
  }

  resumeAudio(): void {
    this.audio.resume()
  }

  /** Read-only state summary for debugging / E2E harness. */
  get snapshot(): {
    phase: string
    wave: number
    cash: number
    trust: number
    sla: number
    data: number
    towers: number
    served: number
    leaked: number
  } {
    const s = this.state
    return {
      phase: s.phase,
      wave: s.waveIndex + 1,
      cash: Math.floor(s.meters.cash),
      trust: Math.round(s.meters.trust),
      sla: Math.round(s.meters.sla),
      data: Math.floor(s.data),
      towers: s.towers.length,
      served: s.stats.served,
      leaked: s.stats.leaked,
    }
  }

  private installKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault()
        if (this.state.phase === 'build') this.doStartWave()
        else if (this.state.phase === 'wave') this.togglePause()
      } else if (e.key === '1') this.speed = 1
      else if (e.key === '2') this.speed = 2
      else if (e.key === '3') this.speed = 3
      else if (e.key === 'Escape') {
        if (this.trainingOpen) this.trainingOpen = false
        else {
          this.selectedDefId = null
          this.selectedTowerId = null
        }
      } else if (e.key.toLowerCase() === 'm') this.audio.toggleMute()
    })
  }

  // ---- actions ----
  private selectBuild(id: string): void {
    this.selectedDefId = this.selectedDefId === id ? null : id
    this.selectedTowerId = null
    this.audio.click()
  }

  private onTileTap(col: number, row: number): void {
    if (this.state.phase === 'menu' || this.state.phase === 'won' || this.state.phase === 'lost') return
    if (this.trainingOpen) return
    const existing = this.state.towers.find((t) => t.col === col && t.row === row)
    if (existing) {
      this.selectedTowerId = existing.id
      this.selectedDefId = null
      this.audio.click()
      return
    }
    if (this.selectedDefId) {
      if (tryBuild(this.state, this.selectedDefId, col, row)) {
        // keep the tool selected for rapid placement
      }
      return
    }
    this.selectedTowerId = null
  }

  private doSell(id: number): void {
    sellTower(this.state, id)
    this.selectedTowerId = null
  }
  private doBuy(id: string): void {
    buyUpgrade(this.state, id)
  }
  private openTraining(): void {
    if (this.state.phase === 'build' && hasLab(this.state)) this.trainingOpen = true
  }
  private doStartWave(): void {
    if (this.state.phase !== 'build') return
    this.trainingOpen = false
    startWave(this.state)
  }
  private togglePause(): void {
    this.paused = !this.paused
  }
  private cycleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1
  }
  private onOverlayAction(): void {
    this.audio.resume()
    if (this.state.phase === 'menu') {
      this.state.phase = 'build'
      this.overlay.hide()
    } else {
      // restart
      this.state = createState((Math.floor(performance.now()) ^ 0xa5a5a5a5) >>> 0)
      this.state.phase = 'build'
      this.selectedDefId = null
      this.selectedTowerId = null
      this.trainingOpen = false
      this.speed = 1
      this.paused = false
      this.tutorial.reset()
      this.overlay.hide()
    }
  }

  // ---- main tick ----
  tick(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000)
    const s = this.state

    const simRunning = s.phase === 'wave' && !this.paused && !this.trainingOpen
    if (simRunning) {
      this.acc += dt * this.speed
      let n = 0
      const budget = MAX_STEPS * this.speed
      while (this.acc >= SIM_DT && n < budget) {
        step(s)
        this.acc -= SIM_DT
        n++
        if (s.phase !== 'wave') break
      }
    } else {
      this.acc = 0
    }

    this.consumeEvents()
    this.fx.update(dt)

    if (s.phase === 'wave' && isBrownout(s)) {
      this.brownoutCd -= dt
      if (this.brownoutCd <= 0) {
        this.audio.brownout()
        this.brownoutCd = 1.4
      }
    }

    // validate selection still exists
    if (this.selectedTowerId != null && !s.towers.some((t) => t.id === this.selectedTowerId)) {
      this.selectedTowerId = null
    }
    if (this.selectedDefId && s.meters.cash < buildCost(s, TOWER_DEFS[this.selectedDefId])) {
      // keep selected but it shows red ghost
    }

    const wv = {
      selectedId: this.selectedTowerId,
      buildDef: this.selectedDefId ? TOWER_DEFS[this.selectedDefId] : null,
      canAfford: this.selectedDefId ? s.meters.cash >= buildCost(s, TOWER_DEFS[this.selectedDefId]) : false,
    }
    this.world.sync(s, wv, dt)
    this.hud.update(s, {
      paused: this.paused,
      speed: this.speed,
      muted: this.audio.isMuted,
      musicOn: this.musicOn,
    })
    this.buildbar.update(s, this.selectedDefId)
    this.inspect.update(s, this.trainingOpen ? null : this.selectedTowerId)
    this.banner.update(s)
    this.training.view.visible = this.trainingOpen
    if (this.trainingOpen) this.training.update(s)

    if (!this.trainingOpen) this.tutorial.update(s)
    this.codex.update(dt)

    if (s.phase === 'won' && !this.overlay.view.visible) this.overlay.show('won', s)
    if (s.phase === 'lost' && !this.overlay.view.visible) this.overlay.show('lost', s)
  }

  private consumeEvents(): void {
    const s = this.state
    if (!s.events.length) return
    for (const ev of s.events) this.dispatch(ev)
    s.events.length = 0
  }

  private dispatch(ev: GameEvent): void {
    switch (ev.type) {
      case 'fire':
        this.fx.fire(ev.fx.x, ev.fx.y, ev.tx, ev.ty, ev.color)
        break
      case 'serve':
        this.fx.serve(ev.x, ev.y, ev.kind, ev.amount)
        if (ev.kind === 'good') this.audio.serveGood()
        else if (ev.kind === 'bad') this.audio.serveBad()
        else this.audio.serveUnsafe()
        break
      case 'cache':
        this.fx.cache(ev.x, ev.y)
        this.audio.cache()
        break
      case 'leak':
        this.fx.leak(ev.x, ev.y, ev.unsafe)
        this.audio.leak()
        break
      case 'place':
        this.audio.place()
        break
      case 'sell':
        this.audio.sell()
        break
      case 'wave-start':
        this.audio.waveStart()
        break
      case 'wave-clear':
        this.audio.waveClear()
        break
      case 'train':
        this.audio.train()
        break
      case 'win':
        this.audio.win()
        break
      case 'lose':
        this.audio.lose()
        break
    }
  }
}
