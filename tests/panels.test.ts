/**
 * The read-only decision helpers behind the inspect panel, deploy picker, wave
 * report and request inspector (src/ui/metrics.ts). They must agree with the sim
 * they describe and never mutate it.
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/core/types'
import { deployModel, startWave, tryBuild, upgradeHardware } from '../src/sim/actions'
import { DEFAULT_MODEL_ID, HARDWARE_DEFS, MODEL_LIST, REQUEST_TYPES, WAVES } from '../src/sim/content'
import { loadout, loadoutOf, serverFitsMemory, serverQualityVs } from '../src/sim/effects'
import { pSelfHandle } from '../src/sim/safety'
import { spawnRequest } from '../src/sim/spawn'
import { createState } from '../src/sim/state'
import {
  deployCandidates,
  diagnoseRequest,
  guardStats,
  honestGoodputPct,
  hwUpgradeDelta,
  rolloutTargets,
  sameTierTargets,
  selfHandleRate,
  smallestRackFor,
  terminalTotal,
  typeFit,
  upcomingTraffic,
  upgradeAllPlan,
} from '../src/ui/metrics'

function buildPhase(seed = 7): GameState {
  const s = createState(seed)
  s.phase = 'build'
  s.meters.cash = 100000
  return s
}

const lastTower = (s: GameState) => s.towers[s.towers.length - 1]

describe('ui/metrics — honest Goodput', () => {
  it('counts every terminal outcome in the denominator', () => {
    const c = { served: 6, sloMiss: 0, bad: 0, unsafe: 0, overRefused: 3, unservable: 0, leaked: 0 }
    expect(terminalTotal(c)).toBe(9)
    expect(honestGoodputPct(c)).toBeCloseTo(66.67, 1)
    expect(honestGoodputPct({ ...c, served: 0, overRefused: 0 })).toBe(100)
    expect(honestGoodputPct({ ...c, served: 2, overRefused: 1, leaked: 6 })).toBeCloseTo(22.2, 1)
  })
})

describe('ui/metrics — upcoming traffic', () => {
  it('previews the next authored wave in the build phase with spawn-time scaling', () => {
    const s = buildPhase()
    const tr = upcomingTraffic(s)!
    expect(tr.live).toBe(false)
    expect(tr.waveIndex).toBe(0)
    const groups = WAVES[0].groups
    expect(tr.total).toBe(groups.reduce((n, g) => n + Math.max(1, Math.round(g.count)), 0))
    for (const e of tr.entries) {
      const g = groups.find((x) => x.typeId === e.def.id)!
      expect(e.difficulty).toBeCloseTo((e.def.difficulty[e.def.primaryAxis] ?? 0) * (g.complexityMul ?? 1), 6)
    }
  })

  it('describes the wave being served once it starts', () => {
    const s = buildPhase()
    expect(startWave(s)).toBe(true)
    const tr = upcomingTraffic(s)!
    expect(tr.live).toBe(true)
    expect(tr.waveIndex).toBe(s.waveIndex)
  })
})

describe('ui/metrics — per-archetype fit and the deploy picker', () => {
  it('a slow dense model on an L4 misses the interactive per-token bound', () => {
    const s = buildPhase()
    const dense = MODEL_LIST.filter((m) => !m.isMoE && m.paramsActiveB >= 8 && serverFitsMemory(s, loadout(s, 'hw_edge', m.id)))
    expect(dense.length).toBeGreaterThan(0)
    const chat = { def: REQUEST_TYPES.chat, count: 1, difficulty: 18, context: 8, inputTokens: 512, outputTokens: 256 }
    const fit = typeFit(s, loadout(s, 'hw_edge', dense[0].id), chat)
    expect(fit.fast).toBe(false)
    expect(fit.slowBy).toBe('tpot')
    // the same model on an H100 keeps up
    expect(typeFit(s, loadout(s, 'hw_perf', dense[0].id), chat).fast).toBe(true)
  })

  it('scores every owned checkpoint on the rack, marks one ★, and names the rack a big model needs', () => {
    const s = buildPhase()
    expect(tryBuild(s, 'srv_edge', 2, 2)).toBe(true)
    const tw = lastTower(s)
    const cands = deployCandidates(s, tw, upcomingTraffic(s))
    expect(cands.length).toBe(Object.keys(s.models).length)
    const fits = cands.filter((c) => c.fits)
    const rec = cands.filter((c) => c.recommended)
    expect(rec.length).toBe(1)
    expect(rec[0].fits).toBe(true)
    for (const c of fits) expect(c.score).toBeLessThanOrEqual(rec[0].score)
    const big = cands.find((c) => !c.fits)!
    expect(big.needHw).toEqual(smallestRackFor(s, big.model))
    expect(big.needGb).toBeGreaterThan(HARDWARE_DEFS.hw_edge.hbmGb)
    expect(cands.find((c) => c.current)?.model.id).toBe(DEFAULT_MODEL_ID)
  })

  it('bulk targets walk racks in id order and skip racks that already run the model or cannot hold it', () => {
    const s = buildPhase()
    for (const col of [2, 4, 6]) expect(tryBuild(s, 'srv_edge', col, 2)).toBe(true)
    expect(tryBuild(s, 'srv_frontier', 8, 2)).toBe(true)
    const [a, b, c, f] = s.towers
    const small = MODEL_LIST.find((m) => m.id !== DEFAULT_MODEL_ID && serverFitsMemory(s, loadout(s, 'hw_edge', m.id)))!
    expect(sameTierTargets(s, a, small.id).map((t) => t.id)).toEqual([a.id, b.id, c.id])
    expect(deployModel(s, b.id, small.id)).toBe(true)
    expect(sameTierTargets(s, a, small.id).map((t) => t.id)).toEqual([a.id, c.id])
    expect(rolloutTargets(s, small.id).map((t) => t.id)).toEqual([a.id, c.id, f.id])
    const huge = MODEL_LIST.find((m) => !serverFitsMemory(s, loadout(s, 'hw_edge', m.id)) && serverFitsMemory(s, loadout(s, 'hw_frontier', m.id)))
    if (huge) expect(rolloutTargets(s, huge.id).map((t) => t.id)).toEqual([f.id])
  })

  it('UPGRADE ALL prices every rack of the tier and counts what the cash covers', () => {
    const s = buildPhase()
    for (const col of [2, 4, 6]) expect(tryBuild(s, 'srv_edge', col, 2)).toBe(true)
    const tw = s.towers[0]
    const plan = upgradeAllPlan(s, tw)!
    expect(plan.ids).toEqual(s.towers.map((t) => t.id))
    expect(plan.total).toBe(plan.each * 3)
    s.meters.cash = plan.each * 2 + 1
    expect(upgradeAllPlan(s, tw)!.affordable).toBe(2)
  })

  it('the RACK → delta reports real memory and a faster decode for the loaded model', () => {
    const s = buildPhase()
    expect(tryBuild(s, 'srv_edge', 2, 2)).toBe(true)
    const tw = lastTower(s)
    const d = hwUpgradeDelta(s, tw)!
    expect(d.from.hbmGb).toBe(HARDWARE_DEFS.hw_edge.hbmGb)
    expect(d.to.hbmGb).toBe(HARDWARE_DEFS.hw_standard.hbmGb)
    expect(d.decodeMul).toBeGreaterThan(1)
    expect(d.kwTo).toBeGreaterThan(d.kwFrom)
    expect(upgradeHardware(s, tw.id)).toBe(true)
    expect(hwUpgradeDelta(s, tw)!.from.id).toBe('hw_standard')
  })
})

describe('ui/metrics — safety readouts', () => {
  it('a guard lists injection as locked until Red-Team Eval', () => {
    const s = buildPhase()
    expect(tryBuild(s, 'guard_encoder', 3, 0)).toBe(true)
    const spec = lastTower(s).def.guardrail!
    expect(guardStats(s, spec).hazards.find((h) => h.hazard === 'injection')?.unlocked).toBe(false)
    s.upgrades.eval_redteam = 1
    expect(guardStats(s, spec).hazards.find((h) => h.hazard === 'injection')?.unlocked).toBe(true)
    expect(guardStats(s, spec).recall).toBeGreaterThan(0)
  })

  it('self-handle rate is the layer-1 chance for the archetype hazards (1 for benign traffic)', () => {
    const m = MODEL_LIST[0]
    expect(selfHandleRate(m, REQUEST_TYPES.chat)).toBe(1)
    expect(selfHandleRate(m, REQUEST_TYPES.jailbreak)).toBeCloseTo(pSelfHandle(m, 'jailbreak', REQUEST_TYPES.jailbreak.hazards!.jailbreak!), 9)
  })
})

describe('ui/metrics — live request diagnosis', () => {
  it('forecasts the outcome and explains an uncatchable hazard without touching the sim', () => {
    const s = buildPhase()
    expect(tryBuild(s, 'srv_edge', 2, 2)).toBe(true)
    expect(startWave(s)).toBe(true)
    const agent = spawnRequest(s, 'agent')
    const before = JSON.stringify({ q: agent.queueSec, w: agent.work, h: agent.hazardsOpen })
    const d = diagnoseRequest(s, agent)
    expect(d.stage === 'queued' || d.stage === 'prefill').toBe(true)
    expect(d.hazards.find((h) => h.hazard === 'injection')?.verdict).toBe('locked')
    expect(d.forecast).toBe('unsafe')
    expect(d.certain).toBe(true)
    expect(JSON.stringify({ q: agent.queueSec, w: agent.work, h: agent.hazardsOpen })).toBe(before)

    const chat = spawnRequest(s, 'chat')
    chat.overRefused = true
    expect(diagnoseRequest(s, chat).forecast).toBe('overRefused')
  })

  it('reads the answering rack quality on the judged axis only', () => {
    const s = buildPhase()
    expect(tryBuild(s, 'srv_edge', 2, 2)).toBe(true)
    const tw = lastTower(s)
    expect(startWave(s)).toBe(true)
    const r = spawnRequest(s, 'comp')
    tw.prefillId = r.id
    const d = diagnoseRequest(s, r)
    expect(d.rack?.id).toBe(tw.id)
    expect(d.rackQ).toBeCloseTo(serverQualityVs(s, loadoutOf(s, tw), 'coding') - d.ctxPenalty, 6)
    expect(d.difficulty).toBe(r.difficulty)
    expect(d.margin).toBeCloseTo(d.rackQ! - r.difficulty, 6)
  })
})
