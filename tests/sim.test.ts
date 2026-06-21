import { describe, expect, it } from 'vitest'
import { RACK_UTILIZATION, SIM_DT, SIM_TIME_SCALE, THROTTLE_FLOOR } from '../src/config'
import type { GameState } from '../src/core/types'
import {
  deployModel,
  sellTower,
  startGame,
  startWave,
  towerValue,
  tryBuild,
  upgradeHardware,
} from '../src/sim/actions'
import { DEFAULT_MODEL_ID, HARDWARE_DEFS, INFRA_NODES, METHOD_RECIPES, MODEL_DEFS, RESEARCH_DEFS, TOWER_DEFS, UPGRADE_MAP, UPGRADES, WAVES } from '../src/sim/content'
import {
  TAX_K,
  alignmentTax,
  categoryUnlocked as categoryUnlockedFor,
  overRefuse as guardOverRefuse,
  overrefMul,
  pSelfHandle,
} from '../src/sim/safety'
import {
  applyInfraEffects,
  canPostTrain,
  methodUnlocked,
  startPostTrain,
  startResearch,
  updateResearch,
} from '../src/sim/research'
import { deriveQuality, postTrainComputeCost, postTrainDataCost, resolveModel, studioPreview } from '../src/sim/models'
import * as actionsModule from '../src/sim/actions'
import * as effectsModule from '../src/sim/effects'
import {
  computeRoofTokS,
  decodeThrottle,
  decodeTokSb1,
  defLoadout,
  guardHeat,
  guardLatencyMs,
  guardPower,
  hasLiquidLoop,
  hwNeedsLiquid,
  kvFreeGb,
  kvPerReqGb,
  loadout,
  loadoutOf,
  methodsUnlocked,
  prefillTokS,
  serverAggDecodeTokS,
  serverBandwidthCeiling,
  serverComputeCeiling,
  serverContext,
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
import { calibrateRecipes, recipeGainOrderingOk } from '../src/sim/calibrate'
import { endlessScaling, generateEndlessWave } from '../src/sim/endless'
import { isBrownout, isThrottling, updatePower } from '../src/sim/power'
import { spawnRequest } from '../src/sim/spawn'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'
import { newWaveStats } from '../src/sim/telemetry'

/* --------------------------------------------------------------------------
 * Active-roster checkpoints used by the tests (the frontier-tolerance gate, §calibrate,
 * trims the candidate pool to ~42). Open weights are owned for free; gates are VRAM
 * (paramsTotalB) and METHOD unlocks (MoE/Reasoning).
 *   STARTER  : Granite 4.0 H 1B  — 1 GB, dense, no method. The free default starter.
 *   GENERAL  : Qwen3.6-27B       — 27 GB dense, REASONING model. Fits Standard at FP8.
 *   CODER    : Gemma 4 31B       — 31 GB dense, no method. The most code-leaning kept model.
 *   BIG      : Qwen3-Next-80B    — 80 GB total / 3 B active, MoE. Overflows Frontier, fits Pod.
 *   WEAK     : Nemotron 3 Nano 4B— 4 GB dense; below the reasoning/agentic lines (post-train headroom).
 *   MOE      : Nemotron 3 Nano 30B — 30 GB total / 3.5 B active, MoE+reasoning.
 *   FRONTIER : Qwen3-235B-A22B   — 235 GB MoE+reasoning. Fits SuperPod; big yet agentic < 82 (scale≠agentic).
 *   MLA      : Kimi K2 Thinking  — 1 T MoE, MLA attention (latent-KV tests).
 * ------------------------------------------------------------------------ */
const STARTER = DEFAULT_MODEL_ID
const GENERAL = 'qwen36_27b'
const CODER = 'g_gemma_4_31b_2'
const BIG = 'qwen3_next_80b'
const WEAK = 'g_nvidia_nemotron_3_nano_4b_2'
const MOE = 'nemotron3_nano_30b'
const FRONTIER = 'qwen3_235b'
const MLA = 'kimi_k2'

function runFor(s: GameState, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i++) step(s)
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
  role: 'small' | 'general' | 'coding' | 'frontier',
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
  return deployModel(s, t.id, role === 'coding' ? CODER : GENERAL)
}

describe('request resolution', () => {
  it('a server serves a Simple Chat and earns token-priced revenue', () => {
    const s = createState(1)
    richBuild(s)
    expect(buildServerAs(s, 'general', 2, 2)).toBe(true)
    expect(buildServerAs(s, 'general', 4, 2)).toBe(true)
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
    // Edge racks ship Llama-3.1-8B (coding ≈ 37): they grind out a Code Completion
    // request but quality is below its coding difficulty (56) — a bad answer.
    for (const col of [2, 4, 6, 8, 10, 12]) tryBuild(s, 'srv_edge', col, 2)
    expect(MODEL_DEFS[STARTER].qualityBy.coding).toBeLessThan(REQUEST_CODE_COMPLEXITY)
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
    const giga = loadout(s, 'hw_giga', 'kimi_k2')
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
  it('a liquid rack (DGX/NVL72) cannot be reached or run without a Liquid Cooling Loop', () => {
    const s = createState(6)
    richBuild(s) // FP8 so a 70B fits a frontier rack; methods unlocked
    expect(tryBuild(s, 'srv_frontier', 3, 2)).toBe(true)
    const t = lastTower(s)
    // edge of the air-cooled ladder: H200 frontier is the last AIR tier.
    expect(HARDWARE_DEFS.hw_frontier.cooling).toBe('air')
    expect(HARDWARE_DEFS.hw_pod.cooling).toBe('liquid')
    // §6.5 placement gate: upgrading INTO the liquid pod tier is blocked with no loop.
    expect(upgradeHardware(s, t.id)).toBe(false)
    expect(t.hwId).toBe('hw_frontier') // still air-cooled
    // build the Liquid Cooling Loop → the pod upgrade is now allowed.
    expect(tryBuild(s, 'cooling_liquid', 3, 4)).toBe(true)
    expect(hasLiquidLoop(s)).toBe(true)
    expect(upgradeHardware(s, t.id)).toBe(true)
    expect(t.hwId).toBe('hw_pod')
    // and a liquid rack runs (online) only with the loop present.
    updatePower(s)
    expect(t.online).toBe(true)
  })

  it('an existing liquid rack goes dark (hard gate, not throttle) if the loop is removed', () => {
    const s = createState(7)
    richBuild(s)
    tryBuild(s, 'cooling_liquid', 3, 4)
    tryBuild(s, 'srv_frontier', 3, 2)
    const t = lastTower(s)
    expect(upgradeHardware(s, t.id)).toBe(true) // → pod (liquid), loop present
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

  it('an air-cooled rack never needs a Liquid Cooling Loop', () => {
    const s = createState(8)
    richBuild(s)
    for (const hwId of ['hw_edge', 'hw_standard', 'hw_perf', 'hw_frontier']) {
      expect(hwNeedsLiquid(HARDWARE_DEFS[hwId])).toBe(false)
    }
    for (const hwId of ['hw_pod', 'hw_superpod', 'hw_giga']) {
      expect(hwNeedsLiquid(HARDWARE_DEFS[hwId])).toBe(true)
    }
  })
})

describe('campaign flow', () => {
  it('clears Wave 1 with a sensible build and keeps Trust healthy', () => {
    const s = createState(7)
    richBuild(s)
    startGame(s)
    // blanket BOTH ingress sides (top lanes along row 1, bottom lanes along row 9),
    // power and cool it — wave 1 is a tier-1 trickle spread across all four lanes.
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 8)
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
    // BIG (Llama-3.3-70B, 70 GB FP8) still does not fit a Standard rack
    expect(deployModel(s, t.id, BIG)).toBe(false)
    // redeploying the same model is a no-op
    expect(deployModel(s, t.id, GENERAL)).toBe(false)
  })

  it('an MoE model deploys when its (large) VRAM fits — no MoE gate (R4)', () => {
    const s = createState(34)
    s.meters.cash = 99999
    s.phase = 'build'
    infraOn(s, 'inf_batching', 'inf_wq_fp8') // FP8 so a 24–30B model fits the 48 GB standard rack
    tryBuild(s, 'srv_edge', 3, 2)
    const t = lastTower(s)
    upgradeHardware(s, t.id) // → standard (48 GB)
    // Devstral-24B (dense coder) and Qwen3-30B-A3B (MoE + reasoning) BOTH deploy
    // freely now: MoE sparsity / reasoning are model attributes, not deploy gates.
    expect(deployModel(s, t.id, CODER)).toBe(true)
    expect(deployModel(s, t.id, MOE)).toBe(true)
  })

  it('hardware upgrades walk the tier ladder up to GigaCluster', () => {
    const s = createState(32)
    richBuild(s)
    // the top three tiers (pod/superpod/giga) are liquid-cooled — a Liquid Cooling
    // Loop is required before upgrading into them (§6.5 hard gate, OQ-G8).
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
    const moeLo = loadout(s, 'hw_perf', MOE) // 30.5B total / 3.3B active
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
    // GRPO reasoning on Llama-3.3-70B (a real R1-style self-built reasoner, §1.4).
    const s = studioRig(50, ['pt_rl'])
    const base = MODEL_DEFS[BIG]
    expect(methodUnlocked(s, 'grpo')).toBe(true)
    const recipe = METHOD_RECIPES['grpo']
    const data0 = s.data
    const seq0 = s.derivedSeq

    expect(startPostTrain(s, [BIG], 'grpo', 'reasoning', 1.0)).toBe(true)
    // Data is paid up front; the posttrain track is occupied; other tracks free.
    expect(s.data).toBe(data0 - postTrainDataCost(recipe, 1.0))
    expect(s.research.posttrain?.kind).toBe('posttrain')
    expect(s.research.posttrain?.meta?.method).toBe('grpo')
    expect(s.research.infra).toBeNull()
    // the slot's compute matches the §1.4 cost formula
    expect(s.research.posttrain!.compute).toBeCloseTo(
      Math.max(1, postTrainComputeCost(recipe, base.paramsActiveB, 1.0)),
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
    infraOn(s, 'inf_wq_fp8') // FP8: a 70B fits a 141 GB H200
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
    const base = MODEL_DEFS[BIG] // 70B, agentic well below 82
    expect(base.qualityBy.agentic).toBeLessThan(82)
    expect(startPostTrain(s, [BIG], 'grpo', 'agentic', 1.5)).toBe(true)
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
    // the preview reports the real costs (parity with the cost helpers)
    const recipe = METHOD_RECIPES[method]
    expect(prev.dataCost).toBe(postTrainDataCost(recipe, effort))
    expect(prev.computeCost).toBeCloseTo(Math.max(1, postTrainComputeCost(recipe, before.paramsActiveB, effort)), 3)
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
    expect(prev.fields.weightBytes).toBe(drv.weightBytes)
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
  it('QAT preview (reshapes deploy: weightBytes → 0.5, −2 quality) matches', () => {
    assertParity(studioRig(123, ['pt_qat']), BIG, 'qat', 'general', 1.0)
  })
  it('Distill preview (student body swap) matches', () => {
    assertParity(studioRig(124, ['pt_rl', 'pt_distill']), FRONTIER, 'distill', 'reasoning', 1.0)
  })
  it('Merge preview (averages two upstreams) matches', () => {
    assertParity(studioRig(125, ['pt_lora', 'pt_merge']), BIG, 'merge', 'general', 1.0, GENERAL)
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
    expect(MODEL_DEFS['kimi_k2'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_DIFFICULTY)
    // …but even a 235B SuperPod frontier (Qwen3-235B) is only MID on Terminal-Bench Hard,
    // so its base agentic is short of the wall — a player GRPO-agentic run lifts it over.
    const s = studioRig(59, ['pt_rl'])
    expect(MODEL_DEFS[FRONTIER].qualityBy.agentic).toBeLessThan(AGENT_DIFFICULTY)
    expect(startPostTrain(s, [FRONTIER], 'grpo', 'agentic', 2.0)).toBe(true)
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
    const s = createState(60)
    infraOn(s, 'inf_wq_fp8') // FP8 → 120 GB fits the 8× H200 pod
    expect(serverFitsMemory(s, loadout(s, 'hw_pod', 'nemotron_super'))).toBe(true)
    expect(serverSpeed(s, loadout(s, 'hw_pod', 'nemotron_super'))).toBeGreaterThan(0)
  })
})

describe('hardware/model split (expert mechanics)', () => {
  // each rack tier paired with the model it hosts on the real ladder; tested at
  // FP8 (the standard serving precision that fits a 70B on a single H200, etc.).
  const PAIRS: [string, string][] = [
    ['hw_edge', STARTER], // 8B → 24 GB L4
    ['hw_standard', GENERAL], // 32.8B → 48 GB L40S
    ['hw_perf', 'qwen36_27b'], // 27B → 80 GB H100
    ['hw_frontier', BIG], // 70B (FP8) → 141 GB H200
    ['hw_pod', 'nemotron_super'], // 120B MoE / 12B active → 8× H200 (1128 GB)
    ['hw_superpod', FRONTIER], // 671B → 8× B200 (1536 GB)
    ['hw_giga', 'kimi_k2'], // 1T → NVL72 (13824 GB)
  ]
  const fp8State = (seed: number): GameState => {
    const s = createState(seed)
    infraOn(s, 'inf_wq_fp8')
    return s
  }

  it('throughput roofline: per-user decode ≤ b=1 ceiling, capped by the compute roof', () => {
    const s = fp8State(20)
    for (const [hwId, mid] of PAIRS) {
      const lo = loadout(s, hwId, mid)
      const cc = serverComputeCeiling(s, lo) // compute roof (tok/s)
      const bc = serverBandwidthCeiling(s, lo) // b=1 decode ceiling (tok/s)
      expect(cc).toBeGreaterThan(0)
      expect(bc).toBeGreaterThan(0)
      // headline speed is the b=1 per-user decode rate (batch 1)
      expect(serverSpeed(s, lo)).toBeCloseTo(serverPerUserDecodeTokS(s, lo, 1), 6)
      expect(serverSpeed(s, lo)).toBeCloseTo(bc, 6)
      // aggregate decode rises with batch until it saturates the compute roof
      const agg1 = serverAggDecodeTokS(s, lo, 1)
      const aggBig = serverAggDecodeTokS(s, lo, 100000)
      expect(aggBig).toBeGreaterThan(agg1)
      expect(aggBig).toBeCloseTo(cc, 3)
    }
  })

  it('decode b=1 tracks real HBM bandwidth: HBM_BW / (2·activeB·bytes) (§5.7)', () => {
    const s = createState(28) // FP16, no upgrades
    // gemma3_27b (27B active) FP16 fits an 80 GB H100: decodeTokS_b1 = 3.35e12 / (2 × 27e9 × 2)
    const gemma = MODEL_DEFS['qwen36_27b']
    const expected = (3.35e12) / (2 * gemma.paramsActiveB * 1e9 * 2)
    expect(decodeTokSb1(s, loadout(s, 'hw_perf', 'qwen36_27b'))).toBeCloseTo(expected, 2)
    // compute roof = aggTflops / (2 × activeB) = 989e12 / (2 × 27e9)
    expect(computeRoofTokS(s, loadout(s, 'hw_perf', 'qwen36_27b'))).toBeCloseTo(
      (989e12) / (2 * gemma.paramsActiveB * 1e9),
      0,
    )
    // and the canonical 70B-on-H100 figure (~12 tok/s) holds for the raw formula:
    //   3.35e12 / (2 × 70e9 × 2) ≈ 11.96 tok/s
    expect((3.35e12) / (2 * 70e9 * 2)).toBeCloseTo(11.96, 1)
  })

  it('prefill is compute-bound and super-linear in prompt length (O(n²) attention, §1.1)', () => {
    const s = createState(29)
    const lo = loadout(s, 'hw_perf', 'qwen36_27b') // 27B FP16 fits the 80 GB H100
    const short = prefillTokS(s, lo, 512)
    const long = prefillTokS(s, lo, 16000)
    expect(short).toBeGreaterThan(0)
    // longer prompts ingest slower per token (superlinear = 1 + n/16000)
    expect(long).toBeLessThan(short)
    expect(short / long).toBeCloseTo((1 + 16000 / 16000) / (1 + 512 / 16000), 3)
  })

  it('a model that does not fit VRAM cannot serve at all', () => {
    const s = createState(21) // FP16
    // Llama-3.3-70B (140 GB FP16) jammed into a 24 GB edge rack
    const lo = loadout(s, 'hw_edge', BIG)
    expect(serverFitsMemory(s, lo)).toBe(false)
    expect(serverTargets(s, lo)).toBe(0)
    expect(serverSpeed(s, lo)).toBe(0)
    // 70B FP16 = 140 GB > one H200 (141 with framework) — needs a Pod or FP8
    expect(serverFitsMemory(s, loadout(s, 'hw_frontier', BIG))).toBe(false)
    expect(serverFitsMemory(s, loadout(s, 'hw_pod', BIG))).toBe(true)
    // a trillion-param Kimi K2 (2000 GB FP16) needs SuperPod-or-larger VRAM
    expect(serverFitsMemory(s, loadout(s, 'hw_frontier', 'kimi_k2'))).toBe(false)
    expect(serverFitsMemory(s, loadout(s, 'hw_pod', 'kimi_k2'))).toBe(false)
    expect(serverFitsMemory(s, loadout(s, 'hw_superpod', 'kimi_k2'))).toBe(false) // 2000 > 1536
    expect(serverFitsMemory(s, loadout(s, 'hw_giga', 'kimi_k2'))).toBe(true)
  })

  it('FP8 quantization is effectively lossless: memory halves, decode speeds up, quality intact', () => {
    const base = createState(22) // FP16
    const fp8 = fp8State(22)
    const lo = loadout(base, 'hw_pod', BIG) // FP16 70B fits a Pod; FP8 fits a frontier too
    const model = MODEL_DEFS[BIG]
    // VRAM = paramsTotalB × bytesPerParam: FP16=2 bytes → FP8=1 byte (half)
    expect(serverModelMemory(base, lo)).toBeCloseTo(model.paramsTotalB * 2, 6)
    expect(serverModelMemory(fp8, lo)).toBeCloseTo(model.paramsTotalB * 1, 6)
    // §6.5 real kW: pod TDP (5600 W) × 0.8 util × 0.85 FP8 reduction.
    expect(serverPower(fp8, lo)).toBeCloseTo(
      (HARDWARE_DEFS.hw_pod.tdpWatts / 1000) * RACK_UTILIZATION * 0.85,
      6,
    )
    expect(serverPower(fp8, lo)).toBeCloseTo(serverPower(base, lo) * 0.85, 6) // FP8 cuts 15%
    expect(serverQuality(fp8, lo)).toBe(serverQuality(base, lo)) // ACL'25: lossless
    // lighter weights move less data per token → faster decode (W4A16 win)
    expect(decodeTokSb1(fp8, lo)).toBeGreaterThan(decodeTokSb1(base, lo))
    // FP8 deploys on the fp8 tensor cores: higher compute roof too
    expect(computeRoofTokS(fp8, lo)).toBeGreaterThan(computeRoofTokS(base, lo))
  })

  it('INT4 quarters memory and speeds small-batch decode, but taxes quality and collapses on long context', () => {
    const fp8 = fp8State(27)
    const int4 = createState(27)
    infraOn(int4, 'inf_wq_fp8', 'inf_wq_int4')
    const lo = loadout(int4, 'hw_frontier', BIG)
    const model = MODEL_DEFS[BIG]
    // INT4 → 0.5 bytes/param (a quarter of FP16, half of FP8)
    expect(serverModelMemory(int4, lo)).toBeCloseTo(model.paramsTotalB * 0.5, 6)
    expect(decodeTokSb1(int4, lo)).toBeGreaterThan(decodeTokSb1(fp8, lo))
    expect(serverQuality(int4, lo)).toBe(serverQuality(fp8, lo) - 2) // flat tax
    // the steep long-context penalty (>8K real tokens) — INT4's real-world weak spot
    const { int4ContextPenalty } = effectsModule
    expect(int4ContextPenalty(int4, 16000)).toBe(6)
    expect(int4ContextPenalty(int4, 4000)).toBe(0)
    expect(int4ContextPenalty(fp8, 16000)).toBe(0)
  })

  it('Quantization lets a 70B model squeeze onto a single frontier GPU', () => {
    const s = createState(26)
    const lo = loadout(s, 'hw_frontier', BIG) // 70B FP16 = 140 GB > 141 with framework
    expect(serverFitsMemory(s, lo)).toBe(false)
    infraOn(s, 'inf_wq_fp8') // FP8 = 70 GB → fits 141 GB H200
    expect(serverFitsMemory(s, lo)).toBe(true)
  })

  it('FlashAttention raises context and the bandwidth ceiling', () => {
    const base = fp8State(23)
    const flash = fp8State(23)
    infraOn(flash, 'inf_flash')
    const lo = loadout(base, 'hw_standard', GENERAL)
    expect(serverContext(flash, lo)).toBe(serverContext(base, lo) + 14)
    expect(serverBandwidthCeiling(flash, lo)).toBeCloseTo(
      serverBandwidthCeiling(base, lo) * 1.1,
      6,
    )
    // FlashAttention does not change the compute roofline
    expect(serverComputeCeiling(flash, lo)).toBeCloseTo(serverComputeCeiling(base, lo), 6)
  })

  it('a bad answer is still billed (compute ran, the user paid, Trust dropped)', () => {
    const s = createState(24)
    richBuild(s)
    for (const col of [2, 4, 6, 8, 10, 12]) tryBuild(s, 'srv_edge', col, 2)
    const cash0 = s.meters.cash
    const trust0 = s.meters.trust
    liveWave(s)
    spawnRequest(s, 'comp')
    runFor(s, 30)
    expect(s.stats.bad).toBeGreaterThanOrEqual(1)
    expect(s.meters.cash).toBeGreaterThan(cash0)
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
    expect(r.work).toBeLessThan(400) // decode underway, KV grows
    expect(r.contextLen).toBeGreaterThan(12000)
  })

  it('a prefill stalls every decode on the rack (generation stall) until Chunked Prefill', () => {
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
      expect(summ.prefill).toBeGreaterThan(4000) // still deep in ingestion
      const ragWork = rag.work
      expect(ragWork).toBeGreaterThan(5) // mid-decode
      // measure decode progress over a SHORT window while summ is still prefilling
      for (let i = 0; i < 4 && summ.prefill > 1000; i++) step(s)
      return ragWork - rag.work // rag decode progress during the prefill
    }
    // without chunked prefill: a true generation stall — zero decode progress
    expect(run(false)).toBeCloseTo(0, 3)
    // with chunked prefill: tokens keep flowing beside the ingestion
    expect(run(true)).toBeGreaterThan(0.1)
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
    expect(q(STARTER, 'coding')).toBeLessThan(56) // ships bad code
    expect(q(CODER, 'coding')).toBeGreaterThanOrEqual(56)
  })

  it('only reasoning models clear the hardest reasoning lane (82)', () => {
    // small non-reasoning checkpoints fall short on reason=82 (post-compression, only
    // the small end sits below the line — every kept mid/large model is a strong reasoner)
    expect(q(WEAK, 'reasoning')).toBeLessThan(82)
    expect(q(STARTER, 'reasoning')).toBeLessThan(82)
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
    // a fully-prefilled request: a PREFILL-pool rack must not decode it
    const r = spawnRequest(s, 'summ')
    r.prefill = 0
    const w0 = r.work
    runFor(s, 1)
    expect(r.work).toBeCloseTo(w0, 3)
    // re-pinned between waves (sim-level), the decode pool serves it faster
    t.role = 'decode'
    runFor(s, 0.5)
    expect(r.work).toBeLessThan(w0)
  })
})

describe('the serving-systems era ladder (Orca → vLLM, s.infra-driven)', () => {
  it('before Continuous Batching, a rack serves exactly one request at a time', () => {
    const s = createState(90)
    s.meters.cash = 99999
    s.phase = 'build'
    tryBuild(s, 'srv_edge', 3, 2) // NO research granted: pre-Orca world
    const lo = loadout(s, 'hw_edge', STARTER)
    expect(serverTargets(s, lo)).toBe(1)
    infraOn(s, 'inf_batching') // s.infra.scheduling.batch → hw.targets slots
    expect(serverTargets(s, lo)).toBe(2) // hardware batching unlocked
    // multi-step scheduling adds one more concurrent slot
    infraOn(s, 'inf_multistep')
    expect(serverTargets(s, lo)).toBe(3)
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

  it('per-request KV follows the real formula (2·layers·kvHeads·headDim·seq·bytes)', () => {
    const s = createState(92)
    const model = MODEL_DEFS[GENERAL] // Qwen3.6-27B: 64 layers, 8 kvHeads, 128 headDim, GQA
    // 27B @ 8192 tokens, FP16 KV (2 bytes/elem); GQA is reflected by the low kvHeads
    // already (NO global GQA ×0.4 any more — R4: attention family is a model attr).
    const expected = (2 * 64 * 8 * 128 * 8192 * 2) / 1e9
    expect(kvPerReqGb(s, model, 8192)).toBeCloseTo(expected, 4)
    // KV grows linearly with sequence length (decode inflates it)
    expect(kvPerReqGb(s, model, 16384)).toBeCloseTo(kvPerReqGb(s, model, 8192) * 2, 4)
    // FP8 KV-cache quant (s.infra.kv.quantBytes 2 → 1) halves the per-request KV
    infraOn(s, 'inf_paged', 'inf_kvquant_fp8')
    expect(kvPerReqGb(s, model, 8192)).toBeCloseTo(expected * 0.5, 4)
  })

  it('MLA stores a compact latent: far less KV than a GQA model of similar shape', () => {
    const s = createState(93)
    const mla = MODEL_DEFS[MLA] // Kimi K2 Thinking: attn MLA
    expect(mla.attn).toBe('MLA')
    // MLA applies the ×0.067 latent factor (DeepSeek −93.3%, §4.6)
    const raw = (2 * mla.layers * mla.kvHeads * mla.headDim * 8192 * 2) / 1e9
    expect(kvPerReqGb(s, mla, 8192)).toBeCloseTo(raw * 0.067, 4)
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

describe('speculative decoding (batch-dependent EAGLE curve, §4.4)', () => {
  it('spec lifts decode ~2× at batch 1 and fades to ~1× at batch ≥32', () => {
    const base = createState(96)
    infraOn(base, 'inf_wq_fp8') // a frontier model on a SuperPod
    const spec = createState(96)
    infraOn(spec, 'inf_wq_fp8', 'inf_spec')
    const lo = loadout(base, 'hw_superpod', FRONTIER)
    // batch 1: the bandwidth ceiling roughly doubles (2.0×)
    const b1Base = serverAggDecodeTokS(base, lo, 1)
    const b1Spec = serverAggDecodeTokS(spec, lo, 1)
    expect(b1Spec / b1Base).toBeCloseTo(2.0, 5)
    // the headline (b=1) ceiling reflects the 2× too
    expect(serverBandwidthCeiling(spec, lo)).toBeCloseTo(serverBandwidthCeiling(base, lo) * 2.0, 5)
    // batch ≥32: spec is OFF — the aggregate decode rate matches the no-spec rack
    expect(serverAggDecodeTokS(spec, lo, 32)).toBeCloseTo(serverAggDecodeTokS(base, lo, 32), 5)
    expect(serverAggDecodeTokS(spec, lo, 64)).toBeCloseTo(serverAggDecodeTokS(base, lo, 64), 5)
    // and the curve decays monotonically through the mid-batch band (per-token gain)
    const ratio = (b: number) => serverAggDecodeTokS(spec, lo, b) / serverAggDecodeTokS(base, lo, b)
    expect(ratio(1)).toBeGreaterThan(ratio(8))
    expect(ratio(8)).toBeGreaterThanOrEqual(ratio(24))
    expect(ratio(24)).toBeGreaterThan(ratio(32) - 1e-9)
  })
})

describe('directional fidelity — every technique keeps its real cost', () => {
  it('Speculative Decoding speeds frontier models but burns draft-model power', () => {
    const base = createState(70)
    const spec = createState(70)
    infraOn(spec, 'inf_spec')
    const big = loadout(base, 'hw_superpod', FRONTIER) // frontier-TIER model
    const small = loadout(base, 'hw_edge', STARTER)
    expect(MODEL_DEFS[FRONTIER].tier).toBe('frontier')
    // the b=1 headline speed roughly doubles (the EAGLE low-batch sweet spot, §4.4)
    expect(serverSpeed(spec, big)).toBeCloseTo(serverSpeed(base, big) * 2.0, 5)
    // a resident draft model burns +8% power on the frontier tier
    expect(serverPower(spec, big)).toBeCloseTo(serverPower(base, big) * 1.08, 6)
    // non-frontier racks host no draft model — no power change
    expect(serverPower(spec, small)).toBeCloseTo(serverPower(base, small), 6)
  })

  it('the throughput lift speeds every rack and raises utilization power draw', () => {
    const base = createState(72)
    infraOn(base, 'inf_wq_fp8') // FP8 so GENERAL (32.8B) fits the 48 GB standard rack
    const thr = createState(72)
    infraOn(thr, 'inf_wq_fp8')
    thr.infra.throughput = 2 // two throughput nodes worth of lift (multi-step / DP)
    const lo = loadout(base, 'hw_standard', GENERAL)
    expect(serverSpeed(thr, lo)).toBeGreaterThan(serverSpeed(base, lo))
    expect(serverPower(thr, lo)).toBeCloseTo(serverPower(base, lo) * 1.1, 6) // +5% per level
  })

  it('the inference engine tier (vLLM → SGLang → TRT-LLM) lifts throughput', () => {
    const vllm = createState(73)
    infraOn(vllm, 'inf_wq_fp8')
    const sglang = createState(73)
    infraOn(sglang, 'inf_wq_fp8', 'inf_engine_sglang')
    const trt = createState(73)
    infraOn(trt, 'inf_wq_fp8', 'inf_engine_sglang', 'inf_engine_trtllm')
    const lo = loadout(vllm, 'hw_standard', GENERAL)
    expect(serverSpeed(sglang, lo)).toBeGreaterThan(serverSpeed(vllm, lo))
    expect(serverSpeed(trt, lo)).toBeGreaterThan(serverSpeed(sglang, lo))
  })
})

/** Build a small-window model (Qwen3-1.7B, 32K real window) rack on a Standard GPU rack. */
function buildPhi4(s: GameState, col: number, row: number): void {
  tryBuild(s, 'srv_edge', col, row)
  const t = lastTower(s)
  upgradeHardware(s, t.id) // edge → standard (48 GB fits the 1.7B model easily)
  deployModel(s, t.id, 'g_qwen3_1_7b_instruct_reasonin')
}

describe('long context (real-token window, KV admission, cache rescue)', () => {
  it('a prompt beyond the model real context window is unservable, not just worse', () => {
    const s = createState(60)
    richBuild(s)
    // Qwen3-1.7B's real window is 32K tokens; a 36K-token summ prompt does not fit ANY of them.
    for (const col of [2, 5, 8, 11]) buildPhi4(s, col, 2)
    const windowTokens = serverCtxWindowTokens(s, loadout(s, 'hw_standard', 'g_qwen3_1_7b_instruct_reasonin'))
    expect(windowTokens).toBeCloseTo(32 * 1000 * (1 + 0), 0)
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

  it('a Cache can still rescue traffic the local model window cannot fit', () => {
    const s = createState(61)
    richBuild(s)
    for (const col of [2, 5, 8]) buildPhi4(s, col, 2)
    tryBuild(s, 'cache', 5, 0) // aura over the Phi-4 racks
    liveWave(s)
    // rag is cacheable long-context: 8000 × contextMul 5 = ~40000 tokens, over the 32K window
    for (let i = 0; i < 6; i++) spawnRequest(s, 'rag', 1, 1, 1, 1, 5)
    runFor(s, 80)
    // some cache-serve even though no 32K window could fit them (the rest are
    // unservable — rejected on the window gate, §2.5; a benign rag may also be
    // over-refused by the model's intrinsic over-refusal, §3.6).
    expect(s.stats.served).toBeGreaterThan(0)
    expect(s.stats.served + s.stats.leaked + s.stats.unservable + s.stats.overRefused).toBe(6)
    expect(s.stats.bad).toBe(0)
  })

  it('long contexts crowd out batch concurrency (real KV admission)', () => {
    // Qwen3.6-27B's KV (64 layers × 8 kvHeads): two 48K-token rag prompts
    // cannot both fit the KV budget of a Performance (H100, 80 GB) rack.
    const build = (extraUpgrades?: (g: GameState) => void): GameState => {
      const s = createState(62)
      richBuild(s)
      s.infra.weightQuantBytes = 2 // FP16 so the KV-budget math is the gemma example
      extraUpgrades?.(s)
      tryBuild(s, 'srv_edge', 3, 2)
      const t = lastTower(s)
      upgradeHardware(s, t.id) // → standard
      upgradeHardware(s, t.id) // → performance (80 GB)
      deployModel(s, t.id, 'qwen36_27b')
      return s
    }
    const s = build()
    const t = lastTower(s)
    const lo = loadout(s, t.hwId, t.modelId)
    const model = MODEL_DEFS['qwen36_27b']
    // two 48K-token requests exceed the KV budget → only one is admitted (rag ISL 8000 × ctx 6)
    expect(kvPerReqGb(s, model, 48000) * 2).toBeGreaterThan(kvFreeGb(s, lo))
    liveWave(s)
    spawnRequest(s, 'rag', 1, 1, 1, 1, 6) // 48K-token prompt
    spawnRequest(s, 'rag', 1, 1, 1, 1, 6)
    runFor(s, 3)
    expect(t.load).toBeCloseTo(0.5, 6) // 1 of 2 slots — the second rag is locked out

    // maxed KV-Cache (prefix) + FlashAttention shrink the footprint and restore batching
    const s2 = build((g) => {
      g.infra.kv.prefixHitCeil = 0.85 // prefix-cache level 2
      g.infra.kv.flash = 2 // FlashAttention level 2
    })
    const t2 = lastTower(s2)
    const lo2 = loadout(s2, t2.hwId, t2.modelId)
    expect(kvPerReqGb(s2, model, 48000) * 2).toBeLessThan(kvFreeGb(s2, lo2))
    liveWave(s2)
    spawnRequest(s2, 'rag', 1, 1, 1, 1, 6)
    spawnRequest(s2, 'rag', 1, 1, 1, 1, 6)
    runFor(s2, 3)
    expect(t2.load).toBeCloseTo(1, 6) // both admitted now
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
    expect(b.reward).toBeGreaterThan(a.reward)
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
    const sc = endlessScaling(WAVES.length + 4)
    spawnRequest(s, 'reason', 1, 1, sc.complexity, sc.reward, sc.context)
    const r = s.requests[0]
    // runtime difficulty = difficulty[primaryAxis] × complexityMul ([fix M2])
    expect(r.difficulty).toBeCloseTo(82 * sc.complexity, 6)
    expect(r.reward).toBeCloseTo(30 * sc.reward, 6)
    expect(r.context).toBe(Math.round(48 * sc.context))
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
    runFor(s, 240)
    expect(s.phase).toBe('build') // cleared, no win screen in endless
    expect(s.stats.served).toBeGreaterThan(0)
  })
})

describe('wave telemetry & report', () => {
  it('reports service latency from first hardware contact, not spawn time', () => {
    const s = createState(24)
    richBuild(s)
    buildServerAs(s, 'general', 4, 2)
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
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 2)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'general', col, 8)
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
  it('a late serve (TPOT miss) yields ZERO cash and drops SLA — slo_miss, not served', () => {
    // an L40S Standard rack on a 32B reasoning model decodes at ~76 ms/token —
    // it misses the interactive (IN) TPOT, so an interactive request resolves as
    // slo_miss: HARDCORE zero cash, an SLA-meter hit, excluded from Goodput (§2.5).
    const s = createState(120)
    richBuild(s)
    // blanket the lane with slow Standard (L40S) racks on a 32B reasoning model so
    // the chat is decoded to completion (slowly) — and resolves as slo_miss, late.
    for (const col of [3, 6, 9, 12, 15, 18, 21]) {
      tryBuild(s, 'srv_edge', col, 2)
      const t = lastTower(s)
      upgradeHardware(s, t.id) // → standard (L40S, slow bandwidth)
      expect(deployModel(s, t.id, GENERAL)).toBe(true) // 32B reasoning model
    }
    const earned0 = s.stats.cashEarned
    const sla0 = s.meters.sla
    liveWave(s)
    spawnRequest(s, 'chat') // interactive (IN) class
    runFor(s, 90)
    expect(s.stats.sloMiss).toBe(1)
    expect(s.stats.served).toBe(0)
    expect(s.stats.cashEarned).toBe(earned0) // zero cash for the late answer
    expect(s.meters.sla).toBeLessThan(sla0) // the SLA meter took a hit
  })

  it('revenue scales with served tokens: an Agentic Task out-earns an Embedding', () => {
    const s = createState(121)
    richBuild(s)
    for (const col of [3, 8, 14, 20]) buildServerAs(s, 'frontier', col, 2) // fast racks meet SLO
    // an encoder guardrail clears the agent's injection hazard (§3.4); spawning a few
    // of each smooths over the occasional benign over-refusal so the comparison holds.
    tryBuild(s, 'guard_encoder', 6, 0)
    tryBuild(s, 'guard_encoder', 12, 0)

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
  const m = { ...base, id, alignment }
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
    // a low-safety rack + an encoder guard before the core → the jailbreak is caught
    shadowModel(s, 'g_qwen3_5_9b_2', { safety: 15, refusalStyle: 'none', overRefusal: 0 }, 'sh')
    for (const c of [3, 8, 14, 20]) buildGeneralRack(s, c, 2, 'sh')
    tryBuild(s, 'guard_encoder', 6, 0)
    tryBuild(s, 'guard_encoder', 12, 0)
    liveWave(s)
    for (let i = 0; i < 12; i++) spawnRequest(s, 'jailbreak')
    runFor(s, 60)
    expect(s.stats.unsafe).toBe(0) // every jailbreak caught by the encoder layer
    expect(s.stats.served).toBeGreaterThan(0)
  })

  it('layer 2 guard_llm runs the real §6 roofline: a longer inference than the 92 ms encoder, drawing real power', () => {
    const llm = TOWER_DEFS['guard_llm'].guardrail!
    expect(llm.archetype).toBe('generative')
    expect(llm.runsOnRoofline).toBe(true)
    expect(llm.guardParamsActiveB).toBe(12)
    expect(llm.checkLatencyMs).toBeUndefined() // dynamic — computed from the roofline
    const s = createState(303)
    richBuild(s)
    const enc = TOWER_DEFS['guard_encoder'].guardrail!
    const llmLat = guardLatencyMs(s, llm)
    // a real (shorter) 12B inference is far slower than a single BERT forward (92 ms)
    expect(llmLat).toBeGreaterThan(guardLatencyMs(s, enc))
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
