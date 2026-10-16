import { LANE_SPEED, TILE } from '../config'
import type { GameState, Request, SafetyProfile, SpawnGroup } from '../core/types'
import { REQUEST_TYPES } from './content'
import { maxSeverity } from './safety'
import { LANE_COUNT, posAt } from './pathing'

export function spawnRequest(
  s: GameState,
  typeId: string,
  workMul = 1,
  speedMul = 1,
  complexityMul = 1,
  rewardMul = 1,
  contextMul = 1,
  laneId = 0,
  threat: SpawnThreat = {},
): Request {
  const def = REQUEST_TYPES[typeId]
  if (!def) throw new Error(`spawnRequest: unknown request type "${typeId}"`)
  const id = s.nextId++
  const lane = ((laneId % LANE_COUNT) + LANE_COUNT) % LANE_COUNT
  const p = posAt(0, lane)
  // Real token counts (§2): prefill ingests inputTokens, decode emits outputTokens.
  // workMul scales the generation load (output, with input following along);
  // contextMul inflates the prompt length (era "token inflation", REALISM §1.8).
  const inputTokens = Math.max(1, Math.round(def.inputTokens * contextMul * Math.max(1, Math.sqrt(workMul))))
  // a pure-prefill request (embed: OSL 0) generates no decode tokens; everything
  // else scales its OSL with workMul. Floor at 0 (not 1) so embed stays prefill-only.
  const outputTokens = Math.max(def.outputTokens > 0 ? 1 : 0, Math.round(def.outputTokens * workMul))
  const context = Math.round(def.context * contextMul)
  // resolved scalar difficulty (§6.4): the primary-axis quality line, scaled by the
  // endless complexityMul. Replaces the retired def.complexity ([fix M2]).
  const difficulty = (def.difficulty[def.primaryAxis] ?? 0) * complexityMul
  // §3.4 the request's hazard profile: the def's (or the wave's override), escalated by the
  // era's hazard pressure and clamped to severity 1; the open set starts equal.
  const hazards = escalatedHazards(threat.hazards ?? def.hazards ?? {}, threat.hazardMul ?? 1)
  const hazardsOpen: SafetyProfile = { ...hazards }
  const risk = maxSeverity(hazardsOpen)
  const r: Request = {
    id,
    def,
    laneId: lane,
    dist: 0,
    work: outputTokens,
    prefill: inputTokens,
    maxWork: outputTokens,
    tokensIn: inputTokens,
    tokensOut: outputTokens,
    contextLen: inputTokens,
    queueSec: 0,
    guardInSec: 0,
    guardOutSec: 0,
    ttftReal: 0,
    e2elReal: 0,
    decodeSec: 0,
    sloViolated: false,
    windowBlocked: false,
    speed: def.speed * speedMul * TILE * LANE_SPEED,
    difficulty,
    context,
    hazards,
    hazardsOpen,
    novel: risk > 0 && !!threat.novel,
    safetyRisk: risk,
    reward: def.reward * rewardMul,
    // token-priced income (§6.6): the market multiplier (rewardMul, endless drift)
    // scales the realised price so endless inflation still raises revenue.
    pricePerMtokIn: def.pricePerMtokIn * rewardMul,
    pricePerMtokOut: def.pricePerMtokOut * rewardMul,
    trustPenalty: def.trustPenalty,
    slaPenalty: def.slaPenalty,
    data: def.data,
    bestQuality: -999,
    qualTokSum: 0,
    qualTokW: 0,
    bornAt: s.time,
    safetyCleared: risk <= 0,
    overRefused: false,
    selfHandled: false,
    screened: false,
    guardsSeen: new Set<number>(),
    attackHandled: false,
    routed: false,
    routedTo: null,
    cacheLooked: false,
    cachedTokens: 0,
    tokBy: {},
    x: p.x,
    y: p.y,
    hitFlash: 0,
    cacheFlash: 0,
    alive: true,
    // display-only, latched later (declared up front: one object shape for every request)
    prefillDoneAt: undefined,
    sloCause: undefined,
    refusedBy: undefined,
    thinkTokens: undefined,
    answeredBy: undefined,
    answeredModelId: undefined,
  }
  s.requests.push(r)
  return r
}

/** How a burst arms its requests: the era's hazard pressure, a novel-attack flag, an authored hazard override. */
export interface SpawnThreat {
  hazardMul?: number
  novel?: boolean
  hazards?: SafetyProfile
}

/** A hazard profile with every severity scaled by the era's pressure, clamped to 1. */
export function escalatedHazards(base: SafetyProfile, mul: number): SafetyProfile {
  const out: SafetyProfile = {}
  for (const h of Object.keys(base) as (keyof SafetyProfile)[]) {
    const v = base[h]
    if (v !== undefined) out[h] = Math.min(1, v * mul)
  }
  return out
}

/**
 * Is the k-th (0-based) request of a burst a NOVEL attack? Spreads `share` evenly over the
 * burst by spawn order (no RNG draw, so adding novelty never perturbs the run's dice).
 */
export function isNovelAt(k: number, share: number): boolean {
  if (share <= 0) return false
  return Math.floor((k + 1) * share) > Math.floor(k * share)
}

/** Every ingress lane id [0..LANE_COUNT) — the default spread when no concentration is active. */
const ALL_LANES = Array.from({ length: LANE_COUNT }, (_, i) => i)

/**
 * The single ingress lane a wave's whole traffic is funnelled into, if any: every burst
 * pinned to one lane (an authored single-entry surge), or a concentration incident that
 * narrowed the lane window to one lane. undefined = the traffic is spread.
 */
export function surgeLaneOf(groups: SpawnGroup[], laneWindow: number[]): number | undefined {
  const spread = laneWindow.length ? laneWindow : ALL_LANES
  const lanes = new Set<number>()
  for (const g of groups) {
    if (g.lane !== undefined) lanes.add(((g.lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT)
    else for (const l of spread) lanes.add(l)
    if (lanes.size > 1) return undefined
  }
  return lanes.size === 1 ? [...lanes][0] : undefined
}

/** Advance the active wave's spawn groups. */
export function updateSpawns(s: GameState, dt: number): void {
  // the lanes in play this wave: a concentration incident narrows the window to
  // one (or a few) lane(s) so all un-pinned traffic funnels through one region.
  const window = s.laneWindow.length ? s.laneWindow : ALL_LANES
  for (const g of s.spawns) {
    if (g.spawned >= g.count) continue
    if (!g.started) {
      if (s.waveTime < g.delay) continue
      g.started = true
      g.timer = 0
    }
    g.timer -= dt
    let guard = 0
    while (g.timer <= 0 && g.spawned < g.count && guard < 64) {
      // an authored single-entry burst pins its own lane; otherwise round-robin
      // through the active window (spawnRequest wraps any out-of-range lane).
      const lane = g.lane !== undefined ? g.lane : window[s.nextLaneId % window.length]
      spawnRequest(
        s,
        g.typeId,
        g.workMul ?? 1,
        g.speedMul ?? 1,
        g.complexityMul ?? 1,
        g.rewardMul ?? 1,
        g.contextMul ?? 1,
        lane,
        { hazardMul: g.hazardMul, novel: isNovelAt(g.spawned, g.novelShare ?? 0), hazards: g.hazards },
      )
      if (g.lane === undefined) s.nextLaneId++
      g.spawned++
      g.timer += g.interval
      guard++
    }
  }
}

export function allSpawned(s: GameState): boolean {
  return s.spawns.every((g) => g.spawned >= g.count)
}
