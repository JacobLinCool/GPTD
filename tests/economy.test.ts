/**
 * Economy + campaign rules (PLAN D4): the SLA contract, research requisition, the Studio
 * capacity ceiling and merge rules, power/cooling pools and grid incidents, era hazard
 * pressure, the incident mapping, boss teeth, and the endless seam.
 */
import { describe, expect, it } from 'vitest'
import { CLEAR_BONUS_SCALE, SIM_DT, START } from '../src/config'
import type {
  GameState,
  Lineage,
  ModelDef,
  PostTrainMethod,
  PostTrainTarget,
  Request,
} from '../src/core/types'
import { continueEndless, startGame, tryBuild, upgradeHardware } from '../src/sim/actions'
import { explainRejection } from '../src/agent/diagnose'
import { serializeState } from '../src/agent/snapshot'
import {
  buildWave,
  CAMPAIGN_THEMES,
  CONTRACT_BASE,
  contractPayout,
  groupMuls,
  hazardMulOf,
  MAX_TIER,
  novelShareOf,
  tierBonus,
  waveBudget,
} from '../src/sim/campaign'
import {
  HARDWARE_DEFS,
  INCIDENTS,
  INFRA_NODES,
  METHOD_RECIPES,
  MODEL_DEFS,
  MODEL_LIST,
  WAVES,
  themedIncidentForWave,
} from '../src/sim/content'
import { rackGpuCostPerSec } from '../src/sim/effects'
import { endlessScaling, generateEndlessWave } from '../src/sim/endless'
import { laneGuardStages, screenInput } from '../src/sim/guards'
import {
  CAPACITY_MARGIN,
  CAPACITY_PEER_SIZE,
  capacityCeiling,
  computeDerivedFields,
  type DerivedFields,
  deriveModel,
  mergeBlock,
  resolveModel,
  studioPreview,
} from '../src/sim/models'
import { coolingPools, isThrottling, powerBuildOpen, towerPowerKw, updatePower } from '../src/sim/power'
import { previewNextWave } from '../src/sim/preview'
import {
  applyInfraEffects,
  canPostTrain,
  requisitionPick,
  requisitionPreview,
  startPostTrain,
  startResearch,
  updateResearch,
} from '../src/sim/research'
import { resolveOutcome } from '../src/sim/resolve'
import { NOVEL_RECALL_MUL } from '../src/sim/safety'
import { rollIncident, step } from '../src/sim/sim'
import { escalatedHazards, isNovelAt, spawnRequest } from '../src/sim/spawn'
import { createState } from '../src/sim/state'
import { newWaveStats } from '../src/sim/telemetry'

function infraOn(s: GameState, ...ids: string[]): void {
  for (const id of ids) {
    applyInfraEffects(s, INFRA_NODES[id].effects)
    s.upgrades[id] = 1
  }
}

function rich(seed: number): GameState {
  const s = createState(seed)
  s.meters.cash = 999999
  s.data = 9999
  s.phase = 'build'
  infraOn(s, 'inf_batching', 'inf_paged', 'inf_wq_fp8')
  return s
}

function lastTower(s: GameState) {
  return s.towers[s.towers.length - 1]
}

/** A synthetic derived snapshot one run deeper (for chaining computeDerivedFields in tests). */
function deeper(m: ModelDef, f: DerivedFields, method: PostTrainMethod, target: PostTrainTarget): ModelDef {
  const lineage: Lineage = {
    baseModelIds: [m.id],
    relation: 'finetune',
    method,
    target,
    effort: 1,
    spent: { data: 0, compute: 0, waves: 0 },
    depth: f.depth,
    createdAtWave: 0,
  }
  return { ...m, ...f, origin: 'derived', lineage }
}

const flopsOf = (s: GameState, ids: number[]): number =>
  ids.reduce((n, id) => n + HARDWARE_DEFS[s.towers.find((t) => t.id === id)!.hwId!].bf16Tflops, 0)

/* ------------------------------------------------------------------ */

describe('SLA contract: the clear bonus is paid × the wave Goodput', () => {
  it('pays the authored contract × CLEAR_BONUS_SCALE × Goodput, clamped to [0, 100] %', () => {
    expect(contractPayout(1000, 100)).toBe(Math.round(1000 * CLEAR_BONUS_SCALE))
    expect(contractPayout(1000, 50)).toBe(Math.round(500 * CLEAR_BONUS_SCALE))
    expect(contractPayout(1000, 0)).toBe(0)
    expect(contractPayout(1000, 140)).toBe(contractPayout(1000, 100))
    expect(contractPayout(1000, -5)).toBe(0)
  })

  it('the contract pays from the first wave, grows with tier, and a boss pays a premium', () => {
    // a board rack stands for thousands of real racks serving minutes of traffic, so the opening
    // waves' tokens cover little of the bill: the contract is what funds a clean starter fleet
    const starterBill = 6 * rackGpuCostPerSec(HARDWARE_DEFS.hw_standard) * 40
    expect(contractPayout(tierBonus(1, false), 100)).toBeGreaterThan(starterBill * 2)
    expect(tierBonus(1, false)).toBeGreaterThanOrEqual(CONTRACT_BASE)
    for (let t = 1; t < MAX_TIER; t++) expect(tierBonus(t + 1, false)).toBeGreaterThan(tierBonus(t, false))
    for (let t = 1; t <= MAX_TIER; t++) expect(tierBonus(t, true)).toBeGreaterThan(tierBonus(t, false))
    for (let i = 0; i < WAVES.length; i++) {
      const th = CAMPAIGN_THEMES[i]
      expect(WAVES[i].clearBonus).toBe(tierBonus(th.tier, th.boss ?? false))
    }
  })

  it('clearing a wave at 60% Goodput collects 60% of its contract', () => {
    const s = createState(5)
    startGame(s)
    s.waveIndex = 49 // W50, a boss contract
    s.currentWave = WAVES[49]
    s.phase = 'wave'
    s.waveActive = true
    s.spawns = []
    s.requests = []
    s.waveStats = newWaveStats(49)
    s.waveStats.total = 10
    s.waveStats.goodput = 6
    const cash0 = s.meters.cash
    step(s)
    expect(s.phase).toBe('build')
    const expected = contractPayout(WAVES[49].clearBonus, 60)
    expect(expected).toBeGreaterThan(0)
    expect(s.lastReport?.clearBonus).toBe(expected)
    expect(s.meters.cash - cash0).toBeCloseTo(expected, 6)
  })
})

/* ------------------------------------------------------------------ */

describe('research requisition respects RESEARCH_MAX_SHARE', () => {
  const CAP = 0.45

  function fleet(seed: number, racks: [string, number, number][]): GameState {
    const s = rich(seed)
    for (const [def, col, row] of racks) expect(tryBuild(s, def, col, row)).toBe(true)
    updatePower(s)
    for (const t of s.towers) t.online = true
    return s
  }

  it('a single-rack datacenter never lends its only rack: research waits, serving never stops', () => {
    const s = fleet(11, [['srv_frontier', 3, 2]])
    expect(requisitionPick(s)).toEqual([])
    const rq = requisitionPreview(s, 1000)
    expect(rq.blocked).toBe(true)
    expect(rq.servingLoss).toBe(0)
    expect(rq.seconds).toBe(Infinity)
  })

  it('whole racks fit UNDER the cap (rounding down); two equal racks lend the weakest one', () => {
    const two = fleet(12, [
      ['srv_frontier', 3, 2],
      ['srv_frontier', 8, 2],
    ])
    expect(requisitionPick(two).length).toBe(1) // nothing fits 45%, so one rack (not both)
    const mixed = fleet(13, [
      ['srv_frontier', 3, 2],
      ['srv_frontier', 8, 2],
      ['srv_frontier', 14, 2],
      ['srv_edge', 20, 2],
      ['srv_edge', 6, 6],
      ['srv_edge', 12, 6],
      ['srv_edge', 16, 6],
    ])
    const fleetFlops = mixed.towers.reduce((n, t) => n + HARDWARE_DEFS[t.hwId!].bf16Tflops, 0)
    const pick = requisitionPick(mixed).map((t) => t.id)
    expect(pick.length).toBeGreaterThan(0)
    expect(flopsOf(mixed, pick)).toBeLessThanOrEqual(fleetFlops * CAP + 1e-6)
    const rq = requisitionPreview(mixed, 5000)
    expect(rq.rackIds).toEqual(pick)
    expect(rq.servingLoss).toBeLessThanOrEqual(CAP + 1e-9)
    expect(rq.blocked).toBe(false)
  })

  it('a big rack beside small ones is skipped when it alone would cross the cap', () => {
    const s = fleet(14, [
      ['srv_frontier', 3, 2],
      ['srv_edge', 8, 2],
      ['srv_edge', 14, 2],
      ['srv_edge', 20, 2],
    ])
    // upgrade the frontier rack to a DGX B200 (both DGX nodes are air-cooled)
    const big = s.towers[0]
    expect(upgradeHardware(s, big.id)).toBe(true)
    expect(upgradeHardware(s, big.id)).toBe(true)
    for (const t of s.towers) t.online = true
    const pick = requisitionPick(s)
    expect(pick.some((t) => t.id === big.id)).toBe(false)
    const total = s.towers.reduce((n, t) => n + HARDWARE_DEFS[t.hwId!].bf16Tflops, 0)
    expect(
      flopsOf(
        s,
        pick.map((t) => t.id),
      ),
    ).toBeLessThanOrEqual(total * CAP + 1e-6)
  })

  it('progress is credited at exactly the lent rate (nothing lent is wasted), split across tracks', () => {
    const s = fleet(15, [
      ['srv_frontier', 3, 2],
      ['srv_frontier', 8, 2],
      ['srv_frontier', 14, 2],
      ['lab', 2, 4],
    ])
    s.phase = 'build'
    expect(startResearch(s, 'r_eval_redteam_v1')).toBe(true)
    const rq = requisitionPreview(s, 0, false)
    s.phase = 'wave'
    updateResearch(s, SIM_DT)
    const slot = s.research.eval!
    const lentRate = s.towers
      .filter((t) => t.training)
      .reduce((n, t) => n + HARDWARE_DEFS[t.hwId!].bf16Tflops * t.throttle, 0)
    expect(lentRate).toBeCloseTo(rq.lentTflops, 6)
    expect(slot.progress).toBeCloseTo(lentRate * SIM_DT, 6)
    expect(s.towers.filter((t) => t.training).length).toBe(rq.rackIds.length)
  })
})

/* ------------------------------------------------------------------ */

describe('Studio: capacity ceiling by body size, forgetting with depth, same-base merges', () => {
  const recipe = METHOD_RECIPES.grpo

  it('the ceiling depends only on the body: the best roster base up to 2× its size, + the margin', () => {
    for (const m of [MODEL_LIST[0], MODEL_LIST[10], MODEL_LIST[MODEL_LIST.length - 1]]) {
      for (const axis of ['agentic', 'coding'] as const) {
        const peers = MODEL_LIST.filter((p) => p.paramsTotalB <= CAPACITY_PEER_SIZE * m.paramsTotalB)
        const best = Math.max(...peers.map((p) => p.qualityBy[axis]))
        expect(capacityCeiling(m.paramsTotalB, axis)).toBeCloseTo(Math.min(130, best + CAPACITY_MARGIN), 9)
      }
    }
    // a bigger body never has a lower ceiling
    const sizes = [...new Set(MODEL_LIST.map((m) => m.paramsTotalB))].sort((a, b) => a - b)
    for (let i = 1; i < sizes.length; i++)
      expect(capacityCeiling(sizes[i], 'agentic')).toBeGreaterThanOrEqual(
        capacityCeiling(sizes[i - 1], 'agentic'),
      )
  })

  it('stacked GRPO runs on a small body stop at its ceiling — the chain cannot ratchet past it', () => {
    // the smallest body whose ceiling sits below the 130 scale cap on agentic
    const small = MODEL_LIST.filter((m) => capacityCeiling(m.paramsTotalB, 'agentic') < 125).sort(
      (a, b) => b.qualityBy.agentic - a.qualityBy.agentic,
    )[0]
    expect(small).toBeDefined()
    const ceil = capacityCeiling(small.paramsTotalB, 'agentic')
    let m = small
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      const f = computeDerivedFields(m, recipe, 'agentic', 2, null)
      m = deeper(m, f, 'grpo', 'agentic')
      seen.push(m.qualityBy.agentic)
      expect(m.qualityBy.agentic).toBeLessThanOrEqual(Math.max(ceil, small.qualityBy.agentic) + 1e-9)
    }
    expect(seen[seen.length - 1]).toBeCloseTo(Math.max(ceil, small.qualityBy.agentic), 6)
  })

  it('a parent already above its ceiling is never reduced by the ceiling', () => {
    const m = MODEL_LIST.find(
      (x) => x.qualityBy.agentic > 30 && capacityCeiling(x.paramsTotalB, 'agentic') < 120,
    )!
    const ceil = capacityCeiling(m.paramsTotalB, 'agentic')
    const above = { ...m, qualityBy: { ...m.qualityBy, agentic: ceil + 5 } }
    const f = computeDerivedFields(above, recipe, 'agentic', 1, null)
    expect(f.qualityBy.agentic).toBeCloseTo(ceil + 5, 9) // no gain, no cut on the target axis
  })

  it('the preview says when the body ceiling limits the gain', () => {
    const s = rich(21)
    s.upgrades.pt_rl = 1
    tryBuild(s, 'lab', 2, 4)
    // a body the ceiling binds on: a full-effort GRPO would push it past what its size class reaches
    const small = MODEL_LIST.find((m) => {
      const c = capacityCeiling(m.paramsTotalB, 'agentic')
      return (
        c < 128 &&
        m.qualityBy.agentic < c &&
        computeDerivedFields(m, recipe, 'agentic', 2, null).qualityBy.agentic >= c - 1e-9
      )
    })!
    const big = MODEL_LIST.find((m) => capacityCeiling(m.paramsTotalB, 'agentic') - m.qualityBy.agentic > 30)!
    expect(studioPreview(s, small.id, 'grpo', 'agentic', 2, 0)!.ceiling).toEqual({
      axis: 'agentic',
      value: capacityCeiling(small.paramsTotalB, 'agentic'),
    })
    expect(studioPreview(s, big.id, 'grpo', 'agentic', 0.25, 0)!.ceiling).toBeNull()
  })

  it('forgetting compounds with lineage depth (CPT forgets the most)', () => {
    const base = MODEL_LIST.find((m) => m.qualityBy.coding > 70 && m.qualityBy.coding < 110)!
    const cpt = METHOD_RECIPES.cpt
    const d1 = computeDerivedFields(base, cpt, 'general', 1, null)
    const lost1 = base.qualityBy.coding - d1.qualityBy.coding
    const deep = deeper(base, d1, 'cpt', 'general')
    const d2 = computeDerivedFields(deep, cpt, 'general', 1, null)
    const lost2 = deep.qualityBy.coding - d2.qualityBy.coding
    expect(lost1).toBeGreaterThanOrEqual(2.5)
    expect(lost2).toBeGreaterThan(lost1)
    const lora = computeDerivedFields(base, METHOD_RECIPES.lora, 'general', 1, null)
    expect(base.qualityBy.coding - lora.qualityBy.coding).toBeLessThan(lost1 / 3)
  })

  it('a merge needs two DISTINCT checkpoints of one base and blends their alignment (order-independent)', () => {
    const s = rich(22)
    tryBuild(s, 'lab', 2, 4)
    for (const c of [3, 8, 14]) tryBuild(s, 'srv_frontier', c, 2)
    for (const t of s.towers) t.online = true
    s.upgrades.pt_lora = 1
    s.upgrades.pt_merge = 1
    s.upgrades.pt_cai = 1
    const base = 'qwen35_122b'
    const other = MODEL_LIST.find((m) => m.id !== base && m.paramsTotalB !== MODEL_DEFS[base].paramsTotalB)!
    // no partner / self / a different base → refused with the reason
    expect(mergeBlock(s, base, undefined)).toBe('missing')
    expect(mergeBlock(s, base, base)).toBe('self')
    expect(mergeBlock(s, base, other.id)).toBe('root')
    expect(canPostTrain(s, [base, base], 'merge', 'general')).toBe(false)
    expect(canPostTrain(s, [base, other.id], 'merge', 'general')).toBe(false)
    expect(explainRejection(s, 'postTrain', [[base, base], 'merge', 'general', 1])).toMatch(/DIFFERENT/)
    expect(explainRejection(s, 'postTrain', [[base, other.id], 'merge', 'general', 1])).toMatch(/same base/)
    expect(METHOD_RECIPES.merge.allowedTargets).toEqual(['general'])
    expect(METHOD_RECIPES.merge.costData).toBeGreaterThan(0)
    // two checkpoints of the same base: a coding LoRA and a safety CAI
    const finish = () => {
      for (let t = 0; s.research.posttrain && t < 400; t += SIM_DT) updateResearch(s, SIM_DT)
      s.phase = 'build'
    }
    s.phase = 'build'
    expect(startPostTrain(s, [base], 'lora', 'coding', 1)).toBe(true)
    finish()
    expect(startPostTrain(s, [base], 'cai', 'safety', 1)).toBe(true)
    finish()
    const a = s.derivedModels.drv_0
    const b = s.derivedModels.drv_1
    expect(mergeBlock(s, a.id, b.id)).toBeNull()
    const ab = computeDerivedFields(a, METHOD_RECIPES.merge, 'general', 1, b)
    const ba = computeDerivedFields(b, METHOD_RECIPES.merge, 'general', 1, a)
    expect(ab.alignment.safety).toBeCloseTo((a.alignment.safety + b.alignment.safety) / 2, 9)
    expect(ab.alignment.overRefusal).toBeCloseTo((a.alignment.overRefusal + b.alignment.overRefusal) / 2, 9)
    expect(ba.alignment.safety).toBeCloseTo(ab.alignment.safety, 9)
    expect(ab.alignment.refusalStyle).toBe(ba.alignment.refusalStyle)
    expect(ab.paramsTotalB).toBe(MODEL_DEFS[base].paramsTotalB)
    // a merge with a stale partner id cannot be derived
    expect(
      deriveModel(s, {
        baseIds: [a.id, base + '_nope'],
        method: 'merge',
        target: 'general',
        effort: 1,
      } as never),
    ).toBeNull()
    expect(resolveModel(s, a.id)).toBeDefined()
  })
})

/* ------------------------------------------------------------------ */

describe('power and cooling: generative guards draw kW, two cooling pools, grid incidents', () => {
  it("Llama Guard's own GPU rack shows on the power and cooling budget", () => {
    const s = rich(31)
    updatePower(s)
    const used0 = s.power.used
    expect(tryBuild(s, 'guard_llm', 8, 4)).toBe(true)
    updatePower(s)
    const g = lastTower(s)
    expect(towerPowerKw(s, g)).toBeGreaterThan(0.3)
    expect(s.power.used - used0).toBeCloseTo(towerPowerKw(s, g), 2)
    expect(s.cooling.used).toBeGreaterThan(0.3)
  })

  it('the DGX nodes are air-cooled; only the NVL72 needs the loop, and loop kW cannot cool an air rack', () => {
    expect(HARDWARE_DEFS.hw_pod.cooling).toBe('air')
    expect(HARDWARE_DEFS.hw_superpod.cooling).toBe('air')
    expect(HARDWARE_DEFS.hw_giga.cooling).toBe('liquid')
    const s = rich(32)
    for (const c of [2, 4, 6]) expect(tryBuild(s, 'power', c, 4)).toBe(true)
    const dgx = (col: number) => {
      expect(tryBuild(s, 'srv_frontier', col, 2)).toBe(true)
      const r = lastTower(s)
      expect(upgradeHardware(s, r.id)).toBe(true)
      expect(upgradeHardware(s, r.id)).toBe(true) // → DGX B200, air-cooled
      return r
    }
    const t = dgx(3)
    dgx(8) // two DGX B200s: more air heat than the house chillers reject
    updatePower(s)
    expect(coolingPools(s).air.used).toBeGreaterThan(START.baseCooling)
    expect(t.throttle).toBeLessThan(1) // the house chillers alone cannot reject it
    // a Liquid Loop adds 60 kW of LIQUID capacity: the aggregate looks fine, the air rack stays hot
    expect(tryBuild(s, 'cooling_liquid', 8, 4)).toBe(true)
    updatePower(s)
    expect(s.cooling.cap).toBeGreaterThan(s.cooling.used)
    expect(isThrottling(s)).toBe(true)
    expect(t.throttle).toBeLessThan(1)
    // Cooling Towers are what an air rack needs
    for (const c of [10, 12]) expect(tryBuild(s, 'cooling', c, 4)).toBe(true)
    updatePower(s)
    expect(coolingPools(s).air.cap).toBeGreaterThanOrEqual(coolingPools(s).air.used)
    expect(t.throttle).toBe(1)
    expect(coolingPools(s).liquid.used).toBe(0)
  })

  it('a grid curtailment order cuts usable power (racks brown out); a freeze blocks new Power Plants', () => {
    const s = rich(33)
    for (const c of [3, 8, 14, 20]) expect(tryBuild(s, 'srv_frontier', c, 2)).toBe(true)
    updatePower(s)
    const cap0 = s.power.cap
    const curtail = INCIDENTS.find((i) => i.id === 'inc_grid_curtailment')!
    expect(curtail.mods.powerCap).toBeLessThan(1)
    expect(curtail.mods.powerPrice).toBeGreaterThan(1) // the rest runs on costlier backup generation
    s.modifiers.powerCap = curtail.mods.powerCap!
    updatePower(s)
    expect(s.power.cap).toBeCloseTo(cap0 * curtail.mods.powerCap!, 2)
    const freeze = INCIDENTS.find((i) => i.id === 'inc_interconnect_queue')!
    s.modifiers.powerBuild = freeze.mods.powerBuild!
    expect(powerBuildOpen(s)).toBe(false)
    expect(tryBuild(s, 'power', 5, 4)).toBe(false)
    expect(explainRejection(s, 'build', ['power', 5, 4])).toMatch(/interconnection freeze/)
    expect(tryBuild(s, 'srv_edge', 6, 6)).toBe(true) // only new generation is frozen
    // the agent snapshot carries the live modifiers and the liquid pool
    const snap = serializeState(s)
    expect(snap.modifiers.powerCap).toBeCloseTo(curtail.mods.powerCap!, 9)
    expect(snap.modifiers.powerBuild).toBe(0)
    expect(snap.coolingLiquid).toEqual({ used: 0, cap: 0 })
  })

  it('Enterprise Demo Day pays a premium AND sharpens every SLA penalty', () => {
    const demo = INCIDENTS.find((i) => i.id === 'inc_enterprise_demo')!
    expect(demo.mods.reward).toBeGreaterThan(1)
    expect(demo.mods.slaDamage).toBeGreaterThan(1)
    const drop = (slaDamage: number): number => {
      const s = createState(34)
      s.phase = 'wave'
      s.modifiers.slaDamage = slaDamage
      s.meters.sla = 100
      const r = spawnRequest(s, 'chat')
      resolveOutcome(s, r, 'sloMiss')
      return 100 - s.meters.sla
    }
    expect(drop(demo.mods.slaDamage!)).toBeCloseTo(drop(1) * demo.mods.slaDamage!, 9)
  })
})

/* ------------------------------------------------------------------ */

describe('era hazard pressure: severity climbs with tier and novel attacks dodge classifiers', () => {
  it('hazard severity and the novel share rise monotonically with tier (none in early 2023)', () => {
    expect(hazardMulOf(1)).toBe(1)
    expect(novelShareOf(1)).toBe(0)
    expect(novelShareOf(2)).toBe(0)
    for (let t = 1; t < MAX_TIER; t++) {
      expect(hazardMulOf(t + 1)).toBeGreaterThanOrEqual(hazardMulOf(t))
      expect(novelShareOf(t + 1)).toBeGreaterThanOrEqual(novelShareOf(t))
    }
    expect(hazardMulOf(MAX_TIER)).toBeGreaterThan(1.3)
    expect(novelShareOf(MAX_TIER)).toBeCloseTo(0.5, 9)
  })

  it('a late jailbreak lands harder than an early one, clamped at severity 1', () => {
    const jb = (wi: number) => WAVES[wi].groups.find((g) => g.typeId === 'jailbreak')!
    const early = jb(3) // W4 The DAN Jailbreak Wave
    const late = jb(99)
    expect(late.hazardMul!).toBeGreaterThan(early.hazardMul!)
    const s = createState(41)
    const a = spawnRequest(s, 'jailbreak', 1, 1, 1, 1, 1, 0, { hazardMul: early.hazardMul })
    const b = spawnRequest(s, 'jailbreak', 1, 1, 1, 1, 1, 0, { hazardMul: late.hazardMul })
    expect(b.hazards.jailbreak!).toBeGreaterThan(a.hazards.jailbreak!)
    expect(b.hazards.jailbreak!).toBeLessThanOrEqual(1)
    expect(escalatedHazards({ injection: 0.3, jailbreak: 0.9 }, 2)).toEqual({ injection: 0.6, jailbreak: 1 })
  })

  it('novelty is assigned by spawn order (no RNG) and only to hazardous requests', () => {
    let n = 0
    for (let k = 0; k < 100; k++) if (isNovelAt(k, 0.3)) n++
    expect(n).toBe(30)
    for (let k = 0; k < 50; k++) expect(isNovelAt(k, 0)).toBe(false)
    const s = createState(42)
    const rng0 = JSON.stringify(s.rng)
    expect(spawnRequest(s, 'chat', 1, 1, 1, 1, 1, 0, { novel: true }).novel).toBe(false)
    expect(spawnRequest(s, 'jailbreak', 1, 1, 1, 1, 1, 0, { novel: true }).novel).toBe(true)
    expect(JSON.stringify(s.rng)).toBe(rng0)
  })

  it('an encoder guard misses most novel attacks; a generative judge does not', () => {
    const catches = (guard: string, novel: boolean): number => {
      const s = rich(43)
      expect(tryBuild(s, guard, 6, 0)).toBe(true)
      updatePower(s)
      s.phase = 'wave'
      const stages = laneGuardStages(s)[0]
      expect(stages.length).toBe(1)
      let caught = 0
      for (let i = 0; i < 400; i++) {
        const r: Request = spawnRequest(s, 'jailbreak', 1, 1, 1, 1, 1, 0, { novel })
        screenInput(s, r, stages)
        if (r.hazardsOpen.jailbreak === undefined) caught++
      }
      return caught / 400
    }
    const encKnown = catches('guard_encoder', false)
    const encNovel = catches('guard_encoder', true)
    expect(encNovel).toBeLessThan(encKnown * (NOVEL_RECALL_MUL.encoder + 0.12))
    expect(encNovel).toBeGreaterThan(encKnown * (NOVEL_RECALL_MUL.encoder - 0.12))
    const genKnown = catches('guard_llm', false)
    const genNovel = catches('guard_llm', true)
    expect(Math.abs(genNovel - genKnown)).toBeLessThan(0.06)
  })

  it('an authored wave can arm a lane its event weaponised, and the preview shows the real profile', () => {
    const rag = WAVES[65].groups.find((g) => g.typeId === 'rag')! // W66 The Zero-Click Exfiltration
    expect(rag.hazards?.injection).toBeGreaterThan(0)
    const s = createState(44)
    startGame(s)
    s.waveIndex = 64
    const p = previewNextWave(s)!
    const e = p.entries.find((x) => x.typeId === 'rag')!
    expect(e.hazards).toContain('injection')
    expect(e.hazardSeverity.injection).toBeCloseTo(Math.min(1, 0.3 * rag.hazardMul!), 9)
    expect(e.novelShare).toBeCloseTo(rag.novelShare!, 9)
    expect(p.clearBonus).toBe(contractPayout(WAVES[65].clearBonus, 100))
  })
})

/* ------------------------------------------------------------------ */

describe('campaign: verified late waves, incident mapping, boss teeth', () => {
  it('stays a monotonic 1→12 tier gauntlet with every era dated (no "near-future" rows)', () => {
    expect(CAMPAIGN_THEMES.length).toBe(100)
    for (let i = 1; i < CAMPAIGN_THEMES.length; i++)
      expect(CAMPAIGN_THEMES[i].tier).toBeGreaterThanOrEqual(CAMPAIGN_THEMES[i - 1].tier)
    for (const th of CAMPAIGN_THEMES) expect(th.era).toMatch(/^20\d\d( Q[1-4])?$/)
    for (let i = 94; i < 100; i++) {
      expect(CAMPAIGN_THEMES[i].tier).toBe(12)
      expect(CAMPAIGN_THEMES[i].volume).toBe('extreme')
      expect(CAMPAIGN_THEMES[i].era).toBe('2026 Q3')
    }
    expect(CAMPAIGN_THEMES[99].boss).toBe(true)
  })

  it('themed waves force the incident they are named for', () => {
    for (const th of CAMPAIGN_THEMES)
      if (th.incident) expect(INCIDENTS.some((i) => i.id === th.incident)).toBe(true)
    const want: Record<number, string> = {
      13: 'inc_water_drought', // W14 Phoenix
      14: 'inc_grid_curtailment', // W15 Texas heatwave
      34: 'inc_interconnect_queue', // W35 Interconnection Wall
      37: 'inc_crowdstrike', // W38 CrowdStrike (still a surge)
      45: 'inc_interconnect_queue', // W46 Power, Not Chips
      79: 'inc_cloudflare_outage', // W80 Cloudflare (still a surge)
      81: 'inc_data_poisoning', // W82 Poison in the Corpus
      83: 'inc_water_drought', // W84 Water Meets Drought
      87: 'inc_gas_turbine_spike', // W88 Turbines on Trial
      93: 'inc_hbm_soldout', // W94 HBM squeeze
      94: 'inc_grid_curtailment', // W95 PJM heat wave
      95: 'inc_jailbreak_storm', // W96 the agent sandbox breakout
      96: 'inc_regulatory_audit', // W97 AI Act Article 50
      98: 'inc_price_war', // W99 the half-price frontier
    }
    for (const [i, id] of Object.entries(want)) expect(themedIncidentForWave(Number(i))).toBe(id)
    // W21 names prompt injection and its Red-Team prerequisite
    expect(CAMPAIGN_THEMES[20].brief).toMatch(/injection/)
    expect(CAMPAIGN_THEMES[20].teaches).toMatch(/Red-Team/)
    // a named-outage surge keeps its structural single-lane funnel
    for (const i of [37, 79]) {
      const lanes = new Set(WAVES[i].groups.map((g) => g.lane))
      expect(lanes.size).toBe(1)
      expect([...lanes][0]).toBeDefined()
    }
  })

  it('a boss wave carries a bigger budget and, without a signature incident, a forced hard one', () => {
    const th = CAMPAIGN_THEMES[49]
    expect(th.boss).toBe(true)
    const boss = buildWave(th).groups.reduce((n, g) => n + g.count, 0)
    const plain = buildWave({ ...th, boss: false }).groups.reduce((n, g) => n + g.count, 0)
    expect(boss / plain).toBeGreaterThan(1.15)
    expect(waveBudget(th.tier, th.volume, true)).toBeGreaterThan(waveBudget(th.tier, th.volume))
    const unthemedBosses = CAMPAIGN_THEMES.map((t, i) => ({ t, i })).filter(
      (x) => x.t.boss && !themedIncidentForWave(x.i),
    )
    expect(unthemedBosses.length).toBeGreaterThan(0)
    for (const { i } of unthemedBosses) {
      for (const seed of [1, 2, 3]) {
        const s = createState(seed)
        s.waveIndex = i - 1
        rollIncident(s)
        expect(s.pendingIncident).not.toBeNull()
        expect(s.pendingIncident!.good ?? false).toBe(false)
        expect(s.pendingIncident!.concentrate).toBeUndefined()
      }
    }
  })

  it('winning clears the telegraphed incident; continuing into endless telegraphs a fresh one', () => {
    const s = createState(61)
    startGame(s)
    s.waveIndex = WAVES.length - 1
    s.currentWave = WAVES[WAVES.length - 1]
    s.pendingIncident = INCIDENTS[0]
    s.phase = 'wave'
    s.waveActive = true
    s.spawns = []
    s.requests = []
    s.waveStats = newWaveStats(s.waveIndex)
    step(s)
    expect(s.phase).toBe('won')
    expect(s.pendingIncident).toBeNull()
    let rolled = 0
    for (const seed of [62, 63, 64, 65, 66, 67, 68, 69]) {
      const e = createState(seed)
      e.phase = 'won'
      e.waveIndex = WAVES.length - 1
      expect(continueEndless(e)).toBe(true)
      if (e.pendingIncident) {
        rolled++
        expect(e.events.some((ev) => ev.type === 'incident')).toBe(true)
      }
    }
    expect(rolled).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */

describe('endless resumes at the wave-100 load', () => {
  it('every surge-1 burst is at least as heavy, long and hard as wave 100 for its archetype', () => {
    const w100 = WAVES[WAVES.length - 1]
    const total100 = w100.groups.reduce((n, g) => n + g.count, 0)
    for (const seed of [1, 7, 42, 99, 2026]) {
      const s = createState(seed)
      s.endless = true
      s.waveIndex = WAVES.length // surge 1
      const w = generateEndlessWave(s)
      for (const g of w.groups) {
        const ref = groupMuls(MAX_TIER, g.typeId)
        expect(g.workMul!).toBeGreaterThanOrEqual(ref.workMul)
        expect(g.contextMul!).toBeGreaterThanOrEqual(ref.contextMul)
        expect(g.complexityMul!).toBeGreaterThanOrEqual(ref.complexityMul)
        expect(g.hazardMul!).toBeGreaterThanOrEqual(hazardMulOf(MAX_TIER))
        const at100 = w100.groups.find((x) => x.typeId === g.typeId)
        if (at100) {
          expect(g.workMul!).toBeGreaterThanOrEqual(at100.workMul!)
          expect(g.contextMul!).toBeGreaterThanOrEqual(at100.contextMul!)
          expect(g.complexityMul!).toBeGreaterThanOrEqual(at100.complexityMul!)
        }
      }
      expect(w.groups.reduce((n, g) => n + g.count, 0)).toBeGreaterThanOrEqual(Math.round(total100 * 0.95))
      expect(w.groups.some((g) => g.typeId === 'reason' || g.typeId === 'agent')).toBe(true)
      expect(w.clearBonus).toBeGreaterThanOrEqual(tierBonus(MAX_TIER, false))
    }
  })

  it('every generated surge is well-formed and carries a hard lane (reason or agent)', () => {
    for (const seed of [1, 7, 42, 2026, 31337]) {
      const s = createState(seed)
      s.endless = true
      for (let d = 0; d < 40; d++) {
        s.waveIndex = WAVES.length + d
        const w = generateEndlessWave(s)
        expect(w.groups.every((g) => !!g.typeId && g.count > 0)).toBe(true)
        expect(w.groups.some((g) => g.typeId === 'reason' || g.typeId === 'agent')).toBe(true)
      }
    }
  })

  it('climbs past wave 100: volume and work every surge, quality lines after a short grace', () => {
    const at = (d: number) => endlessScaling(WAVES.length - 1 + d)
    expect(at(1).complexity).toBeCloseTo(groupMuls(MAX_TIER, 'chat').complexityMul, 9)
    expect(at(3).complexity).toBeGreaterThan(at(1).complexity)
    for (let d = 1; d < 30; d++) {
      expect(at(d + 1).count).toBeGreaterThan(at(d).count)
      expect(at(d + 1).work).toBeGreaterThan(at(d).work)
      expect(at(d + 1).complexity).toBeGreaterThanOrEqual(at(d).complexity)
    }
    // the hard-lane quality line hardens slowly (additive), never as a compounding cliff
    expect(at(20).complexity - at(1).complexity).toBeLessThan(0.25)
  })
})
