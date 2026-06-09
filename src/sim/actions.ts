import type { GameState, TowerDef } from '../core/types'
import { TOWER_DEFS, UPGRADE_MAP, WAVES } from './content'
import { hasLab } from './effects'
import { isBuildable, tileCenter } from './pathing'

export function buildCost(s: GameState, def: TowerDef): number {
  return Math.round(def.cost * s.modifiers.buildCost)
}

export function canPlaceAt(s: GameState, col: number, row: number): boolean {
  if (!isBuildable(col, row)) return false
  return !s.towers.some((t) => t.col === col && t.row === row)
}

export function tryBuild(s: GameState, defId: string, col: number, row: number): boolean {
  if (s.phase !== 'build' && s.phase !== 'wave') return false
  const def = TOWER_DEFS[defId]
  if (!def) return false
  if (!canPlaceAt(s, col, row)) return false
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
  })
  s.events.push({ type: 'place', x: c.x, y: c.y })
  return true
}

export function sellTower(s: GameState, id: number): boolean {
  const i = s.towers.findIndex((t) => t.id === id)
  if (i < 0) return false
  const t = s.towers[i]
  s.meters.cash += Math.round(t.def.cost * 0.6)
  s.events.push({ type: 'sell', x: t.x, y: t.y })
  s.towers.splice(i, 1)
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
  if (s.waveIndex + 1 >= WAVES.length) {
    // already on/after the last wave
    if (s.waveIndex + 1 > WAVES.length - 1) return false
  }
  s.waveIndex++
  const w = WAVES[s.waveIndex]
  if (!w) {
    s.waveIndex--
    return false
  }
  s.phase = 'wave'
  s.waveActive = true
  s.waveTime = 0
  s.spawns = w.groups.map((g) => ({
    ...g,
    count: Math.max(1, Math.round(g.count * s.modifiers.volume)),
    spawned: 0,
    timer: 0,
    started: false,
  }))
  s.events.push({ type: 'wave-start', index: s.waveIndex })
  return true
}

export const isLastWave = (s: GameState) => s.waveIndex >= WAVES.length - 1
