import { Container, Graphics, Sprite } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W } from '../config'
import type { GameState } from '../core/types'
import type { TextureFactory } from '../render/textures'
import { BUILD_ORDER, TOWER_DEFS } from '../sim/content'
import { buildCost } from '../sim/actions'
import { hasLab } from '../sim/effects'
import { drawPanel, UIButton } from './theme'

const SHORT: Record<string, string> = {
  srv_small: 'Small',
  srv_general: 'General',
  srv_coding: 'Coding',
  srv_frontier: 'Frontier',
  router: 'Router',
  cache: 'Cache',
  safety: 'Safety',
  power: 'Power',
  cooling: 'Cooling',
  lab: 'Lab',
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

    const w = 100
    const h = 76
    const gap = 6
    let x = 12
    for (const id of BUILD_ORDER) {
      const def = TOWER_DEFS[id]
      const b = new UIButton({ w, h, accent: def.color, onTap: () => cb.onSelect(id) })
      b.x = x
      b.y = y0 + 10
      const icon = new Sprite(factory.tower(def))
      icon.anchor.set(0.5)
      icon.width = 30
      icon.height = 30
      b.iconHost.addChild(icon)
      b.setTitle(SHORT[id]).setSub('$' + def.cost)
      b.layout(34, 8)
      // move icon to upper area, text below for a card feel
      b.iconHost.y = 24
      this.view.addChild(b)
      this.buttons.set(id, b)
      x += w + gap
    }

    this.startBtn = new UIButton({ w: 196, h: 34, accent: COLORS.trust, onTap: cb.onStartWave })
    this.startBtn.x = DESIGN_W - 208
    this.startBtn.y = y0 + 10
    this.view.addChild(this.startBtn)

    this.trainBtn = new UIButton({ w: 196, h: 34, accent: COLORS.data, onTap: cb.onTrain })
    this.trainBtn.x = DESIGN_W - 208
    this.trainBtn.y = y0 + 52
    this.view.addChild(this.trainBtn)
  }

  update(s: GameState, selectedDefId: string | null): void {
    for (const [id, b] of this.buttons) {
      const def = TOWER_DEFS[id]
      const cost = buildCost(s, def)
      const affordable = s.meters.cash >= cost && (s.phase === 'build' || s.phase === 'wave')
      b.setSub('$' + cost)
      b.setEnabled(affordable)
      b.setActive(selectedDefId === id)
      b.layout(34, 8)
      b.iconHost.y = 24
    }
    const canStart = s.phase === 'build'
    this.startBtn.setEnabled(canStart)
    this.startBtn.setTitle(s.phase === 'wave' ? 'WAVE LIVE…' : 'START WAVE  ▶').layout(0, 0, true)

    const canTrain = s.phase === 'build' && hasLab(s)
    this.trainBtn.setEnabled(canTrain)
    this.trainBtn.setTitle(hasLab(s) ? 'TRAIN  ◆' : 'TRAIN (need Lab)').layout(0, 0, true)
  }
}
