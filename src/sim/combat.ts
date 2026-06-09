import { TILE } from '../config'
import type { GameState, Request, Tower } from '../core/types'
import {
  cacheChance,
  dataMult,
  routeBonus,
  safetyRate,
  serverQuality,
  serverSpeed,
  serverTargets,
  unsafePenaltyMult,
} from './effects'

const rangePx = (t: Tower) => t.def.range * TILE
function within(t: Tower, r: Request, r2: number): boolean {
  const dx = t.x - r.x
  const dy = t.y - r.y
  return dx * dx + dy * dy <= r2
}

/**
 * The core combat tick: routing tags, cache hits, safety clears, and server
 * processing, followed by resolving every fully-served request.
 */
export function updateCombat(s: GameState, dt: number): void {
  const towers = s.towers
  const routers = towers.filter((t) => t.def.kind === 'router' && t.online)
  s.routingPower = routers.reduce((n, t) => n + routeBonus(s, t.def), 0)

  // --- routing: tag requests inside an online router's range ---
  for (const r of s.requests) {
    if (!r.alive) continue
    r.routed = false
    if (!routers.length) continue
    for (const rt of routers) {
      if (within(rt, r, rangePx(rt) ** 2)) {
        r.routed = true
        break
      }
    }
  }

  // --- cache aura: a Cache buffs Serving Towers in its range with a chance to
  //     instantly answer a cacheable request (a cache hit returns a stored answer).
  //     The cache does nothing on its own — it must overlap a server. ---
  const caches = towers
    .filter((t) => t.def.kind === 'cache' && t.online)
    .map((t) => ({ x: t.x, y: t.y, r2: rangePx(t) ** 2, chance: cacheChance(s, t.def) }))
  const cacheBuffAt = (x: number, y: number): number => {
    let miss = 1
    for (const c of caches) {
      const dx = c.x - x
      const dy = c.y - y
      if (dx * dx + dy * dy <= c.r2) miss *= 1 - c.chance
    }
    return 1 - miss
  }

  // --- safety: bleed off safety risk for requests passing through ---
  for (const t of towers) {
    if (t.def.kind !== 'safety' || !t.online) continue
    const r2 = rangePx(t) ** 2
    const rate = safetyRate(s, t.def)
    for (const r of s.requests) {
      if (!r.alive || r.safetyCleared || r.safetyRisk <= 0) continue
      if (!within(t, r, r2)) continue
      r.safetyRisk -= rate * dt
      if (r.safetyRisk <= 0) {
        r.safetyRisk = 0
        r.safetyCleared = true
      }
    }
  }

  // --- servers: process requests in range ---
  const routingActive = s.routingPower > 0
  const routingMul = 1 + Math.min(0.9, s.routingPower)
  for (const t of towers) {
    if (t.def.kind !== 'server') continue
    if (t.muzzle > 0) t.muzzle -= dt
    if (t.cooldown > 0) t.cooldown -= dt
    if (!t.online || t.throttle <= 0) {
      t.targetId = null
      continue
    }
    const r2 = rangePx(t) ** 2
    const spec = t.def.spec
    const cands: Request[] = []
    for (const r of s.requests) {
      if (!r.alive || r.work <= 0) continue
      if (within(t, r, r2)) cands.push(r)
    }
    if (!cands.length) {
      t.targetId = null
      continue
    }
    cands.sort((a, b) => {
      if (routingActive) {
        const ar = a.def.affinity === spec && a.routed ? 1 : 0
        const br = b.def.affinity === spec && b.routed ? 1 : 0
        if (ar !== br) return br - ar
      }
      return b.dist - a.dist // closest to the core first
    })

    const n = serverTargets(s, t.def)
    const speed = serverSpeed(s, t.def)
    const q = serverQuality(s, t.def)
    const cacheBuff = caches.length ? cacheBuffAt(t.x, t.y) : 0
    t.targetId = cands[0].id
    let fired = false
    for (let i = 0; i < n && i < cands.length; i++) {
      const r = cands[i]
      // cache hit: this server is in a Cache aura and instantly serves a cacheable request
      if (cacheBuff > 0 && r.def.cacheable && !r.cacheTried) {
        r.cacheTried = true
        if (s.rng.chance(cacheBuff)) {
          r.work = 0
          r.bestQuality = 999
          r.safetyCleared = true
          r.cacheFlash = 0.45
          s.events.push({ type: 'cache', x: r.x, y: r.y })
          continue
        }
      }
      const match = r.def.affinity === spec
      let mul = match ? 1.6 : spec === 'general' ? 1.0 : 0.65
      if (match && r.routed && routingActive) mul *= routingMul
      const compute = speed * t.throttle * mul * dt
      r.work -= compute
      r.hitFlash = 0.12
      const effQ = q + (match ? 15 : 0)
      const margin = effQ - r.complexity
      if (margin > r.bestQuality) r.bestQuality = margin
      fired = true
    }
    if (fired && t.cooldown <= 0) {
      const tgt = cands[0]
      s.events.push({ type: 'fire', fx: { x: t.x, y: t.y }, tx: tgt.x, ty: tgt.y, color: t.def.color })
      t.cooldown = 0.09
      t.muzzle = 0.12
    }
  }

  // --- resolve fully served requests ---
  for (const r of s.requests) {
    if (!r.alive || r.work > 0) continue
    // A risky request whose work is done is HELD pending safety review: it keeps
    // flowing (at work 0) until a Safety Gate clears it (→ served) or it leaks at
    // the core (→ breach). This is why a Safety Gate must sit before the core.
    if (r.safetyRisk > 0 && !r.safetyCleared) continue
    resolveServe(s, r)
  }
}

function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v
}

function resolveServe(s: GameState, r: Request): void {
  r.alive = false
  if (r.safetyRisk > 0 && !r.safetyCleared) {
    // We answered an unsafe request.
    const dmg = r.trustPenalty * s.modifiers.safetyDamage * unsafePenaltyMult(s)
    s.meters.trust = clamp100(s.meters.trust - dmg)
    s.stats.unsafe++
    s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'unsafe', amount: 0 })
    return
  }
  if (r.bestQuality < 0) {
    // Model too weak — a bad answer.
    s.meters.trust = clamp100(s.meters.trust - r.trustPenalty * 0.5)
    s.stats.bad++
    s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'bad', amount: 0 })
    return
  }
  // Clean success.
  const pay = Math.round(r.reward * s.modifiers.reward)
  s.meters.cash += pay
  s.stats.cashEarned += pay
  s.data += r.data * dataMult(s)
  s.meters.trust = clamp100(s.meters.trust + 0.25)
  s.meters.sla = clamp100(s.meters.sla + 0.15)
  s.stats.served++
  s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'good', amount: pay })
}
