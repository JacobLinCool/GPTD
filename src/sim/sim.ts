import { POWER_PRICE, SIM_DT } from '../config'
import type { GameState } from '../core/types'
import { updateCombat } from './combat'
import { INCIDENTS, WAVES } from './content'
import { updateMovement } from './movement'
import { updatePower } from './power'
import { allSpawned, updateSpawns } from './spawn'
import { defaultModifiers } from './state'

/** Advance the simulation by one fixed step. Only does work during a wave. */
export function step(s: GameState, dt: number = SIM_DT): void {
  if (s.phase !== 'wave') return
  s.time += dt
  s.waveTime += dt

  updatePower(s)
  updateSpawns(s, dt)
  updateCombat(s, dt)
  updateMovement(s, dt)

  if (s.requests.some((r) => !r.alive)) s.requests = s.requests.filter((r) => r.alive)
  if (s.requests.length > s.stats.peakConcurrent) s.stats.peakConcurrent = s.requests.length

  // Power bills you only while the platform is live (a wave is running).
  s.meters.cash -= s.power.used * POWER_PRICE * s.modifiers.powerPrice * dt

  if (s.meters.trust <= 0 || s.meters.sla <= 0 || s.meters.cash < 0) {
    lose(s)
    return
  }

  if (allSpawned(s) && s.requests.length === 0) clearWave(s)
}

function lose(s: GameState): void {
  s.phase = 'lost'
  if (s.meters.cash < 0) s.message = 'Bankrupt — the runway ran out.'
  else if (s.meters.trust <= 0) s.message = 'Users lost trust in the platform.'
  else s.message = 'SLA breached — the enterprise contracts walked.'
  s.events.push({ type: 'lose' })
}

function clearWave(s: GameState): void {
  s.waveActive = false
  s.phase = 'build'
  const w = WAVES[s.waveIndex]
  if (w) {
    s.meters.cash += w.clearBonus
    s.stats.cashEarned += w.clearBonus
  }
  s.modifiers = defaultModifiers()
  s.events.push({ type: 'wave-clear', index: s.waveIndex })

  if (s.waveIndex >= WAVES.length - 1) {
    s.phase = 'won'
    s.message = 'You scaled from a tiny startup model to a global AI platform.'
    s.events.push({ type: 'win' })
    return
  }
  rollIncident(s)
}

/** Pick a (telegraphed) incident for the upcoming wave. */
function rollIncident(s: GameState): void {
  const next = s.waveIndex + 1
  s.pendingIncident = null
  if (next < 2) return // ease the player in
  // The boss night always carries a hard incident.
  if (next === WAVES.length - 1) {
    const hard = INCIDENTS.filter((i) => !i.good)
    s.pendingIncident = hard[s.rng.int(hard.length)]
    return
  }
  if (s.rng.chance(0.75)) {
    s.pendingIncident = INCIDENTS[s.rng.int(INCIDENTS.length)]
  }
}
