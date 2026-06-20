import { Container, Graphics, Sprite } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W } from '../config'
import type { GameState } from '../core/types'
import type { TextureFactory } from '../render/textures'
import { BUILD_ORDER, TOWER_DEFS } from '../sim/content'
import { buildCost } from '../sim/actions'
import { hasLab } from '../sim/effects'
import { t, towerDesc, towerName } from '../i18n'
import { addTooltip } from './tooltip'
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
}

export class BuildBar {
  readonly view = new Container()
  private bg = new Graphics()
  private buttons = new Map<string, UIButton>()
  private startBtn: UIButton
  private trainBtn: UIButton

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
    for (const id of BUILD_ORDER) {
      const def = TOWER_DEFS[id]
      const b = new UIButton({ w, h, accent: def.color, onTap: () => cb.onSelect(id) })
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
      // hover tooltip: full building name + description
      addTooltip(b, () => ({ title: towerName(def), body: towerDesc(def) }))
      x += w + gap
    }

    this.startBtn = new UIButton({ w: controlW, h: 34, accent: COLORS.trust, onTap: cb.onStartWave })
    this.startBtn.x = controlX
    this.startBtn.y = y0 + 10
    this.view.addChild(this.startBtn)

    this.trainBtn = new UIButton({ w: controlW, h: 34, accent: COLORS.data, onTap: cb.onTrain })
    this.trainBtn.x = controlX
    this.trainBtn.y = y0 + 52
    this.view.addChild(this.trainBtn)
  }

  update(s: GameState, selectedDefId: string | null): void {
    for (const [id, b] of this.buttons) {
      const def = TOWER_DEFS[id]
      const cost = buildCost(s, def)
      const affordable = s.meters.cash >= cost && (s.phase === 'build' || s.phase === 'wave')
      b.setTitle(t('build.short.' + id, undefined, SHORT[id]))
      b.setSub('$' + cost)
      b.setEnabled(affordable)
      b.setActive(selectedDefId === id)
      b.layoutIconCard()
    }
    const canStart = s.phase === 'build'
    this.startBtn.setEnabled(canStart)
    this.startBtn.setTitle(s.phase === 'wave' ? t('build.waveLive') : t('build.start')).layout(0, 0, true)

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
  }
}
