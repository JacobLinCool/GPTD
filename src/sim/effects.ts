import type { GameState, TowerDef } from '../core/types'

/** Owned level of an upgrade (0 if not bought). */
export function lvl(s: GameState, id: string): number {
  return s.upgrades[id] ?? 0
}

export function serverQuality(s: GameState, def: TowerDef): number {
  return (def.quality ?? 0) + 8 * lvl(s, 'scale_pretrain')
}

export function serverSpeed(s: GameState, def: TowerDef): number {
  let mul = 1 + 0.12 * lvl(s, 'scale_throughput')
  if (def.spec === 'chat') mul *= 1 + 0.3 * lvl(s, 'eff_distill')
  if (def.spec === 'reasoning') mul *= 1 + 0.35 * lvl(s, 'eff_spec')
  return (def.speed ?? 0) * mul
}

export function serverPower(s: GameState, def: TowerDef): number {
  const reduce = 1 - 0.25 * lvl(s, 'eff_quant')
  return Math.max(1, (def.powerDraw ?? 0) * reduce)
}

export function serverTargets(s: GameState, def: TowerDef): number {
  return (def.targets ?? 1) + lvl(s, 'prod_batch')
}

export function routeBonus(s: GameState, def: TowerDef): number {
  return (def.routeBonus ?? 0) * (1 + 0.4 * lvl(s, 'prod_route'))
}

export function cacheChance(s: GameState, def: TowerDef): number {
  return Math.min(0.95, (def.cacheChance ?? 0) + 0.2 * lvl(s, 'prod_cache'))
}

export function safetyRate(s: GameState, def: TowerDef): number {
  return (def.safetyRate ?? 0) * (1 + 0.4 * lvl(s, 'saf_rlhf'))
}

/** Multiplier on the Trust penalty for serving/leaking an unsafe request. */
export function unsafePenaltyMult(s: GameState): number {
  return Math.max(0.4, 1 - 0.3 * lvl(s, 'saf_rlhf'))
}

/** Multiplier on safety risk of newly spawned requests (red-teaming defuses jailbreaks). */
export function spawnRiskMult(s: GameState): number {
  return Math.max(0.3, 1 - 0.3 * lvl(s, 'saf_redteam'))
}

/** Data yield multiplier from owning Training Labs. */
export function dataMult(s: GameState): number {
  const labs = s.towers.reduce((n, t) => n + (t.def.kind === 'lab' ? 1 : 0), 0)
  return 1 + 0.25 * labs
}

export function hasLab(s: GameState): boolean {
  return s.towers.some((t) => t.def.kind === 'lab')
}
