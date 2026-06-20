import type { MethodRecipe, PostTrainMethod, ServerSpec } from '../core/types'

/**
 * Calibration: real public-benchmark percentages → GPTD's internal quality
 * scale (the same ~0..130 scale the request `complexity` lines live on, so a
 * checkpoint clears/fails the same lanes a tuned synthetic one would).
 *
 * Each axis has a piecewise-linear curve anchored so the campaign's difficulty
 * arc is preserved: chat is trivial for any instruct model, coding needs a real
 * coder / ~30B, the hardest reasoning needs a thinking model / frontier.
 *
 * Axis → primary benchmark:
 *   chat / general ← MMLU-Pro          (breadth / knowledge)
 *   coding         ← LiveCodeBench      (fallbacks: SWE-bench Verified, HumanEval)
 *   reasoning      ← GPQA-Diamond       (fallback: AIME)
 *   agentic        ← SWE-bench Verified (fallback: LiveCodeBench, discounted)
 *
 * `agentic` is the anti-saturation axis: SWE-bench keeps a real frontier gap
 * where LiveCodeBench has compressed, so the late-game "Agentic Task" lane stays
 * a wall only true frontier (or self-trained) checkpoints clear.
 *
 * Deliberately NOT derived from the Artificial Analysis composite Intelligence
 * Index: that index re-baselines between versions (MiniMax-M2 read 61 then 28),
 * whereas per-benchmark %s are scale-stable.
 */

type Anchor = readonly [pct: number, quality: number]

/** Benchmark% → quality anchor tables (must be sorted ascending by pct). */
const CURVES: Record<ServerSpec, readonly Anchor[]> = {
  // LiveCodeBench %; line code=56 sits at LCB 30
  coding: [
    [10, 30],
    [30, 56],
    [66, 78],
    [84, 95],
    [95, 112],
  ],
  // GPQA-Diamond %; lines ent=66 / reason=82 sit around GPQA 55 / 65
  reasoning: [
    [28, 40],
    [50, 72],
    [70, 86],
    [81, 100],
    [90, 118],
  ],
  // MMLU-Pro %; line chat=18 is trivial for any real instruct model
  chat: [
    [40, 30],
    [56, 52],
    [70, 72],
    [84, 95],
    [91, 112],
  ],
  general: [
    [40, 30],
    [56, 52],
    [70, 72],
    [84, 95],
    [91, 112],
  ],
  // SWE-bench Verified %; the Agentic Task line (82) sits around SWE 63 — only
  // strong-SWE frontier (or self-trained) models clear it.
  agentic: [
    [20, 30],
    [45, 60],
    [60, 78],
    [72, 95],
    [82, 112],
  ],
}

/** Piecewise-linear interpolation with linear-to-origin below and gentle extrapolation above. */
export function pwl(anchors: readonly Anchor[], b: number): number {
  const [b0, q0] = anchors[0]
  const [bn, qn] = anchors[anchors.length - 1]
  let q: number
  if (b <= b0) q = q0 * (b / b0)
  else if (b >= bn) q = qn + 1.5 * (b - bn)
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
  return clamp(Math.round(q), 8, 130)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Sibling-benchmark conversions, applied BEFORE the curve when the primary is absent. */
const heToLcb = (he: number) => Math.max(0, (he - 45) * 0.55)
const sweToLcb = (swe: number) => swe * 1.05
const aimeToGpqa = (aime: number) => aime * 0.78 + 10
const mmluToPro = (mmlu: number) => mmlu - 14

/** The raw benchmark inputs a checkpoint is calibrated from (any may be omitted). */
export interface BenchInputs {
  mmluPro?: number
  mmlu?: number
  gpqaDiamond?: number
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
 * P5 DECISION (after the full autoplay re-tune): the AUTHORED table already passes
 * the campaign balance gate and the §6.3 band-displacement ordering — a competent
 * player wins the 20-wave campaign and the §6.4 capability-compression lesson holds
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
 * Derive the full `qualityBy` vector from real benchmarks. `floor` (a small
 * per-tier baseline) fills any axis whose benchmark is entirely absent so no
 * lane is left undefined.
 */
export function qualityFromBenchmarks(b: BenchInputs, floor: Record<ServerSpec, number>): Record<ServerSpec, number> {
  const lcb =
    b.liveCodeBench ?? (b.sweBench != null ? sweToLcb(b.sweBench) : b.humanEval != null ? heToLcb(b.humanEval) : null)
  const gpqa = b.gpqaDiamond ?? (b.aime != null ? aimeToGpqa(b.aime) : null)
  const mp = b.mmluPro ?? (b.mmlu != null ? mmluToPro(b.mmlu) : null)
  // agentic prefers a real SWE-bench score; LiveCodeBench is a discounted proxy
  // (SWE is the harder, less-saturated benchmark — a strong LCB ≠ strong agent).
  const swe = b.sweBench ?? (b.liveCodeBench != null ? b.liveCodeBench * 0.7 : null)
  return {
    chat: mp != null ? pwl(CURVES.chat, mp) : floor.chat,
    general: mp != null ? pwl(CURVES.general, mp) : floor.general,
    coding: lcb != null ? pwl(CURVES.coding, lcb) : floor.coding,
    reasoning: gpqa != null ? pwl(CURVES.reasoning, gpqa) : floor.reasoning,
    agentic: swe != null ? pwl(CURVES.agentic, swe) : floor.agentic,
  }
}
