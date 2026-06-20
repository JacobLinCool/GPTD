/* ------------------------------------------------------------------ *
 *  CAMPAIGN — the 100-wave real-history escalation gauntlet.          *
 * ------------------------------------------------------------------ *
 *
 * The campaign dramatizes the real 2023→2026 data-center-inference era as a
 * MONOTONICALLY escalating elimination gauntlet: each wave is a specific real
 * event (GPT-4, the H100 shortage, Mixtral MoE, Claude 3, Gemini 1.5's 1M
 * window, GPT-4o, o1 reasoning, Llama-3.1-405B, Blackwell GB200, DeepSeek R1 +
 * the Jan-2025 crash, Stargate, the nuclear deals, the EU AI Act, agentic
 * coding, MCP, the inference price war…). Difficulty climbs from wave 1 (early
 * 2023, tier 1) to wave 100 (2026+, tier 12). Reaching wave 100 is the apex;
 * most runs die mid-campaign; endless mode (endless.ts) continues procedurally
 * beyond it.
 *
 * To keep 100 waves CONSISTENT and re-tunable, the campaign is generated from a
 * compact authored theme table (CAMPAIGN_THEMES, one row per wave) by a pure,
 * deterministic builder. The numeric difficulty lives in ONE place — the tier*
 * functions below — so the whole curve is tuned by editing a handful of knobs,
 * not 100 hand-written spawn tables. Per-wave VARIETY (which archetypes, which
 * special event) is the authored theme; per-run VARIABILITY is the live incident
 * system (sim.ts, seeded by s.rng). Nothing here uses RNG — the table is static.
 */

import type { SpawnGroup, WaveDef } from '../core/types'
import { LANE_COUNT } from './pathing'

// the 100 authored real-history waves (generated from the research synthesis).
export { CAMPAIGN_THEMES } from './campaign-data'

/** One archetype's emphasis within a wave (ordered by prominence). */
export interface WaveMixEntry {
  typeId: string
  /** relative prominence (0.1..3) — splits the wave's request budget. */
  weight: number
}

export type WaveVolume = 'trickle' | 'steady' | 'heavy' | 'flood' | 'extreme'

/**
 * The authored special event a wave dramatizes. `single-lane-surge` is structural
 * (the builder funnels the heaviest bursts through one ingress — a cable cut /
 * regional outage); the others name a DETERMINISTIC between-wave incident that
 * sim.ts forces for that wave (overriding the random roll), so a real event lands
 * its signature consequence (DeepSeek's price war, a power-grid crunch, the EU AI
 * Act audit…). `none` leaves the wave to the random incident roll.
 */
export type WaveSpecial =
  | 'none'
  | 'single-lane-surge'
  | 'power-spike'
  | 'cooling-failure'
  | 'gpu-shortage'
  | 'regulatory-audit'
  | 'contamination'
  | 'export-ban'
  | 'viral-bonus'
  | 'enterprise-demo'
  | 'price-war'

/** One authored campaign wave (a real event), expanded into a WaveDef by buildCampaign. */
export interface WaveTheme {
  /** e.g. "2023 Q1", "2025 Q2", "2026+", "near-future" */
  era: string
  name: string
  /** the real event this wave dramatizes (named + roughly dated). */
  realEvent: string
  /** in-game brief that explicitly references + dates the real event. */
  brief: string
  /** the data-center-inference lesson the wave drills. */
  teaches: string
  mix: WaveMixEntry[]
  volume: WaveVolume
  /** difficulty band 1..12, monotonically non-decreasing across the table. */
  tier: number
  special?: WaveSpecial
  /** boss-grade mixed-everything spike (≈ every 10th wave); widens the mix + bonus. */
  boss?: boolean
}

/* ------------------------------------------------------------------ *
 *  Difficulty knobs — the WHOLE 100-wave curve is tuned here.         *
 * ------------------------------------------------------------------ */

/** Overall request-volume feel → a budget multiplier on the wave's burst count. */
const VOLUME_FACTOR: Record<WaveVolume, number> = {
  trickle: 0.6,
  steady: 1.0,
  heavy: 1.55,
  flood: 2.3,
  extreme: 3.2,
}

/**
 * Total sprite budget for a wave: grows with tier and volume. Elimination is
 * primarily THROUGHPUT-bound — the board is finite, so a flood eventually
 * outruns even a maxed fleet. Tier 1 steady ≈ 16 sprites; tier 12 extreme ≈ 210.
 */
function waveBudget(tier: number, volume: WaveVolume): number {
  const base = 11 + tier * 4.0
  return Math.round(base * VOLUME_FACTOR[volume])
}

/**
 * Per-request generation load (decode tokens). Escalates moderately and PLATEAUS:
 * longer answers cost more decode time (throughput pressure), but we never make a
 * single request physically unservable. Tier 1 = 1.0× … tier 12 ≈ 1.5×.
 */
function tierWork(tier: number): number {
  return 1 + (tier - 1) * 0.045
}

/**
 * Benchmark hardness (the quality line a model must clear). Escalates but is
 * CAPPED so the hardest lanes stay clearable by a maxed build + trained
 * specialist (the apex requires the full tech tree, not an impossible model).
 * Capped at +20% (tier ≥ 11) — e.g. reason 82 → ~98, still inside frontier reach.
 */
function tierComplexity(tier: number): number {
  return 1 + Math.min(tier - 1, 10) * 0.02
}

/** Era token inflation (context windows grow 8k→128k→1M…): KV/prefill pressure. */
function tierContext(tier: number): number {
  return 1 + (tier - 1) * 0.05
}

/** Clear bonus (pre-CLEAR_BONUS_SCALE): a meaningful kicker that grows with tier. */
function tierBonus(tier: number, boss: boolean): number {
  return Math.round(60 + tier * 45 + (boss ? 320 : 0))
}

/** Natural per-archetype cadence (seconds between spawns) at steady volume. */
const BASE_INTERVAL: Record<string, number> = {
  embed: 0.32,
  chat: 0.72,
  comp: 0.95,
  rag: 1.2,
  summ: 1.25,
  reason: 1.2,
  agent: 1.8,
  batch: 1.35,
  jailbreak: 0.95,
}

/* ------------------------------------------------------------------ *
 *  Builder — pure theme → WaveDef expansion.                          *
 * ------------------------------------------------------------------ */

/** Expand one authored theme into a concrete WaveDef (deterministic, no RNG). */
export function buildWave(theme: WaveTheme): WaveDef {
  const { tier, volume } = theme
  const boss = theme.boss ?? false
  const budget = waveBudget(tier, volume)
  const vf = VOLUME_FACTOR[volume]
  const workMul = tierWork(tier)
  const complexityMul = tierComplexity(tier)
  const contextMul = tierContext(tier)

  const mix = theme.mix.length ? theme.mix : [{ typeId: 'chat', weight: 1 }]
  const totalWeight = mix.reduce((n, m) => n + m.weight, 0) || 1

  // a single-entry surge funnels the WHOLE wave through one ingress lane (a cable
  // cut / regional outage rerouting every request through one corridor — the
  // user-facing "traffic temporarily floods one entry"). Deterministic per wave so
  // the spatial puzzle is stable; the lane varies wave to wave via the realEvent.
  const surge = theme.special === 'single-lane-surge'
  const surgeLane = surge ? hashLane(theme.realEvent + theme.name) : -1

  const groups: SpawnGroup[] = mix.map((m, i) => {
    const share = m.weight / totalWeight
    const count = Math.max(1, Math.round(budget * share))
    // denser cadence at higher volume; the dominant (first) bursts arrive sooner.
    const interval = (BASE_INTERVAL[m.typeId] ?? 1.0) / Math.sqrt(vf)
    // stagger the bursts; high-tier waves overlap more (sustained pressure).
    const spacing = Math.max(3, 7 - tier * 0.25)
    const delay = Math.round(i * spacing * 10) / 10
    const g: SpawnGroup = {
      typeId: m.typeId,
      count,
      interval: Math.round(interval * 100) / 100,
      delay,
      workMul: Math.round(workMul * 100) / 100,
      complexityMul: Math.round(complexityMul * 100) / 100,
      contextMul: Math.round(contextMul * 100) / 100,
    }
    // a surge wave pins EVERY burst onto the one ingress lane — all traffic
    // crashes into one region while the other three sit idle (the spatial test).
    if (surge) g.lane = surgeLane
    return g
  })

  return {
    name: theme.name,
    brief: theme.brief,
    teaches: theme.teaches,
    clearBonus: tierBonus(tier, boss),
    groups,
  }
}

/** Stable lane index from a string (deterministic surge-lane placement). */
function hashLane(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % LANE_COUNT
}

/** Build the full campaign from the authored theme table. */
export function buildCampaign(themes: WaveTheme[]): WaveDef[] {
  return themes.map(buildWave)
}

/**
 * Map a wave's authored `special` to a DETERMINISTIC between-wave incident id
 * (forced by sim.ts for that wave, overriding the random roll). `none` and
 * `single-lane-surge` (structural) return null → the random incident roll
 * applies. Returns the incident id present in INCIDENTS (content.ts).
 */
export function themedIncidentId(special: WaveSpecial | undefined): string | null {
  switch (special) {
    case 'power-spike':
      return 'inc_pjm_capacity'
    case 'cooling-failure':
      return 'inc_cooling_failure'
    case 'gpu-shortage':
      return 'inc_h100_shortage'
    case 'regulatory-audit':
      return 'inc_regulatory_audit'
    case 'contamination':
      return 'inc_contamination'
    case 'export-ban':
      return 'inc_export_ban'
    case 'viral-bonus':
      return 'inc_viral_ghibli'
    case 'enterprise-demo':
      return 'inc_enterprise_demo'
    case 'price-war':
      return 'inc_price_war'
    // single-lane-surge is structural (every burst pinned to one lane); none/unset
    // leaves the wave to the random incident roll (the per-run variability layer).
    default:
      return null
  }
}
