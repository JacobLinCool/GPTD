/**
 * ui/notifications.ts — the ONE notification stack: research finished, a new
 * checkpoint minted (with a one-click rollout between waves), an achievement
 * unlocked, the first brownout / throttle of a wave. A cleared wave is told by
 * the board's banner and the wave report, so it does not also take a card. Cards stack upward from just above the build
 * bar, left of the inspect column, so they never cover the incident banner,
 * the Codex bubble, the next-wave card or an open modal (while a modal is up
 * the stack hides and its timers pause). At most three show at once; hovering
 * a card holds it, clicking runs its action (e.g. open the Training Lab).
 */
import { Container, Graphics } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W } from '../config'
import { prefersReducedMotion } from '../settings'
import { fitLabel, INSPECT_MARGIN, INSPECT_W } from './panelKit'
import { drawPanel, label, UIButton } from './theme'

export type NotifyKind = 'research' | 'checkpoint' | 'achievement' | 'power' | 'heat'

export interface Notice {
  kind: NotifyKind
  /** small caps line ("RESEARCH COMPLETE"). */
  head: string
  /** the main line ("Continuous Batching"). */
  title: string
  accent: number
  /** draws a 28×28 glyph at (0,0); defaults to a kind glyph. */
  icon?: (g: Graphics, color: number) => void
  /** what a click does (open the related panel). */
  onClick?: () => void
  /** a one-click follow-up on the card's right edge (e.g. "DEPLOY ×3" for a new checkpoint). */
  action?: { label: string; run: () => void }
  /** seconds on screen (default 3.5, 7 with an action). */
  ttl?: number
}

const W = 300
const H = 52
const GAP = 8
const MAX_VISIBLE = 3
const RIGHT = DESIGN_W - INSPECT_MARGIN - INSPECT_W - 12 // left of the inspect-panel column
const BOTTOM = DESIGN_H - BUILDBAR_H - 12
const SLIDE = 0.12
/** the action button on the card's right edge */
const ACT_W = 92
const ACT_H = 26

/** Default kind glyphs (vector, house pixel-neon style). */
function kindIcon(g: Graphics, kind: NotifyKind, c: number): void {
  switch (kind) {
    case 'research': // flask
      g.poly([11, 5, 11, 12, 6, 22, 22, 22, 17, 12, 17, 5]).stroke({ width: 1.5, color: c })
      g.moveTo(9, 17).lineTo(19, 17).stroke({ width: 3, color: c, alpha: 0.6 })
      break
    case 'checkpoint': // chip + spark
      g.roundRect(6, 7, 14, 14, 2).stroke({ width: 1.5, color: c })
      g.rect(10, 11, 6, 6).fill({ color: c })
      g.poly([23, 3, 24.5, 6.5, 28, 8, 24.5, 9.5, 23, 13, 21.5, 9.5, 18, 8, 21.5, 6.5]).fill({ color: c })
      break
    case 'power': // bolt
      g.poly([16, 3, 8, 14, 13, 14, 11, 25, 20, 11, 14, 11, 18, 3]).fill({ color: c })
      break
    case 'heat': // thermometer
      g.roundRect(12, 4, 4, 13, 2).stroke({ width: 1.4, color: c })
      g.circle(14, 20, 4).fill({ color: c })
      g.rect(13, 9, 2, 9).fill({ color: c })
      break
    default:
      g.circle(14, 14, 10).stroke({ width: 1.5, color: c })
      g.circle(14, 14, 4).fill({ color: c })
  }
}

class Card {
  readonly view = new Container()
  private bg = new Graphics()
  private icon = new Graphics()
  private head = label('', 10, COLORS.textDim, 'bold')
  private title = label('', 13, COLORS.textBright, 'bold')
  private actBtn: UIButton
  notice: Notice | null = null
  life = 0
  age = 0
  hovered = false
  targetY = 0

  constructor(onClick: (c: Card) => void) {
    this.icon.x = 14
    this.icon.y = 12
    this.head.x = 54
    this.head.y = 9
    this.title.x = 54
    this.title.y = 24
    this.actBtn = new UIButton({
      w: ACT_W,
      h: ACT_H,
      accent: COLORS.trust,
      onTap: () => {
        const run = this.notice?.action?.run
        this.release()
        run?.()
      },
    })
    this.actBtn.x = W - ACT_W - 10
    this.actBtn.y = (H - ACT_H) / 2
    this.actBtn.visible = false
    this.view.addChild(this.bg, this.icon, this.head, this.title, this.actBtn)
    this.view.eventMode = 'static'
    this.view.cursor = 'pointer'
    this.view.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= W && y >= 0 && y <= H }
    this.view.on('pointerover', () => (this.hovered = true))
    this.view.on('pointerout', () => (this.hovered = false))
    this.view.on('pointertap', (e) => {
      // the action button handles its own tap
      if (this.actBtn.visible && e.target === this.actBtn) return
      if (this.actBtn.visible && this.actBtn.hovered) return
      onClick(this)
    })
    this.view.visible = false
  }

  bind(n: Notice): void {
    this.notice = n
    this.life = n.ttl ?? (n.action ? 7 : 3.5)
    this.age = 0
    this.hovered = false
    this.actBtn.visible = !!n.action
    if (n.action) this.actBtn.setTitle(n.action.label).layout(0, 0, true)
    // keep both lines on one line inside the card (left of the action button when there is one)
    const maxW = W - 66 - (n.action ? ACT_W + 8 : 0)
    fitLabel(this.head, n.head, maxW, 10, 8)
    fitLabel(this.title, n.title, maxW, 13, 9)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, W, H, { alpha: 0.96, edge: n.accent, radius: 10 })
    this.icon.clear()
    if (n.icon) n.icon(this.icon, n.accent)
    else kindIcon(this.icon, n.kind, n.accent)
    this.view.visible = true
    this.view.alpha = 1
  }

  release(): void {
    this.notice = null
    this.view.visible = false
  }
}

export class NotificationStack {
  readonly view = new Container()
  private cards: Card[] = []
  private queue: Notice[] = []

  constructor() {
    for (let i = 0; i < MAX_VISIBLE; i++) {
      const c = new Card((card) => this.click(card))
      this.cards.push(c)
      this.view.addChild(c.view)
    }
  }

  push(n: Notice): void {
    // collapse a duplicate of a card already on screen / queued (e.g. two events, one fact)
    if (this.cards.some((c) => c.notice && c.notice.kind === n.kind && c.notice.title === n.title)) return
    if (this.queue.some((q) => q.kind === n.kind && q.title === n.title)) return
    this.queue.push(n)
  }

  /** Drop everything (new run / title screen). */
  clear(): void {
    this.queue.length = 0
    for (const c of this.cards) c.release()
  }

  /** `blocked` = a modal is open: hide the stack and hold every timer. */
  update(dt: number, blocked: boolean): void {
    this.view.visible = !blocked
    if (blocked) return
    // fill free slots from the queue (oldest first)
    for (const c of this.cards) {
      if (c.notice || !this.queue.length) continue
      c.bind(this.queue.shift()!)
    }
    // age / expire
    const reduced = prefersReducedMotion()
    for (const c of this.cards) {
      if (!c.notice) continue
      c.age += dt
      if (!c.hovered) c.life -= dt
      if (c.life <= 0) {
        c.release()
        continue
      }
      c.view.alpha = Math.min(1, c.life / 0.35)
    }
    // stack the live cards upward from the anchor, newest at the bottom
    const live = this.cards.filter((c) => c.notice).sort((a, b) => a.age - b.age)
    live.forEach((c, i) => {
      c.targetY = BOTTOM - H - i * (H + GAP)
      const x = RIGHT - W
      if (reduced || c.age >= SLIDE) {
        c.view.x = x
        c.view.y = c.targetY
      } else {
        // a 120 ms slide in from the right
        const f = c.age / SLIDE
        c.view.x = x + (1 - f) * 40
        c.view.y = c.targetY
      }
    })
  }

  private click(card: Card): void {
    const n = card.notice
    card.release()
    n?.onClick?.()
  }
}
