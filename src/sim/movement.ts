import type { GameState, Request } from '../core/types'
import { pathLength, posAt } from './pathing'
import { resolveOutcome } from './resolve'

/** Advance requests along the lane and resolve the ones that reach the Trust Core unanswered. */
export function updateMovement(s: GameState, dt: number): void {
  for (const r of s.requests) {
    if (!r.alive) continue
    if (r.hitFlash > 0) r.hitFlash -= dt
    if (r.cacheFlash > 0) r.cacheFlash -= dt
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

/**
 * A request that reaches the core unanswered is a 504 (§2.5). It is `unservable` when a
 * rack in its path rejected it on a hard capacity gate (context window / whole KV budget)
 * and nothing else served it, otherwise a plain `leaked`. A hazardous request that was
 * never answered is NOT a breach: no unsafe text was delivered (resolve.ts prices it).
 */
function leak(s: GameState, r: Request): void {
  resolveOutcome(s, r, r.windowBlocked ? 'unservable' : 'leaked')
}
