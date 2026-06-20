import type { GameState } from './core/types'
import { isBrownout, isThrottling } from './sim/power'
import { t } from './i18n'
import { BUILDBAR_H, DESIGN_H, DESIGN_W } from './config'
import { BUILD_ORDER } from './sim/content'
import type { Codex, CodexMessage, Rect } from './ui/codex'

// UI rectangles (design space) the tutorial points at — must match buildbar.ts
const BUILD_PAD_X = 12
const BUILD_GAP = 6
const BUILD_CONTROL_W = 184
const BUILD_CONTROL_X = DESIGN_W - BUILD_CONTROL_W - BUILD_PAD_X
const BUILD_TRAY_W = BUILD_CONTROL_X - BUILD_PAD_X - 16
const BUILD_CARD_W = Math.floor((BUILD_TRAY_W - BUILD_GAP * (BUILD_ORDER.length - 1)) / BUILD_ORDER.length)
const BUILD_CARD_Y = DESIGN_H - BUILDBAR_H + 10
const BUILD_CARD_H = 76
const BUILD_CONTROL_H = 34

function buildCardRect(id: string): Rect {
  const index = BUILD_ORDER.indexOf(id)
  if (index < 0) throw new Error(`Unknown build tutorial target: ${id}`)
  return {
    x: BUILD_PAD_X + index * (BUILD_CARD_W + BUILD_GAP),
    y: BUILD_CARD_Y,
    w: BUILD_CARD_W,
    h: BUILD_CARD_H,
  }
}

const HL: Record<string, Rect> = {
  general: buildCardRect('srv_edge'),
  safety: buildCardRect('guard_encoder'),
  power: buildCardRect('power'),
  cooling: buildCardRect('cooling'),
  lab: buildCardRect('lab'),
  start: { x: BUILD_CONTROL_X, y: BUILD_CARD_Y, w: BUILD_CONTROL_W, h: BUILD_CONTROL_H },
  meters: { x: 10, y: 20, w: 182, h: 64 },
}

function serverCount(s: GameState): number {
  return s.towers.reduce((n, t) => n + (t.def.kind === 'server' ? 1 : 0), 0)
}

interface Step {
  key: string
  msg: (s: GameState) => CodexMessage
  advance: (s: GameState, next: boolean) => boolean
  last?: boolean
}

interface Tip {
  key: string
  when: (s: GameState) => boolean
  msg: (s: GameState) => CodexMessage
}

const STEPS: Step[] = [
  {
    key: 'place',
    msg: () => ({
      text: t('tut.place'),
      highlight: HL.general,
    }),
    advance: (s) => serverCount(s) >= 1,
  },
  {
    key: 'spread',
    msg: () => ({
      text: t('tut.spread'),
      showNext: true,
    }),
    advance: (s, next) => serverCount(s) >= 3 || next,
  },
  {
    key: 'start',
    msg: () => ({
      text: t('tut.start'),
      highlight: HL.start,
    }),
    advance: (s) => s.phase === 'wave',
  },
  {
    key: 'serving',
    msg: () => ({
      text: t('tut.serving'),
      showNext: true,
      highlight: HL.meters,
    }),
    advance: (s, next) => next || (s.phase === 'build' && s.waveIndex >= 0),
  },
  {
    key: 'expand',
    msg: () => ({
      text: t('tut.expand'),
      showNext: true,
      highlight: HL.lab,
    }),
    advance: (_s, next) => next,
    last: true,
  },
]

const TIPS: Tip[] = [
  {
    key: 'brownout',
    when: (s) => s.phase === 'wave' && isBrownout(s),
    msg: () => ({
      text: t('tut.brownout'),
      showNext: true,
      highlight: HL.power,
    }),
  },
  {
    key: 'throttle',
    when: (s) => s.phase === 'wave' && isThrottling(s),
    msg: () => ({
      text: t('tut.throttle'),
      showNext: true,
      highlight: HL.cooling,
    }),
  },
  {
    key: 'jailbreak',
    when: (s) =>
      s.requests.some((r) => r.alive && r.def.id === 'jailbreak' && r.safetyRisk > 0 && !r.safetyCleared),
    msg: () => ({
      text: t('tut.jailbreak'),
      showNext: true,
      highlight: HL.safety,
    }),
  },
  {
    key: 'lowtrust',
    when: (s) => s.phase === 'wave' && s.meters.trust < 35,
    msg: () => ({
      text: t('tut.lowtrust'),
      showNext: true,
    }),
  },
]

interface Active {
  key: string
  advance: (s: GameState, next: boolean) => boolean
  onDone: () => void
}

export class Tutorial {
  private enabled: boolean
  private mainStep = 0
  private mainDone = false
  private shownTips = new Set<string>()
  private active: Active | null = null
  private nextFlag = false

  constructor(private codex: Codex) {
    let done = false
    try {
      done = typeof localStorage !== 'undefined' && localStorage.getItem('gptd_tut_done') === '1'
    } catch {
      /* ignore */
    }
    this.enabled = !done
  }

  requestNext(): void {
    this.nextFlag = true
  }

  skip(): void {
    this.disable()
  }

  private disable(): void {
    this.enabled = false
    this.active = null
    this.codex.hide()
    try {
      localStorage.setItem('gptd_tut_done', '1')
    } catch {
      /* ignore */
    }
  }

  /** Re-enable for a fresh run (called on restart if the player never finished). */
  reset(): void {
    this.mainStep = 0
    this.mainDone = false
    this.active = null
    this.shownTips.clear()
  }

  update(s: GameState): void {
    if (!this.enabled || s.phase === 'menu' || s.phase === 'won' || s.phase === 'lost') {
      this.codex.hide()
      this.active = null
      this.nextFlag = false
      return
    }
    const next = this.nextFlag
    this.nextFlag = false

    if (this.active) {
      if (this.active.advance(s, next)) {
        this.active.onDone()
        this.active = null
        if (this.mainDone && this.shownTips.size >= TIPS.length) {
          // nothing left to teach — retire the tutorial for this run
          this.codex.hide()
          return
        }
      } else {
        return // keep current message on screen
      }
    }

    // urgent contextual tips first
    const tip = TIPS.find((t) => !this.shownTips.has(t.key) && t.when(s))
    if (tip) {
      this.active = { key: tip.key, advance: (_s, n) => n, onDone: () => this.shownTips.add(tip.key) }
      this.codex.say(tip.msg(s))
      return
    }

    if (!this.mainDone) {
      const step = STEPS[this.mainStep]
      this.active = {
        key: step.key,
        advance: step.advance,
        onDone: () => {
          if (step.last) this.mainDone = true
          else this.mainStep++
        },
      }
      this.codex.say(step.msg(s))
      return
    }

    this.codex.hide()
  }
}
