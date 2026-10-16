/**
 * The cue catalog — every sound the audio engine can play, with its mixing
 * policy. Pure data (no Web Audio): the voice manager, the recipes, the dev
 * soundboard and the offline level check all key off this one table.
 *
 * The seven outcome cues reuse the ids of `OUTCOME_STYLE[*].cue` (src/outcomes.ts),
 * so a request outcome sounds the same wherever it is announced.
 */
import type { GuardrailArchetype, LoseMeter, RefusedBy } from '../core/types'
import type { OutcomeCue } from '../outcomes'

export const CUE_IDS = [
  // the seven request outcomes (OUTCOME_STYLE cue ids)
  'serve.clean',
  'serve.late',
  'serve.wrong',
  'serve.unsafe',
  'serve.refused',
  'serve.unservable',
  'serve.leak',
  // world saves
  'cache.hit',
  'guard.catch',
  'model.selfHandle',
  // player actions
  'build',
  'upgrade',
  'deploy',
  'sell',
  'research.start',
  // continuous-state cues
  'power.down',
  'power.up',
  'danger.heartbeat',
  'cash.tick',
  'streak.milestone',
  // stingers (sequenced, never stacked)
  'wave.start',
  'wave.boss',
  'wave.clear',
  'research.done',
  'checkpoint.minted',
  'incident.bad',
  'incident.good',
  'achievement',
  'win',
  'lose',
  // interface
  'ui.hover',
  'ui.click',
  'ui.toggle',
  'ui.tick',
  'ui.open',
  'ui.close',
  'ui.denied',
  'ui.speed',
  'ui.pause',
  'ui.resume',
  'ui.codex',
] as const

export type CueId = (typeof CUE_IDS)[number]

/** Every outcome cue id of the shared style table is a playable cue (compile-time). */
export function outcomeCue(cue: OutcomeCue): CueId {
  return cue
}

/** Output bus a cue is synthesized into (see mixer.ts). */
export type BusId = 'sfx' | 'alerts' | 'ui'

export type CueGroup = 'outcome' | 'world' | 'action' | 'state' | 'stinger' | 'ui'

/** Per-cue mixing policy (wall-clock, so density stays flat from 1× to 12×). */
export interface CueSpec {
  group: CueGroup
  bus: BusId
  /** minimum wall-clock gap between two starts of this cue (ms). */
  gapMs: number
  /** maximum overlapping voices of this cue. */
  maxVoices: number
  /** nominal voice length (s): when a started voice frees its slot. */
  lenS: number
  /**
   * 0 = routine texture … 5 = severe failure; 6 = player action / stinger / state
   * cue. Below 3 the per-frame and per-second routine budgets apply; failures
   * (3+) are never dropped — a rejected failure is deferred and coalesced.
   */
  priority: number
  /** ± random detune (cents) applied per voice. */
  jitterCents: number
  /** always centered (the Trust Core sits mid-board). */
  center?: boolean
  /** sequenced on the stinger channel instead of the voice pool. */
  stinger?: boolean
  /** duck the music under this cue: dip to `depth` (gain), recover after `dur` s. */
  duck?: { depth: number; dur: number }
}

const outcome = (
  gapMs: number,
  maxVoices: number,
  lenS: number,
  priority: number,
  jitterCents: number,
  bus: BusId = 'sfx',
): CueSpec => ({
  group: 'outcome',
  bus,
  gapMs,
  maxVoices,
  lenS,
  priority,
  jitterCents,
})
const stinger = (lenS: number, duck?: CueSpec['duck']): CueSpec => ({
  group: 'stinger',
  bus: 'alerts',
  gapMs: 0,
  maxVoices: 4,
  lenS,
  priority: 6,
  jitterCents: 0,
  stinger: true,
  duck,
})
const ui = (gapMs: number, lenS: number): CueSpec => ({
  group: 'ui',
  bus: 'ui',
  gapMs,
  maxVoices: 3,
  lenS,
  priority: 6,
  jitterCents: 0,
})

export const CUE_SPECS: Record<CueId, CueSpec> = {
  'serve.clean': outcome(90, 3, 0.16, 1, 0),
  'serve.late': outcome(110, 2, 0.32, 3, 15),
  'serve.wrong': { ...outcome(110, 2, 0.2, 3, 20), duck: { depth: 0.8, dur: 0.2 } },
  'serve.unsafe': { ...outcome(180, 2, 0.42, 5, 0, 'alerts'), duck: { depth: 0.5, dur: 0.35 } },
  'serve.refused': outcome(140, 2, 0.2, 3, 0),
  'serve.unservable': {
    ...outcome(160, 2, 0.42, 4, 0, 'alerts'),
    center: true,
    duck: { depth: 0.7, dur: 0.25 },
  },
  'serve.leak': { ...outcome(160, 2, 0.42, 4, 0, 'alerts'), center: true, duck: { depth: 0.7, dur: 0.25 } },

  'cache.hit': {
    group: 'world',
    bus: 'sfx',
    gapMs: 150,
    maxVoices: 2,
    lenS: 0.15,
    priority: 0,
    jitterCents: 30,
  },
  'guard.catch': {
    group: 'world',
    bus: 'sfx',
    gapMs: 90,
    maxVoices: 3,
    lenS: 0.1,
    priority: 2,
    jitterCents: 40,
  },
  'model.selfHandle': {
    group: 'world',
    bus: 'sfx',
    gapMs: 200,
    maxVoices: 1,
    lenS: 0.14,
    priority: 0,
    jitterCents: 20,
  },

  build: { group: 'action', bus: 'sfx', gapMs: 50, maxVoices: 3, lenS: 0.16, priority: 6, jitterCents: 10 },
  upgrade: { group: 'action', bus: 'sfx', gapMs: 80, maxVoices: 2, lenS: 0.5, priority: 6, jitterCents: 0 },
  deploy: { group: 'action', bus: 'sfx', gapMs: 70, maxVoices: 3, lenS: 0.8, priority: 6, jitterCents: 0 },
  sell: { group: 'action', bus: 'sfx', gapMs: 60, maxVoices: 2, lenS: 0.17, priority: 6, jitterCents: 10 },
  'research.start': {
    group: 'action',
    bus: 'sfx',
    gapMs: 120,
    maxVoices: 2,
    lenS: 0.3,
    priority: 6,
    jitterCents: 0,
  },

  'power.down': {
    group: 'state',
    bus: 'alerts',
    gapMs: 400,
    maxVoices: 1,
    lenS: 0.6,
    priority: 6,
    jitterCents: 0,
    center: true,
    duck: { depth: 0.6, dur: 0.5 },
  },
  'power.up': {
    group: 'state',
    bus: 'alerts',
    gapMs: 400,
    maxVoices: 1,
    lenS: 0.4,
    priority: 6,
    jitterCents: 0,
    center: true,
  },
  'danger.heartbeat': {
    group: 'state',
    bus: 'alerts',
    gapMs: 300,
    maxVoices: 2,
    lenS: 0.35,
    priority: 6,
    jitterCents: 0,
    center: true,
  },
  'cash.tick': {
    group: 'state',
    bus: 'alerts',
    gapMs: 150,
    maxVoices: 2,
    lenS: 0.02,
    priority: 6,
    jitterCents: 0,
    center: true,
  },
  'streak.milestone': {
    group: 'state',
    bus: 'ui',
    gapMs: 4000,
    maxVoices: 1,
    lenS: 0.4,
    priority: 6,
    jitterCents: 0,
    center: true,
  },

  'wave.start': stinger(0.55, { depth: 0.45, dur: 0.5 }),
  'wave.boss': stinger(0.9, { depth: 0.45, dur: 0.8 }),
  'wave.clear': stinger(0.65, { depth: 0.5, dur: 0.6 }),
  'research.done': stinger(0.7),
  'checkpoint.minted': stinger(0.8),
  'incident.bad': stinger(0.7, { depth: 0.5, dur: 0.8 }),
  'incident.good': stinger(0.45),
  achievement: stinger(0.75),
  win: stinger(1.6, { depth: 0.3, dur: 1.6 }),
  lose: stinger(1.6),

  'ui.hover': ui(40, 0.03),
  'ui.click': ui(25, 0.05),
  'ui.toggle': ui(25, 0.1),
  'ui.tick': ui(30, 0.03),
  'ui.open': ui(60, 0.15),
  'ui.close': ui(60, 0.15),
  'ui.denied': ui(80, 0.14),
  'ui.speed': ui(40, 0.06),
  'ui.pause': ui(80, 0.12),
  'ui.resume': ui(80, 0.12),
  'ui.codex': ui(1500, 0.08),
}

/** Free-form knobs a cue recipe reads (all optional; recipes pick sane defaults). */
export interface CueParams {
  /** board x (design px) — mapped to stereo pan by `boardPan`. */
  x?: number
  /** explicit pan −1..1 (overrides x). */
  pan?: number
  /** served chime: pentatonic degree (the clean-serve streak climbs it). */
  degree?: number
  /** served chime: coalesced serves behind this one (adds a fifth / an octave). */
  chord?: number
  /** coalesced failures behind this voice (louder thump for mass leaks). */
  count?: number
  /** 0..1 — deploy: model size (log params); upgrade: hardware tier. */
  size?: number
  /** upgrade: a liquid-cooled tier. */
  liquid?: boolean
  /** build: a server rack vs a support building. */
  rack?: boolean
  /** overRefused: who refused (model alignment vs a guardrail). */
  by?: RefusedBy
  /** guard catch: which guardrail family caught it. */
  archetype?: GuardrailArchetype
  /** research start: the post-training track (Studio) vs infra/eval research. */
  posttrain?: boolean
  /** lose: which meter ended the run. */
  meter?: LoseMeter
  /** wave clear: the wave's Goodput (0..100). */
  goodput?: number
  /** heartbeat: danger 0..1 (rate + level). */
  intensity?: number
  /** ui.toggle: new state. */
  on?: boolean
  /** ui.tick: slider value 0..1. */
  value?: number
  /** ui.speed: the new speed multiplier. */
  speed?: number
}

/** Board x (design px) → stereo pan. The board spans x 64..1216 around the core at ≈640. */
export function boardPan(x: number | undefined): number {
  if (x === undefined || !Number.isFinite(x)) return 0
  const p = (x - 640) / 576
  return (p < -1 ? -1 : p > 1 ? 1 : p) * 0.6
}

/** C-minor pentatonic (semitones) — the key the music is written in. */
export const PENTA = [0, 3, 5, 7, 10] as const
export const C5 = 523.25

/** Pentatonic degree (0 = C5, 5 = C6, −1 = Bb4 …) → Hz. */
export function pentaHz(degree: number, base = C5): number {
  const d = Math.round(degree)
  const oct = Math.floor(d / 5)
  return base * Math.pow(2, (PENTA[((d % 5) + 5) % 5] + 12 * oct) / 12)
}

/**
 * Clean-serve streak → chime degree: a rising pentatonic line that climbs a
 * step at streak 1/3/7/15/31/63… (log-spaced so long streaks keep climbing
 * slowly) and tops out at degree 9.
 */
export function streakDegree(streak: number): number {
  if (streak <= 0) return 0
  return Math.min(9, Math.floor(1.5 * Math.log2(1 + streak)))
}

/** Streak lengths that earn the soft milestone sparkle. */
export const STREAK_MILESTONES = [25, 50, 100, 250, 500, 1000] as const
