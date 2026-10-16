/* ------------------------------------------------------------------ *
 *  LOAD FORECAST — how a rack would serve the coming wave's MIXED       *
 *  load. Pure and read-only (no RNG, never mutates state): the deploy   *
 *  picker's ★, the per-archetype fit rows, the next-wave readiness card *
 *  and the demo autoplay all read this one estimate, so the pick a      *
 *  player is shown is the one the autoplay plays by.                    *
 *                                                                      *
 *  It runs the serving math combat runs (effects.ts) at the moments a   *
 *  request of each archetype arrives — the wave's bursts in flight then *
 *  (Little's law), spread over the fleet's lanes — and averages over    *
 *  its arrivals:                                                        *
 *    · its lane's decode step: its own cohort among the others there,   *
 *      their KV re-read every step, their other prompts ingested in the *
 *      background — so an interactive answer sees the step the RAG and  *
 *      summarization cohorts sharing its lane impose;                   *
 *    · the prompt lane: each prompt run exclusively (the decodes stall  *
 *      for it) or chunked into the deployment's token budget, waiting   *
 *      behind the work ahead of it (Pollaczek–Khinchine) on the racks    *
 *      that admit it, and the TPOT the decodes pay for the prompt work; *
 *    · the slots: a request the entry racks of its lane cannot take     *
 *      (engine slots, KV) walks on with its TTFT clock running          *
 *      (Erlang C);                                                       *
 *    · TTFT = prompt + queue + admission wait + the lane's input guard   *
 *      checks; time to first answer adds the hidden reasoning; E2E the  *
 *      whole answer (a KV-limited cohort's sprite waits for its streams)*
 *      and the output checks; the on-time share counts the arrivals     *
 *      that break a bound;                                               *
 *    · the judged-axis margin in the mode the model answers it in,      *
 *      after the long-context penalty; the window and KV gates.         *
 * ------------------------------------------------------------------ */

import { COHORT_STREAMS, LAT_CLASS_SLO, SIM_TIME_SCALE, TILE } from '../config'
import type {
  AnswerMode,
  GameState,
  GuardrailSpec,
  ModelDef,
  RequestTypeDef,
  SafetyHazard,
  SafetyProfile,
  SloCause,
  Tower,
  WaveDef,
} from '../core/types'
import { REQUEST_TYPES, WAVES } from './content'
import {
  admissionDelaySec,
  answerMode,
  cacheChance,
  chunkBudgetTokens,
  cohortFit,
  cohortKvGb,
  cohortPrefillSec,
  guardCheckMs,
  guardScreenTokens,
  hiddenTokensFor,
  kvPerReqGb,
  type LaneLoad,
  laneStep,
  type LaneStep,
  type Loadout,
  loadoutOf,
  longContextPenalty,
  type ParallelPlan,
  prefillRateOn,
  prefixHitChance,
  promptOccupancy,
  rackPlan,
  serverCtxWindowTokens,
  serverQualityVs,
  specTokensFor,
  spritesPerLane,
  towerRangeTiles,
} from './effects'
import { laneGuardStages } from './guards'
import { LANE_PATHS, posAt } from './pathing'
import { groupsDurationSec, previewNextWave } from './preview'
import { requisitionPick } from './research'
import {
  categoryUnlocked,
  effRecall,
  modelOverRefusal,
  NOVEL_RECALL_MUL,
  overRefuse,
  overrefMul,
  pSelfHandle,
  redteamRecallBonus,
} from './safety'
import { escalatedHazards, surgeLaneOf } from './spawn'

/** The share of the fleet's lanes a single-entry surge's traffic reaches. */
export const SURGE_SHARE = 0.5
/** Sampling step along a lane's path when finding the racks a request meets first (px). */
const ENTRY_STEP_PX = 6
/** How far past its first contact a request still counts as meeting the fleet's entry racks (tiles). */
const ENTRY_SPAN_TILES = 1
/** The busiest share of a lane's time the prompt queue is allowed to take in the estimate (the wait stays finite). */
const MAX_PROMPT_UTIL = 0.95
/** The share of a bound's use below which an answer counts as reliably on time (requests spread around the estimate). */
export const ON_TIME_USE = 0.85
/** The bound's use at and past which almost every answer is late. */
export const LATE_USE = 1.3

/** The expected share of answers on time at a bound use (all at ≤ ON_TIME_USE, none at ≥ LATE_USE). */
export function onTimeShare(use: number): number {
  return use <= ON_TIME_USE ? 1 : use >= LATE_USE ? 0 : (LATE_USE - use) / (LATE_USE - ON_TIME_USE)
}

/** One burst of a demand line: `count` sprites spawned from `start` to `end` (board seconds), `rate` per REAL second. */
export interface Burst {
  start: number
  end: number
  rate: number
  count: number
}

/** One archetype of the coming load, resolved the way spawnRequest spawns it. */
export interface DemandLine {
  def: RequestTypeDef
  /** requests of this archetype the wave spawns (after the incident's volume modifier). */
  count: number
  inputTokens: number
  outputTokens: number
  /** the quality line on the judged axis. */
  difficulty: number
  /** hazards it carries after the era's pressure (severity per hazard). */
  hazards?: SafetyProfile
  /** share of its attacks that are novel variants (classifier guards mostly miss them). */
  novelShare?: number
  /** when its requests arrive (default: spread evenly over the wave). */
  bursts?: Burst[]
}

/** The guard families on a lane: the towers' specs that check the prompt and the answer. */
export interface GuardFamily {
  input: GuardrailSpec[]
  output: GuardrailSpec[]
}

/** Where the wave lands: how many decode lanes it spreads over, for how long, past which guards and caches. */
export interface LoadEnv {
  /** decode lanes the wave's traffic spreads over (a single-entry surge: the share on its lane). */
  fleetLanes: number
  /** board seconds the wave lasts. */
  waveSec: number
  /** the guard families of the lane whose checks cost the most (each request is screened once per family). */
  guards: GuardFamily[]
  /** the prefix-cache hit chance a cacheable prompt can count on. */
  cacheHit: number
  /** the fewest request cohorts per decode lane to assume (1 = the forecast load; the readouts assume a busy rack). */
  minSprites?: number
  /**
   * The decode lanes of the racks a request meets at its first contact with the fleet, on the lanes
   * in play (averaged): a request is admitted by the first rack in reach with a free slot, so when
   * those are full it walks on toward the core — its TTFT clock already running.
   */
  entryLanes?: number
  /** the ingress lanes the wave's traffic arrives on (1 for a single-entry surge). */
  pathsInPlay?: number
}

/** One demand line as a rack would serve it under the mixed load. */
export interface LoadFit {
  /** the mode the rack's model answers it in. */
  mode: AnswerMode
  /** hidden reasoning tokens it spends first (0 in instant mode). */
  hidden: number
  /** real seconds: time to first token, to first answer token, per output token, end to end. */
  ttftSec: number
  ttfatSec: number
  tpotSec: number
  e2elSec: number
  /** the tightest bound's use: latency ÷ bound (≤ 1 on time). */
  lat: number
  /** the first bound it would miss (null = on time), in combat's order. */
  slowBy: SloCause | null
  /** effective quality on the judged axis (mode vector − format / alignment taxes − long-context penalty). */
  effQ: number
  /** effQ − difficulty (≥ 0 = a correct answer). */
  margin: number
  /** prompt + hidden reasoning + answer fit the window and one model copy's KV. */
  window: boolean
  /** real streams one lane carries at this load, and per-user decode tok/s. */
  streams: number
  perUserTokS: number
  /** the share of its requests that find every slot in reach busy at the wave's peak, and how long they wait (s). */
  queued: number
  waitSec: number
  /** the expected share of its requests answered within every bound (the estimate's spread and the slot wait). */
  onTime: number
}

const NO_FIT: LoadFit = {
  mode: 'instant',
  hidden: 0,
  ttftSec: Infinity,
  ttfatSec: Infinity,
  tpotSec: Infinity,
  e2elSec: Infinity,
  lat: Infinity,
  slowBy: 'ttft',
  effQ: 0,
  margin: -Infinity,
  window: false,
  streams: 0,
  perUserTokS: 0,
  queued: 1,
  waitSec: Infinity,
  onTime: 0,
}

/* ------------------------------------------------------------------ *
 *  The coming load                                                    *
 * ------------------------------------------------------------------ */

/** The demand lines of a wave's bursts, merged per archetype (the incident's volume folded in). */
export function demandOfGroups(s: GameState, groups: WaveDef['groups']): DemandLine[] {
  const byId = new Map<string, DemandLine>()
  for (const g of groups) {
    const def = REQUEST_TYPES[g.typeId]
    if (!def) continue
    const work = g.workMul ?? 1
    const count = Math.max(1, Math.round(g.count * s.modifiers.volume))
    const hazards = escalatedHazards(g.hazards ?? def.hazards ?? {}, g.hazardMul ?? 1)
    const interval = Math.max(0.05, g.interval)
    const burst: Burst = {
      start: g.delay,
      end: g.delay + Math.max(0, count - 1) * interval,
      rate: 1 / (interval * SIM_TIME_SCALE),
      count,
    }
    const line: DemandLine = {
      def,
      count,
      bursts: [burst],
      inputTokens: Math.max(
        1,
        Math.round(def.inputTokens * (g.contextMul ?? 1) * Math.max(1, Math.sqrt(work))),
      ),
      outputTokens: Math.max(def.outputTokens > 0 ? 1 : 0, Math.round(def.outputTokens * work)),
      difficulty: (def.difficulty[def.primaryAxis] ?? 0) * (g.complexityMul ?? 1),
      hazards,
      novelShare: Object.keys(hazards).length ? (g.novelShare ?? 0) : 0,
    }
    const prev = byId.get(def.id)
    if (!prev) {
      byId.set(def.id, line)
      continue
    }
    // the hardest instance of an archetype stands for all of them
    prev.count += line.count
    prev.bursts!.push(burst)
    prev.inputTokens = Math.max(prev.inputTokens, line.inputTokens)
    prev.outputTokens = Math.max(prev.outputTokens, line.outputTokens)
    prev.difficulty = Math.max(prev.difficulty, line.difficulty)
    prev.novelShare = Math.max(prev.novelShare ?? 0, line.novelShare ?? 0)
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.def.id.localeCompare(b.def.id))
}

/** The load the player is preparing for, and how long it lasts / whether it funnels into one lane. */
export interface ComingLoad {
  demand: DemandLine[]
  /** board seconds it lasts. */
  seconds: number
  /** a single-entry surge: every request walks one lane. */
  surge: boolean
  /** the wave being served (wave phase) rather than the next one. */
  live: boolean
}

/**
 * The coming load: the wave being served (wave phase), else the next authored wave (the next-wave
 * preview's mix, its incident's volume folded in). Past the campaign an endless surge is rolled only
 * when it starts, so the last wave served stands in for it.
 */
export function comingLoad(s: GameState): ComingLoad | null {
  if (s.phase === 'wave' && s.currentWave) {
    const groups = s.currentWave.groups
    return {
      demand: demandOfGroups(s, groups),
      seconds: Math.max(20, groupsDurationSec(s, groups)),
      surge: surgeLaneOf(groups, s.laneWindow) !== undefined,
      live: true,
    }
  }
  const p = previewNextWave(s)
  if (p?.def) {
    return {
      demand: demandOfGroups(s, p.def.groups),
      seconds: Math.max(20, p.estDurationSec),
      surge: p.surgeLane !== null,
      live: false,
    }
  }
  if (!p && !s.endless) return null
  const groups = s.currentWave?.groups ?? WAVES[WAVES.length - 1].groups
  return {
    demand: demandOfGroups(s, groups),
    seconds: Math.max(20, groupsDurationSec(s, groups)),
    surge: p?.surgeLane !== null && p?.surgeLane !== undefined,
    live: false,
  }
}

/* ------------------------------------------------------------------ *
 *  Where it lands                                                      *
 * ------------------------------------------------------------------ */

/** The prefix-cache hit chance a cacheable prompt can count on (the best cache; met late in a walk: half). */
export function expectedCacheHit(s: GameState): number {
  let best = 0
  for (const t of s.towers)
    if (t.def.kind === 'cache' && t.online) best = Math.max(best, cacheChance(s, t.def))
  return best > 0 ? prefixHitChance(s, best, false) * 0.5 : 0
}

/** The guard families of the lane whose checks cost the most at the reference prompt. */
export function worstLaneGuards(s: GameState): GuardFamily[] {
  let worst: GuardFamily[] = []
  let worstSec = -1
  for (const stages of laneGuardStages(s)) {
    const sec = stages.reduce((n, st) => n + st.inSec + st.outSec, 0)
    if (sec <= worstSec) continue
    worstSec = sec
    worst = stages.map((st) => ({
      input: st.input.map((t) => t.def.guardrail!),
      output: st.output.map((t) => t.def.guardrail!),
    }))
  }
  return worst
}

/**
 * Decode lanes across the fleet's serving racks (each rack at least one) — without the racks a
 * running research or post-training project will requisition while the wave runs.
 */
export function fleetLanesOf(s: GameState): number {
  let n = 0
  for (const t of servingRacks(s)) n += Math.max(1, rackPlan(s, loadoutOf(s, t)).lanes)
  return Math.max(1, n)
}

/** The serving racks a running research or post-training project leaves on the board. */
function servingRacks(s: GameState): Tower[] {
  const lent =
    s.research.infra || s.research.posttrain || s.research.eval ? new Set(requisitionPick(s)) : null
  return s.towers.filter((t) => t.def.kind === 'server' && !t.training && !lent?.has(t) && !!t.modelId)
}

/**
 * The decode lanes of the racks a request on `laneId` meets first — every serving rack whose range
 * covers the lane's path within ENTRY_SPAN_TILES of the first point any rack reaches (0 when no rack
 * covers the lane): a request those racks cannot take walks on, its TTFT clock running.
 */
export function entryLanesOf(s: GameState, laneId: number, racks: Tower[] = servingRacks(s)): number {
  const lane = LANE_PATHS[laneId]
  if (!lane || !racks.length) return 0
  const reach = racks.map((t) => ({ t, r2: (towerRangeTiles(t) * TILE) ** 2 }))
  const met = new Set<Tower>()
  let first = -1
  for (let d = 0; d <= lane.length; d += ENTRY_STEP_PX) {
    if (first >= 0 && d > first + ENTRY_SPAN_TILES * TILE) break
    const at = posAt(d, laneId)
    for (const { t, r2 } of reach) {
      const dx = t.x - at.x
      const dy = t.y - at.y
      if (dx * dx + dy * dy <= r2) {
        met.add(t)
        if (first < 0) first = d
      }
    }
  }
  let lanes = 0
  for (const t of met) lanes += Math.max(1, rackPlan(s, loadoutOf(s, t)).lanes)
  return lanes
}

/** The environment the coming load lands in: the fleet's lanes (a surge's share), its length, the guards and caches. */
export function loadEnvOf(s: GameState, load: Pick<ComingLoad, 'seconds' | 'surge'>): LoadEnv {
  const lanes = fleetLanesOf(s)
  const racks = servingRacks(s)
  const p = previewNextWave(s)
  const inPlay =
    load.surge && p?.surgeLane != null
      ? [p.surgeLane]
      : p?.lanes?.length
        ? p.lanes
        : LANE_PATHS.map((l) => l.id)
  const entry = inPlay.map((l) => entryLanesOf(s, l, racks)).filter((n) => n > 0)
  return {
    fleetLanes: Math.max(1, load.surge ? lanes * SURGE_SHARE : lanes),
    waveSec: load.seconds,
    guards: worstLaneGuards(s),
    cacheHit: expectedCacheHit(s),
    entryLanes: entry.length ? entry.reduce((n, v) => n + v, 0) / entry.length : undefined,
    pathsInPlay: load.surge ? 1 : inPlay.length,
  }
}

/**
 * The chance one hazard of a request is DELIVERED: it gets past every family's input check (the
 * best covering recall at the threshold, the red-team calibration, a novel variant's lower recall),
 * past the model's own alignment at its first token, and past every family's output check — the
 * screening guards.ts and combat run, in expectation.
 */
export function hazardLeakChance(
  s: GameState,
  m: ModelDef,
  guards: GuardFamily[],
  hazard: SafetyHazard,
  severity: number,
  novelShare: number,
): number {
  let miss = 1 - pSelfHandle(m, hazard, severity)
  if (!categoryUnlocked(s, hazard)) return miss
  const bonus = redteamRecallBonus(s)
  const side = (specs: GuardrailSpec[]): number => {
    let r = 0
    for (const g of specs) {
      if (!g.catches.includes(hazard)) continue
      const novel = 1 - novelShare + novelShare * NOVEL_RECALL_MUL[g.archetype]
      r = Math.max(r, effRecall(g.baseRecall, s.guardrailThreshold, bonus) * novel)
    }
    return r
  }
  for (const f of guards) miss *= (1 - side(f.input)) * (1 - side(f.output))
  return miss
}

/**
 * The chance a BENIGN request is wrongly refused: by the model's own alignment at its first token
 * (its borderline-refusal rate × the archetype's exposure; an embedding generates nothing to
 * refuse) or by a false positive of any guard family on its lane (one roll per family). Attacks
 * and hazard-carrying traffic are never "over"-refused.
 */
export function refusalChance(s: GameState, m: ModelDef, d: DemandLine, guards: GuardFamily[]): number {
  if (d.def.adversarial || Object.keys(d.hazards ?? {}).length) return 0
  let keep = d.outputTokens > 0 ? 1 - modelOverRefusal(m, d.def) : 1
  for (const f of guards) {
    const spec = f.input[0] ?? (d.outputTokens > 0 ? f.output[0] : undefined)
    if (spec)
      keep *= 1 - overRefuse(spec.archetype, s.guardrailThreshold, overrefMul(s)) * d.def.refusalExposure
  }
  return 1 - keep
}

/** Real seconds the guard families take to check one turn on one side (each family once, its slowest tower). */
export function guardSecFor(
  s: GameState,
  guards: GuardFamily[],
  side: 'input' | 'output',
  d: DemandLine,
): number {
  if (side === 'output' && d.outputTokens <= 0) return 0 // an embedding generates no text to check
  const tokens = guardScreenTokens(side, d.inputTokens, d.outputTokens)
  let sec = 0
  for (const f of guards) {
    let ms = 0
    for (const spec of side === 'input' ? f.input : f.output) ms = Math.max(ms, guardCheckMs(s, spec, tokens))
    sec += ms / 1000
  }
  return sec
}

/* ------------------------------------------------------------------ *
 *  How the rack serves it                                              *
 * ------------------------------------------------------------------ */

/** One demand line as a given checkpoint on a given rack serves it. */
interface Line {
  d: DemandLine
  hidden: number
  generated: number
  /** the mean sequence while it decodes. */
  ctx: number
  /** prompt tokens to ingest per sprite (cache hits skip the shared prefix; an embedding's cohort ingests every stream's). */
  prompt: number
  /** monolithic prefill rate of one of its prompts (tok/s). */
  rate: number
  /** prompt tokens its cohort's streams can expect to share through the prefix cache (stored and prefilled once). */
  shared: number
}

/**
 * The decode step of one lane carrying `sprites[i]` request cohorts of each line (fractional: the
 * expected mix): every cohort's streams (as many as the lane's KV holds per cohort), their KV
 * re-read each step, their other prompts ingested in the background.
 */
function laneMix(
  s: GameState,
  lo: Loadout,
  p: ParallelPlan,
  lines: Line[],
  sprites: number[],
): { load: LaneLoad; step: LaneStep; k: number[] } {
  const m = lo.model!
  const total = sprites.reduce((n, v) => n + v, 0)
  const budget = p.kvGbPerReplica / Math.max(1, total)
  let streams = 0
  let kvGb = 0
  let bg = 0
  let spec = 0
  const k = lines.map((x, i) => {
    const kk = Math.max(1, cohortFit(s, m, x.ctx, budget, x.shared))
    const n = sprites[i]
    if (n <= 0 || x.generated <= 0) return kk
    streams += n * kk
    kvGb += n * cohortKvGb(s, m, x.ctx, kk, x.shared)
    bg += n * cohortPrefillSec(s, lo, p, kk, x.d.inputTokens, x.shared, x.generated)
    spec += n * kk * specTokensFor(s, x.d.def.primaryAxis)
    return kk
  })
  const load: LaneLoad = {
    streams: Math.max(1, streams),
    kvGb,
    bgPrefillSec: bg,
    overlapPrefill: s.infra.scheduling.chunked,
    rackStreams: Math.max(1, streams) * Math.max(1, p.lanes),
    specTokens: streams > 0 ? spec / streams : 1,
  }
  return { load, step: laneStep(s, lo, p, load), k }
}

/**
 * Erlang C: the chance an arrival finds all `c` servers busy at an offered load of `a` Erlangs
 * (busy servers on average) — 1 once the load reaches the servers.
 */
function erlangC(c: number, a: number): number {
  const n = Math.max(1, Math.round(c))
  if (a <= 0) return 0
  if (a >= n) return 1
  let b = 1
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b)
  return (n * b) / (n - a * (1 - b))
}

/**
 * Would this rack serve each demand line cleanly under the coming wave's mixed load? See the
 * module header for the terms. Lines are aligned with `demand`.
 */
export function loadFits(s: GameState, lo: Loadout, demand: DemandLine[], env: LoadEnv): LoadFit[] {
  const m = lo.model
  const p = rackPlan(s, lo)
  if (!m || !p.fits) return demand.map(() => ({ ...NO_FIT }))
  const lanes = Math.max(1, env.fleetLanes)
  const realSec = Math.max(1, env.waveSec * SIM_TIME_SCALE)
  const lines: Line[] = demand.map((d) => {
    const hidden = d.outputTokens > 0 ? hiddenTokensFor(m, d.def) : 0
    const generated = d.outputTokens + hidden
    const cached = d.def.cacheable ? d.def.prefixShare * env.cacheHit : 0
    return {
      d,
      hidden,
      generated,
      ctx: d.inputTokens + generated / 2,
      prompt: d.inputTokens * (1 - cached),
      rate: prefillRateOn(s, lo, p, d.inputTokens),
      shared: d.inputTokens * cached,
    }
  })
  const chunked = s.infra.scheduling.chunked
  const budget = chunked ? chunkBudgetTokens(s, lo, p) : 0
  const sum = (v: number[]): number => v.reduce((n, x) => n + x, 0)
  // the cohorts one lane admits: the engine's slots, and only as many as its KV holds one stream
  // of (admission reserves at least one stream's sequence per cohort)
  const decodeW = lines.map((x) => x.d.count * Math.max(1, x.generated))
  const kvOne = sum(lines.map((x, i) => decodeW[i] * kvPerReqGb(s, m, x.ctx))) / Math.max(1e-9, sum(decodeW))
  const kvLane = p.kvGbPerReplica / Math.max(1, p.stages)
  // each admitted cohort takes as many streams as fit (COHORT_STREAMS at most): the KV holds about
  // kvLane / (COHORT_STREAMS × one stream) full cohorts, the last one partial
  const slots = Math.max(
    1,
    Math.min(spritesPerLane(s), kvOne > 0 ? Math.ceil(kvLane / (COHORT_STREAMS * kvOne)) : Infinity),
  )
  // the slots a request can take at its first contact (the entry racks of its lane), and the
  // ingress lanes the wave's requests split over
  const entry = slots * Math.max(1, env.entryLanes ?? lanes)
  const paths = Math.max(1, env.pathsInPlay ?? 1)
  // a sprite's prompt work: an embedding's cohort is all prompt (every stream's is ingested)
  const promptTokens = (x: Line, k: number): number => x.prompt * (x.generated <= 0 ? k : 1)
  // a KV-limited cohort's sprite waits for its streams (combat: wall = sec × COHORT_STREAMS / k)
  const kvWaitOf = (k: number): number => COHORT_STREAMS / Math.max(1, Math.min(COHORT_STREAMS, k))
  const burstsOf = (x: Line): Burst[] =>
    x.d.bursts?.length
      ? x.d.bursts
      : [{ start: 0, end: env.waveSec, rate: x.d.count / realSec, count: x.d.count }]
  const active = (b: Burst, when: number, tail: number): boolean =>
    when >= b.start - 1e-9 && when <= b.end + tail
  /** Per line j, Σ f(j, b) over j's bursts in flight at `when` (arriving, or served `tail(j)` board s after). */
  const inFlight = (
    when: number,
    f: (j: number, b: Burst) => number,
    tail: (j: number) => number,
  ): number[] =>
    lines.map((x, j) => burstsOf(x).reduce((n, b) => n + (active(b, when, tail(j)) ? f(j, b) : 0), 0))
  /**
   * The pieces of line i's arrival windows over which the traffic in flight stays the same: their
   * midpoint and the arrivals of line i in them (the weights of every per-request average).
   */
  const piecesOf = (i: number, tail: (j: number) => number): { at: number; w: number }[] => {
    const out: { at: number; w: number }[] = []
    for (const w of burstsOf(lines[i])) {
      if (w.end - w.start <= 1e-9) {
        out.push({ at: w.start, w: w.count })
        continue
      }
      const cuts = [w.start, w.end]
      lines.forEach((x, j) => {
        for (const b of burstsOf(x))
          for (const c of [b.start, b.end + tail(j)]) if (c > w.start && c < w.end) cuts.push(c)
      })
      cuts.sort((a, b) => a - b)
      for (let q = 0; q + 1 < cuts.length; q++) {
        const len = cuts[q + 1] - cuts[q]
        if (len > 1e-9) out.push({ at: (cuts[q] + cuts[q + 1]) / 2, w: len * w.rate * SIM_TIME_SCALE })
      }
    }
    return out
  }
  const meanOver = (pieces: { at: number; w: number }[], f: (at: number) => number[]): number[] => {
    const acc = lines.map(() => 0)
    let wSum = 0
    for (const pc of pieces) {
      f(pc.at).forEach((v, j) => (acc[j] += v * pc.w))
      wSum += pc.w
    }
    return wSum > 0 ? acc.map((v) => v / wSum) : acc
  }
  /** A line's lane: its own cohort beside `conc` (sprites per lane in flight), capped by the engine's slots. */
  const laneOf = (i: number, conc: number[]): { load: LaneLoad; step: LaneStep; k: number[] } => {
    const there = sum(conc)
    const others = Math.min(slots - 1, Math.max((env.minSprites ?? 1) - 1, there))
    const scale = there > 0 ? others / there : 0
    const sprites = conc.map((c, j) => c * scale + (j === i ? 1 : 0))
    if (there <= 0 && others > 0) sprites.forEach((_, j) => (sprites[j] += (others * weights[j]) / wSum))
    return laneMix(s, lo, p, lines, sprites)
  }
  const none = (): number => 0

  // 1. a sprite's rack occupancy alone on a lane (its prompt and its answer, real s)
  const weights = lines.map((x) => x.d.count * Math.max(1, x.generated))
  const wSum = sum(weights) || 1
  const light = laneMix(
    s,
    lo,
    p,
    lines,
    weights.map((w) => w / wSum),
  )
  const occ0 = lines.map((x, i) =>
    promptOccupancy(s, lo, p, promptTokens(x, light.k[i]), x.rate, light.load, budget),
  )
  const S0 = lines.map((x, i) => occ0[i].wallSec + x.generated * light.step.stepSec * kvWaitOf(light.k[i]))
  const tail0 = (j: number): number => S0[j] / SIM_TIME_SCALE
  const conc0 = (at: number): number[] =>
    inFlight(at, (j, b) => Math.min(b.rate * S0[j], b.count) / lanes, tail0)
  const pieces = lines.map((_, i) => piecesOf(i, tail0))

  // 2. each line's lane as its requests arrive, on average (Little's law over the bursts in flight,
  //    spread over the fleet's lanes; Poisson arrivals find them already there): the prompt service
  //    times and the answer's occupancy at that load
  const avg = lines.map((_, i) => laneOf(i, meanOver(pieces[i], conc0)))
  if (avg.some((o) => !Number.isFinite(o.step.stepSec))) return demand.map(() => ({ ...NO_FIT }))
  const occ = lines.map((x, i) =>
    promptOccupancy(s, lo, p, promptTokens(x, avg[i].k[i]), x.rate, avg[i].load, budget),
  )
  const service = occ.map((o) => (chunked ? o.steps * o.stepSec : o.wallSec))

  /**
   * 3. the prompt lane at a moment: each line's prompts arrive at its bursts' rate (spread over the
   *    lanes), each holding the lane's prompt capacity for its service time (its chunk-carrying
   *    steps, or its exclusive run); first-come first-served, a prompt waits behind the work ahead
   *    of it — the Pollaczek–Khinchine wait λ·E[S²] / 2(1 − ρ), so short prompts queue behind long
   *    documents — and the decodes pay for the prompt work (longer chunk-carrying steps, or stalls)
   */
  const promptLane = (at: number): { util: number; queue: number; chunkRate: number } => {
    // prompts are ingested by the rack that admits them — the first one in reach with a free slot —
    // so they gather on as few lanes as the requests in flight fill (one engine's slots each)
    // while the decodes spread over every rack in reach (each pays its share of the prompt work)
    const pLanes = Math.min(lanes, Math.max(1, (sum(conc0(at)) * lanes) / slots))
    const work = sum(inFlight(at, (j, b) => b.rate * service[j], none))
    const busy = work / pLanes
    const second = sum(inFlight(at, (j, b) => b.rate * service[j] * service[j], none)) / pLanes
    const queueUtil = Math.min(MAX_PROMPT_UTIL, busy)
    const spread = work / lanes
    const util = Math.min(MAX_PROMPT_UTIL, spread)
    const steps = sum(inFlight(at, (j, b) => b.rate * occ[j].steps, none)) / lanes
    return {
      util,
      queue: busy > 0 ? (second * (queueUtil / busy)) / (2 * (1 - queueUtil)) : 0,
      chunkRate: chunked && spread > 0 ? steps * (util / spread) : 0,
    }
  }
  const tpotAt = (
    i: number,
    stepSec: number,
    specOn: boolean,
    pl: { util: number; chunkRate: number },
  ): number => {
    const perSec = pl.chunkRate + (1 - pl.util) / stepSec
    const perStep = specOn ? specTokensFor(s, lines[i].d.def.primaryAxis) : 1
    return perSec > 0 ? 1 / perSec / perStep : Infinity
  }
  // the answer's occupancy at the average load (for the slots)
  const S = lines.map((x, i) => {
    let w = 0
    const pl = { util: 0, queue: 0, chunkRate: 0 }
    for (const pc of pieces[i]) {
      const v = promptLane(pc.at)
      pl.util += pc.w * v.util
      pl.queue += pc.w * v.queue
      pl.chunkRate += pc.w * v.chunkRate
      w += pc.w
    }
    if (w > 0) {
      pl.util /= w
      pl.queue /= w
      pl.chunkRate /= w
    }
    const tp = tpotAt(i, avg[i].step.stepSec, avg[i].step.specOn, pl)
    return occ[i].wallSec + pl.queue + x.generated * tp * kvWaitOf(avg[i].k[i])
  })
  const tailS = (j: number): number => S[j] / SIM_TIME_SCALE

  // 4. every request's latency at the moment it arrives (its lane, the prompt queue, the slots —
  //    a request waits when every slot in its reach is busy: Erlang C over the fleet's slots), averaged
  //    over the line's arrivals; the on-time share counts the moments that break a bound
  const win = serverCtxWindowTokens(s, lo)
  return lines.map((x, i) => {
    const def = x.d.def
    const mode = answerMode(m, def)
    const seq = x.d.inputTokens + x.generated
    const window = (win <= 0 || seq <= win) && kvPerReqGb(s, m, seq) <= p.kvGbPerReplica
    const effQ = serverQualityVs(s, lo, def.primaryAxis, mode) - longContextPenalty(s, lo, x.ctx)
    const cls = LAT_CLASS_SLO[def.latClass]
    const ttftB = (def.ttftSloMs ?? cls.ttftMs) / 1000
    const ttfatB = (def.ttfatSloMs ?? Infinity) / 1000
    const e2elB = (def.e2elSloMs ?? Infinity) / 1000
    const guardIn = guardSecFor(s, env.guards, 'input', x.d)
    const guardOut = guardSecFor(s, env.guards, 'output', x.d)
    let wSumI = 0
    const acc = { ttft: 0, ttfat: 0, tpot: 0, e2el: 0, onTime: 0, queued: 0, wait: 0, streams: 0 }
    let worst: SloCause | null = null
    let worstOn = 2
    for (const pc of pieces[i]) {
      const lane = laneOf(i, conc0(pc.at))
      const pl = promptLane(pc.at)
      const tpot = tpotAt(i, lane.step.stepSec, lane.step.specOn, pl)
      const kvWait = kvWaitOf(lane.k[i])
      const admit = admissionDelaySec(s, lo, lane.step.stepSec)
      const ttft = occ[i].wallSec + pl.queue + admit + guardIn
      const ttfat = ttft + x.hidden * tpot * kvWait
      const e2el = ttft + x.generated * tpot * kvWait + guardOut
      const uses = {
        ttft: ttft / ttftB,
        ttfat: ttfat / ttfatB,
        tpot: x.generated > 1 ? (tpot * 1000) / cls.tpotMs : 0,
        e2el: e2el / e2elB,
      }
      const lat = Math.max(uses.ttft, uses.ttfat, uses.tpot, uses.e2el)
      // the share that waits for a slot AND is late for it (an exponential wait past the bound's slack)
      const conc = inFlight(pc.at, (j, b) => Math.min(b.rate * S[j], b.count), tailS)
      const a = sum(conc) / paths
      const queued = erlangC(entry, a)
      const meanS = a > 0 ? sum(conc.map((c, j) => c * S[j])) / (a * paths) : 0
      // a request the entry racks cannot take walks on toward the core: it waits at least as long
      // as their cohorts take to free a slot
      const waitSec = queued <= 0 ? 0 : a >= entry ? Infinity : meanS / (entry - a)
      const slack = Math.min(ttftB - ttft, ttfatB - ttfat, e2elB - e2el)
      const late = !Number.isFinite(slack) ? 0 : slack <= 0 ? 1 : Math.exp(-slack / Math.max(1e-9, waitSec))
      const onTime = onTimeShare(lat) * (1 - queued * late)
      if (onTime < worstOn) {
        worstOn = onTime
        worst =
          uses.ttft >= Math.max(uses.ttfat, uses.tpot, uses.e2el) || queued * late > 0.5
            ? 'ttft'
            : uses.ttfat >= Math.max(uses.tpot, uses.e2el)
              ? 'ttfat'
              : uses.tpot >= uses.e2el
                ? 'tpot'
                : 'e2el'
      }
      const w = pc.w
      wSumI += w
      acc.ttft += w * ttft
      acc.ttfat += w * ttfat
      acc.tpot += w * tpot
      acc.e2el += w * e2el
      acc.onTime += w * onTime
      acc.queued += w * queued
      acc.wait += w * (Number.isFinite(waitSec) ? waitSec : realSec)
      acc.streams += w * lane.load.streams
    }
    const n = Math.max(1e-9, wSumI)
    const ttft = acc.ttft / n
    const ttfat = acc.ttfat / n
    const tpot = acc.tpot / n
    const e2el = acc.e2el / n
    const onTime = acc.onTime / n
    const ttftUse = ttft / ttftB
    const ttfatUse = ttfat / ttfatB
    const tpotUse = x.generated > 1 ? (tpot * 1000) / cls.tpotMs : 0
    const e2elUse = e2el / e2elB
    let slowBy: SloCause | null =
      ttftUse > 1 ? 'ttft' : ttfatUse > 1 ? 'ttfat' : tpotUse > 1 ? 'tpot' : e2elUse > 1 ? 'e2el' : null
    // most of its requests late at the moments they arrive, though the averages pass: name the bound
    if (slowBy === null && onTime < 0.5) slowBy = worst
    return {
      mode,
      hidden: x.hidden,
      ttftSec: ttft,
      ttfatSec: ttfat,
      tpotSec: tpot,
      e2elSec: e2el,
      lat: Math.max(ttftUse, ttfatUse, tpotUse, e2elUse),
      slowBy,
      effQ,
      margin: effQ - x.d.difficulty,
      window,
      streams: acc.streams / n,
      perUserTokS: tpot > 0 ? 1 / tpot : 0,
      queued: acc.queued / n,
      waitSec: acc.wait / n,
      onTime,
    }
  })
}
