import { describe, expect, it } from 'vitest'
import { GRID_COLS, GRID_ROWS, SIM_DT } from '../src/config'
import type { GameState } from '../src/core/types'
import { continueEndless, startGame, startWave, tryBuild, upgradeHardware } from '../src/sim/actions'
import {
  DEFAULT_MODEL_ID,
  INFRA_NODES,
  METHOD_RECIPES,
  MODEL_DEFS,
  TOWER_DEFS,
  WAVES,
} from '../src/sim/content'
import { computeDerivedFields } from '../src/sim/models'
import { CORE_TILE, isBuildable, isPathTile } from '../src/sim/pathing'
import {
  demoAutoplay,
  demoCanContinueCampaign,
  demoDeployedModelIds,
  demoPlan,
  nextDemoWaveNumber,
} from '../src/sim/demo'
import { applyInfraEffects } from '../src/sim/research'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'

/* --------------------------------------------------------------------------
 * The balance gate. The campaign is a 100-wave elimination gauntlet through real 2023→2026
 * history (monotonic tier 1→12), with procedural endless surges past wave 100, so the gate is
 * DEPTH + system usage, not victory: the production demo heuristic (src/sim/demo.ts) must
 * (a) survive deep into the gauntlet by playing well, (b) prove it USED the real systems, and
 * (c) still be eliminated before the apex — the run is meant to end for all but apex play.
 * A NAIVE build (cheap racks + the free starter, nothing else) must survive the opening
 * teaching waves and fall to the first boss-era waves: the early campaign teaches, it does not
 * execute. If this regresses, TUNE THE GAME (campaign.ts knobs / economy / the demo), not the
 * test — the demo must get deep by playing well, never by an exploit.
 * ------------------------------------------------------------------------ */

/** The depth every gate seed must reach (the demo reaches ≈W64–91; the floor keeps a margin). */
const GAUNTLET_FLOOR = 45
/** The gate seeds. */
const SEEDS = [2026, 101, 202, 303] as const
/** A full demo campaign takes several seconds of simulated waves. */
const RUN_TIMEOUT_MS = 120_000

/** The serving stack a wave-100 fleet has researched (chunked prefill, not P/D disaggregation). */
const APEX_STACK = [
  'inf_batching',
  'inf_wq_fp8',
  'inf_paged',
  'inf_prefix',
  'inf_chunked',
  'inf_flash',
  'inf_kvquant_fp8',
  'inf_par_tp',
  'inf_spec',
  'inf_par_dp',
  'inf_par_ep',
  'inf_routing',
  'inf_engine_sglang',
  'inf_offload',
  'inf_par_pp',
  'inf_multistep',
]

/** One production-demo run per seed, shared by every test that reads it. */
const runs = new Map<number, ReturnType<typeof demoAutoplay>>()
function run(seed: number): ReturnType<typeof demoAutoplay> {
  let r = runs.get(seed)
  if (!r) {
    r = demoAutoplay(seed)
    runs.set(seed, r)
  }
  return r
}

function runWave(s: GameState, maxSeconds = 240): void {
  let t = 0
  while (s.phase === 'wave' && t < maxSeconds) {
    step(s)
    t += SIM_DT
  }
}

/** Lane-adjacent tiles, core-first (the naive player builds where the lanes meet). */
function laneTiles(): { col: number; row: number }[] {
  const tiles: { col: number; row: number }[] = []
  for (let c = 0; c < GRID_COLS; c++)
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!isBuildable(c, r)) continue
      let adj = false
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) if (isPathTile(c + dc, r + dr)) adj = true
      if (adj) tiles.push({ col: c, row: r })
    }
  const d = (p: { col: number; row: number }) =>
    Math.abs(p.col - CORE_TILE.col) + Math.abs(p.row - CORE_TILE.row)
  return tiles.sort((a, b) => d(a) - d(b) || a.col - b.col || a.row - b.row)
}

/**
 * The NAIVE reference: a new player who builds cheap Edge racks with the free starter (eight to
 * open, two more a wave while cash lasts) and touches nothing else — no research, no guard, no
 * router, no cache, no model swap. Returns the wave it is eliminated on (null = survived).
 */
function naiveRun(seed: number, maxWaves = 30): number | null {
  const s = createState(seed)
  startGame(s)
  const tiles = laneTiles()
  for (let w = 1; w <= maxWaves; w++) {
    const want = 8 + 2 * (w - 1)
    for (const p of tiles) {
      if (s.towers.length >= want || s.meters.cash < TOWER_DEFS.srv_edge.cost + 25) break
      if (!s.towers.some((t) => t.col === p.col && t.row === p.row)) tryBuild(s, 'srv_edge', p.col, p.row)
    }
    if (!startWave(s)) return null
    runWave(s)
    if (s.phase === 'lost') return w
  }
  return null
}

describe('balance: the production demo survives deep into the 100-wave gauntlet', () => {
  it(
    'reaches the gauntlet floor on every gate seed, is still eliminated before the apex, and serves cleanly',
    () => {
      for (const seed of SEEDS) {
        const r = run(seed)
        const s = r.state
        console.log(
          `seed ${seed}: reached W${r.reached}/${WAVES.length}, phase=${s.phase}, trust=${s.meters.trust.toFixed(0)}, ` +
            `sla=${s.meters.sla.toFixed(0)}, cash=${s.meters.cash.toFixed(0)}, served=${s.stats.served}, ` +
            `slaLostBy=${JSON.stringify(s.stats.slaLostBy)} trustLostBy=${JSON.stringify(s.stats.trustLostBy)}`,
        )
        expect(r.reached).toBeGreaterThanOrEqual(GAUNTLET_FLOOR)
        // an elimination gauntlet: the heuristic gets deep, it does not cruise to the apex
        expect(r.won).toBe(false)
        // the economy rewards good serving: most answered requests are clean, refusals stay a minority
        const answered = s.stats.served + s.stats.bad + s.stats.sloMiss
        expect(s.stats.served).toBeGreaterThan(answered * 0.8)
        expect(s.stats.overRefused).toBeLessThan(s.stats.served * 0.1)
        expect(s.stats.served).toBeGreaterThan(2000)
      }
    },
    RUN_TIMEOUT_MS * SEEDS.length,
  )

  it(
    'exercises the full stack before elimination (primary seed)',
    () => {
      const r = run(2026)
      const s = r.state
      const kindCount = (kind: string) => s.towers.filter((t) => t.def.kind === kind).length
      const hwIds = new Set(s.towers.filter((t) => t.def.kind === 'server').map((t) => t.hwId))
      const roles = new Set(
        s.towers
          .filter((t) => t.def.kind === 'server')
          .map((t) => t.role)
          .filter(Boolean),
      )
      const derivedTargets = new Set(
        Object.values(s.derivedModels)
          .map((m) => m.lineage?.target)
          .filter(Boolean),
      )
      console.log(
        `production demo coverage: reached=${r.reached} kinds=${JSON.stringify(Object.fromEntries(['server', 'router', 'cache', 'guardrail', 'power', 'cooling', 'cooling_liquid', 'lab'].map((k) => [k, kindCount(k)])))} ` +
          `hw=${JSON.stringify([...hwIds])} roles=${JSON.stringify([...roles])} derived=${JSON.stringify([...derivedTargets])} upgrades=${JSON.stringify(s.upgrades)}`,
      )
      // the platform: racks, dispatch, prefix caches, a guardrail stage, grid + chillers, the Lab
      expect(kindCount('server')).toBeGreaterThanOrEqual(30)
      expect(kindCount('router')).toBeGreaterThanOrEqual(1)
      expect(kindCount('cache')).toBeGreaterThanOrEqual(1)
      expect(kindCount('guardrail')).toBeGreaterThanOrEqual(1)
      expect(kindCount('power')).toBeGreaterThanOrEqual(1)
      expect(kindCount('cooling')).toBeGreaterThanOrEqual(1)
      expect(kindCount('lab')).toBeGreaterThanOrEqual(1)
      // as the era's attacks turn adaptive, the guard stage becomes a generative judge
      expect(s.towers.some((t) => t.def.id === 'guard_llm')).toBe(true)
      // a liquid-cooled rack (the NVL72) cannot run without a Liquid Cooling Loop; the 8-GPU boxes are air-cooled
      if (hwIds.has('hw_giga')) expect(kindCount('cooling_liquid')).toBeGreaterThanOrEqual(1)
      // the hardware ladder: single H100/H200-class racks and the 8-GPU boxes by the core
      expect(hwIds.has('hw_perf') || hwIds.has('hw_frontier')).toBe(true)
      expect(hwIds.has('hw_pod') || hwIds.has('hw_superpod')).toBe(true)
      // the serving stack: batching, paged KV, FP8, a prefill-interference fix (chunked prefill and
      // P/D disaggregation exclude each other), tensor parallelism, red-team eval, the Studio unlocks
      expect(s.upgrades['inf_batching']).toBeGreaterThanOrEqual(1)
      expect(s.upgrades['inf_paged']).toBeGreaterThanOrEqual(1)
      expect(s.upgrades['inf_wq_fp8']).toBeGreaterThanOrEqual(1)
      expect((s.upgrades['inf_chunked'] ?? 0) + (s.upgrades['inf_disagg'] ?? 0)).toBeGreaterThanOrEqual(1)
      if (s.upgrades['inf_disagg']) {
        expect(roles.has('prefill')).toBe(true)
        expect(roles.has('decode')).toBe(true)
      }
      expect(s.upgrades['inf_par_tp']).toBeGreaterThanOrEqual(1)
      expect(s.upgrades['eval_redteam']).toBeGreaterThanOrEqual(1)
      expect(s.upgrades['pt_rl']).toBeGreaterThanOrEqual(1)
      // the Studio: a reasoning and an agentic specialist, and a safe-completion (CAI) checkpoint
      expect(derivedTargets.has('reasoning')).toBe(true)
      expect(derivedTargets.has('agentic')).toBe(true)
      expect(derivedTargets.has('safety')).toBe(true)
      // the fleet serves something beyond the free starter
      expect([...demoDeployedModelIds(s)].some((id) => id !== DEFAULT_MODEL_ID)).toBe(true)
    },
    RUN_TIMEOUT_MS,
  )

  it('a naive build survives the opening teaching waves and falls in the first boss era', () => {
    for (const seed of SEEDS) {
      const died = naiveRun(seed)
      console.log(`naive seed ${seed}: eliminated on W${died ?? '-'}`)
      expect(died).not.toBeNull()
      expect(died!).toBeGreaterThanOrEqual(6)
      expect(died!).toBeLessThanOrEqual(14)
    }
  })

  it('Goodput is satisfiable: a fast-enough rack meets the interactive SLO (§0.4 C5)', () => {
    // The C5 invariant: the dual-clock SLO must NOT be permanently 0. A small model on a fast
    // GPU answering short interactive chat must clear its class SLO.
    const s = createState(7)
    s.meters.cash = 999999
    startGame(s)
    s.phase = 'build'
    for (const col of [3, 8, 14, 20]) {
      tryBuild(s, 'srv_edge', col, 2)
      const t = s.towers[s.towers.length - 1]
      upgradeHardware(s, t.id) // → standard
      upgradeHardware(s, t.id) // → performance (H100, 3.35 TB/s)
    }
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true) // wave 1 — interactive chat
    runWave(s)
    const rep = s.lastReport
    expect(rep).not.toBeNull()
    if (!rep) return
    console.log(
      `goodput smoke: served=${rep.served} sloMiss=${rep.sloMiss} bad=${rep.bad} goodput=${rep.goodputPct.toFixed(0)}% ` +
        `avgTtft=${rep.avgTtft.toFixed(3)}s p95Ttft=${rep.p95Ttft.toFixed(3)}s`,
    )
    // the racks sit on the northern lanes only, so the southern requests leak; every request the
    // racks DID answer met the interactive SLO
    expect(rep.served).toBeGreaterThan(0)
    expect(rep.goodputPct).toBeGreaterThan(0)
    expect(rep.sloMiss).toBe(0)
  })

  it('endless mechanics: clearing the apex flips to procedural surges past wave 100', () => {
    // Wave 100 is the apex; a run that clears it flips into procedural endless surges. The
    // plumbing is tested from a synthetic apex-win state (the heuristic is eliminated earlier).
    const s = createState(2026)
    startGame(s)
    s.phase = 'won'
    s.waveIndex = WAVES.length - 1
    expect(continueEndless(s)).toBe(true)
    expect(s.endless).toBe(true)
    expect(s.phase).toBe('build')
    expect(nextDemoWaveNumber(s)).toBe(WAVES.length)
    expect(demoCanContinueCampaign(s)).toBe(true)
    // startWave generates the first procedural surge (resuming at the wave-100 load).
    expect(startWave(s)).toBe(true)
    expect(s.waveIndex).toBe(WAVES.length)
    expect(s.currentWave).not.toBeNull()
    expect(s.currentWave?.groups.length ?? 0).toBeGreaterThan(0)
  })

  it(
    'endless continues the wave-100 load: a fleet that could clear wave 100 clears the first surges',
    () => {
      // a wave-100 winner: the serving stack researched, a treasury, the final boss cleared
      const s = createState(2026)
      startGame(s)
      for (const id of APEX_STACK) {
        applyInfraEffects(s, INFRA_NODES[id].effects)
        s.upgrades[id] = 1
      }
      s.upgrades['eval_redteam'] = 2
      s.waveIndex = WAVES.length - 1
      s.phase = 'won'
      s.meters.cash = 60000
      expect(continueEndless(s)).toBe(true)
      for (let i = 0; i < 6; i++) demoPlan(s, WAVES.length + 1) // stand the fleet up
      const w100 = WAVES[WAVES.length - 1].groups.reduce((n, g) => n + g.count, 0)
      for (let k = 1; k <= 3; k++) {
        demoPlan(s, WAVES.length + k)
        expect(startWave(s)).toBe(true)
        const surge = s.spawns.reduce((n, g) => n + g.count, 0)
        expect(surge).toBeGreaterThanOrEqual(Math.round(w100 * 0.95)) // never lighter than wave 100
        runWave(s, 300)
        console.log(
          `endless surge ${k}: ${surge} requests (W100: ${w100}), goodput ${s.lastReport?.goodputPct.toFixed(0)}%`,
        )
        expect(s.phase).toBe('build')
        expect(s.lastReport?.goodputPct ?? 0).toBeGreaterThan(80)
      }
    },
    RUN_TIMEOUT_MS,
  )
})

/**
 * §6.4 / §1.5 H2 teaching invariants — the roster-balance properties the campaign is built to
 * TEACH: the agent/SWE lane is a capability axis of its own, not a by-product of size. Static
 * facts about the calibrated roster + Studio, independent of any single playthrough.
 */
describe('balance: teaching invariants (H2 agent wall / capability compression)', () => {
  it('H2: a tiny 30B-A3B MoE is fast+smart but the AGENT lane is its wall', () => {
    const q = MODEL_DEFS['g_nemotron_cascade_2_30b_a3b_2'].qualityBy
    // it clears chat/reasoning with margin (the MoE "frontier answers at 3B active"),
    expect(q.reasoning).toBeGreaterThanOrEqual(82)
    expect(q.chat).toBeGreaterThanOrEqual(82)
    // …but its agentic capability genuinely lags the agent line (82): the wall is an axis, not a
    // serving cost (a small MoE decodes FASTEST).
    expect(q.agentic).toBeLessThan(82)
  })

  it('the agent lane requires terminal-agent strength OR a trained specialist — not raw scale', () => {
    const AGENT_LINE = 82
    // a true terminal-agent-grade frontier (GLM-5.2 / DeepSeek-V4-Pro) clears it,
    expect(MODEL_DEFS['glm_5_2'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE)
    expect(MODEL_DEFS['deepseek_v4_pro'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE)
    // and capability compression reaches the agent lane too by late 2026: a dense 27B trained as
    // an agent (Qwen3.8-27B) clears it — skill, not size, is the wall,
    expect(MODEL_DEFS['qwen38_27b'].qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE)
    // …while the cheap mid MoEs do NOT — and crucially, neither does raw SCALE: a big MoE that is
    // only MID on Terminal-Bench Hard (gpt-oss-120B) falls short of the wall.
    for (const id of ['g_nemotron_cascade_2_30b_a3b_2', 'gptoss_20b', 'gptoss_120b']) {
      expect(MODEL_DEFS[id].qualityBy.agentic).toBeLessThan(AGENT_LINE)
    }
    // …and a PLAYER GRPO-agentic run on an agentic-capable base (gpt-oss-120B — strong but lands
    // just short of the line, and its MXFP4 weights fit one 80 GB H100) DOES close the loop — the
    // Studio is the player's path to the agent lane when no frontier is afforded.
    const base = MODEL_DEFS['gptoss_120b']
    const f = computeDerivedFields(base, METHOD_RECIPES['grpo'], 'agentic', 1.5, null)
    expect(base.qualityBy.agentic).toBeLessThan(AGENT_LINE) // the base alone is short,
    expect(f.qualityBy.agentic).toBeGreaterThanOrEqual(AGENT_LINE) // the GRPO-agent run clears it.
  })
})
