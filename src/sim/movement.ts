import type { GameState, Request } from '../core/types'
import { pathLength, posAt } from './pathing'
import { recordOutcome } from './telemetry'

function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v
}

/** Advance requests along the lane and handle leaks into the Trust Core. */
export function updateMovement(s: GameState, dt: number): void {
  for (const r of s.requests) {
    if (!r.alive) continue
    if (r.hitFlash > 0) r.hitFlash -= dt
    if (r.cacheFlash > 0) r.cacheFlash -= dt
    if (r.cacheCd > 0) r.cacheCd -= dt
    // NOTE: real-seconds latency (queue + prefill wall time) is accumulated in
    // combat where server range is known — lane transit is board-only (§0.4),
    // it must NOT inflate real TTFT.
    r.dist += r.speed * dt
    if (r.dist >= pathLength(r.laneId)) {
      leak(s, r)
      continue
    }
    const p = posAt(r.dist, r.laneId)
    r.x = p.x
    r.y = p.y
  }
}

function leak(s: GameState, r: Request): void {
  r.alive = false
  const unsafe = r.safetyRisk > 0 && !r.safetyCleared
  // unservable (§2.5): a request that was REJECTED on the hard context-window gate
  // and never served — a distinct outcome from a plain capacity leak. (A safety
  // breach still takes priority: an unsafe leak is unsafe, not merely unservable.)
  const unservable = !unsafe && r.windowBlocked && r.work > 0
  s.meters.sla = clamp100(s.meters.sla - r.slaPenalty)
  const trustHit = unsafe ? r.trustPenalty * s.modifiers.safetyDamage : r.trustPenalty
  s.meters.trust = clamp100(s.meters.trust - trustHit)
  if (unsafe) s.stats.unsafe++
  else if (unservable) s.stats.unservable++
  else s.stats.leaked++
  recordOutcome(s, r, unsafe ? 'unsafe' : unservable ? 'unservable' : 'leaked', 0)
  s.events.push({ type: 'leak', x: r.x, y: r.y, unsafe })
}
