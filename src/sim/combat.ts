import {
  COHORT_STREAMS,
  DISAGG_POOL_GAIN,
  KV_TRANSFER_GBPS,
  LAT_CLASS_SLO,
  LORA_UNMERGED_SPEED,
  SIM_TIME_SCALE,
  TILE,
} from '../config'
import type {
  AnswerMode,
  CapabilityAxis,
  GameState,
  ModelDef,
  Request,
  SloCause,
  Tower,
  WeightFormat,
} from '../core/types'
import {
  admissionDelaySec,
  answerMode,
  cacheChance,
  cohortFit,
  cohortKvGb,
  cohortPrefillSec,
  hiddenTokensFor,
  kvPerReqGb,
  laneStep,
  type Loadout,
  loadoutOf,
  longContextPenaltyFor,
  offloadReloadSec,
  type ParallelPlan,
  prefillRateOn,
  prefixHitChance,
  prefixHitTiers,
  rackLoadEstimate,
  rackPlan,
  routeBonus,
  schedGroups,
  serverQualityVs,
  specTokensFor,
  spritesPerLane,
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

/** Chunked prefill (Sarathi-Serve): while decodes are running, a prompt takes at most this share of its lane's time. */
const CHUNKED_PREFILL_SHARE = 0.35

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
 * model that fits): its parallel plan (lanes, KV per model copy), slots and window.
 * Everything else is computed the first time a request in range needs it — most racks
 * are idle on most ticks.
 */
class Host {
  readonly model: ModelDef
  readonly plan: ParallelPlan
  readonly format: WeightFormat
  readonly r2: number
  /** request sprites the scheduler batches on the whole rack. */
  readonly slots: number
  /** the hard context window in real tokens. */
  readonly window: number
  private qByCache: Partial<Record<`${AnswerMode}:${CapabilityAxis}`, number>> | null = null
  private tpotCache = -1
  private cacheBestCache = -1
  private stepRefCache = -1

  constructor(
    private readonly s: GameState,
    readonly t: Tower,
    readonly lo: Loadout,
    plan: ParallelPlan,
    private readonly caches: () => CacheAura[],
  ) {
    this.model = lo.model!
    this.plan = plan
    this.format = plan.format
    this.r2 = rangePx(t) ** 2
    this.slots = plan.lanes * spritesPerLane(s)
    this.window = this.model.contextWindowK * 1000
  }

  /** usable KV memory of ONE model copy (GB) — the most one stream may ever need. */
  get kvPerReplica(): number {
    return this.plan.kvGbPerReplica
  }

  /** effective quality on one axis in one answer mode (that mode's vector − PTQ tax − alignment tax). */
  q(axis: CapabilityAxis, mode: AnswerMode): number {
    const cache = (this.qByCache ??= {})
    return (cache[`${mode}:${axis}`] ??= serverQualityVs(this.s, this.lo, axis, mode))
  }

  /** §1.4 the mode this rack's model answers the request in (a hybrid: instant on interactive traffic). */
  mode(r: Request): AnswerMode {
    return answerMode(this.model, r.def)
  }

  /** real seconds per token of one stream with one cohort on the rack, throttle applied (the dispatch tie-break). */
  get tpot1(): number {
    if (this.tpotCache < 0) {
      const perUser = rackLoadEstimate(this.s, this.lo, 1, undefined, {
        throttle: this.t.throttle,
      }).perUserTokS
      this.tpotCache = perUser > 0 ? 1 / perUser : Infinity
    }
    return this.tpotCache
  }

  /** a representative decode step (one cohort) — the multi-step admission wait is a few of these. */
  get stepRef(): number {
    if (this.stepRefCache < 0) {
      const est = rackLoadEstimate(this.s, this.lo, 1, undefined, { throttle: this.t.throttle })
      this.stepRefCache = Number.isFinite(est.stepSec) ? est.stepSec : 0
    }
    return this.stepRefCache
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

  /** hidden reasoning tokens this rack's model spends on one request of the archetype (0 in instant mode). */
  hidden(r: Request): number {
    return hiddenTokensFor(this.model, r.def)
  }

  /**
   * Real seconds this rack would take to finish the request from here: the tokens it still
   * has to generate — plus, before its first token, the hidden reasoning this model would
   * think first — at the rack's per-user speed (the router's latency estimate).
   */
  answerEta(r: Request): number {
    const tokens = Math.max(0, r.work) + (r.prefillDoneAt === undefined ? this.hidden(r) : 0)
    return tokens * this.tpot1
  }

  /**
   * The full sequence this request will reach if served here: the tokens it holds now, the
   * tokens it still has to generate, and — before its first token — the hidden reasoning this
   * rack's model would add. Admission checks the window and KV against it, so a request is
   * never stranded mid-decode.
   */
  expectedSeq(r: Request): number {
    return r.contextLen + Math.max(0, r.work) + (r.prefillDoneAt === undefined ? this.hidden(r) : 0)
  }

  /** the request fits this rack at its full sequence: inside the window, and one stream's KV inside one model copy. */
  feasible(r: Request): boolean {
    const seq = this.expectedSeq(r)
    if (this.window > 0 && seq > this.window) return false
    return kvPerReqGb(this.s, this.model, seq) <= this.kvPerReplica
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
    if (!lo.model || !lo.hw) continue
    const plan = rackPlan(s, lo)
    if (!plan.fits) continue
    hosts.push(new Host(s, t, lo, plan, caches))
  }
  return hosts
}

/**
 * Could this rack ever take the request in its current phase? The P/D role must match (a
 * decode pool only takes KV its own model produced), and the full sequence must fit the
 * model window and one model copy's KV. (A full rack or a KV budget busy with other
 * requests is honest queueing — still a host.)
 */
function canHost(h: Host, r: Request): boolean {
  if (r.prefill > 0 ? h.t.role === 'decode' : h.t.role === 'prefill') return false
  if (h.t.role === 'decode' && r.kvModelId !== h.model.id) return false
  return h.feasible(r)
}

/**
 * §6.4 the answer-quality margin this rack would give the request: effQ on its judged axis in
 * the mode its model answers it in − the long-context penalty of its current sequence − difficulty.
 */
function marginOn(s: GameState, h: Host, r: Request): number {
  return h.q(r.def.primaryAxis, h.mode(r)) - longContextPenaltyFor(s, h.model, h.format, r.contextLen) - r.difficulty
}

function violate(r: Request, cause: SloCause): void {
  if (r.sloViolated) return
  r.sloViolated = true
  r.sloCause = cause
}

/** §1.3 a per-type end-to-end bound (agent's), on the running total plus the output-guard tail. */
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
 *   4. every rack admits cohorts, prefills and decodes;
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
      if (within(h.t, r, h.r2) && canHost(h, r)) {
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

  // every rack admits its cohorts first, so expert parallelism and the displays see the whole tick
  const prefillClaims = new Set<number>()
  const racks = hosts.map((h) => admit(s, h, prefillClaims))
  const hostOf = new Map<number, Host>()
  for (const h of hosts) hostOf.set(h.t.id, h)
  const generated = new Map<number, number>()
  const stalled = new Set<Request>()
  for (const rack of racks) serveRack(s, rack, realDt, generated, stalled, hostOf)

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
  t.streams = 0
  t.tokS = 0
  if (t.decodeIds) t.decodeIds.length = 0
}

/**
 * §4.10 Router = capability-aware dispatch (RouteLLM / model gateways): every request in a
 * router's range is reserved for an in-range rack with a free slot. Among the racks whose
 * model answers it CORRECTLY (quality margin ≥ 0, in the mode that model answers it in) it
 * takes the one that would finish it soonest — its answer, plus the hidden reasoning a model
 * in thinking mode spends first, at that rack's per-user speed (ties → the larger margin) — so
 * easy traffic goes to fast small models and a strong thinker is kept for what needs it. When no rack in range answers it
 * correctly it takes the best margin (ties → the sooner answer). A request no rack in range
 * can take stays unreserved (any rack may serve it) — routing never strands traffic.
 * Without a router, racks serve the requests nearest the core first.
 */
function dispatch(s: GameState, hosts: Host[]): void {
  const load = new Map<Host, number>()
  const routed = s.requests
    .filter((r) => r.alive && r.routed && !r.overRefused && (r.work > 0 || r.prefill > 0))
    .sort((a, b) => remainingPath(a.laneId, a.dist) - remainingPath(b.laneId, b.dist) || a.id - b.id)
  for (const r of routed) {
    let best: Host | null = null
    let bestMargin = -Infinity
    let bestEta = Infinity
    for (const h of hosts) {
      if ((load.get(h) ?? 0) >= h.slots) continue
      if (!within(h.t, r, h.r2) || !canHost(h, r)) continue
      const m = marginOn(s, h, r)
      const eta = h.answerEta(r)
      const better = !best
        ? true
        : m >= 0 && bestMargin >= 0
          ? eta < bestEta - 1e-9 || (Math.abs(eta - bestEta) <= 1e-9 && m > bestMargin + 1e-9)
          : m >= 0 !== bestMargin >= 0
            ? m >= 0
            : m > bestMargin + 1e-9 || (Math.abs(m - bestMargin) <= 1e-9 && eta < bestEta - 1e-9)
      if (better) {
        best = h
        bestMargin = m
        bestEta = eta
      }
    }
    if (!best) continue
    r.routedTo = best.t.id
    load.set(best, (load.get(best) ?? 0) + 1)
  }
}

/**
 * The prompt tokens the streams of a request's cohort can expect to find in the prefix
 * cache at this rack (its best covering cache, KV-aware routing, SGLang radix, offload):
 * those are prefilled once and their KV is stored once for the whole cohort.
 */
function expectedSharedTokens(s: GameState, h: Host, r: Request): number {
  if (!r.def.cacheable || h.cacheBest <= 0) return 0
  return r.tokensIn * r.def.prefixShare * prefixHitChance(s, h.cacheBest, r.routed)
}

/**
 * The request's one prefix-cache lookup (§4.2), rolled when a rack under a cache aura
 * admits it: a hit serves the shared prefix (`prefixShare` of the prompt) from cache and
 * only the unique suffix still prefills. A prefix found in the KV-offload tier is reloaded
 * over PCIe first (a TTFT cost, still far cheaper than recomputing it). A request's prefix
 * is resident or it is not, so the lookup is never re-rolled.
 */
function lookupPrefix(s: GameState, r: Request, h: Host): void {
  r.cacheLooked = true
  const tiers = prefixHitTiers(s, h.cacheBest, r.routed)
  const u = s.rng.next()
  if (u >= tiers.hbm + tiers.offload) return
  const shared = Math.round(r.tokensIn * r.def.prefixShare)
  const remaining = Math.min(r.prefill, Math.max(0, r.tokensIn - shared))
  if (remaining >= r.prefill) return // already ingested past the shared prefix: nothing to reuse
  r.cachedTokens = r.prefill - remaining
  r.prefill = remaining
  if (u >= tiers.hbm) r.queueSec += offloadReloadSec(s, h.model, r.cachedTokens)
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
 * its own margin (effQ = its model's vector in the mode it answers in, on the primary axis,
 * − long-context penalty − the request's difficulty), and the answer's margin is the weighted
 * mean — the models that wrote the answer decide its quality, not the best model that touched it.
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
 * it): latch TTFT = queue wait + the prefill's wall time this tick + input guards + the
 * rack's admission delay (§0.4), judge the TTFT bound, then roll layer 1 with the model that
 * produced the token, and add the hidden reasoning that model thinks before it answers — none
 * in instant mode (§1.4: a hybrid answers interactive traffic with thinking switched off).
 */
function firstToken(s: GameState, r: Request, h: Host, tDone: number): void {
  r.prefill = 0
  r.prefillDoneAt = s.time
  r.thinkingMode = h.mode(r)
  r.ttftReal = r.queueSec + tDone + r.guardInSec + admissionDelaySec(s, h.lo, h.stepRef)
  r.e2elReal = r.ttftReal
  r.ttfatReal = r.ttftReal
  r.kvModelId = h.model.id
  r.kvTowerId = h.t.id
  // a prefill pool hands its KV to a decode pool over the network (DistServe / Mooncake)
  r.kvTransferSec = h.t.role === 'prefill' ? kvPerReqGb(s, h.model, r.contextLen) / KV_TRANSFER_GBPS : 0
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
  if (r.overRefused) return
  // §1.4 a model answering in thinking mode reasons first: hidden tokens decode first, cost
  // time, KV and compute like any token, and are never billed
  const hidden = h.hidden(r)
  if (hidden > 0) {
    r.work += hidden
    r.maxWork += hidden
    r.hiddenTokens = hidden
    r.thinkTokens = hidden
  }
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

/** One admitted request sprite: its cohort of real streams on the rack, and the KV they hold. */
interface Job {
  r: Request
  /** streams of its cohort in flight on every real rack (≤ COHORT_STREAMS; fewer when KV ran out). */
  k: number
  kvGb: number
  /** prompt tokens the cohort's streams share through the prefix cache. */
  shared: number
}

/**
 * A scheduling group of the rack (`schedGroups`): the whole rack when Data Parallelism
 * load-balances requests across its model copies, otherwise one copy each (a request's
 * cohort stays on the copy it landed on). A group has its lanes (copies × pipeline stages),
 * KV and slots.
 */
interface Group {
  lanes: number
  kvCap: number
  slots: number
  sprites: number
  kvUsed: number
  prefill: Job[]
  decode: Job[]
}

/** The rack's admitted work this tick. */
interface Admitted {
  h: Host
  groups: Group[]
  first: Request | null
}

/**
 * Admission for one rack: the requests in its range (a router's reservation first, then the
 * ones closest to the core), each gated by the model window and one copy's KV at its FULL
 * sequence (unservable otherwise), the P/D role, and a free slot. A request lands on the
 * group with the most free KV and brings as much of its cohort as that KV holds: each
 * stream reserves its current sequence's KV, the shared prefix stored once.
 */
function admit(s: GameState, h: Host, prefillClaims: Set<number>): Admitted {
  const t = h.t
  const sg = schedGroups(s, h.plan)
  const groups: Group[] = Array.from({ length: sg.count }, () => ({
    lanes: sg.lanes,
    kvCap: sg.kvGb,
    slots: sg.slots,
    sprites: 0,
    kvUsed: 0,
    prefill: [],
    decode: [],
  }))
  const cands: Request[] = []
  for (const r of s.requests) {
    if (!r.alive || r.overRefused || (r.work <= 0 && r.prefill <= 0)) continue
    if (r.routedTo !== null && r.routedTo !== t.id) continue
    if (within(t, r, h.r2)) cands.push(r)
  }
  if (!cands.length) return { h, groups, first: null }
  cands.sort((a, b) => {
    const ar = a.routedTo === t.id ? 1 : 0
    const br = b.routedTo === t.id ? 1 : 0
    if (ar !== br) return br - ar // requests a router reserved for this rack first
    return remainingPath(a.laneId, a.dist) - remainingPath(b.laneId, b.dist) // then closest to the core
  })

  let used = 0
  for (const r of cands) {
    if (used >= h.slots) break
    // hard capacity gates at the FULL sequence: longer than the model window, or one
    // stream's KV larger than a whole model copy can hold → never servable here (§2.5)
    if (!h.feasible(r)) {
      r.windowBlocked = true
      continue
    }
    // P/D disaggregation: a role-pinned rack only takes its phase, a decode pool only its model's KV
    if (t.role === 'decode' && (r.prefill > 0 || r.kvModelId !== h.model.id)) continue
    if (t.role === 'prefill' && r.prefill <= 0) continue
    // one prompt is ingested by ONE rack: a rack already holding it in its prefill queue keeps it
    if (r.prefill > 0 && prefillClaims.has(r.id)) continue
    const kvOne = kvPerReqGb(s, h.model, r.contextLen)
    let gi = -1
    let free = -1
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      const f = g.kvCap - g.kvUsed
      if (g.sprites < g.slots && f >= kvOne && f > free + 1e-12) {
        gi = i
        free = f
      }
    }
    if (gi < 0) continue // every copy is full: it waits in the queue
    if (r.prefill > 0 && !r.cacheLooked && r.def.cacheable && h.cacheBest > 0) {
      lookupPrefix(s, r, h)
      if (r.prefill <= 0) {
        firstToken(s, r, h, 0)
        if (r.overRefused) continue
      }
    }
    const shared = expectedSharedTokens(s, h, r)
    const k = cohortFit(s, h.model, r.contextLen, free, shared)
    const kvGb = cohortKvGb(s, h.model, r.contextLen, k, shared)
    const g = groups[gi]
    g.sprites++
    g.kvUsed += kvGb
    used++
    const job: Job = { r, k, kvGb, shared }
    if (r.prefill > 0) {
      g.prefill.push(job)
      prefillClaims.add(r.id)
    } else if (r.work > 0) g.decode.push(job)
  }
  return { h, groups, first: cands[0] }
}

/**
 * One rack's tick (§5.7): every group runs one prompt per lane at the compute roof, then
 * decodes its cohorts at the step time of its lanes — weights (an MoE: the experts its batch
 * touches) and every stream's KV re-read each step, the cohorts' other prompts ingested in
 * the background (added to the step, or hidden under its memory time with chunked prefill),
 * speculative decoding while it still pays. Latency is accounted per token at that physical
 * rate, so several racks working one request never make its tokens faster; a KV-limited
 * cohort's sprite waits for its streams (E2EL), not its TPOT.
 *
 * P/D disaggregation: a decode pool ingests no prompts — the cohort's other prompts are owed
 * to the prefill pool that produced the request's KV (`prefillDebtSec`, paid out of that
 * rack's lane time before it starts new prompts), so splitting the phases removes the
 * interference without making the prompt work disappear.
 */
function serveRack(
  s: GameState,
  a: Admitted,
  realDt: number,
  generated: Map<number, number>,
  stalled: Set<Request>,
  hostOf: Map<number, Host>,
): void {
  const { h, groups } = a
  const t = h.t
  const p = h.plan
  const thr = t.throttle
  // §4.3 a prefill pool first pays the prompts its decode pools owe it, out of its lane time
  const laneSec = Math.max(1, p.lanes) * realDt
  const debtPaid = Math.min(t.prefillDebtSec, laneSec)
  t.prefillDebtSec -= debtPaid
  if (!a.first) {
    clearRackDisplay(t)
    return
  }
  const loraMul = t.loraHot && h.model.lineage?.relation === 'adapter' ? LORA_UNMERGED_SPEED : 1
  const decodeGain = (t.role === 'decode' ? DISAGG_POOL_GAIN : 1) * loraMul
  const prefillGain = t.role === 'prefill' ? DISAGG_POOL_GAIN : 1
  const overlap = s.infra.scheduling.chunked
  // the share of every lane's tick the owed prompts took (spread evenly over the lanes)
  const debtShare = laneSec > 0 ? debtPaid / laneSec : 0
  let rackStreams = 0
  for (const g of groups) for (const j of g.decode) rackStreams += j.k

  let streamsShown = 0
  let tokSum = 0
  let tokN = 0
  let kvUsed = 0
  let kvCap = 0
  let sprites = 0
  let prefillShown: number | null = null
  const ids = t.decodeIds ?? (t.decodeIds = [])
  ids.length = 0

  for (const g of groups) {
    kvUsed += g.kvUsed
    kvCap += g.kvCap
    sprites += g.sprites

    // PREFILL — one prompt per lane at the compute roof. Without Chunked Prefill it runs
    // exclusively and that lane's decodes stall for its busy time (OSDI'24); chunked, it
    // takes at most a fixed share while decodes keep streaming. A prompt that finishes joins
    // the batch at once: continuous batching admits it into the very next iteration.
    const cap =
      (s.infra.scheduling.chunked && g.decode.length > 0 ? CHUNKED_PREFILL_SHARE : 1) * (1 - debtShare)
    const lanes = Math.max(1, g.lanes)
    let busy = 0
    const running = g.prefill.slice(0, lanes)
    for (const j of running) {
      const r = j.r
      if (prefillShown === null) prefillShown = r.id
      if (cap <= 1e-9) continue // the lane spent the tick on owed prompts: this one waits
      // an embedding's cohort is all prompt: its sprite ingests every stream's prompt here
      const streamsIngesting = r.maxWork <= 0 ? j.k : 1
      const rate = (prefillRateOn(s, h.lo, p, r.tokensIn) * prefillGain * thr) / streamsIngesting
      if (rate <= 0) continue
      const need = r.prefill / rate
      const b = Math.min(need, cap * realDt)
      busy += b
      if (b >= need) {
        // the fractional completing tick counts: wall time = busy / share (time-sliced when
        // chunked or sharing the lane with owed prompts)
        firstToken(s, r, h, b / cap)
        // its decode starts in the rest of this tick — unless this rack is a prefill pool
        // (the KV moves on to a decode pool) or the first token ended it (refusal, embedding)
        if (t.role !== 'prefill' && r.alive && !r.overRefused && r.work > 0) g.decode.push(j)
      } else {
        r.prefill -= rate * b
      }
    }
    const share = Math.max(0, 1 - busy / (lanes * realDt) - debtShare)
    for (const j of g.prefill) if (j.r.prefill > 0) streamsShown += j.k

    // DECODE STEP of this group's lanes. A decode pool's cohort prompts are owed to the
    // prefill rack that produced the request's KV; everyone else ingests them here.
    let streams = 0
    let kvGb = 0
    let bgSec = 0
    let specSum = 0
    const owed: (Host | null)[] = []
    for (const j of g.decode) {
      streams += j.k
      kvGb += j.kvGb
      specSum += j.k * specTokensFor(s, j.r.def.primaryAxis)
      const src =
        t.role === 'decode' && j.r.kvTowerId !== undefined ? (hostOf.get(j.r.kvTowerId) ?? null) : null
      const payer = src && src !== h && src.t.role !== 'decode' ? src : null
      owed.push(payer)
      if (!payer) bgSec += cohortPrefillSec(s, h.lo, p, j.k, j.r.tokensIn, j.shared, j.r.maxWork)
    }
    streamsShown += streams
    const step = laneStep(s, h.lo, p, {
      streams: streams / lanes,
      kvGb: kvGb / lanes,
      bgPrefillSec: bgSec / lanes,
      overlapPrefill: overlap,
      rackStreams,
      specTokens: streams > 0 ? specSum / streams : 1,
      throttle: thr,
    })

    // DECODE — each in-flight stream emits tokens at 1/step (×accepted drafts); the sprite
    // advances by its cohort's share of COHORT_STREAMS.
    for (let i = 0; i < g.decode.length; i++) {
      const j = g.decode[i]
      const r = j.r
      if (!r.alive || r.overRefused || r.work <= 0) continue
      ids.push(r.id)
      const rate = ((step.specOn ? specTokensFor(s, r.def.primaryAxis) : 1) / step.stepSec) * decodeGain
      if (!(rate > 0) || share <= 1e-9) {
        stalled.add(r)
        continue
      }
      tokSum += rate
      tokN++
      const perStream = rate * share * realDt // tokens one in-flight stream emits this tick
      const before = r.maxWork - r.work
      const gen = Math.min(r.work, (perStream * j.k) / COHORT_STREAMS)
      r.work -= gen
      if (r.work < 1e-9) r.work = 0
      r.contextLen += gen // KV grows as output tokens are produced (§5.6/H1)
      const payer = owed[i]
      if (payer) {
        // the prefill pool owes the prompts of the streams this cohort's progress stands for
        const tokens = ((j.k - 1) * Math.max(0, r.tokensIn - j.shared) * gen) / Math.max(1, r.maxWork)
        const pr = prefillRateOn(s, payer.lo, payer.plan, r.tokensIn) * DISAGG_POOL_GAIN
        if (pr > 0) payer.t.prefillDebtSec += tokens / pr
      }
      const tokSec = 1 / (rate * share) // physical wall seconds per token of an in-flight stream
      let sec = gen * tokSec
      let wall = (sec * COHORT_STREAMS) / j.k // the cohort's sprite waits for its streams when KV is short
      if (r.kvTransferSec > 0 && r.kvTowerId !== t.id) {
        // the decode pool waits for the prefill pool's KV to arrive before its first step
        sec += r.kvTransferSec
        wall += r.kvTransferSec
        r.kvTransferSec = 0
      }
      const e2el0 = r.e2elReal
      r.e2elReal += wall
      r.decodeSec += sec
      // time to first ANSWER token: the hidden reasoning ends inside this tick
      if (r.hiddenTokens > 0 && before < r.hiddenTokens && before + gen >= r.hiddenTokens) {
        r.ttfatReal = e2el0 + (wall * (r.hiddenTokens - before)) / Math.max(1e-9, gen)
        if (r.def.ttfatSloMs !== undefined && r.ttfatReal * 1000 > r.def.ttfatSloMs) violate(r, 'ttfat')
      }
      generated.set(r.id, (generated.get(r.id) ?? 0) + gen)
      credit(r, t, gen)
      scoreQuality(s, r, h, gen)
      checkE2el(r)
    }
  }

  // display-only state the renderer / inspect panel read (§D5)
  t.prefillId = prefillShown
  t.kvFrac = kvCap > 0 ? Math.min(1, kvUsed / kvCap) : 0
  t.batch = ids.length
  t.streams = streamsShown
  t.tokS = tokN > 0 ? tokSum / tokN : 0
  t.load = h.slots > 0 ? Math.min(1, sprites / h.slots) : 0
}

/**
 * Deliver a finished answer (§2.5): output-side guards screen it first, then the output
 * guard tail lands in E2EL and TPOT is judged once (MLPerf per-request TPOT =
 * decodeSec / (tokens generated − 1), hidden reasoning tokens included). Precedence, worst first:
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
  if (r.maxWork > 1 && (r.decodeSec / (r.maxWork - 1)) * 1000 > cls.tpotMs) violate(r, 'tpot')
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
