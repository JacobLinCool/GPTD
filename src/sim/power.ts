import { START, THROTTLE_FLOOR } from '../config'
import type { Capacity, GameState, Tower } from '../core/types'
import {
  guardHeat,
  guardPower,
  hasLiquidLoop,
  hwNeedsLiquid,
  loadoutOf,
  serverHeat,
  serverPower,
} from './effects'

/**
 * A building's REAL electrical draw in kW: a server rack its loadout's draw, a generative
 * guardrail the GPU rack its judge model runs on, any other support building its kW draw.
 */
export function towerPowerKw(s: GameState, t: Tower): number {
  if (t.def.kind === 'server') return serverPower(s, loadoutOf(s, t))
  if (t.def.kind === 'guardrail' && t.def.guardrail?.runsOnRoofline) return guardPower(s, t.def.guardrail)
  return t.def.powerDraw ?? 0
}

/** A building's REAL heat output in kW (≈ all electrical power becomes heat). */
export function towerHeatKw(s: GameState, t: Tower): number {
  if (t.def.kind === 'server') return serverHeat(s, loadoutOf(s, t))
  if (t.def.kind === 'guardrail' && t.def.guardrail?.runsOnRoofline) return guardHeat(s, t.def.guardrail)
  return t.def.heat ?? 0
}

/** Does this building reject its heat into the liquid loop (a direct-liquid-cooled rack)? */
export function towerLiquidCooled(s: GameState, t: Tower): boolean {
  return t.def.kind === 'server' && hwNeedsLiquid(loadoutOf(s, t).hw)
}

/**
 * §6.5 hard gate (OQ-G8): a liquid-cooled rack (`cooling: 'liquid'` — the GB200 NVL72, whose
 * 1200 W/GPU is past the ~1000 W air-cooling limit) CANNOT be online unless the datacenter has
 * at least one Liquid Cooling Loop. This is a hard gate (the rack goes dark), not a soft
 * throttle — an air-cooled rack never needs it.
 */
function liquidGated(s: GameState, t: Tower): boolean {
  return towerLiquidCooled(s, t) && !hasLiquidLoop(s)
}

/** The two heat-rejection pools: house chillers + Cooling Towers (air) and the Liquid Loops. */
export interface CoolingPools {
  air: Capacity
  liquid: Capacity
}

/**
 * Real heat-rejection capacity per pool (kW), before any load: the base chillers and Cooling
 * Towers form the AIR pool; Liquid Cooling Loops form the LIQUID pool, which only liquid-cooled
 * racks can use (a coolant loop plumbed to cold plates cannot cool an air-cooled chassis). A
 * site-wide cooling shortfall (`coolingCap`, a water restriction) cuts both; a liquid-loop
 * fault (`liquidCoolingCap`) cuts only the liquid pool.
 */
function coolingCapacity(s: GameState): { air: number; liquid: number } {
  let air = START.baseCooling
  let liquid = 0
  for (const t of s.towers) {
    const kw = t.def.cooling ?? 0
    if (t.def.kind === 'cooling_liquid') liquid += kw
    else air += kw
  }
  return {
    air: air * s.modifiers.coolingCap,
    liquid: liquid * s.modifiers.coolingCap * s.modifiers.liquidCoolingCap,
  }
}

/**
 * Usable electrical capacity (kW): the substation feed plus every Power Plant, times the
 * curtailment modifier (a grid emergency sheds part of the feed for the wave).
 */
function powerCapacity(s: GameState): number {
  let cap = START.basePower
  for (const t of s.towers) cap += t.def.power ?? 0
  return cap * s.modifiers.powerCap
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * Recompute REAL power & cooling capacity (kW), brown out GPUs that exceed the power
 * budget, enforce the liquid-cooling hard gate, and apply each cooling pool's thermal
 * throttle to the racks it cools. Cheap; runs every step. All quantities are real kW.
 * Returns whether any server rack is dark (browned out or liquid-gated) afterwards.
 */
export function updatePower(s: GameState): boolean {
  const powerCap = powerCapacity(s)
  const coolCap = coolingCapacity(s)

  // §6.5 liquid-cooling hard gate: a liquid rack with no loop is dark, full stop.
  // Mark it offline up front so it draws no power and is excluded from the budget.
  for (const t of s.towers) t.online = !liquidGated(s, t)

  const consumers = s.towers.filter((t) => t.online && towerPowerKw(s, t) > 0)
  let total = consumers.reduce((sum, t) => sum + towerPowerKw(s, t), 0)

  if (total > powerCap) {
    // Cut the most power-hungry servers first; keep support online as long as possible —
    // a generative guardrail is a safety stage, so it is shed with support, after every server.
    const servers = consumers
      .filter((t) => t.def.kind === 'server' && t.online)
      .sort((a, b) => towerPowerKw(s, b) - towerPowerKw(s, a))
    for (const t of servers) {
      if (total <= powerCap) break
      t.online = false
      total -= towerPowerKw(s, t)
    }
    if (total > powerCap) {
      const support = consumers
        .filter((t) => t.def.kind !== 'server' && t.online)
        .sort((a, b) => towerPowerKw(s, b) - towerPowerKw(s, a))
      for (const t of support) {
        if (total <= powerCap) break
        t.online = false
        total -= towerPowerKw(s, t)
      }
    }
  }

  let used = 0
  let airHeat = 0
  let liquidHeat = 0
  for (const t of s.towers) {
    if (!t.online) continue
    used += towerPowerKw(s, t)
    if (towerLiquidCooled(s, t)) liquidHeat += towerHeatKw(s, t)
    else airHeat += towerHeatKw(s, t)
  }

  // each pool throttles only the racks it cools
  const throttleOf = (heat: number, cap: number): number =>
    heat <= cap ? 1 : Math.max(THROTTLE_FLOOR, cap / heat)
  const airThrottle = throttleOf(airHeat, coolCap.air)
  const liquidThrottle = throttleOf(liquidHeat, coolCap.liquid)
  let dark = false
  for (const t of s.towers) {
    if (t.def.kind === 'server') {
      t.throttle = t.online ? (towerLiquidCooled(s, t) ? liquidThrottle : airThrottle) : 0
      if (!t.online) dark = true
    } else t.throttle = 1
  }

  s.power = { used: round2(used), cap: round2(powerCap) }
  s.cooling = { used: round2(airHeat + liquidHeat), cap: round2(coolCap.air + coolCap.liquid) }
  s.coolingLiquid = { used: round2(liquidHeat), cap: round2(coolCap.liquid) }
  return dark
}

/** The two cooling pools as last computed by updatePower (air = everything not liquid-cooled). */
export function coolingPools(s: GameState): CoolingPools {
  return {
    air: {
      used: round2(s.cooling.used - s.coolingLiquid.used),
      cap: round2(s.cooling.cap - s.coolingLiquid.cap),
    },
    liquid: { ...s.coolingLiquid },
  }
}

/**
 * Recompute power & cooling (updatePower) and emit a `brownout` event when the
 * dark-rack state flips (on = a rack just went dark, false = every rack is lit again).
 * Called on every wave step AND after every build-phase action, so the HUD, the bridge
 * snapshot and headless consumers always read the live kW budget.
 */
export function refreshPower(s: GameState): void {
  const before = lastBrownout.get(s) ?? isBrownout(s)
  const after = updatePower(s)
  lastBrownout.set(s, after)
  if (after !== before) s.events.push({ type: 'brownout', on: after })
}

/** The dark-rack state each run last signalled (spares a second fleet scan per step). */
const lastBrownout = new WeakMap<GameState, boolean>()

/** Is any server currently browned out or liquid-gated? (for HUD/audio warnings) */
export function isBrownout(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'server' && !t.online)
}

/** Is any rack dark specifically because it is a liquid rack with no Liquid Cooling Loop? */
export function isLiquidGated(s: GameState): boolean {
  return s.towers.some((t) => liquidGated(s, t))
}

/** Is either cooling pool over its capacity (its racks are thermally throttled)? */
export function isThrottling(s: GameState): boolean {
  const p = coolingPools(s)
  return p.air.used > p.air.cap + 0.001 || p.liquid.used > p.liquid.cap + 0.001
}

/** Can a NEW Power Plant be energized right now? (an interconnection freeze blocks it). */
export function powerBuildOpen(s: GameState): boolean {
  return s.modifiers.powerBuild > 0
}
