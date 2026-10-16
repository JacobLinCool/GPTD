import { describe, expect, it } from 'vitest'
import { CREDIT_USD, MBU_DECODE, MFU_DECODE, SIM_DT, STEP_OVERHEAD_MS, TRAFFIC_SCALE } from '../src/config'
import { createState } from '../src/sim/state'
import { loadout, loadoutOf, rackHourlyUsd, rackLoadEstimate, rackPlan, spritesPerLane, towerOpexPerSec } from '../src/sim/effects'
import {
  dollarsPerMtoken,
  effectiveBatch,
  ESTIMATE_SPRITES_PER_LANE,
  fleetMetrics,
  fmtDollarsPerMtoken,
  fmtLatencyMs,
  fmtTokS,
  latencyOf,
  rackDollarsPerMtoken,
  REF_IN_TOKENS,
  REF_OUT_TOKENS,
  rooflineOf,
  sparsityOf,
  vramOf,
} from '../src/ui/metrics'
import { decodeTokSb1, serverFitsMemory } from '../src/sim/effects'
import { finalizeReport, goodputPctOf, newWaveStats } from '../src/sim/telemetry'
import { startGame, tryBuild, upgradeHardware, deployModel } from '../src/sim/actions'
import { spawnRequest } from '../src/sim/spawn'
import { updateCombat } from '../src/sim/combat'

/**
 * Bring s.infra to the modern serving era (continuous batching + paged KV + FP8)
 * so a 31B fits a single 80 GB H100 and the metrics match a real deploy.
 */
import { INFRA_NODES, MODEL_DEFS } from '../src/sim/content'
import { applyInfraEffects } from '../src/sim/research'
function modernEra(s: ReturnType<typeof createState>): void {
  for (const id of ['inf_batching', 'inf_paged', 'inf_wq_fp8']) {
    applyInfraEffects(s, INFRA_NODES[id].effects)
    s.upgrades[id] = 1
  }
}

const H100 = 'hw_perf' // 989 bf16 / 1979 fp8 TFLOPS, 80 GB, 3.35 TB/s, $3/GPU-hr
const BIG = 'g_gemma_4_31b_2' // 31B dense (the largest dense model in the active roster)
const INSTANT = 'g_nvidia_nemotron_3_nano_4b_2' // a non-thinking 4B

/** The sprites a busy rack holds in the estimates (ESTIMATE_SPRITES_PER_LANE per lane). */
function busy(s: ReturnType<typeof createState>, lo: ReturnType<typeof loadout>): number {
  return rackPlan(s, lo).lanes * Math.min(spritesPerLane(s), ESTIMATE_SPRITES_PER_LANE)
}

describe('ui/metrics — worked-example parity (§5.7 / §5.8)', () => {
  it('H100 / 31B FP8 deployed: roofline matches the §5.7 physics', () => {
    const s = createState(1)
    modernEra(s) // FP8 → 1 byte/param, 31B (≈31 GB) fits an 80 GB H100
    const lo = loadout(s, H100, BIG)
    const rf = rooflineOf(s, lo)
    const m = MODEL_DEFS[BIG]
    expect(rf.fits).toBe(true)
    // one stream reads the active weights once per token at HBM bandwidth × MBU (+ the step overhead)
    const stepSec = (m.paramsActiveB * 1e9 * 1) / (3.35e12 * MBU_DECODE) + STEP_OVERHEAD_MS / 1000
    expect(rf.decodeTokSb1).toBeCloseTo(1 / stepSec, 6)
    // the compute roof uses the FP8 tensor rate at decode MFU: 1979e12 × MFU / (2 × activeB)
    expect(rf.computeRoofTokS).toBeCloseTo((1979e12 * MFU_DECODE) / (2 * m.paramsActiveB * 1e9), 3)
    // a busy 31B rack is still bound by HBM reads (weights + every stream's KV), not compute
    expect(rf.binding).toBe('bandwidth')
    expect(rf.plan.g).toBe(1)
  })

  it('the sim getter is the §5.7 formula: activeB × bytes / (BW × MBU) per token at batch 1', () => {
    const s = createState(11)
    modernEra(s)
    const m = MODEL_DEFS[BIG]
    const fp8 = 1 / ((m.paramsActiveB * 1e9 * 1) / (3.35e12 * MBU_DECODE) + STEP_OVERHEAD_MS / 1000)
    expect(decodeTokSb1(s, loadout(s, H100, BIG))).toBeCloseTo(fp8, 6)
    // the canonical 70B-on-H100 figure: 3.35 TB/s × 0.7 / 140 GB (BF16) ≈ 17 tok/s for one user
    expect((3.35e12 * MBU_DECODE) / (70e9 * 2)).toBeCloseTo(16.75, 1)
  })

  it('$3/GPU-hr at 500 tok/s ≈ $1.67/Mtoken (§5.8)', () => {
    // $/Mtoken = ($/hour × 1e6) / (aggTokS × 3600) = (3×1e6)/(500×3600) ≈ 1.667
    const dpm = dollarsPerMtoken(3, 500)
    expect(dpm).toBeCloseTo(1.667, 2)
    // monotonic: halve throughput → double unit cost.
    expect(dollarsPerMtoken(3, 250)).toBeCloseTo(dpm * 2, 6)
    expect(dollarsPerMtoken(3, 0)).toBe(Infinity)
  })

  it('rackDollarsPerMtoken is the ($/hour × 1e6)/(aggTokS × 3600) identity on a busy rack', () => {
    const s = createState(2)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    expect(serverFitsMemory(s, lo)).toBe(true)
    const agg = latencyOf(s, lo, REF_IN_TOKENS, REF_OUT_TOKENS).aggDecodeTokS
    const expected = (rackHourlyUsd(s, lo, 1) * 1e6) / (agg * 3600)
    expect(rackDollarsPerMtoken(s, lo)).toBeCloseTo(expected, 9)
  })

  it('the $/Mtoken a rack card shows is the rate its cash flow obeys (the cohort identity)', () => {
    // keep one H100 busy with the representative request and measure what the bill
    // actually cost per generated token, against the card's number
    const s = createState(3)
    modernEra(s)
    s.meters.cash = 1e9
    startGame(s)
    tryBuild(s, 'srv_edge', 1, 2)
    const t = s.towers[s.towers.length - 1]
    upgradeHardware(s, t.id)
    upgradeHardware(s, t.id) // → H100
    deployModel(s, t.id, INSTANT)
    s.phase = 'wave'
    s.waveActive = true
    s.waveStats = newWaveStats(0)
    const model = MODEL_DEFS[INSTANT]
    const lo = loadoutOf(s, t)
    const want = busy(s, lo)
    let usd = 0
    let tokens = 0
    const seen = new Map<number, number>()
    const calm = { ...model.alignment, overRefusal: 0 }
    const saved = model.alignment
    model.alignment = calm
    try {
      for (let i = 0; i < 1500; i++) {
        while (s.requests.filter((r) => r.alive).length < want) {
          const r = spawnRequest(s, 'chat')
          r.speed = 0 // parked at the ingress, in the rack's range
          r.tokensIn = r.prefill = r.contextLen = REF_IN_TOKENS
          r.tokensOut = r.work = r.maxWork = REF_OUT_TOKENS
        }
        updateCombat(s, SIM_DT)
        s.time += SIM_DT
        const op = towerOpexPerSec(s, t, 1)
        if (i >= 300) usd += (op.gpu + op.energy) * SIM_DT * CREDIT_USD
        for (const r of s.requests) {
          const g = r.maxWork - Math.max(0, r.work)
          if (i >= 300) tokens += g - (seen.get(r.id) ?? 0)
          seen.set(r.id, g)
        }
        s.requests = s.requests.filter((r) => r.alive)
      }
    } finally {
      model.alignment = saved
    }
    const effective = (usd / (tokens * TRAFFIC_SCALE)) * 1e6
    const shown = rackDollarsPerMtoken(s, lo)
    // within the tick granularity (a finished sprite frees its slot at the next tick)
    expect(effective / shown).toBeGreaterThan(0.85)
    expect(effective / shown).toBeLessThan(1.15)
  })
})

describe('ui/metrics — latency parity with the sim', () => {
  it('tpotMs = 1000 / the per-user decode rate of a busy rack', () => {
    const s = createState(3)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    const inTok = 512
    const outTok = 256
    const lat = latencyOf(s, lo, inTok, outTok)
    const est = rackLoadEstimate(s, lo, busy(s, lo), inTok + outTok / 2, { inputTokens: inTok, outputTokens: outTok })
    expect(lat.tpotMs).toBeCloseTo(1000 / est.perUserTokS, 6)
    // e2el = ttft + (out−1)×tpot (the §0.4 chain)
    expect(lat.e2elMs).toBeCloseTo(lat.ttftMs + (outTok - 1) * lat.tpotMs, 6)
    expect(lat.batch).toBe(Math.round(est.streams))
    expect(lat.batch).toBe(effectiveBatch(s, lo, inTok + outTok / 2))
  })

  it('per-user decode rate equals aggregate / streams (§5.7)', () => {
    const s = createState(4)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    const lat = latencyOf(s, lo, 512, 256)
    expect(lat.perUserDecodeTokS).toBeCloseTo(lat.aggDecodeTokS / lat.batch, 3)
  })
})

describe('ui/metrics — VRAM / sparsity', () => {
  it('VRAM breakdown sums to total HBM', () => {
    const s = createState(5)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    const v = vramOf(s, lo)
    expect(v.weightsGb + v.frameworkGb + v.kvFreeGb + v.headroomGb).toBeCloseTo(v.totalGb, 5)
    // FP8 31B = ~31 GB weights on an 80 GB card.
    expect(v.weightsGb).toBeCloseTo(31, 0)
    expect(v.totalGb).toBe(80)
  })
  it('dense model has sparsity ratio 1, MoE far below', () => {
    const s = createState(6)
    expect(sparsityOf(loadout(s, H100, BIG)).ratio).toBeCloseTo(1, 6)
    const moe = sparsityOf(loadout(s, H100, 'g_nemotron_cascade_2_30b_a3b_2'))
    expect(moe.isMoE).toBe(true)
    expect(moe.ratio).toBeLessThan(0.2) // 3.2 active / 31.6 total
  })
})

describe('ui/metrics — formatting', () => {
  it('fmtTokS / fmtLatencyMs / fmtDollarsPerMtoken render units', () => {
    expect(fmtTokS(12.34)).toBe('12.3')
    expect(fmtTokS(765)).toBe('765')
    expect(fmtTokS(15000)).toBe('15.0k')
    expect(fmtLatencyMs(250)).toBe('250 ms')
    expect(fmtLatencyMs(2500)).toBe('2.50 s')
    expect(fmtDollarsPerMtoken(1.67)).toBe('$1.67')
    expect(fmtDollarsPerMtoken(0.05)).toBe('$0.050')
  })
})

describe('ui/metrics — Goodput parity with the wave report', () => {
  it('the live gauge and the settled report use the one honest formula (every outcome in the denominator)', () => {
    const s = createState(5)
    const ws = newWaveStats(0)
    ws.served = 2
    ws.goodput = 2
    ws.leaked = 6
    ws.overRefused = 1
    ws.total = 9
    ws.answered = 2
    ws.answeredInSlo = 2
    s.waveStats = ws
    const live = fleetMetrics(s).goodputPct
    expect(live).toBeCloseTo((2 / 9) * 100, 9) // 2 clean serves of 9 requests — not 100% of the 2 answered
    expect(live).toBe(goodputPctOf(ws))
    const rep = finalizeReport(s, 0)!
    expect(rep.goodputPct).toBe(live)
    expect(rep.sloAttainPct).toBe(100) // the secondary view: every ANSWERED request was on time
  })
})
