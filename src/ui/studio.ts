/**
 * ui/studio.ts — S9 Post-Training Studio (§5.2), the centerpiece picker.
 *
 * Pick a BASE (any owned base or derived checkpoint, via resolveModel), a METHOD
 * (only unlocked methods; locked ones show their requiresTech), and a TARGET
 * (only the recipe's allowedTargets). Set EFFORT on a 5-notch discrete slider
 * (EFFORT_NOTCHES {0.25,0.5,1.0,1.5,2.0}). A live PREVIEW shows projected Data +
 * compute cost + waves, the projected qualityBy delta (before→after sparkbars,
 * agentic highlighted), the alignment/over-refusal movement, and the resulting
 * derived name — all from the PURE `studioPreview` helper (parity with
 * deriveModel). A TRAIN button calls startPostTrain; while a run is in flight the
 * posttrain track progress is shown.
 *
 * Pure presentation: reads GameState + studioPreview; drives the sim only via the
 * startPostTrain callback.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS } from '../config'
import type { CapabilityAxis, GameState, ModelDef, PostTrainMethod, PostTrainTarget } from '../core/types'
import { METHOD_RECIPES } from '../sim/content'
import { EFFORT_NOTCHES, resolveModel, studioPreview } from '../sim/models'
import { canPostTrain, methodUnlocked, requisitionTarget } from '../sim/research'
import { RESEARCH_TARGET_SECONDS } from '../sim/content'
import { modelName, t } from '../i18n'
import { drawPanel, label, UIButton } from './theme'

const AXES: CapabilityAxis[] = ['chat', 'coding', 'reasoning', 'general', 'agentic']
const METHOD_ORDER: PostTrainMethod[] = ['sft', 'lora', 'qlora', 'dora', 'dpo', 'rlhf', 'cai', 'grpo', 'cpt', 'distill', 'qat', 'merge']
const METHOD_W = 112
const METHOD_H = 42
const METHOD_COL_GAP = 118
const METHOD_ROW_GAP = 46
const BASE_VISIBLE_ROWS = 6
const BASE_ITEM_W = 230
const BASE_ITEM_H = 50
const BASE_ROW_STEP = 54
const BASE_ARROW_W = 28
const BASE_ARROW_H = 22
const PREVIEW_W = 360
const PREVIEW_H = 360
const PREVIEW_PAD = 12
const TRAIN_H = 34

export interface StudioCallbacks {
  onPostTrain: (baseIds: string[], method: PostTrainMethod, target: PostTrainTarget, effort: number) => boolean
}

export class StudioTab {
  readonly view = new Container()

  // selection state (persisted across frames)
  private baseId: string | null = null
  private mergeId: string | null = null
  private method: PostTrainMethod = 'sft'
  private target: PostTrainTarget = 'chat'
  private effort = 1.0
  private baseScroll = 0

  // base list
  private baseHead = label('', 12, COLORS.textDim, 'bold')
  private baseBtns: { btn: UIButton; id: string | null }[] = []
  private baseUp: UIButton
  private baseDn: UIButton
  private mergeHead = label('', 11, COLORS.textDim)

  // method picker
  private methodHead = label('', 12, COLORS.textDim, 'bold')
  private methodBtns = new Map<PostTrainMethod, UIButton>()

  // target picker
  private targetHead = label('', 12, COLORS.textDim, 'bold')
  private targetBtns: { btn: UIButton; target: PostTrainTarget }[] = []

  // effort slider
  private effortHead = label('', 12, COLORS.textDim, 'bold')
  private effortBtns: { btn: UIButton; v: number }[] = []

  // preview
  private prevG = new Graphics()
  private prevTitle = label('', 14, COLORS.textBright, 'bold')
  private prevName = label('', 13, COLORS.data, 'bold')
  private prevRows: Text[] = []
  private sparkG = new Graphics()
  private sparkLabels: Text[] = []
  private trainBtn: UIButton
  private progLbl = label('', 12, COLORS.sla)

  private cb: StudioCallbacks
  // panel-relative origin (set in layout)
  private ox = 0
  private oy = 0
  private targetBtnCount = 8

  constructor(cb: StudioCallbacks) {
    this.cb = cb

    this.view.addChild(this.baseHead, this.mergeHead, this.methodHead, this.targetHead, this.effortHead)

    // base list: each card needs room for the model name plus one metadata line.
    for (let i = 0; i < BASE_VISIBLE_ROWS; i++) {
      const slot: { btn: UIButton; id: string | null } = { btn: null as unknown as UIButton, id: null }
      slot.btn = new UIButton({ w: BASE_ITEM_W, h: BASE_ITEM_H, accent: COLORS.cooling, onTap: () => this.pickBase(slot.id) })
      this.view.addChild(slot.btn)
      this.baseBtns.push(slot)
    }
    this.baseUp = new UIButton({ w: BASE_ARROW_W, h: BASE_ARROW_H, accent: COLORS.sla, onTap: () => (this.baseScroll = Math.max(0, this.baseScroll - 1)) })
    this.baseDn = new UIButton({ w: BASE_ARROW_W, h: BASE_ARROW_H, accent: COLORS.sla, onTap: () => (this.baseScroll += 1) })
    this.baseUp.setTitle('▲').layout(0, 0, true)
    this.baseDn.setTitle('▼').layout(0, 0, true)
    this.view.addChild(this.baseUp, this.baseDn)

    // method picker (3 cols)
    for (const m of METHOD_ORDER) {
      const btn = new UIButton({ w: METHOD_W, h: METHOD_H, accent: COLORS.power, onTap: () => this.pickMethod(m) })
      this.view.addChild(btn)
      this.methodBtns.set(m, btn)
    }

    // target picker (placeholder buttons; relabelled per recipe)
    for (let i = 0; i < this.targetBtnCount; i++) {
      const slot: { btn: UIButton; target: PostTrainTarget } = { btn: null as unknown as UIButton, target: 'chat' }
      slot.btn = new UIButton({ w: 96, h: 28, accent: COLORS.good, onTap: () => (this.target = slot.target) })
      this.view.addChild(slot.btn)
      this.targetBtns.push(slot)
    }

    // effort 5-notch slider
    EFFORT_NOTCHES.forEach((v) => {
      const btn = new UIButton({ w: 64, h: 30, accent: COLORS.cash, onTap: () => (this.effort = v) })
      this.view.addChild(btn)
      this.effortBtns.push({ btn, v })
    })

    // preview
    this.view.addChild(this.prevG, this.prevTitle, this.prevName, this.sparkG)
    this.prevName.style.wordWrap = true
    this.prevName.style.wordWrapWidth = PREVIEW_W - PREVIEW_PAD * 2
    for (let i = 0; i < 9; i++) {
      const r = label('', 11, COLORS.text)
      r.style.wordWrap = true
      r.style.wordWrapWidth = PREVIEW_W - PREVIEW_PAD * 2
      r.style.lineHeight = 15
      this.prevRows.push(r)
      this.view.addChild(r)
    }
    for (let i = 0; i < AXES.length; i++) {
      const l = label('', 9, COLORS.textDim)
      this.sparkLabels.push(l)
      this.view.addChild(l)
    }
    this.trainBtn = new UIButton({ w: PREVIEW_W - PREVIEW_PAD * 2, h: TRAIN_H, accent: COLORS.trust, onTap: () => this.doTrain() })
    this.progLbl.style.wordWrap = true
    this.progLbl.style.wordWrapWidth = PREVIEW_W - PREVIEW_PAD * 2
    this.view.addChild(this.trainBtn, this.progLbl)
  }

  private pickBase(id: string | null): void {
    if (!id) return
    if (this.method === 'merge') {
      // merge needs two: first tap sets base, second sets the partner.
      if (!this.baseId || this.baseId === id) this.baseId = id
      else if (!this.mergeId || this.mergeId === id) this.mergeId = id
      else this.mergeId = id
    } else {
      this.baseId = id
    }
  }

  private pickMethod(m: PostTrainMethod): void {
    this.method = m
    const recipe = METHOD_RECIPES[m]
    // snap target to a valid one for the new method
    if (!recipe.allowedTargets.includes(this.target)) this.target = recipe.allowedTargets[0]
    if (m !== 'merge') this.mergeId = null
  }

  private doTrain(): void {
    if (!this.baseId) return
    const ids = this.method === 'merge' ? [this.baseId, this.mergeId ?? this.baseId] : [this.baseId]
    this.cb.onPostTrain(ids, this.method, this.target, this.effort)
  }

  /** Position everything relative to the panel's (px,py) and the tab's content box. */
  layout(px: number, py: number): void {
    this.ox = px + 24
    this.oy = py + 80
    const { ox, oy } = this

    this.baseHead.x = ox
    this.baseHead.y = oy
    const y = oy + 22
    for (let i = 0; i < this.baseBtns.length; i++) {
      this.baseBtns[i].btn.x = ox
      this.baseBtns[i].btn.y = y + i * BASE_ROW_STEP
    }
    const arrowOffset = (BASE_ITEM_H - BASE_ARROW_H) / 2
    this.baseUp.x = ox + BASE_ITEM_W + 4
    this.baseUp.y = y + arrowOffset
    this.baseDn.x = ox + BASE_ITEM_W + 4
    this.baseDn.y = y + (BASE_VISIBLE_ROWS - 1) * BASE_ROW_STEP + arrowOffset
    this.mergeHead.x = ox
    this.mergeHead.y = y + BASE_VISIBLE_ROWS * BASE_ROW_STEP + 4

    // method column (3 cols) to the right of the base list
    const mx = ox + 290
    this.methodHead.x = mx
    this.methodHead.y = oy
    METHOD_ORDER.forEach((m, i) => {
      const btn = this.methodBtns.get(m)!
      btn.x = mx + (i % 3) * METHOD_COL_GAP
      btn.y = oy + 22 + Math.floor(i / 3) * METHOD_ROW_GAP
    })

    // target row under the method grid
    const ty = oy + 22 + 4 * METHOD_ROW_GAP + 10
    this.targetHead.x = mx
    this.targetHead.y = ty
    this.targetBtns.forEach((slot, i) => {
      slot.btn.x = mx + (i % 4) * 100
      slot.btn.y = ty + 22 + Math.floor(i / 4) * 32
    })

    // effort slider under the targets
    const ey = ty + 22 + 2 * 32 + 8
    this.effortHead.x = mx
    this.effortHead.y = ey
    this.effortBtns.forEach((slot, i) => {
      slot.btn.x = mx + i * 70
      slot.btn.y = ey + 22
    })

    // preview panel on the far right
    const pvx = ox + 720
    this.prevG.x = pvx
    this.prevG.y = oy
    this.prevTitle.x = pvx + PREVIEW_PAD
    this.prevTitle.y = oy + 10
    this.prevName.x = pvx + PREVIEW_PAD
    this.prevName.y = oy + 32
    for (let i = 0; i < this.prevRows.length; i++) {
      this.prevRows[i].x = pvx + PREVIEW_PAD
      this.prevRows[i].y = oy + 56 + i * 16
    }
    this.sparkG.x = pvx + PREVIEW_PAD
    this.sparkG.y = oy + 210
    for (let i = 0; i < this.sparkLabels.length; i++) {
      this.sparkLabels[i].x = pvx + PREVIEW_PAD
      this.sparkLabels[i].y = this.sparkG.y + i * 16
    }
    this.trainBtn.x = pvx + PREVIEW_PAD
    this.trainBtn.y = oy + PREVIEW_H - TRAIN_H - PREVIEW_PAD
    this.progLbl.x = pvx + PREVIEW_PAD
    this.progLbl.y = this.trainBtn.y - 24
  }

  /** All owned checkpoints (base + derived), biggest first — the base picker list. */
  private ownedModels(s: GameState): ModelDef[] {
    const out: ModelDef[] = []
    for (const id of Object.keys(s.models)) {
      const m = resolveModel(s, id)
      if (m) out.push(m)
    }
    out.sort((a, b) => (a.origin === b.origin ? b.paramsTotalB - a.paramsTotalB : a.origin === 'base' ? -1 : 1))
    return out
  }

  update(s: GameState): void {
    // default base = the first owned model
    const owned = this.ownedModels(s)
    if (!this.baseId && owned.length) this.baseId = owned[0].id
    if (this.baseId && !resolveModel(s, this.baseId)) this.baseId = owned[0]?.id ?? null

    this.baseHead.text = t('studio.base')
    this.methodHead.text = t('studio.method')
    this.targetHead.text = t('studio.target')
    this.effortHead.text = t('studio.effort')

    // --- base list ---
    const maxScroll = Math.max(0, owned.length - this.baseBtns.length)
    if (this.baseScroll > maxScroll) this.baseScroll = maxScroll
    this.baseUp.setEnabled(this.baseScroll > 0)
    this.baseDn.setEnabled(this.baseScroll < maxScroll)
    for (let i = 0; i < this.baseBtns.length; i++) {
      const slot = this.baseBtns[i]
      const m = owned[i + this.baseScroll]
      slot.id = m?.id ?? null
      slot.btn.visible = !!m
      if (!m) continue
      const isBase = m.id === this.baseId
      const isMerge = m.id === this.mergeId
      slot.btn.setTitle(modelName(m))
      slot.btn.setSub(t('studio.baseSub', {
        origin: m.origin === 'derived' ? t('models.d', { d: m.lineage?.depth ?? 0 }) : t('models.base'),
        total: m.paramsTotalB,
        active: m.paramsActiveB,
      }))
      slot.btn.setActive(isBase || isMerge)
      slot.btn.setAccent(isMerge ? COLORS.data : COLORS.cooling)
      slot.btn.setEnabled(true)
      slot.btn.layoutCard(8, 9)
    }
    this.mergeHead.visible = this.method === 'merge'
    if (this.method === 'merge') {
      const a = this.baseId ? modelName(resolveModel(s, this.baseId)) : '—'
      const b = this.mergeId ? modelName(resolveModel(s, this.mergeId)) : '—'
      this.mergeHead.text = t('studio.mergePair', { a, b })
    }

    // --- method picker ---
    for (const m of METHOD_ORDER) {
      const btn = this.methodBtns.get(m)!
      const recipe = METHOD_RECIPES[m]
      const unlocked = methodUnlocked(s, m)
      btn.setTitle(t('method.' + m, undefined, recipe.name))
      btn.setSub(
        unlocked
          ? t('studio.methodCost', { c: recipe.costCompute, d: recipe.costData })
          : t('studio.locked', {
              tech: t('tech.short.' + (recipe.requiresTech ?? ''), undefined, recipe.requiresTech ?? ''),
            }),
      )
      btn.setActive(this.method === m)
      btn.setEnabled(unlocked)
      btn.layoutCard(8, 8)
    }

    // --- target picker (allowedTargets for the chosen method) ---
    const recipe = METHOD_RECIPES[this.method]
    const targets = recipe.allowedTargets
    for (let i = 0; i < this.targetBtns.length; i++) {
      const slot = this.targetBtns[i]
      const tg = targets[i]
      slot.btn.visible = tg != null
      if (!tg) continue
      slot.target = tg
      slot.btn.setTitle(t('ptt.' + tg, undefined, tg))
      slot.btn.setActive(this.target === tg)
      slot.btn.layout(0, 0, true)
    }

    // --- effort slider ---
    for (const slot of this.effortBtns) {
      slot.btn.setTitle('×' + slot.v).setActive(this.effort === slot.v).layout(0, 0, true)
    }

    this.drawPreview(s)
  }

  private drawPreview(s: GameState): void {
    this.prevG.clear()
    drawPanel(this.prevG, 0, 0, PREVIEW_W, PREVIEW_H, { alpha: 0.7, edge: COLORS.data })
    this.prevTitle.text = t('studio.preview')
    this.positionPreviewCta()

    if (!this.baseId) {
      this.prevName.text = t('studio.pickBase')
      for (const r of this.prevRows) {
        r.text = ''
        r.visible = false
      }
      this.sparkG.clear()
      for (const l of this.sparkLabels) l.text = ''
      this.trainBtn.setTitle(t('studio.train')).setEnabled(false).layout(0, 0, true)
      this.progLbl.text = ''
      return
    }

    const perWave = requisitionTarget(s) * RESEARCH_TARGET_SECONDS
    const prev = studioPreview(s, this.baseId, this.method, this.target, this.effort, perWave, this.mergeId ?? undefined)
    if (!prev) {
      this.prevName.text = t('studio.invalid')
      for (const r of this.prevRows) {
        r.text = ''
        r.visible = false
      }
      this.sparkG.clear()
      for (const l of this.sparkLabels) l.text = ''
      this.trainBtn.setTitle(t('studio.train')).setEnabled(false).layout(0, 0, true)
      this.progLbl.text = ''
      return
    }

    this.prevName.text = prev.fields.name

    const lines: { text: string; fill: number }[] = []
    lines.push({ text: t('studio.prev.cost', { data: prev.dataCost, compute: Math.round(prev.computeCost / 1000), waves: prev.estWaves || '?' }), fill: COLORS.cash })
    lines.push({ text: t('studio.prev.params', { total: prev.fields.paramsTotalB, active: prev.fields.paramsActiveB, moe: prev.fields.isMoE ? t('rack.model.moe') : t('rack.model.dense') }), fill: COLORS.text })
    if (prev.safetyDelta !== 0 || prev.overRefusalDelta !== 0) {
      lines.push({
        text: t('studio.prev.align', {
          safety: signed(prev.safetyDelta, 0),
          over: signed(prev.overRefusalDelta * 100, 0) + '%',
          style: t('rack.refusal.' + prev.fields.alignment.refusalStyle),
        }),
        fill: COLORS.trust,
      })
    }
    if (prev.fields.isReasoning && !prev.base.isReasoning) lines.push({ text: t('studio.prev.thinker'), fill: COLORS.data })
    lines.push({ text: '', fill: COLORS.text })
    lines.push({ text: t('studio.prev.deltaHead'), fill: COLORS.textBright })

    this.layoutPreviewRows(lines)

    // before→after sparkbars (agentic highlighted)
    this.drawDeltaSparks(prev.before, prev.fields.qualityBy)

    // train button — gated by canPostTrain + affordability
    const ids = this.method === 'merge' ? [this.baseId, this.mergeId ?? this.baseId] : [this.baseId]
    const canStart = canPostTrain(s, ids, this.method, this.target) && s.data >= prev.dataCost && !s.research.posttrain
    const running = !!s.research.posttrain
    this.trainBtn
      .setTitle(running ? t('studio.running') : t('studio.trainCost', { data: prev.dataCost }))
      .setEnabled(canStart)
      .layout(0, 0, true)

    if (running) {
      const slot = s.research.posttrain!
      const pct = Math.floor((slot.progress / slot.compute) * 100)
      this.progLbl.text = t('studio.progress', { method: t('method.' + (slot.meta?.method ?? ''), undefined, slot.meta?.method ?? ''), pct })
      this.progLbl.style.fill = COLORS.sla
    } else if (!canStart && s.data < prev.dataCost) {
      this.progLbl.text = t('studio.needData', { data: prev.dataCost })
      this.progLbl.style.fill = COLORS.warn
    } else {
      this.progLbl.text = ''
    }
  }

  private layoutPreviewRows(lines: { text: string; fill: number }[]): void {
    const x = this.prevG.x + PREVIEW_PAD
    let y = this.prevG.y + 56
    for (let i = 0; i < this.prevRows.length; i++) {
      const row = this.prevRows[i]
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
      row.x = x
      row.y = y
      y += row.height + 7
    }
    const chartY = Math.min(y + 8, this.trainBtn.y - 112)
    this.sparkG.x = x
    this.sparkG.y = chartY
    for (let i = 0; i < this.sparkLabels.length; i++) {
      this.sparkLabels[i].x = x
      this.sparkLabels[i].y = chartY + i * 16
    }
  }

  private positionPreviewCta(): void {
    this.trainBtn.x = this.prevG.x + PREVIEW_PAD
    this.trainBtn.y = this.prevG.y + PREVIEW_H - TRAIN_H - PREVIEW_PAD
    this.progLbl.x = this.prevG.x + PREVIEW_PAD
    this.progLbl.y = this.trainBtn.y - 24
  }

  /** Per-axis before→after bars: dim base bar + bright delta cap, agentic highlighted. */
  private drawDeltaSparks(before: Record<CapabilityAxis, number>, after: Record<CapabilityAxis, number>): void {
    const g = this.sparkG
    g.clear()
    const barX = 56
    const barW = 220
    const rowH = 16
    AXES.forEach((axis, i) => {
      const y = i * rowH + 2
      const b = Math.max(0, Math.min(1, before[axis] / 100))
      const a = Math.max(0, Math.min(1, after[axis] / 100))
      const hl = axis === 'agentic'
      g.roundRect(barX, y, barW, 9, 2).fill({ color: 0x0a0e14, alpha: 0.85 })
      // base portion (dim)
      g.roundRect(barX, y, Math.max(2, barW * Math.min(a, b)), 9, 2).fill({ color: hl ? 0x6b5a1f : 0x2c4566 })
      // gain (bright green) or loss (red), drawn from min→max
      if (a > b) g.rect(barX + barW * b, y, barW * (a - b), 9).fill({ color: COLORS.good })
      else if (a < b) g.rect(barX + barW * a, y, barW * (b - a), 9).fill({ color: COLORS.danger, alpha: 0.7 })
      if (hl) g.roundRect(barX - 1, y - 1, barW + 2, 11, 3).stroke({ width: 1, color: COLORS.cash, alpha: 0.7 })
      // axis labels are siblings positioned in view-space, left of the bars.
      const l = this.sparkLabels[i]
      l.text = `${SHORT[axis]} ${after[axis].toFixed(0)}`
      l.style.fill = hl ? COLORS.cash : COLORS.textDim
      l.x = this.sparkG.x
      l.y = this.sparkG.y + y - 2
    })
  }
}

const SHORT: Record<CapabilityAxis, string> = {
  chat: 'Chat',
  coding: 'Code',
  reasoning: 'Rsn',
  general: 'Gen',
  agentic: 'Agnt',
}

function signed(v: number, digits: number): string {
  const r = v.toFixed(digits)
  return v > 0 ? '+' + r : r
}
