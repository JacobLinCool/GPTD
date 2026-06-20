/**
 * Achievements (docs/SYSTEM-MENU.md §11).
 *
 * Definitions are metadata only; the unlock LOGIC lives in AchievementTracker,
 * driven from the UI/meta layer (game.ts) so `src/sim/**` stays pure (it never
 * imports this). Tracker reads GameState + the GameEvent stream + the wave report,
 * keeps a small lifetime stat blob (persisted), and reports newly-unlocked
 * achievements for a toast. Early "tutorial-step" milestones are deliberately
 * absent — the first unlock requires real progress (≈ wave 10).
 */
import type { GameEvent, GameState, ModelDef, WaveReport } from './core/types'
import { CAMPAIGN_THEMES } from './sim/campaign'
import { BUILD_ORDER, WAVES } from './sim/content'
import { resolveModel } from './sim/effects'

export type AchCategory =
  | 'progress'
  | 'economy'
  | 'serving'
  | 'safety'
  | 'models'
  | 'studio'
  | 'research'
  | 'hardware'
  | 'history'
  | 'hidden'

export interface AchievementDef {
  id: string
  category: AchCategory
  /** English source (zh-TW via i18n `ach.<id>.name`). */
  name: string
  desc: string
  /** shown as "???" until unlocked. */
  hidden?: boolean
  /** tiered thresholds (bronze/silver/gold); the UI shows a progress bar to the next. */
  goals?: number[]
}

export const ACH_CATEGORIES: AchCategory[] = [
  'progress',
  'economy',
  'serving',
  'safety',
  'models',
  'studio',
  'research',
  'hardware',
  'history',
  'hidden',
]

export const ACHIEVEMENTS: AchievementDef[] = [
  // --- progress ---
  { id: 'p_wave10', category: 'progress', name: 'Double Digits', desc: 'Reach wave 10 — your first boss.' },
  { id: 'p_wave50', category: 'progress', name: 'Halfway', desc: 'Reach wave 50.' },
  { id: 'p_win', category: 'progress', name: 'Platform Scaled', desc: 'Clear all 100 waves and win the campaign.' },
  { id: 'p_endless', category: 'progress', name: 'Into the Unknown', desc: 'Enter endless mode beyond wave 100.' },
  { id: 'p_brink', category: 'progress', name: 'On the Brink', desc: 'Clear a wave with Trust below 25.' },
  { id: 'p_comeback', category: 'progress', name: 'Comeback', desc: 'Recover from Trust under 10 back above 50 in one run.', hidden: true },
  // --- economy ---
  { id: 'e_tycoon', category: 'economy', name: 'Throughput Tycoon', desc: 'Earn token revenue across all runs.', goals: [25000, 100000, 1000000] },
  { id: 'e_hyperscaler', category: 'economy', name: 'Hyperscaler', desc: 'Field a rack fleet worth over $5M in capex.' },
  { id: 'e_fulltilt', category: 'economy', name: 'Full Tilt', desc: 'Drive fleet utilization above 90% during a wave.' },
  { id: 'e_lean', category: 'economy', name: 'Lean Machine', desc: 'Clear a wave with 3 or fewer racks.' },
  // --- serving ---
  { id: 's_flawless', category: 'serving', name: 'Flawless', desc: 'Finish a wave at 100% Goodput.' },
  { id: 's_throughput', category: 'serving', name: 'Throughput', desc: 'Serve requests across all runs.', goals: [5000, 25000, 100000] },
  { id: 's_zeroleak', category: 'serving', name: 'Zero Leak', desc: 'End a run past wave 30 with not a single leak.', hidden: true },
  { id: 's_cache', category: 'serving', name: 'Cache King', desc: 'Land 100+ cache hits in one wave.' },
  { id: 's_speed', category: 'serving', name: 'Speed Demon', desc: 'Keep p95 TTFT inside the interactive SLO for a whole wave.' },
  // --- safety ---
  { id: 'sf_cleanhands', category: 'safety', name: 'Clean Hands', desc: 'Clear a jailbreak-storm wave with zero unsafe answers.' },
  { id: 'sf_unbreached', category: 'safety', name: 'Unbreached', desc: 'Finish a run (past wave 20) with zero unsafe answers.' },
  { id: 'sf_depth', category: 'safety', name: 'Defense in Depth', desc: 'Run all three guardrail types at once.' },
  { id: 'sf_nofalse', category: 'safety', name: 'No False Positives', desc: 'Clear a wave with a guardrail active and zero over-refusals.' },
  // --- models ---
  { id: 'm_trillion', category: 'models', name: 'Trillion Club', desc: 'Deploy a model with a trillion+ parameters.' },
  { id: 'm_longmem', category: 'models', name: 'Long Memory', desc: 'Deploy a model with a 1M-token context window.' },
  { id: 'm_david', category: 'models', name: 'David', desc: 'Clear a wave using only models of 9B or fewer parameters.', hidden: true },
  { id: 'm_collector', category: 'models', name: 'Collector', desc: 'Deploy distinct base models across all runs.', goals: [10, 25, 42] },
  // --- studio ---
  { id: 'st_first', category: 'studio', name: 'First Checkpoint', desc: 'Train your first checkpoint in the Studio.' },
  { id: 'st_mad', category: 'studio', name: 'Mad Scientist', desc: 'Use every post-training method across all runs.' },
  { id: 'st_deep', category: 'studio', name: 'Deep Lineage', desc: 'Create a checkpoint three derivations deep.' },
  { id: 'st_reasoner', category: 'studio', name: 'Reasoner Forged', desc: 'Train a reasoning or agentic specialist with GRPO.' },
  { id: 'st_alchemist', category: 'studio', name: 'Alchemist', desc: 'Use merge, distillation and QAT across all runs.' },
  // --- research ---
  { id: 'r_tree', category: 'research', name: 'Tech Tree Complete', desc: 'Research all 22 infrastructure nodes.' },
  { id: 'r_side', category: 'research', name: 'Pick a Side', desc: 'Research chunked prefill or P/D disaggregation.' },
  { id: 'r_kv', category: 'research', name: 'KV Hierarchy', desc: 'Research INT4 KV cache, KV offloading and prefix caching.' },
  { id: 'r_parallel', category: 'research', name: 'All Parallel', desc: 'Research tensor, pipeline, data and expert parallelism.' },
  { id: 'r_redteam', category: 'research', name: 'Red Team II', desc: 'Complete the second red-team evaluation.' },
  // --- hardware ---
  { id: 'h_pod', category: 'hardware', name: 'To the Pod', desc: 'Build a Pod-class rack.' },
  { id: 'h_giga', category: 'hardware', name: 'NVL72', desc: 'Build the top-tier giga rack.' },
  { id: 'h_liquid', category: 'hardware', name: 'Liquid Cooled', desc: 'Build a liquid cooling loop.' },
  { id: 'h_oneofeach', category: 'hardware', name: 'One of Everything', desc: 'Have one of every building type on the board.' },
  // --- history (real 2023-2026 bosses & crises) ---
  { id: 'hi_gpu', category: 'history', name: 'GPU Shortage Survivor', desc: 'Survive the Great GPU Shortage.' },
  { id: 'hi_price', category: 'history', name: 'Price War', desc: 'Weather a token price-war wave.' },
  { id: 'hi_euact', category: 'history', name: 'EU AI Act Audit', desc: 'Pass a regulatory audit wave.' },
  { id: 'hi_power', category: 'history', name: 'Keep the Lights On', desc: 'Survive a grid power-spike wave.' },
  { id: 'hi_heat', category: 'history', name: 'Beat the Heat', desc: 'Survive a cooling-failure wave.' },
  { id: 'hi_reroute', category: 'history', name: 'Reroute', desc: 'Survive a single-lane ingress surge.' },
  { id: 'hi_boss', category: 'history', name: 'Boss Slayer', desc: 'Clear boss waves in one run.', goals: [3, 6, 12] },
  // --- hidden / fun ---
  { id: 'x_brownout', category: 'hidden', name: 'Brownout Survivor', desc: 'Clear a wave while a brownout strikes.', hidden: true },
  { id: 'x_minimalist', category: 'hidden', name: 'Minimalist', desc: 'Win the campaign with 8 or fewer racks.', hidden: true },
  { id: 'x_agent', category: 'hidden', name: 'Agent Overlord', desc: 'Hand a run to a terminal agent over the bridge.', hidden: true },
  { id: 'x_hoarder', category: 'hidden', name: 'Hoarder', desc: 'Stockpile 500 Data.', hidden: true },
]

export const ACH_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]))

const INFRA_IDS = [
  'inf_batching', 'inf_multistep', 'inf_chunked', 'inf_disagg', 'inf_spec', 'inf_par_tp', 'inf_par_pp',
  'inf_par_dp', 'inf_par_ep', 'inf_routing', 'inf_engine_sglang', 'inf_engine_trtllm', 'inf_flash',
  'inf_kvquant_fp8', 'inf_kvquant_int4', 'inf_offload', 'inf_paged', 'inf_prefix', 'inf_wq_fp8',
  'inf_wq_int4', 'inf_wq_nvfp4', 'inf_multilora',
]

interface LifetimeStats {
  served: number
  cashEarned: number
  modelsDeployed: string[]
  methodsUsed: string[]
}

const KEY = 'gptd_achievements'
const VERSION = 1

function loadStore(): { unlocked: Record<string, number>; lifetime: LifetimeStats } {
  const def = { unlocked: {} as Record<string, number>, lifetime: { served: 0, cashEarned: 0, modelsDeployed: [], methodsUsed: [] } }
  try {
    if (typeof localStorage === 'undefined') return def
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    const p = JSON.parse(raw) as { unlocked?: Record<string, number>; lifetime?: Partial<LifetimeStats> }
    return {
      unlocked: p.unlocked ?? {},
      lifetime: {
        served: p.lifetime?.served ?? 0,
        cashEarned: p.lifetime?.cashEarned ?? 0,
        modelsDeployed: p.lifetime?.modelsDeployed ?? [],
        methodsUsed: p.lifetime?.methodsUsed ?? [],
      },
    }
  } catch {
    return def
  }
}

/** Drives all achievement unlocking from the UI layer (no sim coupling). */
export class AchievementTracker {
  private unlocked: Record<string, number>
  private lifetime: LifetimeStats
  private pending: AchievementDef[] = []
  // per-run transient state
  private bosses = 0
  private comebackArmed = false
  private brownoutThisWave = false
  private agentRun = false

  constructor() {
    const s = loadStore()
    this.unlocked = s.unlocked
    this.lifetime = s.lifetime
  }

  isUnlocked(id: string): boolean {
    return (this.unlocked[id] ?? 0) > 0
  }
  levelOf(id: string): number {
    return this.unlocked[id] ?? 0
  }
  unlockedCount(): number {
    return Object.values(this.unlocked).filter((v) => v > 0).length
  }
  drainUnlocks(): AchievementDef[] {
    if (!this.pending.length) return []
    const out = this.pending
    this.pending = []
    return out
  }

  private persist(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify({ v: VERSION, unlocked: this.unlocked, lifetime: this.lifetime }))
      }
    } catch {
      /* ignore */
    }
  }
  private grant(id: string, level = 1): void {
    if ((this.unlocked[id] ?? 0) >= level) return
    this.unlocked[id] = level
    const def = ACH_BY_ID[id]
    if (def) this.pending.push(def)
    this.persist()
  }
  private addToSet(arr: string[], v: string): boolean {
    if (arr.includes(v)) return false
    arr.push(v)
    return true
  }

  /** Live metric behind a tiered achievement (lifetime + current run). */
  progressOf(id: string, s: GameState | null): { level: number; cur: number; max: number } {
    const def = ACH_BY_ID[id]
    const level = this.levelOf(id)
    if (!def?.goals) return { level, cur: level, max: 1 }
    const cur = this.metric(id, s)
    const max = def.goals[Math.min(level, def.goals.length - 1)]
    return { level, cur, max }
  }
  private metric(id: string, s: GameState | null): number {
    if (id === 's_throughput') return this.lifetime.served + (s?.stats.served ?? 0)
    if (id === 'e_tycoon') return this.lifetime.cashEarned + (s?.stats.cashEarned ?? 0)
    if (id === 'm_collector') return this.lifetime.modelsDeployed.length
    if (id === 'hi_boss') return this.bosses
    return 0
  }
  private bumpTier(id: string, value: number): void {
    const goals = ACH_BY_ID[id]?.goals
    if (!goals) return
    let lvl = 0
    for (const g of goals) if (value >= g) lvl++
    if (lvl > (this.unlocked[id] ?? 0)) this.grant(id, lvl)
  }

  // ---- lifecycle hooks (called from game.ts) ----
  resetRun(): void {
    this.bosses = 0
    this.comebackArmed = false
    this.brownoutThisWave = false
    this.agentRun = false
  }
  markAgentMode(): void {
    this.agentRun = true
    this.grant('x_agent')
  }

  onEvent(_s: GameState, ev: GameEvent): void {
    if (ev.type === 'brownout') this.brownoutThisWave = true
    else if (ev.type === 'wave-start') this.brownoutThisWave = false
    else if (ev.type === 'win') this.grant('p_win')
  }

  /** Per-frame state scan (cheap; reads live state). */
  tick(s: GameState): void {
    const m = s.meters
    // comeback: dropped under 10, recovered above 50
    if (m.trust < 10) this.comebackArmed = true
    if (this.comebackArmed && m.trust >= 50) this.grant('p_comeback')
    // economy / data
    if (s.fleetCapexUsd >= 5_000_000) this.grant('e_hyperscaler')
    if (s.phase === 'wave' && s.utilization >= 0.9) this.grant('e_fulltilt')
    if (s.data >= 500) this.grant('x_hoarder')
    this.bumpTier('e_tycoon', this.metric('e_tycoon', s))
    this.bumpTier('s_throughput', this.metric('s_throughput', s))
    if (s.endless) this.grant('p_endless')

    // towers: hardware, guardrails, buildings, deployed models
    const kinds = new Set<string>()
    let hasEnc = false, hasLlm = false, hasMod = false
    for (const t of s.towers) {
      kinds.add(t.def.id)
      if (t.hwId === 'hw_pod' || t.hwId === 'hw_superpod' || t.hwId === 'hw_giga') this.grant('h_pod')
      if (t.hwId === 'hw_giga') this.grant('h_giga')
      if (t.def.kind === 'cooling_liquid') this.grant('h_liquid')
      if (t.def.id === 'guard_encoder') hasEnc = true
      if (t.def.id === 'guard_llm') hasLlm = true
      if (t.def.id === 'guard_mod') hasMod = true
      if (t.modelId) {
        const md = resolveModel(s, t.modelId)
        if (md) {
          if (md.origin === 'base' && this.addToSet(this.lifetime.modelsDeployed, md.id)) this.persist()
          if (md.paramsTotalB >= 1000) this.grant('m_trillion')
          if (md.contextWindowK >= 1000) this.grant('m_longmem')
        }
      }
    }
    if (hasEnc && hasLlm && hasMod) this.grant('sf_depth')
    if (BUILD_ORDER.every((id) => kinds.has(id))) this.grant('h_oneofeach')
    this.bumpTier('m_collector', this.lifetime.modelsDeployed.length)

    // studio: scan derived checkpoints for methods / depth / specialists
    let merge = false, distill = false, qat = false
    for (const d of Object.values(s.derivedModels)) {
      const lg = d.lineage
      if (!lg) continue
      this.grant('st_first')
      if (this.addToSet(this.lifetime.methodsUsed, lg.method)) this.persist()
      if (lg.depth >= 3) this.grant('st_deep')
      if (lg.method === 'grpo' && (lg.target === 'reasoning' || lg.target === 'agentic')) this.grant('st_reasoner')
      if (lg.method === 'merge') merge = true
      if (lg.method === 'distill') distill = true
      if (lg.method === 'qat') qat = true
    }
    const mset = this.lifetime.methodsUsed
    if (merge || mset.includes('merge')) merge = true
    if (distill || mset.includes('distill')) distill = true
    if (qat || mset.includes('qat')) qat = true
    if (merge && distill && qat) this.grant('st_alchemist')
    if (mset.length >= 12) this.grant('st_mad')

    // research
    const up = s.upgrades
    if (INFRA_IDS.every((id) => (up[id] ?? 0) > 0)) this.grant('r_tree')
    if ((up['inf_chunked'] ?? 0) > 0 || (up['inf_disagg'] ?? 0) > 0) this.grant('r_side')
    if ((up['inf_kvquant_int4'] ?? 0) > 0 && (up['inf_offload'] ?? 0) > 0 && (up['inf_prefix'] ?? 0) > 0) this.grant('r_kv')
    if (['inf_par_tp', 'inf_par_pp', 'inf_par_dp', 'inf_par_ep'].every((id) => (up[id] ?? 0) > 0)) this.grant('r_parallel')
    if ((up['eval_redteam'] ?? 0) >= 2) this.grant('r_redteam')
  }

  onWaveCleared(s: GameState, report: WaveReport | null): void {
    if (this.brownoutThisWave) this.grant('x_brownout')
    this.brownoutThisWave = false
    if (s.meters.trust < 25) this.grant('p_brink')

    const idx = report?.waveIndex ?? s.waveIndex
    if (idx >= 9) this.grant('p_wave10')
    if (idx >= 49) this.grant('p_wave50')
    if (idx >= WAVES.length) this.grant('p_endless')

    // real-history bosses & crises (only in the authored campaign range)
    const theme = idx >= 0 && idx < CAMPAIGN_THEMES.length ? CAMPAIGN_THEMES[idx] : null
    if (theme) {
      if (theme.boss) {
        this.bosses++
        this.bumpTier('hi_boss', this.bosses)
      }
      switch (theme.special) {
        case 'gpu-shortage': this.grant('hi_gpu'); break
        case 'price-war': this.grant('hi_price'); break
        case 'regulatory-audit': this.grant('hi_euact'); break
        case 'power-spike': this.grant('hi_power'); break
        case 'cooling-failure': this.grant('hi_heat'); break
        case 'single-lane-surge': this.grant('hi_reroute'); break
      }
    }

    if (!report) return
    const answered = report.served + report.bad
    if (report.served > 0 && report.goodputPct >= 99.5) this.grant('s_flawless')
    if (report.cacheHits >= 100) this.grant('s_cache')
    if (answered > 20 && report.p95Ttft > 0 && report.p95Ttft <= 0.4) this.grant('s_speed')

    // deployed servers this wave
    const servers = s.towers.filter((t) => t.def.kind === 'server' && t.modelId)
    if (servers.length > 0 && servers.length <= 3) this.grant('e_lean')
    // David: only small (<=9B) models deployed
    const sizes = servers.map((t) => resolveModel(s, t.modelId!)).filter(Boolean) as ModelDef[]
    if (sizes.length > 0 && sizes.every((md) => md.paramsTotalB <= 9)) this.grant('m_david')
    // safety: clean jailbreak wave / no false positives
    if (report.unsafe === 0 && (report.byType?.jailbreak?.served ?? 0) > 0) this.grant('sf_cleanhands')
    const hasGuard = s.towers.some((t) => t.def.kind === 'guardrail')
    if (report.overRefused === 0 && hasGuard && answered > 20) this.grant('sf_nofalse')
  }

  onRunEnd(s: GameState, _won: boolean): void {
    if (s.stats.unsafe === 0 && s.waveIndex >= 20) this.grant('sf_unbreached')
    if (s.stats.leaked === 0 && s.waveIndex >= 30) this.grant('s_zeroleak')
    if (s.phase === 'won') {
      const racks = s.towers.filter((t) => t.def.kind === 'server').length
      if (racks <= 8) this.grant('x_minimalist')
    }
    // fold this run's totals into the lifetime counters (live progress used run deltas)
    this.lifetime.served += s.stats.served
    this.lifetime.cashEarned += s.stats.cashEarned
    this.persist()
  }
}
