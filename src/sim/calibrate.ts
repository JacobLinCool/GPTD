import type { MethodRecipe, PostTrainMethod, ServerSpec, ThinkingSupport } from '../core/types'

/**
 * Calibration: real public-benchmark percentages → GPTD's internal quality
 * scale (the same ~0..130 scale the request difficulty lines live on, so a
 * checkpoint clears/fails the same lanes a tuned synthetic one would).
 *
 * Each axis is a WEIGHTED BLEND of benchmarks (primary 0.6 + two secondary 0.2,
 * see BLEND), each a 0–100% metric, mapped to quality by a per-axis curve (CURVES).
 * The blends differentiate the axes — chat (IFBench-led) ≠ general (GPQA-led) — and
 * pull in un-saturated benchmarks (HLE for reasoning, Terminal-Bench Hard for agentic)
 * so the top of the ladder stays separable.
 *
 * Benchmarks (Artificial Analysis eval keys; resolved by scripts/aa-cells.mjs):
 *   GPQA-Diamond (gpqa) · IFBench (ifbench) · LCR (lcr) · SciCode (scicode)
 *   · Terminal-Bench Hard (terminalbench_hard) · HLE (hle).
 *
 * THE REFERENCE SCALE. A raw per-benchmark % is not stable across AA snapshots: AA
 * re-runs evals under new harnesses (LCR read +4.5 points higher on average in the
 * 2026-10 refresh) and retires others (IFBench and TB-Hard are no longer published for
 * new models). So every cell is expressed on ONE frozen scale — the 2026-06-21 snapshot
 * the CURVES were quantile-fitted on (data/aa-reference-2026-06-21.json). At BUILD time,
 * scripts/aa-cells.mjs resolves each cell reference → latest (a frozen cell as-is, a
 * re-scored one through same-UUID equating) → an OLS bridge from measured cells for a
 * retired one (clamped to its observed range; the provenance and residual sd are kept for
 * Expert display). The game only ever reads the resolved numbers, so it stays fully
 * deterministic; the uncertainty of a bridged cell is a documented property of the data.
 *
 * INSTANT MODE. A hybrid checkpoint (it can switch thinking off) carries a second
 * vector, `qualityByInstant`, calibrated from its instant-mode cells through the SAME
 * blends and curves (`qualityFromBenchmarks`): the cells come from AA's Non-reasoning row
 * of the same checkpoint, or the per-cell thinking→instant pair fit (scripts/aa-cells.mjs).
 *
 * Deliberately NOT derived from the Artificial Analysis composite Intelligence
 * Index: that index re-baselines between versions (MiniMax-M2 read 61 then 28).
 */

type Anchor = readonly [pct: number, quality: number]

/**
 * Each axis is a WEIGHTED BLEND of benchmarks: one primary (0.6) + two secondary
 * (0.2 each). Every input is a 0–100% metric on the reference scale (see the header;
 * never population min/max). The weighted sum (a "composite %", 0..100) is then
 * mapped to quality by the per-axis curve below.
 *   chat      = IFBench·0.6 + GPQA·0.2 + LCR·0.2        (instruction-following / conversational)
 *   general   = GPQA·0.6  + IFBench·0.2 + LCR·0.2       (broad knowledge)
 *   coding    = SciCode·0.6 + Terminal-Bench-Hard·0.2 + IFBench·0.2
 *   reasoning = HLE·0.6   + GPQA·0.2 + LCR·0.2          (HLE keeps the top un-saturated)
 *   agentic   = Terminal-Bench-Hard·0.6 + IFBench·0.2 + LCR·0.2
 */
const BLEND: Record<ServerSpec, readonly (readonly [keyof BenchInputs, number])[]> = {
  chat: [
    ['ifBench', 0.6],
    ['gpqaDiamond', 0.2],
    ['lcr', 0.2],
  ],
  general: [
    ['gpqaDiamond', 0.6],
    ['ifBench', 0.2],
    ['lcr', 0.2],
  ],
  coding: [
    ['sciCode', 0.6],
    ['terminalBenchHard', 0.2],
    ['ifBench', 0.2],
  ],
  reasoning: [
    ['hle', 0.6],
    ['gpqaDiamond', 0.2],
    ['lcr', 0.2],
  ],
  agentic: [
    ['terminalBenchHard', 0.6],
    ['ifBench', 0.2],
    ['lcr', 0.2],
  ],
}

/**
 * Composite% → quality anchor tables (must be sorted ascending). Fit by quantile-
 * matching the composite distribution onto the prior quality distribution per axis,
 * so the campaign's difficulty lines (chat 18 … reason/agent 82) keep their meaning:
 * the same count of models clear each lane, but WHICH models is now driven by the
 * blended signal (so a strong-IFBench model leads chat while a strong-GPQA one leads
 * general, etc.). Re-fit if the blends or roster change materially.
 */
const CURVES: Record<ServerSpec, readonly Anchor[]> = {
  general: [
    [17.3, 19],
    [39.2, 69],
    [47.3, 80],
    [66.4, 89],
    [77.8, 97],
    [87.1, 104],
  ],
  chat: [
    [16, 19],
    [31.9, 69],
    [41.2, 80],
    [59.9, 89],
    [71.1, 97],
    [83.1, 104],
  ],
  coding: [
    [5.6, 8],
    [19.8, 53],
    [29.1, 80],
    [36.8, 86],
    [45.3, 92],
    [55.1, 110],
  ],
  reasoning: [
    [8.1, 28],
    [14.6, 72],
    [18.5, 84],
    [34, 94],
    [43.5, 106],
    [56.2, 122],
  ],
  agentic: [
    [5.6, 8],
    [9.8, 18],
    [21.4, 47],
    [30.1, 65],
    [47.1, 93],
    [59.4, 124],
  ],
}

/**
 * Roster frontier-tolerance gate (see docs/PARETO.md). A checkpoint earns a roster
 * slot iff, on AT LEAST ONE capability axis, its quality is within
 * `ROSTER_FRONTIER_TOLERANCE` of the best quality attainable at its size-or-smaller —
 * the monotone size↔quality Pareto frontier over the candidate pool. This prunes
 * models that trail the frontier by MORE than the tolerance on EVERY axis (dead
 * weight a rational player would never deploy — strictly beaten by something no
 * bigger), while keeping each scale's near-best and every single-axis specialist.
 * It is the gate that turns the candidate pool (every open checkpoint with an
 * architecture record, hand-authored + generated) into the active roster; 6% keeps a
 * lean roster of ~60 that still spans every scale from sub-1B to the multi-trillion
 * frontier — anything further behind is obsolete at its size on every lane.
 */
export const ROSTER_FRONTIER_TOLERANCE = 0.06

export function withinFrontierTolerance<T extends { paramsTotalB: number; qualityBy: Record<ServerSpec, number> }>(
  pool: readonly T[],
  tol: number = ROSTER_FRONTIER_TOLERANCE,
): T[] {
  const axes = Object.keys(BLEND) as ServerSpec[]
  const frontierAt = (size: number, axis: ServerSpec): number => {
    let best = 0
    for (const m of pool) if (m.paramsTotalB <= size && m.qualityBy[axis] > best) best = m.qualityBy[axis]
    return best
  }
  return pool.filter((m) =>
    axes.some((a) => {
      const f = frontierAt(m.paramsTotalB, a)
      return f > 0 && m.qualityBy[a] >= (1 - tol) * f
    }),
  )
}

/** The quality ceiling every curve saturates toward (and the hard clamp). */
const Q_CEIL = 130
/** Slope of the extrapolation at the last anchor (quality per composite-% point). */
const TAIL_SLOPE = 1.5

/**
 * Piecewise-linear interpolation with linear-to-origin below the first anchor and a
 * SATURATING tail above the last: `qn + (130 − qn)·(1 − e^(−1.5·(b − bn)/(130 − qn)))`,
 * continuous at the anchor with the same 1.5 slope, approaching the 130 ceiling
 * asymptotically. The anchors are the 2026-06 frontier, so only checkpoints beyond it
 * reach the tail — they spread across the low-120s instead of piling up on the clamp,
 * which keeps the frontier separable and leaves a little post-training headroom.
 */
export function pwl(anchors: readonly Anchor[], b: number): number {
  const [b0, q0] = anchors[0]
  const [bn, qn] = anchors[anchors.length - 1]
  let q: number
  if (b <= b0) q = q0 * (b / b0)
  else if (b >= bn) q = qn + (Q_CEIL - qn) * (1 - Math.exp((-TAIL_SLOPE * (b - bn)) / (Q_CEIL - qn)))
  else {
    q = q0
    for (let i = 0; i < anchors.length - 1; i++) {
      const [bi, qi] = anchors[i]
      const [bj, qj] = anchors[i + 1]
      if (b >= bi && b <= bj) {
        q = qi + ((qj - qi) * (b - bi)) / (bj - bi)
        break
      }
    }
  }
  return clamp(Math.round(q), 8, Q_CEIL)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** The raw benchmark inputs a checkpoint is calibrated from (all are 0–100% metrics). */
export interface BenchInputs {
  // --- the five-axis blend inputs (see BLEND); Artificial Analysis eval keys, reference scale ---
  gpqaDiamond?: number // gpqa
  ifBench?: number // ifbench
  lcr?: number // lcr
  sciCode?: number // scicode
  terminalBenchHard?: number // terminalbench_hard
  hle?: number // hle
  // --- AA's successor evals: display + bridge predictors only (NOT read by calibration) ---
  terminalBenchV21?: number // terminalbench_v2_1
  terminalBenchV40?: number // terminalbench_v4_0
  tauBanking?: number // tau_banking
  // --- retained for display / legacy hand-authored entries (NOT read by calibration) ---
  mmluPro?: number
  mmlu?: number
  aime?: number
  liveCodeBench?: number
  sweBench?: number
  humanEval?: number
}

/**
 * §1.3 [fix C4] — calibrate / validate the post-training recipe table. The recipe
 * gain/cap/tax/forget constants are honest GAME CURVES (not first-principles
 * physics), so they are tuned by autoplay regression rather than derived.
 *
 * The AUTHORED table already passes the campaign balance gate (the playthrough's
 * depth gate through the 100-wave gauntlet) and the §6.3 band-displacement ordering —
 * a competent player gets deep into the campaign and the §6.4 capability-compression lesson holds
 * (a GRPO-agentic run on an agentic-capable 120B base clears the agent line, while
 * adapters move far less). So `calibrateRecipes` does NOT mutate the table; it is a
 * VALIDATING pass-through: it asserts the displacement ordering still holds (so a
 * future hand-edit cannot silently break balance) and returns the table unchanged.
 *
 * §6.3 ordering invariant (gain on a high-headroom axis at effort 1, depth 0):
 *   merge == 0  <  adapters (lora/qlora/dora)  <  the heavy methods (sft/grpo/cpt),
 *   and GRPO is the strongest path to reasoning/agentic (§1.4) — gainScale highest
 *   among the reasoning/agentic-targeting methods. Validated, not fitted.
 */
export function recipeGainOrderingOk(recipes: Record<PostTrainMethod, MethodRecipe>): boolean {
  const adapter = Math.max(recipes.lora.gainScale, recipes.qlora.gainScale, recipes.dora.gainScale)
  const heavy = Math.min(recipes.grpo.gainScale, recipes.cpt.gainScale)
  // merge averages upstreams (no gainScale); adapters are a "light" band; the heavy
  // methods displace the most; GRPO leads the reasoning/agentic methods.
  return (
    recipes.merge.gainScale === 0 &&
    adapter > 0 &&
    heavy > adapter &&
    recipes.grpo.gainScale >= recipes.cpt.gainScale &&
    recipes.grpo.gainScale >= recipes.rlhf.gainScale
  )
}

export function calibrateRecipes(
  recipes: Record<PostTrainMethod, MethodRecipe>,
): Record<PostTrainMethod, MethodRecipe> {
  // P5: validate-and-return. The authored constants pass the balance gate, so the
  // calibration is a no-op mutation — but we still check the §6.3 ordering so the
  // table cannot drift out of balance unnoticed.
  if (!recipeGainOrderingOk(recipes)) {
    throw new Error('calibrateRecipes: recipe gain ordering violates the §6.3 band-displacement invariant')
  }
  return recipes
}

/**
 * Weighted composite for one axis (primary 0.6 + two secondary 0.2). Inputs are
 * 0–100% metrics on the reference scale, so the composite is itself a 0..100
 * "composite %". Returns null only if the PRIMARY benchmark is absent; a missing
 * secondary counts as 0. The build-time bridges give every roster model all six
 * cells, so both cases are defensive.
 */
function axisComposite(b: BenchInputs, axis: ServerSpec): number | null {
  const blend = BLEND[axis]
  if (b[blend[0][0]] == null) return null
  let sum = 0
  for (const [field, w] of blend) sum += (b[field] ?? 0) * w
  return sum
}

/**
 * Derive the full `qualityBy` vector from real benchmarks: each axis is the weighted
 * benchmark composite (BLEND) mapped through its curve (CURVES). `floor` (a small
 * per-tier baseline) fills any axis whose primary benchmark is absent.
 */
export function qualityFromBenchmarks(b: BenchInputs, floor: Record<ServerSpec, number>): Record<ServerSpec, number> {
  const out = {} as Record<ServerSpec, number>
  for (const axis of Object.keys(BLEND) as ServerSpec[]) {
    const c = axisComposite(b, axis)
    out[axis] = c != null ? pwl(CURVES[axis], c) : floor[axis]
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  LONG-CONTEXT SKILL — how much quality survives as the window fills. *
 *  Calibrated at load from the AA long-context-reasoning cell (lcr,    *
 *  ~100K-token documents), so a 1M-window model that also reasons well *
 *  over long inputs really does beat a 128K one on a 100K prompt.      *
 * ------------------------------------------------------------------ */

/** The AA-LCR score that counts as full long-context skill (the 2026 frontier reads ≈75–80%). */
export const LCR_FULL = 80
/** Fallback skill per tier for a checkpoint with no lcr cell. */
const LONGCTX_FLOOR: Record<'small' | 'general' | 'coding' | 'frontier', number> = {
  small: 0.2,
  general: 0.5,
  coding: 0.5,
  frontier: 0.7,
}

/**
 * Long-context skill 0..1 from the AA long-context-reasoning % (lcr): lcr / LCR_FULL,
 * clamped. A 32K-window model that cannot even take the benchmark's 100K documents reads 0.
 */
export function longCtxOf(lcr: number | undefined, tier: keyof typeof LONGCTX_FLOOR): number {
  if (lcr == null || !Number.isFinite(lcr)) return LONGCTX_FLOOR[tier]
  return Math.round(clamp(lcr / LCR_FULL, 0, 1) * 100) / 100
}

/* ------------------------------------------------------------------ *
 *  THINKING MODELS — how much a thinking checkpoint thinks.             *
 *  WHETHER it thinks is a fact of its chat template (thinking support,  *
 *  data/model-thinking.json); HOW MUCH is derived at load from          *
 *  Artificial Analysis' serving telemetry on the pinned thinking        *
 *  variant (AA_META), the way qualityBy is calibrated from its cells.   *
 * ------------------------------------------------------------------ */

/** AA telemetry on its standard 1K-token prompt (seconds, output tok/s). */
export interface ServingTelemetry {
  name?: string
  ttftS?: number
  ttfatS?: number
  tps?: number
}

/** Hidden-token budget clamp and the fallback for a thinking model AA never timed. */
export const THINK_TOKENS_MIN = 300
export const THINK_TOKENS_MAX = 4000
export const THINK_TOKENS_FALLBACK = 1500
/** A first ANSWER token more than this after the first token means hidden reasoning ran. */
const THINK_GAP_S = 1

/**
 * isReasoning + thinkTokens for one checkpoint. Its chat template decides whether it can think
 * (`support` ≠ 'never'); AA's telemetry on the pinned thinking variant sizes the budget — the
 * time-to-first-answer gap (ttfat − ttft) × output speed, clamped to 300–4000 tokens. A thinker
 * AA never timed (or timed without a measurable gap) gets the 1500-token fallback; a model that
 * never thinks spends 0.
 */
export function thinkingOf(t: ServingTelemetry | undefined, support: ThinkingSupport): { isReasoning: boolean; thinkTokens: number } {
  if (support === 'never') return { isReasoning: false, thinkTokens: 0 }
  const tps = t?.tps ?? 0
  const gap = t?.ttftS && t.ttfatS && tps ? t.ttfatS - t.ttftS : 0
  const thinkTokens = gap > THINK_GAP_S ? clamp(Math.round(gap * tps), THINK_TOKENS_MIN, THINK_TOKENS_MAX) : THINK_TOKENS_FALLBACK
  return { isReasoning: true, thinkTokens }
}
