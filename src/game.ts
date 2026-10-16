import { Application, Container, Graphics, type FederatedPointerEvent } from 'pixi.js'
import { AudioEngine, type AudioBus } from './audio/engine'
import { COLORS, DESIGN_H, DESIGN_W, MAX_STEPS, SIM_DT, TILE } from './config'
import type { GameEvent, GameState, PostTrainMethod, PostTrainTarget, Tower, WeightFormat } from './core/types'
import { TextureFactory } from './render/textures'
import { WorldRenderer } from './render/world'
import {
  buyUpgrade,
  continueEndless,
  cycleRackRole,
  deployModel,
  nextHardware,
  sellTower,
  setRackPrecision,
  startWave,
  towerValue,
  tryBuild,
  upgradeHardware,
} from './sim/actions'
import { startPostTrain, startResearch } from './sim/research'
import { BUILD_ORDER, HARDWARE_DEFS, HARDWARE_TIERS, RESEARCH_DEFS, TOWER_DEFS } from './sim/content'
import { buildCost } from './sim/actions'
import { demoCanContinueCampaign, demoPlan, nextDemoWaveNumber } from './sim/demo'
import { hasLab, hasLiquidLoop, hwNeedsLiquid, loadout, resolveModel, serverFitsMemory } from './sim/effects'
import { isBrownout, isLiquidGated, isThrottling } from './sim/power'
import { fleetBurnPerSec, previewNextWave, type WavePreview } from './sim/preview'
import { step } from './sim/sim'
import { createState } from './sim/state'
import { tileCenter, worldToTile } from './sim/pathing'
import { getMode, isExpert, setMode } from './mode'
import { Tutorial } from './tutorial'
import { modelName, t, towerName } from './i18n'
import { BuildBar } from './ui/buildbar'
import { BoardOverlay, type CursorLabel } from './ui/boardOverlay'
import { Codex } from './ui/codex'
import { DeniedToast, explainDenied, type DenyAction } from './ui/denied'
import { BUILD_CODES, HotkeyOverlay, KEY, keyCap, SPEED_CODES } from './ui/help'
import { Hud } from './ui/hud'
import { MetricsHistory } from './ui/metricsHistory'
import { MetricsPanel } from './ui/metricsPanel'
import { NextWaveCard } from './ui/nextWave'
import { NotificationStack } from './ui/notifications'
import { RequestInspector } from './ui/requestInspector'
import { setTooltipsEnabled, tooltip } from './ui/tooltip'
import { uiSound } from './ui/uiSound'
import { ModelOverview } from './ui/modelOverview'
import { IncidentBanner, InspectPanel, Overlay, TrainingPanel, WaveReportPanel } from './ui/panels'
import { SettingsPanel, SystemMenu } from './ui/system'
import { AboutPanel, CodexBrowser, HelpPanel } from './ui/browsers'
import { ChatPanel } from './ui/chat'
import { AchievementsPanel, achievementNotice } from './ui/achievements'
import { AchievementTracker } from './achievements'
import { getSettings, onLangChange, setMuted, subscribe as subscribeSettings } from './settings'
import { serializeState, type AgentSnapshot } from './agent/snapshot'
import { explainRejection } from './agent/diagnose'

const SPEED_STEPS = [1, 2, 3, 6, 12] as const
type SpeedStep = (typeof SPEED_STEPS)[number]

/** A copied rack loadout ("eyedropper"): every tile click places a rack configured like it. */
interface Blueprint {
  /** the buildable server def the copy starts from (then upgrades in place). */
  defId: string
  hwId: string
  modelId: string
  role: Tower['role']
}

/** A drag-to-paint gesture with a build tool held down. */
interface PaintStroke {
  pointerId: number
  touch: boolean
  downAt: number
  startCol: number
  startRow: number
  lastCol: number
  lastRow: number
  /** the pointer left the start tile (it is a paint, not a tap). */
  moved: boolean
  placed: number
  spent: number
  /** cash ran out mid-stroke. */
  stopped: boolean
}

/** Touch holds this long before a drag paints (a quick swipe is not a build). */
const TOUCH_PAINT_HOLD_MS = 250
/** Hover a placed building this long (board seconds of frames) before its mini card shows. */
const HOVER_CARD_DELAY = 0.35
/** How long the X-key / START "press again" arm lasts. */
const ARM_MS = 2500

export class Game {
  readonly root = new Container()
  private state: GameState
  private factory: TextureFactory
  readonly world: WorldRenderer
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
  /** the content browser currently open over the hub (null = none). */
  private activeBrowser: HelpPanel | CodexBrowser | AboutPanel | AchievementsPanel | null = null
  private codex: Codex
  private tutorial: Tutorial
  private audio = new AudioEngine()
  // ---- shell surfaces ----
  private nextWave: NextWaveCard
  private notices = new NotificationStack()
  private denied = new DeniedToast()
  private hotkeys: HotkeyOverlay
  private board = new BoardOverlay()

  private selectedDefId: string | null = null
  private selectedTowerId: number | null = null
  private selectedRequestId: number | null = null
  private trainingOpen = false
  private modelsOpen = false
  private metricsOpen = false
  private paused = false
  /** why the run is paused (the pill names it): the player, or the window losing focus. */
  private pauseReason: 'manual' | 'blur' = 'manual'
  private speed: SpeedStep = 1
  /** the last >1× speed, for the F toggle. */
  private fastSpeed: SpeedStep = 3
  private acc = 0
  /** §3: the system/pause hub is up (freezes the sim); settingsOpen is its sub-view. */
  private systemMenuOpen = false
  private settingsOpen = false
  private demoActive = false
  private demoPlannedWave = 0
  private demoBuildTimer = 0
  private agentMode = false
  private agentName: string | undefined
  private agentConnectorAttached = false

  /** the wave START launches next (recomputed each build-phase frame; null mid-wave). */
  private preview: WavePreview | null = null
  private blueprint: Blueprint | null = null
  private paint: PaintStroke | null = null
  /** the pointertap that ends a paint stroke / a right-click must not also build or select. */
  private swallowTap = false
  /** the pointer type of the last board press (touch builds preview-then-confirm). */
  private lastPointerType = 'mouse'
  private pendingTouchTile: { col: number; row: number } | null = null
  /** last pointer position in design px (anchor for denied toasts). */
  private pointer = { x: DESIGN_W / 2, y: DESIGN_H / 2 }
  private hoverTowerId: number | null = null
  private hoverTime = 0
  /** X pressed once on this tower: the next X within ARM_MS sells. */
  private sellArm: { towerId: number; until: number } | null = null
  /** auto-start countdown (seconds left) and whether this build phase opted out. */
  private autoStartLeft: number | null = null
  private autoStartCancelled = false
  /** the first brownout / throttle of each wave gets one notice. */
  private powerNoticed = false
  private heatNoticed = false
  /** dedupe a checkpoint announced by both research-done and posttrain-done. */
  private lastCheckpoint = ''
  private modalCount = 0
  /** estimated length of the live wave (cached from its preview at start) — the runway's yardstick. */
  private waveEstSec = 0

  constructor(private app: Application) {
    this.state = createState((Math.floor(performance.now()) ^ 0x5f3759df) >>> 0)
    this.factory = new TextureFactory(app.renderer)
    this.world = new WorldRenderer(this.factory)

    this.hud = new Hud({
      onPause: () => this.togglePause(),
      onSpeed: () => this.cycleSpeed(),
      onSpeedDown: () => this.stepSpeed(-1),
      onMute: () => this.toggleMute(),
      onSettings: () => this.openSystemMenu(),
      onModels: () => this.toggleModels(),
      onMetrics: () => this.toggleMetrics(),
    })
    this.buildbar = new BuildBar(this.factory, {
      onSelect: (id) => this.selectBuild(id),
      onStartWave: () => this.doStartWave(),
      onTrain: () => this.openTraining(),
      onDenied: (reason, x, y) => this.showDenied(reason, x, y),
    })
    this.inspect = new InspectPanel({
      onSell: (id) => this.doSell(id),
      onDeploy: (id, modelId) => this.doDeploy(id, modelId),
      onUpgradeHw: (id) => this.doUpgradeHardware(id),
      onRole: (id) => this.doRackRole(id),
      onPrecision: (id, fmt) => this.doRackPrecision(id, fmt),
    })
    this.training = new TrainingPanel(
      (id) => this.doBuy(id),
      (id) => this.doResearch(id),
      (baseIds, method, target, effort) => this.doPostTrain(baseIds, method, target, effort),
      () => (this.trainingOpen = false),
    )
    this.models = new ModelOverview(
      () => (this.modelsOpen = false),
      (id, modelId) => this.doDeploy(id, modelId),
    )
    this.banner = new IncidentBanner()
    this.report = new WaveReportPanel()
    this.nextWave = new NextWaveCard(this.factory)
    this.hotkeys = new HotkeyOverlay(() => this.hotkeys.hide())
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
      onPreview: (bus?: AudioBus) => this.audio.preview(bus),
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
      this.board.view,
      this.banner.view,
      this.report.view,
      this.nextWave.view,
      this.inspect.view,
      this.requestInspect.view,
      this.hud.view,
      this.buildbar.view,
      this.world.screen, // FX chips that fly up to the HUD meters
      this.metrics.view,
      this.codex.view,
      this.notices.view,
      this.training.view,
      this.models.view,
      this.systemMenu.view,
      this.settingsPanel.view,
      this.helpPanel.view,
      this.codexBrowser.view,
      this.aboutPanel.view,
      this.achievementsPanel.view,
      this.overlay.view,
      this.hotkeys.view,
      this.denied.view,
      tooltip().view, // always top-most
    )

    // when it offers one, else fall back to the existing click blip.

    // Settings → systems: re-apply on any change; keep static panels localized.
    subscribeSettings(() => this.applySettings())
    this.applySettings()
    onLangChange(() => {
      this.overlay.refresh()
      if (this.systemMenu.visible) this.systemMenu.refresh()
      if (this.settingsPanel.visible) this.settingsPanel.refresh()
      if (this.activeBrowser?.visible) this.activeBrowser.refresh()
      if (this.hotkeys.visible) this.hotkeys.refresh()
    })

    this.world.onTileTap = (c, r) => this.onTileTap(c, r)
    this.world.onRequestTap = (id) => this.onRequestTap(id)
    this.installPointer()
    this.overlay.show('menu', this.state)
    this.installKeys()
    this.installFocusPause()
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
    paused: boolean
    speed: number
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
      paused: this.paused,
      speed: this.speed,
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
    this.resetShell()
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

  // ---- input: keyboard ----

  /**
   * Hotkeys bind on `e.code` (the physical key — layout- and IME-independent; see
   * ui/help.ts for the table). Held keys never re-fire a toggle, browser shortcuts
   * (Ctrl/Cmd/Alt chords) pass through, and while a hub / modal is open only its
   * own keys and Esc act — Space can never start a wave behind the system menu.
   */
  private installKeys(): void {
    window.addEventListener('keydown', (e) => {
      // While typing in a DOM input (e.g. the chat overlay), don't fire game
      // hotkeys — but let Escape through so the system close-stack still works.
      const tgt = e.target as HTMLElement | null
      const editable = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
      if (editable && e.code !== 'Escape') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const code = e.code
      if (e.repeat) {
        // a held key never repeats an action; still keep Space/Tab from scrolling / tabbing away
        if (code === KEY.start || code === KEY.metricsAlt) e.preventDefault()
        return
      }
      if (this.onKey(code)) e.preventDefault()
    })
  }

  /** Route one key press; true when the game used it. */
  private onKey(code: string): boolean {
    const s = this.state
    if (code === KEY.cancel) {
      this.escape()
      return true
    }
    // title screen: Space / Enter starts, exactly like the START button
    if (s.phase === 'menu') {
      if (this.overlay.view.visible && (code === KEY.start || code === KEY.confirm || code === 'NumpadEnter')) {
        this.onOverlayAction()
        return true
      }
      return false
    }
    if (s.phase === 'won' || s.phase === 'lost') return false
    // the hotkey sheet: H / ? close it, everything else waits
    if (this.hotkeys.visible) {
      if (code === KEY.help || code === KEY.helpAlt) this.hotkeys.hide()
      return true
    }
    // hub / settings / content browser: their own keyboard navigation only
    if (this.activeBrowser) return this.activeBrowser.key(code)
    if (this.settingsOpen) return this.settingsPanel.key(code)
    if (this.systemMenuOpen) return this.systemMenu.key(code)
    // the Training Lab / Model Overview modals keep their own controls; the toggle keys still close them
    if (this.trainingOpen || this.modelsOpen) {
      if (code === KEY.train && this.trainingOpen) this.trainingOpen = false
      else if (code === KEY.models && this.modelsOpen) this.modelsOpen = false
      else return false
      uiSound('close')
      return true
    }

    // viewing controls work for everyone (incl. demo / agent spectators)
    if (code in SPEED_CODES) {
      this.setSpeed(SPEED_CODES[code] as SpeedStep)
      return true
    }
    switch (code) {
      case KEY.speedDown:
        this.stepSpeed(-1)
        return true
      case KEY.speedUp:
        this.stepSpeed(1)
        return true
      case KEY.fast:
        this.setSpeed(this.speed > 1 ? 1 : this.fastSpeed)
        return true
      case KEY.mute:
        this.toggleMute()
        return true
      case KEY.metrics:
      case KEY.metricsAlt:
        this.toggleMetrics()
        return true
      case KEY.models:
        this.toggleModels()
        return true
      case KEY.help:
      case KEY.helpAlt:
        this.hotkeys.show()
        uiSound('open')
        return true
      case KEY.confirm:
      case 'NumpadEnter':
        return this.codex.pressNext()
    }
    if (code === KEY.start) {
      if (s.phase === 'wave') this.togglePause()
      else if (!this.demoActive && !this.agentMode) this.doStartWave()
      return true
    }
    // everything below changes the run — the demo / agent own it
    if (this.demoActive || this.agentMode) return false
    const buildIdx = (BUILD_CODES as readonly string[]).indexOf(code)
    if (buildIdx >= 0) {
      const id = BUILD_ORDER[buildIdx]
      if (!id) return false
      const def = TOWER_DEFS[id]
      if (this.selectedDefId !== id && def && s.meters.cash < buildCost(s, def)) {
        uiSound('denied')
        this.showDenied(explainDenied(s, { fn: 'pick', defId: id }))
        return true
      }
      this.selectBuild(id)
      uiSound('click')
      return true
    }
    const sel = this.selectedTowerId != null ? s.towers.find((tw) => tw.id === this.selectedTowerId) : undefined
    switch (code) {
      case KEY.train:
        this.openTraining(true)
        return true
      case KEY.prevRack:
      case KEY.nextRack:
        this.cycleSelection(code === KEY.nextRack ? 1 : -1)
        return true
      case KEY.upgrade:
        if (sel) this.doUpgradeHardware(sel.id, true)
        return !!sel
      case KEY.sell:
        if (sel) this.keySell(sel)
        return !!sel
      case KEY.copy:
        if (sel) this.copyLoadout(sel)
        return !!sel
      case KEY.role:
        if (sel) this.doRackRole(sel.id, true)
        return !!sel
    }
    return false
  }

  /** §3 Esc priority stack: sheet → sub-view → hub → modals → tool/selection → open hub. */
  private escape(): void {
    if (this.hotkeys.visible) this.hotkeys.hide()
    else if (this.activeBrowser) this.closeContent()
    else if (this.settingsOpen) this.closeSettings()
    else if (this.systemMenuOpen) this.closeSystemMenu()
    else if (this.modelsOpen) this.modelsOpen = false
    else if (this.trainingOpen) this.trainingOpen = false
    else if (!this.cancelToolOrSelection()) {
      this.openSystemMenu()
      return
    }
    uiSound('close')
  }

  /** Drop the build tool / blueprint first, else the selection. Returns false when there was nothing to drop. */
  private cancelToolOrSelection(): boolean {
    this.pendingTouchTile = null
    this.paint = null
    if (this.selectedDefId || this.blueprint) {
      this.selectedDefId = null
      this.blueprint = null
      return true
    }
    if (this.selectedTowerId != null || this.selectedRequestId != null) {
      this.selectedTowerId = null
      this.selectedRequestId = null
      this.sellArm = null
      return true
    }
    return false
  }

  // ---- input: pointer (board gestures, right-click, cursor tracking) ----

  private installPointer(): void {
    // right-click is a game gesture (cancel / slow down), never the browser menu
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    const track = (e: PointerEvent): void => {
      const rect = this.app.canvas.getBoundingClientRect()
      const sc = this.root.scale.x || 1
      this.pointer = {
        x: (e.clientX - rect.left - this.root.x) / sc,
        y: (e.clientY - rect.top - this.root.y) / sc,
      }
    }
    // capture phase: the position is current before Pixi dispatches the press
    window.addEventListener('pointermove', track, { capture: true })
    window.addEventListener('pointerdown', track, { capture: true })

    // the board container listens to its children's bubbled presses (paint / right-click)
    const v = this.world.view
    v.eventMode = 'static'
    v.on('pointerdown', (e: FederatedPointerEvent) => this.onBoardDown(e))
    v.on('globalpointermove', (e: FederatedPointerEvent) => this.onBoardMove(e))
    v.on('pointerup', (e: FederatedPointerEvent) => this.onBoardUp(e))
    v.on('pointerupoutside', (e: FederatedPointerEvent) => this.onBoardUp(e))
  }

  private boardTile(e: FederatedPointerEvent): { col: number; row: number } {
    const p = this.world.view.toLocal(e.global)
    return worldToTile(p.x, p.y)
  }

  private onBoardDown(e: FederatedPointerEvent): void {
    this.lastPointerType = e.pointerType
    // a fresh left press owns its own tap (a right-click outside the grid never consumed its swallow)
    if (e.button === 0) this.swallowTap = false
    if (e.button === 2) {
      // right-click: cancel the tool, else deselect — and the trailing tap does nothing
      this.swallowTap = true
      if (this.cancelToolOrSelection()) uiSound('close')
      return
    }
    if (e.button !== 0 || this.demoActive || this.agentMode) return
    const s = this.state
    if (s.phase !== 'build' && s.phase !== 'wave') return
    const def = this.toolDef()
    if (!def) return
    // racks paint only with Shift (they are expensive); support buildings always paint
    if (def.kind === 'server' && !e.shiftKey) return
    const { col, row } = this.boardTile(e)
    this.paint = {
      pointerId: e.pointerId,
      touch: e.pointerType === 'touch',
      downAt: performance.now(),
      startCol: col,
      startRow: row,
      lastCol: col,
      lastRow: row,
      moved: false,
      placed: 0,
      spent: 0,
      stopped: false,
    }
  }

  private onBoardMove(e: FederatedPointerEvent): void {
    const p = this.paint
    if (!p || e.pointerId !== p.pointerId) return
    const { col, row } = this.boardTile(e)
    if (col === p.lastCol && row === p.lastRow) return
    if (p.touch && performance.now() - p.downAt < TOUCH_PAINT_HOLD_MS) {
      // a quick touch swipe is not a paint stroke
      this.paint = null
      return
    }
    if (!p.moved) {
      p.moved = true
      this.paintAt(p.startCol, p.startRow)
    }
    // fill every tile between the last one and this one (fast drags skip tiles)
    let c = p.lastCol
    let r = p.lastRow
    while ((c !== col || r !== row) && !p.stopped) {
      if (c !== col) c += Math.sign(col - c)
      else r += Math.sign(row - r)
      this.paintAt(c, r)
    }
    p.lastCol = col
    p.lastRow = row
  }

  private onBoardUp(e: FederatedPointerEvent): void {
    const p = this.paint
    if (!p || e.pointerId !== p.pointerId) return
    if (p.moved) this.swallowTap = true
    this.paint = null
  }

  /** One painted tile: place (or blueprint-place) and keep the running total; stop when cash runs out. */
  private paintAt(col: number, row: number): void {
    const p = this.paint
    const def = this.toolDef()
    if (!p || p.stopped || !def) return
    const s = this.state
    if (!s.towers.every((tw) => tw.col !== col || tw.row !== row)) return
    const before = s.meters.cash
    const ok = this.blueprint ? this.placeBlueprint(col, row, true) : tryBuild(s, def.id, col, row)
    if (ok) {
      p.placed++
      p.spent += before - s.meters.cash
      return
    }
    const cost = this.blueprint ? this.blueprintCost(this.blueprint) : buildCost(s, def)
    if (s.meters.cash < cost) {
      p.stopped = true
      uiSound('denied')
      this.showDenied(t('deny.paintCash', { n: p.placed }))
    }
  }

  /** The def the active tool places (the build card, or the blueprint's base rack). */
  private toolDef(): (typeof TOWER_DEFS)[string] | null {
    if (this.blueprint) return TOWER_DEFS[this.blueprint.defId] ?? null
    return this.selectedDefId ? (TOWER_DEFS[this.selectedDefId] ?? null) : null
  }

  // ---- actions ----
  private selectBuild(id: string): void {
    if (this.demoActive) return
    this.blueprint = null
    this.pendingTouchTile = null
    this.selectedDefId = this.selectedDefId === id ? null : id
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.cancelAutoStart()
  }

  private onTileTap(col: number, row: number): void {
    if (this.swallowTap) {
      this.swallowTap = false
      return
    }
    if (this.state.phase === 'menu' || this.state.phase === 'won' || this.state.phase === 'lost') return
    if (this.trainingOpen || this.modelsOpen) return
    this.cancelAutoStart()
    const s = this.state
    const existing = s.towers.find((t) => t.col === col && t.row === row)
    if (existing) {
      this.pendingTouchTile = null
      this.selectedTowerId = existing.id
      this.selectedDefId = null
      this.blueprint = null
      this.selectedRequestId = null
      this.sellArm = null
      uiSound('click')
      return
    }
    const def = this.toolDef()
    if (def) {
      if (this.demoActive || this.agentMode) return
      // touch has no hover: the first tap previews the ghost + cost, a second tap on it builds
      if (this.lastPointerType === 'touch') {
        const pend = this.pendingTouchTile
        if (!pend || pend.col !== col || pend.row !== row) {
          this.pendingTouchTile = { col, row }
          return
        }
        this.pendingTouchTile = null
      }
      // the tool stays selected for rapid placement
      if (this.blueprint) this.placeBlueprint(col, row, false)
      else if (!tryBuild(s, def.id, col, row)) {
        uiSound('denied')
        this.showDenied(explainDenied(s, { fn: 'build', defId: def.id, col, row }), this.tileX(col), this.tileY(row))
      }
      return
    }
    this.selectedTowerId = null
  }

  /** A tile's center (x) and top edge (y) in design px — anchors for tile-level prompts. */
  private tileX(col: number): number {
    return tileCenter(col, 0).x
  }
  private tileY(row: number): number {
    return tileCenter(0, row).y - TILE / 2
  }

  /**
   * S4: click a request packet to open the RequestInspector — in both display
   * modes (the inspector speaks plain language in Normal Mode).
   */
  private onRequestTap(id: number): void {
    if (this.swallowTap) {
      this.swallowTap = false
      return
    }
    if (this.trainingOpen || this.modelsOpen || this.selectedDefId || this.blueprint) return
    this.selectedRequestId = id
    this.selectedTowerId = null
    this.audio.ui('click')
  }

  /** The rack after `t` in id order (dir ±1), wrapping. */
  private cycleSelection(dir: number): void {
    const racks = this.state.towers.filter((tw) => tw.def.kind === 'server').sort((a, b) => a.id - b.id)
    if (!racks.length) return
    const i = racks.findIndex((tw) => tw.id === this.selectedTowerId)
    const next = racks[(i < 0 ? (dir > 0 ? 0 : racks.length - 1) : (i + dir + racks.length) % racks.length)]
    this.selectedTowerId = next.id
    this.selectedDefId = null
    this.blueprint = null
    this.selectedRequestId = null
    this.sellArm = null
    uiSound('click')
  }

  /** X: sell the selection — a second X within ARM_MS confirms when "confirm before selling" is on. */
  private keySell(tw: Tower): void {
    const s = this.state
    const refund = Math.round(towerValue(s, tw) * 0.6)
    if (getSettings().gameplay.confirmSell) {
      const armed = this.sellArm && this.sellArm.towerId === tw.id && performance.now() < this.sellArm.until
      if (!armed) {
        this.sellArm = { towerId: tw.id, until: performance.now() + ARM_MS }
        uiSound('arm')
        this.showDenied(
          t('deny.sellArm', { key: keyCap(KEY.sell), refund, loss: towerValue(s, tw) - refund }),
          tw.x,
          tw.y - 20,
          'info',
        )
        return
      }
    }
    this.sellArm = null
    this.denied.hide()
    this.doSell(tw.id)
  }

  /** C: copy the selected rack's hardware + model + role into a placement blueprint. */
  private copyLoadout(tw: Tower): void {
    if (tw.def.kind !== 'server' || !tw.hwId || !tw.modelId) {
      uiSound('denied')
      this.showDenied(t('deny.copyRackOnly'), tw.x, tw.y - 20)
      return
    }
    const target = HARDWARE_TIERS.indexOf(tw.hwId)
    // the highest buildable rack whose tier is at or below the copy's (then upgrade in place)
    let base: string | null = null
    let baseTier = -1
    for (const id of BUILD_ORDER) {
      const d = TOWER_DEFS[id]
      if (d?.kind !== 'server' || !d.hardwareId) continue
      const tier = HARDWARE_TIERS.indexOf(d.hardwareId)
      if (tier <= target && tier > baseTier) {
        base = id
        baseTier = tier
      }
    }
    if (!base) return
    this.blueprint = { defId: base, hwId: tw.hwId, modelId: tw.modelId, role: tw.role }
    this.selectedDefId = null
    this.selectedTowerId = null
    this.selectedRequestId = null
    this.cancelAutoStart()
    uiSound('click')
    const m = resolveModel(this.state, tw.modelId)
    this.showDenied(
      t('deny.blueprintPicked', {
        hw: HARDWARE_DEFS[tw.hwId]?.name ?? tw.hwId,
        model: modelName(m),
        cost: this.blueprintCost(this.blueprint),
      }),
      tw.x,
      tw.y - 20,
      'info',
    )
  }

  /** Build + upgrade-chain price of a blueprint (the same rounding the actions apply per step). */
  private blueprintCost(bp: Blueprint): number {
    const s = this.state
    const def = TOWER_DEFS[bp.defId]
    let cost = buildCost(s, def)
    let i = HARDWARE_TIERS.indexOf(def.hardwareId ?? '')
    const target = HARDWARE_TIERS.indexOf(bp.hwId)
    while (i >= 0 && i < target) {
      const cur = HARDWARE_DEFS[HARDWARE_TIERS[i]]
      const next = HARDWARE_DEFS[HARDWARE_TIERS[i + 1]]
      cost += Math.round((next.cost - cur.cost) * s.modifiers.buildCost)
      i++
    }
    return cost
  }

  /**
   * Place one blueprint copy using only the player's own actions: build the base
   * rack, upgrade it tier by tier, deploy the model, set the role. Every gate is
   * checked first, so a copy never strands a half-configured rack.
   */
  private placeBlueprint(col: number, row: number, quiet: boolean): boolean {
    const s = this.state
    const bp = this.blueprint
    if (!bp) return false
    const def = TOWER_DEFS[bp.defId]
    const hw = HARDWARE_DEFS[bp.hwId]
    const fail = (msg: string): false => {
      if (!quiet) {
        uiSound('denied')
        this.showDenied(msg, this.tileX(col), this.tileY(row))
      }
      return false
    }
    const reconfig = bp.hwId !== def.hardwareId || bp.modelId !== def.defaultModelId || bp.role !== undefined
    if (reconfig && s.phase !== 'build') return fail(t('deny.blueprintBetweenWaves'))
    if (hwNeedsLiquid(hw) && !hasLiquidLoop(s)) return fail(t('deny.liquid', { name: hw.name }))
    if (!serverFitsMemory(s, loadout(s, bp.hwId, bp.modelId))) {
      return fail(t('deny.noFit', { model: modelName(resolveModel(s, bp.modelId)), gb: Math.round(hw.hbmGb) }))
    }
    const cost = this.blueprintCost(bp)
    if (s.meters.cash < cost) return fail(t('deny.cash', { need: Math.ceil(cost - s.meters.cash), cost }))
    if (!tryBuild(s, def.id, col, row)) return fail(explainDenied(s, { fn: 'build', defId: def.id, col, row }))
    const tw = s.towers.find((x) => x.col === col && x.row === row)
    if (!tw) return false
    for (let guard = 0; tw.hwId !== bp.hwId && guard < HARDWARE_TIERS.length; guard++) {
      if (!nextHardware(tw) || !upgradeHardware(s, tw.id)) break
    }
    if (tw.modelId !== bp.modelId) deployModel(s, tw.id, bp.modelId)
    for (let guard = 0; tw.role !== bp.role && guard < 3; guard++) {
      if (!cycleRackRole(s, tw.id)) break
    }
    return true
  }

  private doSell(id: number): void {
    if (this.demoActive) return
    this.cancelAutoStart()
    if (!sellTower(this.state, id)) this.deny({ fn: 'sell', towerId: id })
    this.selectedTowerId = null
  }
  private doBuy(id: string): void {
    if (this.demoActive) return
    buyUpgrade(this.state, id)
  }
  private doResearch(id: string): boolean {
    if (this.demoActive) return false
    const ok = startResearch(this.state, id)
    if (!ok) this.deny({ fn: 'research', id })
    return ok
  }
  private doPostTrain(
    baseIds: string[],
    method: PostTrainMethod,
    target: PostTrainTarget,
    effort: number,
  ): boolean {
    if (this.demoActive) return false
    const ok = startPostTrain(this.state, baseIds, method, target, effort)
    if (!ok) this.deny({ fn: 'postTrain', baseIds, method, target, effort })
    return ok
  }
  private doDeploy(id: number, modelId: string): boolean {
    if (this.demoActive) return false
    this.cancelAutoStart()
    const ok = deployModel(this.state, id, modelId)
    if (!ok) this.deny({ fn: 'deploy', towerId: id, modelId })
    return ok
  }
  private doUpgradeHardware(id: number, atRack = false): boolean {
    if (this.demoActive) return false
    this.cancelAutoStart()
    const ok = upgradeHardware(this.state, id)
    if (!ok) this.deny({ fn: 'upgrade', towerId: id }, atRack ? id : undefined)
    else if (atRack) uiSound('click')
    return ok
  }
  private doRackRole(id: number, atRack = false): boolean {
    if (this.demoActive) return false
    this.cancelAutoStart()
    const ok = cycleRackRole(this.state, id)
    if (!ok) this.deny({ fn: 'role', towerId: id }, atRack ? id : undefined)
    else if (atRack) uiSound('click')
    return ok
  }
  /** §4.5 switch a rack's weight format (between waves). */
  private doRackPrecision(id: number, fmt: WeightFormat | undefined): boolean {
    if (this.demoActive) return false
    this.cancelAutoStart()
    const ok = setRackPrecision(this.state, id, fmt)
    if (!ok) {
      uiSound('denied')
      const tw = this.state.towers.find((x) => x.id === id)
      this.showDenied(t('deny.precision'), tw?.x, tw ? tw.y - 20 : undefined)
    }
    return ok
  }
  private openTraining(fromKey = false): void {
    if (this.state.phase === 'build' && hasLab(this.state)) {
      this.trainingOpen = true
      this.cancelAutoStart()
      if (fromKey) uiSound('open')
    } else if (fromKey) {
      uiSound('denied')
      this.showDenied(explainDenied(this.state, { fn: 'train' }), this.buildbar.startAnchor.x, this.buildbar.startAnchor.y + 44)
    }
  }
  /** S7 ModelOverview: toggle the all-checkpoints modal (Expert Mode only). */
  private toggleModels(): void {
    if (!isExpert()) return
    this.modelsOpen = !this.modelsOpen
    if (this.modelsOpen) {
      this.trainingOpen = false
      this.cancelAutoStart()
    }
  }
  /** S2 floating telemetry panel — Expert Mode only; a non-blocking overlay. */
  private toggleMetrics(): void {
    if (!isExpert()) return
    this.metricsOpen = !this.metricsOpen
  }

  /**
   * START WAVE (button / Space / auto-start). When cash is below the projected
   * operating bill of the wave, the first press warns and arms the button; a
   * second press within a few seconds starts anyway.
   */
  private doStartWave(): void {
    if (this.demoActive || this.agentMode) return
    const s = this.state
    if (s.phase !== 'build') {
      this.deny({ fn: 'startWave' })
      return
    }
    const p = this.preview ?? previewNextWave(s)
    if (p && p.projectedBill > 0 && s.meters.cash < p.projectedBill && !this.buildbar.startArmed) {
      this.cancelAutoStart()
      this.buildbar.armStart(t('build.startAnyway'))
      const a = this.buildbar.startAnchor
      this.showDenied(t('deny.lowCash', { cash: Math.floor(s.meters.cash), bill: Math.round(p.projectedBill) }), a.x, a.y)
      return
    }
    this.buildbar.disarmStart()
    this.denied.hide()
    this.trainingOpen = false
    this.modelsOpen = false
    this.paused = false
    startWave(s)
  }

  private togglePause(): void {
    if (this.state.phase !== 'wave') return
    this.paused = !this.paused
    this.pauseReason = 'manual'
    uiSound(this.paused ? 'pause' : 'unpause')
  }

  /** Pause on focus loss (Settings ▸ Gameplay); never for a demo or an agent run. */
  private installFocusPause(): void {
    const away = (): void => {
      if (!getSettings().gameplay.pauseOnBlur) return
      if (this.agentMode || this.demoActive) return
      if (this.state.phase !== 'wave' || this.paused) return
      this.paused = true
      this.pauseReason = 'blur'
    }
    window.addEventListener('blur', away)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) away()
    })
  }

  /** Push SettingsStore values into the live systems (the AudioEngine binds the audio settings itself). */
  private applySettings(): void {
    const s = getSettings()
    setTooltipsEnabled(s.gameplay.tooltips)
    if (!s.gameplay.autoStartWave) this.autoStartLeft = null
  }

  /**
   * The interface-sound sink: the engine's dedicated UI voice when the audio layer
   * provides one (`ui(id, opts)`), else the existing click blip for presses.
   */

  /** HUD quick-mute + the `m` key — routed through the store so Settings stays in sync. */
  private toggleMute(): void {
    setMuted(!getSettings().audio.muted)
  }

  // ---- feedback ----

  /** Float a reason by the cursor (or a given design-space anchor). */
  private showDenied(text: string, x = this.pointer.x, y = this.pointer.y, tone: 'warn' | 'info' = 'warn'): void {
    if (!text) return
    this.denied.show(text, x, y, tone)
  }

  /** A rejected player action: the denied cue + its localized reason (at the rack when given). */
  private deny(a: DenyAction, atTowerId?: number): void {
    uiSound('denied')
    const tw = atTowerId != null ? this.state.towers.find((x) => x.id === atTowerId) : undefined
    const text = explainDenied(this.state, a)
    if (tw) this.showDenied(text, tw.x, tw.y - 20)
    else this.showDenied(text)
  }

  // ---- system menu / settings hub (docs/SYSTEM-MENU.md §3) ----
  private openSystemMenu(): void {
    if (this.demoActive || this.agentMode) return
    if (this.state.phase !== 'build' && this.state.phase !== 'wave') return
    this.audio.resume()
    this.cancelAutoStart()
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

  /** Clear every shell-side transient (tools, arms, countdowns, notices) for a new run. */
  private resetShell(): void {
    this.blueprint = null
    this.paint = null
    this.pendingTouchTile = null
    this.swallowTap = false
    this.sellArm = null
    this.autoStartLeft = null
    this.autoStartCancelled = false
    this.powerNoticed = false
    this.heatNoticed = false
    this.lastCheckpoint = ''
    this.hoverTowerId = null
    this.preview = null
    this.notices.clear()
    this.denied.hide()
    this.hotkeys.hide()
    this.buildbar.disarmStart()
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
    this.resetShell()
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
  private setSpeed(n: SpeedStep): void {
    if (this.speed === n) return
    this.speed = n
    if (n > 1) this.fastSpeed = n
    uiSound('speed', { speed: n })
  }
  /** HUD speed button: step up, wrapping back to 1×. */
  private cycleSpeed(): void {
    const i = SPEED_STEPS.indexOf(this.speed)
    this.setSpeed(SPEED_STEPS[(i + 1) % SPEED_STEPS.length])
  }
  /** −/= keys and right-click: one step slower / faster (no wrap). */
  private stepSpeed(dir: number): void {
    const i = SPEED_STEPS.indexOf(this.speed)
    this.setSpeed(SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, i + dir))])
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
      this.resetShell()
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
    this.resetShell()
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

  // ---- shell per-frame helpers ----

  /** Any blocking surface is up (the sim is frozen / the board is covered). */
  private modalOpen(): boolean {
    return (
      this.trainingOpen ||
      this.modelsOpen ||
      this.systemMenuOpen ||
      this.settingsOpen ||
      !!this.activeBrowser ||
      this.hotkeys.visible ||
      this.overlay.view.visible
    )
  }

  /** A build/inspect/modal interaction opts out of this build phase's auto-start. */
  private cancelAutoStart(): void {
    if (this.state.phase !== 'build') return
    this.autoStartCancelled = true
    this.autoStartLeft = null
  }

  /** Settings ▸ Gameplay ▸ auto-start: count down, then press START (never during the guided tutorial or waves 1–3). */
  private updateAutoStart(dt: number): void {
    const g = getSettings().gameplay
    const s = this.state
    const eligible =
      g.autoStartWave &&
      s.phase === 'build' &&
      !this.autoStartCancelled &&
      !this.demoActive &&
      !this.agentMode &&
      !this.tutorial.guiding &&
      !this.modalOpen() &&
      (this.preview?.index ?? 0) >= 3
    if (!eligible) {
      this.autoStartLeft = null
      return
    }
    if (this.autoStartLeft === null) this.autoStartLeft = Math.max(1, g.autoStartDelay)
    const before = Math.ceil(this.autoStartLeft)
    this.autoStartLeft -= dt
    if (Math.ceil(this.autoStartLeft) !== before && this.autoStartLeft > 0) uiSound('countdown')
    if (this.autoStartLeft <= 0) {
      this.autoStartLeft = null
      this.autoStartCancelled = true // one attempt per build phase (a low-cash warning stops it)
      this.doStartWave()
    }
  }

  /** The mini card for a hovered building. */
  private hoverCard(tw: Tower): string {
    const s = this.state
    const parts = [towerName(tw.def)]
    if (tw.def.kind === 'server') {
      const m = tw.modelId ? resolveModel(s, tw.modelId) : null
      if (m) parts.push(modelName(m))
      parts.push(
        isLiquidGated(s) && !tw.online && tw.hwId && hwNeedsLiquid(HARDWARE_DEFS[tw.hwId])
          ? t('rack.state.liquidGate')
          : !tw.online
            ? t('rack.state.brownout')
            : tw.training
              ? t('rack.state.training')
              : tw.throttle < 1
                ? t('rack.state.throttle')
                : t('rack.state.online'),
      )
      if (s.phase === 'wave' && tw.online && !tw.training) parts.push(t('hover.load', { v: Math.round(tw.load * 100) }))
    } else {
      parts.push(tw.online ? t('rack.state.online') : t('rack.state.brownout'))
    }
    return parts.join(' · ')
  }

  /** The cursor label for the active tool: paint total, blueprint price, touch confirm. */
  private cursorLabel(): CursorLabel | null {
    const s = this.state
    const p = this.paint
    if (p && p.moved) {
      const def = this.toolDef()
      const each = this.blueprint ? this.blueprintCost(this.blueprint) : def ? buildCost(s, def) : 0
      return {
        text: t('place.paintCost', { n: p.placed, each, total: Math.round(p.spent) }),
        x: this.pointer.x,
        y: this.pointer.y,
        tone: p.stopped ? 'bad' : 'ok',
      }
    }
    const pend = this.pendingTouchTile
    const def = this.toolDef()
    if (pend && def) {
      const cost = this.blueprint ? this.blueprintCost(this.blueprint) : buildCost(s, def)
      return { text: t('place.tapAgain', { cost }), x: this.tileX(pend.col), y: this.tileY(pend.row), tone: 'info' }
    }
    if (this.blueprint && this.world.hoverCol >= 0) {
      const bp = this.blueprint
      const cost = this.blueprintCost(bp)
      return {
        text: t('place.blueprint', {
          hw: HARDWARE_DEFS[bp.hwId]?.name ?? bp.hwId,
          model: modelName(resolveModel(s, bp.modelId)),
          cost,
        }),
        x: this.pointer.x,
        y: this.pointer.y,
        tone: s.meters.cash >= cost ? 'ok' : 'bad',
      }
    }
    return null
  }

  /** Modal open/close edges → the whoosh cue (one place, every modal). */
  private trackModalSound(): void {
    const n =
      (this.trainingOpen ? 1 : 0) +
      (this.modelsOpen ? 1 : 0) +
      (this.systemMenuOpen ? 1 : 0) +
      (this.settingsOpen ? 1 : 0) +
      (this.activeBrowser ? 1 : 0)
    if (n !== this.modalCount) {
      // the open/close whoosh comes from the audio engine (it watches the same panels)
      this.modalCount = n
      tooltip().dismiss()
    }
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
    this.audio.update(s, dt, {
      running: simRunning,
      paused: this.paused,
      speed: this.speed,
      demo: this.demoActive,
      agent: this.agentMode,
      panels: {
        training: this.trainingOpen,
        models: this.modelsOpen,
        metrics: this.metricsOpen,
        system: this.systemMenuOpen,
        settings: this.settingsOpen,
        browser: this.activeBrowser !== null,
      },
    })
    this.watchPower(s)

    // validate selection still exists
    if (this.selectedTowerId != null && !s.towers.some((t) => t.id === this.selectedTowerId)) {
      this.selectedTowerId = null
    }
    if (this.selectedRequestId != null && !s.requests.some((r) => r.id === this.selectedRequestId && r.alive)) {
      this.selectedRequestId = null
    }
    if (this.sellArm && (this.sellArm.towerId !== this.selectedTowerId || performance.now() > this.sellArm.until)) {
      this.sellArm = null
    }

    // the wave START launches next — shared by the HUD title, the card, the runway and START's bill check
    this.preview = s.phase === 'build' ? previewNextWave(s) : null
    this.updateAutoStart(dt)

    const tool = this.toolDef()
    const toolCost = this.blueprint ? this.blueprintCost(this.blueprint) : tool ? buildCost(s, tool) : 0
    if (this.pendingTouchTile) {
      // touch preview: hold the ghost on the tapped tile (there is no hover)
      this.world.hoverCol = this.pendingTouchTile.col
      this.world.hoverRow = this.pendingTouchTile.row
    }
    const wv = {
      selectedId: this.selectedTowerId,
      selectedRequestId: this.selectedRequestId,
      buildDef: tool,
      canAfford: !!tool && s.meters.cash >= toolCost,
    }
    // alpha = the unconsumed fraction of a sim step: the board interpolates between steps
    const alpha = simRunning ? Math.min(1, this.acc / SIM_DT) : 1
    this.world.sync(s, wv, dt, { alpha, speed: this.speed, running: simRunning })

    // hovering a placed building (no tool): its range ring, then a one-line card
    const modal = this.modalOpen()
    let hover: { tower: Tower; card: string | null } | null = null
    if (!tool && !modal && this.world.hoverCol >= 0) {
      const tw = s.towers.find((x) => x.col === this.world.hoverCol && x.row === this.world.hoverRow)
      if (tw && tw.id !== this.selectedTowerId) {
        if (this.hoverTowerId !== tw.id) {
          this.hoverTowerId = tw.id
          this.hoverTime = 0
        }
        this.hoverTime += dt
        hover = { tower: tw, card: this.hoverTime >= HOVER_CARD_DELAY ? this.hoverCard(tw) : null }
      } else this.hoverTowerId = null
    } else this.hoverTowerId = null
    const narrow = window.innerWidth < 600 && window.innerHeight > window.innerWidth
    this.board.update({
      time: s.time,
      hover,
      surgeLanes: this.preview && this.preview.surgeLane !== null ? [this.preview.surgeLane] : [],
      surgeLabel: t('next.surgeTag'),
      cursor: modal ? null : this.cursorLabel(),
      paused:
        this.paused && s.phase === 'wave'
          ? t(this.pauseReason === 'blur' ? 'hud.pausedBlur' : 'hud.paused', { key: keyCap(KEY.start) })
          : null,
      rotate: narrow ? t('sys.rotateHint') : null,
    })

    this.hud.update(
      s,
      {
        paused: this.paused,
        speed: this.speed,
        muted: getSettings().audio.muted,
        metricsOpen: this.metricsOpen,
        preview: this.preview,
        burnPerSec: this.preview?.burnPerSec ?? fleetBurnPerSec(s),
        waveSec: this.preview && this.preview.estDurationSec > 0 ? this.preview.estDurationSec : this.waveEstSec,
      },
      dt,
    )
    // S2 telemetry: sample the rolling history every tick (gated on a live wave
    // inside), then render the floating panel only while it is open (Expert Mode).
    this.metricsHistory.sample(s)
    if (!isExpert()) this.metricsOpen = false
    this.metrics.view.visible = this.metricsOpen
    if (this.metricsOpen) this.metrics.update(this.metricsHistory)
    const modalOpen = this.trainingOpen || this.modelsOpen
    this.buildbar.update(s, this.blueprint ? this.blueprint.defId : this.selectedDefId, {
      countdown: this.autoStartLeft,
    })
    this.inspect.update(s, modalOpen ? null : this.selectedTowerId)
    this.requestInspect.update(s, modalOpen ? null : this.selectedRequestId)
    this.banner.update(s)
    this.report.update(s)
    // NEXT WAVE card: right column under the incident banner; the inspect panel owns the column while open
    const bannerBottom = this.banner.view.visible ? this.banner.view.y + this.banner.view.height + 8 : 108
    this.nextWave.update(
      s,
      this.preview,
      bannerBottom,
      s.phase === 'build' && !this.inspect.view.visible && !modalOpen && !this.overlay.view.visible,
      !!tool, // a build tool in hand: the card turns into a click-through ghost over the board
    )
    this.training.view.visible = this.trainingOpen
    if (this.trainingOpen) this.training.update(s)
    this.models.view.visible = this.modelsOpen
    if (this.modelsOpen) this.models.update(s)

    const reportOpen = this.report.blocksCodex
    if (this.trainingOpen || this.modelsOpen || reportOpen) this.codex.hide()
    else if (!this.agentMode && !this.demoActive) this.tutorial.update(s)
    this.codex.update(dt)

    if (s.phase === 'won' && !this.overlay.view.visible) this.overlay.show('won', s)
    if (s.phase === 'lost' && !this.overlay.view.visible) this.overlay.show('lost', s)

    // achievements: scan live state, surface any unlocks in the notification stack (not in demo)
    if (!this.demoActive && (s.phase === 'build' || s.phase === 'wave')) this.achievements.tick(s)
    const unlocked = this.achievements.drainUnlocks()
    if (unlocked.length) this.audio.cue('achievement')
    for (const def of unlocked) {
      this.notices.push(achievementNotice(def, () => this.openAchievements()))
    }
    this.notices.update(dt, modal)
    this.denied.update(dt)
    this.trackModalSound()

    this.syncChatOverlay()
  }

  /** Open the Achievements browser over the hub (a notice click). */
  private openAchievements(): void {
    this.openSystemMenu()
    if (this.systemMenuOpen) this.openContent(this.achievementsPanel)
  }

  /** First brownout / throttle / liquid gate of a wave → one notice each. */
  private watchPower(s: GameState): void {
    if (s.phase !== 'wave' || this.demoActive) return
    if (!this.powerNoticed && isBrownout(s)) {
      this.powerNoticed = true
      this.notices.push({
        kind: 'power',
        head: t('toast.power.head'),
        title: t(isLiquidGated(s) ? 'toast.power.liquid' : 'toast.power.brownout'),
        accent: COLORS.danger,
      })
    }
    if (!this.heatNoticed && isThrottling(s)) {
      this.heatNoticed = true
      this.notices.push({ kind: 'heat', head: t('toast.heat.head'), title: t('toast.heat.throttle'), accent: COLORS.warn })
    }
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
      this.audio.onEvent(ev, s)
      this.shellEvent(ev)
      if (!this.demoActive) {
        this.achievements.onEvent(s, ev)
        if (ev.type === 'wave-clear') this.achievements.onWaveCleared(s, s.lastReport)
        else if (ev.type === 'win') this.achievements.onRunEnd(s, true)
        else if (ev.type === 'lose') this.achievements.onRunEnd(s, false)
      }
    }
    s.events.length = 0
  }

  /** Shell reactions to sim events: notices, pause hygiene, per-wave flags. */
  private shellEvent(ev: GameEvent): void {
    const s = this.state
    switch (ev.type) {
      case 'wave-start':
        // a wave never starts frozen, and each wave gets fresh power/heat notices
        if (this.preview && this.preview.estDurationSec > 0) this.waveEstSec = this.preview.estDurationSec
        this.paused = false
        this.powerNoticed = false
        this.heatNoticed = false
        this.buildbar.disarmStart()
        this.pendingTouchTile = null
        break
      case 'wave-clear': {
        this.autoStartCancelled = false
        this.autoStartLeft = null
        if (this.demoActive) break
        const rep = s.lastReport
        const gp = ev.goodputPct ?? rep?.goodputPct
        this.notices.push({
          kind: 'waveClear',
          head: t('toast.waveClear.head', { n: ev.index + 1 }),
          title: t('toast.waveClear', {
            goodput: gp !== undefined ? Math.round(gp) : '—',
            bonus: Math.round(rep?.clearBonus ?? 0),
          }),
          accent: COLORS.trust,
        })
        break
      }
      case 'research-done': {
        if (this.demoActive) break
        if (s.derivedModels[ev.id]) this.checkpointNotice(ev.id)
        else {
          const def = RESEARCH_DEFS[ev.id]
          this.notices.push({
            kind: 'research',
            head: t('toast.research.head'),
            title: def ? t(`research.${def.id}.name`, undefined, def.name) : ev.id,
            accent: COLORS.data,
            onClick: () => this.openTraining(),
          })
        }
        break
      }
      case 'posttrain-done':
        if (!this.demoActive) this.checkpointNotice(ev.modelId)
        break
    }
  }

  /** A freshly minted checkpoint (announced once even if two events name it). */
  private checkpointNotice(modelId: string): void {
    if (this.lastCheckpoint === modelId) return
    this.lastCheckpoint = modelId
    const m = resolveModel(this.state, modelId)
    this.notices.push({
      kind: 'checkpoint',
      head: t('toast.checkpoint.head'),
      title: m ? modelName(m) : modelId,
      accent: COLORS.data,
      onClick: () => (isExpert() ? (this.modelsOpen = true) : this.openTraining()),
    })
  }

  private dispatch(ev: GameEvent): void {
    this.world.onEvent(ev, this.state)
  }
}

