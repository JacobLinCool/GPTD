import { Container, Graphics, Sprite } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W } from '../config'
import type { GameState } from '../core/types'
import type { TextureFactory } from '../render/textures'
import { BUILD_ORDER, TOWER_DEFS } from '../sim/content'
import { buildCost } from '../sim/actions'
import { defLoadout, guardPower, hasLab, serverPower } from '../sim/effects'
import { getSettings } from '../settings'
import { t, towerDesc, towerName } from '../i18n'
import { explainDenied } from './denied'
import { BUILD_CODES, KEY, keyCap } from './help'
import { drawPanel, UIButton } from './theme'

/** §5.6 clear, full building labels — no cryptic abbreviations. */
const SHORT: Record<string, string> = {
  srv_edge: 'Edge Rack',
  srv_frontier: 'Big Rack',
  router: 'Router',
  cache: 'Cache',
  guard_encoder: 'Encoder Guard',
  guard_llm: 'LLM Guard',
  guard_mod: 'Moderation',
  power: 'Power Plant',
  cooling: 'Cooling',
  cooling_liquid: 'Liquid Loop',
  lab: 'Training Lab',
}

export interface BuildBarCallbacks {
  onSelect: (defId: string) => void
  onStartWave: () => void
  onTrain: () => void
  /** a tap on a disabled control: float `reason` near the control's center. */
  onDenied: (reason: string, x: number, y: number) => void
}

/** What the START control shows beyond its phase label. */
export interface StartState {
  /** seconds left on the auto-start countdown (null = no countdown). */
  countdown: number | null
}

export class BuildBar {
  readonly view = new Container()
  private bg = new Graphics()
  private buttons = new Map<string, UIButton>()
  private startBtn: UIButton
  private trainBtn: UIButton
  private state: GameState | null = null

  constructor(factory: TextureFactory, cb: BuildBarCallbacks) {
    const y0 = DESIGN_H - BUILDBAR_H
    this.view.y = 0
    this.view.addChild(this.bg)
    drawPanel(this.bg, 0, y0, DESIGN_W, BUILDBAR_H, { radius: 0, alpha: 0.96 })
    this.bg.rect(0, y0, DESIGN_W, 2).fill({ color: COLORS.laneGlow, alpha: 0.5 })

    const padX = 12
    const controlW = 184
    const controlX = DESIGN_W - controlW - padX
    const gap = 6
    const trayW = controlX - padX - 16
    const w = Math.floor((trayW - gap * (BUILD_ORDER.length - 1)) / BUILD_ORDER.length)
    const h = 76
    let x = padX
    const deny = (b: UIButton, why: () => string): void => cb.onDenied(why(), b.x + b.width / 2, b.y)
    for (const id of BUILD_ORDER) {
      const def = TOWER_DEFS[id]
      const b: UIButton = new UIButton({
        w,
        h,
        accent: def.color,
        onTap: () => cb.onSelect(id),
        onDenied: () => deny(b, () => this.cardReason(id)),
        // hover tooltip: full building name, cost + real kW draw, description
        tooltip: () => ({ title: towerName(def), value: this.cardValue(id), body: towerDesc(def) }),
        disabledReason: () => this.cardReason(id),
      })
      b.x = x
      b.y = y0 + 10
      const icon = new Sprite(factory.tower(def))
      icon.anchor.set(0.5)
      icon.width = 28
      icon.height = 28
      b.iconHost.addChild(icon)
      b.setTitle(SHORT[id]).setSub('$' + def.cost)
      b.layoutIconCard()
      this.view.addChild(b)
      this.buttons.set(id, b)
      x += w + gap
    }

    this.startBtn = new UIButton({
      w: controlW,
      h: 34,
      accent: COLORS.trust,
      onTap: cb.onStartWave,
      silent: true,
      onDenied: () => deny(this.startBtn, () => this.startReason()),
      tooltip: () => ({ title: t('build.tip.start'), value: `[${keyCap(KEY.start)}]`, body: t('build.tip.start.body') }),
      disabledReason: () => this.startReason(),
    })
    this.startBtn.x = controlX
    this.startBtn.y = y0 + 10
    this.view.addChild(this.startBtn)

    this.trainBtn = new UIButton({
      w: controlW,
      h: 34,
      accent: COLORS.data,
      onTap: cb.onTrain,
      onDenied: () => deny(this.trainBtn, () => this.trainReason()),
      tooltip: () => ({ title: t('build.tip.train'), value: `[${keyCap(KEY.train)}]`, body: t('build.tip.train.body') }),
      disabledReason: () => this.trainReason(),
    })
    this.trainBtn.x = controlX
    this.trainBtn.y = y0 + 52
    this.view.addChild(this.trainBtn)
  }

  /** "$cost · draws X kW" for a build card. */
  private cardValue(id: string): string {
    const def = TOWER_DEFS[id]
    const s = this.state
    const cost = s ? buildCost(s, def) : def.cost
    const kw =
      def.kind === 'server' && s
        ? serverPower(s, defLoadout(def))
        : def.guardrail?.runsOnRoofline && s
          ? guardPower(s, def.guardrail)
          : (def.powerDraw ?? 0)
    const parts = [`$${cost}`]
    if (kw > 0) parts.push(t('build.tip.draw', { kw: kw >= 10 ? kw.toFixed(0) : kw.toFixed(1) }))
    if (def.power) parts.push(t('build.tip.addPower', { kw: def.power }))
    if (def.cooling) parts.push(t('build.tip.addCooling', { kw: def.cooling }))
    return parts.join(' · ')
  }

  private cardReason(id: string): string {
    return this.state ? explainDenied(this.state, { fn: 'pick', defId: id }) : ''
  }

  private startReason(): string {
    return this.state ? explainDenied(this.state, { fn: 'startWave' }) : ''
  }

  private trainReason(): string {
    return this.state ? explainDenied(this.state, { fn: 'train' }) : ''
  }

  update(s: GameState, selectedDefId: string | null, start: StartState): void {
    this.state = s
    const badges = getSettings().gameplay.showHotkeys
    let i = 0
    for (const [id, b] of this.buttons) {
      const def = TOWER_DEFS[id]
      const cost = buildCost(s, def)
      const affordable = s.meters.cash >= cost && (s.phase === 'build' || s.phase === 'wave')
      b.setTitle(t('build.short.' + id, undefined, SHORT[id]))
      b.setSub('$' + cost)
      b.setEnabled(affordable)
      b.setActive(selectedDefId === id)
      b.layoutIconCard()
      b.setHotkey(badges && BUILD_CODES[i] ? keyCap(BUILD_CODES[i]) : null)
      i++
    }
    const canStart = s.phase === 'build'
    this.startBtn.setEnabled(canStart)
    const startTitle =
      s.phase === 'wave'
        ? t('build.waveLive')
        : start.countdown !== null
          ? t('build.startIn', { n: Math.max(1, Math.ceil(start.countdown)) })
          : t('build.start')
    this.startBtn.setTitle(startTitle).layout(0, 0, true)
    this.startBtn.setHotkey(badges && canStart ? keyCap(KEY.start) : null)

    const canTrain = s.phase === 'build' && hasLab(s)
    this.trainBtn.setEnabled(canTrain)
    const activeSlot = s.research.infra ?? s.research.posttrain ?? s.research.eval
    this.trainBtn
      .setTitle(
        activeSlot
          ? t('build.research', { pct: Math.floor((activeSlot.progress / activeSlot.compute) * 100) })
          : hasLab(s)
            ? t('build.train')
            : t('build.trainNeedLab'),
      )
      .layout(0, 0, true)
    this.trainBtn.setHotkey(badges && canTrain ? keyCap(KEY.train) : null)
  }

  /** Arm the START button's two-step "start anyway" confirm. */
  armStart(prompt: string): void {
    this.startBtn.arm(prompt, 3000)
  }

  get startArmed(): boolean {
    return this.startBtn.isArmed
  }

  disarmStart(): void {
    this.startBtn.disarm()
  }

  /** Design-space center of the START button (anchor for its prompts). */
  get startAnchor(): { x: number; y: number } {
    return { x: this.startBtn.x + this.startBtn.width / 2, y: this.startBtn.y }
  }
}
