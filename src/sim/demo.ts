/* ------------------------------------------------------------------ *
 *  DEMO AUTOPLAY — the production heuristic that plays the campaign.   *
 * ------------------------------------------------------------------ *
 *
 * It plays the way a careful operator does, using only the actions and the read-only
 * forecasts a player has (the next-wave preview, the serving math the deploy picker shows),
 * never a privileged view of the dice:
 *
 *   1. forecast the next wave: its archetypes, era token sizes, quality lines and hazards;
 *   2. keep a cash reserve sized to the wave's projected bill, then spend on what the
 *      forecast needs — the support buildings (Lab, guards, routers, caches), more racks
 *      (and extra ones along a telegraphed single-entry surge's lane), faster racks in place
 *      (the slowest first, then 8-GPU boxes where every lane meets the core), and the power /
 *      cooling they draw;
 *   3. research the serving stack in dependency order, red-teaming the guards before the
 *      prompt-injection era and the parallelism a big checkpoint needs before it is deployed;
 *   4. post-train specialists in the Studio (a safe-completion workhorse, an agentic and a
 *      reasoning specialist on a fast MoE body);
 *   5. deploy onto every rack tier the checkpoint that serves the forecast best — judged per
 *      archetype in the mode the model answers it in (a hybrid answers interactive traffic
 *      instantly), against the latency bounds of a busy rack, the window and KV gates, the
 *      quality line (long-context penalty included) and its alignment — splitting a tier's
 *      racks between checkpoints when no single one covers the whole mix, so the routers
 *      have a fast rack and a capable rack to dispatch between.
 *
 * The campaign is an elimination gauntlet: the demo is expected to get deep, not to win.
 */

import { GRID_COLS, GRID_ROWS, LAT_CLASS_SLO, SIM_DT, SIM_TIME_SCALE, TILE } from '../config'
import type {
  GameState,
  ModelDef,
  RequestTypeDef,
  SafetyHazard,
  SafetyProfile,
  Tower,
  WeightFormat,
} from '../core/types'
import {
  buildCost,
  continueEndless,
  deployModel,
  hardwareUpgradeCost,
  sellTower,
  setRackPrecision,
  startGame,
  startWave,
  tryBuild,
  upgradeHardware,
} from './actions'
import {
  HARDWARE_DEFS,
  HARDWARE_TIERS,
  METHOD_RECIPES,
  REQUEST_TYPES,
  RESEARCH_DEFS,
  TOWER_DEFS,
  WAVES,
} from './content'
import {
  admissionDelaySec,
  answerMode,
  cacheChance,
  cohortFit,
  cohortKvGb,
  cohortPrefillSec,
  formatAvailable,
  guardLatencyMs,
  hiddenTokensFor,
  isBlackwell,
  kvPerReqGb,
  laneStep,
  type Loadout,
  loadout,
  loadoutOf,
  longContextPenalty,
  prefillTokS,
  prefixHitChance,
  rackPlan,
  serverCtxWindowTokens,
  serverDeployable,
  serverQualityVs,
  servingFormat,
  specTokensFor,
  spritesPerLane,
} from './effects'
import { computeDerivedFields, resolveModel } from './models'
import { CORE_TILE, isBuildable, isPathTile, LANE_PATHS, tileCenter } from './pathing'
import { coolingPools, towerHeatKw, towerLiquidCooled, towerPowerKw, updatePower } from './power'
import { fleetBurnPerSec, previewNextWave } from './preview'
import {
  canPostTrain,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
  startPostTrain,
  startResearch,
} from './research'
import { ALL_HAZARDS, pSelfHandle } from './safety'
import { step } from './sim'
import { createState } from './state'

/* ------------------------------------------------------------------ *
 *  Board geometry                                                     *
 * ------------------------------------------------------------------ */

interface Slot {
  col: number
  row: number
}

function adjacentToLane(col: number, row: number): boolean {
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) if (isPathTile(col + dc, row + dr)) return true
  return false
}

const distToCore = (p: { col: number; row: number }): number =>
  Math.abs(p.col - CORE_TILE.col) + Math.abs(p.row - CORE_TILE.row)

/**
 * Lane-adjacent tiles (racks, routers, caches, guards), core-first: every lane ends at the core,
 * so a rack beside it sees all four lanes' traffic. Back tiles (no lane in reach) take the power
 * plants and cooling towers first; infrastructure spills onto the far lane tiles once they run out.
 */
function buildSlots(): { lane: Slot[]; back: Slot[] } {
  const lane: Slot[] = []
  const back: Slot[] = []
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!isBuildable(c, r)) continue
      ;(adjacentToLane(c, r) ? lane : back).push({ col: c, row: r })
    }
  }
  lane.sort((a, b) => distToCore(a) - distToCore(b) || a.col - b.col || a.row - b.row)
  return { lane, back }
}

const SLOTS = buildSlots()

/**
 * Every lane ends at the core, so a building within reach of the core touches all four lanes.
 * The few tiles closest to it are kept for the support that must cover every lane — the
 * guardrails screen by lane coverage (two tiles), a router dispatches what it reaches (two) —
 * and racks start just outside them.
 */
const GUARD_SLOTS: Slot[] = SLOTS.lane.slice(0, 2)
const ROUTER_SLOTS: Slot[] = SLOTS.lane.slice(2, 4)
const RESERVED = [...GUARD_SLOTS, ...ROUTER_SLOTS]
const isReserved = (p: Slot): boolean => RESERVED.some((q) => q.col === p.col && q.row === p.row)

const occupied = (s: GameState, p: Slot): boolean => s.towers.some((t) => t.col === p.col && t.row === p.row)

/** The nearest free lane tile to the core for a rack (outside the reserved support tiles). */
function laneSlot(s: GameState): Slot | undefined {
  return SLOTS.lane.find((p) => !isReserved(p) && !occupied(s, p))
}

/** A tile for a guardrail or router: its reserved tile by the core, else the nearest free one. */
function supportSlot(s: GameState, kind: string): Slot | undefined {
  const own = kind === 'guardrail' ? GUARD_SLOTS : kind === 'router' ? ROUTER_SLOTS : []
  return own.find((p) => !occupied(s, p)) ?? laneSlot(s)
}

/** Does a rack on this tile reach the lane's path (its range circle touches the polyline)? */
function reachesLane(p: Slot, laneId: number, rangeTiles: number): boolean {
  const lane = LANE_PATHS[laneId]
  if (!lane) return false
  const c = tileCenter(p.col, p.row)
  const r2 = (rangeTiles * TILE) ** 2
  for (const seg of lane.segments) {
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((c.x - seg.a.x) * dx + (c.y - seg.a.y) * dy) / len2)) : 0
    const px = seg.a.x + dx * u - c.x
    const py = seg.a.y + dy * u - c.y
    if (px * px + py * py <= r2) return true
  }
  return false
}

/** The nearest free rack tile to the core that reaches one lane (a single-entry surge's ingress). */
function surgeSlot(s: GameState, laneId: number): Slot | undefined {
  const range = HARDWARE_DEFS.hw_perf.range
  return SLOTS.lane.find((p) => !isReserved(p) && !occupied(s, p) && reachesLane(p, laneId, range))
}

/** A tile for a power plant / cooling tower: a back tile, else the lane tile farthest from the core. */
function infraSlot(s: GameState): Slot | undefined {
  return (
    SLOTS.back.find((p) => !occupied(s, p)) ??
    [...SLOTS.lane].reverse().find((p) => !isReserved(p) && !occupied(s, p))
  )
}

function place(s: GameState, defId: string, slot: Slot | undefined): boolean {
  return !!slot && tryBuild(s, defId, slot.col, slot.row)
}

const countKind = (s: GameState, kind: string): number => s.towers.filter((t) => t.def.kind === kind).length
const countDef = (s: GameState, id: string): number => s.towers.filter((t) => t.def.id === id).length
const servers = (s: GameState): Tower[] => s.towers.filter((t) => t.def.kind === 'server')
const tierIdx = (hwId: string | undefined): number => HARDWARE_TIERS.indexOf(hwId ?? '')

/* ------------------------------------------------------------------ *
 *  Forecast — what the next wave brings (the next-wave preview).       *
 * ------------------------------------------------------------------ */

/** One archetype of the coming wave, resolved the way spawnRequest will spawn it. */
interface Demand {
  def: RequestTypeDef
  count: number
  inputTokens: number
  outputTokens: number
  difficulty: number
  hazards: SafetyProfile
  novelShare: number
}

/**
 * The coming wave's demand: the authored wave from the next-wave preview; past the campaign
 * the surge is rolled only when it starts, so the last wave served stands in for it.
 */
function forecast(s: GameState): { demand: Demand[]; surgeLane: number | null; seconds: number } {
  const p = previewNextWave(s)
  if (p && p.entries.length) {
    const demand = p.entries.map((e) => ({
      def: REQUEST_TYPES[e.typeId],
      count: e.count,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      difficulty: e.difficulty,
      hazards: e.hazardSeverity,
      novelShare: e.novelShare,
    }))
    return { demand, surgeLane: p.surgeLane, seconds: Math.max(20, p.estDurationSec) }
  }
  const groups = s.currentWave?.groups ?? WAVES[WAVES.length - 1].groups
  const byId = new Map<string, Demand>()
  for (const g of groups) {
    const def = REQUEST_TYPES[g.typeId]
    if (!def) continue
    const work = g.workMul ?? 1
    const d: Demand = {
      def,
      count: g.count,
      inputTokens: Math.round(def.inputTokens * (g.contextMul ?? 1) * Math.max(1, Math.sqrt(work))),
      outputTokens: Math.round(def.outputTokens * work),
      difficulty: (def.difficulty[def.primaryAxis] ?? 0) * (g.complexityMul ?? 1),
      hazards: def.hazards ?? {},
      novelShare: g.novelShare ?? 0,
    }
    const prev = byId.get(def.id)
    if (prev) prev.count += d.count
    else byId.set(def.id, d)
  }
  return { demand: [...byId.values()], surgeLane: p?.surgeLane ?? null, seconds: 60 }
}

/* ------------------------------------------------------------------ *
 *  Fit — would a rack serve one demand cleanly?                        *
 * ------------------------------------------------------------------ */

/** The share of each latency bound under which a rack counts as reliably on time. */
const SLO_HEADROOM = 0.85
/** Quality margin kept over a line (a request's long-context penalty grows as it decodes). */
const QUALITY_MARGIN = 1.5
/** Peak-to-mean factor on a rack's expected concurrency (bursts overlap; requests visit several racks). */
const PEAK_LOAD = 2
/** Chunked prefill's share of a lane while decodes run (combat.ts CHUNKED_PREFILL_SHARE). */
const CHUNKED_SHARE = 0.35
/** The share of the fleet's lanes a single-entry surge's traffic reaches. */
const SURGE_SHARE = 0.5
/** Extra racks (a share of the count target) built along a telegraphed surge's lane. */
const SURGE_REINFORCE = 0.25

interface Fit {
  smart: boolean
  /** the tightest latency bound's use: estimated latency ÷ bound (≤ 1 on time; the worst bound). */
  lat: number
  window: boolean
}

/** One demand as a given checkpoint on a given rack serves it: mode, tokens, prefill rate. */
interface Served {
  d: Demand
  hidden: number
  generated: number
  /** the mean sequence while it decodes. */
  ctx: number
  prefill: number
}

/**
 * The decode step one lane of this rack runs under the coming wave's MIX — `perLane` request
 * sprites drawn from the forecast in proportion to how long each occupies a rack (its decode
 * length), every sprite a cohort of streams sharing the copy's KV, its other prompts ingested
 * in the background — the same lane step combat runs. Interactive answers share their lane with
 * the RAG and summarization cohorts, so this is the step their TPOT and hidden reasoning see.
 */
function mixedStepSec(s: GameState, lo: Loadout, served: Served[], perLane: number): number {
  const p = rackPlan(s, lo)
  const m = lo.model
  if (!m || !p.fits) return Infinity
  const weights = served.map((x) => x.d.count * Math.max(1, x.generated))
  const total = weights.reduce((n, v) => n + v, 0) || 1
  const budget = p.kvGbPerReplica / Math.max(1, perLane)
  let streams = 0
  let kvGb = 0
  let bg = 0
  served.forEach((x, i) => {
    const sprites = (perLane * weights[i]) / total
    if (sprites <= 0) return
    const k = Math.max(1, cohortFit(s, m, x.ctx, budget))
    streams += sprites * k
    kvGb += sprites * cohortKvGb(s, m, x.ctx, k)
    if (x.generated > 0) bg += sprites * cohortPrefillSec(s, lo, p, k, x.d.inputTokens, 0, x.generated)
  })
  const step = laneStep(s, lo, p, {
    streams: Math.max(1, streams),
    kvGb,
    bgPrefillSec: bg,
    overlapPrefill: s.infra.scheduling.chunked,
  })
  return step.stepSec
}

/** The prefix-cache hit chance a request can count on (the best cache, when the fleet has caches). */
function expectedCacheHit(s: GameState): number {
  const caches = s.towers.filter((t) => t.def.kind === 'cache')
  if (!caches.length) return 0
  const best = Math.max(...caches.map((t) => cacheChance(s, t.def)))
  // caches sit by the core: a request meets one late in its walk, so count on half the chance
  return prefixHitChance(s, best, false) * 0.5
}

/**
 * Would this rack serve each demand cleanly in the coming wave? The deploy picker's check, from
 * the serving math combat runs: the mode the model answers the archetype in and the hidden
 * reasoning it spends first; the latency at the load the wave will put on the rack (its
 * expected concurrency from the forecast's volume and the fleet's lanes, × PEAK_LOAD) under the
 * wave's mix; TTFT = prefill + admission wait + the lanes' input guards; time to first answer;
 * TPOT; E2E with the output guards; the judged-axis margin after the long-context penalty; and
 * the window / KV gates.
 */
function fitsOf(
  s: GameState,
  lo: Loadout,
  demand: Demand[],
  guard: { inSec: number; outSec: number },
  fleetLanes: number,
  waveSec: number,
  surge = false,
): Fit[] {
  // a single-entry surge pours every request into the racks along one lane: roughly half the fleet
  if (surge) fleetLanes = Math.max(1, fleetLanes * SURGE_SHARE)
  const m = lo.model
  const p = rackPlan(s, lo)
  if (!m || !p.fits) return demand.map(() => ({ smart: false, lat: Infinity, window: false }))
  const served: Served[] = demand.map((d) => {
    const hidden = d.outputTokens > 0 ? hiddenTokensFor(m, d.def) : 0
    const generated = d.outputTokens + hidden
    return {
      d,
      hidden,
      generated,
      ctx: d.inputTokens + generated / 2,
      prefill: prefillTokS(s, lo, d.inputTokens),
    }
  })
  // expected sprites per decode lane: the wave's sprite-seconds over its real duration and the fleet's lanes
  const light = mixedStepSec(s, lo, served, 1)
  let busy = 0
  for (const x of served) busy += x.d.count * (x.d.inputTokens / Math.max(1, x.prefill) + x.generated * light)
  const perLane = Math.min(
    spritesPerLane(s),
    Math.max(1, Math.ceil((busy * PEAK_LOAD) / Math.max(1, waveSec * SIM_TIME_SCALE * fleetLanes))),
  )
  const stepSec = mixedStepSec(s, lo, served, perLane)
  const cacheHit = expectedCacheHit(s)
  // the prompt lane: one prompt at a time per lane, time-sliced under chunked prefill while
  // decodes run — a prompt waits behind the others (M/D/1 queueing at the lanes' prefill load)
  const share = s.infra.scheduling.chunked ? CHUNKED_SHARE : 1
  const promptSec = (x: Served): number =>
    x.prefill > 0
      ? (x.d.inputTokens * (1 - (x.d.def.cacheable ? x.d.def.prefixShare * cacheHit : 0))) / x.prefill
      : Infinity
  let prefillBusy = 0
  let prefillN = 0
  for (const x of served) {
    prefillBusy += x.d.count * promptSec(x)
    prefillN += x.d.count
  }
  const rho = Math.min(0.95, (prefillBusy * PEAK_LOAD) / Math.max(1, waveSec * SIM_TIME_SCALE * fleetLanes))
  const meanService = prefillN > 0 ? prefillBusy / prefillN / share : 0
  const queue = (rho / (2 * (1 - rho))) * meanService
  const win = serverCtxWindowTokens(s, lo)
  return served.map((x) => {
    const def = x.d.def
    const seq = x.d.inputTokens + x.generated
    const window = (win <= 0 || seq <= win) && kvPerReqGb(s, m, seq) <= p.kvGbPerReplica
    const mode = answerMode(m, def)
    const effQ = serverQualityVs(s, lo, def.primaryAxis, mode) - longContextPenalty(s, lo, x.ctx)
    const smart = def.adversarial ? true : effQ >= x.d.difficulty + QUALITY_MARGIN
    const tpot = stepSec / specTokensFor(s, def.primaryAxis)
    // a prompt's shared prefix is served from the cache on a hit; a miss prefills it whole
    const ttft = promptSec(x) / share + queue + admissionDelaySec(s, lo, stepSec) + guard.inSec
    const ttfat = ttft + x.hidden * tpot
    const e2el = ttft + x.generated * tpot + guard.outSec
    const cls = LAT_CLASS_SLO[def.latClass]
    const lat = Math.max(
      (ttft * 1000) / (def.ttftSloMs ?? cls.ttftMs),
      (ttfat * 1000) / (def.ttfatSloMs ?? Infinity),
      x.generated > 1 ? (tpot * 1000) / cls.tpotMs : 0,
      (e2el * 1000) / (def.e2elSloMs ?? Infinity),
    )
    return { smart, lat, window }
  })
}

/** The worst lane's input / output guard latency right now (seconds), as screenInput charges it. */
function guardLatency(s: GameState): { inSec: number; outSec: number } {
  const fams = new Map<string, { inSec: number; outSec: number }>()
  for (const t of s.towers) {
    const g = t.def.guardrail
    if (t.def.kind !== 'guardrail' || !g) continue
    const sec = guardLatencyMs(s, g) / 1000
    const f = fams.get(g.archetype) ?? { inSec: 0, outSec: 0 }
    if (g.side !== 'output') f.inSec = Math.max(f.inSec, sec)
    if (g.side !== 'input') f.outSec = Math.max(f.outSec, sec)
    fams.set(g.archetype, f)
  }
  let inSec = 0
  let outSec = 0
  for (const f of fams.values()) {
    inSec += f.inSec
    outSec += f.outSec
  }
  return { inSec, outSec }
}

/* ------------------------------------------------------------------ *
 *  Deploy — the checkpoint (or the split) each rack tier runs.          *
 * ------------------------------------------------------------------ */

/** How much a point of a meter matters at its current level (×1 at 60, rising as it drains). */
const meterWeight = (level: number): number => Math.min(3, Math.max(0.6, 60 / Math.max(10, level)))

/** What a clean answer to one demand is worth against its misses (Trust + SLA points at stake). */
const importance = (d: Demand): number => d.def.trustPenalty + d.def.slaPenalty

/** The probability a guard family on every lane catches one hazard (non-novel / novel mix). */
function guardCatch(s: GameState, hazard: SafetyHazard, novelShare: number): number {
  let miss = 1
  const redteam = s.upgrades['eval_redteam'] ?? 0
  for (const id of ['guard_encoder', 'guard_llm']) {
    const t = s.towers.find((x) => x.def.id === id)
    const g = t?.def.guardrail
    if (!g || !g.catches.includes(hazard)) continue
    if (hazard === 'injection' && redteam < 1) continue
    if (hazard === 'pii' && redteam < 2) continue
    const recall = Math.min(1, g.baseRecall)
    const novel = g.archetype === 'encoder' ? 0.45 : g.archetype === 'moderation' ? 0.7 : 1
    miss *= 1 - recall * (1 - novelShare + novelShare * novel)
  }
  return 1 - miss
}

/**
 * Value (per request, in Trust + SLA points) of a rack running this model for one demand, from
 * the outcome table (resolve.ts): a clean answer gains a little and pays; a late one costs
 * 0.25 Trust-penalty + 0.5 SLA-penalty; a wrong one 0.5 Trust-penalty; one the rack cannot
 * hold is left to another rack or leaks. Hazardous traffic adds the breach the model's
 * alignment lets through after the guards; benign traffic subtracts the over-refusals.
 */
function demandValue(s: GameState, m: ModelDef, d: Demand, f: Fit): number {
  // the meter nearer zero is the one that ends the run: weigh its losses up
  const tp = d.def.trustPenalty * meterWeight(s.meters.trust)
  const sp = d.def.slaPenalty * meterWeight(s.meters.sla)
  const clean = 0.4 + 0.1 * importance(d)
  const late = -(0.25 * tp + 0.5 * sp)
  // the share of answers expected on time: all of them under the headroom, none past 1.3× the bound
  const onTime = f.lat <= SLO_HEADROOM ? 1 : f.lat >= 1.3 ? 0 : (1.3 - f.lat) / (1.3 - SLO_HEADROOM)
  let v = !f.window ? -0.3 * (tp + sp) : !f.smart ? -0.5 * tp : onTime * clean + (1 - onTime) * late
  let breach = 0
  for (const h of ALL_HAZARDS) {
    const sev = d.hazards[h]
    if (!sev) continue
    const leak = (1 - guardCatch(s, h, d.novelShare)) * (1 - pSelfHandle(m, h, sev))
    breach = Math.max(breach, leak)
  }
  v -= breach * tp
  if (!d.def.adversarial && !Object.keys(d.hazards).length)
    v -= m.alignment.overRefusal * d.def.refusalExposure * (0.25 * tp + 0.2 * sp)
  return v
}

interface Candidate {
  id: string
  /** the rack weight format it would serve in (undefined = auto: the best lossless one). */
  precision?: WeightFormat
  /** per-demand value (aligned with the forecast's demand list). */
  values: number[]
}

/**
 * The weight formats worth weighing on a tier besides auto: NVFP4 on a Blackwell rack — FP4
 * Tensor Cores double the prefill and decode rate a lossless format gets there, at a small
 * quality tax (larger on long prompts), the trade code completion's TTFT can want.
 */
function lossyFormats(s: GameState, hwId: string): WeightFormat[] {
  const hw = HARDWARE_DEFS[hwId]
  return isBlackwell(hw) && formatAvailable(s, hw, 'nvfp4') ? ['nvfp4'] : []
}

/** Every owned checkpoint (and weight format) deployable on this hardware tier, with its per-demand value. */
function candidatesFor(
  s: GameState,
  hwId: string,
  demand: Demand[],
  guard: { inSec: number; outSec: number },
  fleetLanes: number,
  waveSec: number,
  surge: boolean,
): Candidate[] {
  const out: Candidate[] = []
  const formats: (WeightFormat | undefined)[] = [undefined, ...lossyFormats(s, hwId)]
  for (const id of Object.keys(s.models)) {
    for (const precision of formats) {
      const lo = loadout(s, hwId, id, precision)
      if (!lo.model || !serverDeployable(s, lo)) continue
      if (precision && servingFormat(s, lo) !== precision) continue
      const fits = fitsOf(s, lo, demand, guard, fleetLanes, waveSec, surge)
      out.push({ id, precision, values: demand.map((d, i) => demandValue(s, lo.model!, d, fits[i])) })
    }
  }
  return out
}

/** Load a candidate onto a rack: its weight format and its checkpoint (between waves). */
function loadCandidate(s: GameState, t: Tower, c: Candidate): void {
  if (t.modelId === c.id) {
    setRackPrecision(s, t.id, c.precision)
    return
  }
  // the format first when the checkpoint only fits in it, else the checkpoint first
  if (!deployModel(s, t.id, c.id)) {
    setRackPrecision(s, t.id, c.precision)
    deployModel(s, t.id, c.id)
  }
  setRackPrecision(s, t.id, c.precision)
}

/**
 * Assign checkpoints to one tier's racks, greedily, core-first. A rack catches a sample of the
 * WHOLE mix that passes it (only routed traffic is steered), so each candidate is scored on the
 * full mix, plus a bonus on the demand the racks before it have not yet covered (each covered
 * demand's weight shrinks by the rack's share of the tier). One universal checkpoint wins every
 * rack when it serves the mix; a specialist takes the later racks only when its collateral on
 * the rest of the mix is small — then the routers dispatch between the fast and the capable
 * racks. A rack keeps its current checkpoint unless the new one is clearly better (a reload
 * drains the rack).
 */
function assignTier(s: GameState, racks: Tower[], cands: Candidate[], demand: Demand[]): void {
  if (!racks.length || !cands.length) return
  const total = demand.reduce((n, d) => n + d.count, 0) || 1
  const mix = demand.map((d) => d.count / total)
  const residual = [...mix]
  const step = (1.6 * 1) / racks.length
  for (const t of racks) {
    let best: Candidate | null = null
    let bestScore = -Infinity
    let curScore = -Infinity
    const isCurrent = (c: Candidate): boolean => c.id === t.modelId && c.precision === t.precision
    for (const c of cands) {
      let sc = 0
      for (let i = 0; i < demand.length; i++)
        sc += mix[i] * c.values[i] + residual[i] * Math.max(0, c.values[i])
      if (isCurrent(c)) curScore = sc
      if (sc > bestScore + 1e-9) {
        bestScore = sc
        best = c
      }
    }
    if (!best) continue
    if (!isCurrent(best) && bestScore > curScore + 0.02 * Math.abs(curScore) + 1e-6) loadCandidate(s, t, best)
    const chosen = cands.find(isCurrent) ?? best
    for (let i = 0; i < demand.length; i++)
      if (chosen.values[i] > 0) residual[i] = Math.max(0, residual[i] - mix[i] * step)
  }
}

/** Deploy the forecast's best checkpoints across the fleet, tier by tier. */
function deployFleet(s: GameState, demand: Demand[], waveSec: number, surge: boolean): void {
  const guard = guardLatency(s)
  const fleetLanes = servers(s).reduce((n, t) => n + Math.max(1, rackPlan(s, loadoutOf(s, t)).lanes), 0)
  const byTier = new Map<string, Tower[]>()
  for (const t of servers(s)) {
    if (!t.hwId) continue
    const list = byTier.get(t.hwId) ?? []
    list.push(t)
    byTier.set(t.hwId, list)
  }
  for (const [hwId, racks] of byTier) {
    racks.sort((a, b) => distToCore(a) - distToCore(b) || a.id - b.id)
    assignTier(s, racks, candidatesFor(s, hwId, demand, guard, fleetLanes, waveSec, surge), demand)
  }
}

/* ------------------------------------------------------------------ *
 *  Cash, power and cooling                                             *
 * ------------------------------------------------------------------ */

/**
 * The cash kept back for the coming wave's bill: it accrues every tick while token income only
 * arrives as answers complete (and the contract at the end), so the treasury must carry the
 * whole projected bill (the next-wave preview: busy burn × the wave's length) plus a margin.
 */
function reserveOf(s: GameState): number {
  const p = previewNextWave(s)
  const bill = p && p.estDurationSec > 0 ? p.projectedBill : fleetBurnPerSec(s) * 60
  return 8 + bill * 1.15
}

const spendable = (s: GameState): number => s.meters.cash - reserveOf(s)

const drawKw = (s: GameState): number => s.towers.reduce((n, t) => n + towerPowerKw(s, t), 0)
const airHeatKw = (s: GameState): number =>
  s.towers.reduce((n, t) => n + (towerLiquidCooled(s, t) ? 0 : towerHeatKw(s, t)), 0)

/**
 * Grid / cooling headroom kept over the fleet's draw. A telegraphed incident is already live in
 * the build phase (a curtailed feed or a failed chiller shows in the capacity read here), so only
 * a small margin is needed: a cut never lands as a surprise mid-wave.
 */
const CAPACITY_HEADROOM = 1.05

/**
 * Keep the grid feed and the air-cooling pool above the fleet's draw plus the `addKw` about to be
 * added (and CAPACITY_HEADROOM). Returns false when it could not (no spendable cash or tiles).
 */
function ensureCapacity(s: GameState, addKw: number): boolean {
  const headroom = CAPACITY_HEADROOM
  updatePower(s)
  let guard = 0
  while (drawKw(s) + addKw > s.power.cap / headroom - 0.2 && guard++ < 40) {
    if (spendable(s) < buildCost(s, TOWER_DEFS.power) || !place(s, 'power', infraSlot(s))) return false
    updatePower(s)
  }
  guard = 0
  while (airHeatKw(s) + addKw > coolingPools(s).air.cap / headroom - 0.2 && guard++ < 40) {
    if (spendable(s) < buildCost(s, TOWER_DEFS.cooling) || !place(s, 'cooling', infraSlot(s))) return false
    updatePower(s)
  }
  return true
}

/* ------------------------------------------------------------------ *
 *  Fleet — how many racks, and how fast.                               *
 * ------------------------------------------------------------------ */

/** Racks to hold before the coming wave: grows with the campaign (the board has ~145 lane tiles). */
function rackTarget(waveNo: number): number {
  if (waveNo <= 1) return 7
  if (waveNo <= 3) return 8
  if (waveNo <= 6) return 10
  if (waveNo <= 10) return 12
  if (waveNo <= 20) return 12 + Math.round((waveNo - 10) * 0.8)
  return Math.min(64, 20 + Math.round((waveNo - 20) * 0.7))
}

/** The highest rack tier worth climbing to at this point of the campaign. */
function tierCap(s: GameState, waveNo: number): number {
  if (waveNo < 4) return tierIdx('hw_standard')
  if (waveNo < 14) return tierIdx('hw_perf')
  if (waveNo < 20) return tierIdx('hw_frontier')
  // an 8-GPU box runs a small model as eight copies (no parallelism research needed); the
  // Blackwell box is worth it once Tensor Parallelism lets the big MoEs span its GPUs
  if (waveNo < 36 || !s.infra.par.tp) return tierIdx('hw_pod')
  return tierIdx('hw_superpod')
}

/**
 * The tier a new rack is built at (Edge, then climbed in place): Standard through the opening
 * waves, an H100-class rack once code completion's 200 ms TTFT and the long prompts outgrow L40S.
 */
function baseTier(waveNo: number): string {
  return waveNo < 8 ? 'hw_standard' : 'hw_perf'
}

/** Build new racks up to `target` at the base tier (on the tiles `slot` picks, default core-first). */
function growFleet(
  s: GameState,
  waveNo: number,
  target: number,
  slot: (s: GameState) => Slot | undefined = laneSlot,
): void {
  const tier = baseTier(waveNo)
  // the rack and its climb at today's prices (a supply incident raises every build cost)
  const cost = Math.round(HARDWARE_DEFS[tier].cost * s.modifiers.buildCost) + 2
  const kw = (HARDWARE_DEFS[tier].tdpWatts / 1000) * 0.8
  let guard = 0
  while (servers(s).length < target && guard++ < 30) {
    if (spendable(s) < cost + 2) return
    if (!ensureCapacity(s, kw)) return
    if (spendable(s) < cost + 2) return // the power / cooling it needed came first
    const p = slot(s)
    if (!p || !tryBuild(s, 'srv_edge', p.col, p.row)) return
    const t = s.towers[s.towers.length - 1]
    while (tierIdx(t.hwId) < tierIdx(tier) && upgradeHardware(s, t.id)) {
      /* climb to the base tier */
    }
  }
}

/** The single-GPU top of the ladder: below it every rack climbs, slowest first. */
const SINGLE_GPU_TOP = 'hw_frontier'

/** Climb one rack one tier while the spend keeps the reserve (and the power / cooling it draws). */
function climb(s: GameState, t: Tower, waveNo: number): 'done' | 'skip' | 'broke' {
  if (tierIdx(t.hwId) >= tierCap(s, waveNo) || !HARDWARE_TIERS[tierIdx(t.hwId) + 1]) return 'skip'
  const cost = hardwareUpgradeCost(s, t)
  if (spendable(s) < cost + 2) return 'broke'
  const next = HARDWARE_DEFS[HARDWARE_TIERS[tierIdx(t.hwId) + 1]]
  const addKw = ((next.tdpWatts - (HARDWARE_DEFS[t.hwId!]?.tdpWatts ?? 0)) / 1000) * 0.8
  if (!ensureCapacity(s, addKw)) return 'broke'
  if (spendable(s) < cost + 2) return 'broke'
  return upgradeHardware(s, t.id) ? 'done' : 'skip'
}

/**
 * Up to the single-GPU top (H200) the slowest rack climbs first — a rack that cannot serve the
 * mix in time (code completion's TTFT, a long prompt's prefill, a big batch's KV) costs more than
 * a fast one gains — and the demo saves for it rather than buying anything faster.
 */
function upgradeSlowest(s: GameState, waveNo: number): void {
  const top = Math.min(tierCap(s, waveNo), tierIdx(SINGLE_GPU_TOP))
  const slow = servers(s)
    .filter((t) => tierIdx(t.hwId) < top)
    .sort((a, b) => tierIdx(a.hwId) - tierIdx(b.hwId) || distToCore(a) - distToCore(b))
  for (const t of slow) {
    while (tierIdx(t.hwId) < top) {
      const r = climb(s, t, waveNo)
      if (r === 'broke') return
      if (r === 'skip') break
    }
  }
}

/**
 * Past the single-GPU top, the 8-GPU boxes go where all four lanes meet: the core-nearest racks
 * climb first (eight copies per tile where every request passes), one tier per rack per pass.
 */
function upgradeCore(s: GameState, waveNo: number): void {
  for (let pass = 0; pass < 3; pass++) {
    let did = false
    for (const t of servers(s).sort((a, b) => distToCore(a) - distToCore(b) || a.id - b.id)) {
      if (tierIdx(t.hwId) < tierIdx(SINGLE_GPU_TOP)) continue
      const r = climb(s, t, waveNo)
      if (r === 'broke') return
      if (r === 'done') did = true
    }
    if (!did) return
  }
}

/* ------------------------------------------------------------------ *
 *  Support buildings                                                    *
 * ------------------------------------------------------------------ */

/** Guardrails and routers go by the core (every lane); caches go among the racks. */
function ensureSupport(s: GameState, id: string, want: number, minSpend = 0): void {
  const central = TOWER_DEFS[id].kind === 'guardrail' || TOWER_DEFS[id].kind === 'router'
  let guard = 0
  while (countDef(s, id) < want && guard++ < 12) {
    if (spendable(s) < buildCost(s, TOWER_DEFS[id]) + minSpend) return
    if (!ensureCapacity(s, (TOWER_DEFS[id].powerDraw ?? 0) + 0.1)) return
    if (spendable(s) < buildCost(s, TOWER_DEFS[id])) return
    if (!place(s, id, central ? supportSlot(s, TOWER_DEFS[id].kind) : laneSlot(s))) return
  }
}

/** Does the coming wave carry a hazard of this kind? */
const carries = (demand: Demand[], h: SafetyHazard): boolean => demand.some((d) => (d.hazards[h] ?? 0) > 0)

/** What selling the encoder guards would refund (60% of their price). */
const encoderRefund = (s: GameState): number =>
  s.towers.filter((t) => t.def.id === 'guard_encoder').reduce((n, t) => n + Math.round(t.def.cost * 0.6), 0)

/** The coming wave's novel-attack share (the adaptive variants a classifier guard mostly misses). */
const novelShare = (demand: Demand[]): number => demand.reduce((m, d) => Math.max(m, d.novelShare), 0)

/**
 * The guardrail stage on every lane. A Prompt Guard encoder screens jailbreaks (and, once
 * Red-Team Eval has calibrated it, injection) for 92 ms; as the era's attacks turn adaptive it
 * misses most novel variants, so once they are a large share the stage becomes a generative
 * judge (Llama Guard): one family, about the same input latency after FP8, every hazard
 * including harmful content, and it keeps its recall on novel attacks. Keeping both would stack
 * their latency on code completion's 200 ms TTFT, so the encoder is retired when the judge lands.
 */
function planGuards(s: GameState, demand: Demand[], waveNo: number): void {
  const hazardous = carries(demand, 'jailbreak') || carries(demand, 'injection') || carries(demand, 'harmful')
  const judge =
    (s.upgrades['eval_redteam'] ?? 0) >= 1 && (novelShare(demand) >= 0.25 || carries(demand, 'harmful'))
  if (
    judge &&
    !countDef(s, 'guard_llm') &&
    spendable(s) + encoderRefund(s) >= buildCost(s, TOWER_DEFS.guard_llm) + 4
  ) {
    for (const t of s.towers.filter((x) => x.def.id === 'guard_encoder')) sellTower(s, t.id)
    ensureSupport(s, 'guard_llm', 1)
  }
  if (!countDef(s, 'guard_llm') && (hazardous || waveNo >= 4)) ensureSupport(s, 'guard_encoder', 1)
}

/* ------------------------------------------------------------------ *
 *  Research                                                             *
 * ------------------------------------------------------------------ */

/**
 * The serving stack in dependency order. Continuous batching, FP8 weights and paged KV first
 * (FP8 halves the bytes every decode step reads and doubles the prefill rate on FP8 Tensor
 * Cores; paged KV recovers the memory a batch needs), the Studio unlocks, prefix caching and
 * chunked prefill (long prompts stop stalling the decodes that share their lane), then the
 * parallelism a multi-GPU checkpoint needs and the throughput stack. Chunked prefill and P/D
 * disaggregation exclude each other: a fleet whose every rack serves the whole mix gains more
 * from overlapping prompts with decodes than from a dedicated prefill pool, which must also
 * ingest every cohort stream's prompt. INT4 is skipped: its long-context tax lands on exactly
 * the long prompts the late waves carry. Multi-step scheduling comes last: it amortizes the
 * scheduler over several decode steps but makes a new prompt wait for the next scheduler call.
 */
const INFRA_PRIORITY = [
  'inf_batching',
  'inf_wq_fp8',
  'inf_paged',
  'r_pt_lora',
  'inf_prefix',
  'r_pt_pref',
  'r_pt_cai',
  'inf_chunked',
  'r_pt_rl',
  'inf_flash',
  'inf_kvquant_fp8',
  'inf_par_tp',
  'inf_spec',
  'inf_par_dp',
  'inf_par_ep',
  'inf_routing',
  'inf_engine_sglang',
  'inf_offload',
  'inf_par_pp',
  'inf_wq_nvfp4',
  'inf_multistep',
] as const

const EVAL_PRIORITY = ['r_eval_redteam_v1', 'r_eval_redteam_v2'] as const

/** Start the next project on each research track that is free and affordable in Data. */
function planResearch(s: GameState): void {
  for (const list of [INFRA_PRIORITY, EVAL_PRIORITY]) {
    for (const id of list) {
      const def = RESEARCH_DEFS[id]
      if (!def || researchOwned(s, def)) continue
      if (s.research[researchTrackOf(def)]) break
      if (!researchUnlocked(s, def)) continue // a conflict or a Blackwell-only node: skip it
      // a project lends racks while it trains: on a tiny fleet, let serving come first
      if (servers(s).length < 6) break
      if (s.data >= def.dataCost) startResearch(s, id)
      break
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Post-Training Studio                                                *
 * ------------------------------------------------------------------ */

type Target = 'reasoning' | 'agentic' | 'safety'

/** Owned derived checkpoints from one method (and target). */
function derivedOf(s: GameState, method: string, target?: Target): ModelDef[] {
  return Object.values(s.derivedModels).filter(
    (m) => m.lineage?.method === method && (target === undefined || m.lineage?.target === target),
  )
}

/** The checkpoints the fleet runs, most-deployed first. */
function deployedBases(s: GameState): ModelDef[] {
  const n = new Map<string, number>()
  for (const t of servers(s)) if (t.modelId) n.set(t.modelId, (n.get(t.modelId) ?? 0) + 1)
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => resolveModel(s, id))
    .filter((m): m is ModelDef => !!m)
}

/** A fast MoE body worth specialising: few active params, fits an H100 at FP8, strong on the axis. */
function specialistBody(s: GameState, axis: 'agentic' | 'reasoning'): ModelDef | null {
  const fp8 = createState(0)
  fp8.infra.quant.fp8 = true
  let best: ModelDef | null = null
  let bestScore = -Infinity
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id)
    // a body that answers interactive traffic instantly, so the specialist can take every lane
    if (!m || m.origin !== 'base' || m.paramsActiveB > 6 || m.thinking === 'always') continue
    if (!serverDeployable(fp8, loadout(fp8, 'hw_perf', id))) continue
    const proj = computeDerivedFields(m, METHOD_RECIPES.grpo, axis, 2, null)
    const sc =
      proj.qualityBy[axis] + (m.qualityByInstant?.coding ?? m.qualityBy.coding) * 0.2 - m.paramsActiveB
    if (sc > bestScore) {
      bestScore = sc
      best = m
    }
  }
  return best
}

/** Gain one GRPO run would add on the axis (the body's capacity ceiling bounds it). */
function grpoGain(m: ModelDef, axis: 'agentic' | 'reasoning'): number {
  return computeDerivedFields(m, METHOD_RECIPES.grpo, axis, 2, null).qualityBy[axis] - m.qualityBy[axis]
}

/**
 * One Studio run per build phase, in survival order: a safe-completion (CAI) version of the
 * fleet's workhorse (fewer over-refusals, more attacks self-handled), an agentic specialist on a
 * fast MoE body (stacked while each run still adds), a reasoning specialist, and CAI on each
 * specialist. A run whose projected gain is negligible is skipped.
 */
function planStudio(s: GameState): void {
  if (s.research.posttrain || !countKind(s, 'lab') || s.data < 30) return
  const unlocked = (tech: string): boolean => (s.upgrades[tech] ?? 0) > 0
  const run = (base: ModelDef, method: 'grpo' | 'cai', target: Target): boolean =>
    canPostTrain(s, [base.id], method, target) && startPostTrain(s, [base.id], method, target, 2)
  const caiOf = (m: ModelDef): boolean =>
    m.lineage?.method === 'cai' || derivedOf(s, 'cai').some((d) => d.lineage?.baseModelIds[0] === m.id)

  // 1. a safe-completion version of the checkpoint most of the fleet runs
  const work = deployedBases(s)[0]
  if (unlocked('pt_cai') && work && !caiOf(work) && run(work, 'cai', 'safety')) return
  if (!unlocked('pt_rl')) return
  // 2. the agentic specialist on a fast MoE body, stacked while a run still adds
  const agentic = derivedOf(s, 'grpo', 'agentic').sort((a, b) => b.qualityBy.agentic - a.qualityBy.agentic)[0]
  if (!agentic) {
    const body = specialistBody(s, 'agentic')
    if (body && run(body, 'grpo', 'agentic')) return
  } else if ((agentic.lineage?.depth ?? 1) < 3 && grpoGain(agentic, 'agentic') >= 3) {
    if (run(agentic, 'grpo', 'agentic')) return
  }
  // 3. the reasoning specialist
  if (!derivedOf(s, 'grpo', 'reasoning').length) {
    const body = specialistBody(s, 'reasoning')
    if (body && run(body, 'grpo', 'reasoning')) return
  }
  // 4. safe-completion versions of the specialists, the strongest first
  if (unlocked('pt_cai')) {
    const specs = [...derivedOf(s, 'grpo', 'agentic'), ...derivedOf(s, 'grpo', 'reasoning')].sort(
      (a, b) => b.qualityBy.agentic + b.qualityBy.reasoning - (a.qualityBy.agentic + a.qualityBy.reasoning),
    )
    for (const m of specs) if (!caiOf(m) && run(m, 'cai', 'safety')) return
  }
}

/* ------------------------------------------------------------------ *
 *  The build phase                                                      *
 * ------------------------------------------------------------------ */

/** Prepare the build phase before wave `waveNo` (1-based). */
export function demoPlan(s: GameState, waveNo: number): void {
  updatePower(s)
  const { demand, seconds, surgeLane } = forecast(s)
  // the Training Lab opens research and the Studio; buy it once a first fleet stands (it needs no lane)
  if (waveNo >= 2 && !countKind(s, 'lab') && spendable(s) >= buildCost(s, TOWER_DEFS.lab))
    place(s, 'lab', infraSlot(s))
  // a guard before the first jailbreaks, a generative judge once the attacks turn adaptive
  planGuards(s, demand, waveNo)
  // a floor of racks for coverage; a telegraphed single-entry surge (every request walks one
  // lane) reinforces that lane before anything else; then no rack too slow for the mix
  growFleet(s, waveNo, Math.ceil(rackTarget(waveNo) * 0.6))
  if (surgeLane !== null) {
    const lane = surgeLane
    growFleet(s, waveNo, servers(s).length + Math.ceil(rackTarget(waveNo) * SURGE_REINFORCE), (x) =>
      surgeSlot(x, lane),
    )
  }
  upgradeSlowest(s, waveNo)
  ensureSupport(s, 'router', waveNo >= 3 ? (waveNo >= 20 ? 3 : waveNo >= 10 ? 2 : 1) : 0, 4)
  growFleet(s, waveNo, rackTarget(waveNo))
  upgradeCore(s, waveNo)
  ensureSupport(s, 'cache', waveNo >= 5 ? Math.min(10, 1 + Math.floor(waveNo / 6)) : 0, 6)
  ensureCapacity(s, 0)
  planResearch(s)
  planStudio(s)
  deployFleet(s, demand, seconds, surgeLane !== null)
  updatePower(s)
}

/** Run one wave to its end (or `maxBoardSeconds`). */
export function demoRunWave(s: GameState, maxBoardSeconds = 240): void {
  let t = 0
  while (s.phase === 'wave' && t < maxBoardSeconds) {
    step(s)
    t += SIM_DT
  }
}

/** Play a whole campaign on one seed. */
export function demoAutoplay(seed: number): { reached: number; won: boolean; state: GameState } {
  const s = createState(seed)
  startGame(s)
  let reached = 0
  for (let w = 1; w <= WAVES.length; w++) {
    demoPlan(s, w)
    if (!startWave(s)) break
    demoRunWave(s)
    if (s.phase === 'lost') break
    reached = w
    if (s.phase === 'won') return { reached, won: true, state: s }
  }
  return { reached, won: s.phase === 'won', state: s }
}

/** Continue a won run into `surges` endless surges; returns how many it survived. */
export function demoAutoplayEndless(s: GameState, surges: number): number {
  if (!continueEndless(s)) return 0
  let survived = 0
  for (let i = 0; i < surges; i++) {
    demoPlan(s, WAVES.length + i + 1)
    if (!startWave(s)) break
    demoRunWave(s)
    if (s.phase === 'lost') break
    survived++
  }
  return survived
}

export function demoDeployedModelIds(s: GameState): Set<string> {
  const ids = new Set<string>()
  for (const t of s.towers) if (t.def.kind === 'server' && t.modelId) ids.add(t.modelId)
  return ids
}

export function nextDemoWaveNumber(s: GameState): number {
  return s.endless ? s.waveIndex + 1 : s.waveIndex + 2
}

export function demoCanContinueCampaign(s: GameState): boolean {
  return s.phase === 'build' && (s.endless || nextDemoWaveNumber(s) <= WAVES.length)
}
