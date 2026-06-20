import { Container, Graphics, Text } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W, HUD_H, LAT_CLASS_SLO } from '../config'
import type { GameState, InfraCategory, PostTrainMethod, PostTrainTarget, Tower, WaveTypeStat } from '../core/types'
import { getMode, isExpert, setMode } from '../mode'
import { hardwareUpgradeCost, nextHardware, towerValue } from '../sim/actions'
import {
  INCIDENTS,
  INFRA_LIST,
  INFRA_NODES,
  REQUEST_TYPES,
  RESEARCH_DEFS,
  RESEARCH_LIST,
  TECH_PATHS,
  UPGRADES,
  WAVES,
  sizeLabel,
} from '../sim/content'
import { StudioTab } from './studio'
import {
  activeSlotFor,
  requisitionTarget,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
} from '../sim/research'
import {
  cacheChance,
  guardLatencyMs,
  guardPower,
  loadout,
  loadoutOf,
  resolveModel,
  routeBonus,
  serverDeployable,
  serverFitsMemory,
  serverHeat,
  hwNeedsLiquid,
  hasLiquidLoop,
  serverPower,
  serverQuality,
  serverQualityVs,
  serverSpec,
  serverSpeed,
  serverTargets,
} from '../sim/effects'
import {
  effectiveBatch,
  fmtDollarsPerMtoken,
  fmtKw,
  fmtLatencyMs,
  fmtTokS,
  latencyOf,
  rackDollarsPerMtoken,
  rooflineOf,
  sparsityOf,
  vramOf,
} from './metrics'
import { GoodputGauge, QualitySparks, RooflineBars, VramBar } from './charts'
import {
  cycleLang,
  getLang,
  incDesc,
  incName,
  LANG_LABEL,
  t,
  towerName,
  towerTagline,
  upDesc,
  upName,
  waveName,
} from '../i18n'
import { drawPanel, label, UIButton } from './theme'

/* ----------------------- Inspect Panel ----------------------- */

/** Compact display name for a deploy-grid button, e.g. "70B Ins" / "2T Cod". */
function modelShort(s: GameState, id: string): string {
  const m = resolveModel(s, id)
  if (!m) return id
  const suffix = m.variant === 'instruct' ? 'Ins' : m.variant === 'coding' ? 'Cod' : 'Base'
  return `${sizeLabel(m.paramsTotalB)} ${suffix}`
}

const DEPLOY_SLOTS = 8

/** Owned models deployable on this rack — fit VRAM and methods unlocked (or currently loaded), biggest first. */
function deployableModels(s: GameState, tw: Tower): string[] {
  const ids = Object.keys(s.models).filter(
    (id) => resolveModel(s, id) && (serverDeployable(s, loadout(s, tw.hwId, id)) || tw.modelId === id),
  )
  const vOrder = { instruct: 0, coding: 1, base: 2 } as Record<string, number>
  ids.sort((a, b) => {
    const ma = resolveModel(s, a)
    const mb = resolveModel(s, b)
    if (!ma || !mb) return ma ? -1 : mb ? 1 : 0
    return mb.paramsTotalB - ma.paramsTotalB || vOrder[ma.variant] - vOrder[mb.variant]
  })
  return ids.slice(0, DEPLOY_SLOTS)
}

export interface InspectCallbacks {
  onSell: (id: number) => void
  onDeploy: (id: number, modelId: string) => void
  onUpgradeHw: (id: number) => void
  onRole: (id: number) => void
}

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
    this.head.text = title
    this.head.style.fill = this.headColor
    const h = 20 + this.nRows * this.rowStep + extra + 5
    this.bg.clear()
    drawPanel(this.bg, 0, 0, this.w, h, { alpha: 0.5, edge: this.headColor, radius: 6 })
    return h
  }
  set(i: number, text: string, fill: number = COLORS.text): void {
    if (i >= this.rows.length) return
    this.rows[i].text = text
    this.rows[i].style.fill = fill
  }
}

const INSPECT_MARGIN = 12
const INSPECT_TOP = HUD_H + INSPECT_MARGIN
const INSPECT_BOTTOM = DESIGN_H - BUILDBAR_H - INSPECT_MARGIN
const INSPECT_MAX_H = INSPECT_BOTTOM - INSPECT_TOP

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * S3 RackInspect (§5.2): for a SERVER in Expert Mode, four cards — HARDWARE,
 * DEPLOYED MODEL (5-axis sparks + lineage chip + dual-written params), ROOFLINE
 * (twin-bars + VRAM stacked bar), LIVE (utilization / TTFT / TPOT / tok-s /
 * $/Mtoken / power / KV / batch / state) — then the deploy grid, rack upgrade,
 * role, and sell controls. Non-servers and Normal Mode keep a compact line panel.
 */
export class InspectPanel {
  readonly view = new Container()
  private bg = new Graphics()
  private content = new Container()
  private contentMask = new Graphics()
  private scrollChrome = new Graphics()
  private title = label('', 15, COLORS.textBright, 'bold')
  private tag = label('', 12, COLORS.textDim)
  // compact line panel (non-server / Normal-mode server)
  private lines: Text[] = []
  // S3 expert cards
  private cardHw = new Card(360 - 28, 3, COLORS.power)
  private cardModel = new Card(360 - 28, 4, COLORS.data)
  private cardRoof = new Card(360 - 28, 0, COLORS.cooling)
  private cardLive = new Card(360 - 28, 5, COLORS.good)
  private roofBars = new RooflineBars(360 - 28 - 16)
  private vramBar = new VramBar(360 - 28 - 16)
  private sparks = new QualitySparks(360 - 28 - 16, 13)
  private deployHead = label('', 11, COLORS.textDim, 'bold')
  private modelBtns: { btn: UIButton; modelId: string | null }[] = []
  private hwBtn: UIButton
  private roleBtn: UIButton
  private sellBtn: UIButton
  private W = 360
  private lastH = 0
  private scroll = 0
  private maxScroll = 0
  private lastSelectedId: number | null = null

  constructor(cb: InspectCallbacks) {
    this.view.x = DESIGN_W - this.W - INSPECT_MARGIN
    this.view.y = INSPECT_TOP
    this.view.addChild(this.bg, this.contentMask, this.content, this.scrollChrome)
    this.content.mask = this.contentMask
    this.view.eventMode = 'static'
    this.view.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= this.W && y >= 0 && y <= INSPECT_MAX_H }
    this.view.on('wheel', (ev: any) => {
      if (this.maxScroll <= 0) return
      const dy = ev.deltaY ?? ev.nativeEvent?.deltaY ?? 0
      this.scroll = clamp(this.scroll + dy * 0.45, 0, this.maxScroll)
      this.layoutScroll()
    })
    this.add(this.title, 14, 12)
    this.add(this.tag, 14, 34)
    for (let i = 0; i < 9; i++) {
      const t = label('', 12, COLORS.text)
      t.x = 14
      t.y = 58 + i * 18
      this.lines.push(t)
      this.content.addChild(t)
    }
    // expert cards (positioned each frame in update())
    this.cardModel.view.addChild(this.sparks)
    this.cardRoof.view.addChild(this.roofBars, this.vramBar)
    this.content.addChild(this.cardHw.view, this.cardModel.view, this.cardRoof.view, this.cardLive.view)

    this.addContent(this.deployHead, 14, 204)
    const bw = (this.W - 28 - 6) / 2
    for (let i = 0; i < DEPLOY_SLOTS; i++) {
      const slot: { btn: UIButton; modelId: string | null } = { btn: null as unknown as UIButton, modelId: null }
      slot.btn = new UIButton({
        w: bw,
        h: 34,
        accent: COLORS.data,
        onTap: () => this.curId != null && slot.modelId && cb.onDeploy(this.curId, slot.modelId),
      })
      slot.btn.x = 14 + (i % 2) * (bw + 6)
      this.content.addChild(slot.btn)
      this.modelBtns.push(slot)
    }
    this.hwBtn = new UIButton({
      w: this.W - 28,
      h: 26,
      accent: COLORS.power,
      onTap: () => this.curId != null && cb.onUpgradeHw(this.curId),
    })
    this.hwBtn.x = 14
    this.content.addChild(this.hwBtn)
    this.roleBtn = new UIButton({
      w: this.W - 28,
      h: 24,
      accent: COLORS.cooling,
      onTap: () => this.curId != null && cb.onRole(this.curId),
    })
    this.roleBtn.x = 14
    this.content.addChild(this.roleBtn)
    this.sellBtn = new UIButton({
      w: this.W - 28,
      h: 30,
      accent: COLORS.warn,
      onTap: () => this.curId != null && cb.onSell(this.curId),
    })
    this.sellBtn.x = 14
    this.content.addChild(this.sellBtn)
    this.view.visible = false
  }
  private curId: number | null = null
  private add(t: Text, x: number, y: number): void {
    t.x = x
    t.y = y
    this.view.addChild(t)
  }

  private addContent(t: Text, x: number, y: number): void {
    t.x = x
    t.y = y
    this.content.addChild(t)
  }

  private layoutScroll(): void {
    this.content.y = -this.scroll
    this.scrollChrome.clear()
    if (this.maxScroll <= 0) return
    const trackX = this.W - 8
    const trackY = 54
    const trackH = INSPECT_MAX_H - trackY - 10
    const thumbH = Math.max(28, (trackH * INSPECT_MAX_H) / this.lastH)
    const thumbY = trackY + ((trackH - thumbH) * this.scroll) / this.maxScroll
    this.scrollChrome.roundRect(trackX, trackY, 3, trackH, 2).fill({ color: COLORS.panelEdge, alpha: 0.45 })
    this.scrollChrome.roundRect(trackX - 1, thumbY, 5, thumbH, 2).fill({ color: COLORS.sla, alpha: 0.85 })
  }

  private setExpertCardsVisible(v: boolean): void {
    this.cardHw.view.visible = v
    this.cardModel.view.visible = v
    this.cardRoof.view.visible = v
    this.cardLive.view.visible = v
  }

  update(s: GameState, selectedId: number | null): void {
    const tw = selectedId == null ? undefined : s.towers.find((x) => x.id === selectedId)
    this.view.visible = !!tw
    if (!tw) {
      this.curId = null
      this.lastSelectedId = null
      return
    }
    this.curId = tw.id
    if (this.lastSelectedId !== tw.id) {
      this.lastSelectedId = tw.id
      this.scroll = 0
    }
    const isServer = tw.def.kind === 'server'
    const expertServer = isServer && isExpert()
    const lo = isServer ? loadoutOf(s, tw) : null
    const deployable = isServer ? deployableModels(s, tw) : []
    const gridRows = Math.max(1, Math.ceil(deployable.length / 2))

    if (isServer && lo) {
      this.title.text = lo.hw ? t(`hw.${lo.hw.id}.name`, undefined, lo.hw.name) : towerName(tw.def)
      this.tag.text = lo.model ? lo.model.name : towerTagline(tw.def)
    } else {
      this.title.text = towerName(tw.def)
      this.tag.text = towerTagline(tw.def)
    }

    // --- body: either the four expert cards (server) or the line panel ---
    this.setExpertCardsVisible(expertServer)
    let bodyBottom: number
    if (expertServer && lo) {
      for (const l of this.lines) l.text = ''
      bodyBottom = this.drawRackCards(s, tw, lo)
    } else {
      const ls = statLines(s, tw)
      for (let i = 0; i < this.lines.length; i++) this.lines[i].text = ls[i] ?? ''
      bodyBottom = 58 + (isServer ? 9 : Math.max(2, ls.length)) * 18 + 6
    }

    // deploy grid (servers) starts under the body
    const gridY = bodyBottom + (isServer ? 18 : 0)
    this.deployHead.visible = isServer
    this.deployHead.y = bodyBottom
    for (let i = 0; i < this.modelBtns.length; i++) {
      const slot = this.modelBtns[i]
      slot.btn.y = gridY + Math.floor(i / 2) * 38
    }
    const hwY = isServer ? gridY + gridRows * 38 + 6 : bodyBottom
    const roleVisible = isServer && s.infra.disagg
    const h = isServer ? hwY + 26 + 6 + (roleVisible ? 30 : 0) + 6 + 40 : bodyBottom + 12
    const visibleH = Math.min(h, INSPECT_MAX_H)
    this.view.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= this.W && y >= 0 && y <= visibleH }

    if (h !== this.lastH) {
      this.lastH = h
    }
    this.bg.clear()
    drawPanel(this.bg, 0, 0, this.W, visibleH)
    this.contentMask.clear()
    this.contentMask.rect(0, 50, this.W, Math.max(0, visibleH - 56)).fill({ color: COLORS.white, alpha: 0 })
    this.maxScroll = Math.max(0, h - visibleH)
    this.scroll = clamp(this.scroll, 0, this.maxScroll)
    this.layoutScroll()
    this.hwBtn.y = hwY
    this.roleBtn.y = hwY + 32
    this.roleBtn.visible = roleVisible
    if (roleVisible && tw.def.kind === 'server') {
      const role = tw.role ?? 'auto'
      this.roleBtn
        .setTitle(t('inspect.role.' + role))
        .setActive(role !== 'auto')
        .setEnabled(s.phase === 'build')
        .layout(0, 0, true)
    }
    this.sellBtn.y = h - 40

    // deploy grid + rack upgrade (servers only)
    this.hwBtn.visible = isServer
    for (let i = 0; i < this.modelBtns.length; i++) {
      const slot = this.modelBtns[i]
      const modelId = deployable[i] ?? null
      slot.modelId = modelId
      slot.btn.visible = isServer && modelId != null
    }
    if (isServer && lo) {
      this.deployHead.text = t('inspect.deploy')
      for (const slot of this.modelBtns) {
        if (!slot.modelId) continue
        const current = tw.modelId === slot.modelId
        const fits = serverFitsMemory(s, loadout(s, tw.hwId, slot.modelId))
        slot.btn.setTitle(t(`model.${slot.modelId}.short`, undefined, modelShort(s, slot.modelId)))
        slot.btn.setSub(current ? t('inspect.loaded') : fits ? t('inspect.deployFree') : t('inspect.noFit'))
        slot.btn.setEnabled(!current && fits)
        slot.btn.setActive(current)
        slot.btn.layout(0, 8)
      }
      const next = nextHardware(tw)
      if (next) {
        const cost = hardwareUpgradeCost(s, tw)
        const blockedByLiquid = hwNeedsLiquid(next) && !hasLiquidLoop(s)
        this.hwBtn.setTitle(
          t('inspect.upgradeHw', {
            name: t(`hw.${next.id}.short`, undefined, next.name.replace(' GPU Rack', '')),
            cost,
          }),
        )
        this.hwBtn.setSub(blockedByLiquid ? t('inspect.liquidGate') : '')
        this.hwBtn.setEnabled(!blockedByLiquid && s.meters.cash >= cost)
      } else {
        this.hwBtn.setTitle(t('inspect.hwMaxed'))
        this.hwBtn.setSub('')
        this.hwBtn.setEnabled(false)
      }
      this.hwBtn.layout(0, 0, true)
    }

    this.sellBtn.setTitle(t('inspect.sell', { v: Math.round(towerValue(s, tw) * 0.6) })).layout(0, 0, true)
  }

  /** Render the four S3 cards for an expert server. Returns the y past the last card. */
  private drawRackCards(s: GameState, tw: Tower, lo: ReturnType<typeof loadoutOf>): number {
    const cx = 14
    let y = 50
    const cardGap = 4
    const hw = lo.hw
    const model = lo.model
    const fits = serverFitsMemory(s, lo)

    // --- HARDWARE ---
    if (hw) {
      this.cardHw.set(
        0,
        t('rack.hw.gpu', { model: hw.gpuModel, n: hw.gpus }),
        COLORS.text,
      )
      this.cardHw.set(
        1,
        t('rack.hw.compute', {
          fp8: fmtTokS(hw.fp8Tflops),
          bf16: fmtTokS(hw.bf16Tflops),
        }),
      )
      this.cardHw.set(
        2,
        t('rack.hw.mem', { gb: hw.hbmGb, bw: hw.hbmTbs.toFixed(1), tdp: (hw.tdpWatts / 1000).toFixed(1), cool: t('rack.cool.' + hw.cooling) }),
      )
    }
    y += this.cardHw.draw(cx, y, t('rack.card.hw')) + cardGap

    // --- DEPLOYED MODEL ---
    if (model) {
      const sp = sparsityOf(lo)
      const lineageChip = model.origin === 'derived' && model.lineage
        ? t('rack.model.derived', { depth: model.lineage.depth })
        : t('rack.model.base')
      this.cardModel.set(0, `${model.name}  ${lineageChip}`, model.origin === 'derived' ? COLORS.data : COLORS.textDim)
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
        t('rack.model.arch', { win: (model.contextWindowK).toFixed(0), bytes: model.weightBytes, attn: model.attn }),
      )
      this.cardModel.set(
        3,
        t('rack.model.align', {
          safety: model.alignment.safety.toFixed(0),
          style: t('rack.refusal.' + model.alignment.refusalStyle),
        }),
        COLORS.trust,
      )
    }
    const modelH = this.cardModel.draw(cx, y, t('rack.card.model'), this.sparks.height2 + 10)
    // 5-axis quality sparkbars under the rows (agentic highlighted)
    this.sparks.x = 8
    this.sparks.y = 20 + 4 * 14 + 4
    this.sparks.draw({
      chat: serverQualityVs(s, lo, 'chat'),
      coding: serverQualityVs(s, lo, 'coding'),
      reasoning: serverQualityVs(s, lo, 'reasoning'),
      general: serverQualityVs(s, lo, 'general'),
      agentic: serverQualityVs(s, lo, 'agentic'),
    })
    y += modelH + cardGap

    // --- ROOFLINE ---
    const rf = rooflineOf(s, lo)
    const v = vramOf(s, lo)
    // aggregate decode throughput at the rack's effective batch (the live decode bar).
    const aggDecode = latencyOf(s, lo, 1500, 256).aggDecodeTokS
    this.roofBars.x = 8
    this.roofBars.y = 17
    this.roofBars.draw(
      rf.prefillTokS,
      aggDecode,
      rf.binding,
      fmtTokS(rf.prefillTokS) + ' tok/s',
      fmtTokS(aggDecode) + ' tok/s',
    )
    this.vramBar.x = 8
    this.vramBar.y = 76
    this.vramBar.draw(v.weightsGb, v.kvFreeGb, v.headroomGb, v.totalGb)
    const roofExtra = 94
    y += this.cardRoof.draw(cx, y, fits ? t('rack.card.roof') : t('rack.card.roofNoFit'), roofExtra) + cardGap

    // --- LIVE ---
    const batch = effectiveBatch(s, lo)
    const lat = latencyOf(s, lo, 1500, 256)
    const gated = hwNeedsLiquid(hw) && !hasLiquidLoop(s)
    const state = tw.training
      ? t('rack.state.training')
      : !tw.online
        ? gated
          ? t('rack.state.liquidGate')
          : t('rack.state.brownout')
        : tw.throttle < 1
          ? t('rack.state.throttle')
          : t('rack.state.online')
    this.cardLive.set(0, t('rack.live.util', { v: Math.round(tw.load * 100), batch }), tw.load >= 1 ? COLORS.warn : COLORS.text)
    this.cardLive.set(
      1,
      t('rack.live.lat', { ttft: fmtLatencyMs(lat.ttftMs), tpot: fmtLatencyMs(lat.tpotMs) }),
      COLORS.sla,
    )
    this.cardLive.set(2, t('rack.live.toks', { perUser: fmtTokS(lat.perUserDecodeTokS), agg: fmtTokS(lat.aggDecodeTokS) }))
    this.cardLive.set(3, t('rack.live.cost', { dpmt: fmtDollarsPerMtoken(rackDollarsPerMtoken(s, lo)), kw: fmtKw(serverPower(s, lo)) }), COLORS.cash)
    const stateColor = tw.training ? COLORS.data : !tw.online ? COLORS.danger : tw.throttle < 1 ? COLORS.warn : COLORS.good
    this.cardLive.set(4, t('rack.live.state', { kv: Math.round(s.infra.kv.utilization * 100), state }), stateColor)
    y += this.cardLive.draw(cx, y, t('rack.card.live')) + cardGap
    return y
  }
}

function rangeLine(d: Tower['def']): string {
  return `${t('inspect.range')}  ${d.range.toFixed(1)} ${t('inspect.tiles')}`
}

function statLines(s: GameState, tw: Tower): string[] {
  const d = tw.def
  const out: string[] = []
  if (d.kind === 'server') {
    // Normal Mode (and any non-expert server view): the friendly card — same
    // simulation, fewer dials. (Expert servers render the four S3 cards instead.)
    const lo = loadoutOf(s, tw)
    const { hw } = lo
    const gated = hwNeedsLiquid(hw) && !hasLiquidLoop(s)
    const status = tw.online
      ? tw.throttle < 1
        ? t('inspect.throttled')
        : t('inspect.online')
      : gated
        ? t('inspect.liquidGate')
        : t('inspect.brownout')
    out.push(`${t('inspect.quality')}  ${serverQuality(s, lo).toFixed(0)} ${t('inspect.qualityNote')}`)
    out.push(`${t('inspect.speed')}  ${serverSpeed(s, lo).toFixed(0)} ${t('inspect.computePerSec')}`)
    out.push(`${t('inspect.bestAt')}  ${t('spec.' + serverSpec(lo))}`)
    out.push(`${t('inspect.batch')}  ${serverTargets(s, lo)} ${t('inspect.atOnce')}`)
    out.push(t('inspect.powerHeat', { p: serverPower(s, lo).toFixed(2), h: serverHeat(s, lo).toFixed(2) }))
    out.push(rangeLine(d))
    out.push(`${t('inspect.status')}  ${status}`)
    if (!serverFitsMemory(s, lo)) out.push(t('inspect.noMemory'))
  } else if (d.kind === 'router') {
    out.push(t('inspect.router.bonus', { v: Math.round(routeBonus(s, d) * 100) }))
    out.push(rangeLine(d))
    out.push(t('inspect.router.l1'))
    out.push(t('inspect.router.l2'))
  } else if (d.kind === 'cache') {
    out.push(t('inspect.cache.hit', { v: Math.round(cacheChance(s, d) * 100) }))
    out.push(rangeLine(d))
    out.push(t('inspect.cache.l1'))
    out.push(t('inspect.cache.l2'))
  } else if (d.kind === 'guardrail' && d.guardrail) {
    const g = d.guardrail
    out.push(t('inspect.guardrail.lat', { v: guardLatencyMs(s, g).toFixed(0) }))
    out.push(rangeLine(d))
    out.push(t('inspect.guardrail.catches', { v: g.catches.join(', ') }))
    out.push(t('inspect.guardrail.side.' + g.side))
    if (g.runsOnRoofline) out.push(t('inspect.guardrail.power', { v: guardPower(s, g).toFixed(1) }))
  } else if (d.kind === 'power') {
    out.push(t('inspect.power.cap', { v: d.power ?? 0 }))
    out.push(t('inspect.power.l1'))
  } else if (d.kind === 'cooling') {
    out.push(t('inspect.cooling.cap', { v: d.cooling ?? 0 }))
    out.push(t('inspect.cooling.l1'))
  } else if (d.kind === 'cooling_liquid') {
    out.push(t('inspect.coolingLiquid.cap', { v: d.cooling ?? 0 }))
    out.push(t('inspect.coolingLiquid.l1'))
    out.push(t('inspect.coolingLiquid.l2'))
  } else if (d.kind === 'lab') {
    out.push(t('inspect.lab.l1'))
    out.push(t('inspect.lab.l2'))
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
    if (!inc) {
      this.view.visible = false
      return
    }
    this.view.visible = true
    const prefix = s.phase === 'wave' ? t('inc.active') : t('inc.next')
    this.txt.text = `${inc.icon}  ${prefix}: ${incName(inc)} — ${incDesc(inc)}`
    this.txt.style.fill = inc.good ? COLORS.trust : COLORS.warn
    const w = Math.min(DESIGN_W - 40, this.txt.width + 28)
    const h = Math.max(34, Math.ceil(this.txt.height) + 14)
    this.txt.y = Math.round((h - this.txt.height) / 2)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, w, h, { edge: inc.good ? COLORS.trust : COLORS.warn })
    this.view.x = (DESIGN_W - w) / 2
  }
}

/* ----------------------- Training Panel (modal) ----------------------- */

type TrainTab = 'upgrades' | 'infra' | 'studio'
const HAS_UPGRADES = UPGRADES.length > 0

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
  private tab: TrainTab = HAS_UPGRADES ? 'upgrades' : 'infra'
  // upgrades tab
  private upView = new Container()
  private btns = new Map<string, UIButton>()
  private pathRefs: { header: Text; theme: Text }[] = []
  // infra tab (grouped, scrollable)
  private rdView = new Container()
  private rdScroll = new Container()
  private rdBtns = new Map<string, UIButton>()
  private rdHeaders: { cat: InfraCategory; text: Text }[] = []
  private rdExtraHeads: Text[] = []
  private rdStatus: Text
  private rdScrollUp: UIButton
  private rdScrollDn: UIButton
  private rdOffset = 0
  private rdContentH = 0
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

    this.tabUp = new UIButton({ w: 150, h: 28, accent: COLORS.sla, onTap: () => (this.tab = 'upgrades') })
    this.tabUp.x = px + 300
    this.tabUp.y = py + 38
    this.tabInfra = new UIButton({ w: 150, h: 28, accent: COLORS.power, onTap: () => (this.tab = 'infra') })
    this.tabInfra.x = HAS_UPGRADES ? px + 458 : px + 404
    this.tabInfra.y = py + 38
    this.tabStudio = new UIButton({ w: 220, h: 28, accent: COLORS.data, onTap: () => (this.tab = 'studio') })
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

    // --- INFRA tab: the serving tree grouped by category (clipped + scrollable),
    //     plus the method-unlock + eval nodes. Each node is one research card. ---
    this.rdView.addChild(this.rdScroll)
    const clipY = py + 78
    const clipH = this.PH - 78 - 70
    const clip = new Graphics().rect(px + 12, clipY, this.PW - 24, clipH).fill({ color: 0x000000, alpha: 0.001 })
    this.rdScroll.mask = clip
    this.rdView.addChild(clip)
    this.rdScroll.x = px + 24
    this.rdScroll.y = clipY

    const rW = 366
    const rH = 64
    const cols = 3
    let y = 0
    // serving infra nodes, grouped by category
    for (const cat of INFRA_CATEGORY_ORDER) {
      const nodes = INFRA_LIST.filter((n) => n.category === cat)
      if (!nodes.length) continue
      const hdr = label('', 13, COLORS.power, 'bold')
      hdr.x = 0
      hdr.y = y
      this.rdScroll.addChild(hdr)
      this.rdHeaders.push({ cat, text: hdr })
      y += 22
      nodes.forEach((n, i) => {
        const b = new UIButton({ w: rW, h: rH, accent: COLORS.power, onTap: () => onResearch(n.id) })
        b.x = (i % cols) * (rW + 12)
        b.y = y + Math.floor(i / cols) * (rH + 8)
        this.rdScroll.addChild(b)
        this.rdBtns.set(n.id, b)
      })
      y += Math.ceil(nodes.length / cols) * (rH + 8) + 8
    }
    // method-unlock nodes (r_pt_*) + eval nodes (r_eval_*)
    const extraGroups: { key: string; ids: string[]; color: number }[] = [
      { key: 'methods', ids: RESEARCH_LIST.filter((d) => d.id.startsWith('r_pt_')).map((d) => d.id), color: COLORS.data },
      { key: 'eval', ids: RESEARCH_LIST.filter((d) => d.kind === 'eval').map((d) => d.id), color: COLORS.warn },
    ]
    for (const grp of extraGroups) {
      const hdr = label('', 13, grp.color, 'bold')
      hdr.x = 0
      hdr.y = y
      hdr.name = grp.key
      this.rdScroll.addChild(hdr)
      this.rdExtraHeads.push(hdr)
      y += 22
      grp.ids.forEach((rid, i) => {
        const b = new UIButton({ w: rW, h: rH, accent: grp.color, onTap: () => onResearch(rid) })
        b.x = (i % cols) * (rW + 12)
        b.y = y + Math.floor(i / cols) * (rH + 8)
        this.rdScroll.addChild(b)
        this.rdBtns.set(rid, b)
      })
      y += Math.ceil(grp.ids.length / cols) * (rH + 8) + 8
    }
    this.rdContentH = y
    this.rdClipH = clipH

    this.rdScrollUp = new UIButton({ w: 28, h: 26, accent: COLORS.sla, onTap: () => this.scrollInfra(-1) })
    this.rdScrollDn = new UIButton({ w: 28, h: 26, accent: COLORS.sla, onTap: () => this.scrollInfra(1) })
    this.rdScrollUp.x = px + this.PW - 44
    this.rdScrollUp.y = clipY
    this.rdScrollDn.x = px + this.PW - 44
    this.rdScrollDn.y = clipY + clipH - 26
    this.rdScrollUp.setTitle('▲').layout(0, 0, true)
    this.rdScrollDn.setTitle('▼').layout(0, 0, true)
    this.rdView.addChild(this.rdScrollUp, this.rdScrollDn)

    this.rdStatus = label('', 12, COLORS.textDim)
    this.rdStatus.x = px + 24
    this.rdStatus.y = py + this.PH - 60
    this.rdStatus.style.wordWrap = true
    this.rdStatus.style.wordWrapWidth = this.PW - 80
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

  private rdClipH = 0

  private scrollInfra(dir: number): void {
    const max = Math.max(0, this.rdContentH - this.rdClipH)
    this.rdOffset = Math.max(0, Math.min(max, this.rdOffset + dir * 120))
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
    this.rdScroll.y = this.py + 78 - this.rdOffset
    for (const h of this.rdHeaders) h.text.text = t('infra.' + h.cat).toUpperCase()
    for (const h of this.rdExtraHeads) {
      h.text = h.name === 'methods' ? t('train.studioMethods') : t('train.evalNodes')
    }
    const max = Math.max(0, this.rdContentH - this.rdClipH)
    this.rdScrollUp.setEnabled(this.rdOffset > 0)
    this.rdScrollDn.setEnabled(this.rdOffset < max)

    for (const def of RESEARCH_LIST) {
      const b = this.rdBtns.get(def.id)
      if (!b) continue
      const node = INFRA_NODES[def.id]
      const owned = researchOwned(s, def)
      const slot = activeSlotFor(s, def)
      const active = slot != null
      const unlocked = researchUnlocked(s, def)
      const trackBusy = s.research[researchTrackOf(def)] != null
      // §4.3 conflict: a node whose conflicting node is owned can't be taken.
      const conflictOwned = !!node?.conflicts?.some((c) => (s.upgrades[c] ?? 0) > 0)
      const pct = slot ? Math.floor((slot.progress / slot.compute) * 100) : 0
      b.setTitle(t(`research.${def.id}.name`, undefined, def.name))
      const meta = node
        ? `  ${node.optimizes.map((o) => t('opt.' + o)).join('/')} · ${t('coupling.' + node.coupling)} · ${node.sourceRef}`
        : ''
      b.setSub(
        owned
          ? t('research.done')
          : active
            ? t('research.progress', { pct })
            : conflictOwned
              ? t('research.conflict')
              : unlocked
                ? t('research.cost', { data: def.dataCost, compute: Math.round(def.compute / 1000) }) + meta
                : t('research.locked'),
      )
      b.setEnabled(!owned && !trackBusy && unlocked && !conflictOwned && s.data >= def.dataCost)
      b.setActive(owned || active)
      b.layoutCard(8, 9)
    }
    const activeSlot = s.research.infra ?? s.research.posttrain ?? s.research.eval
    if (activeSlot) {
      const def = RESEARCH_DEFS[activeSlot.id]
      this.rdStatus.text = t('research.status', {
        name: def ? t(`research.${def.id}.name`, undefined, def.name) : activeSlot.id,
        pct: Math.floor((activeSlot.progress / activeSlot.compute) * 100),
        flops: Math.round(requisitionTarget(s)),
      })
    } else {
      this.rdStatus.text = t('research.idle')
    }
  }
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
      pushStats(lines, s)
      this.actionBtn.setAccent(COLORS.trust).setTitle(t('win.again'))
    } else {
      this.title.text = t('lose.title')
      this.title.style.fill = COLORS.danger
      this.subtitle.text = t(s.message)
      this.subtitle.style.fill = COLORS.danger
      pushStats(lines, s)
      this.actionBtn.setAccent(COLORS.warn).setTitle(t('lose.again'))
    }
    for (let i = 0; i < this.body.length; i++) {
      const tx = this.body[i]
      tx.text = lines[i] ?? ''
      tx.anchor.set(0.5, 0)
      tx.x = DESIGN_W / 2
    }
    const menu = kind === 'menu'
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
  /** Re-render the currently shown overlay (e.g. after a language switch). */
  refresh(): void {
    if (this.view.visible && this.lastState) this.show(this.lastKind, this.lastState)
  }
  hide(): void {
    this.view.visible = false
  }
}

/* ----------------------- Wave Report (Expert Mode settlement) ----------------------- */

/** §5.3 the six terminal outcomes (+leaked), spelled out with full labels. */
const OUTCOME_KEYS: { key: keyof WaveTypeStat; i18n: string; fill: number }[] = [
  { key: 'served', i18n: 'outcome.served', fill: COLORS.good },
  { key: 'sloMiss', i18n: 'outcome.sloMiss', fill: COLORS.warn },
  { key: 'bad', i18n: 'outcome.bad', fill: COLORS.danger },
  { key: 'unservable', i18n: 'outcome.unservable', fill: COLORS.textDim },
  { key: 'unsafe', i18n: 'outcome.unsafe', fill: COLORS.danger },
  { key: 'overRefused', i18n: 'outcome.overRefused', fill: COLORS.data },
]

/** Short readable archetype code for the wave-report per-type table (no glyphs, §5.3). */
const REQ_CODE: Record<string, string> = {
  embed: 'EMB',
  chat: 'CHAT',
  comp: 'CODE',
  rag: 'RAG',
  summ: 'SUM',
  reason: 'RSN',
  agent: 'AGNT',
  batch: 'BTCH',
  jailbreak: 'JAIL',
}

export class WaveReportPanel {
  readonly view = new Container()
  private bg = new Graphics()
  private title = label('', 13, COLORS.textBright, 'bold')
  private gauge = new GoodputGauge(150)
  private rows: Text[] = []
  private closeBtn: UIButton
  private W = 360
  private shownWave = -2
  private dismissed = false

  constructor() {
    this.view.x = 12
    this.view.y = 142
    this.view.addChild(this.bg)
    this.title.x = 14
    this.title.y = 10
    this.title.style.wordWrap = true
    this.title.style.wordWrapWidth = this.W - 62
    this.view.addChild(this.title)
    this.gauge.x = 14
    this.gauge.y = 30
    this.view.addChild(this.gauge)
    for (let i = 0; i < 24; i++) {
      const r = label('', 11, COLORS.text)
      r.x = 14
      r.y = 72 + i * 16
      r.style.wordWrap = true
      r.style.wordWrapWidth = this.W - 28
      r.style.lineHeight = 15
      this.rows.push(r)
      this.view.addChild(r)
    }
    this.closeBtn = new UIButton({
      w: 26,
      h: 22,
      accent: COLORS.sla,
      onTap: () => (this.dismissed = true),
    })
    this.closeBtn.x = this.W - 36
    this.closeBtn.y = 7
    this.closeBtn.setTitle('✕').layout(0, 0, true)
    this.view.addChild(this.closeBtn)
    this.view.visible = false
  }

  update(s: GameState): void {
    const rep = s.lastReport
    if (rep && rep.waveIndex !== this.shownWave) {
      this.shownWave = rep.waveIndex
      this.dismissed = false
    }
    const show = isExpert() && s.phase === 'build' && !!rep && !this.dismissed
    this.view.visible = show
    if (!show || !rep) return

    const w = WAVES[rep.waveIndex]
    this.title.text = `${t('report.title', { n: rep.waveIndex + 1 })} — ${w ? waveName(w, rep.waveIndex) : ''}`
    // headline Goodput gauge (§1.3)
    this.gauge.draw(rep.goodputPct, t('metric.goodput'))

    const net = Math.round(rep.cashIn + rep.clearBonus - rep.powerCost)
    const lines: { text: string; fill: number }[] = []
    lines.push({ text: t('report.answered', { served: rep.served, slomiss: rep.sloMiss, bad: rep.bad }), fill: COLORS.text })
    lines.push({ text: t('report.failed', { unservable: rep.unservable, unsafe: rep.unsafe, refused: rep.overRefused }), fill: COLORS.textDim })
    lines.push({ text: t('report.leaked', { n: rep.leaked, cache: rep.cacheHits }), fill: COLORS.textDim })
    const target = reportSloTarget(rep)
    if (target) {
      lines.push({
        text: t('report.sloTarget', { target }),
        fill: COLORS.warn,
      })
      lines.push({ text: t('report.sloMeaning'), fill: COLORS.textDim })
    }
    lines.push({
      text: t('report.latency', { a: rep.avgLatency.toFixed(1), p: rep.p95Latency.toFixed(1) }),
      fill: COLORS.sla,
    })
    lines.push({
      text: t('report.ttft', { a: rep.avgTtft.toFixed(1), p: rep.p95Ttft.toFixed(1) }),
      fill: COLORS.sla,
    })
    // wave $/Mtoken (fleet mean of the racks that served it) — the unit-cost telemetry.
    const dpm = fleetMeanDollarsPerMtoken(s)
    lines.push({ text: t('report.dpmt', { v: fmtDollarsPerMtoken(dpm) }), fill: COLORS.cash })
    lines.push({ text: t('report.income', { cash: Math.round(rep.cashIn), bonus: Math.round(rep.clearBonus) }), fill: COLORS.cash })
    lines.push({ text: t('report.power', { v: rep.powerCost.toFixed(0) }), fill: COLORS.power })
    lines.push({ text: t('report.net', { v: net }), fill: net >= 0 ? COLORS.good : COLORS.danger })
    lines.push({ text: '', fill: COLORS.text })
    lines.push({ text: t('report.byType'), fill: COLORS.textBright })
    for (const id of Object.keys(rep.byType)) {
      const def = REQUEST_TYPES[id]
      const row = rep.byType[id]
      if (!def || !row) continue
      const total = OUTCOME_KEYS.reduce((n, o) => n + (row[o.key] as number), 0) + row.leaked
      const parts: string[] = []
      // served/total then any non-zero failure buckets, each with its full label
      for (const o of OUTCOME_KEYS) {
        const v = row[o.key] as number
        if (o.key === 'served') continue
        if (v > 0) parts.push(`${t(o.i18n)} ${v}`)
      }
      if (row.leaked > 0) parts.push(`${t('outcome.leaked')} ${row.leaked}`)
      const code = REQ_CODE[id] ?? id.slice(0, 4).toUpperCase()
      const txt = `${code}  ${row.served}/${total}${parts.length ? '  · ' + parts.join(' · ') : ''}`
      lines.push({ text: txt, fill: def.color })
    }
    let y = 72
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]
      const line = lines[i]
      if (!line) {
        row.text = ''
        row.visible = false
        continue
      }
      if (!line.text) {
        row.text = ''
        row.visible = false
        y += 8
        continue
      }
      row.visible = true
      row.text = line.text
      row.style.fill = line.fill
      row.x = 14
      row.y = y
      y += row.height + 4
    }
    const h = Math.min(DESIGN_H - BUILDBAR_H - this.view.y - 10, y + 10)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, this.W, h, { alpha: 0.94 })
  }
}

function reportSloTarget(rep: { byType: Record<string, WaveTypeStat> }): string | null {
  const ttft: number[] = []
  const tpot: number[] = []
  const e2e: number[] = []
  for (const id of Object.keys(rep.byType)) {
    const def = REQUEST_TYPES[id]
    if (!def) continue
    const cls = LAT_CLASS_SLO[def.latClass]
    const ttftBound = def.ttftSloMs ?? cls.ttftMs
    if (Number.isFinite(ttftBound)) ttft.push(ttftBound)
    if (Number.isFinite(cls.tpotMs)) tpot.push(cls.tpotMs)
    if (def.e2elSloMs !== undefined && Number.isFinite(def.e2elSloMs)) e2e.push(def.e2elSloMs)
  }
  if (!ttft.length && !tpot.length && !e2e.length) return null
  const parts: string[] = []
  if (ttft.length) parts.push(`TTFT ≤ ${formatMs(Math.min(...ttft))}`)
  if (tpot.length) parts.push(`TPOT ≤ ${formatMs(Math.min(...tpot))}`)
  if (e2e.length) parts.push(`E2E ≤ ${formatMs(Math.min(...e2e))}`)
  return parts.join(' · ')
}

function formatMs(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + ' s' : Math.round(ms) + ' ms'
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

function pushStats(lines: string[], s: GameState): void {
  lines.push(t('stats.reached', { wave: s.waveIndex + 1, total: s.endless ? '∞' : WAVES.length }))
  lines.push('')
  lines.push(`${t('stats.served')}   ${s.stats.served}`)
  lines.push(`${t('stats.bad')}   ${s.stats.bad}`)
  lines.push(`${t('stats.unsafe')}   ${s.stats.unsafe}`)
  lines.push(`${t('stats.leaked')}   ${s.stats.leaked}`)
  lines.push(`${t('stats.earned')}   $${Math.round(s.stats.cashEarned)}`)
}

// referenced so tree-shaking keeps the incident data table importable elsewhere
export const _incidentCount = INCIDENTS.length
