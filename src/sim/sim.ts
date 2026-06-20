import { CLEAR_BONUS_SCALE, SIM_DT } from '../config'
import type { GameState, IncidentDef, ModifierTarget } from '../core/types'
import { updateCombat } from './combat'
import { INCIDENTS, WAVES, themedIncidentForWave } from './content'
import { LANE_COUNT } from './pathing'
import {
  loadoutOf,
  rackOperatingCostPerSec,
  serverAggDecodeTokS,
  serverTargets,
} from './effects'
import { updateMovement } from './movement'
import { updatePower } from './power'
import { updateResearch } from './research'
import { allSpawned, updateSpawns } from './spawn'
import { defaultModifiers } from './state'
import { finalizeReport, pruneRecent, recordPowerCost } from './telemetry'

/** Advance the simulation by one fixed step. Only does work during a wave. */
export function step(s: GameState, dt: number = SIM_DT): void {
  if (s.phase !== 'wave') return
  s.time += dt
  s.waveTime += dt

  updatePower(s)
  updateResearch(s, dt)
  updateSpawns(s, dt)
  updateCombat(s, dt)
  updateMovement(s, dt)

  if (s.requests.some((r) => !r.alive)) s.requests = s.requests.filter((r) => r.alive)
  if (s.requests.length > s.stats.peakConcurrent) s.stats.peakConcurrent = s.requests.length

  updateEconomy(s, dt)
  pruneRecent(s)

  if (s.meters.trust <= 0 || s.meters.sla <= 0 || s.meters.cash < 0) {
    lose(s)
    return
  }

  if (allSpawned(s) && s.requests.length === 0) clearWave(s)
}

/**
 * Real economy tick (§6.6 / §6.7 step 7). Operating cost is a REAL $/GPU-hr bill
 * by wall-clock — every ONLINE rack burns its rate whether it served anything or
 * not. Income is token-priced (charged in resolveServe). Because cost is fixed by
 * time and income is by tokens served, an idle / over-provisioned rack bleeds
 * credits → the utilization penalty EMERGES (no artificial ×10, §6.6).
 *
 * Also updates the rolling `utilization` (served decode tok/s vs theoretical max)
 * and `fleetCapexUsd` telemetry. The power-price incident still scales the bill.
 */
function updateEconomy(s: GameState, dt: number): void {
  // dual clock: an online rack lives `dt` board seconds; its real $/GPU-hr bill is
  // already mapped to board time and credits inside rackOperatingCostPerSec.
  let opCost = 0
  let fleetCapexUsd = 0
  let servedTokS = 0
  let theoreticalTokS = 0
  for (const t of s.towers) {
    if (t.def.kind !== 'server') continue
    const lo = loadoutOf(s, t)
    if (lo.hw) fleetCapexUsd += lo.hw.capexUsd
    // a browned-out / frozen rack draws no operating bill (it is dark), but a
    // requisitioned (training) rack still burns — it is powered and computing.
    if (!t.online || t.throttle <= 0) continue
    if (lo.hw) opCost += rackOperatingCostPerSec(lo.hw) * dt
    if (t.training || !lo.model) continue
    // utilization: a rack's theoretical max aggregate decode throughput vs how
    // much of its batch was actually busy last combat tick (§6.6).
    const maxBatch = serverTargets(s, lo)
    const roof = serverAggDecodeTokS(s, lo, Math.max(1, maxBatch))
    theoreticalTokS += roof
    servedTokS += roof * t.load
  }
  opCost *= s.modifiers.powerPrice
  s.meters.cash -= opCost
  recordPowerCost(s, opCost)
  s.fleetCapexUsd = fleetCapexUsd
  const inst = theoreticalTokS > 0 ? servedTokS / theoreticalTokS : 0
  // rolling utilization (EMA) for telemetry — smooths the per-tick spikiness.
  s.utilization = s.utilization * 0.9 + inst * 0.1
}

function lose(s: GameState): void {
  s.phase = 'lost'
  if (s.meters.cash < 0) s.message = 'lose.bankrupt'
  else if (s.meters.trust <= 0) s.message = 'lose.trust'
  else s.message = 'lose.sla'
  s.events.push({ type: 'lose' })
}

/** Clear bonus in the real credit economy: the authored value × CLEAR_BONUS_SCALE. */
function clearBonusOf(w: { clearBonus: number } | null | undefined): number {
  return w ? Math.round(w.clearBonus * CLEAR_BONUS_SCALE) : 0
}

function clearWave(s: GameState): void {
  s.waveActive = false
  s.phase = 'build'
  const w = s.currentWave ?? WAVES[s.waveIndex]
  const bonus = clearBonusOf(w)
  if (w) {
    s.meters.cash += bonus
    s.stats.cashEarned += bonus
  }
  s.lastReport = finalizeReport(s, bonus)
  s.waveStats = null
  s.utilization = 0
  // clear the spent wave's incident state; rollIncident re-applies the next one.
  s.modifiers = defaultModifiers()
  s.laneWindow = []
  s.events.push({ type: 'wave-clear', index: s.waveIndex })

  // The authored campaign ends at the boss; endless mode just keeps going.
  if (!s.endless && s.waveIndex >= WAVES.length - 1) {
    s.phase = 'won'
    s.message = 'win.msg'
    s.events.push({ type: 'win' })
    return
  }
  rollIncident(s)
}

/**
 * Pick AND apply a telegraphed incident for the upcoming wave. The effect is live
 * immediately (during the build phase and the wave): `buildCost` raises the price
 * of racks the player is about to place, while `powerPrice`/`coolingCap`/
 * `safetyDamage`/`volume`/`reward` bite once the wave runs. It is cleared back to
 * defaults at the next wave-clear. (Previously the incident was only displayed and
 * never applied — a long-standing dead-effect bug, now fixed.)
 */
function rollIncident(s: GameState): void {
  const next = s.waveIndex + 1
  s.pendingIncident = null
  if (next < 2) return // ease the player in
  let inc: IncidentDef | undefined
  // (1) a real-event wave forces its SIGNATURE incident (deterministic): the
  //     DeepSeek price war, the EU AI Act audit, a grid power crunch, a viral melt.
  const themedId = themedIncidentForWave(next)
  if (themedId) inc = INCIDENTS.find((i) => i.id === themedId)
  if (!inc) {
    // (2) the final boss and every 10th wave otherwise carry a guaranteed HARD
    //     incident; endless surges keep the every-10th cadence past the campaign.
    const oneBased = next + 1
    const hardNight =
      next === WAVES.length - 1 ||
      oneBased % 10 === 0 ||
      (s.endless && next >= WAVES.length && (next - WAVES.length) % 10 === 9)
    if (hardNight) {
      const hard = INCIDENTS.filter((i) => !i.good)
      inc = hard[s.rng.int(hard.length)]
    } else if (s.rng.chance(0.6)) {
      // (3) otherwise a 60% chance of a random incident — the per-run variability.
      inc = INCIDENTS[s.rng.int(INCIDENTS.length)]
    }
  }
  if (!inc) return
  s.pendingIncident = inc
  applyIncident(s, inc)
}

/** Apply a telegraphed incident's multipliers, lane concentration, and one-shot effect. */
function applyIncident(s: GameState, inc: IncidentDef): void {
  for (const key of Object.keys(inc.mods) as ModifierTarget[]) {
    s.modifiers[key] *= inc.mods[key] ?? 1
  }
  if (inc.concentrate && inc.concentrate >= 1) {
    // funnel the wave's un-pinned traffic into N randomly-chosen consecutive lanes
    // (a network reroute / cable cut). concentrate=1 → a single-entry surge.
    const keep = Math.max(1, Math.min(LANE_COUNT, Math.round(inc.concentrate)))
    const start = s.rng.int(LANE_COUNT)
    s.laneWindow = Array.from({ length: keep }, (_, i) => (start + i) % LANE_COUNT)
  }
  inc.instant?.(s)
}
