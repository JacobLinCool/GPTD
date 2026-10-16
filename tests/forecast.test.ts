/**
 * The shared load forecast (src/sim/loadForecast.ts) — the estimate behind the deploy picker's ★,
 * the per-archetype fit rows, the next-wave readiness card and the demo autoplay. It must be pure,
 * and its ★ must be a pick that actually serves the wave it is recommended for: these tests deploy
 * the ★ across a fleet, run the wave in the sim, and compare with the picks a naive single-type
 * estimate used to make (dense 27B models on the long-document wave, a 9B before batching).
 */
import { describe, expect, it } from 'vitest'
import { GRID_COLS, GRID_ROWS, SIM_DT } from '../src/config'
import type { GameState, ModelDef } from '../src/core/types'
import { deployModel, startGame, startWave, tryBuild, upgradeHardware } from '../src/sim/actions'
import {
  HARDWARE_TIERS,
  INFRA_NODES,
  METHOD_RECIPES,
  MODEL_DEFS,
  REQUEST_TYPES,
  TOWER_DEFS,
} from '../src/sim/content'
import { comingLoad, loadEnvOf, loadFits, refusalChance } from '../src/sim/loadForecast'
import { loadout } from '../src/sim/effects'
import { computeDerivedFields } from '../src/sim/models'
import { CORE_TILE, isBuildable, isPathTile } from '../src/sim/pathing'
import { updatePower } from '../src/sim/power'
import { applyInfraEffects } from '../src/sim/research'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'
import { deployCandidates, upcomingTraffic } from '../src/ui/metrics'

/** Lane-adjacent tiles core-first, and the back tiles (power / cooling). */
const LANE: { col: number; row: number }[] = []
const BACK: { col: number; row: number }[] = []
for (let c = 0; c < GRID_COLS; c++)
  for (let r = 0; r < GRID_ROWS; r++) {
    if (!isBuildable(c, r)) continue
    let adj = false
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) if (isPathTile(c + dc, r + dr)) adj = true
    ;(adj ? LANE : BACK).push({ col: c, row: r })
  }
const dist = (p: { col: number; row: number }) =>
  Math.abs(p.col - CORE_TILE.col) + Math.abs(p.row - CORE_TILE.row)
LANE.sort((a, b) => dist(a) - dist(b) || a.col - b.col || a.row - b.row)

interface Fleet {
  wave: number
  racks: number
  hw: string
  research: string[]
  guard?: string
  caches?: number
  redteam?: boolean
}

/** A fleet in the build phase before `wave` (1-based): racks core-first on one tier, grid + chillers, no incident. */
function fleet(f: Fleet, seed: number): GameState {
  const s = createState(seed)
  startGame(s)
  s.meters.cash = 1e6
  s.phase = 'build'
  for (const id of f.research) {
    applyInfraEffects(s, INFRA_NODES[id].effects)
    s.upgrades[id] = 1
  }
  if (f.redteam) s.upgrades['eval_redteam'] = 1
  if (f.guard) expect(tryBuild(s, f.guard, LANE[0].col, LANE[0].row)).toBe(true)
  let i = 4
  for (let k = 0; k < f.racks; k++) {
    const p = LANE[i++]
    expect(tryBuild(s, 'srv_edge', p.col, p.row)).toBe(true)
    const t = s.towers[s.towers.length - 1]
    while (HARDWARE_TIERS.indexOf(t.hwId!) < HARDWARE_TIERS.indexOf(f.hw)) upgradeHardware(s, t.id)
  }
  for (let k = 0; k < (f.caches ?? 0); k++) tryBuild(s, 'cache', LANE[i].col, LANE[i++].row)
  for (let k = 0; k < 16; k++) tryBuild(s, k % 2 ? 'cooling' : 'power', BACK[k].col, BACK[k].row)
  updatePower(s)
  s.waveIndex = f.wave - 2
  s.pendingIncident = null
  return s
}

/** The deploy picker's candidates on the fleet's first rack (seed 1). */
function picker(f: Fleet) {
  const s = fleet(f, 1)
  const tw = s.towers.find((t) => t.def.kind === 'server')!
  return deployCandidates(s, tw, upcomingTraffic(s)).filter((c) => c.fits)
}

/** Deploy one checkpoint on every rack and run the wave; mean Goodput over three seeds (0..1). */
function served(f: Fleet, modelId: string): number {
  let sum = 0
  for (const seed of [1, 2, 3]) {
    const s = fleet(f, seed)
    for (const t of s.towers)
      if (t.def.kind === 'server' && t.modelId !== modelId) expect(deployModel(s, t.id, modelId)).toBe(true)
    expect(startWave(s)).toBe(true)
    for (let t = 0; s.phase === 'wave' && t < 300; t += SIM_DT) step(s)
    sum += (s.lastReport?.goodputPct ?? 0) / 100
  }
  return sum / 3
}

const MODERN = ['inf_batching', 'inf_wq_fp8', 'inf_paged', 'inf_prefix', 'inf_chunked']
const TOWER_GUARD_ENCODER = TOWER_DEFS.guard_encoder.guardrail!
const RUN_TIMEOUT_MS = 60_000

describe('load forecast: pure, deterministic', () => {
  it('reads state without mutating it and repeats exactly', () => {
    const s = fleet({ wave: 16, racks: 6, hw: 'hw_perf', research: MODERN, guard: 'guard_encoder' }, 7)
    const snapshot = (): string =>
      JSON.stringify({ towers: s.towers, meters: s.meters, rng: s.rng, research: s.research, infra: s.infra })
    const before = snapshot()
    const load = comingLoad(s)!
    const env = loadEnvOf(s, load)
    const lo = loadout(s, 'hw_perf', 'g_qwen3_5_9b_2')
    const a = JSON.stringify(loadFits(s, lo, load.demand, env))
    const b = JSON.stringify(loadFits(s, lo, load.demand, env))
    expect(b).toBe(a)
    expect(snapshot()).toBe(before)
    // no model on the rack: nothing fits
    expect(loadFits(s, loadout(s, 'hw_perf', undefined), load.demand, env).every((f) => !f.window)).toBe(true)
  })
})

describe('deploy picker ★: the pick serves the wave it is recommended for', () => {
  it(
    'the long-document wave on H100s: ★ is a fast model that serves it, never a dense 27B that leaks it',
    () => {
      const f: Fleet = { wave: 16, racks: 12, hw: 'hw_perf', research: MODERN, guard: 'guard_encoder' }
      const cands = picker(f)
      const star = cands.find((c) => c.recommended)!
      expect(star).toBeDefined()
      expect(star.model.isMoE || star.model.paramsActiveB < 20).toBe(true)
      const dense = cands.find((c) => c.model.id === 'g_qwen3_5_27b_2')!
      expect(dense.score).toBeLessThan(star.score - 0.4)
      const starGp = served(f, star.model.id)
      expect(starGp).toBeGreaterThan(0.8)
      expect(Math.abs(starGp - star.score)).toBeLessThan(0.15) // the ★ score is the share the sim serves
      expect(served(f, 'g_qwen3_5_27b_2')).toBeLessThan(starGp - 0.4)
    },
    RUN_TIMEOUT_MS,
  )

  it(
    'RAG before Continuous Batching on L40S racks: ★ is not the 9B whose occupancy queues the wave',
    () => {
      const f: Fleet = { wave: 3, racks: 8, hw: 'hw_standard', research: [] }
      const cands = picker(f)
      const star = cands.find((c) => c.recommended)!
      expect(star.model.id).not.toBe('g_qwen3_5_9b_2')
      const nine = cands.find((c) => c.model.id === 'g_qwen3_5_9b_2')!
      expect(nine.score).toBeLessThan(star.score)
      const starGp = served(f, star.model.id)
      expect(starGp).toBeGreaterThan(0.85)
      expect(served(f, 'g_qwen3_5_9b_2')).toBeLessThan(starGp)
    },
    RUN_TIMEOUT_MS,
  )

  it(
    'the code-completion surge on H100s: ★ answers the 200 ms completions correctly and on time',
    () => {
      const f: Fleet = {
        wave: 12,
        racks: 12,
        hw: 'hw_perf',
        research: MODERN,
        guard: 'guard_encoder',
        caches: 1,
        redteam: true,
      }
      const star = picker(f).find((c) => c.recommended)!
      const comp = upcomingTraffic(fleet(f, 1))!.entries.findIndex((e) => e.def.id === 'comp')
      expect(comp).toBeGreaterThanOrEqual(0)
      expect(star.fit[comp].fast && star.fit[comp].smart).toBe(true)
      expect(served(f, star.model.id)).toBeGreaterThan(0.85)
    },
    RUN_TIMEOUT_MS,
  )
})

describe('over-refusal: the real lever fixes the drain', () => {
  it('an aligned safe-completion checkpoint and one guard family refuse far fewer real users', () => {
    const s = fleet(
      { wave: 28, racks: 1, hw: 'hw_perf', research: MODERN, guard: 'guard_llm', redteam: true },
      3,
    )
    const env = loadEnvOf(s, comingLoad(s)!)
    const chat = { def: REQUEST_TYPES.chat, count: 1, inputTokens: 1500, outputTokens: 400, difficulty: 20 }
    const base: ModelDef = MODEL_DEFS['g_qwen3_5_9b_2']
    expect(base.alignment.refusalStyle).toBe('hard-refusal')
    // a Studio Constitutional-AI run: safe-completion style, lower over-refusal
    const cai = { ...base, ...computeDerivedFields(base, METHOD_RECIPES.cai, 'safety', 2, null) } as ModelDef
    expect(cai.alignment.refusalStyle).toBe('safe-completion')
    const hard = refusalChance(s, base, chat, env.guards)
    const aligned = refusalChance(s, cai, chat, env.guards)
    expect(aligned).toBeLessThan(hard * 0.65)
    // a natively safe-completion family (gpt-oss) lower still
    expect(refusalChance(s, MODEL_DEFS['gptoss_20b'], chat, env.guards)).toBeLessThan(aligned)
    // a redundant second guard family adds its own false positives on top
    const two = [...env.guards, { input: [TOWER_GUARD_ENCODER], output: [] }]
    expect(refusalChance(s, cai, chat, two)).toBeGreaterThan(aligned)
    // attacks and embeddings are never over-refused
    expect(refusalChance(s, base, { ...chat, def: REQUEST_TYPES.jailbreak }, env.guards)).toBe(0)
  })

  it(
    'in a chat-heavy wave the aligned checkpoint drains a fraction of the SLA the hard-refusal one does',
    () => {
      const run = (alignment: ModelDef['alignment']): { refused: number; sla: number } => {
        let refused = 0
        let sla = 0
        for (const seed of [1, 2, 3, 4]) {
          const s = fleet(
            { wave: 28, racks: 16, hw: 'hw_perf', research: MODERN, guard: 'guard_llm', redteam: true },
            seed,
          )
          const m: ModelDef = { ...MODEL_DEFS['g_qwen3_5_9b_2'], id: 'probe', alignment }
          s.derivedModels.probe = m
          s.models.probe = true
          for (const t of s.towers)
            if (t.def.kind === 'server') expect(deployModel(s, t.id, 'probe')).toBe(true)
          expect(startWave(s)).toBe(true)
          for (let t = 0; s.phase === 'wave' && t < 300; t += SIM_DT) {
            step(s)
            for (const e of s.events)
              if (e.type === 'outcome' && e.outcome === 'overRefused') {
                refused++
                sla -= e.dSla
              }
            s.events.length = 0
          }
        }
        return { refused, sla }
      }
      const hard = run({ safety: 58, refusalStyle: 'hard-refusal', overRefusal: 0.12 })
      const aligned = run({ safety: 95, refusalStyle: 'safe-completion', overRefusal: 0.03 })
      expect(aligned.refused).toBeLessThan(hard.refused * 0.6)
      expect(aligned.sla).toBeLessThan(hard.sla * 0.6)
    },
    RUN_TIMEOUT_MS,
  )
})
