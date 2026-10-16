import { describe, expect, it } from 'vitest'
import {
  CHUNK_MAX_TOKENS,
  CHUNK_MIN_STRETCH,
  CHUNK_MIN_TOKENS,
  CHUNK_STEP_TARGET_MS,
  COHORT_STREAMS,
  CREDIT_USD,
  ENGINE_MAX_STREAMS,
  KV_TRANSFER_GBPS,
  MBU_DECODE,
  MFU_DECODE,
  MFU_PREFILL,
  PP_BUBBLE_MS,
  RACK_UTILIZATION,
  RACKS_PER_TILE,
  SIM_DT,
  SIM_TIME_SCALE,
  STEP_OVERHEAD_MS,
  THROTTLE_FLOOR,
  TRAFFIC_SCALE,
} from '../src/config'
import type { CapabilityAxis, GameEvent, GameState, ModelDef, Outcome, PostTrainMeta, Request, Tower } from '../src/core/types'
import {
  deployModel,
  sellTower,
  startGame,
  startWave,
  towerValue,
  tryBuild,
  upgradeHardware,
} from '../src/sim/actions'
import {
  DEFAULT_MODEL_ID,
  HARDWARE_DEFS,
  INFRA_NODES,
  METHOD_RECIPES,
  MODEL_DEFS,
  REQUEST_TYPES,
  RESEARCH_DEFS,
  TOWER_DEFS,
  UPGRADE_MAP,
  UPGRADES,
  WAVES,
  themedIncidentForWave,
} from '../src/sim/content'
import {
  TAX_K,
  alignmentTax,
  HANDLED_ATTACK_TOKENS,
  categoryUnlocked as categoryUnlockedFor,
  overRefuse as guardOverRefuse,
  overrefMul,
  pSelfHandle,
} from '../src/sim/safety'
import {
  applyInfraEffects,
  canPostTrain,
  methodUnlocked,
  researchUnlocked,
  startPostTrain,
  startResearch,
  updateResearch,
} from '../src/sim/research'
import {
  computeDerivedFields,
  deriveModel,
  deriveQuality,
  postTrainComputeCost,
  postTrainDataCost,
  resolveModel,
  studioPreview,
} from '../src/sim/models'
import * as actionsModule from '../src/sim/actions'
import * as effectsModule from '../src/sim/effects'
import {
  computeRoofTokS,
  decodeThrottle,
  decodeTokSb1,
  defLoadout,
  deployBlocker,
  guardHeat,
  guardCheckMs,
  guardLatencyMs,
  guardScreenTokens,
  GUARD_TURN_TOKENS,
  GUARD_VERDICT_TOKENS,
  guardPower,
  hasLiquidLoop,
  hwNeedsLiquid,
  kvFreeGb,
  kvPerReqGb,
  loadout,
  loadoutOf,
  longContextPenalty,
  methodsUnlocked,
  prefillTokS,
  rackPlan,
  serverAggDecodeTokS,
  serverComputeCeiling,
  serverCtxWindowTokens,
  serverFitsMemory,
  serverHeat,
  serverModelMemory,
  serverPerUserDecodeTokS,
  serverPower,
  serverQuality,
  serverQualityVs,
  serverSpeed,
  serverTargets,
} from '../src/sim/effects'
import { calibrateRecipes, recipeGainOrderingOk, THINK_TOKENS_FALLBACK } from '../src/sim/calibrate'
import { endlessScaling, generateEndlessWave } from '../src/sim/endless'
import { isBrownout, isThrottling, updatePower } from '../src/sim/power'
import { spawnRequest } from '../src/sim/spawn'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'
import { goodputPctOf, newWaveStats, sloAttainPctOf } from '../src/sim/telemetry'
import { CAMPAIGN_THEMES } from '../src/sim/campaign'
import { guardCoveredLanes, laneGuardStages } from '../src/sim/guards'
import { pathLength } from '../src/sim/pathing'
import { resolveOutcome } from '../src/sim/resolve'
import { serializeState } from '../src/agent/snapshot'
import { explainRejection } from '../src/agent/diagnose'

/* --------------------------------------------------------------------------
 * Active-roster checkpoints used by the tests (the frontier-tolerance gate, §calibrate,
 * trims the candidate pool to ~60). Open weights are owned for free; the gate is VRAM
 * (paramsTotalB × the resident bytes/param).
 *   STARTER  : the free starter (DEFAULT_MODEL_ID): the smallest dense checkpoint that serves the
 *              opening waves — chat and code completion instantly, RAG's general line.
 *   GENERAL  : Qwen3.6-27B       — 27B dense BF16, REASONING model. Fits Standard at FP8.
 *   CODER    : Gemma 4 31B       — 31B dense BF16. The most code-leaning kept model.
 *   BIG      : Qwen3.5-122B-A10B — 122B total / 10B active BF16 MoE. Overflows Frontier at
 *              BF16, fits it at FP8, fits a Pod.
 *   WEAK     : Nemotron 3 Nano 4B— 4B dense; below the reasoning/agentic lines (post-train headroom).
 *   MOE      : Nemotron Cascade 2 30B-A3B — 31.6B total / 3.2B active hybrid Mamba-2 MoE, thinking.
 *   FRONTIER : MiniMax-M3        — 428B/23B BF16 MoE thinking model; a terminal-agent frontier.
 *   MLA      : GLM-5.2           — 753B MoE, MLA attention (latent-KV tests).
 *   AGENT_SHORT : gpt-oss 120B   — big (117B) yet agentic < 82: scale alone is not agentic skill.
 * ------------------------------------------------------------------------ */
const STARTER = DEFAULT_MODEL_ID
const GENERAL = 'qwen36_27b'
const CODER = 'g_gemma_4_31b_2'
const BIG = 'qwen35_122b'
const WEAK = 'g_nvidia_nemotron_3_nano_4b_2'
const MOE = 'g_nemotron_cascade_2_30b_a3b_2'
const FRONTIER = 'minimax_m3'
const MLA = 'glm_5_2'
const AGENT_SHORT = 'gptoss_120b'
/**
 * INSTRUCT : Nemotron 3 Nano 4B — a small HYBRID: it answers interactive traffic (chat, code
 * completion) with thinking switched off, as a non-thinking model would (§1.4).
 * ALWAYS   : K2-Horizon-7B — a 9B dense model that ALWAYS thinks (reasoning effort only sets how
 *            long): its hidden reasoning blows chat's time-to-first-answer bound on a slow rack.
 * NEVER    : Qwen3.5 0.8B served thinking-off — the roster's non-reasoning deployment.
 */
const INSTRUCT = WEAK
const ALWAYS = 'k2h_7b'
const NEVER = 'g_qwen3_5_0_8b_non_reasoning_2'

function runFor(s: GameState, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i++) step(s)
}

/** The full token-priced revenue a request's tokens are worth (credits). */
function serveRevenueOf(s: GameState, r: { tokensIn: number; tokensOut: number; pricePerMtokIn: number; pricePerMtokOut: number }): number {
  return effectsModule.serveRevenue(s, r.tokensIn, r.tokensOut, r.pricePerMtokIn, r.pricePerMtokOut)
}

/**
 * P3c test helper: apply one or more infra-node effects to s.infra directly
 * (shortcutting the research track), the s.infra equivalent of the old
 * `s.upgrades['tech_*'] = 1`. s.infra is now the single source of truth.
 */
function infraOn(s: GameState, ...nodeIds: string[]): void {
  for (const id of nodeIds) {
    const node = INFRA_NODES[id]
    if (!node) throw new Error(`unknown infra node ${id}`)
    applyInfraEffects(s, node.effects)
    s.upgrades[id] = 1 // researched marker (prereqs / panels read this)
  }
}

/** Put the state into an active, group-less wave so we can inject requests directly. */
function liveWave(s: GameState): void {
  s.phase = 'wave'
  s.waveActive = true
  s.waveTime = 0
  s.spawns = []
}

function richBuild(s: GameState): void {
  s.meters.cash = 99999
  s.phase = 'build'
  // rich test env = the modern serving era (continuous batching + paged KV).
  // P3c: MoE/Reasoning are no longer deploy gates — any model that fits VRAM
  // deploys. FP8 weight-quant fits a 70B / 24–33B on a single GPU (§5.6).
  infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8')
}

function lastTower(s: GameState) {
  return s.towers[s.towers.length - 1]
}

/**
 * Build a rack and shape it into a serving role the way a player would: place
 * an Edge rack, upgrade the hardware in place, deploy a (free) real checkpoint.
 * Open models are owned from the start; richBuild() unlocks MoE/Reasoning so a
 * reasoning checkpoint like Qwen3-32B can deploy.
 *
 * P1 (§6.6): the 'general' role now lands a PERFORMANCE (H100) rack — a 32B
 * reasoning model on an L40S (~76 ms/token) misses the interactive TPOT and every
 * serve slo_misses (zero cash). H100 bandwidth (3.35 TB/s) keeps it inside the SLO,
 * so a 'general' rack actually earns. (Edge L4 is too slow for interactive at all.)
 */
function buildServerAs(
  s: GameState,
  role: 'small' | 'chat' | 'general' | 'coding' | 'frontier',
  col: number,
  row: number,
): boolean {
  if (role === 'frontier') {
    if (!tryBuild(s, 'srv_frontier', col, row)) return false // ships the STARTER
    return deployModel(s, lastTower(s).id, BIG)
  }
  if (!tryBuild(s, 'srv_edge', col, row)) return false
  if (role === 'small') return true
  const t = lastTower(s)
  if (!upgradeHardware(s, t.id)) return false // edge → standard
  if (!upgradeHardware(s, t.id)) return false // standard → performance (H100, meets IN)
  // 'chat' = the interactive rack: a fast non-thinking model on an H100
  return deployModel(s, t.id, role === 'coding' ? CODER : role === 'chat' ? INSTRUCT : GENERAL)
}

describe('request resolution', () => {
  it('a server serves a Simple Chat and earns token-priced revenue', () => {
    const s = createState(1)
    richBuild(s)
    expect(buildServerAs(s, 'chat', 2, 2)).toBe(true)
    expect(buildServerAs(s, 'chat', 4, 2)).toBe(true)
    const earnedBefore = s.stats.cashEarned
    liveWave(s)
    spawnRequest(s, 'chat')
    runFor(s, 12)
    expect(s.stats.served).toBe(1)
    // a clean serve pays the real $/Mtoken revenue (§6.6) — cashEarned rises.
    // (Net cash can still dip: two idle H100s burning the operating bill for one
    // cheap chat is the over-provisioning / utilization penalty, by design.)
    expect(s.stats.cashEarned).toBeGreaterThan(earnedBefore)
    expect(s.requests.length).toBe(0)
  })

  it('an unanswered request leaks and damages Trust + SLA', () => {
    const s = createState(2)
    liveWave(s)
    const t0 = s.meters.trust
    const sla0 = s.meters.sla
    spawnRequest(s, 'reason')
    runFor(s, 75)
    expect(s.stats.leaked).toBe(1)
    expect(s.meters.trust).toBeLessThan(t0)
    expect(s.meters.sla).toBeLessThan(sla0)
  })

  it('a weak model ships a bad answer when it finishes a too-hard request', () => {
    const s = createState(3)
    richBuild(s)
    // Edge racks running the 0.8B instruct model (coding ≈ 9): they grind out a Code
    // Completion request but quality is below its coding difficulty (56) — a bad answer.
    for (const col of [2, 4, 6, 8, 10, 12]) {
      tryBuild(s, 'srv_edge', col, 2)
      deployModel(s, lastTower(s).id, NEVER)
    }
    expect(MODEL_DEFS[NEVER].qualityBy.coding).toBeLessThan(REQUEST_CODE_COMPLEXITY)
    liveWave(s)
    spawnRequest(s, 'comp')
    runFor(s, 30)
    expect(s.stats.served).toBe(0)
    expect(s.stats.bad).toBeGreaterThanOrEqual(1)
  })

  it('a jailbreak that neither the model nor a guardrail clears breaches; a guardrail catches it (§3.4)', () => {
    // a LOW-safety model (a derived base-like checkpoint, safety 15) cannot self-handle
    // a severe jailbreak: with no guardrail it breaches at the core.
    const buildLowSafety = (s: GameState, col: number, row: number) => {
      tryBuild(s, 'srv_edge', col, row)
      const t = lastTower(s)
      upgradeHardware(s, t.id) // edge → standard
      upgradeHardware(s, t.id) // standard → performance (meets jailbreak's IN TPOT)
      deployModel(s, t.id, 'g_qwen3_5_9b_2')
      // shadow a near-zero-safety variant so layer 1 cannot save it (deterministic breach)
      const base = resolveModel(s, 'g_qwen3_5_9b_2')!
      const low = { ...base, id: 'low_safety', alignment: { safety: 15, refusalStyle: 'none' as const, overRefusal: 0.02 } }
      s.derivedModels['low_safety'] = low
      s.models['low_safety'] = true
      t.modelId = 'low_safety'
    }
    const unsafe = createState(4)
    richBuild(unsafe)
    buildLowSafety(unsafe, 3, 2)
    liveWave(unsafe)
    spawnRequest(unsafe, 'jailbreak')
    runFor(unsafe, 45)
    expect(unsafe.stats.unsafe).toBe(1) // unhandled hazard reached the core

    // add an input encoder guardrail (catches jailbreak at 92 ms): now it is caught
    const safe = createState(4)
    richBuild(safe)
    buildLowSafety(safe, 3, 2)
    tryBuild(safe, 'guard_encoder', 3, 0)
    liveWave(safe)
    spawnRequest(safe, 'jailbreak')
    runFor(safe, 12)
    expect(safe.stats.unsafe).toBe(0)
    expect(safe.stats.served).toBe(1)
  })
})

const REQUEST_CODE_COMPLEXITY = 56

describe('power & cooling (REAL watts / kW, §6.5)', () => {
  it('a rack draws its real aggregate TDP in kW (700 W H200 → ~0.56 kW)', () => {
    const s = createState(5)
    infraOn(s, 'inf_batching')
    // H200 (700 W TDP) at the 0.8 utilization factor → 0.56 kW; FP8 cuts it 15%.
    const fp16 = loadout(s, 'hw_frontier', BIG)
    expect(serverPower(s, fp16)).toBeCloseTo((700 / 1000) * RACK_UTILIZATION, 6)
    infraOn(s, 'inf_wq_fp8') // FP8
    expect(serverPower(s, fp16)).toBeCloseTo((700 / 1000) * RACK_UTILIZATION * 0.85, 6)
    // an NVL72 (72× 1000 W = 72 kW TDP) reads in real tens of kW — and ≈ its heat.
    const giga = loadout(s, 'hw_giga', MLA)
    expect(serverPower(s, giga)).toBeGreaterThan(40) // tens of kW, real datacenter scale
    expect(serverHeat(s, giga)).toBeCloseTo(serverPower(s, giga), 6) // heat ≈ power
  })

  it('browns out when real kW draw exceeds the power cap, recovers with Power Plants', () => {
    const s = createState(5)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching')
    // base power is 6 kW; H200 frontier racks draw 0.56 kW each. Twelve of them
    // = 6.72 kW > 6 kW → a real-watt brownout. (Air-cooled; no loop needed.)
    let placed = 0
    for (let row = 2; row <= 8 && placed < 12; row++) {
      if (row === 5) continue // lane row
      for (let col = 2; col <= 21 && placed < 12; col += 2) {
        if (tryBuild(s, 'srv_frontier', col, row)) placed++
      }
    }
    expect(placed).toBe(12)
    // total real draw (12 × 0.56 = 6.72 kW) exceeds the 6 kW cap → a brownout that
    // cuts the hungriest racks until used ≤ cap (so s.power.used settles AT the cap).
    const demand = s.towers.reduce((n, t) => n + serverPower(s, loadoutOf(s, t)), 0)
    expect(demand).toBeGreaterThan(6) // real-watt demand beat the base cap
    updatePower(s)
    expect(s.power.cap).toBeCloseTo(6, 6)
    expect(isBrownout(s)).toBe(true)
    expect(s.power.used).toBeLessThanOrEqual(s.power.cap + 0.001) // cut down to the cap
    // a Power Plant adds +8 kW; one lifts the cap to 14 kW and covers 6.72 kW.
    tryBuild(s, 'power', 3, 4)
    updatePower(s)
    expect(s.power.cap).toBeCloseTo(14, 6)
    expect(isBrownout(s)).toBe(false)
    expect(s.power.used).toBeCloseTo(demand, 1) // all racks back online
  })

  it('thermally throttles when real heat (kW) exceeds the cooling cap', () => {
    const s = createState(5)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching')
    // give plenty of power so the ONLY constraint is cooling, then over-heat it:
    // base cooling is 6 kW; twelve H200 racks emit 6.72 kW of heat > 6 kW.
    for (let i = 0; i < 4; i++) tryBuild(s, 'power', 1 + i, 4) // +32 kW power, no heat strain
    let placed = 0
    for (let row = 2; row <= 8 && placed < 12; row++) {
      if (row === 5) continue
      for (let col = 2; col <= 21 && placed < 12; col += 2) {
        if (tryBuild(s, 'srv_frontier', col, row)) placed++
      }
    }
    updatePower(s)
    expect(isBrownout(s)).toBe(false) // power is fine
    expect(s.cooling.used).toBeGreaterThan(s.cooling.cap) // over the 6 kW heat cap
    expect(isThrottling(s)).toBe(true)
    // every online server is globally throttled below full speed (cap / heat).
    const srv = s.towers.find((t) => t.def.kind === 'server' && t.online)!
    expect(srv.throttle).toBeLessThan(1)
    expect(srv.throttle).toBeGreaterThanOrEqual(THROTTLE_FLOOR)
    // adding cooling clears the throttle.
    for (let i = 0; i < 2; i++) tryBuild(s, 'cooling', 6 + i, 4) // +16 kW cooling
    updatePower(s)
    expect(isThrottling(s)).toBe(false)
  })
})

describe('liquid-cooling hard gate (OQ-G8, §5.5)', () => {
  /** Climb a frontier rack up the in-place ladder to the DGX B200 (both DGX nodes are air-cooled). */
  function superpodRack(s: GameState) {
    expect(tryBuild(s, 'srv_frontier', 3, 2)).toBe(true)
    const t = lastTower(s)
    expect(upgradeHardware(s, t.id)).toBe(true) // → DGX H200 (air)
    expect(upgradeHardware(s, t.id)).toBe(true) // → DGX B200 (air)
    expect(t.hwId).toBe('hw_superpod')
    return t
  }
  /** Enough grid for an FP8 NVL72 (72 × 1200 W × 0.8 × 0.85 ≈ 59 kW): base 6 kW + 7 Power Plants. */
  function powerFor(s: GameState): void {
    for (const col of [2, 4, 6, 8, 10, 12, 14]) expect(tryBuild(s, 'power', col, 4)).toBe(true)
  }

  it('the GB200 NVL72 cannot be reached or run without a Liquid Cooling Loop', () => {
    const s = createState(6)
    richBuild(s)
    powerFor(s)
    const t = superpodRack(s)
    // §6.5 placement gate: upgrading INTO the liquid NVL72 tier is blocked with no loop.
    expect(HARDWARE_DEFS.hw_giga.cooling).toBe('liquid')
    expect(upgradeHardware(s, t.id)).toBe(false)
    expect(t.hwId).toBe('hw_superpod')
    // build the Liquid Cooling Loop → the NVL72 upgrade is now allowed, and it runs.
    expect(tryBuild(s, 'cooling_liquid', 16, 4)).toBe(true)
    expect(hasLiquidLoop(s)).toBe(true)
    expect(upgradeHardware(s, t.id)).toBe(true)
    expect(t.hwId).toBe('hw_giga')
    updatePower(s)
    expect(t.online).toBe(true)
  })

  it('an existing liquid rack goes dark (hard gate, not throttle) if the loop is removed', () => {
    const s = createState(7)
    richBuild(s)
    powerFor(s)
    tryBuild(s, 'cooling_liquid', 16, 4)
    const t = superpodRack(s)
    expect(upgradeHardware(s, t.id)).toBe(true) // → NVL72 (liquid), loop present
    updatePower(s)
    expect(t.online).toBe(true)
    expect(t.throttle).toBeGreaterThan(0)
    // sell the loop: the liquid rack is HARD-gated offline (not a soft throttle).
    const loop = s.towers.find((x) => x.def.kind === 'cooling_liquid')!
    sellTower(s, loop.id)
    updatePower(s)
    expect(hasLiquidLoop(s)).toBe(false)
    expect(t.online).toBe(false) // dark — cannot be served at all
    expect(t.throttle).toBe(0)
    expect(isBrownout(s)).toBe(true) // surfaced as a power/cooling warning
    // an AIR rack is never affected by the loop's absence.
    tryBuild(s, 'srv_edge', 5, 2)
    const air = lastTower(s)
    updatePower(s)
    expect(air.online).toBe(true)
  })

  it('cooling follows the dossier rule: >1000 W/GPU or a beyond-air rack density is liquid; DGX H200/B200 stay air', () => {
    // REFERENCE-DOSSIER §5.5: ≲1000 W/GPU is air-coolable (DGX H200 ~10.2 kW, DGX B200
    // ~14.3 kW ship air-cooled); GB200 NVL72 (~120 kW rack, 1200 W/GPU) is liquid-only.
    const AIR_RACK_KW_MAX = 40
    for (const hw of Object.values(HARDWARE_DEFS)) {
      const liquid = hw.tdpWattsPerGpu > 1000 || hw.tdpWatts / 1000 > AIR_RACK_KW_MAX
      expect(hwNeedsLiquid(hw)).toBe(liquid)
    }
    for (const hwId of ['hw_edge', 'hw_standard', 'hw_perf', 'hw_frontier', 'hw_pod', 'hw_superpod'])
      expect(hwNeedsLiquid(HARDWARE_DEFS[hwId])).toBe(false)
    expect(hwNeedsLiquid(HARDWARE_DEFS.hw_giga)).toBe(true)
  })
})

describe('campaign flow', () => {
  it('clears Wave 1 with a sensible build and keeps Trust healthy', () => {
    const s = createState(7)
    richBuild(s)
    startGame(s)
    // blanket BOTH ingress sides (top lanes along row 1, bottom lanes along row 9),
    // power and cool it — wave 1 is a tier-1 trickle spread across all four lanes.
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'chat', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'chat', col, 8)
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true)
    runFor(s, 60)
    expect(s.phase).toBe('build') // wave cleared, back to building
    expect(s.meters.trust).toBeGreaterThan(50)
    expect(s.stats.served).toBeGreaterThanOrEqual(5)
  })

  it('is deterministic for identical inputs', () => {
    const play = (seed: number) => {
      const s = createState(seed)
      richBuild(s)
      startGame(s)
      for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 2)
      for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
      startWave(s)
      runFor(s, 40)
      return s
    }
    const a = play(11)
    const b = play(11)
    expect(a.meters).toEqual(b.meters)
    expect(a.stats).toEqual(b.stats)
    expect(Math.round(a.data)).toEqual(Math.round(b.data))
  })
})

describe('tech tree (no cash upgrades remain after P3d)', () => {
  it('the safety cash upgrades are gone (RLHF → Studio method, red-team → eval track)', () => {
    // P3d: saf_rlhf / saf_redteam are removed. RLHF is a Post-Training Studio METHOD
    // (P3b; safety alignment is per-model now) and red-teaming is a dev-time EVAL on
    // the eval track (§3.6). There are no cash UPGRADES left to buy.
    expect(UPGRADE_MAP['saf_rlhf']).toBeUndefined()
    expect(UPGRADE_MAP['saf_redteam']).toBeUndefined()
    expect(UPGRADES.length).toBe(0)
    // the red-team eval lives on the eval research track instead
    expect(RESEARCH_DEFS['r_eval_redteam_v1']).toBeDefined()
    expect(RESEARCH_DEFS['r_eval_redteam_v1'].kind).toBe('eval')
  })

  it('the removed serving cash upgrades no longer exist (migrated to s.infra)', () => {
    for (const gone of ['scale_pretrain', 'scale_throughput', 'eff_quant', 'eff_int4', 'eff_flash', 'eff_distill', 'eff_spec', 'prod_route', 'prod_cache', 'prod_batch']) {
      expect(UPGRADE_MAP[gone]).toBeUndefined()
    }
    // a deployed model's quality is the checkpoint's benchmarked vector LESS the
    // §3.2 alignment tax (P3d): no global +quality buff (model polish is the
    // Post-Training Studio, P3b), but an aligned model trades capability for safety.
    const s = createState(9)
    const m = MODEL_DEFS[STARTER]
    const tax = TAX_K[m.alignment.refusalStyle] * Math.max(0, m.alignment.safety - 40) / 100
    expect(serverQuality(s, defLoadout(TOWER_DEFS['srv_edge']))).toBeCloseTo(m.quality - tax, 6)
  })
})

describe('racks & model deployment', () => {
  it('a new rack ships with the free starter model preloaded', () => {
    const s = createState(30)
    richBuild(s)
    expect(tryBuild(s, 'srv_edge', 3, 2)).toBe(true)
    const t = lastTower(s)
    expect(t.hwId).toBe('hw_edge')
    expect(t.modelId).toBe(STARTER)
  })

  it('deploying an open model is free and gated ONLY by VRAM (no method gates after P3c)', () => {
    const s = createState(31)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching', 'inf_wq_fp8') // FP8 fits a 33B on 48 GB
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    // GENERAL (Qwen3-32B, 34 GB FP8) does not fit a 24 GB Edge rack
    expect(deployModel(s, t.id, GENERAL)).toBe(false)
    expect(upgradeHardware(s, t.id)).toBe(true) // edge → standard (48 GB)
    // it fits now — and reasoning is a MODEL attribute, not a gate: it deploys.
    const cash = s.meters.cash
    expect(deployModel(s, t.id, GENERAL)).toBe(true)
    expect(t.modelId).toBe(GENERAL)
    expect(s.meters.cash).toBe(cash) // deployment is free
    // BIG (Qwen3.5-122B, 122 GB at FP8) still does not fit a Standard rack
    expect(deployModel(s, t.id, BIG)).toBe(false)
    // redeploying the same model is a no-op
    expect(deployModel(s, t.id, GENERAL)).toBe(false)
  })

  it('an MoE model deploys when its (large) VRAM fits — no MoE gate (R4)', () => {
    const s = createState(34)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching', 'inf_wq_fp8') // FP8 so a 30B-class model fits the 48 GB standard rack
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    upgradeHardware(s, t.id) // → standard (48 GB)
    // Gemma 4 31B (dense coder) and Nemotron Cascade 2 30B-A3B (MoE + reasoning) BOTH
    // deploy freely: MoE sparsity / reasoning are model attributes, not deploy gates.
    expect(deployModel(s, t.id, CODER)).toBe(true)
    expect(deployModel(s, t.id, MOE)).toBe(true)
  })

  it('hardware upgrades walk the tier ladder up to GigaCluster', () => {
    const s = createState(32)
    richBuild(s)
    // the top tier (the GB200 NVL72) is liquid-cooled — a Liquid Cooling Loop is
    // required before upgrading into it (§6.5 hard gate, OQ-G8); the DGX nodes are air.
    tryBuild(s, 'cooling_liquid', 7, 4)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    const cash0 = s.meters.cash
    expect(upgradeHardware(s, t.id)).toBe(true)
    expect(t.hwId).toBe('hw_standard')
    expect(s.meters.cash).toBe(cash0 - (HARDWARE_DEFS.hw_standard.cost - HARDWARE_DEFS.hw_edge.cost))
    for (let i = 0; i < 5; i++) expect(upgradeHardware(s, t.id)).toBe(true)
    expect(t.hwId).toBe('hw_giga')
    expect(upgradeHardware(s, t.id)).toBe(false) // maxed
  })

  it('selling refunds 60% of the current rack value (models are not goods)', () => {
    const s = createState(33)
    richBuild(s)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    upgradeHardware(s, t.id)
    expect(towerValue(s, t)).toBe(HARDWARE_DEFS.hw_standard.cost)
    const cash0 = s.meters.cash
    expect(sellTower(s, t.id)).toBe(true)
    expect(s.meters.cash).toBe(cash0 + Math.round(HARDWARE_DEFS.hw_standard.cost * 0.6))
  })
})

describe('model methods (MoE / Reasoning as deploy gates)', () => {
  it('open models are owned for free from the start', () => {
    const s = createState(40)
    // every roster model is already owned — the gate is VRAM + method, not research
    expect(s.models[STARTER]).toBe(true)
    expect(s.models[FRONTIER]).toBe(true)
    expect(Object.keys(s.models).length).toBeGreaterThan(10)
  })

  it('MoE serves cheap (active params) but VRAM tracks ALL experts (total params)', () => {
    const s = createState(42)
    const moeLo = loadout(s, 'hw_perf', MOE) // 31.6B total / 3.2B active
    const denseLo = loadout(s, 'hw_perf', 'qwen36_27b') // 27B dense, ~27B active
    expect(serverFitsMemory(s, moeLo)).toBe(true)
    expect(serverFitsMemory(s, denseLo)).toBe(true)
    // sparse activation → far higher token throughput than a similarly-sized dense model
    // (compute roof = aggTflops / (2 × activeB): 3.3B active beats 27B active).
    expect(serverComputeCeiling(s, moeLo)).toBeGreaterThan(serverComputeCeiling(s, denseLo))
    expect(decodeTokSb1(s, moeLo)).toBeGreaterThan(decodeTokSb1(s, denseLo))
    // but VRAM is all experts resident = paramsTotalB × bytesPerParam (FP16=2, §4.8/§5.6)
    expect(serverModelMemory(s, moeLo)).toBeCloseTo(MODEL_DEFS[MOE].paramsTotalB * 2, 6)
    expect(serverModelMemory(s, denseLo)).toBeCloseTo(MODEL_DEFS['qwen36_27b'].paramsTotalB * 2, 6)
  })

  it('a reasoning model deploys without a gate (R4) and answers a lane a non-reasoner cannot', () => {
    // intrinsic quality (no global buff): the thinking model clears reason=82,
    // the dense generalist does not.
    expect(MODEL_DEFS[GENERAL].qualityBy.reasoning).toBeGreaterThanOrEqual(82)
    expect(MODEL_DEFS[WEAK].qualityBy.reasoning).toBeLessThan(82)
    expect(MODEL_DEFS[GENERAL].isReasoning).toBe(true)

    // P3c: reasoning is a MODEL attribute (its gain is already in qualityBy) — there
    // is NO Reasoning deploy gate; a thinking model deploys the instant its VRAM fits.
    const s = createState(43)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching')
    tryBuild(s, 'srv_frontier', 3, 2)
    const t = lastTower(s)
    expect(deployModel(s, t.id, GENERAL)).toBe(true)
  })

  it('methodsUnlocked is always true (the MoE/Reasoning gates are gone, R4)', () => {
    const s = createState(44)
    expect(methodsUnlocked(s, MODEL_DEFS[STARTER])).toBe(true) // dense
    expect(methodsUnlocked(s, MODEL_DEFS[CODER])).toBe(true) // dense coder
    expect(methodsUnlocked(s, MODEL_DEFS[MOE])).toBe(true) // MoE — no gate any more
    // and the old gate research nodes no longer exist
    expect(RESEARCH_DEFS['r_tech_moe']).toBeUndefined()
    expect(RESEARCH_DEFS['r_tech_reasoning']).toBeUndefined()
  })
})

/* --------------------------------------------------------------------------
 * Post-Training Studio (§1) — unlimited, iterative, player-created derived
 * models with real post-training recipes, tradeoffs, and lineage. The closed
 * ft_agent/pt_giga cards are GONE; their role (agentic specialist / quality
 * ceiling) is now PLAYER-CREATED here.
 * ------------------------------------------------------------------------ */

/** Stand up a lab + a fleet that can absorb the requisition, and unlock a method. */
function studioRig(seed: number, methodFlags: string[] = []): GameState {
  const s = createState(seed)
  s.meters.cash = 99999
  s.phase = 'build'
  s.data = 999
  infraOn(s, 'inf_batching')
  for (const f of methodFlags) s.upgrades[f] = 1
  tryBuild(s, 'lab', 2, 4)
  // a fat frontier fleet so the shared requisition pool trains fast
  for (const c of [3, 6, 9, 15, 18, 21]) tryBuild(s, 'srv_frontier', c, 2)
  for (const t of s.towers) t.online = true
  return s
}

/** Drive a posttrain slot to completion without coupling Studio tests to map survival. */
function trainToCompletion(s: GameState, maxSec = 200): void {
  let t = 0
  while (s.research.posttrain && t < maxSec) {
    updateResearch(s, SIM_DT)
    t += SIM_DT
  }
  // return to build phase so a follow-up Studio run can start (canPostTrain gate)
  s.phase = 'build'
  s.waveActive = false
}

describe('Post-Training Studio (§1)', () => {
  it('the closed custom cards are gone; the recipe table has all 12 methods', () => {
    expect(MODEL_DEFS['ft_agent']).toBeUndefined()
    expect(MODEL_DEFS['pt_giga']).toBeUndefined()
    expect(RESEARCH_DEFS['r_ft_agent']).toBeUndefined()
    expect(RESEARCH_DEFS['r_pt_giga']).toBeUndefined()
    expect(Object.keys(METHOD_RECIPES).length).toBe(12)
  })

  it('the shipped recipe table passes the P5 §6.3 band-displacement calibration', () => {
    // calibrateRecipes is a VALIDATING pass-through (P5): the authored constants
    // already pass the balance gate, so it returns the table unchanged — but it
    // asserts the §6.3 gain ordering so a hand-edit cannot silently break balance.
    expect(recipeGainOrderingOk(METHOD_RECIPES)).toBe(true)
    expect(calibrateRecipes(METHOD_RECIPES)).toBe(METHOD_RECIPES) // identity (no mutation)
    // merge averages (no gainScale); adapters move less than the heavy methods;
    // GRPO is the strongest reasoning/agentic path (§1.4).
    expect(METHOD_RECIPES['merge'].gainScale).toBe(0)
    expect(METHOD_RECIPES['grpo'].gainScale).toBeGreaterThan(METHOD_RECIPES['lora'].gainScale)
    expect(METHOD_RECIPES['grpo'].gainScale).toBeGreaterThanOrEqual(METHOD_RECIPES['rlhf'].gainScale)
  })

  it('a recipe pays Data, occupies the posttrain track, and on completion creates a derived model with the expected gain + lineage', () => {
    // GRPO reasoning on Qwen3.5-122B (an R1-style self-built reasoner, §1.4).
    const s = studioRig(50, ['pt_rl'])
    const base = MODEL_DEFS[BIG]
    expect(methodUnlocked(s, 'grpo')).toBe(true)
    const recipe = METHOD_RECIPES['grpo']
    const data0 = s.data
    const seq0 = s.derivedSeq

    expect(startPostTrain(s, [BIG], 'grpo', 'reasoning', 1.0)).toBe(true)
    // Data is paid up front; the posttrain track is occupied; other tracks free.
    expect(s.data).toBe(data0 - postTrainDataCost(recipe, 1.0, 0, base.paramsTotalB))
    expect(s.research.posttrain?.kind).toBe('posttrain')
    expect(s.research.posttrain?.meta?.method).toBe('grpo')
    expect(s.research.infra).toBeNull()
    // the slot's compute matches the §1.4 cost formula (incl. the total-params size terms)
    expect(s.research.posttrain!.compute).toBeCloseTo(
      Math.max(1, postTrainComputeCost(recipe, base.paramsActiveB, 1.0, 0, base.paramsTotalB)),
      3,
    )

    trainToCompletion(s)
    // exactly one derived model, owned, with a lineage record
    expect(s.research.posttrain).toBeNull()
    const ids = Object.keys(s.derivedModels)
    expect(ids.length).toBe(1)
    const drv = s.derivedModels[ids[0]]
    expect(drv.id).toBe(`drv_${seq0}`)
    expect(s.models[drv.id]).toBe(true)
    expect(drv.origin).toBe('derived')
    expect(drv.lineage?.method).toBe('grpo')
    expect(drv.lineage?.target).toBe('reasoning')
    expect(drv.lineage?.baseModelIds).toEqual([BIG])
    expect(drv.lineage?.depth).toBe(1)
    // the target axis gained the predicted amount (deriveQuality), and it is a thinker now
    const gain = deriveQuality(base, recipe, 'reasoning', 1.0, 1)
    expect(gain).toBeGreaterThan(0)
    expect(drv.qualityBy.reasoning).toBeCloseTo(base.qualityBy.reasoning + gain, 3)
    expect(drv.isReasoning).toBe(true)
  })

  it('fine-tune-a-fine-tune: depth increments and depthDamp reduces the marginal gain', () => {
    const s = studioRig(51, ['pt_lora'])
    const base = MODEL_DEFS[BIG]
    // first LoRA-coding (depth 1)
    expect(startPostTrain(s, [BIG], 'lora', 'coding', 1.0)).toBe(true)
    trainToCompletion(s)
    const d1 = s.derivedModels[`drv_0`]
    expect(d1.lineage?.depth).toBe(1)
    const gain1 = deriveQuality(base, METHOD_RECIPES['lora'], 'coding', 1.0, 1)

    // LoRA-coding AGAIN, this time on the derived model (depth 2)
    expect(startPostTrain(s, [d1.id], 'lora', 'coding', 1.0)).toBe(true)
    trainToCompletion(s)
    const d2 = s.derivedModels[`drv_1`]
    expect(d2.lineage?.depth).toBe(2)
    const gain2 = deriveQuality(d1, METHOD_RECIPES['lora'], 'coding', 1.0, 2)
    // depthDamp(2) < depthDamp(1): the second pass's depth-damped rawGain is smaller
    // (when not capped by headroom). Assert the depth-damp itself bites.
    const rawGain1 = METHOD_RECIPES['lora'].gainScale * Math.sqrt(1.0) * (1 / (1 + 0.15 * 1))
    const rawGain2 = METHOD_RECIPES['lora'].gainScale * Math.sqrt(1.0) * (1 / (1 + 0.15 * 2))
    expect(rawGain2).toBeLessThan(rawGain1)
    expect(gain2).toBeLessThanOrEqual(gain1 + 1e-9)
  })

  it('method gating: a recipe whose requiresTech is unresearched is rejected; sft works without an unlock', () => {
    const s = studioRig(52) // NO method flags
    // GRPO needs r_pt_rl
    expect(methodUnlocked(s, 'grpo')).toBe(false)
    expect(canPostTrain(s, [BIG], 'grpo', 'reasoning')).toBe(false)
    expect(startPostTrain(s, [BIG], 'grpo', 'reasoning', 1.0)).toBe(false)
    // SFT is the starter — no unlock required
    expect(methodUnlocked(s, 'sft')).toBe(true)
    expect(startPostTrain(s, [BIG], 'sft', 'chat', 1.0)).toBe(true)
    // a disallowed target is rejected (sft cannot target reasoning)
    const s2 = studioRig(53)
    expect(canPostTrain(s2, [BIG], 'sft', 'reasoning')).toBe(false)
  })

  it('deriveQuality tradeoffs: RLHF/safety raises alignment.safety but taxes general; forgetting lowers non-target axes', () => {
    const s = studioRig(54, ['pt_lora', 'pt_pref'])
    const base = MODEL_DEFS[BIG]
    expect(startPostTrain(s, [BIG], 'rlhf', 'safety', 1.0)).toBe(true)
    trainToCompletion(s)
    const drv = s.derivedModels[`drv_0`]
    // alignment tax: safety rises, general falls
    expect(drv.alignment.safety).toBeGreaterThan(base.alignment.safety)
    expect(drv.qualityBy.general).toBeLessThan(base.qualityBy.general)
    // crude RLHF raises over-refusal (the §2.4 tension)
    expect(drv.alignment.overRefusal).toBeGreaterThan(base.alignment.overRefusal)
    // catastrophic forgetting: a non-target capability axis (coding) drifts down
    expect(drv.qualityBy.coding).toBeLessThan(base.qualityBy.coding)

    // CAI is a Pareto safety gain: raises safety AND lowers over-refusal (safe-completion)
    const s2 = studioRig(55, ['pt_lora', 'pt_pref', 'pt_cai'])
    expect(startPostTrain(s2, [BIG], 'cai', 'safety', 1.0)).toBe(true)
    trainToCompletion(s2)
    const cai = s2.derivedModels[`drv_0`]
    expect(cai.alignment.safety).toBeGreaterThan(base.alignment.safety)
    expect(cai.alignment.overRefusal).toBeLessThan(base.alignment.overRefusal)
    expect(cai.alignment.refusalStyle).toBe('safe-completion')
  })

  it('a derived model is deployable (resolveModel + fits VRAM) and serves in combat', () => {
    const s = studioRig(56, ['pt_rl'])
    infraOn(s, 'inf_wq_fp8') // FP8: a 122B fits a 141 GB H200
    expect(startPostTrain(s, [BIG], 'grpo', 'agentic', 1.0)).toBe(true)
    trainToCompletion(s)
    const drv = s.derivedModels[`drv_0`]
    // resolveModel finds it; it fits a Frontier rack at FP8 and is owned
    expect(resolveModel(s, drv.id)).toBe(drv)
    expect(serverFitsMemory(s, loadout(s, 'hw_frontier', drv.id))).toBe(true)
    // deploy onto a placed rack and serve a chat to prove it works in combat
    s.phase = 'build'
    tryBuild(s, 'srv_frontier', 12, 5)
    const t = lastTower(s)
    expect(deployModel(s, t.id, drv.id)).toBe(true)
    // a second rack so the wave can be served while the first proves out
    tryBuild(s, 'srv_frontier', 9, 5)
    deployModel(s, lastTower(s).id, drv.id)
    const served0 = s.stats.served
    liveWave(s)
    spawnRequest(s, 'chat')
    runFor(s, 14)
    expect(s.stats.served).toBeGreaterThan(served0)
  })

  it('C7: an infra tech and a Studio run progress CONCURRENTLY on the shared pool', () => {
    const s = studioRig(57, ['pt_rl'])
    expect(startResearch(s, 'inf_paged')).toBe(true) // infra track (needs batching)
    expect(startPostTrain(s, [BIG], 'grpo', 'reasoning', 1.0)).toBe(true) // posttrain track

    expect(s.research.infra?.id).toBe('inf_paged')
    expect(s.research.posttrain?.meta?.method).toBe('grpo')
    expect(s.research.eval).toBeNull()
    // a busy infra track rejects a second infra project (inf_wq_fp8's prereq
    // inf_batching is owned, so the rejection is the busy track, not prereqs);
    // the posttrain track is full too.
    expect(startResearch(s, 'inf_wq_fp8')).toBe(false)
    expect(startPostTrain(s, [GENERAL], 'grpo', 'reasoning', 1.0)).toBe(false)

    for (const t of s.towers) t.online = true
    const p0Infra = s.research.infra!.progress
    const p0Post = s.research.posttrain!.progress
    updateResearch(s, 0.1)
    expect(s.research.infra!.progress).toBeGreaterThan(p0Infra)
    expect(s.research.posttrain!.progress).toBeGreaterThan(p0Post)
    // the shared pool splits EQUALLY across the two live tracks
    expect(s.research.infra!.progress).toBeCloseTo(s.research.posttrain!.progress, 6)
  })

  it('the Studio replaces the closed cards: a GRPO-agentic derived model is the agentic specialist', () => {
    // a GRPO-agentic run on a frontier base closes the agentic lane (§1.5: this is
    // the player-created replacement for the deleted ft_agent card).
    const s = studioRig(58, ['pt_rl'])
    const base = MODEL_DEFS[AGENT_SHORT] // 117B, agentic below 82
    expect(base.qualityBy.agentic).toBeLessThan(82)
    expect(startPostTrain(s, [AGENT_SHORT], 'grpo', 'agentic', 1.5)).toBe(true)
    trainToCompletion(s)
    const drv = s.derivedModels[`drv_0`]
    expect(drv.qualityBy.agentic).toBeGreaterThan(base.qualityBy.agentic)
    expect(drv.lineage?.relation).toBe('finetune')
  })
})

/* --------------------------------------------------------------------------
 * S9 Studio PREVIEW parity (§5.2) — the read-only `studioPreview` the UI shows
 * before committing MUST match what `deriveModel` actually produces (both call
 * the shared pure `computeDerivedFields`). This is the load-bearing guarantee:
 * the preview never lies about the projected checkpoint.
 * ------------------------------------------------------------------------ */
describe('Studio preview parity (§5.2 S9)', () => {
  const AXES = ['chat', 'coding', 'reasoning', 'general', 'agentic'] as const

  /** Run the preview, then actually train, and assert the snapshot matches field-for-field. */
  function assertParity(
    s: GameState,
    baseId: string,
    method: Parameters<typeof startPostTrain>[2],
    target: Parameters<typeof startPostTrain>[3],
    effort: number,
    otherId?: string,
  ): void {
    const before = resolveModel(s, baseId)!
    const ids = method === 'merge' ? [baseId, otherId ?? baseId] : [baseId]
    const prev = studioPreview(s, baseId, method, target, effort, 1000, otherId)!
    expect(prev).not.toBeNull()
    // the preview reports the real costs (parity with the cost helpers), incl. the
    // lineage-depth surcharge on a fine-tune-of-a-fine-tune (baseDepth > 0).
    const recipe = METHOD_RECIPES[method]
    const baseDepth = before.lineage?.depth ?? 0
    expect(prev.dataCost).toBe(postTrainDataCost(recipe, effort, baseDepth, before.paramsTotalB))
    expect(prev.computeCost).toBeCloseTo(
      Math.max(1, postTrainComputeCost(recipe, before.paramsActiveB, effort, baseDepth, before.paramsTotalB)),
      3,
    )
    expect(prev.before).toEqual(before.qualityBy)

    const seq = s.derivedSeq
    expect(startPostTrain(s, ids, method, target, effort)).toBe(true)
    trainToCompletion(s)
    const drv = s.derivedModels[`drv_${seq}`]
    expect(drv).toBeDefined()

    // every projected field equals the real derived snapshot
    for (const a of AXES) expect(prev.fields.qualityBy[a]).toBeCloseTo(drv.qualityBy[a], 6)
    expect(prev.fields.name).toBe(drv.name)
    expect(prev.fields.spec).toBe(drv.spec)
    expect(prev.fields.tier).toBe(drv.tier)
    expect(prev.fields.paramsTotalB).toBe(drv.paramsTotalB)
    expect(prev.fields.paramsActiveB).toBe(drv.paramsActiveB)
    expect(prev.fields.isMoE).toBe(drv.isMoE)
    expect(prev.fields.isReasoning).toBe(drv.isReasoning)
    expect(prev.fields.nativeWeightBytes).toBe(drv.nativeWeightBytes)
    expect(prev.fields.kvBytesPerToken).toBe(drv.kvBytesPerToken)
    expect(prev.fields.kvStateMbPerReq).toBe(drv.kvStateMbPerReq)
    expect(prev.fields.thinkTokens).toBe(drv.thinkTokens)
    expect(prev.fields.contextWindowK).toBe(drv.contextWindowK)
    expect(prev.fields.alignment.safety).toBeCloseTo(drv.alignment.safety, 6)
    expect(prev.fields.alignment.overRefusal).toBeCloseTo(drv.alignment.overRefusal, 6)
    expect(prev.fields.alignment.refusalStyle).toBe(drv.alignment.refusalStyle)
    expect(prev.fields.instructFollow).toBeCloseTo(drv.instructFollow, 6)
    expect(prev.fields.depth).toBe(drv.lineage!.depth)
    // the per-axis delta the UI draws is exactly after − before
    for (const a of AXES) expect(prev.delta[a]).toBeCloseTo(drv.qualityBy[a] - before.qualityBy[a], 6)
    expect(prev.safetyDelta).toBeCloseTo(drv.alignment.safety - before.alignment.safety, 6)
  }

  it('GRPO reasoning preview matches the trained checkpoint', () => {
    assertParity(studioRig(120, ['pt_rl']), BIG, 'grpo', 'reasoning', 1.0)
  })
  it('RLHF safety preview (alignment tax + over-refusal) matches', () => {
    assertParity(studioRig(121, ['pt_lora', 'pt_pref']), BIG, 'rlhf', 'safety', 1.5)
  })
  it('CAI safety preview (safe-completion Pareto) matches', () => {
    assertParity(studioRig(122, ['pt_lora', 'pt_pref', 'pt_cai']), BIG, 'cai', 'safety', 1.0)
  })
  it('QAT preview (reshapes deploy: nativeWeightBytes → 0.5, −2 quality) matches', () => {
    assertParity(studioRig(123, ['pt_qat']), BIG, 'qat', 'general', 1.0)
  })
  it('Distill preview (student body swap) matches', () => {
    assertParity(studioRig(124, ['pt_rl', 'pt_distill']), FRONTIER, 'distill', 'reasoning', 1.0)
  })
  it('Merge preview (averages two same-base checkpoints, blends alignment) matches', () => {
    const s = studioRig(125, ['pt_lora', 'pt_merge', 'pt_rl'])
    expect(startPostTrain(s, [BIG], 'lora', 'coding', 1.0)).toBe(true)
    trainToCompletion(s)
    expect(startPostTrain(s, [BIG], 'grpo', 'reasoning', 1.0)).toBe(true)
    trainToCompletion(s)
    assertParity(s, 'drv_0', 'merge', 'general', 1.0, 'drv_1')
  })
  it('a fine-tune-of-a-fine-tune preview (depth 2, depthDamp) matches', () => {
    const s = studioRig(126, ['pt_lora'])
    expect(startPostTrain(s, [BIG], 'lora', 'coding', 1.0)).toBe(true)
    trainToCompletion(s)
    const d1 = s.derivedModels['drv_0']
    assertParity(s, d1.id, 'lora', 'coding', 1.0)
  })

  it('preview reports estWaves from the fleet requisition pool and ok=false for a disallowed target', () => {
    const s = studioRig(127, ['pt_rl'])
    const withFleet = studioPreview(s, BIG, 'grpo', 'reasoning', 1.0, 5000)!
    expect(withFleet.estWaves).toBeGreaterThanOrEqual(1)
    const noFleet = studioPreview(s, BIG, 'grpo', 'reasoning', 1.0, 0)!
    expect(noFleet.estWaves).toBe(0)
    // grpo cannot target chat → ok=false (the UI disables Train)
    const bad = studioPreview(s, BIG, 'grpo', 'chat', 1.0, 5000)!
    expect(bad.ok).toBe(false)
    expect(withFleet.ok).toBe(true)
  })
})

/* H2 (qwen3_30b_a3b) + nemotron swap balance assertions (§1.5). */
describe('roster balance fixes (§1.5)', () => {
  it('H2: a small MoE genuinely lags on agentic (its real wall); a frontier / GRPO-agentic derived clears it', () => {
    const AGENT_DIFFICULTY = 82 // agent archetype primaryAxis difficulty (content.ts)
    // the small MoE answers fast but its agentic axis is below the wall
    expect(MODEL_DEFS[MOE].qualityBy.agentic).toBeLessThan(AGENT_DIFFICULTY)
    // a top terminal-agent frontier clears the lane outright
    expect(MODEL_DEFS[FRONTIER].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_DIFFICULTY)
    // …but a big model that is only MID on Terminal-Bench Hard (gpt-oss 120B) is short
    // of the wall — a player GRPO-agentic run lifts it over.
    const s = studioRig(59, ['pt_rl'])
    expect(MODEL_DEFS[AGENT_SHORT].qualityBy.agentic).toBeLessThan(AGENT_DIFFICULTY)
    expect(startPostTrain(s, [AGENT_SHORT], 'grpo', 'agentic', 2.0)).toBe(true)
    trainToCompletion(s)
    const drv = s.derivedModels[`drv_0`]
    expect(drv.qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_DIFFICULTY)
  })

  it('nemotron swap: the dense 253B trap is gone, replaced by a real 120B/12B MoE with an active-param advantage', () => {
    expect(MODEL_DEFS['nemotron_ultra']).toBeUndefined()
    const nem = MODEL_DEFS['nemotron_super']
    expect(nem).toBeDefined()
    expect(nem.isMoE).toBe(true)
    expect(nem.paramsTotalB).toBe(120)
    expect(nem.paramsActiveB).toBe(12)
    // a real active-param advantage → cheaper to serve than the old dense 253B:
    // decode b=1 ∝ 1 / activeB, so 12B active decodes far faster than 253B dense.
    const s = createState(60) // BF16: 240 GB of weights span two of the pod's H200s
    infraOn(s, 'inf_par_tp') // spanning GPUs needs Tensor Parallelism
    expect(serverFitsMemory(s, loadout(s, 'hw_pod', 'nemotron_super'))).toBe(true)
    expect(serverSpeed(s, loadout(s, 'hw_pod', 'nemotron_super'))).toBeGreaterThan(0)
  })
})

describe('hardware/model split (expert mechanics)', () => {
  // each rack tier paired with the model it hosts on the real ladder; tested at FP8 with
  // Tensor + Pipeline Parallelism researched (so multi-GPU racks can span a big model).
  const PAIRS: [string, string][] = [
    ['hw_edge', STARTER], // sub-1B → 24 GB L4
    ['hw_standard', GENERAL], // 27B (FP8) → 48 GB L40S
    ['hw_perf', AGENT_SHORT], // 117B MXFP4 (~65 GB) → 80 GB H100
    ['hw_frontier', BIG], // 122B (FP8) → 141 GB H200
    ['hw_pod', 'nemotron_super'], // 120B MoE / 12B active → one H200 at FP8 → eight copies
    ['hw_superpod', MLA], // 753B (FP8) → a 4-GPU tensor-parallel group, two copies
    ['hw_giga', 'kimi_k3'], // 2.78T MXFP4 (~1.56 TB) → two pipeline stages of TP8, four copies
  ]
  const fp8State = (seed: number): GameState => {
    const s = createState(seed)
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8', 'inf_par_tp', 'inf_par_pp')
    return s
  }

  it('batching: per-user speed falls as cohorts pile on while the rack aggregate rises toward its compute roof', () => {
    const s = fp8State(20)
    for (const [hwId, mid] of PAIRS) {
      const lo = loadout(s, hwId, mid)
      expect(serverFitsMemory(s, lo)).toBe(true)
      const roof = serverComputeCeiling(s, lo)
      const solo = decodeTokSb1(s, lo) // one stream alone on a lane: the fastest a user is ever served
      const one = serverPerUserDecodeTokS(s, lo, 1)
      const full = serverPerUserDecodeTokS(s, lo, serverTargets(s, lo))
      expect(serverSpeed(s, lo)).toBeCloseTo(one, 6) // the headline: one cohort on the rack
      expect(one).toBeLessThanOrEqual(solo + 1e-9)
      expect(full).toBeLessThanOrEqual(one + 1e-9)
      const agg1 = serverAggDecodeTokS(s, lo, 1)
      const aggFull = serverAggDecodeTokS(s, lo, serverTargets(s, lo))
      expect(aggFull).toBeGreaterThan(agg1)
      expect(aggFull).toBeLessThanOrEqual(roof + 1e-6) // never past the roof
    }
  })

  it('decode reads the active weights at HBM bandwidth × MBU, plus the engine step overhead (§5.7)', () => {
    const s = createState(28) // BF16, no research
    const m = MODEL_DEFS[GENERAL] // 27B dense, fits one 80 GB H100 at BF16
    const lo = loadout(s, 'hw_perf', GENERAL)
    const stepSec = (m.paramsActiveB * 1e9 * 2) / (3.35e12 * MBU_DECODE) + STEP_OVERHEAD_MS / 1000
    expect(decodeTokSb1(s, lo)).toBeCloseTo(1 / stepSec, 6)
    // the compute roof = dense BF16 rate × decode MFU / (2 FLOPs per active param per token)
    expect(computeRoofTokS(s, lo)).toBeCloseTo((989e12 * MFU_DECODE) / (2 * m.paramsActiveB * 1e9), 3)
  })

  it('prefill is compute-bound at MFU and super-linear in prompt length (O(n²) attention, §1.1)', () => {
    const s = createState(29)
    const m = MODEL_DEFS[GENERAL]
    const lo = loadout(s, 'hw_perf', GENERAL) // 27B BF16 fits the 80 GB H100
    const short = prefillTokS(s, lo, 512)
    const long = prefillTokS(s, lo, 16000)
    expect(short).toBeCloseTo((989e12 * MFU_PREFILL) / (2 * m.paramsActiveB * 1e9 * (1 + 512 / 16000)), 3)
    // longer prompts ingest slower per token (superlinear = 1 + n/16000)
    expect(long).toBeLessThan(short)
    expect(short / long).toBeCloseTo((1 + 16000 / 16000) / (1 + 512 / 16000), 3)
  })

  it('a model that fits no GPU group of the rack cannot serve at all', () => {
    const s = createState(21) // BF16, no parallelism research
    // Qwen3.5-122B (244 GB BF16) jammed into a 24 GB edge rack
    const edge = loadout(s, 'hw_edge', BIG)
    expect(serverFitsMemory(s, edge)).toBe(false)
    expect(deployBlocker(s, edge)).toBe('vram')
    expect(serverTargets(s, edge)).toBe(0)
    expect(serverSpeed(s, edge)).toBe(0)
    // 122B BF16 = 244 GB > one H200 (141 GB)
    expect(serverFitsMemory(s, loadout(s, 'hw_frontier', BIG))).toBe(false)
    // the 2.78T Kimi K3 (~1.56 TB MXFP4) needs more than one 8-GPU node anywhere but an NVL72
    infraOn(s, 'inf_par_tp', 'inf_par_pp')
    expect(serverFitsMemory(s, loadout(s, 'hw_pod', 'kimi_k3'))).toBe(false)
    expect(serverFitsMemory(s, loadout(s, 'hw_superpod', 'kimi_k3'))).toBe(false)
    expect(serverFitsMemory(s, loadout(s, 'hw_giga', 'kimi_k3'))).toBe(true)
  })

  it('a multi-GPU rack is not one big GPU: a model spans GPUs only with Tensor (≤8) / Pipeline (>8) Parallelism', () => {
    const s = createState(31) // BF16
    const pod = loadout(s, 'hw_pod', BIG) // 244 GB: needs two H200s
    expect(serverFitsMemory(s, pod)).toBe(false)
    expect(deployBlocker(s, pod)).toBe('tp') // the picker / denied reason says "needs Tensor Parallelism"
    infraOn(s, 'inf_par_tp')
    expect(serverFitsMemory(s, pod)).toBe(true)
    const p = rackPlan(s, pod)
    expect(p.g).toBe(2) // the smallest power-of-two group that holds it
    expect(p.tpDeg).toBe(2)
    expect(p.replicas).toBe(4) // the other GPUs run more copies
    // beyond 8 GPUs a copy needs Pipeline Parallelism (memory only, never per-user speed)
    const giga = loadout(s, 'hw_giga', 'kimi_k3')
    expect(deployBlocker(s, giga)).toBe('pp')
    infraOn(s, 'inf_par_pp')
    const gp = rackPlan(s, giga)
    expect(gp.fits).toBe(true)
    expect(gp.tpDeg).toBe(8)
    expect(gp.stages).toBe(gp.g / 8)
  })

  it('big hardware buys fit and concurrency, never per-user speed: replicas add streams, TP is efficiency-capped', () => {
    const s = fp8State(32)
    // a 9B model on one H200 vs a DGX H200: the DGX runs eight copies — the same per-user speed
    // under the same load, eight times the concurrent streams
    const one = loadout(s, 'hw_frontier', 'g_qwen3_5_9b_2')
    const dgx = loadout(s, 'hw_pod', 'g_qwen3_5_9b_2')
    expect(rackPlan(s, dgx).replicas).toBe(8)
    expect(serverPerUserDecodeTokS(s, dgx, serverTargets(s, dgx))).toBeCloseTo(
      serverPerUserDecodeTokS(s, one, serverTargets(s, one)),
      6,
    )
    expect(serverTargets(s, dgx)).toBe(serverTargets(s, one) * 8)
    expect(serverAggDecodeTokS(s, dgx, serverTargets(s, dgx))).toBeCloseTo(
      serverAggDecodeTokS(s, one, serverTargets(s, one)) * 8,
      3,
    )
    // a tensor-parallel group is faster per stream than one GPU, but far from the GPU count:
    // efficiency < 1 and an all-reduce floor per layer
    const big = MODEL_DEFS[MLA]
    const sp = loadout(s, 'hw_superpod', MLA) // a TP4 group of B200s
    const plan = rackPlan(s, sp)
    expect(plan.tpDeg).toBeGreaterThan(1)
    const perGpuStep = (big.paramsActiveB * 1e9 * 1) / (8e12 * MBU_DECODE)
    expect(decodeTokSb1(s, sp)).toBeLessThan(plan.tpDeg / perGpuStep)
    // a giant model at a production batch lands in the real tens of tok/s per user
    const user = serverPerUserDecodeTokS(s, sp, serverTargets(s, sp))
    expect(user).toBeGreaterThan(10)
    expect(user).toBeLessThan(120)
  })

  it('an MoE reads the experts its batch touches: weights read per step climb from active toward total', () => {
    const s = fp8State(33)
    const lo = loadout(s, 'hw_perf', AGENT_SHORT) // 117B total / 5.1B active MoE on one H100
    const m = MODEL_DEFS[AGENT_SHORT]
    const p = rackPlan(s, lo)
    const step = (streams: number) =>
      effectsModule.laneStep(s, lo, p, { streams, kvGb: 0, bgPrefillSec: 0, overlapPrefill: false }).stepSec
    // a lone token reads only its active experts; 28 tokens touch most of them
    expect(step(28) / step(1)).toBeGreaterThan(5)
    // a dense model of the same active size barely notices the batch (memory-bound)
    const dense = loadout(s, 'hw_perf', 'g_qwen3_5_4b_2')
    const dp = rackPlan(s, dense)
    const dstep = (streams: number) =>
      effectsModule.laneStep(s, dense, dp, { streams, kvGb: 0, bgPrefillSec: 0, overlapPrefill: false }).stepSec
    expect(dstep(28) / dstep(1)).toBeLessThan(1.5)
    expect(m.paramsTotalB / m.paramsActiveB).toBeGreaterThan(10)
  })

  it('every stream re-reads its KV each step: long contexts slow per-user decode (the KV-read term)', () => {
    const s = fp8State(34)
    const lo = loadout(s, 'hw_perf', 'k2h_7b') // plain GQA: 144 KB of KV per token
    const short = serverPerUserDecodeTokS(s, lo, 1, 2000)
    const long = serverPerUserDecodeTokS(s, lo, 1, 30000)
    expect(long).toBeLessThan(short * 0.8)
  })

  it('FP8 quantization is effectively lossless: memory halves, decode speeds up, quality intact', () => {
    const base = createState(22) // BF16
    const fp8 = createState(22)
    infraOn(fp8, 'inf_wq_fp8')
    const lo = loadout(base, 'hw_perf', GENERAL) // 27B: BF16 fits an H100, FP8 halves it
    const model = MODEL_DEFS[GENERAL]
    expect(serverModelMemory(base, lo)).toBeCloseTo(model.paramsTotalB * 2, 6)
    expect(serverModelMemory(fp8, lo)).toBeCloseTo(model.paramsTotalB * 1, 6)
    expect(effectsModule.servingFormat(fp8, lo)).toBe('fp8') // auto picks it: it costs no quality
    // §6.5 real kW: H100 TDP (700 W) × 0.8 util × 0.85 FP8 reduction.
    expect(serverPower(fp8, lo)).toBeCloseTo((700 / 1000) * RACK_UTILIZATION * 0.85, 6)
    expect(serverQuality(fp8, lo)).toBe(serverQuality(base, lo)) // ACL'25: lossless
    expect(decodeTokSb1(fp8, lo)).toBeGreaterThan(decodeTokSb1(base, lo)) // fewer bytes per token
    expect(computeRoofTokS(fp8, lo)).toBeGreaterThan(computeRoofTokS(base, lo)) // W8A8 on FP8 cores
    expect(prefillTokS(fp8, lo, 2000)).toBeGreaterThan(prefillTokS(base, lo, 2000))
  })

  it('INT4 (W4A16) is a per-rack choice: smaller and faster to decode, but BF16-rate compute and a quality tax', () => {
    const fp8 = createState(27)
    infraOn(fp8, 'inf_wq_fp8')
    const int4 = createState(27)
    infraOn(int4, 'inf_wq_fp8', 'inf_wq_int4')
    const auto = loadout(int4, 'hw_frontier', BIG)
    // auto never picks a lossy format: researching INT4 changes nothing until a rack opts in
    expect(effectsModule.servingFormat(int4, auto)).toBe('fp8')
    expect(serverQuality(int4, auto)).toBe(serverQuality(fp8, auto))
    const lo = loadout(int4, 'hw_frontier', BIG, 'int4')
    const model = MODEL_DEFS[BIG]
    expect(serverModelMemory(int4, lo)).toBeCloseTo(model.paramsTotalB * 0.53, 6) // 4 bits + group scales
    expect(decodeTokSb1(int4, lo)).toBeGreaterThan(decodeTokSb1(fp8, auto)) // half the bytes per token
    // W4A16 dequantizes to BF16 for its GEMMs: prefill and the compute roof run at the BF16 rate
    expect(prefillTokS(int4, lo, 4000)).toBeLessThan(prefillTokS(fp8, auto, 4000))
    expect(computeRoofTokS(int4, lo)).toBeLessThan(computeRoofTokS(fp8, auto))
    expect(serverQuality(int4, lo)).toBe(serverQuality(fp8, auto) - 2) // flat tax
    // the steep long-context penalty (>8K real tokens) — 4-bit PTQ's real-world weak spot
    const extra = (ctx: number) => longContextPenalty(int4, lo, ctx) - longContextPenalty(fp8, auto, ctx)
    expect(extra(16000)).toBeCloseTo(6, 6)
    expect(extra(4000)).toBeCloseTo(0, 6)
  })

  it('NVFP4 runs only on Blackwell FP4 Tensor Cores: W4A4 speed and a smaller tax than INT4', () => {
    const s = createState(35)
    infraOn(s, 'inf_wq_fp8', 'inf_wq_int4', 'inf_wq_nvfp4', 'inf_par_tp')
    // an H200 has no FP4 hardware: the format is not available there
    expect(effectsModule.availableFormats(s, HARDWARE_DEFS.hw_frontier, MODEL_DEFS[BIG])).not.toContain('nvfp4')
    const sp = loadout(s, 'hw_superpod', BIG, 'nvfp4')
    const int4 = loadout(s, 'hw_superpod', BIG, 'int4')
    expect(effectsModule.availableFormats(s, HARDWARE_DEFS.hw_superpod, MODEL_DEFS[BIG])).toContain('nvfp4')
    expect(computeRoofTokS(s, sp)).toBeGreaterThan(computeRoofTokS(s, int4)) // FP4 rate vs BF16
    expect(serverQuality(s, sp)).toBeGreaterThan(serverQuality(s, int4))
    expect(longContextPenalty(s, sp, 16000)).toBeLessThan(longContextPenalty(s, int4, 16000))
    // a natively 4-bit release pays no 4-bit tax at all (it was benchmarked that way)
    const native = loadout(s, 'hw_superpod', 'kimi_k3', 'nvfp4')
    expect(effectsModule.ptqTax(s, native)).toBe(0)
  })

  it('Quantization lets a 122B model squeeze onto a single frontier GPU', () => {
    const s = createState(26)
    const lo = loadout(s, 'hw_frontier', BIG) // 122B BF16 = 244 GB > 141
    expect(serverFitsMemory(s, lo)).toBe(false)
    infraOn(s, 'inf_wq_fp8') // FP8 = 122 GB → fits 141 GB H200
    expect(serverFitsMemory(s, lo)).toBe(true)
  })

  it('FlashAttention is exact attention: faster long prefill, quicker KV reads, activation memory — no quality, window or KV-size bonus', () => {
    const base = fp8State(23)
    const flash = fp8State(23)
    infraOn(flash, 'inf_flash')
    const lo = loadout(base, 'hw_standard', GENERAL)
    const m = MODEL_DEFS[GENERAL]
    expect(serverQuality(flash, lo)).toBe(serverQuality(base, lo))
    expect(serverCtxWindowTokens(flash, lo)).toBe(serverCtxWindowTokens(base, lo))
    expect(kvPerReqGb(flash, m, 32000)).toBe(kvPerReqGb(base, m, 32000))
    expect(longContextPenalty(flash, lo, 100000)).toBe(longContextPenalty(base, lo, 100000))
    // the O(n²) prefill term grows slower: a long prompt ingests faster, a short one barely changes
    expect(prefillTokS(flash, lo, 64000) / prefillTokS(base, lo, 64000)).toBeGreaterThan(1.3)
    expect(prefillTokS(flash, lo, 256) / prefillTokS(base, lo, 256)).toBeLessThan(1.01)
    // Flash-Decoding reads KV faster: long-context per-user decode improves
    expect(serverPerUserDecodeTokS(flash, lo, 1, 60000)).toBeGreaterThan(serverPerUserDecodeTokS(base, lo, 1, 60000))
    // the score matrix it never materializes is activation memory handed back to KV
    expect(kvFreeGb(flash, lo)).toBeGreaterThan(kvFreeGb(base, lo))
    // and it does not move the compute roof
    expect(serverComputeCeiling(flash, lo)).toBeCloseTo(serverComputeCeiling(base, lo), 6)
  })

  it('long-context skill is a model property: a long-window model that reads long documents well loses less quality', () => {
    const s = createState(36)
    // the penalty is the window FILL (contextLen / window), softened by the model's longCtx skill
    const strong = MODEL_DEFS['minimax_m3'] // 1M window, strong long-context reasoning
    const weak = MODEL_DEFS[SMALL_WINDOW] // a 32K window that cannot even take the 100K benchmark
    expect(strong.longCtx).toBeGreaterThan(weak.longCtx)
    const pen = (m: (typeof MODEL_DEFS)[string], ctx: number) => effectsModule.longContextPenaltyFor(s, m, 'bf16', ctx)
    expect(pen(strong, 4000)).toBe(0) // well under a quarter of the window: no loss
    expect(pen(weak, 24000)).toBeGreaterThan(5) // three-quarters full: a steep loss
    expect(pen(strong, 100000)).toBeLessThan(pen(MODEL_DEFS[BIG], 100000)) // 1M vs 262K window at 100K
  })
  it('a wrong answer is refunded: it earns nothing and costs Trust', () => {
    const s = createState(24)
    richBuild(s)
    // the 0.8B instruct model cannot code: its Code Completion answer is wrong
    for (const col of [2, 4, 6, 8, 10, 12]) {
      tryBuild(s, 'srv_edge', col, 2)
      deployModel(s, lastTower(s).id, NEVER)
    }
    const earned0 = s.stats.cashEarned
    const trust0 = s.meters.trust
    liveWave(s)
    spawnRequest(s, 'comp')
    runFor(s, 30)
    expect(s.stats.bad).toBeGreaterThanOrEqual(1)
    expect(s.stats.cashEarned).toBe(earned0) // the wrong answer is refunded (§2.5)
    expect(s.meters.trust).toBeLessThan(trust0)
  })
})

describe('prefill vs decode (two-phase serving, real tokens)', () => {
  it('a request carries its real ISL as prefill and OSL as decode tokens', () => {
    const s = createState(80)
    liveWave(s)
    const r = spawnRequest(s, 'summ') // ISL 12000, OSL 400
    expect(r.prefill).toBe(12000)
    expect(r.work).toBe(400)
    expect(r.tokensIn).toBe(12000)
    expect(r.tokensOut).toBe(400)
    expect(r.contextLen).toBe(12000) // KV seqlen starts at the prompt length
    const c = spawnRequest(s, 'chat') // ISL 512, OSL 256
    expect(c.prefill).toBe(512)
    expect(c.work).toBe(256)
    // embed is pure prefill: ISL only, no decode tokens at all (§1.4 EMBED)
    const e = spawnRequest(s, 'embed') // ISL 2000, OSL 0
    expect(e.prefill).toBe(2000)
    expect(e.work).toBe(0)
    expect(e.maxWork).toBe(0)
  })

  it('prefill must finish before decode starts, and records TTFT', () => {
    const s = createState(81)
    richBuild(s)
    buildServerAs(s, 'frontier', 3, 2)
    deployModel(s, lastTower(s).id, CODER) // 31B dense (high active) — a slow-enough prefill to observe
    liveWave(s)
    s.spawns = [{ typeId: 'summ', count: 1, interval: 1, delay: 0, spawned: 0, timer: 0, started: false }]
    runFor(s, 0.05) // a few board-steps: summ's 12000-token prompt is still ingesting
    const r = s.requests[0]
    expect(r.prefill).toBeGreaterThan(0) // still ingesting the prompt
    expect(r.work).toBe(400) // decode untouched until prefill completes
    runFor(s, 1)
    expect(r.prefill).toBe(0)
    expect(r.prefillDoneAt).toBeGreaterThan(0) // TTFT moment recorded
    expect(r.ttftReal).toBeGreaterThan(0) // real-seconds TTFT latched
    // the thinking model reasons before it answers: its hidden tokens join the decode
    const hidden = effectsModule.hiddenTokensFor(MODEL_DEFS[CODER], REQUEST_TYPES.summ)
    expect(hidden).toBeGreaterThan(0)
    expect(r.hiddenTokens).toBe(hidden)
    expect(r.maxWork).toBe(400 + hidden)
    expect(r.work).toBeLessThan(r.maxWork) // decode underway, KV grows
    expect(r.contextLen).toBeGreaterThan(12000)
  })

  it('a prefill stalls every decode on the rack (generation stall) until Chunked Prefill — and the stall counts toward latency', () => {
    const run = (withChunked: boolean) => {
      const s = createState(82)
      richBuild(s)
      if (withChunked) s.infra.scheduling.chunked = true
      buildServerAs(s, 'frontier', 3, 2)
      deployModel(s, lastTower(s).id, CODER) // 31B dense (high active); KV budget fits rag + summ together
      liveWave(s)
      // a RAG request gets fully prefilled and starts decoding
      const rag = spawnRequest(s, 'rag')
      for (let i = 0; i < 600 && rag.prefill > 0; i++) step(s)
      expect(rag.prefill).toBe(0)
      // a heavy 12000-token summarization prompt arrives and the rack starts ingesting it
      const summ = spawnRequest(s, 'summ')
      const p0 = summ.prefill
      for (let i = 0; i < 600 && summ.prefill >= p0 - 0.001; i++) step(s)
      expect(summ.prefill).toBeGreaterThan(4000) // still deep in ingestion: more than a whole tick of prefill left
      const ragWork = rag.work
      const ragE2el = rag.e2elReal
      expect(ragWork).toBeGreaterThan(5) // mid-decode
      step(s) // one tick while summ is still prefilling
      return { tokens: ragWork - rag.work, latency: rag.e2elReal - ragE2el }
    }
    const realDt = SIM_DT * SIM_TIME_SCALE
    // without chunked prefill: a true generation stall — zero decode progress, yet the
    // stalled decode's wall clock still runs (it waits out the prefill: +1 tick of E2EL)
    const plain = run(false)
    expect(plain.tokens).toBeCloseTo(0, 6)
    expect(plain.latency).toBeCloseTo(realDt, 6)
    // with chunked prefill: tokens keep flowing beside the ingestion
    expect(run(true).tokens).toBeGreaterThan(0.1)
  })

  it('chunked prefill is a token-budget scheduler: a prompt within the budget prefills in one engine step, a long one is split', () => {
    const s = createState(83)
    richBuild(s)
    infraOn(s, 'inf_chunked')
    const lo = loadout(s, 'hw_perf', 'g_qwen3_5_9b_2')
    const p = effectsModule.rackPlan(s, lo)
    // the deployment's budget, profiled from the TBT target (Sarathi-Serve), inside vLLM's clamps
    const budget = effectsModule.chunkBudgetTokens(s, lo, p)
    expect(budget).toBeGreaterThanOrEqual(CHUNK_MIN_TOKENS)
    expect(budget).toBeLessThanOrEqual(CHUNK_MAX_TOKENS)
    expect(budget).toBeGreaterThan(512)
    // a faster deployment (a small model on the same H100) affords a bigger budget than a 27B dense one
    expect(effectsModule.chunkBudgetTokens(s, loadout(s, 'hw_perf', STARTER))).toBeGreaterThan(
      effectsModule.chunkBudgetTokens(s, loadout(s, 'hw_perf', 'g_qwen3_5_27b_2')),
    )
    // a busy lane: two request cohorts decoding
    const load = effectsModule.rackLoadEstimate(s, lo, 2, 1628, { inputTokens: 1500, outputTokens: 256 }).load!
    const decodeStep = effectsModule.laneStep(s, lo, p, load).stepSec
    // a short prompt rides ONE step beside the decodes — not a fixed slice of the lane stretched over many
    const rate = effectsModule.prefillRateOn(s, lo, p, 512)
    const short = effectsModule.promptOccupancy(s, lo, p, 512, rate, load, budget)
    expect(short.steps).toBeLessThan(1)
    expect(short.wallSec).toBeCloseTo(effectsModule.laneStep(s, lo, p, { ...load, chunkSec: 512 / rate }).stepSec, 9)
    expect(short.wallSec).toBeLessThan(512 / rate / 0.35) // the old 35% time-slice
    // its step stays inside the TBT target the budget was profiled for
    const fullStep = effectsModule.laneStep(s, lo, p, { ...load, chunkSec: budget / effectsModule.prefillRateOn(s, lo, p, 0) }).stepSec
    expect(fullStep).toBeLessThanOrEqual(Math.max(CHUNK_STEP_TARGET_MS / 1000, decodeStep * (1 + CHUNK_MIN_STRETCH)) * 1.01)
    // a long prompt is split into ⌈tokens / budget⌉ chunk-carrying steps
    const longTok = 8 * budget
    const longRate = effectsModule.prefillRateOn(s, lo, p, longTok)
    const long = effectsModule.promptOccupancy(s, lo, p, longTok, longRate, load, budget)
    expect(long.steps).toBeCloseTo(8, 9)
    expect(long.wallSec).toBeCloseTo(8 * long.stepSec, 9)
    // the decodes pay the interference (a chunk-carrying step is longer than a decode step) but never
    // stall for the whole prompt the way an exclusive prefill makes them
    expect(long.stepSec).toBeGreaterThan(decodeStep)
    expect(long.stepSec).toBeLessThan(longTok / longRate)
    // and chunking costs a little prefill throughput: alone on its lane, a long prompt takes longer
    // than one monolithic prefill — but not much longer
    const idle = { streams: 1, kvGb: 0, bgPrefillSec: 0, overlapPrefill: true }
    const alone = effectsModule.promptOccupancy(s, lo, p, longTok, longRate, idle, budget)
    expect(alone.wallSec).toBeGreaterThan(longTok / longRate)
    expect(alone.wallSec).toBeLessThan((longTok / longRate) * 1.3)
    // without chunked prefill the prompt runs exclusively at the full rate
    const plain = createState(83)
    richBuild(plain)
    expect(effectsModule.promptOccupancy(plain, lo, p, longTok, longRate, load, budget).wallSec).toBeCloseTo(longTok / longRate, 9)
  })

  it('in combat a short prompt reaches its first token in about one engine step under chunked prefill', () => {
    const run = (chunked: boolean): number => {
      const s = createState(84)
      richBuild(s)
      if (chunked) infraOn(s, 'inf_chunked')
      expect(tryBuild(s, 'srv_edge', 3, 2)).toBe(true)
      const t = lastTower(s)
      upgradeHardware(s, t.id)
      upgradeHardware(s, t.id) // → H100
      deployModel(s, t.id, 'g_qwen3_5_9b_2')
      liveWave(s)
      // a few answers decoding on the rack, then a short chat prompt arrives beside them
      for (let i = 0; i < 3; i++) spawnRequest(s, 'chat')
      for (let i = 0; i < 200 && s.requests.some((r) => r.prefillDoneAt === undefined); i++) step(s)
      const r = spawnRequest(s, 'chat')
      for (let i = 0; i < 600 && r.prefillDoneAt === undefined; i++) step(s)
      expect(r.prefillDoneAt).toBeDefined()
      return r.ttftReal - r.queueSec // the prompt's own wall time on the rack (+ admission)
    }
    const lo = loadout(createState(84), 'hw_perf', 'g_qwen3_5_9b_2')
    const s0 = createState(84)
    richBuild(s0)
    const rate = effectsModule.prefillRateOn(s0, lo, effectsModule.rackPlan(s0, lo), 512)
    const chunked = run(true)
    // one fused step: its chunk at CHUNKED_PREFILL_EFF beside the decodes — far below the old 35% slice
    expect(chunked).toBeGreaterThan(512 / rate)
    expect(chunked).toBeLessThan(512 / rate / 0.35)
    expect(run(false)).toBeCloseTo(512 / rate, 3) // exclusive: the bare prefill (its decodes stall meanwhile)
  })

  it('thermal throttling bites decode meaningfully, keeping only a slight edge over prefill', () => {
    // decodeThrottle(t) = 1 − (1−t)×0.85: decode keeps a SLIGHT memory-bound edge over
    // prefill (which takes the full hit), but a thermal cap now REALLY costs throughput —
    // the old ×0.25 left decode at ~84% even at the floor, so overheating was nearly free.
    void effectsModule
    // a 50% cap now costs decode ~42.5% (was only 12.5% under the old ×0.25).
    expect(decodeThrottle(0.5)).toBeCloseTo(0.575, 6)
    expect(decodeThrottle(1)).toBe(1)
    // at the throttle floor (0.2) decode collapses to ~32% — under-cooling a hot fleet hurts.
    expect(decodeThrottle(THROTTLE_FLOOR)).toBeCloseTo(1 - (1 - THROTTLE_FLOOR) * 0.85, 6)
    // decode still keeps an edge over prefill, which runs at the bare throttle fraction.
    expect(decodeThrottle(0.5)).toBeGreaterThan(0.5)
  })
})

describe('benchmark calibration (capability is a per-axis vector)', () => {
  const q = (id: string, axis: 'chat' | 'coding' | 'reasoning' | 'general') =>
    MODEL_DEFS[id].qualityBy[axis]

  it('a coder checkpoint leans into code harder than a generalist does', () => {
    // the coder clears the coding line above the generalist…
    expect(q(CODER, 'coding')).toBeGreaterThan(q('g_qwen3_5_9b_2', 'coding'))
    // …and is more code-leaning: its coding-minus-chat margin beats the generalist's.
    // (On real benchmarks the two sit near the same MMLU-Pro chat level, so capability
    // is a per-axis VECTOR — the specialism shows as a relative lean, not a higher chat.)
    const lean = (id: string) => q(id, 'coding') - q(id, 'chat')
    expect(lean(CODER)).toBeGreaterThan(lean('g_qwen3_5_9b_2'))
  })

  it('a small model fails the coding line; a coder clears it', () => {
    expect(q(NEVER, 'coding')).toBeLessThan(56) // the 0.8B instruct model ships bad code
    expect(q(CODER, 'coding')).toBeGreaterThanOrEqual(56)
  })

  it('only reasoning models clear the hardest reasoning lane (82)', () => {
    // small non-reasoning checkpoints fall short on reason=82 (post-compression, only
    // the small end sits below the line — every kept mid/large model is a strong reasoner)
    expect(q(WEAK, 'reasoning')).toBeLessThan(82)
    expect(q(NEVER, 'reasoning')).toBeLessThan(82)
    // thinking models clear it
    expect(q(GENERAL, 'reasoning')).toBeGreaterThanOrEqual(82)
    expect(q(FRONTIER, 'reasoning')).toBeGreaterThanOrEqual(82)
  })

  it('chat is trivial for every real instruct model', () => {
    for (const id of Object.keys(MODEL_DEFS)) {
      expect(MODEL_DEFS[id].qualityBy.chat).toBeGreaterThanOrEqual(18)
    }
  })

  it('combat judges against the request axis, not the model spec', () => {
    const s = createState(96)
    richBuild(s)
    buildServerAs(s, 'frontier', 3, 2)
    const t = lastTower(s)
    t.modelId = CODER // coder rack vs chat traffic
    liveWave(s)
    // a handful of benign chats: a few may be over-refused (CODER over-refusal 0.1),
    // but the served ones score on the CHAT axis. Track the best margin seen.
    const reqs = []
    for (let i = 0; i < 8; i++) {
      const r = spawnRequest(s, 'chat')
      r.prefill = 0
      reqs.push(r)
    }
    runFor(s, 6)
    const bestMargin = Math.max(...reqs.filter((r) => !r.overRefused).map((r) => r.bestQuality))
    // chat(18) is within a coder's chat aptitude — served well
    expect(bestMargin).toBeGreaterThan(0)
    // the request is judged on the CHAT axis — a distinct number from the coder's coding
    // aptitude (capability is a per-axis vector), and that chat aptitude clears the line.
    expect(MODEL_DEFS[CODER].qualityBy.chat).not.toBe(MODEL_DEFS[CODER].qualityBy.coding)
    expect(MODEL_DEFS[CODER].qualityBy.chat).toBeGreaterThanOrEqual(18)
  })
})

describe('P/D disaggregation (rack roles)', () => {
  it('role cycling needs the research and a drained rack (build phase only)', () => {
    const s = createState(95)
    richBuild(s)
    buildServerAs(s, 'frontier', 3, 2)
    const t = lastTower(s)
    const { cycleRackRole } = actionsModule
    expect(cycleRackRole(s, t.id)).toBe(false) // not researched
    s.infra.disagg = true
    expect(cycleRackRole(s, t.id)).toBe(true)
    expect(t.role).toBe('prefill')
    liveWave(s)
    // mid-wave re-pinning is rejected — it would orphan half-ingested requests
    expect(cycleRackRole(s, t.id)).toBe(false)
    expect(t.role).toBe('prefill')
    // a fully-prefilled request whose KV this rack's model produced: a PREFILL-pool rack must not decode it
    const r = spawnRequest(s, 'summ')
    r.prefill = 0
    r.prefillDoneAt = s.time
    r.kvModelId = t.modelId
    const w0 = r.work
    runFor(s, 1)
    expect(r.work).toBeCloseTo(w0, 3)
    // re-pinned between waves (sim-level), the decode pool serves it
    t.role = 'decode'
    runFor(s, 0.5)
    expect(r.work).toBeLessThan(w0)
    // a decode pool only takes KV its own model produced (another model would have to re-prefill)
    const other = spawnRequest(s, 'summ')
    other.prefill = 0
    other.prefillDoneAt = s.time
    other.kvModelId = STARTER
    const o0 = other.work
    runFor(s, 0.5)
    expect(other.work).toBeCloseTo(o0, 6)
  })

  it('a prefill pool hands its KV over the network and keeps ingesting the cohort’s prompts for the decode pool', () => {
    const s = createState(97)
    richBuild(s)
    s.infra.disagg = true
    // a prefill pool and a decode pool side by side at the lane ingress, the same model on both
    for (const col of [1, 2]) {
      tryBuild(s, 'srv_edge', col, 2)
      const t = lastTower(s)
      upgradeHardware(s, t.id)
      upgradeHardware(s, t.id) // → H100
      deployModel(s, t.id, INSTRUCT)
    }
    const [pre, dec] = s.towers.filter((t) => t.def.kind === 'server')
    pre.role = 'prefill'
    dec.role = 'decode'
    liveWave(s)
    const r = spawnRequest(s, 'rag')
    r.speed = 0 // parked at the ingress, in range of both pools
    for (let i = 0; i < 600 && r.prefill > 0; i++) step(s)
    expect(r.prefill).toBe(0)
    expect(r.kvTowerId).toBe(pre.id)
    // the KV must cross the network before the decode pool's first step
    expect(r.kvTransferSec).toBeCloseTo(kvPerReqGb(s, MODEL_DEFS[INSTRUCT], r.contextLen) / KV_TRANSFER_GBPS, 9)
    const e0 = r.e2elReal
    step(s)
    expect(r.kvTransferSec).toBe(0) // paid
    expect(r.e2elReal - e0).toBeGreaterThan(0)
    // while the decode pool streams the cohort, its other streams' prompts are owed to the prefill pool
    let owed = 0
    for (let i = 0; i < 5; i++) {
      step(s)
      owed = Math.max(owed, pre.prefillDebtSec)
    }
    expect(owed).toBeGreaterThan(0)
    expect(dec.prefillDebtSec).toBe(0)
  })
})

describe('the serving-systems era ladder (Orca → vLLM, s.infra-driven)', () => {
  it('before Continuous Batching, a rack runs one static batch at a time; after, the engine batches cohorts until KV runs out', () => {
    const s = createState(90)
    s.meters.cash = 99999
    s.phase = 'build'
    tryBuild(s, 'srv_edge', 3, 2) // NO research granted: pre-Orca world
    const lo = loadout(s, 'hw_edge', STARTER)
    expect(serverTargets(s, lo)).toBe(1)
    infraOn(s, 'inf_batching') // iteration-level scheduling: the engine's batch cap in cohorts
    expect(serverTargets(s, lo)).toBe(Math.floor(ENGINE_MAX_STREAMS / COHORT_STREAMS))
    // multi-step scheduling adds no slots: it amortizes the per-step CPU overhead (throughput)
    // and makes new requests wait for the next scheduler call (TTFT)
    const p = effectsModule.rackPlan(s, lo)
    const step = (g: GameState) =>
      effectsModule.laneStep(g, lo, p, { streams: 28, kvGb: 0, bgPrefillSec: 0, overlapPrefill: false }).stepSec
    const before = step(s)
    expect(effectsModule.admissionDelaySec(s, lo, before)).toBe(0)
    infraOn(s, 'inf_multistep')
    expect(serverTargets(s, lo)).toBe(Math.floor(ENGINE_MAX_STREAMS / COHORT_STREAMS))
    expect(step(s)).toBeLessThan(before)
    expect(effectsModule.admissionDelaySec(s, lo, step(s))).toBeGreaterThan(0)
  })
  it('PagedAttention recovers wasted KV memory (55% → 96% utilization)', () => {
    const s = createState(91)
    infraOn(s, 'inf_wq_fp8') // FP8 so GENERAL (32.8B) fits the 48 GB standard rack
    const lo = loadout(s, 'hw_standard', GENERAL)
    // free KV = (HBM − weights − framework) × utilization
    const headroom = HARDWARE_DEFS.hw_standard.hbmGb - serverModelMemory(s, lo) - 1.5
    expect(kvFreeGb(s, lo)).toBeCloseTo(headroom * 0.55, 6) // fragmented allocator
    infraOn(s, 'inf_paged') // s.infra.kv.utilization 0.55 → 0.96
    expect(kvFreeGb(s, lo)).toBeCloseTo(headroom * 0.96, 6)
  })

  it('per-request KV = per-token KV over the KV-bearing layers × context + the constant state', () => {
    const s = createState(92)
    const model = MODEL_DEFS[GENERAL] // Qwen3.6-27B: 16 full-attention + 48 Gated DeltaNet layers
    // only the 16 full-attention layers keep a growing cache: 2 (K,V) × 4 kvHeads × 256 headDim × 2 B
    expect(model.attn).toBe('hybrid-linear')
    expect(model.kvLayers).toBe(16)
    expect(model.kvBytesPerToken).toBe(16 * 2 * 4 * 256 * 2)
    // the DeltaNet layers hold a constant recurrent state per request instead
    expect(model.kvStateMbPerReq).toBeGreaterThan(100)
    const expected = (model.kvBytesPerToken * 8192) / 1e9 + model.kvStateMbPerReq / 1000
    expect(kvPerReqGb(s, model, 8192)).toBeCloseTo(expected, 6)
    // only the per-token part grows with sequence length (decode inflates it)
    const grow = kvPerReqGb(s, model, 16384) - kvPerReqGb(s, model, 8192)
    expect(grow).toBeCloseTo((model.kvBytesPerToken * 8192) / 1e9, 6)
    // FP8 KV-cache quant (s.infra.kv.quantBytes 2 → 1) halves the GROWING part
    infraOn(s, 'inf_paged', 'inf_kvquant_fp8')
    expect(kvPerReqGb(s, model, 8192)).toBeCloseTo((model.kvBytesPerToken * 8192 * 0.5) / 1e9 + model.kvStateMbPerReq / 1000, 6)
  })

  it('the GQA ×0.4 tech-node global is GONE (grouped attention is a model attribute)', () => {
    // P3c removal: there is no more r_tech_gqa / tech_gqa global ×0.4 on KV nor the
    // −1 quality tax. GQA models simply carry a low kvHeads in their ModelDef.
    expect(RESEARCH_DEFS['r_tech_gqa']).toBeUndefined()
    const s = createState(94)
    s.upgrades['tech_gqa'] = 1 // a stale flag must have NO effect now
    const model = MODEL_DEFS[BIG]
    const clean = createState(94)
    expect(kvPerReqGb(s, model, 8192)).toBeCloseTo(kvPerReqGb(clean, model, 8192), 6)
    const lo = loadout(clean, 'hw_pod', BIG)
    expect(serverQuality(s, lo)).toBe(serverQuality(clean, lo))
  })
})

describe('speculative decoding (EAGLE, §4.4)', () => {
  it('pays at low batch, fades as the batch turns compute-bound, depends on the traffic, and never raises the compute roof', () => {
    const base = createState(96)
    infraOn(base, 'inf_batching', 'inf_paged', 'inf_wq_fp8')
    const spec = createState(96)
    infraOn(spec, 'inf_batching', 'inf_paged', 'inf_wq_fp8', 'inf_spec')
    const lo = loadout(base, 'hw_perf', 'g_qwen3_5_9b_2')
    const p = effectsModule.rackPlan(spec, lo)
    const perUser = (g: GameState, streams: number, axis: CapabilityAxis) => {
      const pl = effectsModule.rackPlan(g, lo)
      const tokens = effectsModule.specTokensFor(g, axis)
      const st = effectsModule.laneStep(g, lo, pl, {
        streams,
        kvGb: 0,
        bgPrefillSec: 0,
        overlapPrefill: false,
        specTokens: tokens,
      })
      return { tokS: (st.specOn ? tokens : 1) / st.stepSec, on: st.specOn }
    }
    // one stream: the draft head's accepted tokens nearly double per-user speed
    const lone = perUser(spec, 1, 'chat')
    expect(lone.on).toBe(true)
    expect(lone.tokS / perUser(base, 1, 'chat').tokS).toBeGreaterThan(1.6)
    // code accepts more drafts than open-ended reasoning
    expect(perUser(spec, 1, 'coding').tokS).toBeGreaterThan(perUser(spec, 1, 'reasoning').tokS)
    // a huge batch is compute-bound: verifying drafts costs more than it saves, so the engine turns it off
    const huge = perUser(spec, 2000, 'chat')
    expect(huge.on).toBe(false)
    expect(huge.tokS).toBeCloseTo(perUser(base, 2000, 'chat').tokS, 6)
    // verification spends compute, it never adds any
    expect(computeRoofTokS(spec, lo)).toBeCloseTo(computeRoofTokS(base, lo), 6)
    expect(p.draftGb).toBeGreaterThan(0)
  })

  it('the draft head takes VRAM and burns power on EVERY tier', () => {
    const base = createState(70)
    const spec = createState(70)
    infraOn(spec, 'inf_spec')
    for (const [hw, id] of [
      ['hw_edge', STARTER],
      ['hw_frontier', 'g_qwen3_5_9b_2'],
    ] as const) {
      const lo = loadout(base, hw, id)
      expect(serverPower(spec, lo)).toBeCloseTo(serverPower(base, lo) * 1.08, 6)
      expect(kvFreeGb(spec, lo)).toBeLessThan(kvFreeGb(base, lo))
    }
  })
})

describe('directional fidelity — every technique keeps its real cost', () => {
  it('engines are alternatives: TensorRT-LLM runs closer to the roof, SGLang reuses more prefixes, and one locks the other', () => {
    const vllm = createState(73)
    infraOn(vllm, 'inf_wq_fp8')
    const sglang = createState(73)
    infraOn(sglang, 'inf_wq_fp8', 'inf_engine_sglang')
    const trt = createState(73)
    infraOn(trt, 'inf_wq_fp8', 'inf_engine_trtllm')
    const lo = loadout(vllm, 'hw_standard', GENERAL)
    // TensorRT-LLM's compiled kernels: faster decode and prefill, still under the physical roof
    expect(decodeTokSb1(trt, lo)).toBeGreaterThan(decodeTokSb1(vllm, lo))
    expect(prefillTokS(trt, lo, 2000)).toBeGreaterThan(prefillTokS(vllm, lo, 2000))
    expect(decodeTokSb1(sglang, lo)).toBeCloseTo(decodeTokSb1(vllm, lo), 6) // no free speed
    // SGLang's RadixAttention: a higher prefix-cache hit rate behind the same cache
    expect(effectsModule.prefixHitChance(sglang, 0.5, false)).toBeGreaterThan(effectsModule.prefixHitChance(vllm, 0.5, false))
    expect(effectsModule.prefixHitChance(trt, 0.5, false)).toBeCloseTo(effectsModule.prefixHitChance(vllm, 0.5, false), 6)
    // one engine per fleet: researching SGLang locks TensorRT-LLM (and the reverse)
    expect(researchUnlocked(sglang, RESEARCH_DEFS['inf_engine_trtllm'])).toBe(false)
    expect(researchUnlocked(trt, RESEARCH_DEFS['inf_engine_sglang'])).toBe(false)
  })

  it('Data Parallelism load-balances a multi-copy rack: one cohort spreads over every copy', () => {
    const s = createState(74)
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8', 'inf_par_tp')
    const lo = loadout(s, 'hw_pod', 'g_qwen3_5_9b_2') // eight single-GPU copies
    const noDp = serverPerUserDecodeTokS(s, lo, 1)
    infraOn(s, 'inf_par_dp')
    // without DP the cohort's 28 streams batch on the copy it landed on; with DP they spread
    expect(serverPerUserDecodeTokS(s, lo, 1)).toBeGreaterThan(noDp)
    // at a full rack every copy is busy either way: no extra aggregate from DP
    const full = serverTargets(s, lo)
    const dpAgg = serverAggDecodeTokS(s, lo, full)
    s.infra.par.dp = false
    expect(serverAggDecodeTokS(s, lo, full)).toBeCloseTo(dpAgg, 3)
  })

  it('Expert Parallelism shards an MoE across a rack’s copies: fewer weight bytes per step at batch, plus an all-to-all', () => {
    const s = createState(75)
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8', 'inf_par_tp')
    const lo = loadout(s, 'hw_pod', AGENT_SHORT) // gpt-oss-120b: one H100-sized copy per GPU → 8 copies
    const p = effectsModule.rackPlan(s, lo)
    expect(p.replicas).toBe(8)
    const step = (g: GameState, streams: number) =>
      effectsModule.laneStep(g, lo, effectsModule.rackPlan(g, lo), {
        streams,
        rackStreams: streams * p.replicas,
        kvGb: 0,
        bgPrefillSec: 0,
        overlapPrefill: false,
      }).stepSec
    const plainBatch = step(s, 28)
    const plainLone = step(s, 1)
    infraOn(s, 'inf_par_ep')
    expect(step(s, 28)).toBeLessThan(plainBatch) // the pooled batch reads each expert shard once
    expect(step(s, 1)).toBeGreaterThan(plainLone - 1e-12) // a lone token gains nothing, pays the all-to-all
    // a single-copy rack has nothing to shard across: EP leaves it alone
    const one = loadout(s, 'hw_perf', AGENT_SHORT)
    expect(effectsModule.wideEp(s, MODEL_DEFS[AGENT_SHORT], effectsModule.rackPlan(s, one))).toBe(false)
  })

  it('Pipeline Parallelism buys memory, not speed: a pipelined copy pays a bubble on every prompt', () => {
    const s = createState(76)
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_par_tp', 'inf_par_pp')
    const giga = loadout(s, 'hw_giga', 'kimi_k3')
    const p = effectsModule.rackPlan(s, giga)
    expect(p.stages).toBeGreaterThan(1)
    expect(effectsModule.admissionDelaySec(s, giga, 0)).toBeCloseTo(((p.stages - 1) * PP_BUBBLE_MS) / 1000, 9)
  })

  it('KV offload keeps more prefixes cached, reloaded over PCIe — never extra live-decode memory', () => {
    const s = createState(77)
    infraOn(s, 'inf_paged', 'inf_prefix')
    const lo = loadout(s, 'hw_perf', GENERAL)
    const kv0 = kvFreeGb(s, lo)
    const t0 = effectsModule.prefixHitTiers(s, 0.5, false)
    infraOn(s, 'inf_offload')
    const t1 = effectsModule.prefixHitTiers(s, 0.5, false)
    expect(t1.hbm).toBeCloseTo(t0.hbm, 9)
    expect(t1.offload).toBeGreaterThan(0)
    expect(kvFreeGb(s, lo)).toBeCloseTo(kv0, 9) // the active batch's KV budget is untouched
    expect(effectsModule.offloadReloadSec(s, MODEL_DEFS[GENERAL], 4000)).toBeGreaterThan(0)
  })

  it('mutually exclusive techniques are enforced by the sim: Chunked Prefill ⟂ P/D Disaggregation', () => {
    const s = createState(78)
    s.data = 9999
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_chunked')
    expect(researchUnlocked(s, RESEARCH_DEFS['inf_disagg'])).toBe(false)
    expect(startResearch(s, 'inf_disagg')).toBe(false)
    const d = createState(78)
    d.data = 9999
    infraOn(d, 'inf_batching', 'inf_paged')
    expect(researchUnlocked(d, RESEARCH_DEFS['inf_disagg'])).toBe(true) // disagg needs only PagedAttention
  })

  it('NVFP4 research needs a Blackwell rack on the board', () => {
    const s = createState(79)
    s.meters.cash = 999999
    s.phase = 'build'
    infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8')
    const def = RESEARCH_DEFS['inf_wq_nvfp4']
    tryBuild(s, 'srv_frontier', 3, 2)
    expect(researchUnlocked(s, def)).toBe(false)
    lastTower(s).hwId = 'hw_superpod'
    expect(researchUnlocked(s, def)).toBe(true)
  })
})
/** The small-window model of the window tests: Qwen3-0.6B (32,768-token native window). */
const SMALL_WINDOW = 'g_qwen3_0_6b_instruct_reasonin'

/** Build a small-window model rack on a Standard GPU rack. */
function buildSmallWindow(s: GameState, col: number, row: number): void {
  tryBuild(s, 'srv_edge', col, row)
  const t = lastTower(s)
  upgradeHardware(s, t.id) // edge → standard (48 GB fits the 0.6B model easily)
  deployModel(s, t.id, SMALL_WINDOW)
}

describe('long context (real-token window, KV admission, prefix-cache behavior)', () => {
  it('a prompt beyond the model real context window is unservable, not just worse', () => {
    const s = createState(60)
    richBuild(s)
    // Qwen3-0.6B's real window is ~33K tokens; a 36K-token summ prompt does not fit ANY of them.
    for (const col of [2, 5, 8, 11]) buildSmallWindow(s, col, 2)
    const windowTokens = serverCtxWindowTokens(s, loadout(s, 'hw_standard', SMALL_WINDOW))
    expect(windowTokens).toBeCloseTo(MODEL_DEFS[SMALL_WINDOW].contextWindowK * 1000, 0)
    expect(windowTokens).toBeLessThan(36000) // the oversized prompt
    liveWave(s)
    spawnRequest(s, 'summ', 1, 1, 1, 1, 3) // contextMul 3 → ~36000 input tokens
    expect(s.requests[0].contextLen).toBeGreaterThan(windowTokens)
    runFor(s, 75)
    expect(s.stats.served).toBe(0)
    expect(s.stats.bad).toBe(0) // NOT a bad answer — it never got served
    // §2.5: rejected on the hard context-window gate → `unservable`, a DISTINCT
    // outcome from a plain capacity leak.
    expect(s.stats.unservable).toBe(1)
    expect(s.stats.leaked).toBe(0)
  })

  it('a Cache no longer rescues traffic beyond the model window — it only skips prefill', () => {
    const s = createState(61)
    richBuild(s)
    for (const col of [2, 5, 8]) buildSmallWindow(s, col, 2)
    tryBuild(s, 'cache', 5, 0) // aura over the small-window racks
    liveWave(s)
    // rag is cacheable long-context: 8000 × contextMul 5 = ~40000 tokens, over the ~33K window
    for (let i = 0; i < 6; i++) spawnRequest(s, 'rag', 1, 1, 1, 1, 5)
    runFor(s, 80)
    // a cache hit now only skips PREFILL; the response still decodes within the model
    // window, so an over-window prompt is unservable even under a cache aura (no free
    // rescue). The rest are rejected on the window gate (§2.5) or over-refused (§3.6).
    expect(s.stats.served).toBe(0)
    expect(s.stats.bad).toBe(0)
    expect(s.stats.leaked).toBe(0)
    expect(s.stats.unservable + s.stats.overRefused).toBe(6)
    expect(s.stats.unservable).toBeGreaterThan(0)
  })

  it('KV = concurrency: long contexts shrink the streams a rack holds (real KV admission)', () => {
    // K2-Horizon-3.7B is plain full-attention GQA (36 layers × 8 KV heads × 128 = 144 KB of
    // KV per token): at 48K tokens one stream needs ~7 GB, and an Edge (L4, 24 GB) rack holding
    // its BF16 weights keeps ~12 GB of KV — a single stream of the request's cohort.
    const MODEL = 'k2h_3_7b'
    const build = (extraUpgrades?: (g: GameState) => void): GameState => {
      const s = createState(62)
      richBuild(s)
      extraUpgrades?.(s)
      tryBuild(s, 'srv_edge', 3, 2)
      const t = lastTower(s)
      t.precision = 'bf16' // BF16 weights so the KV budget is the 24 GB example
      deployModel(s, t.id, MODEL)
      return s
    }
    const s = build()
    const t = lastTower(s)
    const lo = loadoutOf(s, t)
    const model = MODEL_DEFS[MODEL]
    expect(model.attn).toBe('GQA')
    expect(kvPerReqGb(s, model, 48000)).toBeLessThan(kvFreeGb(s, lo))
    expect(kvPerReqGb(s, model, 48000) * 2).toBeGreaterThan(kvFreeGb(s, lo))
    liveWave(s)
    const a = spawnRequest(s, 'rag', 1, 1, 1, 1, 6) // 48K-token prompt
    const b = spawnRequest(s, 'rag', 1, 1, 1, 1, 6)
    runFor(s, 3)
    expect(t.streams).toBe(1) // the first cohort is KV-limited to one of its 28 streams…
    expect(t.kvFrac).toBeGreaterThan(0.5)
    expect(b.tokBy[t.id] ?? 0).toBe(0) // …and the second request waits for KV
    expect(a.prefill + (a.tokBy[t.id] ?? 0)).toBeGreaterThan(0)

    // FP8 KV-cache quant halves the per-token footprint: the same rack holds three streams
    const s2 = build((g) => infraOn(g, 'inf_kvquant_fp8'))
    const t2 = lastTower(s2)
    expect(kvPerReqGb(s2, model, 48000)).toBeCloseTo(kvPerReqGb(s, model, 48000) / 2, 1)
    liveWave(s2)
    spawnRequest(s2, 'rag', 1, 1, 1, 1, 6)
    spawnRequest(s2, 'rag', 1, 1, 1, 1, 6)
    runFor(s2, 3)
    expect(t2.streams).toBe(3)
  })

  it('admission reserves the FULL sequence: a request that would outgrow the window mid-decode is refused up front', () => {
    const s = createState(63)
    richBuild(s)
    for (const col of [2, 5, 8, 11]) buildSmallWindow(s, col, 2)
    const win = serverCtxWindowTokens(s, loadout(s, 'hw_standard', SMALL_WINDOW))
    liveWave(s)
    // a batch job whose prompt fits the ~33K window but whose prompt + answer does not
    const r = spawnRequest(s, 'batch', 8)
    expect(r.contextLen).toBeLessThan(win)
    expect(r.contextLen + r.work).toBeGreaterThan(win)
    runFor(s, 75)
    expect(r.tokBy[lastTower(s).id] ?? 0).toBe(0) // never started: no compute wasted on it
    expect(s.stats.unservable).toBe(1)
  })
})

describe('endless mode', () => {
  it('continueEndless flips a won run back into build', () => {
    const { continueEndless } = actionsModule
    const s = createState(50)
    s.phase = 'won'
    s.waveIndex = WAVES.length - 1
    expect(continueEndless(s)).toBe(true)
    expect(s.endless).toBe(true)
    expect(s.phase).toBe('build')
    expect(continueEndless(s)).toBe(false) // only once
  })

  it('benchmarks keep hardening: scaling grows with the wave index', () => {
    const a = endlessScaling(WAVES.length) // surge 1
    const b = endlessScaling(WAVES.length + 19) // surge 20
    expect(b.complexity).toBeGreaterThan(a.complexity)
    expect(b.count).toBeGreaterThan(a.count)
    expect(b.work).toBeGreaterThan(a.work)
    expect(b.clearBonus).toBeGreaterThan(a.clearBonus)
    expect(a.complexity).toBeGreaterThan(1)
  })

  it('generates deterministic, scaled waves past the campaign', () => {
    const make = (seed: number) => {
      const s = createState(seed)
      s.endless = true
      s.waveIndex = WAVES.length + 4 // surge 5
      return generateEndlessWave(s)
    }
    const a = make(99)
    const b = make(99)
    expect(a).toEqual(b) // same seed → same wave
    expect(a.groups.length).toBeGreaterThanOrEqual(3)
    for (const g of a.groups) {
      expect(g.complexityMul ?? 1).toBeGreaterThan(1)
      expect(g.workMul ?? 1).toBeGreaterThan(1)
      expect(g.contextMul ?? 1).toBeGreaterThan(1) // context windows of the era grow too
    }
    // scaled difficulty/context actually land on spawned requests
    const s = createState(99)
    liveWave(s)
    const g = a.groups[0]
    spawnRequest(s, 'reason', g.workMul, 1, g.complexityMul, 1, g.contextMul)
    const r = s.requests[0]
    // runtime difficulty = difficulty[primaryAxis] × complexityMul ([fix M2])
    expect(r.difficulty).toBeCloseTo(82 * (g.complexityMul ?? 1), 6)
    expect(r.context).toBe(Math.round(48 * (g.contextMul ?? 1)))
  })

  it('an endless wave can be started and cleared after the campaign', () => {
    const s = createState(51)
    richBuild(s)
    s.endless = true
    s.waveIndex = WAVES.length - 1 // pretend the boss is done
    // a solid frontier fleet with the infrastructure to keep it lit
    for (const [col, row] of [
      [3, 2],
      [8, 2],
      [14, 2],
      [20, 2],
      [6, 6],
      [12, 6],
      [16, 6],
      [19, 8],
    ] as const) {
      expect(buildServerAs(s, 'frontier', col, row)).toBe(true)
    }
    for (const col of [2, 5, 9, 13]) tryBuild(s, 'power', col, 4)
    for (const col of [3, 7, 11, 15]) tryBuild(s, 'cooling', col, 4)
    tryBuild(s, 'guard_encoder', 21, 8)
    tryBuild(s, 'guard_llm', 17, 8)
    expect(startWave(s)).toBe(true)
    expect(s.currentWave?.name).toContain('Surge')
    // the surge resumes at the wave-100 load, far past this small fleet: hold the meters
    // so the test exercises the plumbing (an endless clear returns to build, no win screen)
    for (let i = 0; i < Math.round(400 / SIM_DT) && s.phase === 'wave'; i++) {
      s.meters.trust = 100
      s.meters.sla = 100
      s.meters.cash = Math.max(s.meters.cash, 99999)
      step(s)
    }
    expect(s.phase).toBe('build') // cleared, no win screen in endless
    expect(s.stats.served).toBeGreaterThan(0)
  })
})

describe('wave telemetry & report', () => {
  it('reports service latency from first hardware contact, not spawn time', () => {
    const s = createState(24)
    richBuild(s)
    buildServerAs(s, 'chat', 4, 2) // a fast non-thinking rack finishes the summary inside its range
    liveWave(s)
    s.waveIndex = 0
    s.waveStats = newWaveStats(0)

    const r = spawnRequest(s, 'summ')
    const bornAt = r.bornAt
    runFor(s, 0.5)
    expect(r.queueSec).toBe(0)

    for (let i = 0; i < 2400 && s.phase === 'wave'; i++) step(s)

    const rep = s.lastReport
    expect(rep).not.toBeNull()
    if (!rep) return
    expect(r.ttftReal).toBeGreaterThan(0)
    expect(r.e2elReal).toBeGreaterThanOrEqual(r.ttftReal)
    expect(rep.avgTtft).toBeCloseTo(r.ttftReal, 5)
    expect(rep.avgLatency).toBeCloseTo(r.e2elReal, 5)
    expect((s.time - bornAt) * SIM_TIME_SCALE).toBeGreaterThan(rep.avgLatency + 0.4)
  })

  it('settles a wave report with outcomes, latency, and the power bill', () => {
    const s = createState(25)
    richBuild(s)
    startGame(s)
    // cover both ingress sides so the tier-1 trickle is served, not leaked
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'chat', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'chat', col, 8)
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true)
    expect(s.waveStats).not.toBeNull()

    // mid-wave: servers report live batch load
    runFor(s, 10)
    expect(s.towers.some((t) => t.def.kind === 'server' && t.load > 0)).toBe(true)

    runFor(s, 50)
    expect(s.phase).toBe('build')
    expect(s.waveStats).toBeNull() // settled
    const rep = s.lastReport
    expect(rep).not.toBeNull()
    if (!rep) return
    expect(rep.waveIndex).toBe(0)
    expect(rep.served).toBeGreaterThan(5)
    // the six outcome buckets (R9 / §2.5) sum across byType
    const total = (r: { served: number; sloMiss: number; bad: number; unservable: number; unsafe: number; leaked: number }) =>
      r.served + r.sloMiss + r.bad + r.unservable + r.unsafe + r.leaked
    expect(total(rep)).toBe(Object.values(rep.byType).reduce((n, r) => n + total(r), 0))
    expect(rep.byType['chat']).toBeDefined()
    expect(rep.avgLatency).toBeGreaterThan(0)
    expect(rep.p95Latency).toBeGreaterThanOrEqual(rep.avgLatency)
    // real operating bill (Σ online racks' $/GPU-hr × wall-clock) and token revenue
    expect(rep.powerCost).toBeGreaterThan(0)
    expect(rep.cashIn).toBeGreaterThan(0)
    expect(rep.duration).toBeGreaterThan(0)
  })
})

describe('real economy (§6.6): token-priced income, real operating cost, SLO outcomes', () => {
  it('a late answer (TPOT miss) is an SLO miss: half pay (an SLA credit) and an SLA hit, cause latched', () => {
    // an L40S Standard rack on a 27B dense model decodes far slower than the
    // interactive (IN) 40 ms TPOT bound, so a chat resolves as sloMiss: the answer is
    // correct, billed at 50% (the SLA credit), an SLA-meter hit, excluded from Goodput (§2.5).
    const s = createState(120)
    richBuild(s)
    // the same 27B dense body run without its thinking mode, so the only bound it can miss
    // is the per-token one
    const base = resolveModel(s, GENERAL)!
    s.derivedModels['general_instant'] = {
      ...base,
      id: 'general_instant',
      thinking: 'never',
      qualityByInstant: undefined,
      isReasoning: false,
      thinkTokens: 0,
    }
    s.models['general_instant'] = true
    // blanket the lane with slow Standard (L40S) racks so the chat is decoded to
    // completion (slowly) — several racks working it never make its tokens faster.
    for (const col of [3, 6, 9, 12, 15, 18, 21]) {
      tryBuild(s, 'srv_edge', col, 2)
      const t = lastTower(s)
      upgradeHardware(s, t.id) // → standard (L40S, slow bandwidth)
      expect(deployModel(s, t.id, 'general_instant')).toBe(true)
    }
    const earned0 = s.stats.cashEarned
    const sla0 = s.meters.sla
    liveWave(s)
    const r = spawnRequest(s, 'chat') // interactive (IN) class
    runFor(s, 90)
    expect(s.stats.sloMiss).toBe(1)
    expect(s.stats.served).toBe(0)
    expect(r.sloCause).toBe('tpot') // too slow per token, not too slow to start
    const full = serveRevenueOf(s, r)
    expect(s.stats.cashEarned - earned0).toBeCloseTo(full * 0.5, 9) // half pay
    expect(s.meters.sla).toBeLessThan(sla0) // the SLA meter took a hit
  })

  it('revenue scales with served tokens: an Agentic Task out-earns an Embedding', () => {
    const s = createState(121)
    richBuild(s)
    // a fast rack whose model clears the agent line (a shadow agentic specialist), so
    // the agents are answered correctly and paid in full
    const base = resolveModel(s, BIG)!
    s.derivedModels['agentic_shadow'] = { ...base, id: 'agentic_shadow', qualityBy: { ...base.qualityBy, agentic: 130 } }
    s.models['agentic_shadow'] = true
    for (const col of [3, 8, 14, 20]) {
      buildServerAs(s, 'frontier', col, 2) // fast racks meet SLO
      deployModel(s, lastTower(s).id, 'agentic_shadow')
    }
    // with Red-Team Eval an encoder guardrail screens the agent's injection hazard (§3.4)
    s.upgrades['eval_redteam'] = 1
    tryBuild(s, 'guard_encoder', 6, 0)

    const earnFor = (typeId: string): number => {
      const before = s.stats.cashEarned
      liveWave(s)
      for (let i = 0; i < 5; i++) spawnRequest(s, typeId)
      runFor(s, 60)
      return s.stats.cashEarned - before
    }
    const embedPay = earnFor('embed') // 2000 in / 0 out, $0.05/$0.1 — worthless
    const agentPay = earnFor('agent') // 6000 in / 800 out, $3/$12 — lucrative
    expect(embedPay).toBeGreaterThan(0)
    expect(agentPay).toBeGreaterThan(embedPay * 10) // token-priced: agent dwarfs embed
  })

  it('an idle / over-provisioned fleet bleeds credits (the utilization penalty emerges)', () => {
    // §6.6: operating cost is FIXED by wall-clock — an online rack burns its real
    // $/GPU-hr whether it serves anything or not. A fleet with almost no traffic
    // therefore loses money: income (by tokens) ≈ 0, cost (by time) > 0.
    const s = createState(122)
    richBuild(s)
    for (const col of [3, 6, 9, 12, 15, 18]) buildServerAs(s, 'frontier', col, 2)
    const cash0 = s.meters.cash
    liveWave(s)
    // no traffic for 30 board-seconds: six frontier racks bleed the bill
    s.spawns = [{ typeId: 'embed', count: 1, interval: 1, delay: 999, spawned: 0, timer: 0, started: false }]
    runFor(s, 30)
    expect(s.meters.cash).toBeLessThan(cash0) // the idle fleet lost money
  })

  it('build cost is derived from real capex (capexUsd / 1000)', () => {
    // §6.6: a rack costs its real capex in credits (1 credit = $1000).
    expect(HARDWARE_DEFS.hw_perf.cost).toBe(Math.round(HARDWARE_DEFS.hw_perf.capexUsd / 1000))
    expect(HARDWARE_DEFS.hw_giga.cost).toBe(Math.round(HARDWARE_DEFS.hw_giga.capexUsd / 1000))
    // the capex spread is the real one: an NVL72 dwarfs an Edge L4
    expect(HARDWARE_DEFS.hw_giga.cost).toBeGreaterThan(HARDWARE_DEFS.hw_edge.cost * 100)
  })
})

/* --------------------------------------------------------------------------
 * TWO-LAYER SAFETY (§3) — layer 1 (model-intrinsic alignment: alignment tax +
 * self-handle + over-refusal) and layer 2 (external guardrail buildings: a
 * fixed-ms encoder, a roofline generative guard, a moderation pass; threshold
 * no-free-lunch). Plus over_refused wiring and the red-team eval (eval track).
 * ------------------------------------------------------------------------ */

/** Register a shadow checkpoint cloned from a base, with a forced alignment, and own it. */
function shadowModel(
  s: GameState,
  baseId: string,
  alignment: { safety: number; refusalStyle: 'none' | 'hard-refusal' | 'safe-completion'; overRefusal: number },
  id = 'shadow',
) {
  const base = resolveModel(s, baseId)!
  // an instant (non-thinking) double: these tests measure alignment, not thinking time
  const m: ModelDef = { ...base, id, alignment, thinking: 'never', qualityByInstant: undefined, isReasoning: false, thinkTokens: 0 }
  s.derivedModels[id] = m
  s.models[id] = true
  return m
}

/** A general-spec rack (Performance H100, meets the IN TPOT) deploying `modelId`. */
function buildGeneralRack(s: GameState, col: number, row: number, modelId: string): number {
  tryBuild(s, 'srv_edge', col, row)
  const t = lastTower(s)
  upgradeHardware(s, t.id) // → standard
  upgradeHardware(s, t.id) // → performance (H100)
  if (s.derivedModels[modelId]) s.models[modelId] = true
  deployModel(s, t.id, modelId)
  return t.id
}

describe('two-layer safety (§3)', () => {
  it('layer 1 alignment tax: a high-safety hard-refusal model serves below its raw qualityBy; safe-completion costs less', () => {
    const s = createState(300)
    // a hard-refusal model at safety 80 pays 9×(80−40)/100 = 3.6 quality
    const hard = shadowModel(s, BIG, { safety: 80, refusalStyle: 'hard-refusal', overRefusal: 0.13 }, 'hard80')
    const safe = shadowModel(s, BIG, { safety: 80, refusalStyle: 'safe-completion', overRefusal: 0.03 }, 'safe80')
    const none = shadowModel(s, BIG, { safety: 80, refusalStyle: 'none', overRefusal: 0.02 }, 'none80')
    expect(alignmentTax(hard)).toBeCloseTo(3.6, 6)
    expect(alignmentTax(safe)).toBeCloseTo(1.6, 6) // 4×0.4
    expect(alignmentTax(none)).toBe(0)
    // serverQualityVs applies the tax ON TOP of qualityBy (never baked into it)
    const raw = MODEL_DEFS[BIG].qualityBy.general
    expect(serverQualityVs(s, loadout(s, 'hw_pod', 'hard80'), 'general')).toBeCloseTo(raw - 3.6, 6)
    expect(serverQualityVs(s, loadout(s, 'hw_pod', 'safe80'), 'general')).toBeCloseTo(raw - 1.6, 6)
    // safe-completion is the Pareto point: same safety, more capability than hard-refusal
    expect(serverQualityVs(s, loadout(s, 'hw_pod', 'safe80'), 'general')).toBeGreaterThan(
      serverQualityVs(s, loadout(s, 'hw_pod', 'hard80'), 'general'),
    )
  })

  it('layer 1 self-handle: a high-safety model clears jailbreaks unaided; a low-safety one lets them breach (no guardrail, seed-stable)', () => {
    // pSelfHandle(jailbreak 0.9): high safety 95 → 0.635; low safety 15 → 0 (always breaches).
    expect(pSelfHandle({ alignment: { safety: 95 } } as never, 'jailbreak', 0.9)).toBeCloseTo(0.635, 6)
    expect(pSelfHandle({ alignment: { safety: 15 } } as never, 'jailbreak', 0.9)).toBe(0)

    const run = (safety: number, n: number): { unsafe: number; served: number; cleared: number } => {
      const s = createState(301)
      richBuild(s)
      shadowModel(s, 'g_qwen3_5_9b_2', { safety, refusalStyle: 'hard-refusal', overRefusal: 0 }, 'sh')
      // a fat, fast fleet so jailbreaks are actually served (not just leaking uncleared)
      for (const [c, r] of [[3, 2], [8, 2], [14, 2], [20, 2], [6, 6], [12, 6], [18, 6]] as const)
        buildGeneralRack(s, c, r, 'sh')
      liveWave(s)
      s.spawns = [{ typeId: 'jailbreak', count: n, interval: 0.6, delay: 0, spawned: 0, timer: 0, started: false }]
      runFor(s, 70)
      // "cleared" = self-handled & served safely (served, not breached); breaches = unsafe.
      return { unsafe: s.stats.unsafe, served: s.stats.served, cleared: s.stats.served }
    }
    const low = run(15, 12) // never self-handles → every resolved jailbreak breaches
    const high = run(95, 12) // self-handles a clear majority → far fewer breaches
    expect(low.unsafe).toBeGreaterThanOrEqual(9) // (nearly) all breach: zero self-handle
    expect(low.served).toBe(0) // none served safely
    // high safety clears the hazard on most unaided → many serve safely, far fewer breach
    expect(high.unsafe).toBeLessThan(low.unsafe)
    expect(high.served).toBeGreaterThan(0)
  })

  it('layer 2 guard_encoder catches jailbreak/injection at a FIXED 92 ms on the input (→ TTFT)', () => {
    const enc = TOWER_DEFS['guard_encoder'].guardrail!
    expect(enc.archetype).toBe('encoder')
    expect(enc.side).toBe('input')
    expect(enc.checkLatencyMs).toBe(92)
    expect(enc.runsOnRoofline).toBe(false)
    const s = createState(302)
    richBuild(s)
    expect(guardLatencyMs(s, enc)).toBe(92) // fixed, not the roofline
    // a low-safety rack + an encoder guard on the lane → the jailbreaks are blocked
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sh')
    for (const c of [3, 8, 14, 20]) buildGeneralRack(s, c, 2, 'sh')
    tryBuild(s, 'guard_encoder', 6, 0)
    liveWave(s)
    const jbs = Array.from({ length: 12 }, () => spawnRequest(s, 'jailbreak'))
    const chat = spawnRequest(s, 'chat')
    runFor(s, 60)
    // recall 97.5%: nearly every jailbreak is blocked at the input check, before any compute
    expect(s.stats.unsafe).toBeLessThanOrEqual(1)
    const blocked = jbs.filter((r) => r.attackHandled && r.prefillDoneAt === undefined)
    expect(blocked.length).toBeGreaterThanOrEqual(11)
    for (const r of blocked) expect(r.prefill).toBe(r.tokensIn) // no rack ingested a single prompt token
    // the input check is on the request path: the benign chat paid it in TTFT
    if (chat.prefillDoneAt !== undefined) expect(chat.ttftReal).toBeGreaterThanOrEqual(0.092 - 1e-9)
  })

  it('layer 2 guard_llm runs the real §6 roofline: a short verdict on a real 12B prefill that grows with the turn, drawing real power', () => {
    const llm = TOWER_DEFS['guard_llm'].guardrail!
    expect(llm.archetype).toBe('generative')
    expect(llm.runsOnRoofline).toBe(true)
    expect(llm.guardParamsActiveB).toBe(12)
    expect(llm.checkLatencyMs).toBeUndefined() // dynamic — computed from the roofline
    const s = createState(303)
    richBuild(s)
    const enc = TOWER_DEFS['guard_encoder'].guardrail!
    // the verdict is a classification ('safe' / 'unsafe' + category codes): a few tokens
    expect(GUARD_VERDICT_TOKENS).toBeGreaterThanOrEqual(1)
    expect(GUARD_VERDICT_TOKENS).toBeLessThanOrEqual(6)
    // tens of ms per check on an H100 for a typical prompt, BF16 and FP8 alike
    const bf16 = createState(303)
    const bf16Lat = guardLatencyMs(bf16, llm)
    expect(bf16Lat).toBeGreaterThan(10)
    expect(bf16Lat).toBeLessThan(100)
    infraOn(s, 'inf_wq_fp8')
    const llmLat = guardLatencyMs(s, llm)
    expect(llmLat).toBeLessThan(bf16Lat) // FP8 Tensor Cores: a faster prefill, half the bytes per verdict token
    expect(llmLat).toBeGreaterThan(10)
    // its prefill reads the turn: a longer prompt costs more, unlike the encoder's one fixed forward
    expect(guardCheckMs(s, llm, 2048)).toBeGreaterThan(2 * guardCheckMs(s, llm, 300))
    expect(guardCheckMs(s, enc, 2048)).toBe(guardCheckMs(s, enc, 300))
    // a check reads the user turn (input) and the turn + answer (output), each capped at the screened turn
    expect(guardScreenTokens('input', 600, 400)).toBe(600)
    expect(guardScreenTokens('output', 600, 400)).toBe(1000)
    expect(guardScreenTokens('input', 96000, 1000)).toBe(GUARD_TURN_TOKENS)
    // and it draws real power/heat on its own rack (the encoder occupies ~0 compute)
    expect(guardPower(s, llm)).toBeGreaterThan(0)
    expect(guardHeat(s, llm)).toBeCloseTo(guardPower(s, llm), 6)
    expect(guardPower(s, enc)).toBe(0)
    // it catches all four hazards on both sides
    expect(llm.side).toBe('both')
    expect(llm.catches.sort()).toEqual(['harmful', 'injection', 'jailbreak', 'pii'])
  })

  it('layer 2 guard_mod catches harmful/pii at a fixed vendor latency, off your racks', () => {
    const mod = TOWER_DEFS['guard_mod'].guardrail!
    expect(mod.archetype).toBe('moderation')
    expect(mod.checkLatencyMs).toBe(120)
    expect(mod.runsOnRoofline).toBe(false)
    expect(mod.catches.sort()).toEqual(['harmful', 'pii'])
    const s = createState(304)
    expect(guardLatencyMs(s, mod)).toBe(120)
    expect(guardPower(s, mod)).toBe(0) // vendor-hosted: off your racks
  })

  it('threshold no-free-lunch: raising the guardrail threshold raises recall but raises over_refused', () => {
    const run = (threshold: number): { unsafe: number; overRefused: number } => {
      const s = createState(305)
      richBuild(s)
      s.guardrailThreshold = threshold
      // a low-recall guardrail (low base × low threshold) so the recall gap is visible:
      // a low-safety model so layer 1 never saves the jailbreaks.
      shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sh')
      for (const c of [3, 8, 14, 20]) buildGeneralRack(s, c, 2, 'sh')
      tryBuild(s, 'guard_encoder', 6, 0)
      liveWave(s)
      // a mix: jailbreaks to test recall, benign chats to test over-refusal
      for (let i = 0; i < 30; i++) spawnRequest(s, 'jailbreak')
      for (let i = 0; i < 60; i++) spawnRequest(s, 'chat')
      runFor(s, 120)
      return { unsafe: s.stats.unsafe, overRefused: s.stats.overRefused }
    }
    const lo = run(0.1) // low threshold: lower recall (more breaches), low over-refusal
    const hi = run(1.0) // high threshold: higher recall (fewer breaches), more over-refusal
    expect(hi.unsafe).toBeLessThanOrEqual(lo.unsafe) // recall up → fewer breaches
    expect(hi.overRefused).toBeGreaterThan(lo.overRefused) // but more benign requests wrongly blocked
  })

  it('over_refused: a benign request wrongly refused fires the outcome, hits Trust lightly, and is excluded from served', () => {
    const s = createState(306)
    richBuild(s)
    // a model with a guaranteed over-refusal (1.0) over-refuses every benign request
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 60, refusalStyle: 'hard-refusal', overRefusal: 1 }, 'paranoid')
    buildGeneralRack(s, 3, 2, 'paranoid')
    buildGeneralRack(s, 8, 2, 'paranoid')
    const trust0 = s.meters.trust
    const sla0 = s.meters.sla
    liveWave(s)
    for (let i = 0; i < 6; i++) spawnRequest(s, 'chat') // all benign
    runFor(s, 40)
    expect(s.stats.overRefused).toBe(6) // every benign chat was refused
    expect(s.stats.served).toBe(0) // none served
    expect(s.stats.unsafe).toBe(0) // not a breach
    expect(s.meters.trust).toBeLessThan(trust0) // a LIGHT Trust hit ([fix H5])
    expect(s.meters.sla).toBeLessThan(sla0) // and an SLA hit
    // it appears in the wave report's over_refused bucket, NOT served/Goodput
    const ws = s.lastReport
    if (ws) expect(ws.overRefused).toBeGreaterThan(0)
  })

  it('red-team eval (eval track) lowers over-refusal and unlocks injection/pii detection', () => {
    const s = createState(307)
    // injection (agent) and pii are locked until the red-team eval is researched
    expect(categoryUnlockedFor(s, 'injection')).toBe(false)
    expect(categoryUnlockedFor(s, 'pii')).toBe(false)
    expect(categoryUnlockedFor(s, 'jailbreak')).toBe(true) // always available
    // overRefuse convexity at threshold 1.0, encoder: 0.06×1 = 0.06 before, ×0.7 after v1
    const before = guardOverRefuse('encoder', 1.0, overrefMul(s))
    s.upgrades['eval_redteam'] = 1 // red-team eval v1 done
    expect(categoryUnlockedFor(s, 'injection')).toBe(true) // v1 unlocks injection
    expect(categoryUnlockedFor(s, 'pii')).toBe(false) // pii needs v2
    const after = guardOverRefuse('encoder', 1.0, overrefMul(s))
    expect(after).toBeCloseTo(before * 0.7, 6) // XSTest: ×0.7 over-refusal convexity
    s.upgrades['eval_redteam'] = 2 // red-team eval v2 done
    expect(categoryUnlockedFor(s, 'pii')).toBe(true)
  })
})

/* --------------------------------------------------------------------------
 * OUTCOME-PRECISE SERVING RULES — every request's fate is explainable: which
 * racks wrote the answer, which latency bound it missed, who refused it, what
 * each guard cost (§2.5 / §3 / §0.4 / §4.10).
 * ------------------------------------------------------------------------ */

/** Freeze a request in place, so a test can keep it inside a rack's range. */
function freeze(r: Request): Request {
  r.speed = 0
  return r
}

/** Strip a request's hazards, so a test judges capability alone. */
function benignOf(r: Request): Request {
  r.hazards = {}
  r.hazardsOpen = {}
  r.safetyRisk = 0
  r.safetyCleared = true
  return r
}

/** Every event of one type pushed so far (tests never drain s.events). */
function eventsOf<T extends GameEvent['type']>(s: GameState, type: T): Extract<GameEvent, { type: T }>[] {
  return s.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)
}

/** A shadow checkpoint with overridden per-axis quality and no over-refusal (isolates capability). */
function shadowQuality(s: GameState, baseId: string, id: string, q: Partial<Record<CapabilityAxis, number>>) {
  const base = resolveModel(s, baseId)!
  // an instant (non-thinking) double: these tests measure answer quality, not thinking time
  const m = {
    ...base,
    id,
    qualityBy: { ...base.qualityBy, ...q },
    alignment: { ...base.alignment, overRefusal: 0 },
    thinking: 'never' as const,
    qualityByInstant: undefined,
    isReasoning: false,
    thinkTokens: 0,
  }
  s.derivedModels[id] = m
  s.models[id] = true
  return m
}

/** Keep a live wave running while a test spawns requests by hand (a far-future burst holds it open). */
function holdWave(s: GameState): void {
  s.spawns = [{ typeId: 'embed', count: 1, interval: 1, delay: 1e9, spawned: 0, timer: 0, started: false }]
}

/** Step until the request resolves (or a cap). */
function untilResolved(s: GameState, r: Request, maxSteps = 6000): void {
  for (let i = 0; i < maxSteps && r.alive; i++) step(s)
}

/** A calm general rack model: mid safety, never over-refuses. */
function calmModel(s: GameState): string {
  shadowModel(s, 'g_qwen3_5_9b_2', { safety: 60, refusalStyle: 'hard-refusal', overRefusal: 0 }, 'calm')
  return 'calm'
}

describe('answer quality is token-weighted (the racks that wrote the answer decide it)', () => {
  it('a fast weak rack and a slow strong rack on one request ship a WRONG answer; the strong rack alone serves it', () => {
    const run = (racks: ('weak' | 'strong')[]) => {
      const s = createState(400)
      richBuild(s)
      shadowQuality(s, STARTER, 'weak', { general: 20 })
      shadowQuality(s, GENERAL, 'strong', { general: 97 })
      const ids: Record<string, number> = {}
      for (const kind of racks) {
        if (kind === 'weak') {
          ids.weak = buildGeneralRack(s, 2, 2, 'weak') // H100 + a 1B model: very fast decode
        } else {
          tryBuild(s, 'srv_edge', 2, 0)
          const t = lastTower(s)
          upgradeHardware(s, t.id) // L40S: a slow decode for a 27B model
          deployModel(s, t.id, 'strong')
          ids.strong = t.id
        }
      }
      liveWave(s)
      const r = freeze(spawnRequest(s, 'batch'))
      untilResolved(s, r)
      return { s, r, ids }
    }
    const mixed = run(['weak', 'strong'])
    expect(mixed.s.stats.bad).toBe(1) // the strong rack wrote a sliver of it: no blessing
    expect(mixed.r.bestQuality).toBeLessThan(0)
    expect(mixed.r.bestQuality).toBeCloseTo(mixed.r.qualTokSum / mixed.r.qualTokW, 9)
    expect(mixed.r.answeredBy).toBe(mixed.ids.weak) // the weak rack generated most of it
    expect(mixed.r.tokBy[mixed.ids.strong]).toBeGreaterThan(0)
    const alone = run(['strong'])
    expect(alone.s.stats.served).toBe(1)
    expect(alone.r.bestQuality).toBeGreaterThan(0)
  })
})

describe('layer 1 (model alignment) is rolled at the first output token by the rack that produced it', () => {
  it('a decode-pinned high-safety rack upstream self-handles nothing; the same rack in auto role (it prefills) does', () => {
    const run = (upstreamRole: 'decode' | undefined) => {
      const s = createState(401)
      richBuild(s)
      s.infra.disagg = true
      shadowModel(s, 'g_qwen3_5_9b_2', { safety: 99, refusalStyle: 'hard-refusal', overRefusal: 0 }, 'saint')
      shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sinner')
      const up = buildGeneralRack(s, 2, 2, 'saint')
      s.towers.find((t) => t.id === up)!.role = upstreamRole
      buildGeneralRack(s, 9, 2, 'sinner')
      liveWave(s)
      s.modifiers.safetyDamage = 0 // count the breaches without ending the run
      s.spawns = [{ typeId: 'jailbreak', count: 20, interval: 0.8, delay: 0, spawned: 0, timer: 0, started: false, lane: 0 }]
      runFor(s, 90)
      return s
    }
    const pinned = run('decode')
    expect(eventsOf(pinned, 'selfHandle').length).toBe(0) // it never produced a first token
    expect(pinned.stats.unsafe + pinned.stats.leaked).toBe(20)
    const auto = run(undefined)
    expect(eventsOf(auto, 'selfHandle').length).toBeGreaterThan(0)
    expect(auto.stats.unsafe).toBeLessThan(pinned.stats.unsafe)
  })

  it('a model that handles an attack answers with a short refusal: served, billed only for what it processed', () => {
    const run = (style: 'hard-refusal' | 'safe-completion') => {
      const s = createState(423)
      richBuild(s)
      // safety far above the jailbreak's erosion → a certain self-handle (deterministic)
      shadowModel(s, 'g_qwen3_5_9b_2', { safety: 200, refusalStyle: style, overRefusal: 0 }, 'saint')
      buildGeneralRack(s, 3, 2, 'saint')
      liveWave(s)
      const earned0 = s.stats.cashEarned
      const r = spawnRequest(s, 'jailbreak')
      untilResolved(s, r)
      return { s, r, earned: s.stats.cashEarned - earned0 }
    }
    const hard = run('hard-refusal')
    expect(hard.r.attackHandled).toBe(true)
    expect(hard.s.stats.served).toBe(1)
    expect(hard.s.stats.unsafe).toBe(0)
    expect(hard.r.tokensOut).toBe(HANDLED_ATTACK_TOKENS['hard-refusal']) // a one-liner, not the 400-token payload
    expect(hard.earned).toBeCloseTo(serveRevenueOf(hard.s, hard.r), 9)
    expect(eventsOf(hard.s, 'selfHandle')[0]?.hazard).toBe('jailbreak')
    const safe = run('safe-completion')
    expect(safe.r.tokensOut).toBe(HANDLED_ATTACK_TOKENS['safe-completion']) // a longer, partial safe answer
    expect(safe.r.tokensOut).toBeGreaterThan(hard.r.tokensOut)
  })

  it('embeddings are never over-refused: an embedding pass generates no text to refuse', () => {
    const s = createState(406)
    richBuild(s)
    s.guardrailThreshold = 1 // a strict guard too
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 60, refusalStyle: 'hard-refusal', overRefusal: 1 }, 'paranoid')
    buildGeneralRack(s, 3, 2, 'paranoid')
    buildGeneralRack(s, 8, 2, 'paranoid')
    tryBuild(s, 'guard_encoder', 6, 0)
    liveWave(s)
    for (let i = 0; i < 12; i++) spawnRequest(s, 'embed')
    runFor(s, 60)
    expect(s.stats.overRefused).toBe(0)
    expect(s.stats.served).toBe(12)
  })

  it('over-refusal scales with how borderline the traffic is: chat is exposed, code completion barely', () => {
    const s = createState(407)
    richBuild(s)
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 60, refusalStyle: 'hard-refusal', overRefusal: 0.5 }, 'nervous')
    for (const c of [3, 8, 14, 20]) buildGeneralRack(s, c, 2, 'nervous')
    liveWave(s)
    s.spawns = [
      { typeId: 'chat', count: 60, interval: 0.5, delay: 0, spawned: 0, timer: 0, started: false, lane: 0 },
      { typeId: 'comp', count: 60, interval: 0.5, delay: 0.25, spawned: 0, timer: 0, started: false, lane: 0 },
    ]
    runFor(s, 120)
    const refused = (typeId: string) =>
      eventsOf(s, 'outcome').filter((e) => e.typeId === typeId && e.outcome === 'overRefused').length
    expect(REQUEST_TYPES.chat.refusalExposure).toBeGreaterThan(REQUEST_TYPES.comp.refusalExposure)
    expect(refused('chat')).toBeGreaterThan(15) // ≈ 0.5 × 1.0 of 60
    expect(refused('comp')).toBeLessThan(refused('chat') / 3) // ≈ 0.5 × 0.1 of 60
    const overRefusals = eventsOf(s, 'outcome').filter((e) => e.outcome === 'overRefused')
    expect(overRefusals.every((e) => e.refusedBy === 'model')).toBe(true)
  })
})

describe('guardrails screen by lane coverage (§3.3)', () => {
  it('a guard beside the core and one at the ingress cost the same TTFT and the same false refusals', () => {
    const run = (col: number, row: number) => {
      const s = createState(402)
      richBuild(s)
      s.guardrailThreshold = 1 // strict: false positives frequent enough to compare
      buildGeneralRack(s, 4, 2, calmModel(s))
      expect(tryBuild(s, 'guard_encoder', col, row)).toBe(true)
      expect(guardCoveredLanes(lastTower(s))).toContain(0)
      liveWave(s)
      s.waveStats = newWaveStats(0)
      s.spawns = [{ typeId: 'chat', count: 80, interval: 0.4, delay: 0, spawned: 0, timer: 0, started: false, lane: 0 }]
      for (let i = 0; i < 20000 && s.phase === 'wave'; i++) step(s)
      return s.lastReport!
    }
    const upstream = run(2, 0) // at the lane ingress, before the rack
    const atCore = run(13, 4) // beside the Trust Core, after the rack
    expect(upstream.overRefused).toBeGreaterThan(0)
    expect(atCore.overRefused).toBe(upstream.overRefused)
    expect(atCore.avgTtft).toBeCloseTo(upstream.avgTtft, 9)
    expect(atCore.avgTtft).toBeGreaterThanOrEqual(0.092) // every chat paid the 92 ms check
  })

  it('replicas of one guard add coverage, not recall (nor latency); distinct guard families stack', () => {
    const run = (guards: [string, number, number][]) => {
      const s = createState(403)
      richBuild(s)
      s.guardrailThreshold = 0.1 // a weak threshold so recall gaps are visible
      shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sh')
      for (const c of [3, 8, 14, 20]) buildGeneralRack(s, c, 2, 'sh')
      for (const [id, c, r] of guards) expect(tryBuild(s, id, c, r)).toBe(true)
      liveWave(s)
      holdWave(s)
      s.modifiers.safetyDamage = 0 // count the breaches without ending the run
      const reqs: Request[] = []
      for (let i = 0; i < 60; i++) {
        reqs.push(spawnRequest(s, 'jailbreak'))
        runFor(s, 0.5)
      }
      runFor(s, 90)
      return { s, reqs }
    }
    const one = run([['guard_encoder', 6, 0]])
    const three = run([
      ['guard_encoder', 6, 0],
      ['guard_encoder', 10, 0],
      ['guard_encoder', 16, 0],
    ])
    const stage = laneGuardStages(three.s)[0]
    expect(stage.length).toBe(1) // one encoder family on lane 0…
    expect(stage[0].input.length).toBe(3) // …with three covering replicas
    expect(stage[0].inSec).toBeCloseTo(0.092, 9) // one check's latency, not three
    expect(three.s.stats.unsafe).toBe(one.s.stats.unsafe) // the same verdict on the same input
    expect(three.s.stats.served).toBe(one.s.stats.served)
    for (const r of three.reqs) expect(r.guardInSec).toBeCloseTo(0.092, 9)
    expect(one.s.stats.unsafe).toBeGreaterThan(5) // a weak threshold lets attacks through
    const deep = run([
      ['guard_encoder', 6, 0],
      ['guard_llm', 10, 0],
    ])
    expect(deep.s.stats.unsafe).toBeLessThan(one.s.stats.unsafe) // encoder + Llama Guard: defense in depth
    const caught = eventsOf(deep.s, 'guard').filter((e) => e.result === 'caught')
    expect(caught.some((e) => e.archetype === 'encoder')).toBe(true)
    expect(caught.some((e) => e.archetype === 'generative')).toBe(true)
    expect(caught.every((e) => e.hazard === 'jailbreak')).toBe(true)
  })

  it('an input check is paid in TTFT; an output check is the E2EL tail', () => {
    const s = createState(413)
    richBuild(s)
    s.guardrailThreshold = 0 // no false positives
    buildGeneralRack(s, 3, 2, calmModel(s))
    tryBuild(s, 'guard_mod', 6, 0) // vendor moderation: 120 ms on the input AND on the output
    liveWave(s)
    const r = spawnRequest(s, 'chat')
    untilResolved(s, r)
    expect(r.guardInSec).toBeCloseTo(0.12, 9)
    expect(r.guardOutSec).toBeCloseTo(0.12, 9)
    expect(r.ttftReal).toBeGreaterThanOrEqual(0.12) // input check → TTFT
    expect(r.e2elReal - r.ttftReal - r.decodeSec).toBeCloseTo(0.12, 9) // output check → E2EL
  })
})

describe('outcomes, revenue and the meters (§2.5)', () => {
  it('the outcome table: served pays in full, sloMiss half (an SLA credit), every other outcome nothing', () => {
    const fresh = () => {
      const s = createState(409)
      liveWave(s)
      s.meters.trust = 50
      s.meters.sla = 50
      const r = spawnRequest(s, 'chat')
      r.prefill = 0
      r.work = 0
      r.prefillDoneAt = 0
      return { s, r }
    }
    const pays: Partial<Record<Outcome, number>> = {}
    let full = 0
    for (const o of ['served', 'sloMiss', 'bad', 'unsafe', 'overRefused', 'unservable', 'leaked'] as Outcome[]) {
      const { s, r } = fresh()
      full = serveRevenueOf(s, r)
      resolveOutcome(s, r, o, { refusedBy: 'model' })
      pays[o] = s.stats.cashEarned
      const ev = eventsOf(s, 'outcome')[0]
      expect(ev.outcome).toBe(o)
      expect(ev.cash).toBeCloseTo(pays[o]!, 12)
      expect(s.stats[o]).toBe(1)
      // the ledgers record exactly the losses the event reports
      expect(s.stats.trustLostBy?.[o] ?? 0).toBeCloseTo(Math.max(0, -ev.dTrust), 12)
      expect(s.stats.slaLostBy?.[o] ?? 0).toBeCloseTo(Math.max(0, -ev.dSla), 12)
      if (o === 'overRefused') {
        expect(ev.refusedBy).toBe('model')
        expect(ev.dSla).toBeCloseTo(-0.2 * r.slaPenalty, 12) // light: one refusal must not outweigh many clean serves
      }
      if (o === 'unsafe') expect(ev.dSla).toBe(0) // a breach is a Trust incident, not an availability one
    }
    expect(pays.served).toBeCloseTo(full, 12)
    expect(pays.sloMiss).toBeCloseTo(full * 0.5, 12)
    for (const o of ['bad', 'unsafe', 'overRefused', 'unservable', 'leaked'] as Outcome[]) expect(pays[o]).toBe(0)
  })

  it('a jailbreak nobody answers is a leak (availability), not a breach', () => {
    const s = createState(404)
    liveWave(s)
    const t0 = s.meters.trust
    const sla0 = s.meters.sla
    spawnRequest(s, 'jailbreak')
    runFor(s, 90)
    expect(s.stats.leaked).toBe(1)
    expect(s.stats.unsafe).toBe(0)
    expect(s.meters.trust).toBe(t0) // an attacker who got no answer harms nobody's trust
    expect(s.meters.sla).toBeCloseTo(sla0 - REQUEST_TYPES.jailbreak.slaPenalty, 9)
  })

  it('an unsafe answer resolves the moment it is delivered, on the board — no walk to the core', () => {
    const s = createState(405)
    richBuild(s)
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sh')
    buildGeneralRack(s, 3, 2, 'sh')
    liveWave(s)
    const r = spawnRequest(s, 'jailbreak')
    untilResolved(s, r)
    expect(s.stats.unsafe).toBe(1)
    expect(r.work).toBe(0)
    expect(r.dist).toBeLessThan(pathLength(r.laneId))
  })

  it('Goodput counts every outcome: a wave where everything leaks reads 0%, not 100%', () => {
    const s = createState(408)
    startGame(s)
    expect(startWave(s)).toBe(true)
    for (let i = 0; i < 20000 && s.phase === 'wave'; i++) step(s) // no racks: every request leaks
    const rep = s.lastReport!
    expect(rep.leaked).toBeGreaterThan(0)
    expect(rep.total).toBe(rep.leaked)
    expect(rep.goodputPct).toBe(0)
    expect(rep.sloAttainPct).toBe(100) // nothing was answered, so nothing was answered late
    expect(eventsOf(s, 'wave-clear')[0]?.goodputPct).toBe(0)
    expect(goodputPctOf({ goodput: 2, total: 9 })).toBeCloseTo((2 / 9) * 100, 9)
    expect(sloAttainPctOf({ answered: 4, answeredInSlo: 3 })).toBe(75)
  })

  it('every terminal request emits one precise outcome event, and the ledgers add up to the meter losses', () => {
    const s = createState(426)
    richBuild(s)
    startGame(s)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 8)
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true)
    for (let i = 0; i < 20000 && s.phase === 'wave'; i++) step(s)
    const evs = eventsOf(s, 'outcome')
    const st = s.stats
    expect(evs.length).toBe(st.served + st.sloMiss + st.bad + st.unsafe + st.overRefused + st.unservable + st.leaked)
    expect(new Set(evs.map((e) => e.requestId)).size).toBe(evs.length)
    expect(s.lastReport?.total).toBe(evs.length)
    for (const o of ['sloMiss', 'bad', 'overRefused', 'leaked'] as Outcome[]) {
      const lost = evs.filter((e) => e.outcome === o).reduce((n, e) => n + Math.max(0, -e.dTrust), 0)
      expect(st.trustLostBy?.[o] ?? 0).toBeCloseTo(lost, 9)
    }
    for (const e of evs.filter((x) => x.outcome === 'served')) {
      expect(e.towerId).toBeDefined() // who answered it
      expect(e.modelId).toBeDefined()
      expect(e.margin).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('latency accounting on the real clock (§0.4)', () => {
  it('TTFT includes the fractional completing tick: a real prefill never reads 0 ms', () => {
    const s = createState(411)
    richBuild(s)
    buildGeneralRack(s, 3, 2, calmModel(s))
    liveWave(s)
    const r = spawnRequest(s, 'chat')
    for (let i = 0; i < 3000 && r.prefillDoneAt === undefined; i++) step(s)
    const rate = effectsModule.serverPrefillSpeed(s, loadoutOf(s, lastTower(s)), r.tokensIn)
    expect(r.ttftReal).toBeGreaterThan(0)
    expect(r.ttftReal).toBeCloseTo(r.tokensIn / rate, 9) // no queue, no guards: exactly its prefill time
  })

  it('TTFT accrues only at racks that could prefill the request: a decode-pinned rack upstream adds no queue time', () => {
    const s = createState(414)
    richBuild(s)
    s.infra.disagg = true
    const model = calmModel(s)
    const up = buildGeneralRack(s, 2, 2, model)
    s.towers.find((t) => t.id === up)!.role = 'decode'
    buildGeneralRack(s, 12, 2, model)
    liveWave(s)
    const r = spawnRequest(s, 'chat')
    for (let i = 0; i < 6000 && r.prefillDoneAt === undefined; i++) step(s)
    expect(r.prefillDoneAt).toBeDefined()
    expect(r.queueSec).toBe(0)
  })

  it('thermal throttling slows the per-token rate the SLO is judged on: an on-time chat turns late (TPOT)', () => {
    const run = (overheat: boolean) => {
      const s = createState(417)
      richBuild(s)
      shadowModel(s, GENERAL, { safety: 60, refusalStyle: 'hard-refusal', overRefusal: 0 }, 'dense')
      buildGeneralRack(s, 3, 2, 'dense')
      const lo = loadoutOf(s, lastTower(s))
      const nominalMs = 1000 / serverPerUserDecodeTokS(s, lo, 1)
      expect(nominalMs).toBeLessThan(40) // meets the interactive bound at full clocks…
      expect(nominalMs / decodeThrottle(THROTTLE_FLOOR)).toBeGreaterThan(40) // …but not at the throttle floor
      if (overheat) s.modifiers.coolingCap = 0.01 // cooling collapse → every rack at the throttle floor
      liveWave(s)
      const r = spawnRequest(s, 'chat')
      untilResolved(s, r)
      return { s, r }
    }
    const cool = run(false)
    expect(cool.s.stats.served).toBe(1)
    const hot = run(true)
    expect(hot.s.stats.sloMiss).toBe(1)
    expect(hot.r.sloCause).toBe('tpot')
  })

  it('a request whose KV can never fit the rack is not admitted (no first-admit bypass): unservable', () => {
    const s = createState(416)
    richBuild(s)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    t.precision = 'bf16' // BF16 weights leave a tight KV budget
    upgradeHardware(s, t.id)
    upgradeHardware(s, t.id) // → H100
    // a plain-GQA model (heavy KV per token) with a 512K window: KV overflows inside the window
    deployModel(s, t.id, 'k2h_7b')
    const lo = loadoutOf(s, t)
    const budget = kvFreeGb(s, lo)
    // the smallest prompt whose KV alone overflows the whole budget
    let ctxMul = 1
    while (kvPerReqGb(s, lo.model!, REQUEST_TYPES.rag.inputTokens * ctxMul) <= budget && ctxMul < 400) ctxMul++
    liveWave(s)
    const r = spawnRequest(s, 'rag', 1, 1, 1, 1, ctxMul)
    expect(kvPerReqGb(s, lo.model!, r.contextLen)).toBeGreaterThan(budget)
    expect(r.contextLen).toBeLessThan(serverCtxWindowTokens(s, lo)) // inside the window: KV alone rejects it
    let admitted = false
    for (let i = 0; i < 9000 && r.alive; i++) {
      step(s)
      if (t.load > 0) admitted = true
    }
    expect(admitted).toBe(false)
    expect(s.stats.unservable).toBe(1)
  })
})

describe('prefix cache and router (§4.2 / §4.10)', () => {
  it('overlapping caches do not stack (the best one counts) and a hit skips only the shared prefix', () => {
    const run = (caches: [number, number][]) => {
      const s = createState(415)
      richBuild(s)
      buildGeneralRack(s, 4, 2, calmModel(s))
      for (const [c, row] of caches) expect(tryBuild(s, 'cache', c, row)).toBe(true)
      liveWave(s)
      holdWave(s)
      const reqs: Request[] = []
      for (let i = 0; i < 40; i++) {
        reqs.push(spawnRequest(s, 'rag'))
        runFor(s, 0.3)
      }
      runFor(s, 60)
      return { s, reqs }
    }
    const one = run([[4, 0]])
    const three = run([
      [3, 0],
      [4, 0],
      [5, 0],
    ])
    const hits = (x: { reqs: Request[] }) => x.reqs.filter((r) => r.cachedTokens > 0).length
    expect(hits(one)).toBeGreaterThan(0)
    expect(hits(three)).toBe(hits(one)) // the same single lookup at the same best chance
    for (const r of one.reqs.filter((x) => x.cachedTokens > 0)) {
      expect(r.cachedTokens).toBe(Math.round(r.tokensIn * REQUEST_TYPES.rag.prefixShare)) // only the shared prefix
      expect(r.ttftReal).toBeGreaterThan(0) // the unique suffix still prefilled
    }
    // the per-request hit chance never passes the workload's reuse cap; KV-aware routing
    // recovers part of the misses of ROUTED traffic, up to the researched ceiling
    const s = createState(1)
    expect(effectsModule.prefixHitChance(s, 0.95, false)).toBe(effectsModule.CACHE_HIT_CAP)
    infraOn(s, 'inf_prefix', 'inf_routing')
    expect(effectsModule.prefixHitChance(s, 0.7, false)).toBeCloseTo(0.7, 9)
    expect(effectsModule.prefixHitChance(s, 0.7, true)).toBeCloseTo(0.85, 9)
  })

  it('a Router keeps easy traffic off a slow thinker: of the racks that answer correctly, the soonest answer wins', () => {
    const s = createState(411)
    richBuild(s)
    // an always-thinking model and a hybrid that answers chat instantly, both well above chat's line
    tryBuild(s, 'srv_frontier', 2, 2)
    deployModel(s, lastTower(s).id, ALWAYS)
    const thinker = lastTower(s).id
    buildGeneralRack(s, 2, 0, INSTRUCT)
    const instant = lastTower(s).id
    expect(tryBuild(s, 'router', 1, 2)).toBe(true)
    expect(MODEL_DEFS[ALWAYS].thinking).toBe('always')
    expect(effectsModule.hiddenTokensFor(MODEL_DEFS[ALWAYS], REQUEST_TYPES.chat)).toBeGreaterThan(0)
    expect(MODEL_DEFS[ALWAYS].qualityBy.chat).toBeGreaterThan(MODEL_DEFS[INSTRUCT].qualityByInstant!.chat)
    liveWave(s)
    const r = freeze(spawnRequest(s, 'chat'))
    step(s)
    expect(r.routedTo).toBe(instant)
    untilResolved(s, r)
    expect(r.tokBy[thinker] ?? 0).toBe(0)
    expect(r.hiddenTokens).toBe(0) // answered at once, no hidden reasoning
  })

  it('a Router sends each request to a rack that answers it correctly — the strongest when only one can', () => {
    const run = (withRouter: boolean) => {
      const s = createState(410)
      richBuild(s)
      shadowQuality(s, BIG, 'weakAgent', { agentic: 60 })
      shadowQuality(s, BIG, 'strongAgent', { agentic: 130 })
      tryBuild(s, 'srv_frontier', 2, 2)
      deployModel(s, lastTower(s).id, 'weakAgent')
      const weak = lastTower(s).id
      tryBuild(s, 'srv_frontier', 2, 0)
      deployModel(s, lastTower(s).id, 'strongAgent')
      const strong = lastTower(s).id
      if (withRouter) expect(tryBuild(s, 'router', 1, 2)).toBe(true)
      liveWave(s)
      const r = benignOf(freeze(spawnRequest(s, 'agent')))
      step(s)
      const routedTo = r.routedTo
      untilResolved(s, r)
      return { s, r, weak, strong, routedTo }
    }
    const routed = run(true)
    expect(routed.routedTo).toBe(routed.strong)
    expect(routed.r.tokBy[routed.weak] ?? 0).toBe(0) // the weak rack never touched it
    expect(routed.r.answeredBy).toBe(routed.strong)
    expect(routed.s.stats.served).toBe(1)
    const unrouted = run(false)
    expect(unrouted.r.tokBy[unrouted.weak] ?? 0).toBeGreaterThan(0) // without a router both racks grab it
  })

  it('a rack reaches as far as its current hardware tier', () => {
    const s = createState(419)
    richBuild(s)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    expect(effectsModule.towerRangeTiles(t)).toBe(HARDWARE_DEFS.hw_edge.range)
    for (let i = 0; i < 3; i++) upgradeHardware(s, t.id) // → H200 frontier
    expect(t.hwId).toBe('hw_frontier')
    expect(effectsModule.towerRangeTiles(t)).toBe(HARDWARE_DEFS.hw_frontier.range)
    expect(effectsModule.towerRangeTiles(t)).toBeGreaterThan(t.def.range)
  })

  it('racks publish their live serving state each tick (decode batch, prefill job, KV use)', () => {
    const s = createState(420)
    richBuild(s)
    buildGeneralRack(s, 2, 2, calmModel(s))
    const t = lastTower(s)
    liveWave(s)
    const a = freeze(spawnRequest(s, 'batch'))
    const b = freeze(spawnRequest(s, 'batch'))
    for (let i = 0; i < 600 && (a.prefillDoneAt === undefined || b.prefillDoneAt === undefined); i++) step(s)
    step(s)
    expect(t.batch).toBe(2)
    expect(t.decodeIds).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(t.prefillId).toBeNull()
    expect(t.kvFrac).toBeGreaterThan(0)
    expect(t.kvFrac).toBeLessThanOrEqual(1)
  })
})

describe('build-phase actions and lifecycle events', () => {
  it('model swaps and hardware upgrades happen between waves only; emergency builds stay allowed mid-wave', () => {
    const s = createState(412)
    richBuild(s)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    liveWave(s)
    expect(deployModel(s, t.id, 'g_qwen3_5_9b_2')).toBe(false)
    expect(upgradeHardware(s, t.id)).toBe(false)
    expect(explainRejection(s, 'deploy', [t.id, 'g_qwen3_5_9b_2'])).toMatch(/between waves/)
    expect(explainRejection(s, 'upgradeHardware', [t.id])).toMatch(/between waves/)
    expect(tryBuild(s, 'srv_edge', 5, 2)).toBe(true) // the emergency build
    s.phase = 'build'
    expect(upgradeHardware(s, t.id)).toBe(true)
    expect(deployModel(s, t.id, 'g_qwen3_5_9b_2')).toBe(true)
  })

  it('the power budget is live in the build phase, and brownouts are signalled on transitions', () => {
    const s = createState(418)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching')
    let placed = 0
    for (let row = 2; row <= 8 && placed < 12; row++) {
      if (row === 5) continue
      for (let col = 2; col <= 21 && placed < 12; col += 2) if (tryBuild(s, 'srv_frontier', col, row)) placed++
    }
    expect(isBrownout(s)).toBe(true) // no explicit updatePower: the build itself refreshed it
    expect(s.power.used).toBeGreaterThan(5)
    expect(eventsOf(s, 'brownout').map((e) => e.on)).toEqual([true])
    tryBuild(s, 'power', 3, 4)
    expect(isBrownout(s)).toBe(false)
    expect(eventsOf(s, 'brownout').map((e) => e.on)).toEqual([true, false])
  })

  it('player actions emit precise events with the ids the presentation needs', () => {
    const s = createState(421)
    richBuild(s)
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    expect(eventsOf(s, 'build').at(-1)).toMatchObject({ towerId: t.id, defId: 'srv_edge' })
    upgradeHardware(s, t.id)
    expect(eventsOf(s, 'upgrade').at(-1)).toMatchObject({ towerId: t.id, hwId: 'hw_standard' })
    deployModel(s, t.id, 'g_qwen3_5_9b_2')
    expect(eventsOf(s, 'deploy').at(-1)).toMatchObject({ towerId: t.id, modelId: 'g_qwen3_5_9b_2' })
    const value = towerValue(s, t)
    sellTower(s, t.id)
    expect(eventsOf(s, 'sell').at(-1)).toMatchObject({ towerId: t.id, defId: 'srv_edge', refund: Math.round(value * 0.6) })
  })

  it('waves, incidents, research and losses announce themselves', () => {
    // a single-lane surge wave names its lane; a boss wave says so
    const surgeIdx = CAMPAIGN_THEMES.findIndex((th) => th.special === 'single-lane-surge')
    const bossIdx = CAMPAIGN_THEMES.findIndex((th) => th.boss)
    const startAt = (idx: number) => {
      const s = createState(424)
      s.phase = 'build'
      s.waveIndex = idx - 1
      expect(startWave(s)).toBe(true)
      return eventsOf(s, 'wave-start').at(-1)!
    }
    const surge = startAt(surgeIdx)
    expect(surge.surgeLane).toBe(WAVES[surgeIdx].groups[0].lane)
    expect(startAt(bossIdx).boss).toBe(true)
    expect(startAt(0).surgeLane).toBeUndefined()

    // clearing a wave rolls the next one's signature incident
    const themed = WAVES.findIndex((_, i) => i >= 2 && themedIncidentForWave(i) !== null)
    const s = createState(425)
    liveWave(s)
    s.waveIndex = themed - 1
    s.waveStats = newWaveStats(themed - 1)
    step(s)
    expect(s.phase).toBe('build')
    expect(eventsOf(s, 'incident').at(-1)?.id).toBe(themedIncidentForWave(themed))

    // research starts and Studio completions
    const lab = studioRig(427, ['pt_rl'])
    expect(startResearch(lab, 'inf_paged')).toBe(true)
    expect(eventsOf(lab, 'research-start').at(-1)).toMatchObject({ id: 'inf_paged', track: 'infra' })
    expect(startPostTrain(lab, [BIG], 'grpo', 'reasoning', 1.0)).toBe(true)
    trainToCompletion(lab)
    const drvId = Object.keys(lab.derivedModels)[0]
    expect(eventsOf(lab, 'posttrain-done').at(-1)?.modelId).toBe(drvId)

    // a run ends on the meter that hit zero
    const doomed = createState(428)
    liveWave(doomed)
    doomed.meters.sla = 0.5
    spawnRequest(doomed, 'chat')
    for (let i = 0; i < 20000 && doomed.phase === 'wave'; i++) step(doomed)
    expect(doomed.phase).toBe('lost')
    expect(eventsOf(doomed, 'lose').at(-1)?.meter).toBe('sla')
  })
})

describe('agent bridge snapshot', () => {
  it('exposes model alignment, guard specs with lock state, the last report ledgers and the next wave', () => {
    const s = createState(429)
    richBuild(s)
    startGame(s)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 8)
    for (const col of [4, 10]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12]) tryBuild(s, 'cooling', col, 4)
    const snap = serializeState(s)
    const m = snap.models.find((x) => x.id === GENERAL)!
    expect(m.alignment.refusalStyle).toBe(MODEL_DEFS[GENERAL].alignment.refusalStyle)
    expect(m.alignmentTax).toBeCloseTo(alignmentTax(MODEL_DEFS[GENERAL]), 2)
    expect(m.qualityBy.agentic).toBeCloseTo(MODEL_DEFS[GENERAL].qualityBy.agentic, 0)
    const enc = snap.catalog.find((c) => c.defId === 'guard_encoder')!.guardrail!
    expect(enc.latencyMs).toBe(92)
    expect(enc.catches).toContainEqual({ hazard: 'injection', locked: true, unlockedBy: 'r_eval_redteam_v1' })
    expect(enc.catches).toContainEqual({ hazard: 'jailbreak', locked: false })
    expect(snap.nextWave?.surgeLane).toBeNull()
    expect(snap.nextWave?.incidentId).toBeNull()
    expect(snap.lastReport).toBeNull()
    expect(snap.power.cap).toBeCloseTo(s.power.cap, 2) // live in the build phase
    expect(startWave(s)).toBe(true)
    for (let i = 0; i < 20000 && s.phase === 'wave'; i++) step(s)
    const after = serializeState(s)
    expect(after.lastReport?.wave).toBe(1)
    expect(after.lastReport?.total).toBeGreaterThan(0)
    expect(after.lastReport?.trustLostBy).toBeDefined()
    expect(after.stats.slaLostBy).toBeDefined()
  })
})

describe('serving physics: thinking, precision, multi-LoRA and the two-line bill (D3)', () => {
  /** A hand-made LoRA adapter of `baseId` (the Studio's lora/dora/qlora relation). */
  function adapterOf(s: GameState, baseId: string, id: string): string {
    const base = resolveModel(s, baseId)!
    s.derivedModels[id] = {
      ...base,
      id,
      origin: 'derived',
      lineage: {
        baseModelIds: [baseId],
        relation: 'adapter',
        method: 'lora',
        target: 'coding',
        effort: 1,
        spent: { data: 0, compute: 0, waves: 0 },
        depth: 1,
        createdAtWave: 0,
      },
    }
    s.models[id] = true
    return id
  }

  it('an always-thinking model reasons before it answers: hidden tokens cost decode time, are never billed, and break chat’s first-answer bound', () => {
    const run = (modelId: string) => {
      const s = createState(500)
      richBuild(s)
      // the same model, never wrongly refusing, so the run judges latency alone
      const base = resolveModel(s, modelId)!
      s.derivedModels['calm_' + modelId] = { ...base, id: 'calm_' + modelId, alignment: { ...base.alignment, overRefusal: 0 } }
      buildGeneralRack(s, 1, 2, 'calm_' + modelId) // at the ingress: a parked request is in range
      liveWave(s)
      const r = freeze(spawnRequest(s, 'chat'))
      untilResolved(s, r)
      return { s, r }
    }
    const think = run(ALWAYS)
    const expected = effectsModule.hiddenTokensFor(MODEL_DEFS[ALWAYS], REQUEST_TYPES.chat)
    expect(expected).toBeGreaterThan(0)
    expect(think.r.thinkingMode).toBe('thinking')
    expect(think.r.hiddenTokens).toBe(expected)
    expect(think.r.thinkTokens).toBe(expected)
    expect(think.r.maxWork).toBe(think.r.tokensOut + expected)
    expect(think.r.ttfatReal).toBeGreaterThan(think.r.ttftReal) // the answer starts after the thinking
    expect(think.r.sloCause).toBe('ttfat') // far past chat's few-second first-answer bound
    // the market pays for the answer: half pay (an SLA credit) of the ANSWER tokens only
    expect(think.s.stats.cashEarned).toBeCloseTo(serveRevenueOf(think.s, think.r) * 0.5, 9)
    // a hybrid answers the same chat with thinking switched off
    const instant = run(INSTRUCT)
    expect(instant.r.thinkingMode).toBe('instant')
    expect(instant.r.hiddenTokens).toBe(0)
    expect(instant.r.ttfatReal).toBeCloseTo(instant.r.ttftReal, 9)
    expect(instant.s.stats.served).toBe(1)
    // a long-CoT request's output already IS its reasoning, and an embedding generates nothing
    expect(effectsModule.hiddenTokensFor(MODEL_DEFS[ALWAYS], REQUEST_TYPES.reason)).toBe(0)
    expect(effectsModule.hiddenTokensFor(MODEL_DEFS[ALWAYS], REQUEST_TYPES.embed)).toBe(0)
    // a model served thinking-off spends nothing, even on an agent step
    expect(effectsModule.hiddenTokensFor(MODEL_DEFS[NEVER], REQUEST_TYPES.agent)).toBe(0)
  })

  it('a rack picks its weight format between waves: an explicit 4-bit format fits a model too big at full precision, at its tax', () => {
    const s = createState(501)
    richBuild(s)
    infraOn(s, 'inf_wq_int4')
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    upgradeHardware(s, t.id)
    upgradeHardware(s, t.id) // → H100 (80 GB)
    // Qwen3.5-122B is 122 GB at FP8 (auto): it does not fit one H100…
    expect(deployModel(s, t.id, BIG)).toBe(false)
    // …a format the rack's hardware cannot run is refused
    expect(actionsModule.setRackPrecision(s, t.id, 'nvfp4')).toBe(false) // no FP4 Tensor Cores on an H100
    // …but INT4 (≈65 GB) fits: set the rack's format, then deploy
    expect(actionsModule.setRackPrecision(s, t.id, 'int4')).toBe(true)
    expect(deployModel(s, t.id, BIG)).toBe(true)
    const lo = loadoutOf(s, t)
    expect(effectsModule.servingFormat(s, lo)).toBe('int4')
    expect(serverQuality(s, lo)).toBe(serverQuality(s, loadout(s, 'hw_frontier', BIG)) - 2) // the PTQ tax
    // back to auto would not fit this model: refused, the rack keeps serving
    expect(actionsModule.setRackPrecision(s, t.id, undefined)).toBe(false)
    // between waves only — re-quantizing reloads the weights
    liveWave(s)
    expect(actionsModule.setRackPrecision(s, t.id, 'fp8')).toBe(false)
  })

  it('Multi-LoRA serving hot-swaps adapters of one base mid-wave (served unmerged, a little slower); any other swap waits for the build phase', () => {
    const s = createState(502)
    richBuild(s)
    const a = adapterOf(s, GENERAL, 'adapter_a')
    const b = adapterOf(s, GENERAL, 'adapter_b')
    buildGeneralRack(s, 1, 2, a) // at the ingress: a parked request is in range
    const t = lastTower(s)
    liveWave(s)
    expect(deployModel(s, t.id, b)).toBe(false) // without Multi-LoRA every swap is a weight reload
    infraOn(s, 'inf_multilora')
    expect(deployModel(s, t.id, b)).toBe(true) // the sibling adapter is already co-resident
    expect(t.loraHot).toBe(true)
    expect(deployModel(s, t.id, GENERAL)).toBe(true) // and so is the base itself
    expect(deployModel(s, t.id, STARTER)).toBe(false) // a different model is a reload: between waves
    // unmerged adapters run extra low-rank GEMMs: an adapter served hot decodes slower
    t.modelId = b
    const req = freeze(spawnRequest(s, 'agent'))
    req.prefill = 0
    req.prefillDoneAt = s.time
    step(s)
    const hot = t.tokS ?? 0
    t.loraHot = false
    step(s)
    expect(hot).toBeGreaterThan(0)
    expect(hot).toBeLessThan(t.tokS ?? 0)
    // the build phase merges it again
    t.loraHot = true
    s.phase = 'build'
    s.waveActive = false
    expect(startWave(s)).toBe(true)
    expect(t.loraHot).toBe(false)
  })

  it('the operating bill has two lines: GPU-hours (busy or idle) and energy (kW × PUE × $/kWh); a power-price spike moves only the energy line', () => {
    const run = (powerPrice: number, busy: boolean) => {
      const s = createState(503)
      richBuild(s)
      buildGeneralRack(s, 3, 2, INSTRUCT)
      tryBuild(s, 'guard_llm', 6, 0) // the generative guard runs its own GPU rack
      liveWave(s)
      holdWave(s)
      s.waveStats = newWaveStats(0)
      s.modifiers.powerPrice = powerPrice
      if (busy) for (let i = 0; i < 6; i++) spawnRequest(s, 'chat')
      runFor(s, 5)
      return s.waveStats!
    }
    const base = run(1, false)
    expect(base.gpuCost).toBeGreaterThan(0)
    expect(base.energyCost).toBeGreaterThan(0)
    expect(base.powerCost).toBeCloseTo(base.gpuCost + base.energyCost, 9)
    // energy is the minority of a GPU-hour (its real share is a few percent)
    expect(base.energyCost).toBeLessThan(base.gpuCost)
    const spike = run(1.9, false)
    expect(spike.gpuCost).toBeCloseTo(base.gpuCost, 9)
    expect(spike.energyCost).toBeCloseTo(base.energyCost * 1.9, 6)
    // a busy rack draws more than an idle one: the energy line follows load, GPU-hours do not
    const busy = run(1, true)
    expect(busy.gpuCost).toBeCloseTo(base.gpuCost, 9)
    expect(busy.energyCost).toBeGreaterThan(base.energyCost)
    // the guard's H100 pays its GPU-hours too
    const guardOnly = createState(504)
    richBuild(guardOnly)
    tryBuild(guardOnly, 'guard_llm', 6, 0)
    liveWave(guardOnly)
    holdWave(guardOnly)
    guardOnly.waveStats = newWaveStats(0)
    runFor(guardOnly, 2)
    expect(guardOnly.waveStats!.gpuCost).toBeGreaterThan(0)
  })

  it('the cohort identity: a board rack bills RACKS_PER_TILE real racks and earns on TRAFFIC_SCALE requests per sprite', () => {
    expect(RACKS_PER_TILE * COHORT_STREAMS).toBeCloseTo(TRAFFIC_SCALE, 9)
    const s = createState(505)
    const lo = loadout(s, 'hw_perf', INSTRUCT)
    // one H100's real $/hour → credits per board second for the whole tile
    const perSec = effectsModule.rackOperatingCostPerSec(s, lo, 1)
    const usdPerHr = effectsModule.rackHourlyUsd(s, lo, 1)
    expect(perSec).toBeCloseTo((usdPerHr * (SIM_TIME_SCALE / 3600) * RACKS_PER_TILE) / CREDIT_USD, 9)
    // a fully loaded rack's GPU-hour line plus its energy line is its real all-in rate
    expect(usdPerHr).toBeCloseTo(HARDWARE_DEFS.hw_perf.gpuHrUsd, 1)
  })
})

/* --------------------------------------------------------------------------
 * §1.4 hybrid thinking: the engine's per-request mode. A hybrid answers interactive
 * traffic (latency class IN) with thinking switched off — no hidden tokens, judged on
 * its instant-mode vector — and thinks about everything else (hidden tokens first,
 * judged on its thinking-mode qualityBy). Always / never models have one mode.
 * ------------------------------------------------------------------------ */
describe('hybrid thinking mode (§1.4)', () => {
  /** One request of an archetype on one rack running `modelId`, parked in range, run to its outcome. */
  function serveOne(modelId: string, typeId: string, rack: (s: GameState) => void) {
    const s = createState(610)
    richBuild(s)
    rack(s)
    const tw = lastTower(s)
    expect(deployModel(s, tw.id, modelId)).toBe(true)
    liveWave(s)
    const r = freeze(benignOf(spawnRequest(s, typeId)))
    untilResolved(s, r)
    const outcome = eventsOf(s, 'outcome').find((e) => e.requestId === r.id)!
    return { s, r, tw, outcome }
  }
  const h100 = (s: GameState) => {
    tryBuild(s, 'srv_edge', 1, 2)
    const t = lastTower(s)
    upgradeHardware(s, t.id)
    upgradeHardware(s, t.id)
  }
  const l40s = (s: GameState) => {
    tryBuild(s, 'srv_edge', 1, 2)
    upgradeHardware(s, lastTower(s).id)
  }
  /** The margin combat scores: that mode's vector − taxes − the long-context penalty − difficulty. */
  const expectedMargin = (s: GameState, tw: Tower, r: Request, mode: 'instant' | 'thinking') =>
    serverQualityVs(s, loadoutOf(s, tw), r.def.primaryAxis, mode) - longContextPenalty(s, loadoutOf(s, tw), r.contextLen) - r.difficulty

  it('a hybrid answers chat at once — no hidden tokens — judged on its thinking-off capability', () => {
    const m = MODEL_DEFS[GENERAL]
    expect(m.thinking).toBe('hybrid')
    expect(m.qualityByInstant!.chat).toBeLessThan(m.qualityBy.chat)
    const { s, r, tw, outcome } = serveOne(GENERAL, 'chat', h100)
    expect(r.thinkingMode).toBe('instant')
    expect(r.hiddenTokens).toBe(0)
    expect(r.thinkTokens).toBeUndefined() // no thinking segment on the request bar
    expect(r.maxWork).toBe(r.tokensOut)
    expect(r.ttfatReal).toBeCloseTo(r.ttftReal, 9)
    expect(r.bestQuality).toBeCloseTo(expectedMargin(s, tw, r, 'instant'), 6)
    expect(r.bestQuality).toBeLessThan(expectedMargin(s, tw, r, 'thinking') - 1)
    expect(outcome.outcome).toBe('served')
    expect(outcome.thinkingMode).toBe('instant')
    expect(outcome.hiddenTokens).toBe(0)
  })

  it('the same hybrid thinks on reasoning and RAG: hidden tokens first, judged on its thinking capability', () => {
    // a reasoning request: its long chain-of-thought output IS the reasoning (no extra hidden budget)
    const reason = serveOne(GENERAL, 'reason', h100)
    expect(reason.r.thinkingMode).toBe('thinking')
    expect(reason.r.hiddenTokens).toBe(effectsModule.hiddenTokensFor(MODEL_DEFS[GENERAL], REQUEST_TYPES.reason))
    expect(reason.r.bestQuality).toBeCloseTo(expectedMargin(reason.s, reason.tw, reason.r, 'thinking'), 6)
    expect(reason.outcome.thinkingMode).toBe('thinking')
    // a RAG answer is reasoned over first: the hidden tokens decode before the answer and are not billed
    const rag = serveOne(GENERAL, 'rag', h100)
    const hidden = Math.round(MODEL_DEFS[GENERAL].thinkTokens * REQUEST_TYPES.rag.thinkMul)
    expect(hidden).toBeGreaterThan(0)
    expect(rag.r.thinkingMode).toBe('thinking')
    expect(rag.r.hiddenTokens).toBe(hidden)
    expect(rag.r.thinkTokens).toBe(hidden)
    expect(rag.r.maxWork).toBe(rag.r.tokensOut + hidden)
    expect(rag.r.ttfatReal).toBeGreaterThan(rag.r.ttftReal)
    expect(rag.outcome.hiddenTokens).toBe(hidden)
    // token-weighted over a growing context: within the long-context penalty's drift
    expect(rag.r.bestQuality).toBeCloseTo(expectedMargin(rag.s, rag.tw, rag.r, 'thinking'), 0)
    expect(rag.r.bestQuality).toBeGreaterThan(expectedMargin(rag.s, rag.tw, rag.r, 'instant') + 1)
  })

  it('an instant answer is judged on the instant vector alone: a hybrid strong only when thinking answers chat wrongly', () => {
    const s = createState(611)
    richBuild(s)
    const base = resolveModel(s, GENERAL)!
    s.derivedModels['brittle'] = {
      ...base,
      id: 'brittle',
      alignment: { ...base.alignment, overRefusal: 0 },
      qualityBy: { ...base.qualityBy, chat: 120 },
      qualityByInstant: { ...base.qualityByInstant!, chat: 10 },
    }
    s.models['brittle'] = true
    buildGeneralRack(s, 1, 2, 'brittle')
    liveWave(s)
    const r = freeze(benignOf(spawnRequest(s, 'chat')))
    untilResolved(s, r)
    expect(r.thinkingMode).toBe('instant')
    expect(r.bestQuality).toBeLessThan(0)
    expect(eventsOf(s, 'outcome').find((e) => e.requestId === r.id)?.outcome).toBe('bad')
  })

  it('an always-thinking model still misses chat’s time-to-first-answer bound on a slow rack; a hybrid of its size does not', () => {
    expect(MODEL_DEFS[ALWAYS].thinking).toBe('always')
    const always = serveOne(ALWAYS, 'chat', l40s)
    expect(always.r.thinkingMode).toBe('thinking')
    expect(always.r.hiddenTokens).toBe(effectsModule.hiddenTokensFor(MODEL_DEFS[ALWAYS], REQUEST_TYPES.chat))
    expect(always.r.hiddenTokens).toBeGreaterThan(0)
    expect(always.r.ttfatReal * 1000).toBeGreaterThan(REQUEST_TYPES.chat.ttfatSloMs!)
    expect(always.r.sloCause).toBe('ttfat')
    expect(always.outcome.outcome).toBe('sloMiss')
    // a 9B hybrid on the same rack answers the chat instantly: no thinking delay to miss
    const hybridId = 'g_qwen3_5_9b_2'
    expect(MODEL_DEFS[hybridId].thinking).toBe('hybrid')
    const hybrid = serveOne(hybridId, 'chat', l40s)
    expect(hybrid.r.thinkingMode).toBe('instant')
    expect(hybrid.r.hiddenTokens).toBe(0)
    expect(hybrid.r.sloCause).not.toBe('ttfat')
  })

  it('the deploy picker / fit checks use the same mode per archetype as combat', () => {
    const s = createState(612)
    const lo = loadout(s, 'hw_perf', GENERAL)
    expect(effectsModule.answerMode(MODEL_DEFS[GENERAL], REQUEST_TYPES.chat)).toBe('instant')
    expect(effectsModule.answerMode(MODEL_DEFS[GENERAL], REQUEST_TYPES.comp)).toBe('instant')
    expect(effectsModule.answerMode(MODEL_DEFS[GENERAL], REQUEST_TYPES.agent)).toBe('thinking')
    expect(effectsModule.answerMode(MODEL_DEFS[ALWAYS], REQUEST_TYPES.chat)).toBe('thinking')
    expect(effectsModule.answerMode(MODEL_DEFS[NEVER], REQUEST_TYPES.reason)).toBe('instant')
    // an embedding generates no text: nothing thinks
    expect(effectsModule.answerMode(MODEL_DEFS[GENERAL], REQUEST_TYPES.embed)).toBe('instant')
    // the instant vector backs the interactive axes, qualityBy everything else
    expect(serverQualityVs(s, lo, 'chat', 'instant')).toBeCloseTo(serverQualityVs(s, lo, 'chat') - (MODEL_DEFS[GENERAL].qualityBy.chat - MODEL_DEFS[GENERAL].qualityByInstant!.chat), 9)
    expect(effectsModule.qualityIn(MODEL_DEFS[ALWAYS], 'instant')).toBe(MODEL_DEFS[ALWAYS].qualityBy)
  })
})

describe('derived checkpoints keep their thinking support (§1.4 Studio)', () => {
  const recipe = (id: keyof typeof METHOD_RECIPES) => METHOD_RECIPES[id]

  it('a run on a hybrid moves both vectors by the same per-axis amount and keeps the off switch', () => {
    const base = MODEL_DEFS[GENERAL]
    for (const [method, target] of [
      ['lora', 'coding'],
      ['grpo', 'reasoning'],
      ['cai', 'safety'],
      ['qat', 'general'],
    ] as const) {
      const f = computeDerivedFields(base, recipe(method), target, 1, null)
      expect(f.thinking).toBe('hybrid')
      expect(f.isReasoning).toBe(true)
      expect(f.thinkTokens).toBe(base.thinkTokens)
      for (const a of ['chat', 'coding', 'reasoning', 'general', 'agentic'] as const) {
        const dThink = f.qualityBy[a] - base.qualityBy[a]
        const dInst = f.qualityByInstant![a] - base.qualityByInstant![a]
        // the same change, except where the 8..130 clamp cuts one of them
        if (f.qualityByInstant![a] > 8 && f.qualityByInstant![a] < 130 && f.qualityBy[a] < 130) expect(dInst).toBeCloseTo(dThink, 9)
      }
    }
  })

  it('a reasoning run teaches an instruct model to think: it becomes an always-thinking model', () => {
    const base = MODEL_DEFS[NEVER]
    expect(base.thinking).toBe('never')
    const grpo = computeDerivedFields(base, recipe('grpo'), 'reasoning', 1, null)
    expect(grpo.thinking).toBe('always')
    expect(grpo.isReasoning).toBe(true)
    expect(grpo.thinkTokens).toBe(THINK_TOKENS_FALLBACK)
    expect(grpo.qualityByInstant).toBeUndefined()
    // a chat SFT on it does not: it stays an instruct deployment
    const sft = computeDerivedFields(base, recipe('sft'), 'chat', 1, null)
    expect(sft.thinking).toBe('never')
    expect(sft.thinkTokens).toBe(0)
    // an always-thinking body stays one whatever it is trained on
    expect(computeDerivedFields(MODEL_DEFS[ALWAYS], recipe('sft'), 'chat', 1, null).thinking).toBe('always')
  })

  it('merging a thinker with its instruct sibling gives a hybrid that answers instantly with the instruct path', () => {
    const s = createState(613)
    const meta: PostTrainMeta = { baseIds: [NEVER], method: 'grpo', target: 'reasoning', effort: 1, dataSpent: 0, startWave: 0 }
    const thinker = deriveModel(s, meta)!
    expect(thinker.thinking).toBe('always')
    const merged = computeDerivedFields(MODEL_DEFS[NEVER], recipe('merge'), 'general', 1, thinker)
    expect(merged.thinking).toBe('hybrid')
    expect(merged.qualityByInstant).toEqual(MODEL_DEFS[NEVER].qualityBy)
  })

  it('a distilled student of a hybrid teacher stays a hybrid, both vectors capped by the student', () => {
    const f = computeDerivedFields(MODEL_DEFS[BIG], recipe('distill'), 'general', 1, null)
    expect(f.thinking).toBe('hybrid')
    for (const a of ['chat', 'coding', 'reasoning', 'general', 'agentic'] as const)
      expect(f.qualityByInstant![a]).toBeLessThanOrEqual(MODEL_DEFS[BIG].qualityByInstant![a] + 1e-9)
  })

  it('the derived checkpoint deployModel writes carries the preview’s thinking fields', () => {
    const s = createState(614)
    const meta: PostTrainMeta = { baseIds: [GENERAL], method: 'lora', target: 'chat', effort: 1, dataSpent: 0, startWave: 0 }
    const prev = studioPreview(s, GENERAL, 'lora', 'chat', 1)!
    const drv = deriveModel(s, meta)!
    expect(drv.thinking).toBe(prev.fields.thinking)
    expect(drv.qualityByInstant).toEqual(prev.fields.qualityByInstant)
    // and combat serves its chat instantly, judged on the derived instant vector
    expect(effectsModule.answerMode(drv, REQUEST_TYPES.chat)).toBe('instant')
    expect(effectsModule.qualityIn(drv, 'instant')).toBe(drv.qualityByInstant)
  })
})
