/* ------------------------------------------------------------------ *
 *  NEXT-WAVE PREVIEW — a pure, read-only forecast of the wave START    *
 *  will launch: its archetype mix (after the telegraphed incident's    *
 *  volume multiplier), each archetype's latency class / judged axis /  *
 *  resolved difficulty / era token sizes / hazards, the ingress lanes  *
 *  it arrives on (incl. a single-entry surge), the incident, and the   *
 *  operating bill the fleet would pay over it.                         *
 *                                                                      *
 *  Mirrors startWave + spawnRequest + updateEconomy exactly, but never *
 *  mutates state and never draws from the RNG — an endless surge is     *
 *  generated (RNG) only when it starts, so its mix stays unknown here.  *
 * ------------------------------------------------------------------ */

import { CLEAR_BONUS_SCALE, LANE_SPEED, TILE } from '../config'
import type {
  CapabilityAxis,
  GameState,
  IncidentDef,
  LatencyClass,
  SafetyHazard,
  SafetyProfile,
  WaveDef,
} from '../core/types'
import { CAMPAIGN_THEMES } from './campaign'
import { REQUEST_TYPES, WAVES } from './content'
import { loadoutOf, rackOperatingCostPerSec } from './effects'
import { LANE_COUNT, pathLength } from './pathing'
import { ALL_HAZARDS } from './safety'
import { surgeLaneOf } from './spawn'

/** One archetype of the upcoming wave, resolved exactly as spawnRequest will spawn it. */
export interface WavePreviewEntry {
  typeId: string
  /** sprites of this archetype after the incident volume multiplier. */
  count: number
  latClass: LatencyClass
  /** the capability axis combat judges this archetype on. */
  axis: CapabilityAxis
  /** the quality line on that axis (def difficulty × the wave's complexity scaling). */
  difficulty: number
  /** abstract long-context demand (def context × the wave's context scaling). */
  context: number
  /** real prompt / answer lengths at this point of the campaign (ISL / OSL). */
  inputTokens: number
  outputTokens: number
  /** hazards this archetype carries (severity > 0). */
  hazards: SafetyHazard[]
  hazardSeverity: SafetyProfile
  /** the ingress lanes it arrives on. */
  lanes: number[]
}

export interface WavePreview {
  /** 0-based index of the wave START launches next. */
  index: number
  /** the authored wave; null for an endless surge (its mix is rolled at start). */
  def: WaveDef | null
  endless: boolean
  /** 1-based surge number past the campaign (endless only). */
  surgeNumber: number
  era: string | null
  tier: number | null
  boss: boolean
  /** archetypes, most numerous first. */
  entries: WavePreviewEntry[]
  totalRequests: number
  /** the incident's volume multiplier already folded into `count`. */
  volumeMul: number
  incident: IncidentDef | null
  /** the single ingress the whole wave funnels through (authored surge or a concentrate incident). */
  surgeLane: number | null
  /** the lanes in play this wave. */
  lanes: number[]
  /** board seconds until the last request could reach the core (spawn tail + lane transit). */
  estDurationSec: number
  /** the fleet's operating burn right now, credits per board second (online racks, incl. training). */
  burnPerSec: number
  /** burnPerSec × estDurationSec — the bill the wave costs before any income. */
  projectedBill: number
  /** the authored clear bonus in credits (paid on clearing the wave). */
  clearBonus: number
}

const ALL_LANES = Array.from({ length: LANE_COUNT }, (_, i) => i)

/**
 * The fleet's operating bill per board second, exactly as updateEconomy charges it:
 * every online, un-frozen rack bills its $/GPU-hr (a requisitioned training rack is
 * powered and computing, so it bills too), scaled by the power-price incident.
 */
export function fleetBurnPerSec(s: GameState): number {
  let burn = 0
  for (const t of s.towers) {
    if (t.def.kind !== 'server' || !t.online || t.throttle <= 0) continue
    const hw = loadoutOf(s, t).hw
    if (hw) burn += rackOperatingCostPerSec(hw)
  }
  return burn * s.modifiers.powerPrice
}

/** The wave START would launch from the current state, or null when no wave follows. */
export function previewNextWave(s: GameState): WavePreview | null {
  if (s.phase === 'won' || s.phase === 'lost') return null
  const index = s.waveIndex + 1
  const burnPerSec = fleetBurnPerSec(s)
  const surgeLaneFromWindow = s.laneWindow.length === 1 ? s.laneWindow[0] : null
  const windowLanes = s.laneWindow.length ? [...s.laneWindow] : ALL_LANES

  if (index >= WAVES.length) {
    if (!s.endless) return null
    return {
      index,
      def: null,
      endless: true,
      surgeNumber: index - WAVES.length + 1,
      era: null,
      tier: null,
      boss: (index - WAVES.length) % 10 === 9,
      entries: [],
      totalRequests: 0,
      volumeMul: s.modifiers.volume,
      incident: s.pendingIncident,
      surgeLane: surgeLaneFromWindow,
      lanes: windowLanes,
      estDurationSec: 0,
      burnPerSec,
      projectedBill: 0,
      clearBonus: 0,
    }
  }

  const def = WAVES[index]
  const theme = CAMPAIGN_THEMES[index]
  const byType = new Map<string, WavePreviewEntry>()
  const pinned = new Set<number>()
  let unpinned = false
  let total = 0
  let duration = 0
  for (const g of def.groups) {
    const rt = REQUEST_TYPES[g.typeId]
    if (!rt) continue
    // startWave folds the incident volume into every burst's count
    const count = Math.max(1, Math.round(g.count * s.modifiers.volume))
    const workMul = g.workMul ?? 1
    const contextMul = g.contextMul ?? 1
    const lanes = g.lane !== undefined ? [((g.lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT] : windowLanes
    if (g.lane !== undefined) pinned.add(lanes[0])
    else unpinned = true
    total += count
    // the last sprite of this burst spawns at delay + (count−1)·interval, then walks its lane
    const speed = rt.speed * (g.speedMul ?? 1) * TILE * LANE_SPEED
    const longest = Math.max(...lanes.map((l) => pathLength(l)))
    duration = Math.max(duration, g.delay + Math.max(0, count - 1) * g.interval + (speed > 0 ? longest / speed : 0))

    const hazardSeverity: SafetyProfile = { ...(rt.hazards ?? {}) }
    const e = byType.get(g.typeId)
    if (e) {
      e.count += count
      for (const l of lanes) if (!e.lanes.includes(l)) e.lanes.push(l)
      continue
    }
    byType.set(g.typeId, {
      typeId: g.typeId,
      count,
      latClass: rt.latClass,
      axis: rt.primaryAxis,
      difficulty: (rt.difficulty[rt.primaryAxis] ?? 0) * (g.complexityMul ?? 1),
      context: Math.round(rt.context * contextMul),
      // the same token math spawnRequest applies (input follows √work; embed stays prefill-only)
      inputTokens: Math.max(1, Math.round(rt.inputTokens * contextMul * Math.max(1, Math.sqrt(workMul)))),
      outputTokens: Math.max(rt.outputTokens > 0 ? 1 : 0, Math.round(rt.outputTokens * workMul)),
      hazards: ALL_HAZARDS.filter((h) => (hazardSeverity[h] ?? 0) > 0),
      hazardSeverity,
      lanes: [...lanes],
    })
  }
  for (const e of byType.values()) e.lanes.sort((a, b) => a - b)

  // a single-entry surge: the sim's own rule (every burst funnels into one lane — pinned, or a
  // concentrate incident narrowing the window to one), the lane `wave-start` will announce
  const surgeLane = surgeLaneOf(def.groups, s.laneWindow) ?? null
  const lanes = [...new Set([...pinned, ...(unpinned ? windowLanes : [])])].sort((a, b) => a - b)

  return {
    index,
    def,
    endless: false,
    surgeNumber: 0,
    era: theme?.era ?? null,
    tier: theme?.tier ?? null,
    boss: theme?.boss ?? false,
    entries: [...byType.values()].sort((a, b) => b.count - a.count),
    totalRequests: total,
    volumeMul: s.modifiers.volume,
    incident: s.pendingIncident,
    surgeLane,
    lanes,
    estDurationSec: duration,
    burnPerSec,
    projectedBill: burnPerSec * duration,
    clearBonus: Math.round(def.clearBonus * CLEAR_BONUS_SCALE),
  }
}
