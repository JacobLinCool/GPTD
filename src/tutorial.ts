import type { GameState, WaveTypeStat } from './core/types'
import { isBrownout, isThrottling } from './sim/power'
import { reqName, t } from './i18n'
import { BUILDBAR_H, DESIGN_H, DESIGN_W, LAT_CLASS_SLO } from './config'
import { BUILD_ORDER, REQUEST_TYPES } from './sim/content'
import { redteamLevel } from './sim/safety'
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
  // the live outcome tally that replaces the HUD phase line during a wave
  tally: { x: 560, y: 40, w: 470, h: 22 },
  // CASH + the runway chip under it
  cash: { x: 200, y: 4, w: 120, h: 60 },
}

/** The first archetype this wave with a non-zero count in `key` (for naming it in a tip). */
function firstTypeWith(s: GameState, key: keyof WaveTypeStat): string | null {
  const by = s.waveStats?.byType
  if (!by) return null
  for (const id of Object.keys(by)) if ((by[id]?.[key] ?? 0) > 0) return id
  return null
}

const typeLabel = (id: string | null): string => {
  const d = id ? REQUEST_TYPES[id] : undefined
  return d ? reqName(d) : ''
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

/**
 * Contextual tips, most urgent first. Each fires once per viewer (remembered
 * across runs) the first time its moment happens — the first late answer, the
 * first wrong one, the first wrongful refusal, the first injection with no way
 * to catch it, the first wave whose bill beat its income.
 */
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
    key: 'injection',
    // an agent carrying prompt injection is on the board and no guard can catch injection yet
    when: (s) =>
      redteamLevel(s) === 0 && s.requests.some((r) => r.alive && (r.hazardsOpen.injection ?? 0) > 0),
    msg: () => ({
      text: t('tut.injection'),
      showNext: true,
      highlight: HL.lab,
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
    key: 'sloMiss',
    when: (s) => s.phase === 'wave' && (s.waveStats?.sloMiss ?? 0) > 0,
    msg: (s) => {
      const id = firstTypeWith(s, 'sloMiss')
      const def = id ? REQUEST_TYPES[id] : undefined
      const cls = def ? LAT_CLASS_SLO[def.latClass] : LAT_CLASS_SLO.IN
      const ttft = def?.ttftSloMs ?? cls.ttftMs
      // interactive lanes miss a first-token / per-token bound; agents miss their end-to-end budget
      const bounded = Number.isFinite(ttft) && Number.isFinite(cls.tpotMs)
      return {
        text: bounded
          ? t('tut.sloMiss', { type: typeLabel(id), ttft: Math.round(ttft), tpot: Math.round(cls.tpotMs) })
          : t('tut.sloMissE2e', { type: typeLabel(id) }),
        showNext: true,
        highlight: HL.tally,
      }
    },
  },
  {
    key: 'bad',
    when: (s) => s.phase === 'wave' && (s.waveStats?.bad ?? 0) > 0,
    msg: (s) => {
      const id = firstTypeWith(s, 'bad')
      const def = id ? REQUEST_TYPES[id] : undefined
      return {
        text: t('tut.bad', { type: typeLabel(id), axis: t('spec.' + (def?.primaryAxis ?? 'general')) }),
        showNext: true,
        highlight: HL.tally,
      }
    },
  },
  {
    key: 'overRefused',
    when: (s) => s.phase === 'wave' && (s.waveStats?.overRefused ?? 0) > 0,
    msg: () => ({
      text: t('tut.overRefused'),
      showNext: true,
      highlight: HL.tally,
    }),
  },
  {
    key: 'bills',
    // the wave just settled cost more to run than it earned
    when: (s) => {
      const r = s.lastReport
      return s.phase === 'build' && !!r && r.powerCost > r.cashIn + r.clearBonus + 0.5
    },
    msg: (s) => ({
      text: t('tut.bills', {
        bill: Math.round(s.lastReport?.powerCost ?? 0),
        income: Math.round((s.lastReport?.cashIn ?? 0) + (s.lastReport?.clearBonus ?? 0)),
      }),
      showNext: true,
      highlight: HL.cash,
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

/** Per-viewer tutorial memory: skipped (all Codex teaching off), guided steps finished, tips already shown. */
const KEY_SKIPPED = 'gptd_tut_done'
const KEY_MAIN = 'gptd_tut_main'
const KEY_TIPS = 'gptd_tut_tips'

function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* ignore (private mode / quota) */
  }
}

function readTips(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY_TIPS) : null
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export class Tutorial {
  /** false once the player skipped: no guided steps and no tips. */
  private enabled: boolean
  private mainStep = 0
  private mainDone: boolean
  private shownTips: Set<string>
  private active: Active | null = null
  private nextFlag = false

  constructor(private codex: Codex) {
    this.enabled = !readFlag(KEY_SKIPPED)
    this.mainDone = readFlag(KEY_MAIN)
    this.shownTips = readTips()
  }

  requestNext(): void {
    this.nextFlag = true
  }

  /** True once the guided steps are finished or skipped (gates mid-run mode switching). */
  get finished(): boolean {
    return !this.enabled || this.mainDone
  }

  /** The guided steps are still running (auto-start waits for them). */
  get guiding(): boolean {
    return this.enabled && !this.mainDone
  }

  skip(): void {
    this.disable()
  }

  /** Settings ▸ Gameplay — re-arm the tutorial (steps and tips) from scratch. */
  replay(): void {
    this.enabled = true
    this.mainDone = false
    this.shownTips = new Set()
    this.reset()
    writeKey(KEY_SKIPPED, null)
    writeKey(KEY_MAIN, null)
    writeKey(KEY_TIPS, null)
  }

  private disable(): void {
    this.enabled = false
    this.active = null
    this.codex.hide()
    writeKey(KEY_SKIPPED, '1')
  }

  /** A fresh run: drop whatever was on screen; unfinished guided steps restart from the top. */
  reset(): void {
    if (!this.mainDone) this.mainStep = 0
    this.active = null
  }

  private markTip(key: string): void {
    this.shownTips.add(key)
    writeKey(KEY_TIPS, JSON.stringify([...this.shownTips]))
  }

  private finishMain(): void {
    this.mainDone = true
    writeKey(KEY_MAIN, '1')
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
        if (this.mainDone && TIPS.every((tp) => this.shownTips.has(tp.key))) {
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
      this.active = { key: tip.key, advance: (_s, n) => n, onDone: () => this.markTip(tip.key) }
      this.codex.say(tip.msg(s))
      return
    }

    if (!this.mainDone) {
      const step = STEPS[this.mainStep]
      this.active = {
        key: step.key,
        advance: step.advance,
        onDone: () => {
          if (step.last) this.finishMain()
          else this.mainStep++
        },
      }
      this.codex.say(step.msg(s))
      return
    }

    this.codex.hide()
  }
}
