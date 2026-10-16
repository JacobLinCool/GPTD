/* ------------------------------------------------------------------ *
 *  CAMPAIGN — the 100-wave real-history escalation gauntlet.          *
 * ------------------------------------------------------------------ *
 *
 * The campaign replays the real 2023→2026 data-center-inference era as a
 * MONOTONICALLY escalating elimination gauntlet. Every wave is a real event that
 * hit providers — a DEMAND SHIFT (the ChatGPT boom, the RAG and coding-assistant
 * waves, the DeepSeek-R1 reasoning flood, the agent majority) or an OPERATING
 * SHOCK (the H100 shortage, cable cuts, grid emergencies, export bans, the EU AI
 * Act, the inference price war, outages and agent attacks). Model and chip
 * launches are not waves: those are the player's tools. Difficulty climbs from
 * wave 1 (early 2023, tier 1) to wave 100 (late 2026, tier 12). Reaching wave 100
 * is the apex; most runs end mid-campaign; endless mode (endless.ts) resumes at
 * the wave-100 load and keeps climbing.
 *
 * To keep 100 waves CONSISTENT and re-tunable, the campaign is generated from a
 * compact authored theme table (CAMPAIGN_THEMES, one row per wave) by a pure,
 * deterministic builder. The numeric difficulty lives in ONE place — the tier*
 * functions below — so the whole curve is tuned by editing a handful of knobs,
 * not 100 hand-written spawn tables. Per-wave VARIETY (which archetypes, which
 * special event) is the authored theme; per-run VARIABILITY is the live incident
 * system (sim.ts, seeded by s.rng). Nothing here uses RNG — the table is static.
 */

import { CLEAR_BONUS_SCALE } from '../config'
import type { RequestTypeDef, SafetyProfile, SpawnGroup, WaveDef } from '../core/types'
import { LANE_COUNT } from './pathing'

// the 100 authored real-history waves (generated from the research synthesis).
export { CAMPAIGN_THEMES } from './campaign-data'

/** One archetype's emphasis within a wave (ordered by prominence). */
export interface WaveMixEntry {
  typeId: string
  /** relative prominence (0.1..3) — splits the wave's request budget. */
  weight: number
  /**
   * Authored prompt-length stretch for this lane on top of the era curve (a companion
   * wave's long chat histories, a long-document wave's whole files). Default 1.
   */
  contextMul?: number
  /** Authored hazard override: arms a lane the event weaponised (RAG-borne injection). */
  hazards?: SafetyProfile
}

export type WaveVolume = 'trickle' | 'steady' | 'heavy' | 'flood' | 'extreme'

/**
 * The authored special event a wave dramatizes. `single-lane-surge` is structural
 * (the builder funnels every burst through one ingress — a cable cut / regional
 * outage); the others name the category of a DETERMINISTIC between-wave incident
 * that sim.ts forces for that wave (overriding the random roll), so a real event
 * lands its signature consequence (DeepSeek's price war, a grid emergency, the EU
 * AI Act audit…). A theme's explicit `incident` picks the exact incident inside the
 * category. `none` leaves the wave to the random incident roll.
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
  | 'jailbreak-storm'

/** One authored campaign wave (a real event), expanded into a WaveDef by buildCampaign. */
export interface WaveTheme {
  /** e.g. "2023 Q1", "2025 Q2", "2026 Q3" */
  era: string
  name: string
  /** the real event this wave dramatizes (named + dated). */
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
  /**
   * The exact INCIDENTS id this wave forces, overriding the special's default mapping
   * (e.g. a cooling wave caused by drought forces the water restriction, not a loop
   * fault). A single-lane surge can also carry its named outage this way.
   */
  incident?: string
  /** boss-grade spike (≈ every 10th wave): a bigger budget, a forced hard incident, a bigger contract. */
  boss?: boolean
}

/* ------------------------------------------------------------------ *
 *  Difficulty knobs — the WHOLE 100-wave curve is tuned here.         *
 * ------------------------------------------------------------------ */

/** Overall request-volume feel → a budget multiplier on the wave's burst count. */
export const VOLUME_FACTOR: Record<WaveVolume, number> = {
  trickle: 0.6,
  steady: 1.0,
  heavy: 1.55,
  flood: 2.3,
  extreme: 3.2,
}

/** A boss wave's request budget over a regular wave of the same tier and volume. */
export const BOSS_BUDGET_MUL = 1.25

/**
 * Total sprite budget for a wave: grows with tier and volume. Elimination is
 * primarily THROUGHPUT-bound — the board is finite, so a flood eventually
 * outruns even a maxed fleet. Tier 1 steady ≈ 15 sprites; tier 12 extreme ≈ 189
 * (a boss ×1.25).
 */
export function waveBudget(tier: number, volume: WaveVolume, boss = false): number {
  const base = 11 + tier * 4.0
  return Math.round(base * VOLUME_FACTOR[volume] * (boss ? BOSS_BUDGET_MUL : 1))
}

/**
 * Per-request generation load (decode tokens). Ramps CONVEXLY — gentle early,
 * steep late — toward ~3× by tier 12 before the late-load amplifier is applied
 * in groupMuls. Early waves stay near 1.0×. Throughput pressure scales, but a
 * maxed fleet + long-context tech keeps single requests servable (validated by
 * the autoplay depth gate).
 */
function tierWork(tier: number): number {
  const r = (tier - 1) / 11
  return 1 + Math.pow(r, 1.5) * 2
}

/**
 * Benchmark hardness (the quality line a model must clear). Escalates but is
 * CAPPED so the hardest lanes stay clearable by a maxed build + trained
 * specialist (the apex requires the full tech tree, not an impossible model).
 * Capped at +20% (tier ≥ 11) — e.g. reason 82 → ~98, still inside frontier reach.
 */
export function tierComplexity(tier: number): number {
  return 1 + Math.min(tier - 1, 10) * 0.02
}

/**
 * Prompt-length inflation — the real 8K→1M context-window arc (REALISM §1.8). Ramps
 * CONVEXLY to ~2.9× by tier 12. Combined with √workMul plus lateLoadMul, the
 * effective prefill load reaches real long-context territory (RAG/agent ≈70-100K
 * input tokens, summarization ≈140K). Mooncake/Kimi conversation avg ≈12K input,
 * long-doc QA ≈100K; agentic coding steps push 100K-2M. This finally pressures
 * the model context window + the KV / prefill / prefix-cache tech tree.
 */
function tierContext(tier: number): number {
  const r = (tier - 1) / 11
  return 1 + Math.pow(r, 1.5) * 1.9
}

/**
 * Era HAZARD PRESSURE (§3.6): attack sophistication rose over 2023→2026 — manual DAN
 * role-play, then GCG transferable suffixes, many-shot jailbreaks, then indirect and
 * agentic injection (EchoLeak 2025, the 2026 agent intrusions). Every hazard severity
 * an archetype carries is multiplied by this (and clamped to 1): +3.5% per tier, so a
 * tier-12 injection lands ≈1.4× its 2023 severity and a model's alignment self-handles
 * less of it.
 */
export function hazardMulOf(tier: number): number {
  return Math.min(1.4, 1 + 0.035 * (tier - 1))
}

/**
 * The share of an era's attacks that are NOVEL — adaptive variants a classifier guard
 * never trained on (guards.ts: an encoder keeps ~45% of its recall on them, a moderation
 * endpoint ~70%, a generative judge all of it). Zero through 2023 Q1 (tier ≤ 2), then
 * +5% per tier to half of all attacks by tier 12: late safety needs a generative judge
 * or a well-aligned model, not just more copies of one classifier.
 */
export function novelShareOf(tier: number): number {
  return Math.max(0, Math.min(0.5, 0.05 * (tier - 2)))
}

/** Tiers over which the SLA contracts ramp in (the 2023 customers are free-tier consumers). */
export const CONTRACT_RAMP_TIERS = 5

/**
 * The SLA-contract value of clearing a wave at 100% Goodput (pre-CLEAR_BONUS_SCALE).
 * It grows with tier (bigger customers, bigger contracts) and RAMPS IN over the first
 * CONTRACT_RAMP_TIERS tiers, so the opening waves are funded by token revenue — clean,
 * on-time serving is what pays first, not the clear bonus. A boss wave carries a large
 * premium (it is also harder). Past tier 10 the contract tapers (−12% per tier): late
 * token income dwarfs it, and cash is no longer the binding constraint there.
 */
export function tierBonus(tier: number, boss: boolean): number {
  const ramp = Math.min(1, tier / CONTRACT_RAMP_TIERS)
  const lateTaper = tier <= 10 ? 1 : 1 - 0.12 * (tier - 10)
  return Math.round((40 * tier + (boss ? 320 : 0)) * ramp * lateTaper)
}

/**
 * The cash a cleared wave's SLA contract actually pays: the authored contract value ×
 * CLEAR_BONUS_SCALE × the wave's Goodput (clean serves ÷ every request). A wave that
 * served 60% cleanly collects 60% of the contract — late, wrong, unsafe, refused,
 * rejected and dropped requests all forfeit their share.
 */
export function contractPayout(clearBonus: number, goodputPct: number): number {
  const share = Math.max(0, Math.min(1, goodputPct / 100))
  return Math.round(clearBonus * CLEAR_BONUS_SCALE * share)
}

/**
 * Per-archetype length-scaling sensitivity (0..1): how much of the era's token
 * inflation each lane actually takes. Long-context / offline lanes (RAG, summ,
 * agent, reason) scale FULLY toward real 2024-25 magnitudes; latency-critical
 * interactive lanes (chat / code-completion / jailbreak — tight TTFT) scale LESS
 * so they stay inside their SLO instead of mass-slo_missing. Difficulty is NOT
 * damped here (that is tierComplexity, capped separately).
 */
const LENGTH_SENS: Record<string, number> = {
  embed: 0.6,
  chat: 0.4,
  comp: 0.5,
  rag: 1.0,
  summ: 1.0,
  reason: 0.9,
  agent: 1.0,
  batch: 0.8,
  jailbreak: 0.3,
}

/** The authored campaign tier ceiling (wave 100 ≈ late 2026, tier 12). */
export const MAX_TIER = 12

/**
 * Late-game per-request COMPUTE amplifier. tierWork/tierContext keep single requests
 * comfortably servable through the teaching arc, but by the endgame a maxed fleet has
 * so much headroom that a request is one-shot the instant it spawns — compute outruns
 * demand and the late waves stop pressuring throughput. This multiplier is exactly 1
 * through the mid-game (tier ≤ 6, ≈ waves 1-33, so the build-out arc is untouched) and
 * ramps QUADRATICALLY from the late tiers — gentle at tier 7, steep across tiers 10-12
 * (≈ waves 56-100) — so an endgame request demands materially more prefill ingest AND
 * decode generation. It amplifies the tier-scaling DELTA (not the base), so the per-lane
 * LENGTH_SENS damping still protects the tight-SLO interactive lanes.
 */
export const LATE_LOAD_GAIN = 7
export function lateLoadMul(tier: number): number {
  if (tier <= 6) return 1
  const t = (tier - 6) / (MAX_TIER - 6) // 0 at tier 6 → 1 at tier 12
  return 1 + t * t * LATE_LOAD_GAIN
}

/** The per-request scaling a burst of one archetype carries at a tier. */
export interface GroupMuls {
  /** decode (and, via √, prefill) load. */
  workMul: number
  /** prompt-length / long-context demand. */
  contextMul: number
  /** quality-line hardness. */
  complexityMul: number
}

/**
 * The ONE place the era's per-request scaling is computed — buildWave AND the endless
 * generator call it, so endless resumes exactly where wave 100 leaves off. Amplifies the
 * late-game COMPUTE demand via workMul only: workMul drives decode output tokens AND (via
 * √work) prefill input tokens, i.e. real prefill+decode SERVING TIME, WITHOUT touching
 * `context` (the quality-window difficulty). Inflating contextMul too would blow up the
 * contextGap quality penalty (bad answers → trust death) instead of creating the intended
 * throughput pressure, so contextMul keeps its authored curve.
 */
export function groupMuls(tier: number, typeId: string): GroupMuls {
  const sens = LENGTH_SENS[typeId] ?? 0.7
  return {
    workMul: Math.round((1 + (tierWork(tier) - 1) * sens * lateLoadMul(tier)) * 100) / 100,
    contextMul: Math.round((1 + (tierContext(tier) - 1) * sens) * 100) / 100,
    complexityMul: Math.round(tierComplexity(tier) * 100) / 100,
  }
}

/**
 * The late-game (max-tier) spawn token counts for an archetype — the SAME math
 * buildWave + spawnRequest apply at the end of the campaign (tier scaling ×
 * per-archetype LENGTH_SENS, then input = base × ctx × √work). The Codex shows
 * this as the "base → era" range so the displayed numbers aren't read as fixed.
 */
export function eraTokenRange(def: RequestTypeDef, tier = MAX_TIER): { input: number; output: number } {
  const m = groupMuls(tier, def.id)
  return {
    input: Math.round(def.inputTokens * m.contextMul * Math.max(1, Math.sqrt(m.workMul))),
    output: Math.round(def.outputTokens * m.workMul),
  }
}

/** Natural per-archetype cadence (seconds between spawns) at steady volume. */
export const BASE_INTERVAL: Record<string, number> = {
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

/** Seconds between a wave's staggered bursts (high-tier waves overlap more: sustained pressure). */
export function burstSpacing(tier: number): number {
  return Math.max(3, 7 - tier * 0.25)
}

/* ------------------------------------------------------------------ *
 *  Builder — pure theme → WaveDef expansion.                          *
 * ------------------------------------------------------------------ */

/** Expand one authored theme into a concrete WaveDef (deterministic, no RNG). */
export function buildWave(theme: WaveTheme): WaveDef {
  const { tier, volume } = theme
  const boss = theme.boss ?? false
  const budget = waveBudget(tier, volume, boss)
  const vf = VOLUME_FACTOR[volume]
  const hazardMul = Math.round(hazardMulOf(tier) * 1000) / 1000
  const novelShare = Math.round(novelShareOf(tier) * 100) / 100

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
    const delay = Math.round(i * burstSpacing(tier) * 10) / 10
    const muls = groupMuls(tier, m.typeId)
    const g: SpawnGroup = {
      typeId: m.typeId,
      count,
      interval: Math.round(interval * 100) / 100,
      delay,
      workMul: muls.workMul,
      complexityMul: muls.complexityMul,
      contextMul: Math.round(muls.contextMul * (m.contextMul ?? 1) * 100) / 100,
      hazardMul,
      novelShare,
    }
    if (m.hazards) g.hazards = { ...m.hazards }
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
 * Map a wave's authored `special` to its DEFAULT between-wave incident id (forced by
 * sim.ts for that wave, overriding the random roll); a theme's own `incident` field
 * takes precedence (themedIncidentForWave in content.ts). `none` and
 * `single-lane-surge` (structural) return null → the random incident roll applies.
 * Returns an incident id present in INCIDENTS (content.ts).
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
    case 'jailbreak-storm':
      return 'inc_jailbreak_storm'
    // single-lane-surge is structural (every burst pinned to one lane); none/unset
    // leaves the wave to the random incident roll (the per-run variability layer).
    default:
      return null
  }
}

/** The incident a theme forces: its explicit `incident`, else its special's default (null = random roll). */
export function themeIncidentId(theme: WaveTheme | undefined): string | null {
  if (!theme) return null
  return theme.incident ?? themedIncidentId(theme.special)
}
