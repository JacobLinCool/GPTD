import { GRID_COLS, GRID_ROWS, LAT_CLASS_SLO, RACK_UTILIZATION, SIM_DT } from '../config'
import type { CapabilityAxis, GameState, Tower } from '../core/types'
import {
  continueEndless,
  cycleRackRole,
  deployModel,
  hardwareUpgradeCost,
  startGame,
  startWave,
  tryBuild,
  upgradeHardware,
} from './actions'
import {
  HARDWARE_DEFS,
  HARDWARE_TIERS,
  METHOD_RECIPES,
  RESEARCH_DEFS,
  RESEARCH_TARGET_SECONDS,
  TOWER_DEFS,
  WAVES,
} from './content'
import {
  loadout,
  loadoutOf,
  serverDeployable,
  serverFitsMemory,
  serverHeat,
  serverPerUserDecodeTokS,
  serverPower,
} from './effects'
import { computeDerivedFields, resolveModel } from './models'
import { CORE_TILE, isBuildable, isPathTile } from './pathing'
import { updatePower } from './power'
import {
  canPostTrain,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
  startPostTrain,
  startResearch,
} from './research'
import { step } from './sim'
import { createState } from './state'

interface Slot {
  col: number
  row: number
}

type Role = 'small' | 'general' | 'frontier'

function adjacentToLane(col: number, row: number): boolean {
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) if (isPathTile(col + dc, row + dr)) return true
  return false
}

function buildSlots(): { lane: Slot[]; back: Slot[]; core: Slot[] } {
  const lane: Slot[] = []
  const back: Slot[] = []
  const core: Slot[] = []
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!isBuildable(c, r)) continue
      if (adjacentToLane(c, r)) {
        lane.push({ col: c, row: r })
        if (Math.abs(c - CORE_TILE.col) <= 5 && Math.abs(r - CORE_TILE.row) <= 4) core.push({ col: c, row: r })
      } else back.push({ col: c, row: r })
    }
  }
  const distToCore = (s: Slot) => Math.abs(s.col - CORE_TILE.col) + Math.abs(s.row - CORE_TILE.row)
  lane.sort((a, b) => distToCore(a) - distToCore(b) || a.col - b.col || a.row - b.row)
  core.sort((a, b) => distToCore(a) - distToCore(b) || a.col - b.col || a.row - b.row)
  return { lane, back, core }
}

const SLOTS = buildSlots()

const CLEAR_LINES: { axis: CapabilityAxis; at: number }[] = [
  { axis: 'chat', at: 18 },
  { axis: 'general', at: 38 },
  { axis: 'general', at: 50 },
  { axis: 'coding', at: 56 },
  { axis: 'reasoning', at: 82 },
  { axis: 'agentic', at: 82 },
]

const RESEARCH_PRIORITY = [
  'inf_batching',
  'inf_paged',
  'inf_wq_fp8',
  'r_pt_lora',
  'r_pt_pref',
  // CAI (Constitutional AI) is the Pareto safety lever: a derived model that is
  // BOTH high-safety AND low-over-refusal (safe-completion). Over-refusal SLA bleed
  // is the dominant late-game killer, so unlock CAI early — right after preference
  // optimization — so the Studio can ship the bulk safe-completion workhorse.
  'r_pt_cai',
  'r_pt_rl',
  'r_eval_redteam_v1',
  'inf_prefix', // prefix cache: lifts the cache-hit ceiling (prefixLevel) — the agent-wall lever
  'inf_flash', // +context headroom (shrinks the context-stretch penalty) + KV ceiling
  'r_eval_redteam_v2',
  'inf_kvquant_fp8',
  // P/D disaggregation chain (par_tp → par_pp → disagg): dedicated prefill/decode
  // pools tune parallelism for the heavy reason/agent decode AND satisfy the showcase
  // (prefill+decode roles). disagg requires par_pp requires par_tp — keep them in
  // dependency order so planResearch can actually reach disagg.
  'inf_par_tp',
  'inf_par_pp',
  'inf_disagg',
  'inf_spec',
  'inf_multistep',
  // THROUGHPUT MULTIPLIERS (the SLA / surge-survival lever). The late-game bosses are
  // extreme-VOLUME floods (single-lane surges, "doublings") that tip the heavy reason/agent
  // decode past its per-token SLO → mass slo_miss → SLA death. The engine tier and extra
  // batch slots lift decode tok/s FLEET-WIDE for free (no tiles, no power), so they are the
  // cheapest way to raise the throughput ceiling the surges push against:
  //   • SGLang → TensorRT-LLM engine: ×1.10 → ×1.25 on every prefill+decode (engineMul).
  //   • Data-Parallelism + Multi-Step: +throughput (speedMul) and +batch slots (concurrency).
  'inf_engine_sglang',
  'inf_engine_trtllm',
  'inf_par_dp',
  'inf_routing',
  // NOTE: inf_wq_int4 / inf_kvquant_int4 are deliberately OMITTED. INT4 weights add a
  // flat −6 quality penalty on any context > 8000 tokens (int4ContextPenalty), which
  // pushes the extreme-decode `reason` lane (6000+ output tokens, NOT cacheable) below
  // its tier-scaled line → `bad` answers → trust death. We have ample VRAM at FP8 with
  // small MoEs, so the memory win is not worth the reasoning-quality hit.
] as const

function countKind(s: GameState, kind: string): number {
  return s.towers.filter((t) => t.def.kind === kind).length
}

function countDef(s: GameState, id: string): number {
  return s.towers.filter((t) => t.def.id === id).length
}

function freeSlot(s: GameState, list: Slot[]): Slot | undefined {
  return list.find((p) => !s.towers.some((t) => t.col === p.col && t.row === p.row))
}

function place(s: GameState, defId: string, slot: Slot | undefined): boolean {
  if (!slot) return false
  return tryBuild(s, defId, slot.col, slot.row)
}

function estDraw(s: GameState): number {
  return s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' ? serverPower(s, loadoutOf(s, t)) : (t.def.powerDraw ?? 0)),
    0,
  )
}

function estHeat(s: GameState): number {
  return s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' ? serverHeat(s, loadoutOf(s, t)) : (t.def.heat ?? 0)),
    0,
  )
}

function ensureCapacity(s: GameState, addDraw: number, addHeat: number): void {
  updatePower(s)
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  let guard = 0
  while (estDraw(s) + addDraw > s.power.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'power', infraSlot())) break
    updatePower(s)
  }
  guard = 0
  while (estHeat(s) + addHeat > s.cooling.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    // a big heat deficit (the big-iron fleet) is far cheaper in TILES via a Liquid Cooling
    // Loop (+60 kW) than air Cooling (+8 kW) — on the slot-limited board, tiles are scarce,
    // so use the loop once the gap is large and a loop already exists (the hard gate).
    const gap = estHeat(s) + addHeat - s.cooling.cap
    const useLiquid = gap > 16 && hasTowerKind(s, 'cooling_liquid') && s.meters.cash >= TOWER_DEFS.cooling_liquid.cost + 10
    if (!place(s, useLiquid ? 'cooling_liquid' : 'cooling', infraSlot())) break
    updatePower(s)
  }
}

function reserveOf(s: GameState): number {
  // Cushion scaled by fleet power draw — a proxy for the next wave's wall-clock operating
  // bill (charged DURING the wave, after the build phase has spent). The old 32 + draw·9 was
  // a ≈7× over-reserve that STARVED the mid-game fleet build (income-limited waves leave most
  // of their cash locked as reserve → too thin to absorb the wave-50+ surge floods). A leaner
  // cushion lets the fleet grow faster → more income → survive the surges. But the EARLY game
  // runs on a razor-thin cash float (~$45), where a too-lean reserve lets one extra building
  // tip a wave into bankruptcy — so scale the per-draw factor DOWN as the fleet (and its cash
  // cushion) grows: conservative when small/poor, lean when large/rich.
  const draw = estDraw(s)
  // conservative when small/poor (the razor-thin early float — one extra building tips a
  // wave into bankruptcy), lean when large/rich so the mid/late throughput build is not
  // starved. The tiers trade these two failure modes against each other.
  const perDraw = draw < 8 ? 9 : draw < 25 ? 7 : 5.5
  return 28 + draw * perDraw
}

function hasTowerKind(s: GameState, kind: string): boolean {
  return s.towers.some((t) => t.def.kind === kind)
}

function hasHardware(s: GameState, hwId: string): boolean {
  return s.towers.some((t) => t.def.kind === 'server' && t.hwId === hwId)
}

function serverTargetFor(waveAbout: number): number {
  // past the campaign's teaching arc the gauntlet's volume climbs without bound,
  // so the autoplay keeps adding lane capacity; the finite board (177 buildable slots) is
  // the real ceiling. In the LATE game we CAP the server count well below the board so the
  // remaining tiles go to COOLING/POWER headroom (incident-roll resilience) and a core
  // big-iron throughput cluster — a thinner fleet of denser, better-cooled racks survives
  // the surge+cooling-cut bosses that a wall-to-wall single-GPU fleet cannot.
  if (waveAbout >= 55) return 96
  if (waveAbout >= 17) return Math.min(96, 26 + (waveAbout - 17) * 3)
  if (waveAbout >= 14) return 23
  if (waveAbout >= 11) return 20
  if (waveAbout >= 8) return 17
  if (waveAbout >= 6) return 14
  if (waveAbout >= 4) return 11
  if (waveAbout >= 2) return 9
  return 7
}

function showcaseReserve(s: GameState, waveAbout: number): number {
  let r = reserveOf(s)
  if (waveAbout >= 12 && !hasTowerKind(s, 'cooling_liquid')) r += TOWER_DEFS.cooling_liquid.cost
  if (waveAbout >= 15 && !hasHardware(s, 'hw_pod')) r += HARDWARE_DEFS.hw_pod.cost - HARDWARE_DEFS.hw_frontier.cost
  return r
}

function lanesCleared(s: GameState, id: string): number {
  const q = resolveModel(s, id)?.qualityBy
  if (!q) return 0
  return CLEAR_LINES.reduce((n, l) => n + (q[l.axis] >= l.at ? 1 : 0), 0)
}

function minAxis(s: GameState, id: string): number {
  const q = resolveModel(s, id)?.qualityBy
  if (!q) return 0
  return Math.min(q.chat, q.coding, q.reasoning, q.general)
}

/**
 * Total capability margin a model carries ABOVE the (tier-scaled) clear lines on the
 * hard axes — what distinguishes a re120/ag109 specialist from a re103/ag86 bulk
 * model that BOTH "clear" the base-82 line. Rewarding this margin gets the high-
 * capability GRPO specialist deployed on the racks that catch reason/agent traffic,
 * so the hardest late-tier lanes stop shipping `bad` answers (the trust drain).
 */
function capabilityMargin(m: NonNullable<ReturnType<typeof resolveModel>>): number {
  const q = m.qualityBy
  let n = 0
  for (const l of CLEAR_LINES) n += Math.max(0, q[l.axis] - l.at)
  return n
}

/**
 * Rank a model for a rack. `capWeight` tilts the trade-off: a BIG rack (frontier/pod)
 * that fronts the hard reason/agent lanes weights raw capability margin higher (it
 * must clear the late-tier wall); a BULK rack weights low over-refusal higher (it
 * soaks benign volume where every wrong refusal bleeds SLA). lanesCleared stays the
 * dominant term, then a blend of capability-margin and an over-refusal penalty.
 */
function modelScore(s: GameState, id: string, capWeight = 0.5): number {
  const m = resolveModel(s, id)
  if (!m) return -1
  // OVER-REFUSAL is the dominant late-game SLA drain (one over-refused rag needs ~20
  // clean serves to undo). Penalize it hard on bulk racks; a high-safety model also
  // gets a small bonus (it self-handles hazards → no trust breach, lets us shed
  // guardrails). On a big rack we lean toward capability margin so the specialist
  // that clears the late-tier reason/agent wall wins.
  //
  // AGENT-WALL BONUS (the dominant late-game TRUST drain): a model whose served agentic
  // clears the wave-80+ wall (servedAgentic ≳ 110.6) stops the agent lane shipping all-
  // `bad` answers (the trust death that killed the demo at wave 65). This bonus is gated
  // to BIG racks ONLY (scaled by capWeight): a big rack should run the wall-clearer, but
  // a bulk rack must keep the FAST low-over-refusal CAI workhorse for benign throughput
  // and SLA — the apex's lane coverage is force-pinned onto its share of racks separately
  // (pinApexRacks), so the bulk-deploy path never needs to chase the agent wall itself.
  const wall = projServedAgentic(m) >= AGENT_WALL_AG ? 1 : 0
  const wallBonus = wall * 2600 * capWeight
  return (
    lanesCleared(s, id) * 1000 +
    wallBonus +
    capabilityMargin(m) * (0.4 + 0.9 * capWeight) +
    minAxis(s, id) * 0.15 -
    m.alignment.overRefusal * (700 - 400 * capWeight) +
    Math.min(m.alignment.safety, 90) * 0.3 -
    m.paramsActiveB * 0.01
  )
}

/** A frontier-or-bigger rack fronts the hard reason/agent lanes → weight capability. */
function rackCapWeight(hwId: string | undefined): number {
  if (hwId === 'hw_pod' || hwId === 'hw_superpod') return 1.0
  if (hwId === 'hw_frontier') return 0.85
  if (hwId === 'hw_perf') return 0.5
  return 0.3
}

function modelScoreOn(s: GameState, hwId: string | undefined, id: string): number {
  const lo = loadout(s, hwId, id)
  const tpotMs = 1000 / Math.max(1e-6, serverPerUserDecodeTokS(s, lo, 1))
  return (
    modelScore(s, id, rackCapWeight(hwId)) +
    (tpotMs <= LAT_CLASS_SLO.IN.tpotMs ? 100_000 : 0) -
    tpotMs * 0.5
  )
}

/** Per-user decode TPOT (ms) at b=1 for a model on a rack — the interactive-SLO proxy. */
function tpotMsOf(s: GameState, hwId: string | undefined, id: string): number {
  return 1000 / Math.max(1e-6, serverPerUserDecodeTokS(s, loadout(s, hwId, id), 1))
}

function bestFit(s: GameState, hwId: string | undefined): string | null {
  // A SLOW agent-WALL apex (a heavy ≈27-31B dense wall-clearer) is RESERVED for the
  // explicit pinApexRacks pass — letting it win the generic bulk-deploy path floods the
  // benign lanes with slo_miss. But a FAST wall-clearer (the safe-apex: a ≈3B-active MoE
  // GRPO×3+CAI checkpoint, servedAgentic ≈ 115, over-refusal ≈ 0.06, ≈4 ms TPOT) is the
  // ideal UNIVERSAL workhorse — it clears the wall AND keeps the interactive SLO AND
  // barely over-refuses — so it is allowed to win the bulk path too. Only slow
  // wall-clearers are deferred to the pin pass (with a fallback if nothing else fits).
  let best: string | null = null
  let bestScore = -1
  let fallback: string | null = null
  let fallbackScore = -1
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id)
    if (!m || !serverDeployable(s, loadout(s, hwId, id))) continue
    const score = modelScoreOn(s, hwId, id)
    const slowWall = isWallClearer(s, id) && tpotMsOf(s, hwId, id) > LAT_CLASS_SLO.IN.tpotMs
    if (slowWall) {
      if (score > fallbackScore) {
        fallbackScore = score
        fallback = id
      }
      continue
    }
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best ?? fallback
}

/** A model whose served agentic clears the late-game agent WALL (servedAgentic ≳ 110.6). */
function isWallClearer(s: GameState, id: string | undefined): boolean {
  if (!id) return false
  const m = resolveModel(s, id)
  return !!m && projServedAgentic(m) >= AGENT_WALL_AG
}

function deployBest(s: GameState, towerId: number, hwId: string | undefined, curId: string | undefined): void {
  // PIN PROTECTION: never auto-downgrade a rack that already runs an agent-WALL clearer
  // to a model that does NOT clear the wall — that is exactly the swap (back to the fast
  // bulk) that would re-open the agent lane to `bad` answers. The apex pin pass owns
  // those racks; modernizeFleet may only swap a wall-clearer for a BETTER wall-clearer.
  if (curId && isWallClearer(s, curId)) {
    const t = bestWallFit(s, hwId)
    if (t && t !== curId && modelScoreOn(s, hwId, t) > modelScoreOn(s, hwId, curId)) deployModel(s, towerId, t)
    return
  }
  const target = bestFit(s, hwId)
  if (target && target !== curId && (!curId || modelScoreOn(s, hwId, target) > modelScoreOn(s, hwId, curId))) {
    deployModel(s, towerId, target)
  }
}

/** Best wall-clearing model that fits this rack (or null if none fits) — keeps a pin a wall-clearer. */
function bestWallFit(s: GameState, hwId: string | undefined): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const id of Object.keys(s.models)) {
    if (!isWallClearer(s, id)) continue
    if (!serverDeployable(s, loadout(s, hwId, id))) continue
    const score = modelScoreOn(s, hwId, id)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

/** All base models that fit a given rack class at FP8 (the Studio's candidate pool). */
function fp8Bases(s: GameState, hwId: string) {
  const fp8 = createState(0)
  fp8.infra.weightQuantBytes = 1
  return Object.keys(s.models)
    .map((id) => resolveModel(s, id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.origin === 'base')
    .filter((m) => serverFitsMemory(fp8, loadout(fp8, hwId, m.id)))
}

/** Lanes a base's qualityBy clears (the CLEAR_LINES count). */
function baseLanesCleared(m: NonNullable<ReturnType<typeof resolveModel>>): number {
  return CLEAR_LINES.reduce((n, l) => n + (m.qualityBy[l.axis] >= l.at ? 1 : 0), 0)
}

type DM = NonNullable<ReturnType<typeof resolveModel>>

/** Dry-run a post-train run on a base: the projected derived snapshot. */
function projTrain(
  base: DM,
  method: 'grpo' | 'cai',
  target: 'reasoning' | 'agentic' | 'safety',
  effort: number,
): DM {
  const f = computeDerivedFields(base, METHOD_RECIPES[method], target, effort, null)
  // a synthetic ModelDef carrying the projected snapshot (for scoring only).
  return { ...base, ...f, origin: 'derived' } as DM
}

/** Owned derived checkpoints matching a method (and optional target). */
function derived(s: GameState, method: string, target?: string): DM[] {
  return Object.values(s.derivedModels).filter(
    (m) => m.lineage?.method === method && (target === undefined || m.lineage?.target === target),
  )
}

/** Does this model clear a (tier-scaled) line on the named axis? */
function clearsLine(m: DM, axis: 'reasoning' | 'agentic', line: number): boolean {
  return m.qualityBy[axis] >= line
}

/**
 * The agent lane's quality gate (verified): effQ = servedAgentic − contextGap·0.45;
 * contextGap = max(0, reqContext − serverContext). With FlashAttention + Prefix-cache
 * research, serverContext for any ≥128K-window model caps at 176. The campaign's agent
 * request is `difficulty.agentic 82 × tierComplexity` and `context 70 × tierContext`:
 *   • waves 65-79: difficulty 98.4, reqContext 186 → need servedAgentic ≳ 103
 *   • waves 80-100: difficulty 98.4, reqContext 203 → need servedAgentic ≳ 110.6 (the WALL)
 * A SINGLE GRPO-agentic run (depth 1) tops out at servedAgentic ≈ 106 — it clears 65-79
 * but FAILS the 80+ wall, which is exactly where the demo died (the agent lane shipped
 * all-`bad` → trust death). STACKING GRPO-agentic runs lifts it: each run adds ≈ +6
 * agentic. The winning base is a FAST low-active-param MoE (≈3B active, e.g. Qwen3.6-35B-
 * A3B) — three stacked GRPO runs reach servedAgentic ≈ 116 (WALL cleared with margin)
 * while keeping decode fast (≈4 ms TPOT → meets the interactive SLO, no slo_miss flood).
 * It fits a Standard rack at FP8, so the apex deploys WIDELY and CHEAPLY across every
 * lane (spatial coverage) WITHOUT an expensive GLM Pod cluster.
 */
const AGENT_WALL_AG = 110.6
/** How many stacked GRPO-agentic runs make the apex (each ≈ +6 agentic; 3 clears the wall). */
const APEX_GRPO_DEPTH = 3

/** Project the apex snapshot from a base: APEX_GRPO_DEPTH stacked GRPO-agentic runs. */
function projApex(base: DM): DM {
  let m = base
  for (let i = 0; i < APEX_GRPO_DEPTH; i++) m = projTrain(m, 'grpo', 'agentic', 2.0)
  return m
}

/** Served agentic on a fully-researched FP8 fleet (Flash + Prefix-cache: serverContext 176). */
function projServedAgentic(m: DM): number {
  // serverQualityVs(agentic) = qualityBy.agentic − int4Tax(0 at FP8) − alignmentTax.
  // alignmentTax is a small over-refusal/refusal-style trade; approximate via qualityBy
  // (the real deploy path re-checks it). Use the raw axis minus a safe-completion-aware
  // tax floor so the projection is conservative.
  return m.qualityBy.agentic - alignmentTaxApprox(m)
}

/** Conservative alignment-tax approximation for projection ranking (real tax applied at serve). */
function alignmentTaxApprox(m: DM): number {
  // safe-completion models pay little; hard-refusal / high-over-refusal pay more.
  const or = m.alignment.overRefusal
  return m.alignment.refusalStyle === 'safe-completion' ? or * 4 : 2 + or * 8
}

/** The owned GRPO-agentic apex specialist that clears the agent WALL, if any. */
function apexAgentic(s: GameState): DM | undefined {
  return derived(s, 'grpo', 'agentic')
    .filter((m) => projServedAgentic(m) >= AGENT_WALL_AG)
    .sort((a, b) => b.qualityBy.agentic - a.qualityBy.agentic)[0]
}

/**
 * The owned GRPO-agentic specialist that is the best SEED for the next stacked GRPO run
 * toward the apex — i.e. the deepest agentic lineage that does NOT yet clear the wall.
 * Picking the deepest keeps the chain progressing one run per build phase.
 */
function seedAgentic(s: GameState): DM | undefined {
  return derived(s, 'grpo', 'agentic')
    .filter((m) => projServedAgentic(m) < AGENT_WALL_AG)
    .sort((a, b) => (b.lineage?.depth ?? 0) - (a.lineage?.depth ?? 0) || b.qualityBy.agentic - a.qualityBy.agentic)[0]
}

/**
 * The Post-Training Studio queue. The posttrain track is shared (one run per build
 * phase), so runs are committed in strict SURVIVAL priority. The endgame fleet wants
 * EVERY deployed model to be BOTH low-over-refusal (no SLA bleed) AND high-capability
 * enough to clear the late-tier reason/agent walls (no `bad`-answer trust drain). The
 * §2.4 Pareto tool that delivers low over-refusal is CAI (safe-completion); the tool
 * that clears the agent WALL is a STACK of GRPO-agentic runs (each ≈ +6 agentic):
 *
 *   1. CAI bulk workhorse — strongest lane-clearing MoE that fits a Standard rack at
 *      FP8, low active params (fast decode → meets the interactive SLO). Kills the
 *      over-refusal SLA bleed AND self-handles hazards (no trust breach, fewer guards).
 *      Used until the safe-apex (step 3) supersedes it on the bulk racks.
 *   2. the AGENT-WALL APEX — APEX_GRPO_DEPTH (3) stacked GRPO-agentic runs on a FAST
 *      pa≈3 MoE base → servedAgentic ≈ 116, the only frontier/standard-deployable model
 *      that clears the wave-80+ agent wall (servedAgentic ≳ 110.6) WITHOUT a GLM Pod
 *      cluster. Committed one run per build phase; satisfies the agentic showcase req.
 *   3. CAI on the apex → the SAFE-COMPLETION agent-wall workhorse (ag ≈ 115, or ≈ 0.06,
 *      sf ≈ 95). Fast, low-over-refusal AND wall-clearing → the UNIVERSAL endgame model
 *      deployed on every rack; this is what finally stops the `agent`-lane `bad` answers
 *      that were the dominant late trust drain (the demo's wave-65 trust death).
 *   4. GRPO-REASONING specialist (re ≈ 114) for the hardest reason lane + showcase req.
 *   5. CAI it too → a safe high-reason workhorse; then keep refreshing as the roster
 *      and FP8/headroom let stronger bases in.
 */
function maybeStudio(s: GameState): void {
  if (s.research.posttrain) return
  if (!hasTowerKind(s, 'lab')) return
  if (s.data < 22) return
  const caiUnlocked = (s.upgrades['pt_cai'] ?? 0) > 0
  const grpoUnlocked = (s.upgrades['pt_rl'] ?? 0) > 0
  const RE_LINE = 100 // reason 82 × tier-12 1.20

  const start = (baseId: string, method: 'grpo' | 'cai', target: 'reasoning' | 'agentic' | 'safety', effort: number): boolean => {
    if (!canPostTrain(s, [baseId], method, target)) return false
    return startPostTrain(s, [baseId], method, target, effort)
  }

  // --- 1. the bulk CAI safe-completion workhorse (top survival priority) ---
  if (caiUnlocked && derived(s, 'cai').filter((m) => !m.lineage || m.lineage.depth <= 1).length < 1) {
    const base = fp8Bases(s, 'hw_standard')
      .filter((m) => baseLanesCleared(m) >= 5)
      .sort(
        (a, b) =>
          baseLanesCleared(b) - baseLanesCleared(a) ||
          a.paramsActiveB - b.paramsActiveB || // fast decode (fits the interactive SLO)
          b.quality - a.quality,
      )[0]
    if (base && s.data >= 22 && start(base.id, 'cai', 'safety', 2.0)) return
  }

  // --- 2. the AGENT-WALL apex, in APEX_GRPO_DEPTH stacked GRPO-agentic runs ---
  // A single GRPO-agentic tops out at servedAgentic ≈ 106 and FAILS the wave-80+ wall
  // (servedAgentic ≳ 110.6). Each stacked GRPO run adds ≈ +6 agentic, so a FAST low-
  // active-param MoE base (≈3B active) reaches servedAgentic ≈ 116 in three runs while
  // keeping ≈4 ms TPOT (meets the interactive SLO → deployable widely without slo_miss).
  // Pick the STANDARD-fitting base whose apex projection clears the wall, preferring the
  // FASTEST such base (low active params) so the deployed apex never bleeds SLA.
  const apex = apexAgentic(s)
  const seed = seedAgentic(s)
  if (grpoUnlocked && !apex) {
    if (!seed) {
      // step 2a — commit the FIRST GRPO-agentic run on the best apex base. Prefer the
      // fastest base whose apex projection CLEARS the wall; fall back to highest apex ag.
      const std = fp8Bases(s, 'hw_standard')
      const front = fp8Bases(s, 'hw_frontier')
      const pickFrom = std.length ? std : front
      const scored = pickFrom.map((m) => ({ m, apexAg: projServedAgentic(projApex(m)) }))
      const clears = scored.filter((c) => c.apexAg >= AGENT_WALL_AG)
      const pool = clears.length ? clears : scored
      const ranked = pool.sort(
        (a, b) =>
          a.m.paramsActiveB - b.m.paramsActiveB || // fastest apex first (interactive SLO)
          b.apexAg - a.apexAg,
      )
      const best = ranked[0]
      if (best && s.data >= 24 && start(best.m.id, 'grpo', 'agentic', 2.0)) return
    } else {
      // step 2b — stack the NEXT GRPO-agentic run on the seed → progress toward the apex.
      if (s.data >= 12 && start(seed.id, 'grpo', 'agentic', 2.0)) return
    }
  }

  // --- 3. CAI on the apex agentic specialist → safe-completion agent-wall workhorse.
  //         (Drops over-refusal to ~0.06 for SLA, keeps servedAgentic above the wall.) ---
  if (caiUnlocked && apex && !derived(s, 'cai').some((m) => m.lineage?.baseModelIds?.[0] === apex.id)) {
    if (s.data >= 24 && projServedAgentic(projTrain(apex, 'cai', 'safety', 2.0)) >= AGENT_WALL_AG &&
        start(apex.id, 'cai', 'safety', 2.0))
      return
  }

  // --- 4. a GRPO-reasoning specialist (hardest reason lane + showcase req) ---
  const reSpec = derived(s, 'grpo', 'reasoning')[0]
  if (grpoUnlocked && !reSpec) {
    const cand = fp8Bases(s, 'hw_frontier').map((m) => ({ m, p: projTrain(m, 'grpo', 'reasoning', 2.0) }))
    const clears = cand.filter((c) => clearsLine(c.p, 'reasoning', RE_LINE))
    const pool = clears.length ? clears : cand
    const best = pool.sort(
      (a, b) => a.m.paramsActiveB - b.m.paramsActiveB || b.p.qualityBy.reasoning - a.p.qualityBy.reasoning,
    )[0]
    if (best && s.data >= 24 && start(best.m.id, 'grpo', 'reasoning', 2.0)) return
  }

  // --- 5. CAI on the reasoning specialist → safe high-reason workhorse ---
  if (caiUnlocked && reSpec && !derived(s, 'cai').some((m) => m.lineage?.baseModelIds?.[0] === reSpec.id)) {
    if (s.data >= 24 && start(reSpec.id, 'cai', 'safety', 2.0)) return
  }
}

function fp8Ready(s: GameState): boolean {
  return s.infra.weightQuantBytes <= 1
}

function ownsBigSpecialist(s: GameState): boolean {
  return Object.values(s.derivedModels).some((m) => m.paramsTotalB >= 100)
}

function bigRackCount(s: GameState): number {
  return s.towers.filter(
    (t) => t.def.kind === 'server' && (t.hwId === 'hw_frontier' || t.hwId === 'hw_pod' || t.hwId === 'hw_superpod'),
  ).length
}

function chooseRole(s: GameState, waveAbout: number): Role {
  if (waveAbout < 7) return 'general'
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return 'general'
  const servers = countKind(s, 'server')
  const wantBigFrac = waveAbout >= 12 ? 0.3 : 0.18
  return bigRackCount(s) < Math.ceil((servers + 1) * wantBigFrac) ? 'frontier' : 'general'
}

function roleCost(s: GameState, role: Role, waveAbout = 0): number {
  const bc = (v: number) => Math.round(v * s.modifiers.buildCost)
  const edge = HARDWARE_DEFS.hw_edge.cost
  if (role === 'small') return bc(edge)
  if (role === 'frontier') return bc(HARDWARE_DEFS.hw_frontier.cost)
  const top = waveAbout >= 6 ? HARDWARE_DEFS.hw_perf.cost : HARDWARE_DEFS.hw_standard.cost
  return bc(edge) + bc(top - edge)
}

function roleHardware(role: Role) {
  return role === 'frontier'
    ? HARDWARE_DEFS.hw_frontier
    : role === 'small'
      ? HARDWARE_DEFS.hw_edge
      : HARDWARE_DEFS.hw_standard
}

function roleDrawKw(role: Role): number {
  return (roleHardware(role).tdpWatts / 1000) * RACK_UTILIZATION
}

function lastTower(s: GameState) {
  return s.towers[s.towers.length - 1]
}

function buildRole(s: GameState, role: Role, slot: Slot | undefined, waveAbout = 0): boolean {
  if (!slot) return false
  if (role === 'frontier') {
    if (!tryBuild(s, 'srv_frontier', slot.col, slot.row)) return false
    const t = lastTower(s)
    deployBest(s, t.id, t.hwId, t.modelId)
    return true
  }
  if (role === 'small') return tryBuild(s, 'srv_edge', slot.col, slot.row)
  if (!tryBuild(s, 'srv_edge', slot.col, slot.row)) return false
  const t = lastTower(s)
  if (!upgradeHardware(s, t.id)) return false
  if (waveAbout >= 6) upgradeHardware(s, t.id)
  deployBest(s, t.id, t.hwId, t.modelId)
  return true
}

function planResearch(s: GameState): void {
  const fleetFlops = s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' && t.hwId ? (HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : 0),
    0,
  )
  for (const id of RESEARCH_PRIORITY) {
    const def = RESEARCH_DEFS[id]
    if (!def || researchOwned(s, def)) continue
    if (s.research[researchTrackOf(def)]) continue
    if (def.compute / RESEARCH_TARGET_SECONDS > fleetFlops * 0.3) break
    const strongest = s.towers.reduce(
      (m, t) => (t.def.kind === 'server' && t.hwId ? Math.max(m, HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : m),
      0,
    )
    const reqSeconds = def.compute / Math.max(1, strongest)
    if (strongest > 130 && reqSeconds > 15 && fleetFlops - strongest < 700) break
    if (researchUnlocked(s, def) && s.data >= def.dataCost) startResearch(s, id)
    break
  }
}

function modernizeFleet(s: GameState): void {
  for (const t of s.towers) {
    if (t.def.kind !== 'server' || !t.modelId) continue
    deployBest(s, t.id, t.hwId, t.modelId)
  }
  const edges = s.towers.filter((t) => t.def.kind === 'server' && t.hwId === 'hw_edge')
  for (let i = 0; i + 2 < edges.length; i++) {
    if (s.meters.cash < reserveOf(s) + 12) break
    const t = edges[i]
    if (upgradeHardware(s, t.id)) {
      if (s.infra.kv.utilization >= 0.96 && s.meters.cash > reserveOf(s) + 30) upgradeHardware(s, t.id)
      deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
  if (s.infra.kv.utilization >= 0.96) {
    for (const t of s.towers) {
      if (t.def.kind !== 'server' || t.hwId !== 'hw_standard') continue
      if (s.meters.cash < reserveOf(s) + 22) break
      if (upgradeHardware(s, t.id)) deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
}

function ensureSupport(s: GameState, kind: string, want: number, slots: Slot[], floor?: number, cap = 6): void {
  let guard = 0
  const minCash = floor ?? reserveOf(s) + 25
  while (countDef(s, kind) < want && s.meters.cash > minCash && guard++ < cap) {
    ensureCapacity(s, 1, 1)
    if (!place(s, kind, freeSlot(s, slots))) break
  }
}

/**
 * Cache SATURATION — still a key lever against the late agent wall, but no longer a
 * free stored-answer bypass. A prefix-cache hit skips PREFILL and gives instant TTFT,
 * then the response still decodes on the model and still faces quality / safety /
 * window gates. The cacheable lanes (embed/chat/comp/rag/agent) are benign-heavy and
 * prefix-rich; with prefix-cache research (prefixLevel 2 → +0.4 per cache, capped at
 * 70%) overlapping caches materially cut prefill contention and queue time.
 */
function cacheTarget(s: GameState, waveAbout: number): number {
  if (waveAbout < 4) return 0
  if (waveAbout < 6) return 1
  if (waveAbout < 8) return 2
  const servers = countKind(s, 'server')
  // Caches are the AGENT-lane SLO lever: an agent request is CACHEABLE with a 6000-token
  // prompt, and prefill serializes the rack (one prompt at a time, super-linear in length).
  // On a single-lane SURGE the agent prompts queue for prefill → TTFT/E2EL blow past the
  // 9 s bound → slo_miss flood (the wave-70/80 boss deaths). A prefix-cache HIT skips that
  // prefill entirely (instant TTFT), so a DENSE cache layer over the lanes keeps the agent
  // lane inside SLO under a surge — even after the cache nerf (a hit still relieves prefill
  // contention; it just no longer frees the decode). So keep caches dense (≈1 per 2.2 racks).
  const ratio = waveAbout >= 55 ? 2.0 : 2.5
  return Math.min(48, Math.max(3, Math.ceil(servers / ratio)))
}

/**
 * APEX PINNING — the spatial half of the agent-wall fix. The stacked-GRPO agentic apex
 * (servedAgentic ≈ 115, fits a Standard rack at FP8) is the frontier-cheap model that
 * clears the wave-80+ agent wall, but a request is decoded by WHATEVER rack it passes
 * first: a single bulk rack between spawn and an apex rack can decode an agent request to
 * a `bad` answer before it ever reaches one. So the apex must COVER the lanes. (Belt-and-
 * braces: the bulk model is usually the safe-apex too, which ALSO clears the wall — but
 * this pin guarantees coverage even when an older bulk lingers on some racks.)
 *
 * We pin the apex on a wave-scaled FRACTION of server racks, chosen by their position
 * along the lanes (the towers themselves are placed core-first via SLOTS.lane, so taking
 * an EVENLY-STRIDED subset spreads the apex from the spawn end to the core). The fraction
 * climbs with the agent volume: the wall first bites at wave ~65, and waves 80+ are
 * agent-heavy, so by then a large share of the fleet must clear it. Apex racks survive
 * modernizeFleet via the wall-clearer pin protection in deployBest.
 */
function apexFraction(waveAbout: number): number {
  if (waveAbout < 40) return 0
  if (waveAbout < 55) return 0.25
  if (waveAbout < 65) return 0.45
  if (waveAbout < 80) return 0.65
  return 0.82 // waves 80+: agent-heavy AND the hardest wall → most racks must clear it
}

function pinApexRacks(s: GameState, waveAbout: number): void {
  const apexId = bestWallFit(s, 'hw_standard') ?? bestWallFit(s, 'hw_frontier')
  if (!apexId) return
  const servers = s.towers.filter((t) => t.def.kind === 'server')
  if (!servers.length) return
  // sort racks by distance-to-core (spawn-end first) so a strided subset spreads coverage.
  const ordered = servers
    .map((t) => ({ t, d: Math.abs(t.col - CORE_TILE.col) + Math.abs(t.row - CORE_TILE.row) }))
    .sort((a, b) => b.d - a.d || a.t.id - b.t.id)
    .map((x) => x.t)
  const want = Math.round(ordered.length * apexFraction(waveAbout))
  const already = ordered.filter((t) => isWallClearer(s, t.modelId)).length
  if (already >= want) return
  // pick an evenly-strided subset of `want` racks so coverage is spread along the lanes.
  const stride = ordered.length / Math.max(1, want)
  const picks = new Set<number>()
  for (let i = 0; i < want; i++) picks.add(ordered[Math.min(ordered.length - 1, Math.floor(i * stride))].id)
  let placed = already
  for (const t of ordered) {
    if (placed >= want) break
    if (isWallClearer(s, t.modelId)) continue
    if (!picks.has(t.id)) continue
    const fit = bestWallFit(s, t.hwId)
    if (fit && serverDeployable(s, loadout(s, t.hwId, fit))) {
      deployModel(s, t.id, fit)
      placed++
    }
  }
  // if strided picks didn't fill the quota (some couldn't fit), top up from the spawn end.
  for (const t of ordered) {
    if (placed >= want) break
    if (isWallClearer(s, t.modelId)) continue
    const fit = bestWallFit(s, t.hwId)
    if (fit && serverDeployable(s, loadout(s, t.hwId, fit))) {
      deployModel(s, t.id, fit)
      placed++
    }
  }
}

/**
 * INCIDENT-RESILIENCE HEADROOM — the random per-wave incident roll can slash capacity:
 * a cooling-failure cuts coolingCap ×0.55, a power-spike cuts powerCap similarly. If the
 * fleet's draw/heat sits near the cap, that cut browns out or thermally throttles half the
 * fleet mid-surge → decode collapses → mass slo_miss → SLA death (exactly the wave-80+
 * boss deaths). So in the late game we build POWER and COOLING headroom so the fleet still
 * fits AFTER a ×0.55 cut: target cap ≥ used / 0.55 ≈ 1.85× used (with a small margin).
 * Liquid Cooling Loops (+60 kW) carry the heat headroom cheaply in tiles.
 */
function ensureIncidentHeadroom(s: GameState, waveAbout: number): void {
  if (waveAbout < 40) return
  updatePower(s)
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  const drawTarget = estDraw(s) / 0.55 + 6 // survive a power-spike cut
  const heatTarget = estHeat(s) / 0.55 + 6 // survive a cooling-failure cut
  let guard = 0
  while (s.power.cap < drawTarget && s.meters.cash > reserveOf(s) + TOWER_DEFS.power.cost + 30 && guard++ < 16) {
    if (!place(s, 'power', infraSlot())) break
    updatePower(s)
  }
  guard = 0
  while (s.cooling.cap < heatTarget && s.meters.cash > reserveOf(s) + TOWER_DEFS.cooling_liquid.cost + 30 && guard++ < 16) {
    if (!place(s, 'cooling_liquid', infraSlot())) break
    updatePower(s)
  }
}

function ensureShowcaseResources(s: GameState, waveAbout: number): void {
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  if (waveAbout >= 5 && countKind(s, 'power') < 1 && s.meters.cash > reserveOf(s) + TOWER_DEFS.power.cost + 10)
    place(s, 'power', infraSlot())
  if (waveAbout >= 5 && countKind(s, 'cooling') < 1 && s.meters.cash > reserveOf(s) + TOWER_DEFS.cooling.cost + 10)
    place(s, 'cooling', infraSlot())
  if (
    waveAbout >= 12 &&
    !hasTowerKind(s, 'cooling_liquid') &&
    s.meters.cash > reserveOf(s) + TOWER_DEFS.cooling_liquid.cost + 25
  ) {
    place(s, 'cooling_liquid', infraSlot())
  }
}

function ensurePodShowcase(s: GameState, waveAbout: number): void {
  if (waveAbout < 14 || !hasTowerKind(s, 'cooling_liquid') || hasHardware(s, 'hw_pod')) return
  // Stand up ONE Pod (8× H200) for throughput + the showcase by upgrading the
  // strongest existing rack up the tiers (perf → frontier → pod). A Pod packs ~8×
  // the bandwidth per board tile, so this also lifts the throughput ceiling the
  // late gauntlet pushes against — relevant now that cheap strong MoEs let the
  // fleet otherwise coast on single H100s and stall on SLA, never needing big iron.
  let guard = 0
  while (!hasHardware(s, 'hw_pod') && guard++ < 3) {
    const t = s.towers
      .filter((x) => x.def.kind === 'server' && (x.hwId === 'hw_perf' || x.hwId === 'hw_frontier'))
      .sort((a, b) => HARDWARE_TIERS.indexOf(b.hwId ?? '') - HARDWARE_TIERS.indexOf(a.hwId ?? ''))[0]
    if (!t) return
    const cost = hardwareUpgradeCost(s, t)
    if (s.meters.cash <= cost + reserveOf(s)) return // keep the full wave-operating-bill buffer
    if (!upgradeHardware(s, t.id)) return
    deployBest(s, t.id, t.hwId, t.modelId)
  }
}

/**
 * LATE-GAME THROUGHPUT SCALER — the SLA half of the endgame. Once the agent wall is
 * cleared (trust holds), the remaining killer is a SURGE boss (single-lane-surge funnels
 * the WHOLE wave through one ingress lane): the racks in that lane are swamped and the
 * reason/agent decode (6000+ output tokens) tips over the per-token SLO → mass slo_miss.
 *
 * The board is slot-limited (~100 tiles), so we cannot just add more single-GPU racks.
 * The lever is DENSITY: upgrade the racks CLOSEST to the core (where all four lanes
 * converge, so one rack catches surge traffic from ANY lane) up the tiers to Pod (8× H200,
 * ~8× decode bandwidth per tile) and Superpod (8× B200, ~19×). A handful of big-iron racks
 * straddling the convergence point absorb a single-lane flood that a thin lane of perf
 * racks cannot. We gate the spend on a generous cash buffer (the economy is cash-rich by
 * the late game) and build the power/cooling to match.
 */
function coreServersByProximity(s: GameState): Tower[] {
  return s.towers
    .filter((t) => t.def.kind === 'server')
    .map((t) => ({ t, d: Math.abs(t.col - CORE_TILE.col) + Math.abs(t.row - CORE_TILE.row) }))
    .sort((a, b) => a.d - b.d || a.t.id - b.t.id)
    .map((x) => x.t)
}

function scaleCoreThroughput(s: GameState, waveAbout: number): void {
  if (waveAbout < 36) return
  const tierIdx = (id: string | undefined) => HARDWARE_TIERS.indexOf(id ?? '')
  const upTo = (t: Tower, targetIdx: number, extraReserve: number): boolean => {
    while (tierIdx(t.hwId) < targetIdx) {
      const reserve = reserveOf(s) + extraReserve
      const cost = hardwareUpgradeCost(s, t)
      if (s.meters.cash <= cost + reserve) return false
      const next = HARDWARE_TIERS[tierIdx(t.hwId) + 1]
      const kw = (HARDWARE_DEFS[next]?.tdpWatts ?? 0) / 1000
      ensureCapacity(s, kw, kw) // power/cooling headroom for the bigger draw first
      if (!upgradeHardware(s, t.id)) return false // could not afford the power/cooling
      deployBest(s, t.id, t.hwId, t.modelId)
    }
    return true
  }
  const core = coreServersByProximity(s)

  // STEP 1 — upgrade EVERY perf rack to FRONTIER (H200). hw_frontier draws the SAME power as
  // hw_perf (0.56 kW) but carries 43% more HBM bandwidth (4.8 vs 3.35 TB/s) → a power-FREE,
  // power-cap-friendly decode-throughput boost across the whole fleet. This is the most
  // tile/power-efficient throughput lever, so it comes first — with a SMALL cash buffer (the
  // perf→frontier step is cheap, ≈12 credits, and power-NEUTRAL, so it is low-risk and worth
  // doing even on a thin-cash seed where it is the only affordable way to lift bandwidth).
  const frontierIdx = tierIdx('hw_frontier')
  // gate on a modest absolute cash floor (not the full draw-scaled reserve): the step is
  // power-neutral and cheap, and on a thin-cash seed it is the ONLY affordable bandwidth lift
  // — letting the draw-scaled reserve block it would leave that seed stuck on slow perf racks.
  const frontierFloor = Math.max(40, reserveOf(s) * 0.6)
  for (const t of core) {
    if (tierIdx(t.hwId) >= frontierIdx) continue
    const cost = hardwareUpgradeCost(s, t)
    if (s.meters.cash <= cost + frontierFloor) break
    if (upgradeHardware(s, t.id)) deployBest(s, t.id, t.hwId, t.modelId)
  }

  // STEP 2 — a CORE big-iron cluster (Pod → Superpod) at the lane-convergence point. These
  // pack ~8-19× a single GPU's bandwidth per tile to absorb a single-lane SURGE that funnels
  // the whole wave through one ingress lane. They are power-hungry, so keep the cluster small
  // and gate it on power headroom (ensureCapacity stops the climb when power tiles run out).
  if (!hasTowerKind(s, 'cooling_liquid')) return
  const want = waveAbout >= 80 ? 26 : waveAbout >= 70 ? 18 : waveAbout >= 58 ? 12 : 6
  const topIdx = tierIdx(waveAbout >= 64 ? 'hw_superpod' : 'hw_pod')
  const podIdx = tierIdx('hw_pod')
  let big = core.filter((t) => tierIdx(t.hwId) >= podIdx).length
  let guard = 0
  for (const t of core) {
    if (big >= want || guard++ > 120) break
    if (tierIdx(t.hwId) >= topIdx) continue
    if (!upTo(t, topIdx, 240)) return // out of budget/power — a poorer seed stops here
    if (tierIdx(t.hwId) >= podIdx) big++
  }
}

function assignDisaggRoles(s: GameState, _waveAbout = 0): void {
  if (!s.infra.disagg) return
  const servers = s.towers.filter((t) => t.def.kind === 'server')
  // Disaggregation pins racks to a single phase, which can STARVE the heavy reason/agent
  // lanes (a decode-pinned rack ignores prefill and vice-versa) — and pinning a large
  // fraction measurably HURTS the demo (the agent lane needs both phases per request, and a
  // dedicated pool gave no net benefit in testing). So pin the MINIMUM (one prefill + one
  // decode) for the throughput showcase only, leaving the rest general-purpose (both phases).
  if (servers.length < 12) return
  if (!servers.some((t) => t.role === 'prefill')) {
    const t = servers.find((x) => x.role === undefined)
    if (t) cycleRackRole(s, t.id)
  }
  if (!servers.some((t) => t.role === 'decode')) {
    const t = servers.find((x) => x.role === undefined)
    if (t) {
      cycleRackRole(s, t.id)
      cycleRackRole(s, t.id)
    }
  }
}

function ensureBigRacks(s: GameState, waveAbout: number, want: number): void {
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return
  const bigReserve = reserveOf(s) // keep the full wave-operating-bill buffer (was 20 + draw·3)
  let guard = 0
  while (bigRackCount(s) < want && guard++ < 4) {
    const perf = s.towers.find((t) => t.def.kind === 'server' && t.hwId === 'hw_perf')
    if (perf && s.meters.cash > hardwareUpgradeCost(s, perf) + bigReserve) {
      if (upgradeHardware(s, perf.id)) {
        deployBest(s, perf.id, perf.hwId, perf.modelId)
        continue
      }
    }
    if (s.meters.cash < roleCost(s, 'frontier', waveAbout) + bigReserve) break
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    ensureCapacity(s, roleDrawKw('frontier'), roleDrawKw('frontier'))
    if (!buildRole(s, 'frontier', slot, waveAbout)) break
  }
}

export function demoPlan(s: GameState, waveAbout: number): void {
  updatePower(s)
  if (waveAbout >= 2 && countKind(s, 'lab') < 1 && s.meters.cash > 55) place(s, 'lab', freeSlot(s, SLOTS.back))
  ensureShowcaseResources(s, waveAbout)
  modernizeFleet(s)
  let pre = 0
  while (
    countKind(s, 'server') < 7 &&
    s.meters.cash > roleCost(s, 'general', waveAbout) + reserveOf(s) &&
    pre++ < 8
  ) {
    ensureCapacity(s, roleDrawKw('general'), roleDrawKw('general'))
    if (!buildRole(s, 'general', freeSlot(s, SLOTS.lane), waveAbout)) break
  }
  ensureSupport(s, 'router', waveAbout >= 8 ? 2 : waveAbout >= 2 ? 1 : 0, SLOTS.lane)
  const guardSlots = SLOTS.core.length ? SLOTS.core : SLOTS.lane
  ensureSupport(s, 'guard_encoder', waveAbout >= 14 ? 3 : waveAbout >= 10 ? 2 : waveAbout >= 4 ? 1 : 0, guardSlots, 20)
  ensureSupport(s, 'guard_llm', waveAbout >= 14 ? 1 : 0, guardSlots, 30)
  ensureSupport(s, 'cache', cacheTarget(s, waveAbout), SLOTS.lane, reserveOf(s) + 8, 20)
  ensureBigRacks(s, waveAbout, waveAbout >= 12 ? 3 : waveAbout >= 9 ? 2 : 1)
  ensurePodShowcase(s, waveAbout)
  const serverTarget = serverTargetFor(waveAbout)
  let guard = 0
  while (countKind(s, 'server') < serverTarget && s.meters.cash > showcaseReserve(s, waveAbout) + 15 && guard++ < 80) {
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    let role = chooseRole(s, waveAbout)
    if (role === 'frontier' && s.meters.cash < roleCost(s, 'frontier', waveAbout) + showcaseReserve(s, waveAbout))
      role = 'general'
    ensureCapacity(s, roleDrawKw(role), roleDrawKw(role))
    if (s.meters.cash < roleCost(s, role, waveAbout) + 5) break
    if (!buildRole(s, role, slot, waveAbout)) break
  }
  ensurePodShowcase(s, waveAbout)
  scaleCoreThroughput(s, waveAbout)
  ensureIncidentHeadroom(s, waveAbout)
  planResearch(s)
  maybeStudio(s)
  // Pin the apex agentic specialist across the lanes (spatial agent-wall coverage). Runs
  // AFTER modernizeFleet/build (which deploy the fast bulk) so it owns its share of racks;
  // deployBest's wall-clearer pin protection keeps those racks apex on later waves.
  pinApexRacks(s, waveAbout)
  assignDisaggRoles(s, waveAbout)
}

export function demoRunWave(s: GameState, maxBoardSeconds = 240): void {
  let t = 0
  while (s.phase === 'wave' && t < maxBoardSeconds) {
    step(s)
    t += SIM_DT
  }
}

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

export function demoAutoplayEndless(s: GameState, surges: number): number {
  if (!continueEndless(s)) return 0
  let survived = 0
  for (let i = 0; i < surges; i++) {
    demoPlan(s, WAVES.length + i)
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
