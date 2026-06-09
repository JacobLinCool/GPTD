import { START, THROTTLE_FLOOR } from '../config'
import type { GameState, Tower } from '../core/types'
import { serverPower } from './effects'

function effDraw(s: GameState, t: Tower): number {
  if (t.def.kind === 'server') return serverPower(s, t.def)
  return t.def.powerDraw ?? 0
}

/**
 * Recompute power & cooling capacity, brown out GPUs that exceed the power
 * budget, and apply a global thermal-throttle factor. Cheap; runs every step.
 */
export function updatePower(s: GameState): void {
  let powerCap = START.basePower
  let coolCap = START.baseCooling
  for (const t of s.towers) {
    powerCap += t.def.power ?? 0
    coolCap += t.def.cooling ?? 0
  }
  coolCap *= s.modifiers.coolingCap

  const consumers = s.towers.filter((t) => effDraw(s, t) > 0)
  for (const t of s.towers) t.online = true

  let total = consumers.reduce((sum, t) => sum + effDraw(s, t), 0)

  if (total > powerCap) {
    // Cut the most power-hungry servers first; keep cheap support online if possible.
    const servers = consumers
      .filter((t) => t.def.kind === 'server')
      .sort((a, b) => effDraw(s, b) - effDraw(s, a))
    for (const t of servers) {
      if (total <= powerCap) break
      t.online = false
      total -= effDraw(s, t)
    }
    if (total > powerCap) {
      const support = consumers
        .filter((t) => t.def.kind !== 'server' && t.online)
        .sort((a, b) => effDraw(s, b) - effDraw(s, a))
      for (const t of support) {
        if (total <= powerCap) break
        t.online = false
        total -= effDraw(s, t)
      }
    }
  }

  let used = 0
  let heat = 0
  for (const t of consumers) {
    if (!t.online) continue
    used += effDraw(s, t)
    heat += t.def.heat ?? 0
  }

  const throttle = heat <= coolCap ? 1 : Math.max(THROTTLE_FLOOR, coolCap / heat)
  for (const t of s.towers) {
    if (t.def.kind === 'server') t.throttle = t.online ? throttle : 0
    else t.throttle = 1
  }

  s.power = { used: Math.round(used * 10) / 10, cap: Math.round(powerCap * 10) / 10 }
  s.cooling = { used: Math.round(heat * 10) / 10, cap: Math.round(coolCap * 10) / 10 }
}

/** Is any server currently browned out? (for HUD/audio warnings) */
export function isBrownout(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'server' && !t.online)
}

export function isThrottling(s: GameState): boolean {
  return s.cooling.used > s.cooling.cap + 0.01
}
