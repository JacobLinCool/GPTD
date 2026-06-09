import type { GameState, Request } from '../core/types'
import { unsafePenaltyMult } from './effects'
import { PATH_LENGTH, posAt } from './pathing'

function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v
}

/** Advance requests along the lane and handle leaks into the Trust Core. */
export function updateMovement(s: GameState, dt: number): void {
  for (const r of s.requests) {
    if (!r.alive) continue
    if (r.hitFlash > 0) r.hitFlash -= dt
    if (r.cacheFlash > 0) r.cacheFlash -= dt
    r.dist += r.speed * dt
    if (r.dist >= PATH_LENGTH) {
      leak(s, r)
      continue
    }
    const p = posAt(r.dist)
    r.x = p.x
    r.y = p.y
  }
}

function leak(s: GameState, r: Request): void {
  r.alive = false
  const unsafe = r.safetyRisk > 0 && !r.safetyCleared
  s.meters.sla = clamp100(s.meters.sla - r.slaPenalty)
  const trustHit = unsafe ? r.trustPenalty * s.modifiers.safetyDamage * unsafePenaltyMult(s) : r.trustPenalty
  s.meters.trust = clamp100(s.meters.trust - trustHit)
  if (unsafe) s.stats.unsafe++
  else s.stats.leaked++
  s.events.push({ type: 'leak', x: r.x, y: r.y, unsafe })
}
