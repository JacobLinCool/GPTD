import type {
  AlignmentProfile,
  GameState,
  GuardrailArchetype,
  ModelDef,
  Request,
  RequestTypeDef,
  SafetyHazard,
  SafetyProfile,
} from '../core/types'

/* ------------------------------------------------------------------ *
 *  TWO-LAYER SAFETY (§3) — the model-intrinsic first layer + the       *
 *  external guardrail second layer. Layer 1 is BAKED into the model    *
 *  (AlignmentProfile, P3b) and rolled once, at the first output token,  *
 *  by the model that produced it. Layer 2 is the guardrail buildings:   *
 *  each screens the lanes its range covers (guards.ts) — input checks   *
 *  before any compute (→ TTFT), output checks before delivery (→ E2EL). *
 *  The overall verdict (§3.4):                                          *
 *    handled iff ∀ h ∈ hazards: the model self-handles h  OR  a covering *
 *                               guardrail clears h.                      *
 *  An unsafe answer that is DELIVERED = unsafe breach; a hazardous       *
 *  request never answered is a plain leak. A BENIGN request wrongly      *
 *  refused (layer-1 over-refusal or a guard false positive) =            *
 *  overRefused (lost, not a breach; light Trust/SLA hit, §2.5).          *
 * ------------------------------------------------------------------ */

export const ALL_HAZARDS: SafetyHazard[] = ['jailbreak', 'injection', 'harmful', 'pii']

/**
 * §3.4 the length (tokens) of a model's answer to an attack it handles. A hard refusal is
 * a one-liner; a safe completion (gpt-oss / GPT-5 style) is a short, partial, safe answer —
 * more helpful on dual-use prompts, but it costs more decode.
 */
export const HANDLED_ATTACK_TOKENS: Record<AlignmentProfile['refusalStyle'], number> = {
  none: 30,
  'hard-refusal': 30,
  'safe-completion': 200,
}

/**
 * §3.6 layer-1 over-refusal of a BENIGN request: the model's borderline-prompt refusal
 * rate scaled by how much of this archetype's traffic is borderline (`refusalExposure`).
 */
export function modelOverRefusal(m: ModelDef, def: RequestTypeDef): number {
  return clamp01(m.alignment.overRefusal * def.refusalExposure)
}

/**
 * §3.2 alignment-tax weight by refusal style. Hard-refusal pays the steepest
 * capability tax; safe-completion (the §3.1 Pareto point) pays less; an un-aligned
 * base model pays none. Applied on TOP of qualityBy in serverQualityVs (not baked).
 */
export const TAX_K: Record<ModelDef['alignment']['refusalStyle'], number> = {
  none: 0,
  'hard-refusal': 9,
  'safe-completion': 4,
}

/**
 * §3.3 how hard each hazard is for a model's INTRINSIC alignment to self-handle
 * (injection is the hardest, jailbreak next; harmful/pii are easier). Higher →
 * a given severity erodes more of the model's effective safety.
 */
export const HAZARD_HARDNESS: Record<SafetyHazard, number> = {
  jailbreak: 0.35,
  injection: 0.55,
  harmful: 0.2,
  pii: 0.3,
}

/** §3.6 over-refusal convexity weight per guardrail archetype (overRefuse = K × threshold²). */
export const OVERREF_K: Record<GuardrailArchetype, number> = {
  encoder: 0.06,
  generative: 0.1,
  moderation: 0.05,
}

/**
 * §3.6 recall a guard family keeps against a NOVEL attack (an adaptive variant of the era —
 * a fresh suffix, many-shot or obfuscated injection — the classifier never trained on).
 * Fine-tuned classifiers are brittle under distribution shift and evasion (REFERENCE-DOSSIER
 * §3.6, arXiv 2504.11168): an encoder loses most of its recall, a moderation endpoint
 * (retrained continuously) some; a generative judge reasons about intent and keeps it.
 * The model's own alignment (layer 1) is judged on severity, not novelty.
 */
export const NOVEL_RECALL_MUL: Record<GuardrailArchetype, number> = {
  encoder: 0.45,
  generative: 1,
  moderation: 0.7,
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * §3.2 the alignment tax (a non-negative capability cost) a model pays for being
 * aligned: TAX_K[style] × max(0, safety−40)/100. Subtracted from qualityBy in
 * serverQualityVs. A safe-completion model pays less than a hard-refusal one at the
 * same safety — the Pareto improvement the player is taught to prefer (§3.1).
 */
export function alignmentTax(m: ModelDef): number {
  const k = TAX_K[m.alignment.refusalStyle]
  return k * Math.max(0, m.alignment.safety - 40) / 100
}

/**
 * §3.3 the probability a model's intrinsic alignment SELF-HANDLES one hazard at
 * serve time (0 latency, §3.7): clamp01(safety/100 − sev × HAZARD_HARDNESS[h]).
 * A high-safety model clears most jailbreaks unaided; a base model (safety ~20)
 * cannot. Rolled with `s.rng` so replays match (deterministic-friendly, OQ-G15).
 */
export function pSelfHandle(m: ModelDef, hazard: SafetyHazard, severity: number): number {
  return clamp01(m.alignment.safety / 100 - severity * HAZARD_HARDNESS[hazard])
}

/**
 * §3.6 no-free-lunch: a guardrail's EFFECTIVE recall at the global threshold,
 * effRecall = clamp01(baseRecall × (0.6 + 0.8 × threshold)) — raise the threshold
 * to catch more. A small red-team eval bonus (+0.02) is "calibrating the threshold,
 * not improving the model" (§3.6 [fix M4]).
 */
export function effRecall(baseRecall: number, threshold: number, redteamBonus = 0): number {
  return clamp01(baseRecall * (0.6 + 0.8 * threshold) + redteamBonus)
}

/**
 * §3.6 the rate a guardrail wrongly blocks a BORDERLINE benign request at:
 * OVERREF_K[archetype] × threshold² (convex — the cost of catching more). Red-team
 * eval lowers the convexity (OVERREF_K ×0.7, XSTest: judge by intent, [fix M4]). A
 * request's actual risk multiplies this by its archetype's `refusalExposure` (guards.ts).
 */
export function overRefuse(archetype: GuardrailArchetype, threshold: number, overrefMul = 1): number {
  return OVERREF_K[archetype] * overrefMul * threshold * threshold
}

/** Derived quick "is risky" scalar = the max severity over a hazard profile (0 = benign). */
export function maxSeverity(hazards: SafetyProfile): number {
  let m = 0
  for (const h of ALL_HAZARDS) {
    const v = hazards[h]
    if (v !== undefined && v > m) m = v
  }
  return m
}

/** True if the profile carries no hazards at all (a benign request, §3.4). */
export function isBenign(hazards: SafetyProfile): boolean {
  return maxSeverity(hazards) <= 0
}

/* ---- red-team eval (§3.6, eval track) ---- */

/** Owned level of the red-team eval line (`eval_redteam` flag, set by completeResearch). */
export function redteamLevel(s: GameState): number {
  return s.upgrades['eval_redteam'] ?? 0
}

/** §3.6 [fix M4] red-team eval multiplies OVERREF_K by 0.7 once owned (XSTest calibration). */
export function overrefMul(s: GameState): number {
  return redteamLevel(s) >= 1 ? 0.7 : 1
}

/** §3.6 small "calibrating the threshold" recall bonus once red-teaming is done (+0.02 per level). */
export function redteamRecallBonus(s: GameState): number {
  return 0.02 * redteamLevel(s)
}

/**
 * §3.6 [fix M4] red-team eval UNLOCKS the harder detection categories: a guardrail
 * only catches `injection`/`pii` once the eval is done (v1 unlocks injection; v2
 * unlocks pii). jailbreak/harmful are always available.
 */
export function categoryUnlocked(s: GameState, hazard: SafetyHazard): boolean {
  if (hazard === 'injection') return redteamLevel(s) >= 1
  if (hazard === 'pii') return redteamLevel(s) >= 2
  return true
}

/** Sync the derived quick-flags from the open-hazard set after a verdict step. */
export function refreshHazardFlags(r: Request): void {
  r.safetyRisk = maxSeverity(r.hazardsOpen)
  if (r.safetyRisk <= 0) r.safetyCleared = true
}
