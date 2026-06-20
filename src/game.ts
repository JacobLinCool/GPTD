import { Application, Container, Graphics } from 'pixi.js'
import { AudioEngine } from './audio/audio'
import { DESIGN_H, DESIGN_W, MAX_STEPS, SIM_DT } from './config'
import type { GameEvent, GameState, PostTrainMethod, PostTrainTarget } from './core/types'
import { FxManager } from './render/fx'
import { TextureFactory } from './render/textures'
import { WorldRenderer } from './render/world'
import {
  buyUpgrade,
  continueEndless,
  cycleRackRole,
  deployModel,
  sellTower,
  startWave,
  tryBuild,
  upgradeHardware,
} from './sim/actions'
import { startPostTrain, startResearch } from './sim/research'
import { TOWER_DEFS } from './sim/content'
import { buildCost } from './sim/actions'
import { demoCanContinueCampaign, demoPlan, nextDemoWaveNumber } from './sim/demo'
import { hasLab } from './sim/effects'
import { isBrownout } from './sim/power'
import { step } from './sim/sim'
import { createState } from './sim/state'
import { getMode, isExpert, setMode } from './mode'
import { Tutorial } from './tutorial'
import { BuildBar } from './ui/buildbar'
import { Codex } from './ui/codex'
import { Hud } from './ui/hud'
import { MetricsHistory } from './ui/metricsHistory'
import { MetricsPanel } from './ui/metricsPanel'
import { RequestInspector } from './ui/requestInspector'
import { setTooltipsEnabled, tooltip } from './ui/tooltip'
import { ModelOverview } from './ui/modelOverview'
import { IncidentBanner, InspectPanel, Overlay, TrainingPanel, WaveReportPanel } from './ui/panels'
import { SettingsPanel, SystemMenu } from './ui/system'
import { AboutPanel, CodexBrowser, HelpPanel } from './ui/browsers'
import { ChatPanel } from './ui/chat'
import { AchievementsPanel, AchievementToast } from './ui/achievements'
import { AchievementTracker } from './achievements'
import { getSettings, onLangChange, setMuted, subscribe as subscribeSettings } from './settings'
import { serializeState, type AgentSnapshot } from './agent/snapshot'
import { explainRejection } from './agent/diagnose'

const SPEED_STEPS = [1, 2, 3, 6, 12] as const
type SpeedStep = (typeof SPEED_STEPS)[number]

export class Game {
  readonly root = new Container()
  private state: GameState
  private factory: TextureFactory
  private fx = new FxManager()
  private world: WorldRenderer
  private hud: Hud
  private metricsHistory = new MetricsHistory()
  private metrics = new MetricsPanel()
  private buildbar: BuildBar
  private inspect: InspectPanel
  private requestInspect = new RequestInspector()
  private training: TrainingPanel
  private models: ModelOverview
  private banner: IncidentBanner
  private report: WaveReportPanel
  private overlay: Overlay
  private systemMenu: SystemMenu
  private settingsPanel: SettingsPanel
  private helpPanel: HelpPanel
  private codexBrowser: CodexBrowser
  /** DOM chat overlay (Codex → Chat tab); positioned over the Pixi body each frame. */
  private chatPanel = new ChatPanel()
  /** whether the Codex Chat tab is selected (source of truth for the overlay). */
  private chatTabActive = false
  private aboutPanel: AboutPanel
  private achievementsPanel: AchievementsPanel
  private achievements = new AchievementTracker()
  private achToast = new AchievementToast()
  /** the content browser currently open over the hub (null = none). */
  private activeBrowser: HelpPanel | CodexBrowser | AboutPanel | AchievementsPanel | null = null
  private codex: Codex
  private tutorial: Tutorial
  private audio = new AudioEngine()

  private selectedDefId: string | null = null
  private selectedTowerId: number | null = null
  private selectedRequestId: number | null = null
  private trainingOpen = false
  private modelsOpen = false
  private metricsOpen = false
  private paused = false
  private speed: SpeedStep = 1
  private acc = 0
  private brownoutCd = 0
  /** §3: the system/pause hub is up (freezes the sim); settingsOpen is its sub-view. */
  private systemMenuOpen = false
  private settingsOpen = false
  private demoActive = false
  private demoPlannedWave = 0
  private demoBuildTimer = 0
  private agentMode = false
  private agentName: string | undefined
  private agentConnectorAttached = false

  constructor(app: Application) {
    this.state = createState((Math.floor(performance.now()) ^ 0x5f3759df) >>> 0)
    this.factory = new TextureFactory(app.renderer)
    this.world = new WorldRenderer(this.factory, this.fx)

    this.hud = new Hud({
      onPause: () => this.togglePause(),
      onSpeed: () => this.cycleSpeed(),
      onMute: () => this.toggleMute(),
      onSettings: () => this.openSystemMenu(),
      onModels: () => this.toggleModels(),
      onMetrics: () => this.toggleMetrics(),
    })
    this.buildbar = new BuildBar(this.factory, {
      onSelect: (id) => this.selectBuild(id),
      onStartWave: () => this.doStartWave(),
      onTrain: () => this.openTraining(),
    })
    this.inspect = new InspectPanel({
      onSell: (id) => this.doSell(id),
      onDeploy: (id, modelId) => this.doDeploy(id, modelId),
      onUpgradeHw: (id) => this.doUpgradeHardware(id),
      onRole: (id) => this.doRackRole(id),
    })
    this.training = new TrainingPanel(
      (id) => this.doBuy(id),
      (id) => this.doResearch(id),
      (baseIds, method, target, effort) => this.doPostTrain(baseIds, method, target, effort),
      () => (this.trainingOpen = false),
    )
    this.models = new ModelOverview(() => (this.modelsOpen = false))
    this.banner = new IncidentBanner()
    this.report = new WaveReportPanel()
    this.overlay = new Overlay(
      () => this.onOverlayAction(),
      () => {
        if (continueEndless(this.state)) this.overlay.hide()
      },
      () => this.startDemo(),
      () => this.enterAgentMode(),
    )
    this.codex = new Codex(this.factory, {
      onNext: () => this.tutorial.requestNext(),
      onSkip: () => this.tutorial.skip(),
    })
    this.tutorial = new Tutorial(this.codex)
    this.settingsPanel = new SettingsPanel({
      onBack: () => this.closeSettings(),
      onPreview: () => this.audio.click(),
      onReplayTutorial: () => this.tutorial.replay(),
      isModeUnlocked: () => this.state.phase === 'menu' || this.tutorial.finished,
    })
    this.helpPanel = new HelpPanel(() => this.closeContent(), this.factory)
    this.codexBrowser = new CodexBrowser(() => this.closeContent(), this.factory, {
      setActive: (active) => {
        this.chatTabActive = active
        if (!active) this.chatPanel.hide()
      },
      refreshText: () => this.chatPanel.refreshText(),
    })
    this.aboutPanel = new AboutPanel(() => this.closeContent())
    this.achievementsPanel = new AchievementsPanel(() => this.closeContent(), this.achievements, () => this.state)
    this.systemMenu = new SystemMenu({
      onResume: () => this.closeSystemMenu(),
      onSettings: () => this.openSettings(),
      onHelp: () => this.openContent(this.helpPanel),
      onCodex: () => this.openContent(this.codexBrowser),
      onAbout: () => this.openContent(this.aboutPanel),
      onAchievements: () => this.openContent(this.achievementsPanel),
      onRestart: () => this.restartRun(false),
      onQuit: () => this.restartRun(true),
    })

    const bg = new Graphics().rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x0a0e14 })
    this.root.addChild(
      bg,
      this.world.view,
      this.banner.view,
      this.report.view,
      this.inspect.view,
      this.requestInspect.view,
      this.hud.view,
      this.buildbar.view,
      this.metrics.view,
      this.codex.view,
      this.training.view,
      this.models.view,
      this.systemMenu.view,
      this.settingsPanel.view,
      this.helpPanel.view,
      this.codexBrowser.view,
      this.aboutPanel.view,
      this.achievementsPanel.view,
      this.overlay.view,
      this.achToast.view,
      tooltip().view, // always top-most
    )

    // Settings → systems: re-apply on any change; keep static panels localized.
    subscribeSettings(() => this.applySettings())
    this.applySettings()
    onLangChange(() => {
      this.overlay.refresh()
      if (this.systemMenu.visible) this.systemMenu.refresh()
      if (this.settingsPanel.visible) this.settingsPanel.refresh()
      if (this.activeBrowser?.visible) this.activeBrowser.refresh()
    })

    this.world.onTileTap = (c, r) => this.onTileTap(c, r)
    this.world.onRequestTap = (id) => this.onRequestTap(id)
    this.overlay.show('menu', this.state)
    this.installKeys()
  }

  resumeAudio(): void {
    this.audio.resume()
  }

  /** Read-only state summary for debugging / E2E harness. */
  get snapshot(): {
    phase: string
    mode: string
    wave: number
    cash: number
    trust: number
    sla: number
    data: number
    towers: number
    served: number
    leaked: number
    report: number | null
    loadouts: string[]
    models: number
    research: string | null
    endless: boolean
    derived: number
    posttrain: string | null
    demo: boolean
  } {
    const s = this.state
    return {
      phase: s.phase,
      mode: getMode(),
      wave: s.waveIndex + 1,
      cash: Math.floor(s.meters.cash),
      trust: Math.round(s.meters.trust),
      sla: Math.round(s.meters.sla),
      data: Math.floor(s.data),
      towers: s.towers.length,
      served: s.stats.served,
      leaked: s.stats.leaked,
      report: s.lastReport ? s.lastReport.waveIndex + 1 : null,
      loadouts: s.towers
        .filter((t) => t.def.kind === 'server')
        .map((t) => `${t.hwId ?? '?'}:${t.modelId ?? '?'}`),
      models: Object.keys(s.models).length,
      research: (s.research.infra ?? s.research.posttrain ?? s.research.eval)?.id ?? null,
      endless: s.endless,
      // S7/S9 E2E: how many player-derived checkpoints exist + the live posttrain run.
      derived: Object.keys(s.derivedModels).length,
      posttrain: s.research.posttrain?.meta?.method ?? null,
      demo: this.demoActive,
    }
  }

  // ---- agent bridge (scripts/bridge.mjs + src/agent/connector.ts) ----
  /** True once a remote agent has taken over; suppresses the tutorial bubble. */
  get isAgentMode(): boolean {
    return this.agentMode
  }

  /**
   * Enter agent-bridge mode from the UI (the title-screen AGENT button or `?agent`):
   * default the display to Expert, hand the run to the bridge, and dial out the
   * connector (idempotent). The local relay + CLI agent connect from the panel.
   */
  enterAgentMode(): void {
    this.audio.resume()
    setMode('expert') // agent mode defaults to the full Expert telemetry view
    this.selectedDefId = null
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.trainingOpen = false
    this.modelsOpen = false
    this.paused = false
    this.tutorial.reset()
    this.enableAgentMode()
    if (!this.agentConnectorAttached) {
      this.agentConnectorAttached = true
      void import('./agent/connector')
        .then((m) => m.attach(this))
        .catch((err) => console.error('[agent] connector failed to attach', err))
    }
  }

  /** Hand control to a remote agent: leave the menu, kill demo/tutorial chatter. */
  enableAgentMode(): void {
    this.agentMode = true
    this.achievements.resetRun()
    this.achievements.markAgentMode()
    this.demoActive = false
    if (this.state.phase === 'menu') {
      this.state.phase = 'build'
      this.overlay.hide()
    }
    // Agent MODE is on, but nothing is connected yet — the bridge/agent dials in
    // later (the connector's onopen posts the real "connected" note).
    this.agentNote('Agent mode on — waiting for the bridge. I will narrate each move here once it connects.')
  }

  /** Free-form status line from the agent (no action), shown in the Codex bubble. */
  agentNote(text: string): void {
    this.codex.say({ text, hideControls: true, speaker: this.agentName ?? '' })
  }

  /** Compact, JSON-safe decision context for the agent. */
  agentSnapshot(): AgentSnapshot {
    return serializeState(this.state)
  }

  /**
   * Execute one whitelisted action on behalf of the agent. The optional `reason`
   * is shown in the Codex bubble so a human watching the tab sees WHY each move
   * was made, in real time, alongside the live board.
   */
  agentAct(cmd: { fn: string; args?: unknown[]; reason?: string; name?: string }): {
    ok: boolean
    result?: unknown
    error?: string
  } {
    if (!this.agentMode) return { ok: false, error: 'agent mode is off' }
    const s = this.state
    const args = cmd.args ?? []
    // The agent self-identifies (e.g. "Claude" / "Codex"); remember it so the bubble
    // shows who is playing instead of the default "CODEX:" tutorial persona.
    if (cmd.name) this.agentName = String(cmd.name).trim().slice(0, 16).toUpperCase()
    if (cmd.reason) this.codex.say({ text: cmd.reason, hideControls: true, speaker: this.agentName ?? '' })
    try {
      let ok = false
      switch (cmd.fn) {
        case 'startGame':
          if (s.phase === 'menu') {
            s.phase = 'build'
            this.overlay.hide()
          }
          ok = true
          break
        case 'build': {
          const [defId, col, row] = args as [string, number, number]
          ok = tryBuild(s, defId, col, row)
          if (ok) this.selectedTowerId = s.towers.find((t) => t.col === col && t.row === row)?.id ?? null
          break
        }
        case 'sell': {
          const [id] = args as [number]
          ok = sellTower(s, id)
          if (ok && this.selectedTowerId === id) this.selectedTowerId = null
          break
        }
        case 'deploy': {
          const [id, modelId] = args as [number, string]
          ok = deployModel(s, id, modelId)
          if (ok) this.selectedTowerId = id
          break
        }
        case 'upgradeHardware': {
          const [id] = args as [number]
          ok = upgradeHardware(s, id)
          if (ok) this.selectedTowerId = id
          break
        }
        case 'cycleRackRole': {
          const [id] = args as [number]
          ok = cycleRackRole(s, id)
          if (ok) this.selectedTowerId = id
          break
        }
        case 'buyUpgrade': {
          const [id] = args as [string]
          ok = buyUpgrade(s, id)
          break
        }
        case 'research': {
          const [id] = args as [string]
          ok = startResearch(s, id)
          break
        }
        case 'postTrain': {
          const [rawBases, method, target, effort] = args as [string[] | string, PostTrainMethod, PostTrainTarget, number]
          // Accept a single id (the GET /do flat-args form) or an array (POST JSON).
          const baseIds = Array.isArray(rawBases) ? rawBases : rawBases != null ? [rawBases] : []
          ok = startPostTrain(s, baseIds, method, target, effort)
          break
        }
        case 'startWave':
          this.trainingOpen = false
          this.modelsOpen = false
          ok = startWave(s)
          break
        case 'continueEndless':
          ok = continueEndless(s)
          break
        case 'select': {
          const [id] = args as [number]
          this.selectedTowerId = s.towers.some((t) => t.id === id) ? id : null
          ok = this.selectedTowerId === id
          break
        }
        default:
          return { ok: false, error: `unknown action: ${cmd.fn}` }
      }
      return ok ? { ok: true } : { ok: false, error: explainRejection(s, cmd.fn, args) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private installKeys(): void {
    window.addEventListener('keydown', (e) => {
      // While typing in a DOM input (e.g. the chat overlay), don't fire game
      // hotkeys — but let Escape through so the system close-stack still works.
      const tgt = e.target as HTMLElement | null
      const editable = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
      if (editable && e.key !== 'Escape') return
      if (e.key === ' ') {
        e.preventDefault()
        if (this.state.phase === 'build') this.doStartWave()
        else if (this.state.phase === 'wave') this.togglePause()
      } else if (e.key === '1') this.speed = 1
      else if (e.key === '2') this.speed = 2
      else if (e.key === '3') this.speed = 3
      else if (e.key === '6') this.speed = 6
      else if (e.key === '0') this.speed = 12
      else if (e.key === 'Escape') {
        // §3 priority stack: sub-view → hub → modals → selection → open hub.
        if (this.activeBrowser) this.closeContent()
        else if (this.settingsOpen) this.closeSettings()
        else if (this.systemMenuOpen) this.closeSystemMenu()
        else if (this.modelsOpen) this.modelsOpen = false
        else if (this.trainingOpen) this.trainingOpen = false
        else if (this.selectedDefId || this.selectedTowerId != null || this.selectedRequestId != null) {
          this.selectedDefId = null
          this.selectedTowerId = null
          this.selectedRequestId = null
        } else {
          this.openSystemMenu()
        }
      } else if (e.key.toLowerCase() === 'm') this.toggleMute()
      else if (e.key === '`' || e.key === 'Tab') {
        e.preventDefault()
        this.toggleMetrics()
      }
    })
  }

  // ---- actions ----
  private selectBuild(id: string): void {
    if (this.demoActive) return
    this.selectedDefId = this.selectedDefId === id ? null : id
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.audio.click()
  }

  private onTileTap(col: number, row: number): void {
    if (this.state.phase === 'menu' || this.state.phase === 'won' || this.state.phase === 'lost') return
    if (this.trainingOpen || this.modelsOpen) return
    const existing = this.state.towers.find((t) => t.col === col && t.row === row)
    if (existing) {
      this.selectedTowerId = existing.id
      this.selectedDefId = null
      this.selectedRequestId = null
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

  /**
   * S4: click a request packet to open the RequestInspector (Expert Mode). The
   * world reports the nearest request to the tap when no build tool is active.
   */
  private onRequestTap(id: number): void {
    if (!isExpert()) return
    if (this.trainingOpen || this.modelsOpen || this.selectedDefId) return
    this.selectedRequestId = id
    this.selectedTowerId = null
    this.audio.click()
  }

  private doSell(id: number): void {
    if (this.demoActive) return
    sellTower(this.state, id)
    this.selectedTowerId = null
  }
  private doBuy(id: string): void {
    if (this.demoActive) return
    buyUpgrade(this.state, id)
  }
  private doResearch(id: string): boolean {
    if (this.demoActive) return false
    return startResearch(this.state, id)
  }
  private doPostTrain(
    baseIds: string[],
    method: PostTrainMethod,
    target: PostTrainTarget,
    effort: number,
  ): boolean {
    if (this.demoActive) return false
    return startPostTrain(this.state, baseIds, method, target, effort)
  }
  private doDeploy(id: number, modelId: string): boolean {
    if (this.demoActive) return false
    return deployModel(this.state, id, modelId)
  }
  private doUpgradeHardware(id: number): boolean {
    if (this.demoActive) return false
    return upgradeHardware(this.state, id)
  }
  private doRackRole(id: number): boolean {
    if (this.demoActive) return false
    return cycleRackRole(this.state, id)
  }
  private openTraining(): void {
    if (this.state.phase === 'build' && hasLab(this.state)) this.trainingOpen = true
  }
  /** S7 ModelOverview: toggle the all-checkpoints modal (Expert Mode only). */
  private toggleModels(): void {
    if (!isExpert()) return
    this.modelsOpen = !this.modelsOpen
    if (this.modelsOpen) this.trainingOpen = false
  }
  /** S2 floating telemetry panel — Expert Mode only; a non-blocking overlay. */
  private toggleMetrics(): void {
    if (!isExpert()) return
    this.metricsOpen = !this.metricsOpen
  }
  private doStartWave(): void {
    if (this.demoActive) return
    if (this.state.phase !== 'build') return
    this.trainingOpen = false
    this.modelsOpen = false
    startWave(this.state)
  }
  private togglePause(): void {
    this.paused = !this.paused
  }

  /** Push SettingsStore values into the live systems (audio buses, tooltips). */
  private applySettings(): void {
    const s = getSettings()
    this.audio.setMasterVolume(s.audio.master)
    this.audio.setMusicVolume(s.audio.music)
    this.audio.setSfxVolume(s.audio.sfx)
    this.audio.setMuted(s.audio.muted)
    setTooltipsEnabled(s.gameplay.tooltips)
  }

  /** HUD quick-mute + the `m` key — routed through the store so Settings stays in sync. */
  private toggleMute(): void {
    setMuted(!getSettings().audio.muted)
  }

  // ---- system menu / settings hub (docs/SYSTEM-MENU.md §3) ----
  private openSystemMenu(): void {
    if (this.demoActive || this.agentMode) return
    if (this.state.phase !== 'build' && this.state.phase !== 'wave') return
    this.audio.resume()
    this.settingsOpen = false
    this.settingsPanel.hide()
    this.systemMenuOpen = true
    this.systemMenu.show()
  }
  private closeSystemMenu(): void {
    this.systemMenuOpen = false
    this.settingsOpen = false
    this.systemMenu.hide()
    this.settingsPanel.hide()
    this.activeBrowser?.hide()
    this.activeBrowser = null
  }
  private openSettings(): void {
    this.settingsOpen = true
    this.systemMenu.hide()
    this.settingsPanel.show()
  }
  private closeSettings(): void {
    this.settingsOpen = false
    this.settingsPanel.hide()
    if (this.systemMenuOpen) this.systemMenu.show()
  }
  /** Open a content browser (How to Play / Codex / About) over the paused hub. */
  private openContent(panel: HelpPanel | CodexBrowser | AboutPanel | AchievementsPanel): void {
    this.settingsOpen = false
    this.settingsPanel.hide()
    this.systemMenu.hide()
    this.activeBrowser = panel
    panel.show()
  }
  private closeContent(): void {
    this.activeBrowser?.hide()
    this.activeBrowser = null
    if (this.systemMenuOpen) this.systemMenu.show()
  }

  /** Restart into a fresh run (toTitle → back to the title screen, else straight to build). */
  private restartRun(toTitle: boolean): void {
    this.closeSystemMenu()
    this.achievements.resetRun()
    this.state = createState((Math.floor(performance.now()) ^ 0xa5a5a5a5) >>> 0)
    this.demoActive = false
    this.demoPlannedWave = 0
    this.demoBuildTimer = 0
    this.selectedDefId = null
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.trainingOpen = false
    this.modelsOpen = false
    this.metricsOpen = false
    this.speed = this.startSpeed()
    this.paused = false
    this.tutorial.reset()
    if (toTitle) {
      this.overlay.show('menu', this.state)
    } else {
      this.state.phase = 'build'
      this.overlay.hide()
    }
  }

  /** Default speed for a new run, clamped to a valid step. */
  private startSpeed(): SpeedStep {
    const n = getSettings().gameplay.defaultSpeed
    return (SPEED_STEPS as readonly number[]).includes(n) ? (n as SpeedStep) : 1
  }
  private cycleSpeed(): void {
    const i = SPEED_STEPS.indexOf(this.speed)
    this.speed = SPEED_STEPS[(i + 1) % SPEED_STEPS.length]
  }
  private onOverlayAction(): void {
    this.audio.resume()
    if (this.state.phase === 'menu') {
      this.speed = this.startSpeed()
      this.achievements.resetRun()
      this.state.phase = 'build'
      this.overlay.hide()
    } else {
      // Restart → back to the title screen, where the display mode can be
      // changed (it is locked while a run is in progress).
      this.state = createState((Math.floor(performance.now()) ^ 0xa5a5a5a5) >>> 0)
      this.demoActive = false
      this.demoPlannedWave = 0
      this.demoBuildTimer = 0
      this.selectedDefId = null
      this.selectedTowerId = null
      this.trainingOpen = false
      this.modelsOpen = false
      this.metricsOpen = false
      this.speed = 1
      this.paused = false
      this.tutorial.reset()
      this.overlay.show('menu', this.state)
    }
  }

  private startDemo(): void {
    this.audio.resume()
    setMode('expert')
    this.state = createState(2026)
    this.state.phase = 'build'
    this.demoActive = true
    this.demoPlannedWave = 0
    this.demoBuildTimer = 0
    this.selectedDefId = null
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.trainingOpen = false
    this.modelsOpen = false
    this.paused = false
    this.speed = 12
    this.tutorial.reset()
    this.overlay.hide()
  }

  private updateDemo(dt: number): void {
    if (!this.demoActive) return
    const s = this.state
    if (s.phase === 'won') {
      if (continueEndless(s)) {
        this.overlay.hide()
        this.demoPlannedWave = 0
        this.demoBuildTimer = 0.35
        return
      }
    }
    if (s.phase === 'lost') {
      this.demoActive = false
      this.speed = 1
      return
    }
    if (this.trainingOpen || this.modelsOpen) return
    this.selectedDefId = null
    if (s.phase !== 'build') return
    const wave = nextDemoWaveNumber(s)
    if (this.demoPlannedWave !== wave) {
      demoPlan(s, wave)
      this.demoPlannedWave = wave
      this.demoBuildTimer = 0.35
      return
    }
    this.demoBuildTimer -= dt
    if (this.demoBuildTimer <= 0 && demoCanContinueCampaign(s)) startWave(s)
  }

  // ---- main tick ----
  tick(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000)
    const s = this.state
    this.updateDemo(dt)

    const simRunning =
      s.phase === 'wave' && !this.paused && !this.trainingOpen && !this.modelsOpen && !this.systemMenuOpen
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
    if (this.selectedRequestId != null && !s.requests.some((r) => r.id === this.selectedRequestId && r.alive)) {
      this.selectedRequestId = null
    }
    if (this.selectedDefId && s.meters.cash < buildCost(s, TOWER_DEFS[this.selectedDefId])) {
      // keep selected but it shows red ghost
    }

    const wv = {
      selectedId: this.selectedTowerId,
      selectedRequestId: this.selectedRequestId,
      buildDef: this.selectedDefId ? TOWER_DEFS[this.selectedDefId] : null,
      canAfford: this.selectedDefId ? s.meters.cash >= buildCost(s, TOWER_DEFS[this.selectedDefId]) : false,
    }
    this.world.sync(s, wv, dt)
    this.hud.update(s, {
      paused: this.paused,
      speed: this.speed,
      muted: getSettings().audio.muted,
      metricsOpen: this.metricsOpen,
    })
    // S2 telemetry: sample the rolling history every tick (gated on a live wave
    // inside), then render the floating panel only while it is open (Expert Mode).
    this.metricsHistory.sample(s)
    if (!isExpert()) this.metricsOpen = false
    this.metrics.view.visible = this.metricsOpen
    if (this.metricsOpen) this.metrics.update(this.metricsHistory)
    const modalOpen = this.trainingOpen || this.modelsOpen
    this.buildbar.update(s, this.selectedDefId)
    this.inspect.update(s, modalOpen ? null : this.selectedTowerId)
    this.requestInspect.update(s, modalOpen ? null : this.selectedRequestId)
    this.banner.update(s)
    this.report.update(s)
    this.training.view.visible = this.trainingOpen
    if (this.trainingOpen) this.training.update(s)
    this.models.view.visible = this.modelsOpen
    if (this.modelsOpen) this.models.update(s)

    const reportOpen = this.report.view.visible
    if (this.trainingOpen || this.modelsOpen || reportOpen) this.codex.hide()
    else if (!this.agentMode) this.tutorial.update(s)
    this.codex.update(dt)

    if (s.phase === 'won' && !this.overlay.view.visible) this.overlay.show('won', s)
    if (s.phase === 'lost' && !this.overlay.view.visible) this.overlay.show('lost', s)

    // achievements: scan live state, surface any unlocks via the toast (not in demo)
    if (!this.demoActive && (s.phase === 'build' || s.phase === 'wave')) this.achievements.tick(s)
    const newAch = this.achievements.drainUnlocks()
    if (newAch.length) this.achToast.push(newAch)
    this.achToast.update(dt)

    this.syncChatOverlay()
  }

  /** Track the DOM chat overlay onto the Pixi Codex body region (screen px + scale). */
  private syncChatOverlay(): void {
    const shouldShow = this.chatTabActive && this.codexBrowser.view.visible
    if (!shouldShow) {
      if (this.chatPanel.visible) this.chatPanel.hide()
      return
    }
    // Show + position in the same frame so the overlay never paints mis-placed.
    if (!this.chatPanel.visible) this.chatPanel.show()
    const s = this.root.scale.x
    const r = this.codexBrowser.bodyDesignRect()
    this.chatPanel.layout(this.root.x + r.x * s, this.root.y + r.y * s, s, r.w, r.h)
  }

  private consumeEvents(): void {
    const s = this.state
    if (!s.events.length) return
    for (const ev of s.events) {
      this.dispatch(ev)
      if (!this.demoActive) {
        this.achievements.onEvent(s, ev)
        if (ev.type === 'wave-clear') this.achievements.onWaveCleared(s, s.lastReport)
        else if (ev.type === 'win') this.achievements.onRunEnd(s, true)
        else if (ev.type === 'lose') this.achievements.onRunEnd(s, false)
      }
    }
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
        else if (ev.kind === 'bad' || ev.kind === 'over_refused') this.audio.serveBad()
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
      case 'research-done':
        this.audio.waveClear()
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
