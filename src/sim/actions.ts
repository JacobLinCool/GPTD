import type { GameState, ServerHardwareDef, Tower, TowerDef } from '../core/types'
import { HARDWARE_DEFS, HARDWARE_TIERS, TOWER_DEFS, UPGRADE_MAP, WAVES } from './content'
import {
  hasLab,
  hasLiquidLoop,
  hwNeedsLiquid,
  loadout,
  loadoutOf,
  methodsUnlocked,
  resolveModel,
  serverFitsMemory,
} from './effects'
import { generateEndlessWave } from './endless'
import { isBuildable, tileCenter } from './pathing'
import { newWaveStats } from './telemetry'

export function buildCost(s: GameState, def: TowerDef): number {
  return Math.round(def.cost * s.modifiers.buildCost)
}

export function canPlaceAt(s: GameState, col: number, row: number): boolean {
  // Tiles are integer grid cells. Reject fractional coords (e.g. an agent sending
  // 11.5) so they cannot slip past the strict-equality occupancy checks and create
  // a phantom tower that doesn't block the real integer tile.
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false
  if (!isBuildable(col, row)) return false
  return !s.towers.some((t) => t.col === col && t.row === row)
}

export function tryBuild(s: GameState, defId: string, col: number, row: number): boolean {
  if (s.phase !== 'build' && s.phase !== 'wave') return false
  const def = TOWER_DEFS[defId]
  if (!def) return false
  if (!canPlaceAt(s, col, row)) return false
  // §6.5 hard gate (OQ-G8): a liquid-cooled rack (≥1000 W/GPU) cannot be PLACED
  // without a Liquid Cooling Loop — an air-cooled rack never needs one.
  if (def.kind === 'server' && def.hardwareId && hwNeedsLiquid(HARDWARE_DEFS[def.hardwareId]) && !hasLiquidLoop(s))
    return false
  const cost = buildCost(s, def)
  if (s.meters.cash < cost) return false
  s.meters.cash -= cost
  const c = tileCenter(col, row)
  s.towers.push({
    id: s.nextId++,
    def,
    col,
    row,
    x: c.x,
    y: c.y,
    level: 1,
    online: true,
    throttle: 1,
    cooldown: 0,
    muzzle: 0,
    targetId: null,
    load: 0,
    hwId: def.hardwareId,
    modelId: def.defaultModelId,
  })
  s.events.push({ type: 'place', x: c.x, y: c.y })
  return true
}

/** What selling refunds 60% of: the current rack hardware (models are global research, not goods). */
export function towerValue(s: GameState, t: Tower): number {
  if (t.def.kind !== 'server') return t.def.cost
  const lo = loadoutOf(s, t)
  return lo.hw?.cost ?? t.def.cost
}

export function sellTower(s: GameState, id: number): boolean {
  const i = s.towers.findIndex((t) => t.id === id)
  if (i < 0) return false
  const t = s.towers[i]
  s.meters.cash += Math.round(towerValue(s, t) * 0.6)
  s.events.push({ type: 'sell', x: t.x, y: t.y })
  s.towers.splice(i, 1)
  return true
}

/**
 * Deploy a checkpoint onto a placed rack. Open weights are free — deployment
 * costs nothing — but the rack must fit the model's VRAM and you must have
 * unlocked its architecture METHOD (MoE checkpoints need the MoE research,
 * reasoning checkpoints need the Reasoning research).
 */
export function deployModel(s: GameState, towerId: number, modelId: string): boolean {
  if (s.phase !== 'build' && s.phase !== 'wave') return false
  const t = s.towers.find((x) => x.id === towerId)
  if (!t || t.def.kind !== 'server') return false
  const model = resolveModel(s, modelId) // base OR a derived checkpoint (P3b)
  if (!model || t.modelId === modelId) return false
  if (!s.models[modelId]) return false // not owned (open models are owned from the start)
  if (!methodsUnlocked(s, model)) return false // architecture method not researched yet
  if (!serverFitsMemory(s, loadout(s, t.hwId, modelId))) return false
  t.modelId = modelId
  s.events.push({ type: 'train' })
  return true
}

/** The next rack tier this server can upgrade to in place, if any. */
export function nextHardware(t: Tower): ServerHardwareDef | null {
  if (t.def.kind !== 'server' || !t.hwId) return null
  const i = HARDWARE_TIERS.indexOf(t.hwId)
  if (i < 0 || i >= HARDWARE_TIERS.length - 1) return null
  return HARDWARE_DEFS[HARDWARE_TIERS[i + 1]] ?? null
}

/** Cost to climb one rack tier: the hardware price difference (build-cost incidents apply). */
export function hardwareUpgradeCost(s: GameState, t: Tower): number {
  const next = nextHardware(t)
  const cur = t.hwId ? HARDWARE_DEFS[t.hwId] : null
  if (!next || !cur) return 0
  return Math.round((next.cost - cur.cost) * s.modifiers.buildCost)
}

/** Upgrade a placed rack to the next hardware tier, keeping its model. */
export function upgradeHardware(s: GameState, towerId: number): boolean {
  if (s.phase !== 'build' && s.phase !== 'wave') return false
  const t = s.towers.find((x) => x.id === towerId)
  if (!t) return false
  const next = nextHardware(t)
  if (!next) return false
  // §6.5 hard gate (OQ-G8): cannot upgrade INTO a liquid-cooled tier (pod/superpod/
  // giga) until a Liquid Cooling Loop exists — those racks cannot be cooled otherwise.
  if (hwNeedsLiquid(next) && !hasLiquidLoop(s)) return false
  const cost = hardwareUpgradeCost(s, t)
  if (s.meters.cash < cost) return false
  s.meters.cash -= cost
  t.hwId = next.id
  s.events.push({ type: 'place', x: t.x, y: t.y })
  return true
}

export function buyUpgrade(s: GameState, id: string): boolean {
  const u = UPGRADE_MAP[id]
  if (!u || !hasLab(s)) return false
  const cur = s.upgrades[id] ?? 0
  if (cur >= u.maxLevel) return false
  if (u.requires && !u.requires.every((r) => (s.upgrades[r] ?? 0) > 0)) return false
  if (s.meters.cash < u.cashCost || s.data < u.dataCost) return false
  s.meters.cash -= u.cashCost
  s.data -= u.dataCost
  s.upgrades[id] = cur + 1
  s.events.push({ type: 'train' })
  return true
}

export function startGame(s: GameState): void {
  if (s.phase === 'menu') s.phase = 'build'
}

export function startWave(s: GameState): boolean {
  if (s.phase !== 'build') return false
  if (s.waveActive) return false
  // authored waves cap the campaign; endless mode generates forever
  if (!s.endless && s.waveIndex + 1 >= WAVES.length + 1) return false
  s.waveIndex++
  const w = s.waveIndex < WAVES.length ? WAVES[s.waveIndex] : s.endless ? generateEndlessWave(s) : null
  if (!w) {
    s.waveIndex--
    return false
  }
  s.currentWave = w
  s.phase = 'wave'
  s.waveActive = true
  s.waveTime = 0
  s.waveStats = newWaveStats(s.waveIndex)
  for (const t of s.towers) t.load = 0
  // fold the active incident modifiers into the runtime spawns: `volume` scales the
  // burst count (viral spike / DDoS) and `reward` scales the realised token price
  // and reward (enterprise demo / price war). The lane window + per-group lane pin
  // are honoured in updateSpawns; reset the round-robin counter so each wave's
  // spread (or single-entry surge) is deterministic from its start.
  s.spawns = w.groups.map((g) => ({
    ...g,
    count: Math.max(1, Math.round(g.count * s.modifiers.volume)),
    rewardMul: (g.rewardMul ?? 1) * s.modifiers.reward,
    spawned: 0,
    timer: 0,
    started: false,
  }))
  s.nextLaneId = 0
  s.events.push({ type: 'wave-start', index: s.waveIndex })
  return true
}

/**
 * Cycle a rack's P/D role: auto → prefill → decode → auto (needs the research).
 * Build phase only — re-pinning a pool means draining the rack first, so a
 * mid-wave flip cannot orphan a half-ingested request (control-plane realism).
 */
export function cycleRackRole(s: GameState, towerId: number): boolean {
  if (s.phase !== 'build') return false
  if (!s.infra.disagg) return false
  const t = s.towers.find((x) => x.id === towerId)
  if (!t || t.def.kind !== 'server') return false
  t.role = t.role === undefined ? 'prefill' : t.role === 'prefill' ? 'decode' : undefined
  return true
}

/** Beat the boss, keep serving: flips the run into procedural endless waves. */
export function continueEndless(s: GameState): boolean {
  if (s.phase !== 'won' || s.endless) return false
  s.endless = true
  s.phase = 'build'
  return true
}

export const isLastWave = (s: GameState) => !s.endless && s.waveIndex >= WAVES.length - 1
