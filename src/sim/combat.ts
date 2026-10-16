import { LAT_CLASS_SLO, SIM_TIME_SCALE, TILE } from '../config'
import type { CapabilityAxis, GameState, ModelDef, Request, SloCause, Tower } from '../core/types'
import {
  cacheChance,
  decodeThrottle,
  int4ContextPenalty,
  kvFreeGb,
  kvPerReqGb,
  type Loadout,
  loadoutOf,
  prefixHitChance,
  routeBonus,
  serverContext,
  serverCtxWindowTokens,
  serverPerUserDecodeTokS,
  serverPrefillSpeed,
  serverQualityVs,
  serverTargets,
  towerRangeTiles,
} from './effects'
import { laneGuardStages, type LaneGuardStage, screenInput, screenOutput } from './guards'
import { remainingPath } from './pathing'
import { resolveOutcome } from './resolve'
import {
  ALL_HAZARDS,
  HANDLED_ATTACK_TOKENS,
  isBenign,
  modelOverRefusal,
  pSelfHandle,
  refreshHazardFlags,
} from './safety'
import { recordCacheHit, recordSelfHandle, recordTtft } from './telemetry'

/** Chunked prefill (Sarathi-Serve): while decodes are running, a prefill takes at most this share of the rack's time. */
const CHUNKED_PREFILL_SHARE = 0.35
/** P/D disaggregation (DistServe): a dedicated pool tunes its parallelism for its one phase. */
const PREFILL_POOL_MUL = 1.5
const DECODE_POOL_MUL = 1.25

const rangePx = (t: Tower): number => towerRangeTiles(t) * TILE
function within(t: Tower, r: Request, r2: number): boolean {
  const dx = t.x - r.x
  const dy = t.y - r.y
  return dx * dx + dy * dy <= r2
}

interface CacheAura {
  x: number
  y: number
  r2: number
  chance: number
}

/**
 * One serving rack's view for this tick (online, not throttled to zero, not training, a
 * model that fits). Everything beyond its reach and slot count is computed the first
 * time a request in range needs it — most racks are idle on most ticks.
 */
class Host {
  readonly model: ModelDef
  readonly r2: number
  /** concurrent batch slots the scheduler offers. */
  readonly slots: number
  private windowCache = -1
  private kvBudgetCache = -1
  private contextCache = -1
  private qByCache: Partial<Record<CapabilityAxis, number>> | null = null
  private tpotCache = -1
  private cacheBestCache = -1

  constructor(
    private readonly s: GameState,
    readonly t: Tower,
    readonly lo: Loadout,
    slots: number,
    private readonly caches: () => CacheAura[],
  ) {
    this.model = lo.model!
    this.r2 = rangePx(t) ** 2
    this.slots = slots
  }

  /** hard context window in real tokens. */
  get window(): number {
    if (this.windowCache < 0) this.windowCache = serverCtxWindowTokens(this.s, this.lo)
    return this.windowCache
  }

  /** usable KV memory (GB). */
  get kvBudget(): number {
    if (this.kvBudgetCache < 0) this.kvBudgetCache = kvFreeGb(this.s, this.lo)
    return this.kvBudgetCache
  }

  /** long-context capability score (the contextGap term). */
  get context(): number {
    if (this.contextCache < 0) this.contextCache = serverContext(this.s, this.lo)
    return this.contextCache
  }

  /** effective quality on one axis (qualityBy − INT4 tax − alignment tax). */
  q(axis: CapabilityAxis): number {
    const cache = (this.qByCache ??= {})
    return (cache[axis] ??= serverQualityVs(this.s, this.lo, axis))
  }

  /** real seconds per token of one stream at batch 1, throttle applied (the dispatch tie-break). */
  get tpot1(): number {
    if (this.tpotCache < 0) {
      const perUser1 = serverPerUserDecodeTokS(this.s, this.lo, 1) * decodeThrottle(this.t.throttle)
      this.tpotCache = perUser1 > 0 ? 1 / perUser1 : Infinity
    }
    return this.tpotCache
  }

  /** best covering cache's hit chance — overlapping caches combine as the best one (0 = no aura). */
  get cacheBest(): number {
    if (this.cacheBestCache < 0) {
      let best = 0
      for (const c of this.caches()) {
        const dx = c.x - this.t.x
        const dy = c.y - this.t.y
        if (dx * dx + dy * dy <= c.r2 && c.chance > best) best = c.chance
      }
      this.cacheBestCache = best
    }
    return this.cacheBestCache
  }
}

function servingHosts(s: GameState): Host[] {
  let auras: CacheAura[] | null = null
  const caches = (): CacheAura[] =>
    (auras ??= s.towers
      .filter((t) => t.def.kind === 'cache' && t.online)
      .map((t) => ({ x: t.x, y: t.y, r2: rangePx(t) ** 2, chance: cacheChance(s, t.def) })))
  const hosts: Host[] = []
  for (const t of s.towers) {
    if (t.def.kind !== 'server' || !t.online || t.throttle <= 0 || t.training) continue
    const lo = loadoutOf(s, t)
    const slots = serverTargets(s, lo)
    if (!lo.model || slots <= 0) continue
    hosts.push(new Host(s, t, lo, slots, caches))
  }
  return hosts
}

/**
 * Could this rack ever take the request in its current phase? The P/D role must match,
 * the prompt must fit the model window, and its KV must fit the rack's whole KV budget.
 * (A full rack or a KV budget busy with other requests is honest queueing — still a host.)
 */
function canHost(s: GameState, h: Host, r: Request): boolean {
  if (r.prefill > 0 ? h.t.role === 'decode' : h.t.role === 'prefill') return false
  if (h.window > 0 && r.contextLen > h.window) return false
  return kvPerReqGb(s, h.model, r.contextLen) <= h.kvBudget
}

/** §6.4 the answer-quality margin this rack would give the request: effQ on its judged axis − difficulty. */
function marginOn(s: GameState, h: Host, r: Request): number {
  const contextGap = Math.max(0, r.context - h.context)
  return h.q(r.def.primaryAxis) - contextGap * 0.45 - int4ContextPenalty(s, r.contextLen) - r.difficulty
}

function violate(r: Request, cause: SloCause): void {
  if (r.sloViolated) return
  r.sloViolated = true
  r.sloCause = cause
}

/** §1.3 a per-type end-to-end bound (agent's 9 s), on the running total plus the output-guard tail. */
function checkE2el(r: Request): void {
  if (r.def.e2elSloMs !== undefined && (r.e2elReal + r.guardOutSec) * 1000 > r.def.e2elSloMs)
    violate(r, 'e2el')
}

/**
 * The core combat tick (§0.2 serving spine):
 *   1. routers tag the requests in range; caches give each rack its best hit chance;
 *   2. FIRST HARDWARE CONTACT — a request in range of a rack that could prefill it starts
 *      its TTFT clock, and is screened once by the guardrails covering its lane;
 *   3. Router dispatch reserves each routed request for its best-fit rack;
 *   4. every rack admits, prefills and decodes;
 *   5. finished requests are screened on output and resolved into an outcome.
 */
export function updateCombat(s: GameState, dt: number): void {
  // dual clock: tokens advance in REAL seconds, board-dt compressed by SIM_TIME_SCALE (§0.4)
  const realDt = dt * SIM_TIME_SCALE
  const routers = s.towers.filter((t) => t.def.kind === 'router' && t.online)
  s.routingPower = routers.reduce((n, t) => n + routeBonus(s, t.def), 0)
  const routerR2 = routers.map((rt) => rangePx(rt) ** 2)
  for (const r of s.requests) {
    if (!r.alive) continue
    let routed = false
    for (let i = 0; i < routers.length && !routed; i++) routed = within(routers[i], r, routerR2[i])
    r.routed = routed
    r.routedTo = null
  }

  for (const t of s.towers) {
    if (t.def.kind !== 'server') continue
    // reset the display state; a serving rack rewrites it below (a browned-out, frozen,
    // requisitioned or model-less rack stays dark this tick)
    clearRackDisplay(t)
  }
  const hosts = servingHosts(s)

  // --- first hardware contact: TTFT eligibility + one guardrail screening per request ---
  // the per-lane guard stages, built the first time a request is screened this tick
  let stages: LaneGuardStage[][] | null = null
  const stagesOf = (laneId: number): LaneGuardStage[] => (stages ??= laneGuardStages(s))[laneId] ?? []
  const waiting: Request[] = []
  for (const r of s.requests) {
    if (!r.alive || r.overRefused) continue
    // already screened and past its first token: nothing left to decide here
    if (r.screened && r.prefillDoneAt !== undefined) continue
    let contact = false
    for (const h of hosts) {
      if (within(h.t, r, h.r2) && canHost(s, h, r)) {
        contact = true
        break
      }
    }
    if (!contact) continue
    if (r.prefillDoneAt === undefined && r.prefill > 0) waiting.push(r)
    if (r.screened) continue
    screenInput(s, r, stagesOf(r.laneId))
    if (r.overRefused) {
      resolveOutcome(s, r, 'overRefused', { refusedBy: 'guard' })
    } else if (r.def.adversarial && r.safetyCleared) {
      // an input guard blocked the attack before any rack computed it
      r.attackHandled = true
      resolveOutcome(s, r, 'served')
    }
  }

  if (routers.length) dispatch(s, hosts)

  const generated = new Map<number, number>()
  const stalled = new Set<Request>()
  for (const h of hosts) serveRack(s, h, realDt, generated, stalled)

  // a decode that held a slot but got no token anywhere this tick waited out a whole prefill
  for (const r of stalled) {
    if (!r.alive || generated.has(r.id)) continue
    r.e2elReal += realDt
    r.decodeSec += realDt
    checkE2el(r)
  }

  // §0.4 queue wait: a request still waiting for its first token at an eligible rack
  for (const r of waiting) if (r.alive && r.prefillDoneAt === undefined) r.queueSec += realDt

  // --- resolve: refusals now, finished answers after their output screening ---
  for (const r of s.requests) {
    if (!r.alive) continue
    if (r.overRefused) {
      resolveOutcome(s, r, 'overRefused', { refusedBy: r.refusedBy ?? 'model' })
      continue
    }
    if (r.work > 0 || r.prefill > 0) continue
    deliver(s, r, stagesOf(r.laneId))
  }
}

function clearRackDisplay(t: Tower): void {
  t.load = 0
  t.prefillId = null
  t.kvFrac = 0
  t.batch = 0
  if (t.decodeIds) t.decodeIds.length = 0
}

/**
 * §4.10 Router = capability-aware dispatch (RouteLLM / model gateways): every request in
 * a router's range is reserved for the in-range rack with a free slot whose model gives
 * it the best quality margin (ties → the lower TPOT), so a strong rack is not spent on
 * chats nearest the core while weak racks answer the hard requests wrong. A request no
 * rack in range can take stays unreserved (any rack may serve it) — routing never strands
 * traffic. Without a router, racks serve the requests nearest the core first.
 */
function dispatch(s: GameState, hosts: Host[]): void {
  const load = new Map<Host, number>()
  const routed = s.requests
    .filter((r) => r.alive && r.routed && !r.overRefused && (r.work > 0 || r.prefill > 0))
    .sort((a, b) => remainingPath(a.laneId, a.dist) - remainingPath(b.laneId, b.dist) || a.id - b.id)
  for (const r of routed) {
    let best: Host | null = null
    let bestMargin = -Infinity
    for (const h of hosts) {
      if ((load.get(h) ?? 0) >= h.slots) continue
      if (!within(h.t, r, h.r2) || !canHost(s, h, r)) continue
      const m = marginOn(s, h, r)
      if (!best || m > bestMargin + 1e-9 || (Math.abs(m - bestMargin) <= 1e-9 && h.tpot1 < best.tpot1)) {
        best = h
        bestMargin = m
      }
    }
    if (!best) continue
    r.routedTo = best.t.id
    load.set(best, (load.get(best) ?? 0) + 1)
  }
}

/**
 * The request's one prefix-cache lookup (§4.2), rolled when a rack under a cache aura
 * admits it: a hit serves the shared prefix (`prefixShare` of the prompt) from cache and
 * only the unique suffix still prefills. A request's prefix is resident or it is not, so
 * the lookup is never re-rolled.
 */
function lookupPrefix(s: GameState, r: Request, h: Host): void {
  r.cacheLooked = true
  if (!s.rng.chance(prefixHitChance(s, h.cacheBest, r.routed))) return
  const shared = Math.round(r.tokensIn * r.def.prefixShare)
  const remaining = Math.min(r.prefill, Math.max(0, r.tokensIn - shared))
  if (remaining >= r.prefill) return // already ingested past the shared prefix: nothing to reuse
  r.cachedTokens = r.prefill - remaining
  r.prefill = remaining
  recordCacheHit(s)
  s.events.push({ type: 'cache', x: r.x, y: r.y, towerId: h.t.id, requestId: r.id })
}

/** Credit generated tokens to the rack that produced them; `answeredBy` is the largest contributor. */
function credit(r: Request, t: Tower, gen: number): void {
  const mine = (r.tokBy[t.id] ?? 0) + gen
  r.tokBy[t.id] = mine
  if (r.answeredBy === undefined || r.answeredBy === t.id || mine > (r.tokBy[r.answeredBy] ?? 0)) {
    r.answeredBy = t.id
    r.answeredModelId = t.modelId
  }
}

/**
 * §6.4/R8 quality gate, TOKEN-WEIGHTED: each rack scores the tokens it generated with
 * its own margin (effQ = qBy[primaryAxis] − contextGap×0.45 − INT4 long-context tax,
 * minus the request's difficulty), and the answer's margin is the weighted mean — the
 * models that wrote the answer decide its quality, not the best model that touched it.
 */
function scoreQuality(s: GameState, r: Request, h: Host, tokens: number): void {
  if (tokens <= 0) return
  const margin = marginOn(s, h, r)
  r.qualTokSum += margin * tokens
  r.qualTokW += tokens
  r.bestQuality = r.qualTokSum / r.qualTokW
}

/**
 * The first output token exists (prefill done on this rack, or a prefix-cache hit covered
 * it): latch TTFT = queue wait + the prefill's wall time this tick + input guards (§0.4),
 * judge the TTFT bound, then roll layer 1 with the model that produced the token.
 */
function firstToken(s: GameState, r: Request, h: Host, tDone: number): void {
  r.prefill = 0
  r.prefillDoneAt = s.time
  r.ttftReal = r.queueSec + tDone + r.guardInSec
  r.e2elReal = r.ttftReal
  // §1.3 a per-type TTFT override (comp's strict 200 ms) tightens the class bound
  const ttftBound = r.def.ttftSloMs ?? LAT_CLASS_SLO[r.def.latClass].ttftMs
  if (r.ttftReal * 1000 > ttftBound) violate(r, 'ttft')
  recordTtft(s, r)
  if (r.maxWork <= 0) {
    // a pure-prefill request (an embedding): the prefill IS the answer, and there is
    // no generated text for alignment to refuse — score it on the rack that finished it
    credit(r, h.t, 0)
    scoreQuality(s, r, h, 1)
    return
  }
  if (!r.selfHandled) applyLayer1(s, r, h)
}

/**
 * §3.3 safety LAYER 1 — the model's intrinsic alignment, rolled ONCE, at the first output
 * token, by the model that produced it (safety alignment acts mostly through the first
 * output tokens; a rack that never admitted the request cannot refuse or sanitize it).
 *   - benign: wrongly refused with P = overRefusal × the archetype's refusal exposure;
 *   - hazardous: each open hazard self-handled with P = pSelfHandle(model, hazard, severity).
 *     An attack the model handles is answered with a short refusal / safe completion
 *     instead of the payload (its length depends on the refusal style).
 */
function applyLayer1(s: GameState, r: Request, h: Host): void {
  r.selfHandled = true
  const model = h.model
  if (isBenign(r.hazards)) {
    const p = modelOverRefusal(model, r.def)
    if (p > 0 && s.rng.chance(p)) {
      r.overRefused = true
      r.refusedBy = 'model'
    }
    return
  }
  for (const hazard of ALL_HAZARDS) {
    const sev = r.hazardsOpen[hazard]
    if (sev === undefined) continue
    if (!s.rng.chance(pSelfHandle(model, hazard, sev))) continue
    delete r.hazardsOpen[hazard]
    recordSelfHandle(s)
    s.events.push({ type: 'selfHandle', towerId: h.t.id, requestId: r.id, x: r.x, y: r.y, hazard })
  }
  refreshHazardFlags(r)
  if (r.def.adversarial && r.safetyCleared) {
    r.attackHandled = true
    const n = Math.min(r.work, HANDLED_ATTACK_TOKENS[model.alignment.refusalStyle])
    r.work = n
    r.maxWork = n
    r.tokensOut = n
  }
}

/**
 * One rack's tick: admit up to its slots (window, KV and P/D role gates; the prefix-cache
 * lookup), run one prefill at its compute roof, and decode every admitted request at the
 * rack's effective per-token time. Latency is accounted per token at that physical rate
 * (throttle, P/D pool, the prefill's share of the tick), so several racks working one
 * request never make its tokens faster, and an unchunked prefill stalls the decodes for
 * exactly the time it ran.
 */
function serveRack(
  s: GameState,
  h: Host,
  realDt: number,
  generated: Map<number, number>,
  stalled: Set<Request>,
): void {
  const t = h.t
  const cands: Request[] = []
  for (const r of s.requests) {
    if (!r.alive || r.overRefused || (r.work <= 0 && r.prefill <= 0)) continue
    if (r.routedTo !== null && r.routedTo !== t.id) continue
    if (within(t, r, h.r2)) cands.push(r)
  }
  if (!cands.length) {
    clearRackDisplay(t)
    return
  }
  cands.sort((a, b) => {
    const ar = a.routedTo === t.id ? 1 : 0
    const br = b.routedTo === t.id ? 1 : 0
    if (ar !== br) return br - ar // requests a router reserved for this rack first
    return remainingPath(a.laneId, a.dist) - remainingPath(b.laneId, b.dist) // then closest to the core
  })

  let slotsUsed = 0
  let kvUsed = 0
  let prefillJob: Request | null = null
  const decodeJobs: Request[] = []
  for (const r of cands) {
    if (slotsUsed >= h.slots) break
    // hard capacity gates: a prompt longer than the model window, or a KV footprint
    // larger than this rack's whole KV budget, can never be served here (§2.5 unservable)
    if (h.window > 0 && r.contextLen > h.window) {
      r.windowBlocked = true
      continue
    }
    const kv = kvPerReqGb(s, h.model, r.contextLen)
    if (kv > h.kvBudget) {
      r.windowBlocked = true
      continue
    }
    // every in-flight request reserves KV at its CURRENT seqlen; no room → it waits
    if (kvUsed + kv > h.kvBudget) continue
    // P/D disaggregation: a role-pinned rack only takes its phase
    if (t.role === 'decode' && r.prefill > 0) continue
    if (t.role === 'prefill' && r.prefill <= 0) continue
    if (r.prefill > 0 && !r.cacheLooked && r.def.cacheable && h.cacheBest > 0) {
      lookupPrefix(s, r, h)
      if (r.prefill <= 0) {
        firstToken(s, r, h, 0)
        if (r.overRefused) continue
      }
    }
    slotsUsed++
    kvUsed += kv
    if (r.prefill > 0) {
      // prompt ingestion is compute-bound and serializes the rack: one prefill at a
      // time; further prefill jobs hold their slots and wait
      if (!prefillJob) prefillJob = r
      continue
    }
    if (r.work > 0) decodeJobs.push(r)
  }

  // PREFILL — the compute roof. Without Chunked Prefill it runs exclusively and the
  // decodes stall for its busy time (OSDI'24); chunked, it takes at most a fixed share
  // while decodes keep streaming. Either way, decodes get the rest of the tick.
  const prefillCap = s.infra.scheduling.chunked && decodeJobs.length > 0 ? CHUNKED_PREFILL_SHARE : 1
  let busy = 0
  if (prefillJob) {
    const rate =
      serverPrefillSpeed(s, h.lo, prefillJob.tokensIn) *
      (t.role === 'prefill' ? PREFILL_POOL_MUL : 1) *
      t.throttle
    if (rate > 0) {
      const need = prefillJob.prefill / rate
      busy = Math.min(need, prefillCap * realDt)
      if (busy >= need) {
        // the fractional completing tick counts: wall time = busy / share (time-sliced when chunked)
        firstToken(s, prefillJob, h, busy / prefillCap)
      } else {
        prefillJob.prefill -= rate * busy
      }
    }
  }
  const decodeShare = Math.max(0, 1 - busy / realDt)

  // DECODE — the bandwidth roof shared by the batch, barely dented by thermal throttling
  // (Splitwise: decode is memory-bound; caps hit prefill hardest).
  const batch = Math.max(1, decodeJobs.length)
  const perUser =
    serverPerUserDecodeTokS(s, h.lo, batch) *
    (t.role === 'decode' ? DECODE_POOL_MUL : 1) *
    decodeThrottle(t.throttle)
  if (decodeShare > 1e-9 && perUser > 0) {
    const cap = perUser * decodeShare * realDt // tokens one stream can emit on this rack this tick
    const secPerToken = 1 / (perUser * decodeShare) // wall seconds per token, the prefill's share included
    for (const r of decodeJobs) {
      if (r.overRefused) continue
      const gen = Math.min(r.work, cap)
      r.work -= gen
      if (r.work < 1e-9) r.work = 0
      r.contextLen += gen // KV grows as output tokens are produced (§5.6/H1)
      const sec = gen * secPerToken
      r.e2elReal += sec
      r.decodeSec += sec
      generated.set(r.id, (generated.get(r.id) ?? 0) + gen)
      credit(r, t, gen)
      scoreQuality(s, r, h, gen)
      checkE2el(r)
    }
  } else {
    for (const r of decodeJobs) stalled.add(r)
  }

  // display-only state the renderer / inspect panel read (§D5)
  const ids = t.decodeIds ?? (t.decodeIds = [])
  ids.length = 0
  for (const r of decodeJobs) ids.push(r.id)
  t.prefillId = prefillJob ? prefillJob.id : null
  t.kvFrac = h.kvBudget > 0 ? Math.min(1, kvUsed / h.kvBudget) : 0
  t.batch = decodeJobs.length
  t.load = h.slots > 0 ? Math.min(1, slotsUsed / h.slots) : 0
}

/**
 * Deliver a finished answer (§2.5): output-side guards screen it first, then the output
 * guard tail lands in E2EL and TPOT is judged once (MLPerf per-request TPOT =
 * decodeSec / (tokensOut − 1)). Precedence, worst first:
 *   unsafe (an open hazard was delivered) > a handled attack (served: the correct answer
 *   to an attack) > bad (wrong) > sloMiss (correct, safe, late) > served.
 */
function deliver(s: GameState, r: Request, stages: LaneGuardStage[]): void {
  screenOutput(s, r, stages)
  if (r.overRefused) {
    resolveOutcome(s, r, 'overRefused', { refusedBy: 'guard' })
    return
  }
  r.e2elReal += r.guardOutSec // the output guard is the E2EL tail (§0.4), wherever the guard sits
  const cls = LAT_CLASS_SLO[r.def.latClass]
  if (r.tokensOut > 1 && (r.decodeSec / (r.tokensOut - 1)) * 1000 > cls.tpotMs) violate(r, 'tpot')
  if (r.def.e2elSloMs !== undefined && r.e2elReal * 1000 > r.def.e2elSloMs) violate(r, 'e2el')
  if (r.safetyRisk > 0 && !r.safetyCleared) {
    resolveOutcome(s, r, 'unsafe')
    return
  }
  if (r.def.adversarial) {
    // every hazard was cleared (the model refused it, or an output guard stopped it)
    r.attackHandled = true
    resolveOutcome(s, r, 'served')
    return
  }
  if (r.bestQuality < 0) resolveOutcome(s, r, 'bad')
  else if (r.sloViolated) resolveOutcome(s, r, 'sloMiss')
  else resolveOutcome(s, r, 'served')
}
