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
 * category (e.g. `power-spike` is the grid category: its default is the capacity-auction
 * price spike, and a wave may force a curtailment, an interconnection freeze, an on-site fuel
 * spike or a firm nuclear PPA instead). `none` leaves the wave to the random incident roll.
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

/** The authored campaign tier ceiling (wave 100 ≈ late 2026, tier 12). */
export const MAX_TIER = 12

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
 * The steepest step a wave's request count may take over the wave before it (a boss: a little
 * steeper). The authored volume bands set the rhythm — breathers after a peak, floods in the busy
 * quarters — but a run is meant to end from ACCUMULATED pressure (the era's volume, tokens, quality
 * line, hazards and incidents climbing together), never from one wave that suddenly doubles the
 * load a fleet just proved it could carry. The cap counts the volume of the incident a wave
 * forces (campaignBudgets), and a boss's random hard incident is never a volume surge (sim.ts).
 */
export const STEP_CAP = 1.6
export const BOSS_STEP_CAP = 1.8

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
 * Benchmark hardness (the quality line a model must clear): +2% per tier, so the
 * line keeps rising through the last tier (reason / agent 82 → ≈100 at tier 12) while
 * staying inside the reach of the late roster's frontier and of a Studio specialist.
 */
export function tierComplexity(tier: number): number {
  return 1 + Math.min(Math.max(0, tier - 1), MAX_TIER - 1) * 0.02
}

/**
 * Era HAZARD PRESSURE (§3.6): attack sophistication rose over 2023→2026 — manual DAN
 * role-play, then GCG transferable suffixes, many-shot jailbreaks, then indirect and
 * agentic injection (EchoLeak 2025, the 2026 agent intrusions). Every hazard severity
 * an archetype carries is multiplied by this (and clamped to 1): +3.9% per tier, so a
 * tier-12 attack lands ≈1.43× its 2023 severity — a DAN-era jailbreak (0.7) becomes a
 * fully adaptive one (1.0), an agent's tool-borne injection 0.3 → 0.43 — and a model's
 * alignment self-handles less of it.
 */
export function hazardMulOf(tier: number): number {
  return Math.min(1.45, 1 + 0.039 * (tier - 1))
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

/**
 * The SLA contract (pre-CLEAR_BONUS_SCALE): what the platform's committed customers pay for a
 * wave served at 100% Goodput — subscriptions, reserved capacity, enterprise agreements; the
 * money that funds capacity the token meter alone cannot. A board rack stands for thousands of
 * real racks serving a few minutes of traffic, so in the opening waves token revenue covers a
 * small share of the bill: the contract is what makes clean, on-time serving pay from wave 1
 * (a dirty wave forfeits its share, contractPayout), and it grows with the era's customers. A
 * boss wave carries a premium (it is also harder). Late in the campaign token income — long
 * agent, RAG and summarization prompts at full price — becomes most of the revenue.
 */
export const CONTRACT_BASE = 160
export const CONTRACT_PER_TIER = 40
export const CONTRACT_BOSS_PREMIUM = 320

export function tierBonus(tier: number, boss: boolean): number {
  return Math.round(CONTRACT_BASE + CONTRACT_PER_TIER * tier + (boss ? CONTRACT_BOSS_PREMIUM : 0))
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
 * The era's token growth per archetype (REALISM §1.8): how much longer a tier-12 (late-2026)
 * prompt and answer are than the 2023 base lengths in REQUEST_TYPES. Prompts grew far more than
 * answers — conversation history, retrieved context, repository context and accumulated agent
 * state all landed in the prompt (OpenRouter's 100T-token study: average prompts ≈4× longer,
 * completions ≈3× longer over the period) — so each lane ends inside the real band of its IETF
 * workload profile (REFERENCE-DOSSIER §1.4):
 *   embed   2K → 6K-token chunks            (EMBED 16–8K)
 *   chat    512 / 256 → 2.6K / 510          (CHAT 64–16K / 50–1K; history + system prompt)
 *   comp    1.5K / 150 → 7.5K / 200         (COMP 256–8K / 5–200; suggestions stay short)
 *   rag     8K / 512 → 48K / 820            (LDQA 4K–128K)
 *   summ    12K / 400 → 96K / 1K            (whole documents; prefill dominates)
 *   reason  512 / 6K → 2K / 12K             (NVIDIA reasoning OSL 1K–10K+; R1-class long CoT)
 *   agent   6K / 800 → 48K / 1K per step    (AGNT: context accumulates, output per step stays short)
 *   batch   1K / 4K → 3K / 8K               (CGEN 256–8K)
 *   jailbreak 600 / 400 → 3K / 500          (many-shot jailbreaks are long prompts)
 * Hidden reasoning comes on top of the answer for a model that thinks (§1.4). Per-request work
 * stays physically servable at real per-user speeds; the late game is hard through volume,
 * mix, the quality line, hazards and incidents, not through impossible requests.
 */
export const ERA_TOKEN_GROWTH: Record<string, { prompt: number; output: number }> = {
  embed: { prompt: 3, output: 1 },
  chat: { prompt: 5, output: 2 },
  comp: { prompt: 5, output: 1.33 },
  rag: { prompt: 6, output: 1.6 },
  summ: { prompt: 8, output: 2.5 },
  reason: { prompt: 4, output: 2 },
  agent: { prompt: 8, output: 1.25 },
  batch: { prompt: 3, output: 2 },
  jailbreak: { prompt: 5, output: 1.25 },
}

/** Growth for an archetype the table does not list (a moderate default). */
const DEFAULT_TOKEN_GROWTH = { prompt: 3, output: 1.5 }

/**
 * How far along the era's token growth a tier sits (0 at tier 1 → 1 at MAX_TIER). Convex:
 * 2023 prompts stay near their base lengths while the 2025–26 tiers carry most of the growth
 * (the long-context, agent and reasoning years).
 */
export function eraTokenRamp(tier: number): number {
  const r = Math.min(1, Math.max(0, (tier - 1) / (MAX_TIER - 1)))
  return Math.pow(r, 1.5)
}

/** The per-request scaling a burst of one archetype carries at a tier. */
export interface GroupMuls {
  /** answer-length (decode) multiplier. */
  workMul: number
  /**
   * prompt multiplier as spawnRequest applies it (input = base × contextMul × √workMul):
   * the era's prompt growth with the √workMul share divided out, so a prompt grows by exactly
   * its ERA_TOKEN_GROWTH factor.
   */
  contextMul: number
  /** quality-line hardness. */
  complexityMul: number
}

/**
 * The ONE place the era's per-request scaling is computed — buildWave AND the endless
 * generator call it, so endless resumes exactly where wave 100 leaves off.
 */
export function groupMuls(tier: number, typeId: string): GroupMuls {
  const g = ERA_TOKEN_GROWTH[typeId] ?? DEFAULT_TOKEN_GROWTH
  const ramp = eraTokenRamp(tier)
  const workMul = Math.round((1 + (g.output - 1) * ramp) * 100) / 100
  const promptMul = 1 + (g.prompt - 1) * ramp
  return {
    workMul,
    contextMul: Math.round((promptMul / Math.max(1, Math.sqrt(workMul))) * 100) / 100,
    complexityMul: Math.round(tierComplexity(tier) * 100) / 100,
  }
}

/**
 * The late-game (max-tier) spawn token counts for an archetype — the SAME math
 * buildWave + spawnRequest apply at the end of the campaign (the archetype's
 * ERA_TOKEN_GROWTH on the eraTokenRamp via groupMuls, then input = base × ctx × √work).
 * The Codex shows this as the "base → era" range so the displayed numbers aren't read as fixed.
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

/** Expand one authored theme into a concrete WaveDef (deterministic, no RNG); `budget` defaults to its band's. */
export function buildWave(
  theme: WaveTheme,
  budget = waveBudget(theme.tier, theme.volume, theme.boss ?? false),
): WaveDef {
  const { tier, volume } = theme
  const boss = theme.boss ?? false
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

/**
 * The volume multiplier of the incident a theme FORCES (its signature incident), which
 * startWave applies to every burst. Default: none (×1) — content.ts passes the real lookup.
 */
export type ThemeVolumeOf = (theme: WaveTheme) => number

/**
 * The campaign's request budgets: each wave's band budget (waveBudget), capped so the load the
 * wave actually brings — its budget × its forced incident's volume — is at most STEP_CAP
 * (BOSS_STEP_CAP for a boss) × the load the wave before it brought, so the load climbs in steps
 * a growing fleet can follow even when a viral surge or an outage's retry storm lands on top.
 */
export function campaignBudgets(themes: WaveTheme[], volumeOf: ThemeVolumeOf = () => 1): number[] {
  const out: number[] = []
  let prevEff: number | undefined
  for (const th of themes) {
    const raw = waveBudget(th.tier, th.volume, th.boss ?? false)
    const v = Math.max(1e-6, volumeOf(th))
    const b =
      prevEff === undefined
        ? raw
        : Math.min(raw, Math.floor(Math.ceil(prevEff * (th.boss ? BOSS_STEP_CAP : STEP_CAP)) / v))
    out.push(b)
    prevEff = b * v
  }
  return out
}

/** Build the full campaign from the authored theme table (`volumeOf`: the forced incident's volume). */
export function buildCampaign(themes: WaveTheme[], volumeOf: ThemeVolumeOf = () => 1): WaveDef[] {
  const budgets = campaignBudgets(themes, volumeOf)
  return themes.map((th, i) => buildWave(th, budgets[i]))
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
