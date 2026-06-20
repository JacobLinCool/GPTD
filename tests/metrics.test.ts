import { describe, expect, it } from 'vitest'
import { createState } from '../src/sim/state'
import { loadout } from '../src/sim/effects'
import {
  dollarsPerMtoken,
  effectiveBatch,
  fmtDollarsPerMtoken,
  fmtLatencyMs,
  fmtTokS,
  latencyOf,
  rackDollarsPerMtoken,
  rooflineOf,
  sparsityOf,
  vramOf,
} from '../src/ui/metrics'
import { decodeTokSb1, serverAggDecodeTokS, serverPerUserDecodeTokS, serverFitsMemory } from '../src/sim/effects'

/**
 * Bring s.infra to the modern serving era (continuous batching + paged KV + FP8)
 * so a 70B fits a single 80 GB H100 and the metrics match a real deploy.
 */
import { INFRA_NODES } from '../src/sim/content'
import { applyInfraEffects } from '../src/sim/research'
function modernEra(s: ReturnType<typeof createState>): void {
  for (const id of ['inf_batching', 'inf_paged', 'inf_wq_fp8']) {
    applyInfraEffects(s, INFRA_NODES[id].effects)
    s.upgrades[id] = 1
  }
}

const H100 = 'hw_perf' // 989 bf16 / 1979 fp8 TFLOPS, 80 GB, 3.35 TB/s, $3/GPU-hr
const BIG = 'g_gemma_4_31b_2' // 31B dense (the largest dense model in the active roster)

describe('ui/metrics — worked-example parity (§5.7 / §5.8)', () => {
  it('H100 / 31B FP8 deployed: roofline matches the §5.7 physics', () => {
    const s = createState(1)
    modernEra(s) // FP8 → bytesPerParam = 1, 31B (≈31 GB) fits an 80 GB H100
    const lo = loadout(s, H100, BIG)
    const rf = rooflineOf(s, lo)
    expect(rf.fits).toBe(true)
    // decodeTokSb1 = HBM_BW / (2 × activeB × bytes) = 3.35e12 / (2×31e9×1) ≈ 54.0
    // (the §5.7 FP16 doubles at FP8; this is the bytesPerParam halving, §5.6).
    expect(rf.decodeTokSb1).toBeGreaterThan(50)
    expect(rf.decodeTokSb1).toBeLessThan(58)
    // computeRoofTokS uses the FP8 tensor rate 1979e12 / (2×31e9) ≈ 31919 tok/s.
    expect(rf.computeRoofTokS).toBeGreaterThan(30000)
    expect(rf.computeRoofTokS).toBeLessThan(34000)
    // b=1 decode is far below the compute roof → the rack is bandwidth-bound.
    expect(rf.binding).toBe('bandwidth')
  })

  it('§5.7 FP16 raw formula: H100 / 31B decode b=1 ≈ 27 tok/s', () => {
    // The raw §5.7 physics (independent of fit/quant): 3.35e12 / (2×31e9×2) ≈ 27.0.
    const hbmBytesPerSec = 3.35e12
    const activeB = 31
    const bytesFp16 = 2
    const b1 = hbmBytesPerSec / (2 * activeB * 1e9 * bytesFp16)
    expect(b1).toBeGreaterThan(26)
    expect(b1).toBeLessThan(28)
    // and the sim's getter agrees once the model fits (FP8 path), differing only by
    // the bytes-per-param halving — exactly the §5.6 quant effect.
    const s = createState(11)
    modernEra(s)
    expect(decodeTokSb1(s, loadout(s, H100, BIG))).toBeCloseTo(b1 * 2, 0)
  })

  it('$3/GPU-hr at 500 tok/s ≈ $1.67/Mtoken (§5.8)', () => {
    // $/Mtoken = ($/GPU-hr × 1e6) / (aggTokS × 3600) = (3×1e6)/(500×3600) ≈ 1.667
    const dpm = dollarsPerMtoken(3, 500)
    expect(dpm).toBeCloseTo(1.667, 2)
    // monotonic: halve throughput → double unit cost.
    expect(dollarsPerMtoken(3, 250)).toBeCloseTo(dpm * 2, 6)
    expect(dollarsPerMtoken(3, 0)).toBe(Infinity)
  })

  it('rackDollarsPerMtoken matches the ($/GPU-hr × 1e6)/(aggTokS × 3600) identity', () => {
    const s = createState(2)
    modernEra(s) // FP8 → 70B fits one 80 GB H100
    const lo = loadout(s, H100, BIG)
    expect(serverFitsMemory(s, lo)).toBe(true)
    const batch = effectiveBatch(s, lo)
    const agg = serverAggDecodeTokS(s, lo, batch)
    const expected = (lo.hw!.gpuHrUsd * 1e6) / (agg * 3600)
    expect(rackDollarsPerMtoken(s, lo)).toBeCloseTo(expected, 6)
  })
})

describe('ui/metrics — latency (effLatencyMs §0.4) parity with the sim', () => {
  it('tpotMs = 1000 / perUserDecode at the effective batch', () => {
    const s = createState(3)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    const inTok = 512
    const outTok = 256
    const lat = latencyOf(s, lo, inTok, outTok)
    const batch = effectiveBatch(s, lo, inTok + outTok)
    const perUser = serverPerUserDecodeTokS(s, lo, batch)
    expect(lat.tpotMs).toBeCloseTo(1000 / perUser, 3)
    // e2el = ttft + (out−1)×tpot (the §0.4 chain)
    expect(lat.e2elMs).toBeCloseTo(lat.ttftMs + (outTok - 1) * lat.tpotMs, 3)
    expect(lat.batch).toBe(batch)
  })

  it('per-user decode rate equals aggregate / batch (§5.7)', () => {
    const s = createState(4)
    modernEra(s)
    const lo = loadout(s, H100, BIG)
    const lat = latencyOf(s, lo, 512, 256)
    expect(lat.perUserDecodeTokS).toBeCloseTo(lat.aggDecodeTokS / lat.batch, 6)
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
    const moe = sparsityOf(loadout(s, H100, 'nemotron3_nano_30b'))
    expect(moe.isMoE).toBe(true)
    expect(moe.ratio).toBeLessThan(0.2) // 3.5 active / 30 total
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
