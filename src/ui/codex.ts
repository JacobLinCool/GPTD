import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { COLORS } from '../config'
import type { TextureFactory } from '../render/textures'
import { drawPanel, UIButton } from './theme'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CodexMessage {
  text: string
  showNext?: boolean
  highlight?: Rect
}

const AVATAR_X = 58
const AVATAR_Y = 556
const BUBBLE_X = 96
const BUBBLE_W = 392

export class Codex {
  readonly view = new Container()
  private avatar: Sprite
  private bubble = new Graphics()
  private tail = new Graphics()
  private txt: Text
  private nextBtn: UIButton
  private skipBtn: UIButton
  readonly highlight = new Graphics()
  private targetRect: Rect | null = null
  private t = 0

  constructor(factory: TextureFactory, cb: { onNext: () => void; onSkip: () => void }) {
    this.highlight.eventMode = 'none'
    this.avatar = new Sprite(factory.codex())
    this.avatar.anchor.set(0.5)
    this.avatar.width = 56
    this.avatar.height = 56
    this.avatar.x = AVATAR_X
    this.avatar.y = AVATAR_Y

    this.txt = new Text({
      text: '',
      style: {
        fontFamily: 'ui-monospace, monospace',
        fontSize: 14,
        fill: COLORS.text,
        wordWrap: true,
        wordWrapWidth: BUBBLE_W - 28,
        lineHeight: 19,
      },
    })
    this.txt.resolution = 2

    this.nextBtn = new UIButton({ w: 84, h: 28, accent: COLORS.trust, onTap: cb.onNext })
    this.skipBtn = new UIButton({ w: 118, h: 24, accent: COLORS.textDim, onTap: cb.onSkip })
    this.skipBtn.setTitle('Skip tutorial')

    this.view.addChild(
      this.highlight,
      this.tail,
      this.bubble,
      this.txt,
      this.nextBtn,
      this.skipBtn,
      this.avatar,
    )
    this.view.visible = false
  }

  say(msg: CodexMessage): void {
    this.view.visible = true
    this.txt.text = 'CODEX:  ' + msg.text
    const textH = this.txt.height
    const showNext = msg.showNext ?? false
    const btnRow = 34
    const bubbleH = Math.max(64, textH + 22 + btnRow)
    const by = AVATAR_Y - 24 - bubbleH

    this.bubble.clear()
    drawPanel(this.bubble, BUBBLE_X, by, BUBBLE_W, bubbleH, { edge: COLORS.sla, alpha: 0.97 })
    // accent stripe
    this.bubble.roundRect(BUBBLE_X, by, 4, bubbleH, 2).fill({ color: COLORS.sla, alpha: 0.9 })

    // tail toward avatar
    this.tail.clear()
    this.tail
      .moveTo(BUBBLE_X + 18, by + bubbleH)
      .lineTo(BUBBLE_X + 2, by + bubbleH + 18)
      .lineTo(BUBBLE_X + 40, by + bubbleH)
      .closePath()
      .fill({ color: COLORS.panel, alpha: 0.97 })

    this.txt.x = BUBBLE_X + 16
    this.txt.y = by + 12

    this.skipBtn.x = BUBBLE_X + 14
    this.skipBtn.y = by + bubbleH - 30
    this.skipBtn.layout(0, 0, true)
    this.nextBtn.x = BUBBLE_X + BUBBLE_W - 98
    this.nextBtn.y = by + bubbleH - 32
    this.nextBtn.setTitle('Got it ▶').layout(0, 0, true)
    this.nextBtn.visible = showNext

    this.targetRect = msg.highlight ?? null
  }

  hide(): void {
    this.view.visible = false
    this.targetRect = null
  }

  update(dt: number): void {
    if (!this.view.visible) return
    this.t += dt
    this.avatar.y = AVATAR_Y + Math.sin(this.t * 3) * 2.5
    this.highlight.clear()
    if (this.targetRect) {
      const r = this.targetRect
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 6)
      const pad = 3 + pulse * 3
      this.highlight
        .roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, 8)
        .stroke({ width: 2.5, color: COLORS.warn, alpha: 0.6 + pulse * 0.4 })
    }
  }
}
