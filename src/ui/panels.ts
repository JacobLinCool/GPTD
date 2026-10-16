import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W, HUD_H, LAT_CLASS_SLO } from '../config'
import {
  OUTCOMES,
  type CapabilityAxis,
  type GameState,
  type InfraCategory,
  type Outcome,
  type PostTrainMethod,
  type PostTrainTarget,
  type RequestTypeDef,
  type ServerHardwareDef,
  type SloCause,
  type Tower,
  type WaveReport,
  type WeightFormat,
} from '../core/types'
import { getMode, isExpert, setMode } from '../mode'
import { OUTCOME_STYLE, outcomeColor } from '../outcomes'
import { getSettings } from '../settings'
import { hardwareUpgradeCost, towerValue } from '../sim/actions'
import {
  HARDWARE_DEFS,
  INCIDENTS,
  INFRA_LIST,
  INFRA_NODES,
  REQUEST_LIST,
  REQUEST_TYPES,
  RESEARCH_DEFS,
  RESEARCH_LIST,
  TECH_PATHS,
  UPGRADES,
  WAVES,
  sizeLabel,
} from '../sim/content'
import { StudioTab } from './studio'
import { coolingPools } from '../sim/power'
import {
  activeSlotFor,
  requisitionPreview,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
} from '../sim/research'
import { alignmentTax, categoryUnlocked } from '../sim/safety'
import {
  cacheChance,
  guardPower,
  type Loadout,
  loadoutOf,
  serverFitsMemory,
  hwNeedsLiquid,
  hasLiquidLoop,
  serverPower,
  towerRangeTiles,
} from '../sim/effects'
import {
  deployCandidates,
  effectiveBatch,
  fmtDollarsPerMtoken,
  fmtKw,
  fmtLatencyMs,
  fmtTokens,
  fmtTokS,
  guardStats,
  honestGoodputPct,
  hwUpgradeDelta,
  judgedAxisQuality,
  latencyOf,
  modeSplit,
  nextFormatChoice,
  otherModeAxisQuality,
  parallelSummary,
  rackDollarsPerMtoken,
  rackFormatChoices,
  rolloutTargets,
  rooflineOf,
  sameTierTargets,
  selfHandleRate,
  sloBoundsOf,
  sparsityOf,
  typeFit,
  upcomingTraffic,
  upgradeAllPlan,
  vramOf,
  type DeployCandidate,
  type OutcomeTally,
  type TrafficEntry,
  type TypeFit,
  type UpcomingTraffic,
} from './metrics'
import { GoodputGauge, OUTCOME_CHAR, OutcomeBar, QualitySparks, qualityScale, RooflineBars, VramBar } from './charts'
import {
  cycleLang,
  getLang,
  incDesc,
  incName,
  LANG_LABEL,
  modelName,
  reqName,
  t,
  towerName,
  towerTagline,
  upDesc,
  upName,
  waveName,
} from '../i18n'
import { drawPanel, FocusList, label, UIButton } from './theme'
import { thinkingLine, thinkingPlain, thinkingToggle } from './thinkingCopy'
import { addTooltip, type TooltipSpec } from './tooltip'
import { DragScroll, fitLabel, INSPECT_MARGIN, INSPECT_W, setButton, setUiPref, uiPref } from './panelKit'

/* ----------------------- Inspect Panel ----------------------- */

export interface InspectCallbacks {
  onSell: (id: number) => void
  onDeploy: (id: number, modelId: string) => void
  onUpgradeHw: (id: number) => void
  onRole: (id: number) => void
  /** set the rack's weight format (undefined = auto) — between waves. */
  onPrecision: (id: number, fmt: WeightFormat | undefined) => void
}

type InspectTab = 'overview' | 'deploy' | 'stats'
const INSPECT_TABS: readonly InspectTab[] = ['overview', 'deploy', 'stats']
type DeploySort = 'best' | 'fast' | 'smart' | 'safe' | 'size'
const DEPLOY_SORTS: readonly DeploySort[] = ['best', 'fast', 'smart', 'safe', 'size']

/**
 * Cross-panel placement, resolved in one frame (the inspect panel updates before
 * the wave report): while the inspect panel docks on the left, the wave report
 * folds to its chip instead of sitting underneath it.
 */
const panelLayout = { inspectLeft: false, bannerBottom: 0 }

/** One titled card region inside the RackInspect panel (§5.2 S3). */
class Card {
  readonly view = new Container()
  private bg = new Graphics()
  private head = label('', 10, COLORS.textDim, 'bold')
  rows: Text[] = []
  constructor(
    private w: number,
    private nRows: number,
    private headColor: number = COLORS.sla,
    private rowStep = 14,
  ) {
    this.view.addChild(this.bg)
    this.head.x = 8
    this.head.y = 5
    this.view.addChild(this.head)
    for (let i = 0; i < nRows; i++) {
      const r = label('', 11, COLORS.text)
      r.x = 8
      r.y = 19 + i * this.rowStep
      this.rows.push(r)
      this.view.addChild(r)
    }
  }
  /** Lay out the card at (x,y) with `extra` px below the text rows (for charts). */
  draw(x: number, y: number, title: string, extra = 0): number {
    this.view.x = x
    this.view.y = y
    fitLabel(this.head, title, this.w - 16, 10)
    this.head.style.fill = this.headColor
    const h = 20 + this.nRows * this.rowStep + extra + 5
    this.bg.clear()
    drawPanel(this.bg, 0, 0, this.w, h, { alpha: 0.5, edge: this.headColor, radius: 6 })
    return h
  }
  set(i: number, text: string, fill: number = COLORS.text): void {
    if (i >= this.rows.length) return
    fitLabel(this.rows[i], text, this.w - 16, 11, 9)
    this.rows[i].style.fill = fill
  }
}

const INSPECT_TOP = HUD_H + INSPECT_MARGIN
const INSPECT_BOTTOM = DESIGN_H - BUILDBAR_H - INSPECT_MARGIN
const INSPECT_MAX_H = INSPECT_BOTTOM - INSPECT_TOP
const BODY_X = 14
const BODY_W = INSPECT_W - 28
/** action-bar geometry: the wide primary button and the narrow one beside it. */
const BAR_GAP = 6
const BAR_NARROW = 108
const BAR_WIDE = BODY_W - BAR_NARROW - BAR_GAP
/** deploy-picker row geometry (rows are pooled and bound to the visible window). */
const DEP_ROW_H = 44
const DEP_ROW_STEP = 48
const SELL_ARM_MS = 2500

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Per-token / first-token colors against the IN (40 / 400 ms) and NR (200 / 2000 ms) bounds. */
function tpotColor(ms: number): number {
  return ms <= LAT_CLASS_SLO.IN.tpotMs ? COLORS.good : ms <= LAT_CLASS_SLO.NR.tpotMs ? COLORS.warn : COLORS.danger
}
function ttftColor(ms: number): number {
  return ms <= LAT_CLASS_SLO.IN.ttftMs ? COLORS.good : ms <= LAT_CLASS_SLO.NR.ttftMs ? COLORS.warn : COLORS.danger
}

/** A short localized archetype name for compact lists ("Chat", "Code", "RAG"). */
function reqShort(def: RequestTypeDef): string {
  return t(`reqshort.${def.id}`, undefined, reqName(def))
}

/** "40 Chat · 12 Code · 3 RAG …" (most numerous first). */
function trafficMix(tr: UpcomingTraffic, max = 4): string {
  const parts = tr.entries.slice(0, max).map((e) => `${e.count} ${reqShort(e.def)}`)
  return parts.join(' · ') + (tr.entries.length > max ? ' …' : '')
}

/** Every archetype at its base size — the stand-in when no next wave is known. */
function typicalTraffic(): TrafficEntry[] {
  return REQUEST_LIST.map((def) => ({
    def,
    count: 1,
    difficulty: def.difficulty[def.primaryAxis] ?? 0,
    context: def.context,
    inputTokens: def.inputTokens,
    outputTokens: def.outputTokens,
  }))
}

/** The rack's power / liquid / training status chip. */
function rackStatus(s: GameState, tw: Tower, lo: Loadout | null): { text: string; fill: number } {
  if (tw.training) return { text: t('rack.state.training'), fill: COLORS.data }
  if (!tw.online) {
    const gated = !!lo && hwNeedsLiquid(lo.hw) && !hasLiquidLoop(s)
    return { text: t(gated ? 'rack.state.liquidGate' : 'rack.state.brownout'), fill: COLORS.danger }
  }
  if (tw.throttle < 1) return { text: t('rack.state.throttle'), fill: COLORS.warn }
  return { text: t('rack.state.online'), fill: COLORS.good }
}

function hwShort(hw: ServerHardwareDef): string {
  return t(`hw.${hw.id}.short`, undefined, hw.name.replace(' GPU Rack', ''))
}

function fmtUsd(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1)
}

/** One pooled row of the deploy picker: name + badges, then speed / smart / safe readouts. */
class DeployRow extends Container {
  readonly bg = new Graphics()
  readonly nameT = label('', 12, COLORS.text, 'bold')
  readonly sizeT = label('', 10, COLORS.textDim)
  readonly badgeT = label('', 9, COLORS.data, 'bold')
  readonly speedT = label('', 10, COLORS.text)
  readonly smartT = label('', 10, COLORS.text)
  readonly safeT = label('', 10, COLORS.text)
  readonly allBtn: UIButton
  cand: DeployCandidate | null = null
  boundKey = ''
  hovered = false
  private canAct = true

  constructor(onAll: (row: DeployRow) => void) {
    super()
    this.allBtn = new UIButton({ w: 58, h: 18, accent: COLORS.data, radius: 5, onTap: () => onAll(this) })
    this.allBtn.x = BODY_W - 64
    this.allBtn.y = 5
    this.addChild(this.bg, this.nameT, this.sizeT, this.badgeT, this.speedT, this.smartT, this.safeT, this.allBtn)
    this.nameT.x = 10
    this.nameT.y = 6
    this.sizeT.y = 8
    this.badgeT.y = 8
    this.speedT.x = 10
    this.smartT.x = 96
    this.safeT.x = 196
    for (const tx of [this.speedT, this.smartT, this.safeT]) tx.y = 26
    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.on('pointerover', () => {
      this.hovered = true
      this.redraw()
    })
    this.on('pointerout', () => {
      this.hovered = false
      this.redraw()
    })
  }

  /** Bind a candidate (copy changes only when the binding key changes). */
  bind(c: DeployCandidate, key: string, allCount: number, canAct: boolean): void {
    if (this.boundKey === key) return
    this.boundKey = key
    this.cand = c
    const m = c.model
    const size =
      m.paramsActiveB < m.paramsTotalB
        ? `${sizeLabel(m.paramsTotalB)}·${sizeLabel(m.paramsActiveB)}`
        : sizeLabel(m.paramsTotalB)
    this.allBtn.visible = c.fits && allCount >= 2
    // line 1: ★ name · size · THINKS (· ✓ loaded), with ALL ×N pinned right
    this.sizeT.text = c.current ? `${size}  ${t('inspect.dep.loaded')}` : size
    this.sizeT.style.fill = c.current ? COLORS.good : COLORS.textDim
    // §1.4 THINKS = always thinks (slow on chat); HYBRID = instant on interactive traffic
    this.badgeT.text = c.thinking === 'always' ? t('inspect.dep.think') : c.thinking === 'hybrid' ? t('inspect.dep.hybrid') : ''
    this.badgeT.style.fill = c.thinking === 'always' ? COLORS.warn : COLORS.data
    const right = this.allBtn.visible ? this.allBtn.x - 8 : BODY_W - 8
    const tail = this.sizeT.width + (this.badgeT.text ? this.badgeT.width + 6 : 0) + 8
    fitLabel(this.nameT, `${c.recommended ? '★ ' : ''}${modelName(m)}`, Math.max(60, right - 10 - tail), 12, 10)
    this.nameT.style.fill = c.recommended ? COLORS.cash : c.fits ? COLORS.text : COLORS.textDim
    this.sizeT.x = this.nameT.x + this.nameT.width + 8
    this.badgeT.x = this.sizeT.x + this.sizeT.width + 6
    if (c.fits) {
      this.speedT.text = t('inspect.dep.speed', { v: fmtTokS(c.perUserTokS) })
      this.speedT.style.fill = tpotColor(c.tpotMs)
      this.smartT.text = c.kinds
        ? t('inspect.dep.smart', { q: c.judgedQ.toFixed(0), k: c.clears, n: c.kinds })
        : t('inspect.dep.smartQ', { q: c.judgedQ.toFixed(0) })
      this.smartT.style.fill = !c.kinds
        ? COLORS.text
        : c.clears === c.kinds
          ? COLORS.good
          : c.clears > 0
            ? COLORS.warn
            : COLORS.danger
      this.safeT.text = t('inspect.dep.safe', { s: c.safety.toFixed(0), p: Math.round(c.overRefusal * 100) })
      this.safeT.style.fill = c.overRefusal <= 0.05 ? COLORS.good : c.overRefusal <= 0.12 ? COLORS.trust : COLORS.warn
    } else {
      // a model that would span this rack's GPUs is blocked by the parallelism research, not VRAM
      this.speedT.text =
        c.blocker === 'tp' || c.blocker === 'pp'
          ? t(c.blocker === 'tp' ? 'inspect.dep.needsTp' : 'inspect.dep.needsPp', { g: c.spanGpus })
          : c.needHw
            ? t('inspect.dep.needs', { gb: c.needGb.toFixed(0), hw: hwShort(c.needHw) })
            : t('inspect.dep.needsNone', { gb: c.needGb.toFixed(0) })
      this.speedT.style.fill = COLORS.textDim
      this.smartT.text = ''
      this.safeT.text = ''
    }
    if (this.allBtn.visible) setButton(this.allBtn, t('inspect.dep.all', { n: allCount }))
    this.allBtn.setEnabled(canAct)
    this.redraw(canAct)
  }

  redraw(canAct = this.canAct): void {
    this.canAct = canAct
    const c = this.cand
    const g = this.bg
    g.clear()
    if (!c) return
    const live = c.fits && !c.current && canAct
    const base = c.current ? 0x1a2c44 : this.hovered && live ? 0x182640 : COLORS.panel
    g.roundRect(0, 0, BODY_W, DEP_ROW_H, 6).fill({ color: base, alpha: c.fits ? 0.96 : 0.5 })
    g.roundRect(0.5, 0.5, BODY_W - 1, DEP_ROW_H - 1, 6).stroke({
      width: c.current ? 2 : 1,
      color: c.current ? COLORS.data : COLORS.panelEdge,
      alpha: c.fits ? 1 : 0.5,
    })
    this.cursor = live ? 'pointer' : 'default'
  }
}

/**
 * S3 RackInspect (§5.2). A fixed header (name, model, status chip) and a fixed
 * action bar (RACK → with its real deltas, SELL with a two-step confirm, UPGRADE
 * ALL, ROLE) that never scroll, then a scrollable tab body:
 *  - OVERVIEW — Normal: plain-language rows ("Fast enough for: chat ✓ code ✗",
 *    "Smart enough for…", tok/s per user, refusal + self-handle rates) and the
 *    five-axis bars with the next wave's difficulty marked; Expert: the HARDWARE
 *    and DEPLOYED MODEL cards plus the same next-wave fit rows.
 *  - DEPLOY — the deploy picker: every owned checkpoint scored on THIS rack
 *    against the upcoming traffic (per-user speed vs the TPOT bounds, judged-axis
 *    quality and archetypes cleared, safety + over-refusal, thinking badge, ★ the
 *    best fit), sortable Best / Fast / Smart / Safe / Size, with the checkpoints
 *    that need a bigger rack greyed and labelled. Shift-click (or ALL ×N) rolls a
 *    model out to every rack of the tier; Shift+Ctrl/⌘ to every rack it fits.
 *  - TELEMETRY (Expert) — the ROOFLINE card and the labelled ESTIMATE card.
 * Non-server buildings keep a compact line panel (guards show their effective
 * recall, over-refusal, side and per-hazard lock state). Model swaps and rack
 * upgrades are build-phase actions; the panel docks on the side of the board
 * opposite the selected building.
 */
export class InspectPanel {
  readonly view = new Container()
  private bg = new Graphics()
  private bodyHost = new Container()
  private content = new Container()
  private contentMask = new Graphics()
  private scrollChrome = new Graphics()
  private title = label('', 15, COLORS.textBright, 'bold')
  private tag = label('', 12, COLORS.textDim)
  private chip = label('', 11, COLORS.good, 'bold')
  // fixed action bar
  private hwBtn: UIButton
  private sellBtn: UIButton
  private sellWide: UIButton
  private upAllBtn: UIButton
  private roleBtn: UIButton
  private fmtBtn: UIButton
  private tabBtns: { tab: InspectTab; narrow: UIButton; wide: UIButton }[] = []
  // body: free text rows (Normal overview, next-wave fit, non-server lines)
  private lines: Text[] = []
  private sparksHead = label('', 10, COLORS.textDim, 'bold')
  private sparks = new QualitySparks(BODY_W - 16, 13)
  // expert cards
  private cardHw = new Card(BODY_W, 4, COLORS.power)
  private cardModel = new Card(BODY_W, 7, COLORS.data)
  private cardRoof = new Card(BODY_W, 0, COLORS.cooling)
  private cardLive = new Card(BODY_W, 7, COLORS.good)
  private roofBars = new RooflineBars(BODY_W - 16)
  private vramBar = new VramBar(BODY_W - 16)
  // deploy picker
  private depHint = label('', 11, COLORS.textDim)
  private sortBtns: { sort: DeploySort; btn: UIButton }[] = []
  private rows: DeployRow[] = []
  private listTop = 0
  private drag: DragScroll

  private cb: InspectCallbacks
  private tab: InspectTab = uiPref('inspect.tab', 'overview', INSPECT_TABS)
  private sort: DeploySort = uiPref('inspect.sort', 'best', DEPLOY_SORTS)
  private scroll = 0
  private maxScroll = 0
  private bodyTop = 0
  private bodyH = 0
  private contentH = 0
  private curId: number | null = null
  private lastSelectedId: number | null = null
  private wasVisible = false
  private state: GameState | null = null
  private sellArmedUntil = 0
  // memoized compute (recomputed only when its inputs change)
  private trafficKey = ''
  private traffic: UpcomingTraffic | null = null
  private fitKey = ''
  private fits: { entry: TrafficEntry; fit: TypeFit }[] = []
  private candKey = ''
  private cands: DeployCandidate[] = []
  private allCounts = new Map<string, number>()

  constructor(cb: InspectCallbacks) {
    this.cb = cb
    this.view.x = DESIGN_W - INSPECT_W - INSPECT_MARGIN
    this.view.y = INSPECT_TOP
    this.view.addChild(this.bg, this.contentMask, this.bodyHost, this.scrollChrome)
    this.bodyHost.addChild(this.content)
    this.content.mask = this.contentMask
    this.view.eventMode = 'static'
    this.view.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= INSPECT_W && y >= 0 && y <= this.visibleH }
    this.bodyHost.eventMode = 'static'
    this.bodyHost.hitArea = {
      contains: (x: number, y: number) => x >= 0 && x <= INSPECT_W && y >= this.bodyTop && y <= this.bodyTop + this.bodyH,
    }
    this.drag = new DragScroll(this.bodyHost, {
      get: () => this.scroll,
      set: (v) => {
        this.scroll = clamp(v, 0, this.maxScroll)
        this.layoutScroll()
      },
    })
    for (const tx of [this.title, this.tag, this.chip]) this.view.addChild(tx)
    this.title.x = BODY_X
    this.title.y = 10
    this.tag.x = BODY_X
    this.tag.y = 32
    this.chip.y = 13

    this.hwBtn = new UIButton({ w: BAR_WIDE, h: 36, accent: COLORS.power, onTap: () => this.doUpgrade() })
    this.sellBtn = new UIButton({ w: BAR_NARROW, h: 36, accent: COLORS.warn, onTap: () => this.doSell() })
    this.sellWide = new UIButton({ w: BODY_W, h: 32, accent: COLORS.warn, onTap: () => this.doSell() })
    this.upAllBtn = new UIButton({ w: BAR_WIDE, h: 30, accent: COLORS.power, onTap: () => this.doUpgradeAll() })
    this.roleBtn = new UIButton({ w: BAR_NARROW, h: 30, accent: COLORS.cooling, onTap: () => this.doRole() })
    this.fmtBtn = new UIButton({ w: BODY_W, h: 30, accent: COLORS.data, onTap: () => this.doPrecision() })
    this.hwBtn.x = BODY_X
    this.sellBtn.x = BODY_X + BAR_WIDE + BAR_GAP
    this.sellWide.x = BODY_X
    this.upAllBtn.x = BODY_X
    this.roleBtn.x = BODY_X + BAR_WIDE + BAR_GAP
    this.fmtBtn.x = BODY_X
    this.view.addChild(this.hwBtn, this.sellBtn, this.sellWide, this.upAllBtn, this.roleBtn, this.fmtBtn)
    addTooltip(this.hwBtn, () => this.hwTooltip())
    addTooltip(this.fmtBtn, () => ({ title: t('inspect.fmt.tip.title'), body: t('inspect.fmt.tip.body') }))

    INSPECT_TABS.forEach((tab, i) => {
      const narrowW = (BODY_W - 2 * BAR_GAP) / 3
      const wideW = (BODY_W - BAR_GAP) / 2
      const narrow = new UIButton({ w: narrowW, h: 24, accent: COLORS.sla, onTap: () => this.setTab(tab) })
      const wide = new UIButton({ w: wideW, h: 24, accent: COLORS.sla, onTap: () => this.setTab(tab) })
      narrow.x = BODY_X + i * (narrowW + BAR_GAP)
      wide.x = BODY_X + i * (wideW + BAR_GAP)
      this.view.addChild(narrow, wide)
      this.tabBtns.push({ tab, narrow, wide })
    })

    for (let i = 0; i < 14; i++) {
      const tx = label('', 12, COLORS.text)
      tx.style.wordWrap = true
      tx.style.wordWrapWidth = BODY_W
      tx.style.lineHeight = 16
      tx.x = BODY_X
      this.lines.push(tx)
      this.content.addChild(tx)
    }
    this.sparksHead.x = BODY_X
    this.sparksHead.style.wordWrap = true
    this.sparksHead.style.wordWrapWidth = BODY_W
    this.cardRoof.view.addChild(this.roofBars, this.vramBar)
    this.content.addChild(this.sparksHead, this.sparks, this.cardHw.view, this.cardModel.view, this.cardRoof.view, this.cardLive.view)

    this.depHint.x = BODY_X
    this.depHint.style.wordWrap = true
    this.depHint.style.wordWrapWidth = BODY_W
    this.depHint.style.lineHeight = 15
    this.content.addChild(this.depHint)
    DEPLOY_SORTS.forEach((sort, i) => {
      const chipW = (BODY_W - 4 * 5) / 5
      const btn = new UIButton({ w: chipW, h: 22, accent: COLORS.cash, radius: 5, onTap: () => this.setSort(sort) })
      btn.x = BODY_X + i * (chipW + 5)
      this.content.addChild(btn)
      this.sortBtns.push({ sort, btn })
    })
    this.view.visible = false
  }

  private get visibleH(): number {
    return Math.min(INSPECT_MAX_H, this.bodyTop + this.contentH + 10)
  }

  private setTab(tab: InspectTab): void {
    this.tab = tab
    this.scroll = 0
    setUiPref('inspect.tab', tab)
  }

  /** PgUp / PgDn (dir ±1; ±2 jumps to an end): scroll the open body (the deploy picker's long list). */
  page(dir: number): boolean {
    if (!this.view.visible || this.maxScroll <= 0) return false
    const step = Math.abs(dir) >= 2 ? this.maxScroll : this.bodyH * 0.85
    this.scroll = clamp(this.scroll + Math.sign(dir) * step, 0, this.maxScroll)
    this.layoutScroll()
    return true
  }

  /** [ / ] on a selected rack: the previous / next tab it shows (Telemetry is Expert-only). */
  cycleTab(dir: number): boolean {
    if (!this.view.visible || !this.curIsServer) return false
    const tabs = isExpert() ? INSPECT_TABS : INSPECT_TABS.filter((x) => x !== 'stats')
    const i = Math.max(0, tabs.indexOf(this.tab))
    this.setTab(tabs[(i + dir + tabs.length) % tabs.length])
    return true
  }

  private setSort(sort: DeploySort): void {
    if (this.drag.swallowTap) return
    this.sort = sort
    this.scroll = 0
    this.candKey = ''
    setUiPref('inspect.sort', sort)
  }

  private get selected(): Tower | undefined {
    return this.curId == null ? undefined : this.state?.towers.find((x) => x.id === this.curId)
  }

  /** SELL, with an optional two-step arm (Settings ▸ Gameplay ▸ confirm before selling). */
  private doSell(): void {
    const tw = this.selected
    if (!tw) return
    const now = performance.now()
    if (getSettings().gameplay.confirmSell && now >= this.sellArmedUntil) {
      this.sellArmedUntil = now + SELL_ARM_MS
      return
    }
    this.sellArmedUntil = 0
    this.cb.onSell(tw.id)
  }

  private doUpgrade(): void {
    const tw = this.selected
    if (tw && this.state?.phase === 'build') this.cb.onUpgradeHw(tw.id)
  }

  /** UPGRADE ALL: climb every rack of this tier one step, in id order, while the cash lasts. */
  private doUpgradeAll(): void {
    const s = this.state
    const tw = this.selected
    if (!s || !tw || s.phase !== 'build') return
    const plan = upgradeAllPlan(s, tw)
    if (!plan || plan.needsLiquid) return
    const fromHw = tw.hwId
    for (const id of plan.ids) {
      const t = s.towers.find((x) => x.id === id)
      if (!t || t.hwId !== fromHw) continue
      if (s.meters.cash < hardwareUpgradeCost(s, t)) break
      this.cb.onUpgradeHw(id)
    }
  }

  private doRole(): void {
    const tw = this.selected
    if (tw) this.cb.onRole(tw.id)
  }

  /** Cycle the rack's weight format: auto → each researched format the model fits in → auto. */
  private doPrecision(): void {
    const s = this.state
    const tw = this.selected
    if (!s || !tw || s.phase !== 'build') return
    const next = nextFormatChoice(s, tw)
    if (next) this.cb.onPrecision(tw.id, next.setting)
  }

  /** Deploy picker row tap: this rack; Shift → every rack of the tier; Shift+Ctrl/⌘ → every rack it fits. */
  private onRowTap(row: DeployRow, e: FederatedPointerEvent): void {
    if (this.drag.swallowTap) return
    let o: Container | null = e.target as Container | null
    while (o && o !== row) {
      if (o === row.allBtn) return
      o = o.parent
    }
    const c = row.cand
    if (!c || !c.fits || c.current) return
    if (e.shiftKey && (e.ctrlKey || e.metaKey)) this.rollout(c.model.id, 'all')
    else if (e.shiftKey) this.rollout(c.model.id, 'tier')
    else {
      const tw = this.selected
      if (tw && (this.state?.phase === 'build' || c.hotSwap)) this.cb.onDeploy(tw.id, c.model.id)
    }
  }

  private rollout(modelId: string, scope: 'tier' | 'all'): void {
    const s = this.state
    const tw = this.selected
    if (!s || !tw || s.phase !== 'build') return
    const targets = scope === 'tier' ? sameTierTargets(s, tw, modelId) : rolloutTargets(s, modelId)
    for (const t of targets) this.cb.onDeploy(t.id, modelId)
  }

  private addRow(): DeployRow {
    const row = new DeployRow((r) => {
      if (!this.drag.swallowTap && r.cand) this.rollout(r.cand.model.id, 'tier')
    })
    row.x = BODY_X
    row.on('pointertap', (e: FederatedPointerEvent) => this.onRowTap(row, e))
    addTooltip(row, () => this.rowTooltip(row))
    this.content.addChild(row)
    this.rows.push(row)
    return row
  }

  private layoutScroll(): void {
    this.content.y = this.bodyTop - this.scroll
    this.scrollChrome.clear()
    if (this.tab === 'deploy' && this.curIsServer) this.bindRows()
    if (this.maxScroll <= 0) return
    const trackX = INSPECT_W - 8
    const trackY = this.bodyTop + 2
    const trackH = this.bodyH - 4
    const thumbH = Math.max(24, (trackH * this.bodyH) / (this.contentH + 1))
    const thumbY = trackY + ((trackH - thumbH) * this.scroll) / this.maxScroll
    this.scrollChrome.roundRect(trackX, trackY, 3, trackH, 2).fill({ color: COLORS.panelEdge, alpha: 0.45 })
    this.scrollChrome.roundRect(trackX - 1, thumbY, 5, thumbH, 2).fill({ color: COLORS.sla, alpha: 0.85 })
  }

  private curIsServer = false

  /** Docked on the left edge (a building on the right half is selected): the Codex corner is covered. */
  get dockedLeft(): boolean {
    return this.view.visible && panelLayout.inspectLeft
  }

  /** Slide to the side of the board opposite the selected building (instant under reduced motion). */
  private dock(tw: Tower, snap: boolean): void {
    const left = tw.x > DESIGN_W / 2
    panelLayout.inspectLeft = left
    const target = left ? INSPECT_MARGIN : DESIGN_W - INSPECT_W - INSPECT_MARGIN
    const dx = target - this.view.x
    if (snap || getSettings().a11y.reducedMotion || Math.abs(dx) < 1) this.view.x = target
    else this.view.x += dx * 0.3
  }

  update(s: GameState, selectedId: number | null): void {
    if (s !== this.state) {
      // a new run: nothing memoized against the previous state may survive
      this.trafficKey = ''
      this.fitKey = ''
      this.candKey = ''
    }
    this.state = s
    const tw = selectedId == null ? undefined : s.towers.find((x) => x.id === selectedId)
    this.view.visible = !!tw
    if (!tw) {
      this.curId = null
      this.lastSelectedId = null
      this.wasVisible = false
      panelLayout.inspectLeft = false
      return
    }
    this.curId = tw.id
    if (this.lastSelectedId !== tw.id) {
      this.lastSelectedId = tw.id
      this.scroll = 0
      this.sellArmedUntil = 0
    }
    this.dock(tw, !this.wasVisible)
    this.wasVisible = true

    const isServer = tw.def.kind === 'server'
    this.curIsServer = isServer
    const expert = isExpert()
    if (!expert && this.tab === 'stats') this.tab = 'overview'
    const lo = isServer ? loadoutOf(s, tw) : null

    const trKey = `${s.phase}|${s.waveIndex}|${s.modifiers.volume}|${s.endless}|${s.currentWave?.name ?? ''}`
    if (trKey !== this.trafficKey) {
      this.trafficKey = trKey
      this.traffic = upcomingTraffic(s)
      this.fitKey = ''
      this.candKey = ''
    }
    if (isServer) this.refreshCandidates(s, tw)

    // ---- header ----
    if (isServer && lo) {
      fitLabel(this.title, lo.hw ? t(`hw.${lo.hw.id}.name`, undefined, lo.hw.name) : towerName(tw.def), 250, 15, 12)
      fitLabel(this.tag, lo.model ? modelName(lo.model) : towerTagline(tw.def), BODY_W, 12, 10)
      const st = rackStatus(s, tw, lo)
      this.chip.visible = true
      fitLabel(this.chip, st.text, 112, 11, 9)
      this.chip.style.fill = st.fill
      this.chip.x = INSPECT_W - BODY_X - this.chip.width
    } else {
      fitLabel(this.title, towerName(tw.def), tw.online ? BODY_W : 250, 15, 12)
      fitLabel(this.tag, towerTagline(tw.def), BODY_W, 12, 10)
      this.chip.visible = !tw.online
      if (!tw.online) {
        fitLabel(this.chip, t('rack.state.brownout'), 112, 11, 9)
        this.chip.style.fill = COLORS.danger
        this.chip.x = INSPECT_W - BODY_X - this.chip.width
      }
    }

    // ---- fixed action bar ----
    let y = 54
    this.hwBtn.visible = isServer
    this.sellBtn.visible = isServer
    this.sellWide.visible = !isServer
    const armed = performance.now() < this.sellArmedUntil
    const value = towerValue(s, tw)
    const refund = Math.round(value * 0.6)
    const loss = Math.max(0, value - refund)
    if (isServer && lo) {
      this.hwBtn.y = y
      this.sellBtn.y = y
      this.layoutHwButton(s, tw)
      setButton(
        this.sellBtn,
        t(armed ? 'inspect.sellConfirm' : 'inspect.sellTitle'),
        armed ? t('inspect.sellLoss', { v: refund, loss }) : t('inspect.sellRefund', { v: refund }),
      )
      this.sellBtn.setAccent(armed ? COLORS.danger : COLORS.warn).setActive(armed)
      y += 42
      const plan = upgradeAllPlan(s, tw)
      const roleVisible = s.infra.disagg
      this.upAllBtn.visible = !!plan
      this.roleBtn.visible = roleVisible
      if (plan || roleVisible) {
        this.upAllBtn.y = y
        this.roleBtn.y = y
        if (plan) {
          setButton(
            this.upAllBtn,
            t('inspect.upAll', { n: plan.ids.length, name: hwShort(plan.to), total: plan.total }),
            plan.needsLiquid
              ? t('inspect.liquidGate')
              : plan.affordable < plan.ids.length
                ? t('inspect.upAll.afford', { k: plan.affordable, n: plan.ids.length })
                : '',
          )
          this.upAllBtn.setEnabled(s.phase === 'build' && !plan.needsLiquid && plan.affordable > 0)
        }
        if (roleVisible) {
          const role = tw.role ?? 'auto'
          setButton(this.roleBtn, t('inspect.role.' + role))
          this.roleBtn.setActive(role !== 'auto').setEnabled(s.phase === 'build')
        }
        y += 36
      }
      // §4.5 the rack's weight format, once more than one is on the table
      const fmts = rackFormatChoices(s, tw)
      this.fmtBtn.visible = fmts.length > 2
      if (this.fmtBtn.visible) {
        const cur = fmts.find((c) => c.setting === tw.precision) ?? fmts[0]
        const name = t('fmt.' + cur.format)
        setButton(
          this.fmtBtn,
          t(tw.precision === undefined ? 'inspect.fmt.auto' : 'inspect.fmt', { fmt: name }),
          cur.tax > 0 ? t('inspect.fmt.sub.tax', { q: cur.tax }) : t('inspect.fmt.sub.lossless'),
        )
        this.fmtBtn.y = y
        this.fmtBtn.setActive(tw.precision !== undefined).setEnabled(s.phase === 'build' && !!nextFormatChoice(s, tw))
        y += 36
      }
      const tabs = expert ? INSPECT_TABS : INSPECT_TABS.filter((x) => x !== 'stats')
      const fitting = this.cands.reduce((n, c) => n + (c.fits ? 1 : 0), 0)
      for (const tb of this.tabBtns) {
        const shown = tabs.includes(tb.tab)
        tb.narrow.visible = shown && expert
        tb.wide.visible = shown && !expert
        if (!shown) continue
        const btn = expert ? tb.narrow : tb.wide
        btn.y = y
        setButton(btn, t('inspect.tab.' + tb.tab, { n: fitting }))
        btn.setActive(this.tab === tb.tab)
      }
      y += 30
    } else {
      this.upAllBtn.visible = false
      this.roleBtn.visible = false
      this.fmtBtn.visible = false
      for (const tb of this.tabBtns) {
        tb.narrow.visible = false
        tb.wide.visible = false
      }
      this.sellWide.y = y
      setButton(
        this.sellWide,
        armed ? t('inspect.sellConfirm') : t('inspect.sell', { v: refund }),
        armed ? t('inspect.sellLoss', { v: refund, loss }) : '',
      )
      this.sellWide.setAccent(armed ? COLORS.danger : COLORS.warn).setActive(armed)
      y += 38
    }
    this.bodyTop = y

    // ---- body ----
    const showTab: InspectTab = isServer ? this.tab : 'overview'
    this.setBodyVisible(showTab, isServer, expert)
    let h = 0
    if (!isServer) h = this.layoutLines(statLines(s, tw), 0)
    else if (lo && showTab === 'overview') h = expert ? this.drawExpertOverview(s, tw, lo) : this.drawNormalOverview(s, tw, lo)
    else if (lo && showTab === 'stats') h = this.drawTelemetry(s, tw, lo)
    else if (lo) h = this.drawDeploy(s)
    this.contentH = h

    const visibleH = this.visibleH
    this.bodyH = Math.max(0, visibleH - this.bodyTop - 6)
    this.maxScroll = Math.max(0, h - this.bodyH)
    this.scroll = clamp(this.scroll, 0, this.maxScroll)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, INSPECT_W, visibleH)
    this.contentMask.clear()
    this.contentMask.rect(0, this.bodyTop, INSPECT_W, this.bodyH).fill({ color: COLORS.white, alpha: 0 })
    this.layoutScroll()
  }

  private setBodyVisible(tab: InspectTab, isServer: boolean, expert: boolean): void {
    const ov = isServer && tab === 'overview'
    this.cardHw.view.visible = ov && expert
    this.cardModel.view.visible = ov && expert
    this.cardRoof.view.visible = isServer && tab === 'stats'
    this.cardLive.view.visible = isServer && tab === 'stats'
    this.sparksHead.visible = ov && !expert
    this.sparks.visible = ov
    // the five-axis bars live in the model card (Expert) or on the body (Normal)
    const sparksParent = expert ? this.cardModel.view : this.content
    if (this.sparks.parent !== sparksParent) sparksParent.addChild(this.sparks)
    const dep = isServer && tab === 'deploy'
    this.depHint.visible = dep
    for (const sb of this.sortBtns) sb.btn.visible = dep
    if (!dep) for (const r of this.rows) r.visible = false
  }

  /** Place free text rows top-down from `y0`; returns the bottom. An empty entry is a spacer. */
  private layoutLines(ls: { text: string; fill: number }[], y0: number): number {
    let y = y0
    for (let i = 0; i < this.lines.length; i++) {
      const row = this.lines[i]
      const line = ls[i]
      if (!line || !line.text) {
        row.visible = false
        if (line) y += 6
        continue
      }
      row.visible = true
      row.text = line.text
      row.style.fill = line.fill
      row.y = y
      y += row.height + 4
    }
    return y + 4
  }

  private hwTooltip(): TooltipSpec {
    const s = this.state
    const tw = this.selected
    const d = s && tw ? hwUpgradeDelta(s, tw) : null
    if (!d) return { title: t('inspect.hwMaxed') }
    return {
      title: t('inspect.hwTip.title', { name: t(`hw.${d.to.id}.name`, undefined, d.to.name) }),
      value: `+$${d.cost}`,
      body: t('inspect.hwTip.body', {
        v0: d.from.hbmGb,
        v1: d.to.hbmGb,
        b0: d.from.hbmTbs.toFixed(2),
        b1: d.to.hbmTbs.toFixed(2),
        mul: d.decodeMul.toFixed(1),
        k0: d.kwFrom.toFixed(1),
        k1: d.kwTo.toFixed(1),
        h0: fmtUsd(d.from.gpuHrUsd),
        h1: fmtUsd(d.to.gpuHrUsd),
      }),
    }
  }

  private layoutHwButton(s: GameState, tw: Tower): void {
    const d = hwUpgradeDelta(s, tw)
    if (!d) {
      setButton(this.hwBtn, t('inspect.hwMaxed'), '')
      this.hwBtn.setEnabled(false)
      return
    }
    const sub =
      s.phase !== 'build'
        ? t('inspect.betweenWaves')
        : d.needsLiquid
          ? t('inspect.liquidGate')
          : t('inspect.hwDelta', {
              v0: d.from.hbmGb,
              v1: d.to.hbmGb,
              mul: d.decodeMul.toFixed(1),
              kw: (d.kwTo - d.kwFrom).toFixed(1),
            })
    setButton(this.hwBtn, t('inspect.upgradeHw', { name: hwShort(d.to), cost: d.cost }), sub)
    this.hwBtn.setEnabled(s.phase === 'build' && !d.needsLiquid && s.meters.cash >= d.cost)
  }

  /** Per-archetype verdicts for the loaded model on this rack (memoized on rack + research + traffic). */
  private rackFits(s: GameState, tw: Tower, lo: Loadout): { entry: TrafficEntry; fit: TypeFit }[] {
    const key = `${tw.id}|${tw.hwId}|${tw.modelId}|${tw.precision ?? ''}|${JSON.stringify(s.infra)}|${this.trafficKey}`
    if (key !== this.fitKey) {
      this.fitKey = key
      const entries = this.traffic?.entries.length ? this.traffic.entries : typicalTraffic()
      this.fits = entries.map((entry) => ({ entry, fit: typeFit(s, lo, entry) }))
    }
    return this.fits
  }

  /** "Next wave (12): 40 Chat · 12 Code" — what the fit rows are judged against. */
  private trafficCaption(): string {
    const tr = this.traffic
    if (!tr || !tr.entries.length) return t('inspect.n.trafficNone')
    return t(tr.live ? 'inspect.n.trafficLive' : 'inspect.n.traffic', { n: tr.waveIndex + 1, mix: trafficMix(tr) })
  }

  private fitRows(s: GameState, tw: Tower, lo: Loadout): { text: string; fill: number }[] {
    if (!serverFitsMemory(s, lo)) return [{ text: t('inspect.noMemory'), fill: COLORS.danger }]
    const fits = this.rackFits(s, tw, lo)
    const fastList = fits.map((f) => `${reqShort(f.entry.def)} ${f.fit.fast && f.fit.window ? '✓' : '✗'}`).join('  ')
    const smartList = fits.map((f) => `${reqShort(f.entry.def)} ${f.fit.smart ? '✓' : '✗'}`).join('  ')
    const allFast = fits.every((f) => f.fit.fast && f.fit.window)
    const allSmart = fits.every((f) => f.fit.smart)
    return [
      { text: this.trafficCaption(), fill: COLORS.textDim },
      { text: t('inspect.n.fast', { list: fastList }), fill: allFast ? COLORS.good : COLORS.warn },
      { text: t('inspect.n.smart', { list: smartList }), fill: allSmart ? COLORS.good : COLORS.warn },
    ]
  }

  /** The difficulty marks for the five-axis bars: the hardest upcoming request per judged axis. */
  private axisTicks(): Partial<Record<CapabilityAxis, number>> {
    const ticks: Partial<Record<CapabilityAxis, number>> = {}
    for (const e of this.traffic?.entries ?? []) {
      const a = e.def.primaryAxis
      ticks[a] = Math.max(ticks[a] ?? 0, e.difficulty)
    }
    return ticks
  }

  /** Normal Mode: the same rack in plain words — fast enough? smart enough? safe? */
  private drawNormalOverview(s: GameState, tw: Tower, lo: Loadout): number {
    const out: { text: string; fill: number }[] = []
    const m = lo.model
    const fits = serverFitsMemory(s, lo)
    if (m && fits) {
      const lat = latencyOf(s, lo, 1500, 256)
      out.push({
        text: t('inspect.n.speed', { v: fmtTokS(lat.perUserDecodeTokS), b: Math.max(1, effectiveBatch(s, lo)) }),
        fill: tpotColor(lat.tpotMs),
      })
    }
    out.push(...this.fitRows(s, tw, lo))
    if (m) {
      out.push({ text: thinkingPlain(m), fill: m.thinking === 'always' ? COLORS.warn : COLORS.data })
      out.push({
        text: t('inspect.n.refuses', { p: Math.round(m.alignment.overRefusal * 100) }),
        fill: m.alignment.overRefusal <= 0.05 ? COLORS.good : COLORS.trust,
      })
      const jb = REQUEST_TYPES.jailbreak
      if (jb) out.push({ text: t('inspect.n.selfHandle', { p: Math.round(selfHandleRate(m, jb) * 100) }), fill: COLORS.trust })
    }
    if (!s.infra.scheduling.batch) out.push({ text: t('inspect.n.batch1'), fill: COLORS.sla })
    out.push({
      text: t('inspect.n.power', { p: serverPower(s, lo).toFixed(1), r: towerRangeTiles(tw).toFixed(1) }),
      fill: COLORS.textDim,
    })
    let y = this.layoutLines(out, 0)
    if (m && fits) {
      this.sparksHead.text = t('inspect.n.sparks')
      this.sparksHead.y = y
      y += this.sparksHead.height + 4
      this.sparks.x = BODY_X
      this.sparks.y = y
      this.sparks.draw(judgedAxisQuality(s, lo), { ticks: this.axisTicks(), max: qualityScale(), highlight: null })
      y += this.sparks.height2 + 6
    } else {
      this.sparks.visible = false
      this.sparksHead.visible = false
    }
    return y
  }

  /** Expert overview: HARDWARE + DEPLOYED MODEL cards, then the next-wave fit rows. */
  private drawExpertOverview(s: GameState, tw: Tower, lo: Loadout): number {
    const cx = BODY_X
    let y = 0
    const hw = lo.hw
    const model = lo.model
    if (hw) {
      this.cardHw.set(0, t('rack.hw.gpu', { model: hw.gpuModel, n: hw.gpus }))
      this.cardHw.set(1, t('rack.hw.compute', { fp8: fmtTokS(hw.fp8Tflops), bf16: fmtTokS(hw.bf16Tflops) }))
      this.cardHw.set(
        2,
        t('rack.hw.mem', {
          gb: hw.hbmGb,
          bw: hw.hbmTbs.toFixed(1),
          tdp: (hw.tdpWatts / 1000).toFixed(1),
          cool: t('rack.cool.' + hw.cooling),
        }),
      )
      // §4.7 how the model spreads over the GPUs: copies add concurrency, TP splits a stream
      const ps = parallelSummary(s, lo)
      this.cardHw.set(
        3,
        !model
          ? ''
          : ps.blocker
            ? t('rack.hw.planNone')
            : t('rack.hw.plan', {
                g: ps.g,
                tp: ps.tpDeg,
                pp: ps.stages > 1 ? t('rack.hw.planPp', { stages: ps.stages }) : '',
                copies: ps.replicas,
                fmt: t('fmt.' + ps.format),
              }),
        ps.blocker ? COLORS.warn : COLORS.text,
      )
    }
    y += this.cardHw.draw(cx, y, t('rack.card.hw')) + 4

    if (model) {
      const sp = sparsityOf(lo)
      const lineageChip =
        model.origin === 'derived' && model.lineage ? t('rack.model.derived', { depth: model.lineage.depth }) : t('rack.model.base')
      this.cardModel.set(0, `${modelName(model)}  ${lineageChip}`, model.origin === 'derived' ? COLORS.data : COLORS.textDim)
      this.cardModel.set(
        1,
        t('rack.model.params', {
          total: sp.totalB.toFixed(sp.totalB >= 100 ? 0 : 1),
          active: sp.activeB.toFixed(sp.activeB >= 100 ? 0 : 1),
          moe: sp.isMoE ? t('rack.model.moe') : t('rack.model.dense'),
        }),
      )
      this.cardModel.set(
        2,
        t('rack.model.arch', { win: model.contextWindowK.toFixed(0), bytes: model.nativeWeightBytes, attn: t(`attn.${model.attn}`, undefined, model.attn) }),
      )
      this.cardModel.set(
        3,
        t('rack.model.align', {
          safety: model.alignment.safety.toFixed(0),
          style: t('rack.refusal.' + model.alignment.refusalStyle),
          over: Math.round(model.alignment.overRefusal * 100),
        }),
        COLORS.trust,
      )
      const jb = REQUEST_TYPES.jailbreak
      const ag = REQUEST_TYPES.agent
      this.cardModel.set(
        4,
        t('rack.model.align2', {
          jb: jb ? Math.round(selfHandleRate(model, jb) * 100) : 0,
          inj: ag ? Math.round(selfHandleRate(model, ag) * 100) : 0,
          tax: alignmentTax(model).toFixed(1),
        }),
        COLORS.trust,
      )
      // §1.4 which traffic it answers instantly / thinks about, the serving-stack switch, and
      // (a hybrid) the legend of its second vector on the bars below
      this.cardModel.set(5, thinkingLine(model), model.thinking === 'always' ? COLORS.warn : COLORS.data)
      const legend = model.thinking === 'hybrid' ? t('think.alt.legend') : ''
      this.cardModel.set(6, [thinkingToggle(model), legend].filter(Boolean).join('  ·  '), COLORS.textDim)
    } else {
      this.cardModel.set(5, '')
      this.cardModel.set(6, '')
    }
    const modelH = this.cardModel.draw(cx, y, t('rack.card.model'), this.sparks.height2 + 8)
    this.sparks.x = 8
    this.sparks.y = 20 + 7 * 14 + 4
    // the bars are what each axis is judged with; a hybrid's notch marks its other mode
    this.sparks.draw(judgedAxisQuality(s, lo), { ticks: this.axisTicks(), max: qualityScale(), alt: otherModeAxisQuality(s, lo) })
    y += modelH + 6
    return this.layoutLines(this.fitRows(s, tw, lo), y)
  }

  /** Expert telemetry: ROOFLINE + the labelled ESTIMATE card (+ live batch / KV from the sim's display fields). */
  private drawTelemetry(s: GameState, tw: Tower, lo: Loadout): number {
    for (const l of this.lines) l.visible = false
    const cx = BODY_X
    let y = 0
    const fits = serverFitsMemory(s, lo)
    const rf = rooflineOf(s, lo)
    const v = vramOf(s, lo)
    const lat = latencyOf(s, lo, 1500, 256)
    this.roofBars.x = 8
    this.roofBars.y = 17
    this.roofBars.draw(
      rf.prefillTokS,
      lat.aggDecodeTokS,
      rf.binding,
      fmtTokS(rf.prefillTokS) + ' tok/s',
      fmtTokS(lat.aggDecodeTokS) + ' tok/s',
    )
    this.vramBar.x = 8
    this.vramBar.y = 76
    this.vramBar.draw(v.weightsGb, v.kvFreeGb, v.headroomGb, v.totalGb)
    y += this.cardRoof.draw(cx, y, fits ? t('rack.card.roof') : t('rack.card.roofNoFit'), 94) + 4

    const batch = effectiveBatch(s, lo)
    const st = rackStatus(s, tw, lo)
    this.cardLive.set(0, t('inspect.est.ttft', { v: fmtLatencyMs(lat.ttftMs) }), ttftColor(lat.ttftMs))
    this.cardLive.set(1, t('inspect.est.tpot', { v: fmtLatencyMs(lat.tpotMs), u: fmtTokS(lat.perUserDecodeTokS) }), tpotColor(lat.tpotMs))
    this.cardLive.set(2, t('rack.live.toks', { perUser: fmtTokS(lat.perUserDecodeTokS), agg: fmtTokS(lat.aggDecodeTokS) }))
    this.cardLive.set(
      3,
      t('rack.live.cost', { dpmt: fmtDollarsPerMtoken(rackDollarsPerMtoken(s, lo)), kw: fmtKw(serverPower(s, lo)) }),
      COLORS.cash,
    )
    const meets = fits
      ? this.rackFits(s, tw, lo)
          .filter((f) => f.fit.fast && f.fit.window)
          .map((f) => reqShort(f.entry.def))
      : []
    this.cardLive.set(
      4,
      t('inspect.est.meets', { list: meets.length ? meets.join(', ') : t('inspect.est.none') }),
      meets.length ? COLORS.good : COLORS.warn,
    )
    this.cardLive.set(
      5,
      tw.batch !== undefined
        ? t('inspect.est.live', { b: tw.streams ?? tw.batch, kv: Math.round((tw.kvFrac ?? 0) * 100), u: Math.round(tw.load * 100) })
        : t('rack.live.util', { v: Math.round(tw.load * 100), batch }),
      tw.load >= 1 ? COLORS.warn : COLORS.text,
    )
    this.cardLive.set(6, t('rack.live.state', { kv: Math.round(s.infra.kv.utilization * 100), state: st.text }), st.fill)
    y += this.cardLive.draw(cx, y, t('inspect.est.title', { b: batch })) + 4
    return y
  }

  /** Deploy picker: hint, sort chips, then the pooled candidate rows. */
  private drawDeploy(s: GameState): number {
    for (const l of this.lines) l.visible = false
    const building = s.phase === 'build'
    this.depHint.text = building ? this.deployHint() : t('inspect.betweenWaves')
    this.depHint.style.fill = building ? COLORS.textDim : COLORS.warn
    this.depHint.y = 0
    let y = this.depHint.height + 6
    for (const sb of this.sortBtns) {
      sb.btn.y = y
      setButton(sb.btn, t('inspect.dep.sort.' + sb.sort))
      sb.btn.setActive(this.sort === sb.sort)
    }
    y += 28
    this.listTop = y
    return y + this.cands.length * DEP_ROW_STEP
  }

  private deployHint(): string {
    const tr = this.traffic
    if (!tr || !tr.entries.length) return t('inspect.dep.hintNone')
    return t('inspect.dep.hint', { n: tr.waveIndex + 1, mix: trafficMix(tr, 3) })
  }

  /** Recompute + sort the candidates when the rack, fleet, research, traffic or sort changes. */
  private refreshCandidates(s: GameState, tw: Tower): void {
    let fleet = ''
    for (const t2 of s.towers) if (t2.def.kind === 'server') fleet += `${t2.id}:${t2.hwId}:${t2.modelId}:${t2.precision ?? ''};`
    const key = [
      tw.id,
      s.phase, // a mid-wave Multi-LoRA hot swap is offered only while the wave runs
      Object.keys(s.models).length,
      s.derivedSeq,
      JSON.stringify(s.infra),
      this.trafficKey,
      this.sort,
      getLang(),
      fleet,
    ].join('|')
    if (key === this.candKey) return
    this.candKey = key
    const cands = deployCandidates(s, tw, this.traffic)
    const order: Record<DeploySort, (a: DeployCandidate, b: DeployCandidate) => number> = {
      best: (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        b.score - a.score ||
        b.judgedQ - a.judgedQ ||
        b.perUserTokS - a.perUserTokS,
      fast: (a, b) => b.perUserTokS - a.perUserTokS || b.judgedQ - a.judgedQ,
      smart: (a, b) => b.judgedQ - a.judgedQ || b.model.quality - a.model.quality,
      safe: (a, b) => b.safety - a.safety || a.overRefusal - b.overRefusal,
      size: (a, b) => b.model.paramsTotalB - a.model.paramsTotalB,
    }
    cands.sort((a, b) => {
      if (a.fits !== b.fits) return a.fits ? -1 : 1
      if (!a.fits) return (this.sort === 'size' ? order.size(a, b) : a.needGb - b.needGb) || a.model.id.localeCompare(b.model.id)
      return order[this.sort](a, b) || a.model.id.localeCompare(b.model.id)
    })
    this.cands = cands
    this.allCounts.clear()
    for (const c of cands) if (c.fits) this.allCounts.set(c.model.id, sameTierTargets(s, tw, c.model.id).length)
    for (const r of this.rows) r.boundKey = ''
  }

  /** Bind the pooled rows to the candidates inside the visible scroll window. */
  private bindRows(): void {
    const s = this.state
    if (!s) return
    const first = Math.max(0, Math.floor((this.scroll - this.listTop) / DEP_ROW_STEP))
    const last = Math.min(this.cands.length - 1, Math.ceil((this.scroll + this.bodyH - this.listTop) / DEP_ROW_STEP))
    const need = Math.max(0, last - first + 1)
    while (this.rows.length < need) this.addRow()
    for (let k = 0; k < this.rows.length; k++) {
      const row = this.rows[k]
      const i = first + k
      const c = this.cands[i]
      if (k >= need || !c) {
        row.visible = false
        continue
      }
      // between waves anything that fits; mid-wave only a Multi-LoRA adapter swap
      const canAct = s.phase === 'build' || c.hotSwap
      row.visible = true
      row.y = this.listTop + i * DEP_ROW_STEP
      row.bind(c, `${this.candKey}#${i}#${canAct}`, this.allCounts.get(c.model.id) ?? 0, canAct)
    }
  }

  /** Row tooltip: the estimate vs the loaded model, plus the bulk-deploy gestures. */
  private rowTooltip(row: DeployRow): TooltipSpec {
    const c = row.cand
    if (!c) return { title: '' }
    const cur = this.cands.find((x) => x.current)
    const tw = this.selected
    const tier = tw?.hwId ? HARDWARE_DEFS[tw.hwId] : null
    const body: string[] = []
    if (c.fits && cur && !c.current && cur.perUserTokS > 0) {
      const dv = (c.perUserTokS / cur.perUserTokS - 1) * 100
      const dq = c.judgedQ - cur.judgedQ
      body.push(
        t('inspect.dep.tip.vs', {
          speed: `${dv >= 0 ? '+' : ''}${dv.toFixed(0)}%`,
          q: `${dq >= 0 ? '+' : ''}${dq.toFixed(0)}`,
        }),
      )
    }
    if (c.fits && c.kinds) body.push(t('inspect.dep.tip.clears', { k: c.clears, n: c.kinds }))
    if (c.thinking === 'always') body.push(t('inspect.dep.tip.think', { n: fmtTokens(c.thinkTokens) }))
    else if (c.thinking === 'hybrid')
      body.push(
        t('inspect.dep.tip.hybrid', {
          instant: modeSplit(c.model)
            .instant.map((d) => reqShort(d))
            .join(t('think.listSep')),
          n: fmtTokens(c.thinkTokens),
        }),
      )
    if (c.fits) body.push(t('inspect.dep.tip.body', { tier: tier ? hwShort(tier) : '' }))
    return {
      title: modelName(c.model),
      value: c.fits ? t('inspect.dep.tip.value', { speed: fmtTokS(c.perUserTokS), q: c.judgedQ.toFixed(0) }) : row.speedT.text,
      body: body.join('\n'),
    }
  }
}

function rangeLine(tw: Tower): string {
  return `${t('inspect.range')}  ${towerRangeTiles(tw).toFixed(1)} ${t('inspect.tiles')}`
}

/** Compact line panel for every non-server building. */
function statLines(s: GameState, tw: Tower): { text: string; fill: number }[] {
  const d = tw.def
  const out: { text: string; fill: number }[] = []
  const line = (text: string, fill: number = COLORS.text): void => {
    out.push({ text, fill })
  }
  if (d.kind === 'router') {
    line(t('inspect.router.l1'))
    line(t('inspect.router.l2'), COLORS.textDim)
    line(rangeLine(tw), COLORS.textDim)
  } else if (d.kind === 'cache') {
    line(t('inspect.cache.hit', { v: Math.round(cacheChance(s, d) * 100) }), COLORS.cooling)
    line(t('inspect.cache.l1'))
    line(t('inspect.cache.l2'), COLORS.textDim)
    line(rangeLine(tw), COLORS.textDim)
  } else if (d.kind === 'guardrail' && d.guardrail) {
    const g = d.guardrail
    const gs = guardStats(s, g)
    line(t('inspect.guardrail.lat', { v: gs.latencyMs.toFixed(0) }), COLORS.sla)
    line(t('inspect.guardrail.side.' + g.side), COLORS.textDim)
    line(t('inspect.guard.recall', { v: Math.round(gs.recall * 100) }), COLORS.good)
    line(t('inspect.guard.overref', { v: (gs.overRefusal * 100).toFixed(1) }), COLORS.warn)
    line(t('inspect.guard.screens'), COLORS.textDim)
    for (const h of gs.hazards) {
      if (h.unlocked) line(`• ${t('hazard.' + h.hazard)} ✓`, COLORS.good)
      else
        line(
          '• ' +
            t('inspect.guard.locked', {
              h: t('hazard.' + h.hazard),
              eval: t(`research.${h.hazard === 'pii' ? 'r_eval_redteam_v2' : 'r_eval_redteam_v1'}.name`),
            }),
          COLORS.danger,
        )
    }
    line(rangeLine(tw), COLORS.textDim)
    if (g.runsOnRoofline) line(t('inspect.guardrail.power', { v: guardPower(s, g).toFixed(1) }), COLORS.power)
  } else if (d.kind === 'power') {
    line(t('inspect.power.cap', { v: d.power ?? 0 }), COLORS.power)
    line(t('inspect.power.l1'))
  } else if (d.kind === 'cooling') {
    line(t('inspect.cooling.cap', { v: d.cooling ?? 0 }), COLORS.cooling)
    line(t('inspect.cooling.l1'))
    const pool = coolingPools(s).air
    line(t('econ.cooling.airPool', { used: Math.round(pool.used), cap: Math.round(pool.cap) }), COLORS.textDim)
  } else if (d.kind === 'cooling_liquid') {
    line(t('inspect.coolingLiquid.cap', { v: d.cooling ?? 0 }), COLORS.cooling)
    const pool = coolingPools(s).liquid
    line(t('econ.cooling.liquidPool', { used: Math.round(pool.used), cap: Math.round(pool.cap) }), COLORS.textDim)
    line(t('inspect.coolingLiquid.l1'))
    line(t('inspect.coolingLiquid.l2'), COLORS.textDim)
  } else if (d.kind === 'lab') {
    line(t('inspect.lab.l1'))
    line(t('inspect.lab.l2'))
  }
  return out
}

/* ----------------------- Incident Banner ----------------------- */

export class IncidentBanner {
  readonly view = new Container()
  private bg = new Graphics()
  private txt = label('', 13, COLORS.warn, 'bold')
  private W = 720
  constructor() {
    this.view.x = (DESIGN_W - this.W) / 2
    this.view.y = 102
    this.view.addChild(this.bg, this.txt)
    this.txt.x = 14
    this.txt.y = 8
    // wrap long incident lines within the screen instead of overflowing the panel.
    this.txt.style.wordWrap = true
    this.txt.style.wordWrapWidth = DESIGN_W - 68
    this.view.visible = false
  }
  update(s: GameState): void {
    const inc = s.pendingIncident
    // the telegraph is a build-phase read; once the wave runs the HUD status line names the
    // incident, so the banner never covers the board's top row and lane mid-wave
    if (!inc || s.phase !== 'build') {
      this.view.visible = false
      panelLayout.bannerBottom = 0
      return
    }
    this.view.visible = true
    this.txt.text = `${t('hud.incidentLine', { icon: inc.icon, label: t('inc.next'), name: incName(inc) })} — ${incDesc(inc)}`
    this.txt.style.fill = inc.good ? COLORS.trust : COLORS.warn
    const w = Math.min(DESIGN_W - 40, this.txt.width + 28)
    const h = Math.max(34, Math.ceil(this.txt.height) + 14)
    this.txt.y = Math.round((h - this.txt.height) / 2)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, w, h, { edge: inc.good ? COLORS.trust : COLORS.warn })
    this.view.x = (DESIGN_W - w) / 2
    panelLayout.bannerBottom = this.view.y + h
  }
}

/* ----------------------- Training Panel (modal) ----------------------- */

type TrainTab = 'upgrades' | 'infra' | 'studio'
const HAS_UPGRADES = UPGRADES.length > 0
const TRAIN_TABS: readonly TrainTab[] = HAS_UPGRADES ? ['upgrades', 'infra', 'studio'] : ['infra', 'studio']

/** §4.4 the order the Infra tab groups its categories in. */
const INFRA_CATEGORY_ORDER: InfraCategory[] = [
  'scheduling',
  'kv-memory',
  'decoding',
  'weight-quant',
  'parallelism',
  'routing',
  'multi-lora',
  'engine',
]

/**
 * S9 TechLab + Post-Training Studio (§5.2). Three tabs:
 *  - UPGRADES: the four instant cash engineering paths (unchanged).
 *  - INFRA: the serving-stack research tree grouped by InfraCategory, plus the
 *    post-training method-unlock nodes (r_pt_*) and the red-team eval nodes —
 *    each card showing cost / optimizes / coupling / prereq + conflict state.
 *  - STUDIO: the Post-Training Studio picker (base / method / target / effort
 *    5-notch slider + live preview), driving startPostTrain.
 */
export class TrainingPanel {
  readonly view = new Container()
  private dim = new Graphics()
  private bg = new Graphics()
  private head = label('', 20, COLORS.textBright, 'bold')
  private res = label('', 14, COLORS.text)
  private tabUp: UIButton
  private tabInfra: UIButton
  private tabStudio: UIButton
  /** the open tab, remembered across visits */
  private tab: TrainTab = uiPref('train.tab', TRAIN_TABS[0], TRAIN_TABS)
  /** arrow-key focus over the research cards (spatial: groups have uneven rows) */
  private rdFocus = new FocusList(() => [...this.rdBtns.values()], 0)
  // upgrades tab
  private upView = new Container()
  private btns = new Map<string, UIButton>()
  private pathRefs: { header: Text; theme: Text }[] = []
  // infra tab (grouped, filterable, wheel/drag scrollable)
  private rdView = new Container()
  private rdHost = new Container()
  private rdScroll = new Container()
  private rdBtns = new Map<string, UIButton>()
  private rdGroups: { title: () => string; header: Text; ids: string[] }[] = []
  private rdStatus: Text
  private rdScrollUp: UIButton
  private rdScrollDn: UIButton
  private rdFilterBtn: UIButton
  private rdDrag: DragScroll
  private rdOnlyAvailable = uiPref('train.filter', 'all', ['all', 'available']) === 'available'
  private rdLayoutKey = ''
  private rdCardKeys = new Map<string, string>()
  private rdOffset = 0
  private rdContentH = 0
  private rdClipH = 0
  // studio tab
  private studio: StudioTab
  private closeBtn: UIButton
  private PW = 1180
  private PH = 500
  private px: number
  private py: number

  constructor(
    onBuy: (id: string) => void,
    onResearch: (id: string) => void,
    onPostTrain: (baseIds: string[], method: PostTrainMethod, target: PostTrainTarget, effort: number) => boolean,
    onClose: () => void,
  ) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.px = px
    this.py = py
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.72 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.bg)
    drawPanel(this.bg, px, py, this.PW, this.PH, { alpha: 0.98 })
    this.head.x = px + 24
    this.head.y = py + 14
    this.res.x = px + 24
    this.res.y = py + 42
    this.view.addChild(this.head, this.res)

    this.tabUp = new UIButton({ w: 150, h: 28, accent: COLORS.sla, onTap: () => this.setTab('upgrades') })
    this.tabUp.x = px + 300
    this.tabUp.y = py + 38
    this.tabInfra = new UIButton({ w: 150, h: 28, accent: COLORS.power, onTap: () => this.setTab('infra') })
    this.tabInfra.x = HAS_UPGRADES ? px + 458 : px + 404
    this.tabInfra.y = py + 38
    this.tabStudio = new UIButton({ w: 220, h: 28, accent: COLORS.data, onTap: () => this.setTab('studio') })
    this.tabStudio.x = HAS_UPGRADES ? px + 616 : px + 562
    this.tabStudio.y = py + 38
    this.view.addChild(this.tabUp, this.tabInfra, this.tabStudio, this.upView, this.rdView)

    // --- UPGRADES tab: the four instant engineering paths ---
    const colW = 250
    const gap = 12
    const startX = px + 24
    TECH_PATHS.forEach((path, ci) => {
      const cx = startX + ci * (colW + gap)
      const header = label('', 15, path.color, 'bold')
      header.x = cx
      header.y = py + 80
      const theme = label('', 11, COLORS.textDim)
      theme.x = cx
      theme.y = py + 100
      this.upView.addChild(header, theme)
      this.pathRefs.push({ header, theme })
      const ups = UPGRADES.filter((u) => u.path === path.id)
      ups.forEach((u, ri) => {
        const b = new UIButton({ w: colW, h: 92, accent: path.color, onTap: () => onBuy(u.id) })
        b.x = cx
        b.y = py + 120 + ri * 98
        this.upView.addChild(b)
        this.btns.set(u.id, b)
      })
    })

    // --- INFRA tab: the serving tree grouped by category, plus the method-unlock
    //     and eval nodes. Clipped, scrollable by wheel / drag / ▲▼, filterable to
    //     what can be researched right now; hovering a card explains it below. ---
    const clipY = py + 78
    const clipH = this.PH - 78 - 70
    this.rdClipH = clipH
    const clip = new Graphics().rect(px + 12, clipY, this.PW - 24, clipH).fill({ color: 0x000000, alpha: 0.001 })
    this.rdScroll.mask = clip
    this.rdHost.addChild(this.rdScroll)
    this.rdView.addChild(this.rdHost, clip)
    this.rdHost.eventMode = 'static'
    this.rdHost.hitArea = {
      contains: (x: number, y: number) => x >= px + 12 && x <= px + this.PW - 50 && y >= clipY && y <= clipY + clipH,
    }
    this.rdDrag = new DragScroll(this.rdHost, { get: () => this.rdOffset, set: (v) => this.setInfraOffset(v) })
    this.rdScroll.x = px + 24
    this.rdScroll.y = clipY
    const groups: { title: () => string; ids: string[]; color: number }[] = [
      ...INFRA_CATEGORY_ORDER.map((cat) => ({
        title: () => t('infra.' + cat).toUpperCase(),
        ids: INFRA_LIST.filter((n) => n.category === cat).map((n) => n.id),
        color: COLORS.power,
      })),
      {
        title: () => t('train.studioMethods'),
        ids: RESEARCH_LIST.filter((d) => d.id.startsWith('r_pt_')).map((d) => d.id),
        color: COLORS.data,
      },
      {
        title: () => t('train.evalNodes'),
        ids: RESEARCH_LIST.filter((d) => d.kind === 'eval').map((d) => d.id),
        color: COLORS.warn,
      },
    ]
    for (const grp of groups) {
      if (!grp.ids.length) continue
      const header = label('', 13, grp.color, 'bold')
      this.rdScroll.addChild(header)
      this.rdGroups.push({ title: grp.title, header, ids: grp.ids })
      for (const rid of grp.ids) {
        const b = new UIButton({
          w: RD_CARD_W,
          h: RD_CARD_H,
          accent: grp.color,
          onTap: () => {
            if (!this.rdDrag.swallowTap) onResearch(rid)
          },
        })
        this.rdScroll.addChild(b)
        this.rdBtns.set(rid, b)
      }
    }

    this.rdScrollUp = new UIButton({ w: 28, h: 26, accent: COLORS.sla, onTap: () => this.setInfraOffset(this.rdOffset - 120) })
    this.rdScrollDn = new UIButton({ w: 28, h: 26, accent: COLORS.sla, onTap: () => this.setInfraOffset(this.rdOffset + 120) })
    this.rdScrollUp.x = px + this.PW - 44
    this.rdScrollUp.y = clipY
    this.rdScrollDn.x = px + this.PW - 44
    this.rdScrollDn.y = clipY + clipH - 26
    this.rdScrollUp.setTitle('▲').layout(0, 0, true)
    this.rdScrollDn.setTitle('▼').layout(0, 0, true)
    this.rdFilterBtn = new UIButton({
      w: 160,
      h: 24,
      accent: COLORS.trust,
      onTap: () => {
        this.rdOnlyAvailable = !this.rdOnlyAvailable
        this.rdOffset = 0
        setUiPref('train.filter', this.rdOnlyAvailable ? 'available' : 'all')
      },
    })
    this.rdFilterBtn.x = px + this.PW - 184
    this.rdFilterBtn.y = py + 52
    this.rdView.addChild(this.rdScrollUp, this.rdScrollDn, this.rdFilterBtn)

    this.rdStatus = label('', 12, COLORS.textDim)
    this.rdStatus.x = px + 24
    this.rdStatus.y = py + this.PH - 62
    this.rdStatus.style.wordWrap = true
    this.rdStatus.style.wordWrapWidth = this.PW - 80
    this.rdStatus.style.lineHeight = 16
    this.rdView.addChild(this.rdStatus)

    // --- STUDIO tab ---
    this.studio = new StudioTab({ onPostTrain })
    this.studio.layout(px, py)
    this.view.addChild(this.studio.view)

    this.closeBtn = new UIButton({ w: 160, h: 34, accent: COLORS.sla, onTap: onClose })
    this.closeBtn.x = px + this.PW - 184
    this.closeBtn.y = py + 14
    this.view.addChild(this.closeBtn)
    this.view.visible = false
  }

  /** Opening the lab: drop any stale keyboard focus; the Studio starts on `preferredBase` (the selected rack's model). */
  open(preferredBase: string | null): void {
    this.rdFocus.clear()
    this.studio.clearFocus()
    this.studio.preferBase(preferredBase)
  }

  private setTab(tab: TrainTab): void {
    if (this.tab === tab) return
    this.tab = tab
    setUiPref('train.tab', tab)
    this.rdFocus.clear()
    this.studio.clearFocus()
  }

  /**
   * Keyboard inside the lab: [ / ] switch tabs; on the Infra tab the arrows walk the
   * research cards (the list scrolls to keep the focus in view), PgUp / PgDn / Home /
   * End scroll, Enter researches the focused card; the Studio handles its own keys.
   */
  key(code: string): boolean {
    if (code === 'BracketLeft' || code === 'BracketRight') {
      const i = TRAIN_TABS.indexOf(this.tab)
      const step = code === 'BracketLeft' ? -1 : 1
      this.setTab(TRAIN_TABS[(i + step + TRAIN_TABS.length) % TRAIN_TABS.length])
      return true
    }
    if (this.tab === 'studio') return this.studio.key(code)
    if (this.tab !== 'infra') return false
    const page = this.rdClipH * 0.85
    switch (code) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dx = code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : 0
        const dy = code === 'ArrowUp' ? -1 : code === 'ArrowDown' ? 1 : 0
        this.rdFocus.move(dx, dy)
        const b = this.rdFocus.current
        if (b) {
          // keep the focused card inside the clip
          if (b.y < this.rdOffset) this.setInfraOffset(b.y - 24)
          else if (b.y + RD_CARD_H > this.rdOffset + this.rdClipH) this.setInfraOffset(b.y + RD_CARD_H - this.rdClipH + 8)
        }
        return true
      }
      case 'PageUp':
        this.setInfraOffset(this.rdOffset - page)
        return true
      case 'PageDown':
        this.setInfraOffset(this.rdOffset + page)
        return true
      case 'Home':
        this.setInfraOffset(0)
        return true
      case 'End':
        this.setInfraOffset(this.rdContentH)
        return true
      case 'Enter':
      case 'NumpadEnter':
        return this.rdFocus.activate()
    }
    return false
  }

  private setInfraOffset(v: number): void {
    this.rdOffset = clamp(v, 0, Math.max(0, this.rdContentH - this.rdClipH))
    this.rdScroll.y = this.py + 78 - this.rdOffset
  }

  /** Re-flow the research cards (3 columns per group) when the filter or availability changes. */
  private relayoutInfra(s: GameState): void {
    let sig = this.rdOnlyAvailable ? 'A' : 'a'
    for (const def of RESEARCH_LIST) sig += infraAvailable(s, def) ? '1' : '0'
    if (sig === this.rdLayoutKey) return
    this.rdLayoutKey = sig
    let y = 0
    for (const grp of this.rdGroups) {
      const shown = grp.ids.filter((id) => {
        const def = RESEARCH_DEFS[id]
        return !this.rdOnlyAvailable || (!!def && infraAvailable(s, def))
      })
      grp.header.visible = shown.length > 0
      for (const id of grp.ids) this.rdBtns.get(id)!.visible = false
      if (!shown.length) continue
      grp.header.y = y
      y += 22
      shown.forEach((id, i) => {
        const b = this.rdBtns.get(id)!
        b.visible = true
        b.x = (i % 3) * (RD_CARD_W + 12)
        b.y = y + Math.floor(i / 3) * (RD_CARD_H + 8)
      })
      y += Math.ceil(shown.length / 3) * (RD_CARD_H + 8) + 8
    }
    this.rdContentH = y
    this.setInfraOffset(this.rdOffset)
  }

  /** The hover strip: what the card under the pointer does, what it needs and what it excludes. */
  private infraDetail(s: GameState): string | null {
    for (const [id, b] of this.rdBtns) {
      if (!b.visible || !b.hovered) continue
      const def = RESEARCH_DEFS[id]
      if (!def) continue
      const node = INFRA_NODES[id]
      const parts = [`${t(`research.${id}.name`, undefined, def.name)} — ${t(`research.${id}.desc`, undefined, def.desc)}`]
      const req = (def.requires ?? []).map((r) => {
        const d = RESEARCH_DEFS[r]
        const name = d ? t(`research.${r}.name`, undefined, d.name) : r
        return d && researchOwned(s, d) ? `${name} ✓` : name
      })
      const tail: string[] = []
      if (req.length) tail.push(t('research.tip.requires', { v: req.join(', ') }))
      if (node?.conflicts?.length) {
        tail.push(t('research.tip.conflicts', { v: node.conflicts.map((c) => t(`research.${c}.name`, undefined, c)).join(', ') }))
      }
      if (node) tail.push(`${node.optimizes.map((o) => t('opt.' + o)).join('/')} · ${t('coupling.' + node.coupling)} · ${node.sourceRef}`)
      if (tail.length) parts.push(tail.join('   '))
      // what starting it would cost the fleet right now: the lent racks and the wave time
      if (!researchOwned(s, def) && !activeSlotFor(s, def)) parts.push(lendLine(s, def.compute))
      return parts.join('\n')
    }
    return null
  }

  update(s: GameState): void {
    this.head.text = t('train.title')
    this.res.text = t('train.res', { cash: Math.floor(s.meters.cash), data: Math.floor(s.data) })
    this.closeBtn.setTitle(t('train.close')).layout(0, 0, true)
    this.tabUp.visible = HAS_UPGRADES
    if (!HAS_UPGRADES && this.tab === 'upgrades') this.tab = 'infra'
    this.tabUp.setTitle(t('train.tabUpgrades')).setActive(this.tab === 'upgrades').layout(0, 0, true)
    this.tabInfra.setTitle(t('train.tabInfra')).setActive(this.tab === 'infra').layout(0, 0, true)
    this.tabStudio.setTitle(t('train.tabStudio')).setActive(this.tab === 'studio').layout(0, 0, true)
    this.upView.visible = HAS_UPGRADES && this.tab === 'upgrades'
    this.rdView.visible = this.tab === 'infra'
    this.studio.view.visible = this.tab === 'studio'

    if (this.tab === 'upgrades') {
      TECH_PATHS.forEach((path, i) => {
        const r = this.pathRefs[i]
        if (!r) return
        r.header.text = t('path.' + path.id + '.name', undefined, path.name).toUpperCase()
        r.theme.text = t('path.' + path.id + '.theme', undefined, path.theme)
      })
      for (const u of UPGRADES) {
        const b = this.btns.get(u.id)!
        const cur = s.upgrades[u.id] ?? 0
        const maxed = cur >= u.maxLevel
        const prereqOk = !u.requires || u.requires.every((r) => (s.upgrades[r] ?? 0) > 0)
        const affordable = s.meters.cash >= u.cashCost && s.data >= u.dataCost
        b.setTitle(`${upName(u)}   ${t('train.level', { cur, max: u.maxLevel })}`)
        b.setSub(
          maxed
            ? t('train.maxed')
            : `${t('train.cost', { cash: u.cashCost, data: u.dataCost })}\n${upDesc(u)}`,
        )
        b.setEnabled(!maxed && prereqOk && affordable)
        b.setActive(cur > 0)
        b.layoutCard()
      }
      return
    }

    if (this.tab === 'studio') {
      this.studio.update(s)
      return
    }

    // INFRA tab — three concurrent tracks (§4.5 / C7); grouped by category.
    this.relayoutInfra(s)
    for (const grp of this.rdGroups) grp.header.text = grp.title()
    const max = Math.max(0, this.rdContentH - this.rdClipH)
    this.rdScrollUp.setEnabled(this.rdOffset > 0)
    this.rdScrollDn.setEnabled(this.rdOffset < max)
    setButton(this.rdFilterBtn, t(this.rdOnlyAvailable ? 'train.filterAvailable' : 'train.filterAll'))
    this.rdFilterBtn.setActive(this.rdOnlyAvailable)

    for (const def of RESEARCH_LIST) {
      const b = this.rdBtns.get(def.id)
      if (!b || !b.visible) continue
      const owned = researchOwned(s, def)
      const slot = activeSlotFor(s, def)
      const unlocked = researchUnlocked(s, def)
      const trackBusy = s.research[researchTrackOf(def)] != null
      const conflictOwned = infraConflictOwned(s, def.id)
      const pct = slot ? Math.floor((slot.progress / slot.compute) * 100) : 0
      const missing = (def.requires ?? [])
        .filter((r) => {
          const d = RESEARCH_DEFS[r]
          return !d || !researchOwned(s, d)
        })
        .map((r) => t(`research.${r}.name`, undefined, RESEARCH_DEFS[r]?.name ?? r))
      const sub = owned
        ? t('research.done')
        : slot
          ? t('research.progress', { pct })
          : conflictOwned
            ? t('research.conflict')
            : unlocked
              ? t('research.cost', { data: def.dataCost, compute: Math.round(def.compute / 1000) }) +
                (trackBusy ? '  ' + t('research.trackBusy') : '')
              : t('research.locked', { req: missing.join(', ') })
      const key = `${sub}|${getLang()}`
      if (this.rdCardKeys.get(def.id) !== key) {
        this.rdCardKeys.set(def.id, key)
        b.setTitle(t(`research.${def.id}.name`, undefined, def.name))
        b.setSub(sub)
        b.layoutCard(8, 9)
      }
      b.setEnabled(!owned && !trackBusy && unlocked && !conflictOwned && s.data >= def.dataCost && s.phase === 'build')
      b.setActive(owned || !!slot)
    }
    const detail = this.infraDetail(s)
    const activeSlot = s.research.infra ?? s.research.posttrain ?? s.research.eval
    if (detail) {
      this.rdStatus.text = detail
      this.rdStatus.style.fill = COLORS.text
    } else if (activeSlot) {
      const def = RESEARCH_DEFS[activeSlot.id]
      this.rdStatus.text = t('research.status', {
        name: def ? t(`research.${def.id}.name`, undefined, def.name) : activeSlot.id,
        pct: Math.floor((activeSlot.progress / activeSlot.compute) * 100),
        flops: fmtFlops(requisitionPreview(s, 0, false).lentTflops),
      })
      this.rdStatus.style.fill = COLORS.textDim
    } else {
      this.rdStatus.text = t('research.idle')
      this.rdStatus.style.fill = COLORS.textDim
    }
  }
}

/** Research card geometry in the Infra tab (3 columns). */
const RD_CARD_W = 366
const RD_CARD_H = 64

/** A conflicting infra node (§4.3 chunked ⟂ disagg) is already owned. */
function infraConflictOwned(s: GameState, id: string): boolean {
  return !!INFRA_NODES[id]?.conflicts?.some((c) => (s.upgrades[c] ?? 0) > 0)
}

/** "Available now": researchable at this moment (prerequisites met, not owned, no owned conflict) or running. */
function infraAvailable(s: GameState, def: (typeof RESEARCH_LIST)[number]): boolean {
  if (activeSlotFor(s, def)) return true
  return researchUnlocked(s, def) && !infraConflictOwned(s, def.id)
}

/**
 * The requisition a new project of `compute` TF·s would make right now (research.ts
 * requisitionPreview): how many racks it lends, the serving compute lost while they
 * train, and the board seconds of wave time it needs — or why it would wait.
 */
function lendLine(s: GameState, compute: number): string {
  const rq = requisitionPreview(s, compute, true)
  if (rq.blocked) return t('econ.lend.blocked')
  const sec = Number.isFinite(rq.seconds) ? Math.max(1, Math.round(rq.seconds)) : 0
  return `${t('econ.lend', { n: rq.rackIds.length, loss: Math.round(rq.servingLoss * 100) })} · ${t('econ.time.sec', { sec })}`
}

/** Aggregate training compute (bf16 TFLOPS) as TFLOPS / PFLOPS. */
function fmtFlops(tflops: number): string {
  return tflops >= 1000 ? (tflops / 1000).toFixed(1) + ' PFLOPS' : Math.round(tflops) + ' TFLOPS'
}

/* ----------------------- Overlays (menu / win / lose) ----------------------- */

export class Overlay {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private title = label('', 44, COLORS.textBright, 'bold')
  private subtitle = label('', 16, COLORS.sla)
  private body: Text[] = []
  private actionBtn: UIButton
  private continueBtn: UIButton
  private demoBtn: UIButton
  private agentBtn: UIButton
  private langBtn: UIButton
  private modeBtns: { mode: 'normal' | 'expert'; btn: UIButton }[] = []
  private modeDesc = label('', 12, COLORS.textDim)
  // win / lose recap: the seven-outcome bar + legend (all outcomes, always)
  private endBar = new OutcomeBar(520, 14)
  private endLegend: Text[] = []
  private PW = 640
  private PH = 470
  private lastKind: 'menu' | 'won' | 'lost' = 'menu'
  private lastState: GameState | null = null

  constructor(onAction: () => void, onContinue: () => void, onDemo: () => void, onAgent: () => void) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.82 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.panel)
    drawPanel(this.panel, px, py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.center(this.title, py + 44)
    this.center(this.subtitle, py + 104)
    for (let i = 0; i < 8; i++) {
      const t = label('', 14, COLORS.text)
      t.y = py + 150 + i * 24
      this.body.push(t)
      this.view.addChild(t)
    }
    this.endBar.x = (DESIGN_W - 520) / 2
    this.view.addChild(this.endBar)
    for (let i = 0; i < OUTCOMES.length; i++) {
      const tx = label('', 13, COLORS.text, 'bold')
      this.endLegend.push(tx)
      this.view.addChild(tx)
    }
    this.actionBtn = new UIButton({ w: 280, h: 46, accent: COLORS.trust, onTap: onAction })
    this.actionBtn.x = (DESIGN_W - 280) / 2
    this.actionBtn.y = py + this.PH - 72
    this.view.addChild(this.actionBtn)

    // win screen only: keep the run going into procedural endless waves
    this.continueBtn = new UIButton({ w: 280, h: 40, accent: COLORS.data, onTap: onContinue })
    this.continueBtn.x = (DESIGN_W - 280) / 2
    this.continueBtn.y = py + this.PH - 124
    this.continueBtn.visible = false
    this.view.addChild(this.continueBtn)

    this.demoBtn = new UIButton({ w: 74, h: 30, accent: COLORS.data, onTap: onDemo })
    this.demoBtn.x = px + 16
    this.demoBtn.y = py + 16
    this.demoBtn.visible = false
    this.view.addChild(this.demoBtn)

    // Menu only: a smaller button beside START that hands the run to a local CLI
    // agent over the bridge (Expert display by default). Positioned in show().
    this.agentBtn = new UIButton({ w: 160, h: 46, accent: COLORS.data, onTap: onAgent })
    this.agentBtn.y = py + this.PH - 72
    this.agentBtn.visible = false
    this.view.addChild(this.agentBtn)

    // Display-mode selector (menu only): chosen here, locked for the run.
    const modes: ('normal' | 'expert')[] = ['normal', 'expert']
    modes.forEach((mode, i) => {
      const btn = new UIButton({
        w: 190,
        h: 36,
        accent: mode === 'expert' ? COLORS.data : COLORS.sla,
        onTap: () => {
          setMode(mode)
          this.refresh()
        },
      })
      btn.x = DESIGN_W / 2 - 196 + i * 202
      btn.y = py + 300
      this.view.addChild(btn)
      this.modeBtns.push({ mode, btn })
    })
    this.modeDesc.style.wordWrap = true
    this.modeDesc.style.wordWrapWidth = this.PW - 60
    this.modeDesc.style.align = 'center'
    this.center(this.modeDesc, py + 344)

    this.langBtn = new UIButton({
      w: 54,
      h: 30,
      accent: COLORS.sla,
      onTap: () => {
        cycleLang()
        this.refresh()
      },
    })
    this.langBtn.x = px + this.PW - 66
    this.langBtn.y = py + 16
    this.view.addChild(this.langBtn)
    this.view.visible = false
  }
  private center(t: Text, y: number): void {
    t.anchor.set(0.5, 0)
    t.x = DESIGN_W / 2
    t.y = y
    this.view.addChild(t)
  }

  show(kind: 'menu' | 'won' | 'lost', s: GameState): void {
    this.view.visible = true
    this.lastKind = kind
    this.lastState = s
    const lines: string[] = []
    if (kind === 'menu') {
      this.title.text = t('menu.title')
      this.title.style.fill = COLORS.textBright
      this.subtitle.text = t('menu.subtitle')
      this.subtitle.style.fill = COLORS.sla
      lines.push(t('menu.l1'), t('menu.l2'), t('menu.l3'), '', t('menu.l4'), t('menu.l5'))
      this.actionBtn.setAccent(COLORS.trust).setTitle(t('menu.start'))
    } else if (kind === 'won') {
      this.title.text = t('win.title')
      this.title.style.fill = COLORS.trust
      this.subtitle.text = t(s.message)
      this.subtitle.style.fill = COLORS.sla
      this.actionBtn.setAccent(COLORS.trust).setTitle(t('win.again'))
    } else {
      this.title.text = t('lose.title')
      this.title.style.fill = COLORS.danger
      this.subtitle.text = t(s.message)
      this.subtitle.style.fill = COLORS.danger
      this.actionBtn.setAccent(COLORS.warn).setTitle(t('lose.again'))
    }
    const menu = kind === 'menu'
    const py = (DESIGN_H - this.PH) / 2
    for (let i = 0; i < this.body.length; i++) {
      const tx = this.body[i]
      tx.text = lines[i] ?? ''
      tx.anchor.set(0.5, 0)
      tx.x = DESIGN_W / 2
      tx.y = py + 150 + i * 24
      tx.style.fill = COLORS.text
    }
    this.endBar.visible = !menu
    for (const tx of this.endLegend) tx.visible = false
    if (!menu) this.drawRecap(s, py)
    for (const { mode, btn } of this.modeBtns) {
      btn.visible = menu
      if (menu) {
        btn.setTitle(t('mode.' + mode)).setActive(getMode() === mode).layout(0, 0, true)
      }
    }
    this.demoBtn.visible = menu
    if (menu) this.demoBtn.setTitle(t('menu.demo')).layout(0, 0, true)
    // START is centered alone on win/lose; in the menu it shares its row with a
    // smaller AGENT button (enter the agent bridge, Expert display by default).
    this.agentBtn.visible = menu
    if (menu) {
      const pairW = 280 + 12 + 160
      this.actionBtn.x = (DESIGN_W - pairW) / 2
      this.agentBtn.x = this.actionBtn.x + 280 + 12
      this.agentBtn.setAccent(COLORS.data).setTitle(t('menu.agent')).layout(0, 0, true)
    } else {
      this.actionBtn.x = (DESIGN_W - 280) / 2
    }
    this.modeDesc.visible = menu
    if (menu) this.modeDesc.text = t(getMode() === 'expert' ? 'mode.expertDesc' : 'mode.normalDesc')
    this.continueBtn.visible = kind === 'won' && !s.endless
    if (this.continueBtn.visible) this.continueBtn.setTitle(t('win.continue')).layout(0, 0, true)
    this.actionBtn.layout(0, 0, true)
    this.langBtn.setTitle(LANG_LABEL[getLang()]).layout(0, 0, true)
  }
  /**
   * Win / lose recap: how far the run got, all seven outcomes (bar + legend), the
   * biggest Trust / SLA drains by outcome, run Goodput and total earned — so the
   * screen names what ended the run instead of a partial tally.
   */
  private drawRecap(s: GameState, py: number): void {
    const st = s.stats
    const at = (i: number, text: string, y: number, fill: number = COLORS.text): void => {
      const tx = this.body[i]
      tx.text = text
      tx.y = y
      tx.style.fill = fill
    }
    let y = py + 142
    at(0, t('stats.reached', { wave: s.waveIndex + 1, total: s.endless ? '∞' : WAVES.length }), y, COLORS.textBright)
    y += 30
    this.endBar.y = y
    this.endBar.draw(st)
    y += 22
    y += flowTokens(this.endLegend, outcomeTokens(st, false, [...OUTCOMES]), (DESIGN_W - 520) / 2, y, 520, true) + 10
    const trust = ledgerParts(st.trustLostBy, 2)
    const sla = ledgerParts(st.slaLostBy, 2)
    if (trust || sla) {
      at(1, t('end.drains'), y, COLORS.textDim)
      y += 22
      at(2, trust ? t('end.drain.trust', { parts: trust }) : '', y, COLORS.trust)
      if (trust) y += 22
      at(3, sla ? t('end.drain.sla', { parts: sla }) : '', y, COLORS.sla)
      if (sla) y += 22
    } else {
      const worst = FAILURES.filter((o) => st[o] > 0).sort((a, b) => st[b] - st[a])[0]
      at(1, worst ? t('end.worst', { label: outcomeLabel(worst), n: st[worst] }) : t('end.clean'), y, worst ? outcomeColor(worst) : COLORS.good)
      at(2, '', y)
      at(3, '', y)
      y += 22
    }
    y += 4
    at(4, t('end.summary', { g: honestGoodputPct(st).toFixed(0), cash: Math.round(st.cashEarned) }), y, COLORS.cash)
  }

  /** Re-render the currently shown overlay (e.g. after a language switch). */
  refresh(): void {
    if (this.view.visible && this.lastState) this.show(this.lastKind, this.lastState)
  }
  hide(): void {
    this.view.visible = false
  }
}

/* ----------------------- Wave Report (settlement, both modes) ----------------------- */

/** WaveReport fields the sim may add on top of the contract (read defensively; seconds). */
type ReportExt = WaveReport & { avgTpot?: number; p95Tpot?: number }

/** The failure outcomes in the order the "why" lines consider them. */
const FAILURES: Outcome[] = ['sloMiss', 'bad', 'unsafe', 'overRefused', 'unservable', 'leaked']
const SLO_CAUSES: SloCause[] = ['ttft', 'ttfat', 'tpot', 'e2el']

/** Plain-language outcome word for Normal Mode ("Too slow", "Refused"). */
function plainOutcome(o: Outcome): string {
  return t('plain.' + o)
}

/** Long outcome label ("SLO-miss", "Over-refused") from the shared outcome style table. */
function outcomeLabel(o: Outcome): string {
  return t(OUTCOME_STYLE[o].labelKey)
}

/** The archetype that suffered the most of one outcome in a wave report. */
function topTypeFor(rep: WaveReport, o: Outcome): RequestTypeDef | null {
  let best: RequestTypeDef | null = null
  let n = 0
  for (const id of Object.keys(rep.byType)) {
    const row = rep.byType[id]
    const def = REQUEST_TYPES[id]
    if (!row || !def) continue
    if (row[o] > n) {
      n = row[o]
      best = def
    }
  }
  return best
}

/** The resolved difficulty an archetype faced in the wave that was just cleared. */
function clearedDifficulty(s: GameState, rep: WaveReport, def: RequestTypeDef): number {
  const groups = rep.waveIndex === s.waveIndex ? s.currentWave?.groups : WAVES[rep.waveIndex]?.groups
  let mul = 0
  for (const g of groups ?? []) if (g.typeId === def.id) mul = Math.max(mul, g.complexityMul ?? 1)
  return (def.difficulty[def.primaryAxis] ?? 0) * (mul || 1)
}

/** Meter damage an outcome did this wave (Trust + SLA), when the ledger is known. */
function meterLoss(rep: WaveReport, o: Outcome): number {
  return Math.abs(rep.trustLostBy?.[o] ?? 0) + Math.abs(rep.slaLostBy?.[o] ?? 0)
}

/**
 * One plain-language cause + fix per top failure bucket, ranked by the meter
 * damage it did (or by count until the ledger exists). This is the curriculum
 * line: what went wrong, on which traffic, and which lever fixes it.
 */
function whyLines(s: GameState, rep: WaveReport, max: number): { text: string; fill: number }[] {
  const ranked = FAILURES.filter((o) => rep[o] > 0).sort((a, b) => meterLoss(rep, b) - meterLoss(rep, a) || rep[b] - rep[a])
  return ranked.slice(0, max).map((o) => ({ text: whyFor(s, rep, o), fill: outcomeColor(o) }))
}

function whyFor(s: GameState, rep: WaveReport, o: Outcome): string {
  const n = rep[o]
  const def = topTypeFor(rep, o)
  const type = def ? reqShort(def) : '—'
  switch (o) {
    case 'sloMiss': {
      let cause: SloCause | null = null
      let most = 0
      for (const c of SLO_CAUSES) {
        const v = rep.sloCauses?.[c] ?? 0
        if (v > most) {
          most = v
          cause = c
        }
      }
      if (!cause || !def) return t('why.sloMiss.any', { n, type })
      const b = sloBoundsOf(def)
      const bound = cause === 'ttft' ? b.ttftMs : cause === 'tpot' ? b.tpotMs : cause === 'e2el' ? b.e2elMs : b.ttfatMs
      return t('why.sloMiss.' + cause, { n, type, bound: Number.isFinite(bound) ? fmtLatencyMs(bound) : '—' })
    }
    case 'bad':
      return def
        ? t('why.bad', { n, type, axis: t('spec.' + def.primaryAxis), d: clearedDifficulty(s, rep, def).toFixed(0) })
        : t('why.bad.any', { n })
    case 'unsafe': {
      const locked = !!def?.hazards && Object.keys(def.hazards).some((h) => !categoryUnlocked(s, h as keyof NonNullable<RequestTypeDef['hazards']>))
      return t('why.unsafe', { n, type }) + (locked ? ' ' + t('why.unsafe.locked') : '')
    }
    case 'overRefused': {
      const by = rep.overRefusedBy
      if (!by) return t('why.overRefused.any', { n })
      return t((by.guard ?? 0) > (by.model ?? 0) ? 'why.overRefused.guard' : 'why.overRefused.model', { n })
    }
    case 'unservable':
      return t('why.unservable', { n, type })
    default:
      return t('why.leaked', { n })
  }
}

/** "Unsafe −8 · Wrong −3" — the top entries of a per-outcome meter ledger. */
function ledgerParts(by: Partial<Record<Outcome, number>> | undefined, max = 3, plain = false): string {
  if (!by) return ''
  return OUTCOMES.filter((o) => Math.abs(by[o] ?? 0) >= 0.5)
    .sort((a, b) => Math.abs(by[b] ?? 0) - Math.abs(by[a] ?? 0))
    .slice(0, max)
    .map((o) => `${plain ? plainOutcome(o) : outcomeLabel(o)} −${Math.abs(by[o] ?? 0).toFixed(0)}`)
    .join(' · ')
}

function ledgerTotal(by: Partial<Record<Outcome, number>> | undefined): number {
  let n = 0
  for (const o of OUTCOMES) n += Math.abs(by?.[o] ?? 0)
  return n
}

/** Per-archetype SLO targets for a by-type row: "≤400 ms · ≤40 ms/tok". */
function typeSlo(def: RequestTypeDef): string {
  const b = sloBoundsOf(def)
  const parts: string[] = []
  if (Number.isFinite(b.ttftMs)) parts.push(t('report.slo.ttftBound', { v: fmtLatencyMs(b.ttftMs) }))
  if (Number.isFinite(b.tpotMs)) parts.push(t('report.slo.tpotBound', { v: fmtLatencyMs(b.tpotMs) }))
  if (Number.isFinite(b.e2elMs)) parts.push(t('report.slo.e2elBound', { v: fmtLatencyMs(b.e2elMs) }))
  return parts.length ? parts.join(' ') : t('report.slo.none')
}

/** Mean $/Mtoken across the current online serving fleet (wave-report cost telemetry). */
function fleetMeanDollarsPerMtoken(s: GameState): number {
  let sum = 0
  let n = 0
  for (const tw of s.towers) {
    if (tw.def.kind !== 'server') continue
    const lo = loadoutOf(s, tw)
    if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) continue
    const dpm = rackDollarsPerMtoken(s, lo)
    if (Number.isFinite(dpm)) {
      sum += dpm
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * Lay a set of colored "✓ Served 40" tokens out as a wrapping flow. Returns the
 * height used. The token Texts are pooled by the caller.
 */
function flowTokens(
  pool: Text[],
  tokens: { text: string; fill: number }[],
  x0: number,
  y0: number,
  maxW: number,
  center = false,
): number {
  const gap = 12
  const lineH = 18
  const lines: { items: Text[]; w: number }[] = [{ items: [], w: 0 }]
  pool.forEach((tx, i) => {
    const tok = tokens[i]
    tx.visible = !!tok
    if (!tok) return
    tx.text = tok.text
    tx.style.fill = tok.fill
    let line = lines[lines.length - 1]
    const w = tx.width
    if (line.items.length && line.w + gap + w > maxW) {
      line = { items: [], w: 0 }
      lines.push(line)
    }
    line.w += (line.items.length ? gap : 0) + w
    line.items.push(tx)
  })
  lines.forEach((line, li) => {
    let x = center ? x0 + (maxW - line.w) / 2 : x0
    for (const tx of line.items) {
      tx.x = Math.round(x)
      tx.y = y0 + li * lineH
      x += tx.width + gap
    }
  })
  return lines.filter((l) => l.items.length).length * lineH
}

/** The legend tokens for an outcome tally: every non-zero bucket (served always), glyph + label + count. */
function outcomeTokens(c: OutcomeTally, plain: boolean, always: Outcome[] = ['served']): { text: string; fill: number }[] {
  return OUTCOMES.filter((o) => c[o] > 0 || always.includes(o)).map((o) => ({
    text: `${OUTCOME_CHAR[o]} ${plain ? plainOutcome(o) : outcomeLabel(o)} ${c[o]}`,
    fill: outcomeColor(o),
  }))
}

const REPORT_X = 12
const REPORT_Y = 142
const REPORT_W = 360
const REPORT_MAX_H = DESIGN_H - BUILDBAR_H - 10 - REPORT_Y
/** Below this y the expanded report overlaps the Codex bubble's corner. */
const CODEX_TOP = 380

/**
 * The end-of-wave settlement, shown in BOTH modes during the build phase (the
 * telemetry is always collected — Expert merely shows more of it):
 *  - Normal: a compact plain-language summary — the seven-outcome bar, "Too
 *    slow 11 · Refused 1 · Unsafe 3 · Wrong 0", net cash, and one suggested fix
 *    per top cause.
 *  - Expert: the full report — honest Goodput (clean ÷ every request), the
 *    outcome bar + legend, the Trust/SLA ledger per outcome, why answers were
 *    late (by bound) and who refused, TTFT/E2E (and TPOT) in ms, unit cost and
 *    cash, the per-archetype table with its own SLO targets, and the why lines.
 * It folds to a "Wave n report ▸" chip (remembered), and folds automatically
 * while the inspect panel is docked on the left.
 */
export class WaveReportPanel {
  readonly view = new Container()
  private panel = new Container()
  private bg = new Graphics()
  private body = new Container()
  private bodyMask = new Graphics()
  private chipBtn: UIButton
  private foldBtn: UIButton
  private title = label('', 13, COLORS.textBright, 'bold')
  private gauge = new GoodputGauge(150)
  private gaugeNote = label('', 10, COLORS.textDim)
  private bar = new OutcomeBar(REPORT_W - 28, 12)
  private legend: Text[] = []
  private rows: Text[] = []
  private drag: DragScroll
  private thumb = new Graphics()
  private bodyTop = 0
  private collapsed = uiPref('report.collapsed', '0', ['0', '1']) === '1'
  private scroll = 0
  private maxScroll = 0
  private panelH = 0
  private key = ''
  private rep: WaveReport | null = null

  constructor() {
    this.view.x = REPORT_X
    this.view.y = REPORT_Y
    this.view.addChild(this.panel)
    this.panel.addChild(this.bg, this.bodyMask, this.body, this.thumb)
    this.body.mask = this.bodyMask
    this.title.x = 14
    this.title.y = 10
    this.title.style.wordWrap = true
    this.title.style.wordWrapWidth = REPORT_W - 62
    this.panel.addChild(this.title)
    this.gauge.x = 14
    this.body.addChild(this.gauge, this.gaugeNote, this.bar)
    for (let i = 0; i < 7; i++) {
      const tx = label('', 11, COLORS.text, 'bold')
      this.legend.push(tx)
      this.body.addChild(tx)
    }
    for (let i = 0; i < 40; i++) {
      const r = label('', 11, COLORS.text)
      r.x = 14
      r.style.wordWrap = true
      r.style.wordWrapWidth = REPORT_W - 28
      r.style.lineHeight = 15
      this.rows.push(r)
      this.body.addChild(r)
    }
    this.foldBtn = new UIButton({ w: 26, h: 22, accent: COLORS.sla, onTap: () => this.setCollapsed(true) })
    this.foldBtn.x = REPORT_W - 36
    this.foldBtn.y = 7
    setButton(this.foldBtn, '–')
    this.panel.addChild(this.foldBtn)
    this.chipBtn = new UIButton({ w: 210, h: 26, accent: COLORS.sla, onTap: () => this.setCollapsed(false) })
    this.view.addChild(this.chipBtn)
    this.panel.eventMode = 'static'
    this.panel.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= REPORT_W && y >= 0 && y <= this.panelH }
    this.drag = new DragScroll(this.panel, {
      get: () => this.scroll,
      set: (v) => {
        this.scroll = clamp(v, 0, this.maxScroll)
        this.body.y = -this.scroll
        this.drawThumb()
      },
    })
    this.view.visible = false
  }

  /** A slim scroll thumb when the full report is taller than the space below it. */
  private drawThumb(): void {
    const g = this.thumb
    g.clear()
    if (this.maxScroll <= 0) return
    const trackY = this.bodyTop
    const trackH = this.panelH - this.bodyTop - 6
    const thumbH = Math.max(20, (trackH * trackH) / (trackH + this.maxScroll))
    const y = trackY + ((trackH - thumbH) * this.scroll) / this.maxScroll
    g.roundRect(REPORT_W - 7, trackY, 3, trackH, 2).fill({ color: COLORS.panelEdge, alpha: 0.45 })
    g.roundRect(REPORT_W - 8, y, 5, thumbH, 2).fill({ color: COLORS.sla, alpha: 0.85 })
  }

  private setCollapsed(c: boolean): void {
    if (this.drag.swallowTap) return
    this.collapsed = c
    setUiPref('report.collapsed', c ? '1' : '0')
  }

  /** True while the expanded report reaches down into the Codex bubble's corner. */
  get blocksCodex(): boolean {
    return this.view.visible && this.panel.visible && this.view.y + this.panelH > CODEX_TOP
  }

  /**
   * `ghost` = the player holds a build tool: like the NEXT WAVE card, the report fades
   * and lets clicks through, so the board tiles under it stay buildable.
   */
  update(s: GameState, ghost = false): void {
    const rep = s.lastReport
    const show = s.phase === 'build' && !!rep
    this.view.visible = show
    if (!show || !rep) return
    this.view.alpha = ghost ? 0.22 : 1
    this.view.eventMode = ghost ? 'none' : 'passive'
    this.view.interactiveChildren = !ghost
    // sit below the incident banner when it is up (it updates first in the frame)
    this.view.y = Math.max(REPORT_Y, panelLayout.bannerBottom + 6)
    const folded = this.collapsed || panelLayout.inspectLeft
    this.panel.visible = !folded
    this.chipBtn.visible = folded
    if (folded) {
      setButton(this.chipBtn, t('report.chip', { n: rep.waveIndex + 1 }))
      // beside the inspect panel while it occupies the left side, so the chip stays reachable
      this.chipBtn.x = panelLayout.inspectLeft ? INSPECT_W + INSPECT_MARGIN + 8 - REPORT_X : 0
      return
    }
    const expert = isExpert()
    // the report only changes when a new wave settles, the mode or language flips, or the palette swaps
    const key = `${rep.waveIndex}|${s.waveIndex}|${expert}|${getLang()}|${getSettings().a11y.colorblind}|${s.towers.length}`
    if (key === this.key && rep === this.rep) return
    if (rep !== this.rep) this.scroll = 0
    this.key = key
    this.rep = rep

    const w = rep.waveIndex === s.waveIndex && s.currentWave ? s.currentWave : WAVES[rep.waveIndex]
    const name = w ? (rep.waveIndex < WAVES.length ? waveName(w, rep.waveIndex) : w.name) : ''
    this.title.text = expert
      ? `${t('report.title', { n: rep.waveIndex + 1 })} — ${name}`
      : t('report.n.title', { n: rep.waveIndex + 1, name })
    const top = Math.ceil(this.title.height) + 16
    let y = top
    if (expert) {
      this.gauge.visible = true
      this.gaugeNote.visible = true
      this.gauge.y = y
      this.gauge.draw(honestGoodputPct(rep), t('metric.goodput'))
      this.gaugeNote.text = t('report.goodputNote')
      this.gaugeNote.x = 14 + 150 + 10
      this.gaugeNote.y = y + 24
      y += 44
    } else {
      this.gauge.visible = false
      this.gaugeNote.visible = false
    }
    this.bar.x = 14
    this.bar.y = y
    this.bar.draw(rep)
    y += 18
    y += flowTokens(
      this.legend,
      outcomeTokens(rep, !expert, expert ? ['served'] : ['served', 'sloMiss', 'bad', 'unsafe', 'overRefused']),
      14,
      y,
      REPORT_W - 28,
    )
    y += 4

    const lines = expert ? this.expertLines(s, rep as ReportExt) : this.normalLines(s, rep)
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]
      const line = lines[i]
      if (!line || !line.text) {
        row.visible = false
        if (line) y += 6
        continue
      }
      row.visible = true
      row.text = line.text
      row.style.fill = line.fill
      row.style.fontWeight = line.bold ? 'bold' : 'normal'
      row.y = y
      y += row.height + 3
    }
    const contentH = y + 8
    this.panelH = Math.min(REPORT_MAX_H - (this.view.y - REPORT_Y), contentH)
    this.maxScroll = Math.max(0, contentH - this.panelH)
    this.scroll = clamp(this.scroll, 0, this.maxScroll)
    this.body.y = -this.scroll
    this.bg.clear()
    drawPanel(this.bg, 0, 0, REPORT_W, this.panelH, { alpha: 0.94 })
    this.bodyMask.clear()
    this.bodyMask.rect(0, top - 4, REPORT_W, this.panelH - top).fill({ color: COLORS.white, alpha: 0 })
    this.bodyTop = top
    this.drawThumb()
  }

  /** Normal: plain words — net cash and one fix per top cause. */
  private normalLines(s: GameState, rep: WaveReport): { text: string; fill: number; bold?: boolean }[] {
    const net = Math.round(rep.cashIn + rep.clearBonus - rep.powerCost)
    const out: { text: string; fill: number; bold?: boolean }[] = [
      { text: t('report.n.net', { v: net }), fill: net >= 0 ? COLORS.good : COLORS.danger },
    ]
    const trustLost = ledgerTotal(rep.trustLostBy)
    const slaLost = ledgerTotal(rep.slaLostBy)
    if (trustLost >= 0.5) out.push({ text: t('report.n.trust', { v: trustLost.toFixed(0), parts: ledgerParts(rep.trustLostBy, 2, true) }), fill: COLORS.trust })
    if (slaLost >= 0.5) out.push({ text: t('report.n.sla', { v: slaLost.toFixed(0), parts: ledgerParts(rep.slaLostBy, 2, true) }), fill: COLORS.sla })
    out.push({ text: '', fill: COLORS.text })
    const why = whyLines(s, rep, 2)
    out.push({ text: t(why.length ? 'report.n.fix' : 'report.n.clean'), fill: COLORS.textBright, bold: true })
    out.push(...why)
    return out
  }

  /** Expert: the full settlement. */
  private expertLines(s: GameState, rep: ReportExt): { text: string; fill: number; bold?: boolean }[] {
    const out: { text: string; fill: number; bold?: boolean }[] = []
    const trustLost = ledgerTotal(rep.trustLostBy)
    const slaLost = ledgerTotal(rep.slaLostBy)
    if (rep.trustLostBy) out.push({ text: t('report.ledger.trust', { v: trustLost.toFixed(0), parts: ledgerParts(rep.trustLostBy) || '—' }), fill: COLORS.trust })
    if (rep.slaLostBy) out.push({ text: t('report.ledger.sla', { v: slaLost.toFixed(0), parts: ledgerParts(rep.slaLostBy) || '—' }), fill: COLORS.sla })
    if (rep.sloMiss > 0 && rep.sloCauses) {
      const parts = SLO_CAUSES.filter((c) => (rep.sloCauses?.[c] ?? 0) > 0).map((c) => `${t('report.slo.' + c)} ${rep.sloCauses?.[c]}`)
      if (parts.length) out.push({ text: t('report.lateBy', { parts: parts.join(' · ') }), fill: outcomeColor('sloMiss') })
    }
    if (rep.overRefused > 0 && rep.overRefusedBy) {
      out.push({
        text: t('report.refusedBy', { m: rep.overRefusedBy.model ?? 0, g: rep.overRefusedBy.guard ?? 0 }),
        fill: outcomeColor('overRefused'),
      })
    }
    out.push({ text: t('report.cache', { n: rep.cacheHits }), fill: COLORS.cooling })
    out.push({ text: t('report.ttft', { a: fmtLatencyMs(rep.avgTtft * 1000), p: fmtLatencyMs(rep.p95Ttft * 1000) }), fill: COLORS.sla })
    if (rep.avgTpot !== undefined && rep.p95Tpot !== undefined)
      out.push({ text: t('report.tpot', { a: fmtLatencyMs(rep.avgTpot * 1000), p: fmtLatencyMs(rep.p95Tpot * 1000) }), fill: COLORS.sla })
    out.push({ text: t('report.latency', { a: fmtLatencyMs(rep.avgLatency * 1000), p: fmtLatencyMs(rep.p95Latency * 1000) }), fill: COLORS.sla })
    out.push({ text: t('report.dpmt', { v: fmtDollarsPerMtoken(fleetMeanDollarsPerMtoken(s)) }), fill: COLORS.cash })
    const net = Math.round(rep.cashIn + rep.clearBonus - rep.powerCost)
    out.push({ text: t('report.income', { cash: Math.round(rep.cashIn), bonus: Math.round(rep.clearBonus) }), fill: COLORS.cash })
    out.push({ text: t('report.power', { v: rep.powerCost.toFixed(0) }), fill: COLORS.power })
    out.push({ text: t('report.net', { v: net }), fill: net >= 0 ? COLORS.good : COLORS.danger })
    out.push({ text: '', fill: COLORS.text })
    out.push({ text: t('report.byType'), fill: COLORS.textBright, bold: true })
    for (const id of Object.keys(rep.byType)) {
      const def = REQUEST_TYPES[id]
      const row = rep.byType[id]
      if (!def || !row) continue
      const total = OUTCOMES.reduce((n, o) => n + row[o], 0)
      const parts = FAILURES.filter((o) => row[o] > 0).map((o) => `${outcomeLabel(o)} ${row[o]}`)
      out.push({
        text: `${reqShort(def)}  ${row.served}/${total}${parts.length ? '  · ' + parts.join(' · ') : ''}  (${typeSlo(def)})`,
        fill: def.color,
      })
    }
    const why = whyLines(s, rep, 3)
    if (why.length) {
      out.push({ text: '', fill: COLORS.text })
      out.push({ text: t('report.why'), fill: COLORS.textBright, bold: true })
      out.push(...why)
    }
    out.push({ text: t('report.sloMeaning'), fill: COLORS.textDim })
    return out
  }
}

// referenced so tree-shaking keeps the incident data table importable elsewhere
export const _incidentCount = INCIDENTS.length
