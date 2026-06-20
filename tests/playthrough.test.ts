import { describe, expect, it } from 'vitest'
import { GRID_COLS, GRID_ROWS, RACK_UTILIZATION, SIM_DT } from '../src/config'
import type { GameState } from '../src/core/types'
import {
  continueEndless,
  deployModel,
  hardwareUpgradeCost,
  startGame,
  startWave,
  tryBuild,
  upgradeHardware,
} from '../src/sim/actions'
import {
  HARDWARE_DEFS,
  METHOD_RECIPES,
  MODEL_DEFS,
  RESEARCH_DEFS,
  RESEARCH_TARGET_SECONDS,
  WAVES,
} from '../src/sim/content'
import {
  loadout,
  loadoutOf,
  serverDeployable,
  serverFitsMemory,
  serverHeat,
  serverPerUserDecodeTokS,
  serverPower,
} from '../src/sim/effects'
import { computeDerivedFields, resolveModel } from '../src/sim/models'
import { LAT_CLASS_SLO } from '../src/config'
import { CORE_TILE, isBuildable, isPathTile } from '../src/sim/pathing'
import { updatePower } from '../src/sim/power'
import {
  demoAutoplay as productionDemoAutoplay,
  demoCanContinueCampaign as productionDemoCanContinueCampaign,
  demoDeployedModelIds as productionDemoDeployedModelIds,
  nextDemoWaveNumber as productionNextDemoWaveNumber,
} from '../src/sim/demo'
import {
  canPostTrain,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
  startPostTrain,
  startResearch,
} from '../src/sim/research'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'

interface Slot {
  col: number
  row: number
}

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

function countKind(s: GameState, kind: string): number {
  return s.towers.filter((t) => t.def.kind === kind).length
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
  // infra prefers the back rows but spills onto lane-adjacent ground late game
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  let guard = 0
  while (estDraw(s) + addDraw > s.power.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'power', infraSlot())) break
    updatePower(s)
  }
  guard = 0
  while (estHeat(s) + addHeat > s.cooling.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'cooling', infraSlot())) break
    updatePower(s)
  }
}

// P3d: there are no cash UPGRADES left at all — the serving upgrades migrated to the
// s.infra research tree (P3c) and the safety upgrades to the Studio / eval track. All
// improvements are driven by RESEARCH_PRIORITY (infra + post-training + red-team eval).

/**
 * Cash buffer to bridge a wave's operating bill until income flows. In the real
 * credit economy (§6.6) racks are CHEAP to build (capex/1000: ~3–35 credits) and
 * the operating bill is modest, so the reserve is small — the binding constraint
 * is now SLO-meeting throughput (enough fast racks), not cash hoarding.
 *
 * P2 (§6.5): power is now REAL kW (a Standard rack ~0.28 kW vs the old abstract 3),
 * so the per-kW coefficient is scaled ~11× to keep the reserve in the same credit
 * range it had before — otherwise the fleet over-builds and never affords the Lab.
 */
function reserveOf(s: GameState): number {
  return 25 + estDraw(s) * 6.5
}

type Role = 'small' | 'general' | 'frontier'

/**
 * The per-axis difficulty lines a model must clear, keyed to the capability axis
 * combat judges (P3a: difficulty[primaryAxis] of the 9 archetypes).
 *   embed general 10 · jailbreak general 38 · batch general 40 · summ general 44 ·
 *   rag general 50 · chat chat 18 · comp coding 56 · reason reasoning 82 ·
 *   agent agentic 82.
 */
const CLEAR_LINES: { axis: 'chat' | 'coding' | 'reasoning' | 'general' | 'agentic'; at: number }[] = [
  { axis: 'chat', at: 18 }, // chat
  { axis: 'general', at: 38 }, // jailbreak / batch / summ (primaryAxis general)
  { axis: 'general', at: 50 }, // rag long-context QA (primaryAxis general)
  { axis: 'coding', at: 56 }, // comp (code completion)
  { axis: 'reasoning', at: 82 }, // reason (long CoT)
  { axis: 'agentic', at: 82 }, // agent (only frontier/self-trained clears)
]

/** Resolve a model by id (base OR a Studio-derived checkpoint). */
function mdef(s: GameState, id: string) {
  return resolveModel(s, id)
}

/** How many traffic lanes a checkpoint answers correctly — the real measure of value. */
function lanesCleared(s: GameState, id: string): number {
  const q = mdef(s, id)?.qualityBy
  if (!q) return 0
  return CLEAR_LINES.reduce((n, l) => n + (q[l.axis] >= l.at ? 1 : 0), 0)
}

/** A model's weakest axis — favours balanced checkpoints over lopsided ones at a tie. */
function minAxis(s: GameState, id: string): number {
  const q = mdef(s, id)?.qualityBy
  if (!q) return 0
  return Math.min(q.chat, q.coding, q.reasoning, q.general)
}

/** Ranking score: clear the most lanes, then be the most balanced, then the cheapest to serve. */
function modelScore(s: GameState, id: string): number {
  const m = mdef(s, id)
  if (!m) return -1
  return lanesCleared(s, id) * 1000 + minAxis(s, id) - m.paramsActiveB * 0.01
}

/**
 * SLO-aware ranking on a SPECIFIC rack (§6.6 P1): in the real economy a request
 * that misses its class TPOT earns ZERO cash (slo_miss). A model that is too
 * heavy for a rack's bandwidth therefore slo_misses interactive traffic and bleeds
 * the operating bill. So on a given rack, prefer a model whose b=1 per-user decode
 * meets the interactive (IN) TPOT bound — then fall back to raw capability.
 */
function modelScoreOn(s: GameState, hwId: string | undefined, id: string): number {
  const lo = loadout(s, hwId, id)
  const tpotMs = 1000 / Math.max(1e-6, serverPerUserDecodeTokS(s, lo, 1))
  // primary tier: does the model meet the interactive (IN) TPOT bound on this rack
  // (so its interactive traffic earns instead of slo_missing)? Among those that do,
  // pick the most capable; the −tpot tiebreaker favours the faster model so it
  // keeps headroom under real batching (which slows per-user below the b=1 rate).
  const meetsIN = tpotMs <= LAT_CLASS_SLO.IN.tpotMs
  return modelScore(s, id) + (meetsIN ? 100_000 : 0) - tpotMs * 0.5
}

/**
 * Open weights are free — the best model for a rack is the one that answers the
 * most traffic lanes AMONG those fast enough to meet the SLO on this rack (so it
 * earns, not slo_misses), then by capability (§6.6 P1).
 */
function bestFit(s: GameState, hwId: string | undefined): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id) // base OR a Studio-derived checkpoint
    if (!m || !serverDeployable(s, loadout(s, hwId, id))) continue
    const score = modelScoreOn(s, hwId, id)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

/** Deploy the best fitting+unlocked model on a rack, if it beats the current one. */
function deployBest(s: GameState, towerId: number, hwId: string | undefined, curId: string | undefined): void {
  const target = bestFit(s, hwId)
  if (target && target !== curId && (!curId || modelScoreOn(s, hwId, target) > modelScoreOn(s, hwId, curId))) {
    deployModel(s, towerId, target)
  }
}

/**
 * P3b: USE the Post-Training Studio. The closed ft_agent/pt_giga cards are gone,
 * so the autoplay MAKES its own specialists. Once GRPO is unlocked (r_pt_rl) it
 * trains, in order, a reasoning specialist then an agentic specialist (both GRPO
 * on the STRONGEST-IN-THAT-AXIS base a Frontier rack can host at FP8) — the
 * player-created replacements that carry the hard reasoning/agentic waves.
 *
 * P5 [H2/§6.4 — play WELL on the agent wall]: the base is chosen by the TARGET
 * axis, not overall quality. A competent player picks a base already strong in the
 * axis they specialise: a GRPO-agentic run on gpt-oss-120b (agentic 59) lands at
 * ~81 and STILL fails the agent line (82), whereas the same run on Nemotron-Super
 * (agentic 76, also a 120B that fits a 141 GB Frontier rack at FP8) reaches ~93 and
 * genuinely clears it. So the player-trained specialist actually closes the SWE
 * loop instead of shipping bad agentic answers — the §6.4 capability-compression
 * lesson made playable. Best-effort: canPostTrain guards everything.
 */
function maybeStudio(s: GameState): void {
  if (s.research.posttrain) return // track busy
  if ((s.upgrades['pt_rl'] ?? 0) === 0) return // GRPO not unlocked yet
  if (s.data < 24) return // keep a Data cushion for infra research
  // what have we already built?
  const targetsDone = new Set(Object.values(s.derivedModels).map((m) => m.lineage?.target))
  // reasoning first (carries waves 7/12/13…), then agentic (the SWE lane).
  const target: 'reasoning' | 'agentic' = !targetsDone.has('reasoning') ? 'reasoning' : 'agentic'
  if (targetsDone.has(target)) return
  // strongest base, IN THE TARGET AXIS, that a Frontier rack can host at FP8
  // (a 120B-class MoE fits 141 GB at 1 byte/param). Picking by the axis we are
  // about to specialise is what makes the run actually clear its lane (H2).
  const fp8 = createState(0)
  fp8.infra.weightQuantBytes = 1
  const base = Object.keys(s.models)
    .map((id) => resolveModel(s, id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.origin === 'base')
    .filter((m) => serverFitsMemory(fp8, loadout(fp8, 'hw_frontier', m.id)))
    .sort((a, b) => b.qualityBy[target] - a.qualityBy[target] || b.quality - a.quality)[0]
  if (!base) return
  if (canPostTrain(s, [base.id], 'grpo', target)) startPostTrain(s, [base.id], 'grpo', target, 1.5)
}

/** Has the fleet researched FP8 weight-quant (so a 120B-class checkpoint fits a 141 GB Frontier rack)? */
function fp8Ready(s: GameState): boolean {
  return s.infra.weightQuantBytes <= 1
}

/** Do we OWN a player-trained big specialist (a derived 100B+ checkpoint) worth a Frontier rack? */
function ownsBigSpecialist(s: GameState): boolean {
  return Object.values(s.derivedModels).some((m) => m.paramsTotalB >= 100)
}

/** Count Frontier-or-bigger racks (the only homes for a 120B FP8 specialist). */
function bigRackCount(s: GameState): number {
  return s.towers.filter(
    (t) => t.def.kind === 'server' && (t.hwId === 'hw_frontier' || t.hwId === 'hw_pod' || t.hwId === 'hw_superpod'),
  ).length
}

/**
 * Roles express hardware ambition (models are free): standard / frontier rack.
 * P1 (§6.6): an Edge L4 (0.3 TB/s) cannot meet the interactive chat TPOT even on
 * an 8B (~53 ms/token > 40 ms) → every interactive serve slo_misses and earns
 * ZERO. So the baseline rack is now Standard (L40S, 0.864 TB/s): an 8B clears IN
 * at ~18 ms and it is cheap (10 credits) in the real capex economy.
 *
 * P5: a Frontier rack is only worth its 35 credits once we can FILL it — i.e.
 * FP8 is researched AND we own a 120B-class specialist to deploy. Then the autoplay
 * stands a handful of them up to carry the hard reasoning/agentic lanes (the racks
 * that actually run the Studio's output). Without that, all frontier traffic is
 * served by base general models on cheap Standard/Performance racks.
 */
function chooseRole(s: GameState, waveAbout: number): Role {
  if (waveAbout < 7) return 'general'
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return 'general'
  // a small, growing target share of big racks to host the specialists.
  const servers = countKind(s, 'server')
  const wantBigFrac = waveAbout >= 12 ? 0.3 : 0.18
  if (bigRackCount(s) < Math.ceil((servers + 1) * wantBigFrac)) return 'frontier'
  return 'general'
}

/** Total cash to stand up a role: rack + in-place hardware upgrades (models deploy free). */
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

/** Real kW a role's rack will draw/heat (§6.5): aggregate TDP × utilization, in kW. */
function roleDrawKw(role: Role): number {
  return (roleHardware(role).tdpWatts / 1000) * RACK_UTILIZATION
}

function lastTower(s: GameState) {
  return s.towers[s.towers.length - 1]
}

/** Build a rack and shape it: place, upgrade hardware in place, deploy the best free model. */
function buildRole(s: GameState, role: Role, slot: Slot | undefined, waveAbout = 0): boolean {
  if (!slot) return false
  if (role === 'frontier') {
    if (!tryBuild(s, 'srv_frontier', slot.col, slot.row)) return false
    const t = lastTower(s)
    // a Frontier rack (H200, 141 GB) fits a 120B-class checkpoint at FP8 — so it
    // hosts the trained reasoning/agentic specialist that clears the hard lanes
    // (no Pod/SuperPod needed). deployBest picks the highest-lane-clearing model
    // the rack can host (the Studio specialist, once FP8 lets it fit).
    deployBest(s, t.id, t.hwId, t.modelId)
    return true
  }
  if (role === 'small') {
    return tryBuild(s, 'srv_edge', slot.col, slot.row)
  }
  if (!tryBuild(s, 'srv_edge', slot.col, slot.row)) return false
  const t = lastTower(s)
  if (!upgradeHardware(s, t.id)) return false // edge → standard
  // from the high-value/reasoning waves on: one more tier (→ Performance) buys the
  // KV headroom needed to batch two reasoning/rag requests at once
  if (waveAbout >= 6) upgradeHardware(s, t.id)
  deployBest(s, t.id, t.hwId, t.modelId)
  return true
}

/**
 * The method roadmap. Open models are free, so research is purely about
 * UNLOCKING capabilities: batch, recover KV, then the two model methods —
 * Reasoning (the only way to clear reason=82) and MoE (cheap big models). P3b: the
 * closed ft_agent/pt_giga training runs are gone; the agentic specialist is now
 * PLAYER-CREATED via the Post-Training Studio (r_pt_rl → a GRPO-agentic run).
 */
// P3c: serving improvements are the s.infra research tree (INFRA_NODES) now —
// MoE/Reasoning are no longer gates (models deploy when VRAM fits), so the autoplay
// researches the real serving chain instead: batch → KV → weight-quant → KV-shave.
const RESEARCH_PRIORITY = [
  'inf_batching', // escape the one-request-at-a-time era first (targets > 1)
  'inf_paged', // stop wasting two-thirds of KV memory (0.55 → 0.96)
  'inf_wq_fp8', // FP8 weights → big models fit a single GPU, decode flies
  // P3b Post-Training Studio unlock chain (cheap): LoRA → preference → GRPO, so the
  // Studio can train the reasoning/agentic specialists (replacing ft_agent/pt_giga).
  'r_pt_lora',
  'r_pt_pref',
  'r_pt_rl',
  // P3d red-team eval (eval track, independent): cuts guardrail over-refusal and
  // unlocks injection (v1) / PII (v2) detection — the agent waves need injection.
  'r_eval_redteam_v1',
  'r_eval_redteam_v2',
  'inf_prefix', // prefix cache: cheaper repeats + smaller KV
  'inf_flash', // FlashAttention: more KV headroom + bandwidth ceiling
  'inf_kvquant_fp8', // FP8 KV: halve per-request KV → batch more long-context
  'inf_spec', // speculative decoding: ~2× at low batch (priority lanes)
  'inf_multistep', // multi-step scheduling: +throughput, +1 batch slot
  'inf_chunked', // un-stall the racks: prefill stops freezing decode
]

function planResearch(s: GameState): void {
  // multi-track (§4.5 / C7): infra and posttrain run concurrently, so a busy
  // track only blocks ITS own queue — keep scanning for a free-track project.
  const fleetFlops = s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' && t.hwId ? (HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : 0),
    0,
  )
  for (const id of RESEARCH_PRIORITY) {
    const def = RESEARCH_DEFS[id]
    if (!def || researchOwned(s, def)) continue
    // its own track already busy with another project → skip, don't block others
    if (s.research[researchTrackOf(def)]) continue
    // a training run that would commandeer the backbone of the fleet can wait —
    // grow serving capacity first, then commit the surplus to the run
    if (def.compute / RESEARCH_TARGET_SECONDS > fleetFlops * 0.3) break
    const strongest = s.towers.reduce(
      (m, t) => (t.def.kind === 'server' && t.hwId ? Math.max(m, HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : m),
      0,
    )
    const reqSeconds = def.compute / Math.max(1, strongest)
    if (strongest > 130 && reqSeconds > 15 && fleetFlops - strongest < 700) break
    // start it if we can; otherwise keep saving Data for this exact project
    if (researchUnlocked(s, def) && s.data >= def.dataCost) startResearch(s, id)
    break
  }
}

/** Debug-only: the id of whichever track is currently researching (or '-'). */
function activeResearchId(s: GameState): string {
  return (s.research.infra ?? s.research.posttrain ?? s.research.eval)?.id ?? '-'
}

/** Free redeploys: every rack runs the best model it can host; spare Edge racks grow. */
function modernizeFleet(s: GameState): void {
  for (const t of s.towers) {
    if (t.def.kind !== 'server' || !t.modelId) continue
    deployBest(s, t.id, t.hwId, t.modelId)
  }
  // grow spare Edge racks toward Standard/Performance so stronger models fit —
  // keep a couple of cheap chat lanes. VRAM headroom is the real product now.
  const edges = s.towers.filter((t) => t.def.kind === 'server' && t.hwId === 'hw_edge')
  for (let i = 0; i + 2 < edges.length; i++) {
    if (s.meters.cash < reserveOf(s) + 12) break
    const t = edges[i]
    if (upgradeHardware(s, t.id)) {
      if (s.infra.kv.utilization >= 0.96 && s.meters.cash > reserveOf(s) + 30) upgradeHardware(s, t.id)
      deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
  // post-paged: lift Standard racks to Performance — H100 bandwidth keeps per-user
  // decode well under the interactive TPOT even under batch (so it earns, §6.6).
  if (s.infra.kv.utilization >= 0.96) {
    for (const t of s.towers) {
      if (t.def.kind !== 'server' || t.hwId !== 'hw_standard') continue
      if (s.meters.cash < reserveOf(s) + 22) break
      if (upgradeHardware(s, t.id)) deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
}

function ensureSupport(s: GameState, kind: string, want: number, slots: Slot[], floor?: number): void {
  let guard = 0
  // Safety gates are life support — they get a far lower cash bar than comfort buys.
  const minCash = floor ?? reserveOf(s) + 25
  while (countKind(s, kind) < want && s.meters.cash > minCash && guard++ < 6) {
    ensureCapacity(s, 1, 1)
    if (!place(s, kind, freeSlot(s, slots))) break
  }
}

/**
 * P5: stand up the Frontier racks that HOST the Studio specialists. Once FP8 is
 * researched and we own a 120B-class derived checkpoint, the hard reasoning/agentic
 * lanes are won by deploying that specialist — but it only fits a 141 GB Frontier
 * rack (no Pod needed at FP8). This is the step that turns "trained a specialist"
 * into "served by the specialist", so the agent/reason waves stop shipping bad
 * answers (the trust bleed). Build the cheapest path: upgrade an existing
 * Performance rack to Frontier (one tier, ~5 credits) when one exists, else build a
 * fresh Frontier rack (35 credits); then deploy the best-fitting model on it.
 */
function ensureBigRacks(s: GameState, waveAbout: number, want: number): void {
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return
  // A Frontier rack that runs the specialist on the hard lanes is a STRATEGIC buy —
  // it converts trust-bleeding bad agentic/reason answers into clean serves, so it
  // gets a far smaller cash bar than comfort capacity (like a guardrail). Keep just
  // a thin operating cushion so we never bankrupt mid-wave.
  const bigReserve = 20 + estDraw(s) * 3
  let guard = 0
  while (bigRackCount(s) < want && guard++ < 4) {
    // prefer upgrading a Performance rack to Frontier (cheap one-tier hop)
    const perf = s.towers.find((t) => t.def.kind === 'server' && t.hwId === 'hw_perf')
    if (perf && s.meters.cash > hardwareUpgradeCost(s, perf) + bigReserve) {
      if (upgradeHardware(s, perf.id)) {
        deployBest(s, perf.id, perf.hwId, perf.modelId)
        continue
      }
    }
    // else build a fresh Frontier rack if the budget allows it
    if (s.meters.cash < roleCost(s, 'frontier', waveAbout) + bigReserve) break
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    ensureCapacity(s, roleDrawKw('frontier'), roleDrawKw('frontier'))
    if (!buildRole(s, 'frontier', slot, waveAbout)) break
  }
}

function _legacyPlan(s: GameState, waveAbout: number): void {
  updatePower(s)
  // The Lab is the engine of the model-R&D economy — buy it before anything else
  // (cash thresholds are in the real credit economy now, §6.6).
  if (waveAbout >= 2 && countKind(s, 'lab') < 1 && s.meters.cash > 55)
    place(s, 'lab', freeSlot(s, SLOTS.back))
  // P3c: the Fine-tuning (scale_pretrain) +quality cash buff is gone — model polish
  // is the Post-Training Studio now (P3b), and serving wins come from infra research.
  // Free redeploys whenever research has delivered something new.
  modernizeFleet(s)
  // Guarantee a base fleet early: research requisitions hurt a tiny platform.
  // Standard (L40S) racks are the baseline now — they meet the interactive SLO
  // and are cheap (10 credits) in the real capex economy (§6.6).
  let pre = 0
  while (
    countKind(s, 'server') < 7 &&
    s.meters.cash > roleCost(s, 'general', waveAbout) + reserveOf(s) &&
    pre++ < 8
  ) {
    ensureCapacity(s, roleDrawKw('general'), roleDrawKw('general'))
    if (!buildRole(s, 'general', freeSlot(s, SLOTS.lane), waveAbout)) break
  }
  // Defensive coverage next (a sensible player guards the announced wave). P3d: the
  // single Safety Gate is gone — the second-layer is the guardrail buildings. The
  // ENCODER (Prompt Guard 86M) catches jailbreak + injection at 92 ms and costs ~0
  // compute, so it is the cheap workhorse against the jailbreak/agent waves; add a
  // generative LLM guard later for the heaviest abuse nights (it also catches all 4).
  ensureSupport(s, 'router', waveAbout >= 8 ? 2 : waveAbout >= 2 ? 1 : 0, SLOTS.lane)
  const guardSlots = SLOTS.core.length ? SLOTS.core : SLOTS.lane
  ensureSupport(
    s,
    'guard_encoder',
    waveAbout >= 14 ? 3 : waveAbout >= 10 ? 2 : waveAbout >= 4 ? 1 : 0,
    guardSlots,
    20, // a jailbreak wave without a guardrail is a lost run — buy it almost no matter what
  )
  // a generative guardrail on the worst abuse nights (catches all four hazards both sides)
  ensureSupport(s, 'guard_llm', waveAbout >= 14 ? 1 : 0, guardSlots, 30)
  // Cache earlier than before: it also rescues long-context traffic small windows reject
  ensureSupport(s, 'cache', waveAbout >= 8 ? 3 : waveAbout >= 6 ? 2 : waveAbout >= 4 ? 1 : 0, SLOTS.lane)
  // P5: once a 120B-class specialist is trained + FP8 lets it fit, stand up the
  // Frontier racks that actually RUN it on the hard reasoning/agentic lanes.
  ensureBigRacks(s, waveAbout, waveAbout >= 12 ? 3 : waveAbout >= 9 ? 2 : 1)
  if (process.env.DBG)
    console.log(
      `  plan(${waveAbout}): cash=${s.meters.cash.toFixed(0)} reserve=${reserveOf(s).toFixed(0)} ` +
        `guards=${countKind(s, 'guardrail')} cache=${countKind(s, 'cache')} router=${countKind(s, 'router')} servers=${countKind(s, 'server')}`,
    )

  // Spare-cash fill: cheap general racks soak the volume lanes (chat/embed/comp/rag).
  // The strategic Frontier racks are handled by ensureBigRacks above; here we only
  // add affordable general capacity (a frontier choice that we cannot fund falls
  // back to general rather than stalling the whole build).
  let guard = 0
  while (s.meters.cash > reserveOf(s) + 15 && guard++ < 80) {
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    let role = chooseRole(s, waveAbout)
    if (role === 'frontier' && s.meters.cash < roleCost(s, 'frontier', waveAbout) + reserveOf(s)) role = 'general'
    ensureCapacity(s, roleDrawKw(role), roleDrawKw(role))
    if (s.meters.cash < roleCost(s, role, waveAbout) + 5) break
    if (!buildRole(s, role, slot, waveAbout)) break
  }

  // Commit research LAST, with the freshly expanded fleet absorbing the requisition.
  planResearch(s)
  // P3b: USE the Post-Training Studio — the posttrain track makes the reasoning /
  // agentic specialists that replace the deleted ft_agent/pt_giga cards.
  maybeStudio(s)
  if (process.env.DBG) {
    const tiers: Record<string, number> = {}
    for (const t of s.towers)
      if (t.def.kind === 'server' && t.modelId)
        { const _m = resolveModel(s, t.modelId); if (_m) tiers[_m.tier] = (tiers[_m.tier] ?? 0) + 1 }
    console.log(
      `  planEnd(${waveAbout}): cash=${s.meters.cash.toFixed(0)} fleet=${JSON.stringify(tiers)} towers=${s.towers.length} research=${activeResearchId(s)}`,
    )
  }
}

function runWave(s: GameState): void {
  let t = 0
  while (s.phase === 'wave' && t < 240) {
    step(s)
    t += SIM_DT
  }
}

function autoplay(seed: number): { reached: number; won: boolean; state: GameState } {
  return productionDemoAutoplay(seed)
}

/** Count of distinct DEPLOYED model ids across the fleet (what is actually serving). */
function deployedModelIds(s: GameState): Set<string> {
  return productionDemoDeployedModelIds(s)
}

// 100-WAVE ELIMINATION-GAUNTLET balance gate. The campaign is no longer "winnable
// by a bot": it is a 100-wave monotonic escalation through real 2023→2026 history
// that most runs lose mid-way, with wave 100 the apex and procedural endless mode
// beyond it. So the gate is DEPTH + system-usage, not victory — a sensible strategy
// must (a) survive the teaching/growth arc deep into the gauntlet, (b) prove it USED
// the real systems (serving chain + Studio + guardrails + SLO-aware deploy), and
// (c) be eliminated by a FAIR escalation, not an early wall or a degenerate exploit.
// A tuned heuristic reliably reaches ~wave 40-55 (dying to safety/Trust under the
// late jailbreak storms); the floor below is set well under that for seed-robustness.
// If this regresses, TUNE THE GAME (campaign.ts tier knobs / economy / heuristic),
// not the test — the autoplay must get deep by playing well, never by an exploit.
const GAUNTLET_FLOOR = 30

describe('balance: heuristic autoplay survives deep into the 100-wave gauntlet', () => {
  it('a sensible strategy reaches the gauntlet floor and USES the new systems (primary seed)', () => {
    const r = autoplay(2026)
    const s = r.state
    const derivedCount = Object.keys(s.derivedModels).length
    const deployed = deployedModelIds(s)
    console.log(
      `autoplay reached wave ${r.reached}/${WAVES.length}, won=${r.won}, phase=${s.phase} ` +
        `trust=${s.meters.trust.toFixed(0)} sla=${s.meters.sla.toFixed(0)} cash=${s.meters.cash.toFixed(0)} ` +
        `towers=${s.towers.length} derived=${derivedCount} deployed=${[...deployed].join(',')} ` +
        `stats=${JSON.stringify(s.stats)}`,
    )
    // (1) a sensible strategy survives deep into the escalating gauntlet.
    expect(r.reached).toBeGreaterThanOrEqual(GAUNTLET_FLOOR)
    // (2) it actually USED the new systems — not coasting on the free starter:
    //   • researched the real serving chain (PagedAttention recovers KV memory),
    expect(s.upgrades['inf_paged']).toBeGreaterThanOrEqual(1)
    //   • trained at least one player-derived checkpoint in the Post-Training Studio,
    expect(derivedCount).toBeGreaterThanOrEqual(1)
    //   • and deploys a model beyond the free llama31_8b starter on its racks.
    expect([...deployed].some((id) => id !== 'llama31_8b')).toBe(true)
    expect(deployed.size).toBeGreaterThanOrEqual(1)
    // served a large volume of real traffic across the run (sanity: not stalled).
    expect(s.stats.served).toBeGreaterThan(800)
  })

  it('production demo exercises the full stack before elimination', () => {
    const r = productionDemoAutoplay(2026)
    const s = r.state
    const kindCount = (kind: string) => s.towers.filter((t) => t.def.kind === kind).length
    const idCount = (id: string) => s.towers.filter((t) => t.def.id === id).length
    const hwIds = new Set(s.towers.filter((t) => t.def.kind === 'server').map((t) => t.hwId))
    const roles = new Set(s.towers.filter((t) => t.def.kind === 'server').map((t) => t.role).filter(Boolean))
    const derivedTargets = new Set(Object.values(s.derivedModels).map((m) => m.lineage?.target).filter(Boolean))
    console.log(
      `production demo coverage: reached=${r.reached} kinds=${JSON.stringify(Object.fromEntries(['server', 'router', 'cache', 'guardrail', 'power', 'cooling', 'cooling_liquid', 'lab'].map((k) => [k, kindCount(k)])))} ` +
        `guard_mod=${idCount('guard_mod')} hw=${JSON.stringify([...hwIds])} roles=${JSON.stringify([...roles])} derived=${JSON.stringify([...derivedTargets])} upgrades=${JSON.stringify(s.upgrades)}`,
    )
    // the full platform is stood up well before the elimination point (~wave 15-18).
    expect(r.reached).toBeGreaterThanOrEqual(GAUNTLET_FLOOR)
    expect(kindCount('server')).toBeGreaterThanOrEqual(8)
    expect(kindCount('router')).toBeGreaterThanOrEqual(1)
    expect(kindCount('cache')).toBeGreaterThanOrEqual(1)
    expect(kindCount('guardrail')).toBeGreaterThanOrEqual(1)
    expect(idCount('guard_mod')).toBeGreaterThanOrEqual(1)
    expect(kindCount('power')).toBeGreaterThanOrEqual(1)
    expect(kindCount('cooling')).toBeGreaterThanOrEqual(1)
    expect(kindCount('cooling_liquid')).toBeGreaterThanOrEqual(1)
    expect(kindCount('lab')).toBeGreaterThanOrEqual(1)
    expect(hwIds.has('hw_perf') || hwIds.has('hw_frontier')).toBe(true)
    expect(hwIds.has('hw_pod')).toBe(true)
    expect(s.upgrades['inf_batching']).toBeGreaterThanOrEqual(1)
    expect(s.upgrades['inf_paged']).toBeGreaterThanOrEqual(1)
    expect(s.upgrades['inf_wq_fp8']).toBeGreaterThanOrEqual(1)
    expect(s.upgrades['inf_disagg']).toBeGreaterThanOrEqual(1)
    expect(s.upgrades['eval_redteam']).toBeGreaterThanOrEqual(1)
    expect(s.upgrades['pt_rl']).toBeGreaterThanOrEqual(1)
    expect(roles.has('prefill')).toBe(true)
    expect(roles.has('decode')).toBe(true)
    expect(derivedTargets.has('reasoning')).toBe(true)
    expect(derivedTargets.has('agentic')).toBe(true)
    expect([...productionDemoDeployedModelIds(s)].some((id) => id !== 'llama31_8b')).toBe(true)
  })

  it('the economy rewards good serving over the run (clean serves dominate)', () => {
    // Over a full run the §6.6 economy must reward clean serving: most answered
    // requests are CLEAN (served), and over-refusal never dominates. (Safety/Trust
    // DOES eventually break under the late jailbreak storms — that is the designed
    // elimination, so unsafe counts are not bounded here.)
    const s = autoplay(2026).state
    const answered = s.stats.served + s.stats.bad + s.stats.sloMiss
    expect(s.stats.served).toBeGreaterThan(answered * 0.5)
    expect(s.stats.overRefused).toBeLessThan(s.stats.served)
  })

  it('Goodput is satisfiable: a fast-enough rack meets the interactive SLO (§0.4 C5)', () => {
    // The C5 invariant: the dual-clock SLO must NOT be permanently 0. A small model
    // on a fast GPU answering short interactive chat must clear its class SLO.
    const s = createState(7)
    s.meters.cash = 999999
    startGame(s)
    s.phase = 'build'
    for (const col of [3, 8, 14, 20]) {
      tryBuild(s, 'srv_edge', col, 2)
      const t = lastTower(s)
      upgradeHardware(s, t.id) // → standard
      upgradeHardware(s, t.id) // → performance (H100, 3.35 TB/s)
    }
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true) // wave 1 — mostly interactive chat
    runWave(s)
    const rep = s.lastReport
    expect(rep).not.toBeNull()
    if (!rep) return
    console.log(
      `goodput smoke: served=${rep.served} bad=${rep.bad} goodput=${rep.goodputPct.toFixed(0)}% ` +
        `avgTtft=${rep.avgTtft.toFixed(3)}s p95Ttft=${rep.p95Ttft.toFixed(3)}s`,
    )
    expect(rep.served + rep.bad).toBeGreaterThan(0)
    expect(rep.goodputPct).toBeGreaterThan(0)
  })

  it('reaches the gauntlet floor across multiple seeds (robust, not seed-tuned)', () => {
    const results = [101, 202, 303].map((seed) => ({ seed, r: autoplay(seed) }))
    for (const { seed, r } of results) {
      console.log(
        `seed ${seed}: reached ${r.reached}/${WAVES.length}, won=${r.won}, phase=${r.state.phase}, ` +
          `trust=${r.state.meters.trust.toFixed(0)}, derived=${Object.keys(r.state.derivedModels).length}, ` +
          `served=${r.state.stats.served}`,
      )
    }
    for (const { r } of results) {
      expect(r.reached).toBeGreaterThanOrEqual(GAUNTLET_FLOOR)
      expect(r.state.upgrades['inf_paged']).toBeGreaterThanOrEqual(1)
      expect(Object.keys(r.state.derivedModels).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('endless mechanics: clearing the apex flips to procedural surges past wave 100', () => {
    // Wave 100 is the apex; a perfect run that clears it flips into procedural
    // endless surges. We test the plumbing from a synthetic apex-win state (the
    // heuristic itself is eliminated mid-gauntlet, by design).
    const s = createState(2026)
    startGame(s)
    s.phase = 'won'
    s.waveIndex = WAVES.length - 1
    expect(continueEndless(s)).toBe(true)
    expect(s.endless).toBe(true)
    expect(s.phase).toBe('build')
    expect(productionNextDemoWaveNumber(s)).toBe(WAVES.length)
    expect(productionDemoCanContinueCampaign(s)).toBe(true)
    // startWave generates the first procedural surge (harder than the campaign).
    expect(startWave(s)).toBe(true)
    expect(s.waveIndex).toBe(WAVES.length)
    expect(s.currentWave).not.toBeNull()
    expect(s.currentWave?.groups.length ?? 0).toBeGreaterThan(0)
  })
})

/**
 * §6.4 / §1.5 H2 teaching invariants — the roster-balance properties the campaign
 * is built to TEACH (capability compression: the agent/SWE lane is the wall that
 * does not compress). These are static facts about the calibrated roster + Studio,
 * independent of any single playthrough.
 */
describe('balance: teaching invariants (H2 agent wall / capability compression)', () => {
  it('H2: the tiny MoE qwen3_30b_a3b is fast+smart but the AGENT lane is its wall', () => {
    const q = MODEL_DEFS['qwen3_30b_a3b'].qualityBy
    // it clears chat/reasoning with margin (the MoE "frontier answers at 3.3B active"),
    expect(q.reasoning).toBeGreaterThanOrEqual(82)
    expect(q.chat).toBeGreaterThanOrEqual(82)
    // …but its agentic capability genuinely lags the agent line (82) — the §1.5 [H2]
    // fix: the wall is an axis, not a serving cost (a small MoE decodes FASTEST).
    expect(q.agentic).toBeLessThan(82)
  })

  it('the agent lane requires scale OR a trained specialist (it does not compress)', () => {
    const AGENT_LINE = 82
    // a true open FRONTIER (the SuperPod-class Qwen3-235B / DeepSeek-V3.1) clears it,
    expect(MODEL_DEFS['qwen3_235b'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE)
    expect(MODEL_DEFS['deepseek_v31'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE)
    // …while the cheap mid-tier MoEs that compress chat/reasoning do NOT clear it,
    for (const id of ['qwen3_30b_a3b', 'qwen3_32b', 'gptoss_120b', 'gptoss_20b']) {
      expect(MODEL_DEFS[id].qualityBy.agentic).toBeLessThan(AGENT_LINE)
    }
    // …and a PLAYER GRPO-agentic run on an agentic-capable base (Nemotron-Super, a
    // 120B that fits a 141 GB Frontier rack at FP8) DOES close the loop — the Studio
    // is the player's path to the agent lane when no frontier is afforded.
    const base = MODEL_DEFS['nemotron_super']
    const f = computeDerivedFields(base, METHOD_RECIPES['grpo'], 'agentic', 1.5, null)
    expect(base.qualityBy.agentic).toBeLessThan(AGENT_LINE) // the base alone is short,
    expect(f.qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE) // the GRPO-agent run clears it.
  })
})
