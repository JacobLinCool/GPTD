import { START, THROTTLE_FLOOR } from '../config'
import type { GameState, Tower } from '../core/types'
import { hasLiquidLoop, hwNeedsLiquid, loadoutOf, serverHeat, serverPower } from './effects'

/** A server's REAL electrical draw in kW (support buildings carry a kW powerDraw). */
function effDraw(s: GameState, t: Tower): number {
  if (t.def.kind === 'server') return serverPower(s, loadoutOf(s, t))
  return t.def.powerDraw ?? 0
}

/** A server's REAL heat output in kW (support buildings carry a kW heat). */
function effHeat(s: GameState, t: Tower): number {
  if (t.def.kind === 'server') return serverHeat(s, loadoutOf(s, t))
  return t.def.heat ?? 0
}

/**
 * §6.5 hard gate (OQ-G8): a liquid-cooled rack (DGX/NVL72, ≥1000 W/GPU) CANNOT be
 * online unless the datacenter has at least one Liquid Cooling Loop. This is a hard
 * gate (the rack goes dark), not a soft throttle — an air-cooled rack never needs it.
 */
function liquidGated(s: GameState, t: Tower): boolean {
  if (t.def.kind !== 'server') return false
  return hwNeedsLiquid(loadoutOf(s, t).hw) && !hasLiquidLoop(s)
}

/**
 * Recompute REAL power & cooling capacity (kW), brown out GPUs that exceed the
 * power budget, enforce the liquid-cooling hard gate, and apply a global thermal-
 * throttle factor. Cheap; runs every step. All quantities are real kW.
 */
export function updatePower(s: GameState): void {
  let powerCap = START.basePower
  let coolCap = START.baseCooling
  for (const t of s.towers) {
    powerCap += t.def.power ?? 0
    coolCap += t.def.cooling ?? 0
  }
  coolCap *= s.modifiers.coolingCap

  // §6.5 liquid-cooling hard gate: a liquid rack with no loop is dark, full stop.
  // Mark it offline up front so it draws no power and is excluded from the budget.
  for (const t of s.towers) t.online = !liquidGated(s, t)

  const consumers = s.towers.filter((t) => t.online && effDraw(s, t) > 0)
  let total = consumers.reduce((sum, t) => sum + effDraw(s, t), 0)

  if (total > powerCap) {
    // Cut the most power-hungry servers first; keep cheap support online if possible.
    const servers = consumers
      .filter((t) => t.def.kind === 'server' && t.online)
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
  for (const t of s.towers) {
    if (!t.online) continue
    used += effDraw(s, t)
    heat += effHeat(s, t)
  }

  const throttle = heat <= coolCap ? 1 : Math.max(THROTTLE_FLOOR, coolCap / heat)
  for (const t of s.towers) {
    if (t.def.kind === 'server') t.throttle = t.online ? throttle : 0
    else t.throttle = 1
  }

  s.power = { used: Math.round(used * 100) / 100, cap: Math.round(powerCap * 100) / 100 }
  s.cooling = { used: Math.round(heat * 100) / 100, cap: Math.round(coolCap * 100) / 100 }
}

/** Is any server currently browned out or liquid-gated? (for HUD/audio warnings) */
export function isBrownout(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'server' && !t.online)
}

/** Is any rack dark specifically because it is a liquid rack with no Liquid Cooling Loop? */
export function isLiquidGated(s: GameState): boolean {
  return s.towers.some((t) => liquidGated(s, t))
}

export function isThrottling(s: GameState): boolean {
  return s.cooling.used > s.cooling.cap + 0.001
}
