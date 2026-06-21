import { LAT_CLASS_SLO, SIM_TIME_SCALE, TILE } from '../config'
import type { CapabilityAxis, GameState, ModelDef, Request, SafetyHazard, Tower } from '../core/types'
import {
  cacheChance,
  dataMult,
  decodeThrottle,
  guardLatencyMs,
  int4ContextPenalty,
  kvFreeGb,
  kvPerReqGb,
  loadoutOf,
  routeBonus,
  serverContext,
  serverCtxWindowTokens,
  serverPerUserDecodeTokS,
  serverPrefillSpeed,
  serverQualityVs,
  serverSpec,
  serverTargets,
  serveRevenue,
} from './effects'
import {
  ALL_HAZARDS,
  categoryUnlocked,
  effRecall,
  isBenign,
  overRefuse,
  overrefMul,
  pSelfHandle,
  redteamRecallBonus,
  refreshHazardFlags,
} from './safety'
import { remainingPath } from './pathing'
import { recordCacheHit, recordOutcome, recordTtft } from './telemetry'

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
  //     reuse a cached prefix. A hit skips prefill / TTFT, but non-embedding
  //     traffic still decodes and passes normal quality + safety checks.
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

  // --- safety LAYER 2 (§3.3): external guardrail buildings on the request path.
  //     A request passing through a guardrail's range is checked ONCE per guardrail:
  //     covered hazards are caught with probability effRecall (cleared from the open
  //     set); a benign request may be wrongly blocked (over_refused). The check adds
  //     real latency to the SLO — input side → TTFT (queueSec), output side → E2EL
  //     (e2elReal), 'both' → each end once (§0.4). guard_llm's latency is its real
  //     §6 roofline inference time; the encoder's is a fixed 92 ms ([fix M8]).
  const guards = towers
    .filter((t) => t.def.kind === 'guardrail' && t.online && t.def.guardrail)
    .sort((a, b) => a.id - b.id) // stable order → deterministic rng draws
  if (guards.length) {
    const threshold = s.guardrailThreshold
    const recallBonus = redteamRecallBonus(s)
    const orMul = overrefMul(s)
    for (const t of guards) {
      const spec = t.def.guardrail!
      const r2 = rangePx(t) ** 2
      const latSec = guardLatencyMs(s, spec) / 1000
      for (const r of s.requests) {
        if (!r.alive || r.overRefused) continue
        if (r.guardsSeen.has(t.id)) continue
        if (!within(t, r, r2)) continue
        r.guardsSeen.add(t.id)
        // accrue the check latency into the right SLO component (§0.4)
        if (spec.side === 'input' || spec.side === 'both') r.queueSec += latSec
        if (spec.side === 'output' || spec.side === 'both') r.e2elReal += latSec
        if (isBenign(r.hazards)) {
          // a benign request is wrongly blocked with prob overRefuse → over_refused
          if (s.rng.chance(overRefuse(spec.archetype, threshold, orMul))) r.overRefused = true
          continue
        }
        // catch each covered, unlocked hazard with prob effRecall
        const recall = effRecall(spec.baseRecall, threshold, recallBonus)
        for (const h of spec.catches) {
          if (r.hazardsOpen[h] === undefined) continue
          if (!categoryUnlocked(s, h)) continue
          if (s.rng.chance(recall)) delete r.hazardsOpen[h]
        }
        refreshHazardFlags(r)
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
    if (!t.online || t.throttle <= 0 || t.training) {
      // browned out, frozen, or requisitioned for a training run
      t.targetId = null
      t.load = 0
      continue
    }
    const lo = loadoutOf(s, t)
    const r2 = rangePx(t) ** 2
    const spec = serverSpec(lo)
    const cands: Request[] = []
    for (const r of s.requests) {
      if (!r.alive || (r.work <= 0 && r.prefill <= 0)) continue
      if (within(t, r, r2)) cands.push(r)
    }
    if (!cands.length) {
      t.targetId = null
      t.load = 0
      continue
    }
    cands.sort((a, b) => {
      if (routingActive) {
        const ar = a.def.primaryAxis === spec && a.routed ? 1 : 0
        const br = b.def.primaryAxis === spec && b.routed ? 1 : 0
        if (ar !== br) return br - ar
      }
      return remainingPath(a.laneId, a.dist) - remainingPath(b.laneId, b.dist) // closest to the core first
    })

    const n = serverTargets(s, lo)
    // per-axis correctness: the aptitude matrix replaces the old flat +15
    const qBy = {
      chat: serverQualityVs(s, lo, 'chat'),
      coding: serverQualityVs(s, lo, 'coding'),
      reasoning: serverQualityVs(s, lo, 'reasoning'),
      general: serverQualityVs(s, lo, 'general'),
      agentic: serverQualityVs(s, lo, 'agentic'),
    }
    const context = serverContext(s, lo)
    const ctxWindowTokens = serverCtxWindowTokens(s, lo)
    const kvBudget = kvFreeGb(s, lo)
    const cacheBuff = caches.length ? cacheBuffAt(t.x, t.y) : 0
    // dual clock: tokens advance in REAL seconds, board-dt compressed by SIM_TIME_SCALE (§0.4)
    const realDt = dt * SIM_TIME_SCALE
    t.targetId = cands[0].id
    let fired = false
    let servedSlots = 0
    let kvUsed = 0
    let prefillJob: Request | null = null
    const decodeJobs: Request[] = []
    for (const r of cands) {
      if (servedSlots >= n) break
      // PREFIX-CACHE HIT (real prefix caching): the shared prompt prefix is served
      // from cache, so PREFILL is skipped — the first token is instant (TTFT = queue
      // wait) and the rack spends no prefill compute on it. But the response still
      // DECODES on the model: a hit falls through to the normal decode admission below,
      // competing for a decode slot and scored by the usual quality / safety / KV path.
      // So a cache now accelerates TTFT and relieves prefill contention — it is NOT a
      // free, always-correct, always-safe serve. (A miss is rate-limited; another
      // cluster may still hold the prefix.)
      if (cacheBuff > 0 && r.def.cacheable && r.prefill > 0 && r.cacheCd <= 0) {
        if (s.rng.chance(cacheBuff)) {
          r.prefill = 0
          r.prefillDoneAt = s.time
          r.ttftReal = r.queueSec
          r.e2elReal = r.ttftReal
          r.cacheFlash = 0.45
          recordTtft(s, r)
          recordCacheHit(s)
          s.events.push({ type: 'cache', x: r.x, y: r.y })
          if (r.maxWork <= 0) {
            // a pure-prefill request (an embedding) IS fully answered by the cached
            // prefix — there is no decode pass, so it resolves as a clean stored hit.
            r.bestQuality = 999
            r.hazardsOpen = {}
            r.safetyRisk = 0
            r.safetyCleared = true
            continue
          }
          // otherwise fall through: the response still decodes on the model below.
        } else {
          r.cacheCd = 6 // cache miss: next lookup after 6 s
        }
      }
      // safety LAYER 1 (§3.3, 0 latency): the model's INTRINSIC alignment, rolled
      // once the first time a server hits this request. A high-safety model self-
      // handles hazards unaided; an over-aligned model wrongly refuses a benign one.
      if (!r.selfHandled && lo.model) applyLayer1(s, r, lo.model)
      if (r.overRefused) continue // a refused request is not served (resolves as over_refused)
      // hard context window (REAL tokens): a prompt longer than the window is
      // unservable by this loadout — not a worse answer. Latch windowBlocked so a
      // request that only ever meets too-small windows resolves as `unservable`
      // (a distinct outcome) rather than a plain leak (§2.5).
      if (r.contextLen > ctxWindowTokens && ctxWindowTokens > 0) {
        r.windowBlocked = true
        continue
      }
      // KV admission: every in-flight request reserves KV at its CURRENT seqlen;
      // long contexts crowd out concurrency (the first admit is always allowed)
      const kv = lo.model ? kvPerReqGb(s, lo.model, r.contextLen) : 0
      if (servedSlots > 0 && kvUsed + kv > kvBudget) continue
      // P/D disaggregation: a role-pinned rack only takes its phase
      if (t.role === 'decode' && r.prefill > 0) continue
      if (t.role === 'prefill' && r.prefill <= 0) continue
      servedSlots++
      kvUsed += kv
      if (r.prefill > 0) {
        // prompt ingestion is compute-bound and serializes the rack: one
        // prefill at a time; further prefill jobs queue in their slots
        if (!prefillJob) prefillJob = r
        continue
      }
      if (r.work > 0) decodeJobs.push(r)
    }

    // effective batch = admitted decode slots (drives per-user decode rate, §5.7)
    const batch = Math.max(1, decodeJobs.length)
    const perUserDecode = serverPerUserDecodeTokS(s, lo, batch)
    const tpotReal = perUserDecode > 0 ? 1 / perUserDecode : Infinity
    const slo = LAT_CLASS_SLO

    // PREFILL — full compute roof; without Chunked Prefill research this is a
    // real generation stall: every decode on this rack pauses (OSDI'24).
    // Chunking only yields when there are decodes to protect — an idle rack
    // still ingests prompts at full speed.
    const chunked = s.infra.scheduling.chunked
    const prefillShare = prefillJob ? (chunked && decodeJobs.length > 0 ? 0.35 : 1) : 0
    // dedicated pools tune their parallelism for one phase (DistServe)
    const roleMul = t.role === 'prefill' ? 1.5 : t.role === 'decode' ? 1.25 : 1
    if (prefillJob) {
      const prefillRate = serverPrefillSpeed(s, lo, prefillJob.tokensIn)
      prefillJob.prefill -=
        prefillRate * (t.role === 'prefill' ? roleMul : 1) * t.throttle * prefillShare * realDt
      prefillJob.hitFlash = 0.12
      fired = true
      if (prefillJob.prefill <= 0) {
        prefillJob.prefill = 0
        prefillJob.prefillDoneAt = s.time
        // TTFT = queue wait + prefill time (real seconds), latched now (§0.4)
        prefillJob.ttftReal = prefillJob.queueSec
        prefillJob.e2elReal = prefillJob.ttftReal
        const cls = slo[prefillJob.def.latClass]
        // §1.3 per-type TTFT override (comp's strict 200 ms) tightens the class bound.
        const ttftBound = prefillJob.def.ttftSloMs ?? cls.ttftMs
        if (prefillJob.ttftReal * 1000 > ttftBound) prefillJob.sloViolated = true
        // pure-prefill request (embed, OSL 0): there is no decode pass to score it,
        // so judge its quality the moment prefill completes (it IS the answer).
        if (prefillJob.maxWork <= 0) scoreQuality(prefillJob, qBy, context, s)
        recordTtft(s, prefillJob)
      }
    }

    // DECODE — bandwidth roof, batch-friendly, and barely dented by thermal
    // throttling (Splitwise: decode is memory-bound; caps hit prefill).
    const dThr = decodeThrottle(t.throttle)
    const decodeShare = 1 - prefillShare
    if (decodeShare > 0) {
      for (const r of decodeJobs) {
        const match = r.def.primaryAxis === spec
        let mul = match ? 1.6 : spec === 'general' ? 1.0 : 0.65
        if (match && r.routed && routingActive) mul *= routingMul
        const before = r.work
        r.work -=
          perUserDecode * (t.role === 'decode' ? roleMul : 1) * dThr * decodeShare * mul * realDt
        const generated = Math.max(0, before - r.work)
        // KV grows as output tokens are produced (§5.6/H1)
        r.contextLen += generated
        // accumulate real end-to-end latency at the per-token rate (§0.4)
        r.e2elReal += generated * tpotReal
        // SLO: per-token rate must meet the class TPOT bound
        const cls = slo[r.def.latClass]
        if (tpotReal * 1000 > cls.tpotMs) r.sloViolated = true
        // §1.3 per-type E2EL override (agent's 9 s end-to-end bound) on the running total.
        if (r.def.e2elSloMs !== undefined && r.e2elReal * 1000 > r.def.e2elSloMs) r.sloViolated = true
        r.hitFlash = 0.12
        scoreQuality(r, qBy, context, s)
        fired = true
      }
    }
    t.load = n > 0 ? Math.min(1, servedSlots / n) : 0
    if (fired && t.cooldown <= 0) {
      const tgt = cands[0]
      s.events.push({ type: 'fire', fx: { x: t.x, y: t.y }, tx: tgt.x, ty: tgt.y, color: t.def.color })
      t.cooldown = 0.09
      t.muzzle = 0.12
    }
  }

  // --- real-seconds TTFT accumulation (§0.4): a request still in prefill that
  //     is within range of an online server is "in the serving queue" — its
  //     real wall time (queue contention + active prefill) counts toward TTFT.
  //     Lane transit before reaching any server is board-only and excluded.
  const realDt = dt * SIM_TIME_SCALE
  const servers = towers.filter((t) => t.def.kind === 'server' && t.online && t.throttle > 0 && !t.training)
  for (const r of s.requests) {
    if (!r.alive || r.prefill <= 0 || r.prefillDoneAt !== undefined) continue
    for (const t of servers) {
      if (within(t, r, rangePx(t) ** 2)) {
        r.queueSec += realDt
        break
      }
    }
  }

  // --- resolve fully served requests (prefilled AND decoded), or refused ones ---
  for (const r of s.requests) {
    if (!r.alive) continue
    // an over-refused request (§3.6) is never served — resolve it the moment it is
    // wrongly blocked (revenue 0, light Trust hit), not when it eventually leaks.
    if (r.overRefused) {
      resolveOverRefused(s, r)
      continue
    }
    if (r.work > 0 || r.prefill > 0) continue
    // A request whose work is done but still carries an OPEN hazard is HELD pending
    // safety review: it keeps flowing (at work 0) until a guardrail clears it
    // (→ served) or it leaks at the core (→ unsafe breach). This is why a guardrail
    // must sit before the core.
    if (r.safetyRisk > 0 && !r.safetyCleared) continue
    resolveServe(s, r)
  }
}

/**
 * §3.3 safety LAYER 1 — the model's intrinsic (baked) alignment, consumed at serve
 * time with ZERO latency (§3.7). Rolled ONCE per request the first time a server
 * works it (selfHandled latches so a second rack does not re-roll).
 *   - benign request: wrongly refused with P = model.alignment.overRefusal → over_refused.
 *   - hazardous request: each open hazard is self-handled (cleared) with
 *     P = pSelfHandle(model, hazard, severity). A safe-completion / high-safety model
 *     clears most jailbreaks unaided; a base model (safety ~20) lets them through.
 * Probabilistic via s.rng (deterministic-friendly so replays match, OQ-G15).
 */
function applyLayer1(s: GameState, r: Request, model: ModelDef): void {
  r.selfHandled = true
  if (isBenign(r.hazards)) {
    if (s.rng.chance(model.alignment.overRefusal)) r.overRefused = true
    return
  }
  for (const h of ALL_HAZARDS) {
    const sev = r.hazardsOpen[h]
    if (sev === undefined) continue
    if (s.rng.chance(pSelfHandle(model, h, sev))) delete r.hazardsOpen[h as SafetyHazard]
  }
  refreshHazardFlags(r)
}

/**
 * §6.4/R8 quality gate: the effective quality on a request's PRIMARY axis, less
 * the context-window-stretch penalty and the INT4 long-context tax, vs the
 * request's resolved per-axis difficulty. The best margin any server hit it with
 * is latched on `bestQuality` (≥0 = a correct answer; <0 = a bad one).
 *
 * `effQ = qBy[primaryAxis] − contextGap×0.45 − int4pen; margin = effQ − difficulty`
 * — equivalent to the old gate, with `difficulty[primaryAxis]` standing in for the
 * retired scalar `complexity` ([fix M2]) and the contextGap term unchanged.
 */
function scoreQuality(
  r: Request,
  qBy: Record<CapabilityAxis, number>,
  serverCtx: number,
  s: GameState,
): void {
  const contextGap = Math.max(0, r.context - serverCtx)
  const effQ = qBy[r.def.primaryAxis] - contextGap * 0.45 - int4ContextPenalty(s, r.contextLen)
  const margin = effQ - r.difficulty
  if (margin > r.bestQuality) r.bestQuality = margin
}

function clamp100(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v
}

/**
 * Token-priced income for a clean serve (§6.6): the real $/Mtoken revenue on the
 * request's actual input+output tokens, in credits. This REPLACES the old flat
 * `reward` points (which now survives only for endless-scaling math).
 */
function cleanRevenue(s: GameState, r: Request): number {
  return serveRevenue(s, r.tokensIn, r.tokensOut, r.pricePerMtokIn, r.pricePerMtokOut)
}

/**
 * §3.6/§2.5 resolve a benign request wrongly refused by the model (layer 1) or a
 * guardrail (layer 2): the `over_refused` outcome. Revenue 0 (you served nothing),
 * an SLA-meter hit, and a LIGHT Trust hit ([fix H5] — over-refusing real users
 * hurts your reputation, so safe-completion's low over-refusal is worth preferring),
 * but it is NOT a breach. Excluded from served / Goodput.
 */
function resolveOverRefused(s: GameState, r: Request): void {
  r.alive = false
  s.meters.sla = clamp100(s.meters.sla - r.slaPenalty * 0.5)
  s.meters.trust = clamp100(s.meters.trust - r.trustPenalty * 0.25)
  s.stats.overRefused++
  recordOutcome(s, r, 'overRefused', 0)
  s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'over_refused', amount: 0 })
}

/**
 * Resolve a fully-served (prefilled AND decoded) request into one of the outcomes
 * (R9 / §2.5). Precedence (worst first, documented in the blueprint):
 *   unsafe > bad > slo_miss > served
 * Rationale: an unsafe or wrong answer harms more than a merely late one, so they
 * take priority over the SLO branch — slo_miss is ONLY reached by a correct, safe,
 * but late answer. (`unservable`/`leaked`/`over_refused` are decided elsewhere.)
 */
function resolveServe(s: GameState, r: Request): void {
  r.alive = false
  if (r.safetyRisk > 0 && !r.safetyCleared) {
    // unsafe: we answered a request whose hazard was never cleared (§3.4 breach).
    const dmg = r.trustPenalty * s.modifiers.safetyDamage
    s.meters.trust = clamp100(s.meters.trust - dmg)
    s.stats.unsafe++
    recordOutcome(s, r, 'unsafe', 0)
    s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'unsafe', amount: 0 })
    return
  }
  if (r.bestQuality < 0) {
    // bad: model too weak — the request was computed and billed (token revenue),
    // but the answer is wrong, so it costs Trust.
    const pay = cleanRevenue(s, r)
    s.meters.cash += pay
    s.stats.cashEarned += pay
    s.data += r.data * dataMult(s)
    s.meters.trust = clamp100(s.meters.trust - r.trustPenalty * 0.5)
    s.stats.bad++
    recordOutcome(s, r, 'bad', pay)
    s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'bad', amount: Math.round(pay) })
    return
  }
  if (r.sloViolated) {
    // slo_miss: correct, safe, but LATE — HARDCORE: zero cash (you missed the SLA),
    // an SLA-meter penalty, and excluded from Goodput. It still consumed compute
    // (the operating bill already charged it) and counts as "answered" (§2.5).
    s.meters.sla = clamp100(s.meters.sla - r.slaPenalty * 0.5)
    s.meters.trust = clamp100(s.meters.trust - r.trustPenalty * 0.25)
    s.stats.sloMiss++
    recordOutcome(s, r, 'sloMiss', 0)
    s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'bad', amount: 0 })
    return
  }
  // served: correct, safe, within SLO — the full token-priced revenue.
  const pay = cleanRevenue(s, r)
  s.meters.cash += pay
  s.stats.cashEarned += pay
  s.data += r.data * dataMult(s)
  s.meters.trust = clamp100(s.meters.trust + 0.25)
  s.meters.sla = clamp100(s.meters.sla + 0.15)
  s.stats.served++
  recordOutcome(s, r, 'served', pay)
  s.events.push({ type: 'serve', x: r.x, y: r.y, kind: 'good', amount: Math.round(pay) })
}
