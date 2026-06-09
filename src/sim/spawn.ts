import { LANE_SPEED, TILE } from '../config'
import type { GameState, Request } from '../core/types'
import { REQUEST_TYPES } from './content'
import { spawnRiskMult } from './effects'
import { posAt } from './pathing'

export function spawnRequest(s: GameState, typeId: string, workMul = 1, speedMul = 1): Request {
  const def = REQUEST_TYPES[typeId]
  const p = posAt(0)
  const work = def.work * workMul
  const r: Request = {
    id: s.nextId++,
    def,
    dist: 0,
    work,
    maxWork: work,
    speed: def.speed * speedMul * TILE * LANE_SPEED,
    complexity: def.complexity,
    safetyRisk: def.safetyRisk * spawnRiskMult(s),
    reward: def.reward,
    trustPenalty: def.trustPenalty,
    slaPenalty: def.slaPenalty,
    data: def.data,
    bestQuality: -999,
    safetyCleared: def.safetyRisk <= 0,
    routed: false,
    cacheTried: false,
    x: p.x,
    y: p.y,
    hitFlash: 0,
    cacheFlash: 0,
    alive: true,
  }
  s.requests.push(r)
  return r
}

/** Advance the active wave's spawn groups. */
export function updateSpawns(s: GameState, dt: number): void {
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
      spawnRequest(s, g.typeId, g.workMul ?? 1, g.speedMul ?? 1)
      g.spawned++
      g.timer += g.interval
      guard++
    }
  }
}

export function allSpawned(s: GameState): boolean {
  return s.spawns.every((g) => g.spawned >= g.count)
}
