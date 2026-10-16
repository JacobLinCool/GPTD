import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/core/types'
import { pwl, ROSTER_FRONTIER_TOLERANCE, THINK_TOKENS_FALLBACK, thinkingOf, thinkingVariantName } from '../src/sim/calibrate'
import { DEFAULT_MODEL_ID, HARDWARE_DEFS, INFRA_NODES, MODEL_CANDIDATES, MODEL_DEFS } from '../src/sim/content'
import { int4ContextPenalty, kvPerReqGb, serverFitsMemory, serverQuality } from '../src/sim/effects'
import { applyInfraEffects } from '../src/sim/research'
import { MODEL_ARCH } from '../src/sim/roster.arch.generated'
import { AA_BENCH, AA_BENCH_SOURCE } from '../src/sim/roster.bench.generated'
import { createState } from '../src/sim/state'

/* --------------------------------------------------------------------------
 * The model data pipeline: the Artificial Analysis reference scale (scripts/aa-cells.mjs),
 * the config.json-derived architecture (scripts/arch-sync.mjs) and what the sim reads
 * from them (KV footprint, native precision, thinking budget, the roster gate).
 * ------------------------------------------------------------------------ */

const ROOT = join(__dirname, '..')
const json = (f: string) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'))
const MAP = json('data/roster-aa-map.json')
const REFERENCE = json(MAP.referenceSnapshot).data as { id: string; slug: string; evaluations: Record<string, number | null> }[]
const LATEST = json('data/aa-snapshot.json').data as { id: string; slug: string }[]
const CELLS = Object.entries(MAP.benchmarkCells as Record<string, string>).filter(([k]) => !k.startsWith('_'))
const PINS = Object.entries(MAP.models as Record<string, { slug: string; aaId: string }>)
const candidate = (id: string) => MODEL_CANDIDATES.find((m) => m.id === id)!

function infraOn(s: GameState, ...ids: string[]): void {
  for (const id of ids) {
    applyInfraEffects(s, INFRA_NODES[id].effects)
    s.upgrades[id] = 1
  }
}

describe('benchmark cells on the frozen reference scale', () => {
  it('every pinned model measured on the reference snapshot keeps its reference cells exactly', () => {
    // carry-forward by AA UUID: a refreshed snapshot never moves a calibrated model
    const ref = new Map(REFERENCE.map((m) => [m.id, m]))
    let carried = 0
    for (const [id, pin] of PINS) {
      const rec = ref.get(pin.aaId)
      if (!rec) continue
      for (const [field, key] of CELLS) {
        const v = rec.evaluations[key]
        if (v == null) continue
        expect(AA_BENCH[id][field as keyof (typeof AA_BENCH)[string]]).toBe(Math.round(v * 1000) / 10)
        expect(AA_BENCH_SOURCE[id]?.[field as keyof (typeof AA_BENCH)[string]]).toBeUndefined()
      }
      carried++
    }
    expect(carried).toBeGreaterThanOrEqual(96)
  })

  it('pins are by AA UUID and every slug hint still names its pinned model (no recycled slugs)', () => {
    const bySlug = new Map(LATEST.map((m) => [m.slug, m.id]))
    for (const [, pin] of PINS) expect(bySlug.get(pin.slug)).toBe(pin.aaId)
    // the two DeepSeek checkpoints whose bare slugs AA recycled are pinned to the open re-releases
    expect(MAP.models.deepseek_v4_pro).toEqual({ slug: 'deepseek-v4-pro', aaId: '83173329-c09a-41f1-a028-a282a5f908d7' })
    expect(MAP.models.g_deepseek_v4_flash_2).toEqual({ slug: 'deepseek-v4-flash', aaId: 'fe4c0848-e284-4e52-a79d-cdc28392f1a9' })
    expect(MODEL_DEFS.deepseek_v4_pro.name).toBe('DeepSeek-V4-Pro-0813')
  })

  it('a cell AA no longer publishes is bridged from measured cells, with its provenance kept', () => {
    // Kimi K3 has no IFBench / TB-Hard in any snapshot: both are bridged (display: ≈)
    expect(AA_BENCH_SOURCE.kimi_k3?.ifBench).toMatch(/^bridge:/)
    expect(AA_BENCH_SOURCE.kimi_k3?.terminalBenchHard).toMatch(/^bridge:TB-2\.1/)
    expect(MODEL_DEFS.kimi_k3.real?.benchmarkSource?.ifBench).toMatch(/sd=/)
    // a re-scored cell of a new model is equated back to the reference scale
    expect(AA_BENCH_SOURCE.kimi_k3?.lcr).toBe('eq')
    // every active model resolves every axis from cells (no tier-floor fallback needed)
    for (const m of Object.values(MODEL_DEFS)) {
      for (const [field] of CELLS) expect(m.real?.benchmarks[field as 'hle']).toBeTypeOf('number')
    }
  })

  it('the curve tail saturates toward 130: continuous, same slope at the last anchor, never clamped', () => {
    const anchors = [
      [10, 40],
      [50, 120],
    ] as const
    expect(pwl(anchors, 50)).toBe(120)
    expect(pwl(anchors, 30)).toBe(80) // inside the anchors: plain interpolation
    // just past the anchor the slope is the old 1.5 extrapolation
    expect(pwl(anchors, 52)).toBe(123)
    // far beyond it the tail approaches, but does not pile onto, the ceiling
    expect(pwl(anchors, 60)).toBeLessThan(130)
    expect(pwl(anchors, 60)).toBeGreaterThan(pwl(anchors, 55))
    expect(pwl(anchors, 400)).toBe(130)
  })
})

describe('architecture from config.json (KV layout, native precision)', () => {
  it('every candidate joins an architecture record and an open-weights link', () => {
    for (const m of MODEL_CANDIDATES) {
      expect(m.real?.source).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+$/)
      expect(MODEL_ARCH[m.real!.source.replace('https://huggingface.co/', '')]).toBeDefined()
      expect(m.kvBytesPerToken).toBeGreaterThan(0)
      expect(m.kvLayers).toBeGreaterThan(0)
      expect(m.kvLayers).toBeLessThanOrEqual(m.layers * 2) // LongCat counts two MLA sublayers per block
      expect(m.nativeWeightBytes).toBeGreaterThanOrEqual(0.5)
      expect(m.nativeWeightBytes).toBeLessThanOrEqual(2)
      expect(m.contextWindowK).toBeGreaterThan(0)
    }
  })

  it('KV bytes per token follow the real attention design', () => {
    // MLA caches ONE latent (kv_lora 512) + rope (64) per layer — no K/V pair, no head count:
    // GLM-5.2 = 78 × 576 latent + 21 lightning-indexer keys × 128, at 2 bytes
    const glm = MODEL_DEFS.glm_5_2
    expect(glm.attn).toBe('MLA')
    expect(glm.kvBytesPerToken).toBe((78 * 576 + 21 * 128) * 2)
    // Kimi K2 (the DeepSeek-V3 layout): 61 × 576 × 2 B ≈ 69 KB per token
    expect(candidate('kimi_k2').kvBytesPerToken).toBe(61 * 576 * 2)
    // a linear/SSM hybrid keeps a growing KV only on its attention layers: Nemotron-3-Super = 8 of 88,
    // and pins a constant Mamba-2 state per request instead
    const nem = MODEL_DEFS.nemotron_super
    expect(nem.attn).toBe('hybrid-linear')
    expect(nem.kvLayers).toBe(8)
    expect(nem.kvBytesPerToken).toBe(8 * 2 * 2 * 128 * 2)
    expect(nem.kvStateMbPerReq).toBeGreaterThan(100)
    // sliding-window layers are bounded by their window → constant state, not per-token KV:
    // gpt-oss-120b keeps 18 of 36 layers growing; the 18 windowed layers (128 tokens) are constant
    const oss = MODEL_DEFS.gptoss_120b
    expect(oss.attn).toBe('hybrid-swa')
    expect(oss.kvBytesPerToken).toBe(18 * 2 * 8 * 64 * 2)
    expect(oss.kvStateMbPerReq).toBeCloseTo((18 * 2 * 8 * 64 * 128 * 2) / 1e6, 1)
    // DeepSeek-V4 CSA/HCA compresses KV 4× / 128× on one shared 512-d head (+ CSA indexer keys)
    const v4 = MODEL_DEFS.deepseek_v4_pro
    expect(v4.attn).toBe('csa')
    expect(v4.kvBytesPerToken).toBe(((30 * 512) / 4 + (31 * 512) / 128 + (30 * 128) / 4) * 2)
    // so at 32K context a full-attention 816B model holds over 20× the KV of the compressed 1.6T one
    const s = createState(93)
    expect(kvPerReqGb(s, MODEL_DEFS.muse_spark_open, 32768)).toBeGreaterThan(20 * kvPerReqGb(s, v4, 32768))
  })

  it('a checkpoint is resident at its NATIVE release precision (no PTQ needed, no PTQ tax)', () => {
    const s = createState(25) // no quant research: everything at its release precision
    const fits = (hwId: string, id: string) => serverFitsMemory(s, { hw: HARDWARE_DEFS[hwId], model: candidate(id) })
    // gpt-oss-120b ships MXFP4 MoE weights: all 117B fit ONE 80 GB H100 (its model card's claim)
    expect(candidate('gptoss_120b').nativeWeightBytes).toBeLessThan(0.6)
    expect(fits('hw_perf', 'gptoss_120b')).toBe(true)
    // gpt-oss-20b (~14 GB MXFP4) fits a 24 GB edge GPU
    expect(fits('hw_edge', 'gptoss_20b')).toBe(true)
    // Kimi K2 Thinking is INT4 quantization-aware-trained: 1T params ≈ 580 GB fit a DGX H200
    expect(candidate('kimi_k2').nativeWeightBytes).toBeLessThan(0.6)
    expect(fits('hw_pod', 'kimi_k2')).toBe(true)
    // DeepSeek V3.x ships FP8: 671B ≈ 680 GB fit a DGX H200 without any PTQ research
    expect(candidate('deepseek_v31').nativeWeightBytes).toBeCloseTo(1, 1)
    expect(fits('hw_pod', 'deepseek_v31')).toBe(true)
    // a BF16 release does NOT shrink until PTQ is researched (Qwen3.5-122B: 244 GB > 141 GB)
    expect(fits('hw_frontier', 'qwen35_122b')).toBe(false)
    // and INT4 PTQ taxes only a model quantized BELOW its release precision
    const int4 = createState(25)
    infraOn(int4, 'inf_batching', 'inf_wq_fp8', 'inf_wq_int4')
    const q = (st: GameState, hwId: string, id: string) => serverQuality(st, { hw: HARDWARE_DEFS[hwId], model: candidate(id) })
    expect(q(int4, 'hw_perf', 'gptoss_120b')).toBe(q(s, 'hw_perf', 'gptoss_120b')) // MXFP4 → INT4: free
    expect(q(int4, 'hw_pod', 'qwen35_122b')).toBe(q(s, 'hw_pod', 'qwen35_122b') - 2) // BF16 → INT4: the flat tax
    expect(int4ContextPenalty(int4, 16000, candidate('gptoss_120b'))).toBe(0)
    expect(int4ContextPenalty(int4, 16000, candidate('qwen35_122b'))).toBe(6)
  })
})

describe('thinking models (AA telemetry → isReasoning / thinkTokens)', () => {
  it('a first-answer gap means hidden reasoning; its length × speed is the budget', () => {
    expect(thinkingOf({ ttftS: 0.5, ttfatS: 10.5, tps: 200 })).toEqual({ isReasoning: true, thinkTokens: 2000 })
    expect(thinkingOf({ ttftS: 1, ttfatS: 90, tps: 60 }).thinkTokens).toBe(4000) // clamped
    expect(thinkingOf({ ttftS: 0.5, ttfatS: 0.5, tps: 200 })).toEqual({ isReasoning: false, thinkTokens: 0 })
    // no telemetry: the model card, then the variant name; an untimed thinker gets the fallback
    expect(thinkingOf(undefined, true)).toEqual({ isReasoning: true, thinkTokens: THINK_TOKENS_FALLBACK })
    expect(thinkingOf({ name: 'Qwen3 1.7B (Reasoning)' }).isReasoning).toBe(true)
    expect(thinkingOf({ name: 'Qwen3.5 0.8B (Non-reasoning)' }).isReasoning).toBe(false)
    expect(thinkingVariantName('GLM-5.2 (Max)')).toBe(true)
    expect(thinkingVariantName('Apriel-v1.6-15B-Thinker')).toBe(true)
  })

  it('roster flags follow the pinned variant, not a guess', () => {
    // pinned on thinking-mode AA rows, so their qualityBy IS thinking-mode capability
    for (const id of ['g_qwen3_5_9b_2', 'g_gemma_4_31b_2', 'g_apriel_v1_6_15b_thinker_2', 'gptoss_120b', 'deepseek_v4_pro']) {
      expect(MODEL_DEFS[id].isReasoning).toBe(true)
      expect(MODEL_DEFS[id].thinkTokens).toBeGreaterThan(0)
    }
    // instruct models think 0 tokens
    for (const id of ['g_qwen3_5_0_8b_non_reasoning_2', 'g_gemma_3_1b_2']) {
      expect(MODEL_DEFS[id].isReasoning).toBe(false)
      expect(MODEL_DEFS[id].thinkTokens).toBe(0)
    }
    expect(MODEL_DEFS[DEFAULT_MODEL_ID].isReasoning).toBe(false)
  })
})

describe('the roster gate', () => {
  it('keeps a lean ~60-checkpoint roster spanning sub-1B to the multi-trillion frontier', () => {
    const active = Object.values(MODEL_DEFS)
    expect(ROSTER_FRONTIER_TOLERANCE).toBeGreaterThan(0)
    expect(active.length).toBeGreaterThanOrEqual(50)
    expect(active.length).toBeLessThanOrEqual(62)
    expect(Math.min(...active.map((m) => m.paramsTotalB))).toBeLessThan(1)
    expect(Math.max(...active.map((m) => m.paramsTotalB))).toBeGreaterThan(2500)
    // the 2026-H2 open frontier is active
    for (const id of ['kimi_k3', 'glm_5_3', 'qwen38_27b', 'mimo_v26_pro', 'deepseek_v41_flash', 'muse_spark_open']) expect(MODEL_DEFS[id]).toBeDefined()
    // a checkpoint obsolete at its size on every lane is pruned (Kimi K2 Thinking at 1T)
    expect(MODEL_DEFS.kimi_k2).toBeUndefined()
    expect(candidate('kimi_k2')).toBeDefined()
  })
})
