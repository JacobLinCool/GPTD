import type { GameState } from './core/types'
import { isBrownout, isThrottling } from './sim/power'
import type { Codex, CodexMessage, Rect } from './ui/codex'

// UI rectangles (design space) the tutorial points at — must match hud.ts / buildbar.ts layout.
const HL: Record<string, Rect> = {
  general: { x: 118, y: 634, w: 100, h: 76 },
  safety: { x: 648, y: 634, w: 100, h: 76 },
  power: { x: 754, y: 634, w: 100, h: 76 },
  cooling: { x: 860, y: 634, w: 100, h: 76 },
  lab: { x: 966, y: 634, w: 100, h: 76 },
  start: { x: 1072, y: 634, w: 196, h: 34 },
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
      text: "I'm Codex, your on-call SRE. Those packets are user requests flooding in. Tap the blue General Server button, then a tile right beside the glowing lane to deploy it.",
      highlight: HL.general,
    }),
    advance: (s) => serverCount(s) >= 1,
  },
  {
    key: 'spread',
    msg: () => ({
      text: 'Nice deploy. A server processes any request inside its range. Spread two or three along the lane so nothing slips past to the Trust Core.',
      showNext: true,
    }),
    advance: (s, next) => serverCount(s) >= 3 || next,
  },
  {
    key: 'start',
    msg: () => ({
      text: 'Locked and loaded. Hit START WAVE — or just press Space — to open the doors to live traffic.',
      highlight: HL.start,
    }),
    advance: (s) => s.phase === 'wave',
  },
  {
    key: 'serving',
    msg: () => ({
      text: 'Each packet shows Work remaining above it. Drain it to zero and you serve the user for Cash and Data. Let one reach the core and your Trust and SLA take the hit — watch the bars up top.',
      showNext: true,
      highlight: HL.meters,
    }),
    advance: (s, next) => next || (s.phase === 'build' && s.waveIndex >= 0),
  },
  {
    key: 'expand',
    msg: () => ({
      text: "That's the whole loop: serve → earn → build → survive a bigger wave. Build more servers, raise Power/Cooling when those bars fill, and drop a Training Lab to unlock upgrades between waves. I'll shout if something needs you. Good luck!",
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
      text: 'Heads up — your GPUs just browned out (that ⚡ warning). Power demand beat capacity, so racks went dark. Build a Power Plant to bring them back.',
      showNext: true,
      highlight: HL.power,
    }),
  },
  {
    key: 'throttle',
    when: (s) => s.phase === 'wave' && isThrottling(s),
    msg: () => ({
      text: 'Your racks are thermal-throttling (❄) — you are over heat capacity, so every GPU serves slower. Add a Cooling Tower to clear it.',
      showNext: true,
      highlight: HL.cooling,
    }),
  },
  {
    key: 'jailbreak',
    when: (s) =>
      s.requests.some((r) => r.alive && r.def.id === 'jail' && r.safetyRisk > 0 && !r.safetyCleared),
    msg: () => ({
      text: 'See the red “!” packets? Those are Jailbreaks. Route them through a Safety Gate before the core, or an unsafe answer wrecks Trust.',
      showNext: true,
      highlight: HL.safety,
    }),
  },
  {
    key: 'lowtrust',
    when: (s) => s.phase === 'wave' && s.meters.trust < 35,
    msg: () => ({
      text: 'Trust is critical! If Trust, SLA, or Cash hits zero, the run ends. Tighten coverage, add a Cache for repeat traffic, or sell and relocate.',
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
