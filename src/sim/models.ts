import type {
  AlignmentProfile,
  CapabilityAxis,
  GameState,
  Lineage,
  MethodRecipe,
  ModelDef,
  ModelVariant,
  PostTrainMeta,
  PostTrainMethod,
  PostTrainTarget,
  ThinkingSupport,
} from '../core/types'
import { POSTTRAIN_COMPUTE_SCALE } from '../config'
import { THINK_TOKENS_FALLBACK } from './calibrate'
import { DEFAULT_MODEL_ID, METHOD_RECIPES, MODEL_DEFS, MODEL_LIST } from './content'

/**
 * The SINGLE model-resolution point (R7 / C4). Derived (player-created)
 * checkpoints live in `s.derivedModels` and take precedence; the static
 * `MODEL_DEFS` is the base registry. O(1) lookup — derived models are
 * snapshotted at creation (no recursive lineage resolution at serve time).
 */
export function resolveModel(s: GameState, id: string): ModelDef | null {
  return s.derivedModels[id] ?? MODEL_DEFS[id] ?? null
}

/* ------------------------------------------------------------------ *
 *  POST-TRAINING STUDIO (§1) — deriveQuality + deriveModel.           *
 *  A derived ModelDef is a SNAPSHOT: its final qualityBy / alignment / *
 *  deploy fields are fixed at creation, so resolveModel stays O(1)     *
 *  ([fix C4]). The recipe constants are autoplay-calibratable curves.  *
 * ------------------------------------------------------------------ */

/** The 5 CapabilityAxis values (the axes a qualityBy vector carries). */
const CAP_AXES: CapabilityAxis[] = ['chat', 'coding', 'reasoning', 'general', 'agentic']

/** Quality is clamped to this band (same scale calibrate.ts uses). */
const Q_LO = 8
const Q_HI = 130

const clampQ = (v: number): number => (v < Q_LO ? Q_LO : v > Q_HI ? Q_HI : v)

/**
 * The qualityBy axis a TARGET pushes, or `null` for `safety` (whose "gain" lands
 * in `alignment.safety`, not in any quality axis — so general is free to be taxed,
 * §1.4). `longctx`/`domain` are modelled as a `general` capability push.
 */
export function gainAxis(target: PostTrainTarget): CapabilityAxis | null {
  if (target === 'safety') return null
  if (target === 'longctx' || target === 'domain') return 'general'
  return target
}

/**
 * Map a target to a quality axis (folding safety → general so deriveQuality has a
 * headroom reference). Use `gainAxis` to decide whether the gain actually applies.
 */
export function targetAxis(target: PostTrainTarget): CapabilityAxis {
  return gainAxis(target) ?? 'general'
}

/** A body may be trained up to this far past the best base model at most twice its size. */
export const CAPACITY_MARGIN = 6
/** Peers that bound a body's capacity: roster base models up to this multiple of its total params. */
export const CAPACITY_PEER_SIZE = 2
/** The roster is fixed after load, so each (body size, axis) ceiling is computed once. */
const CEILING_MEMO = new Map<string, number>()

/**
 * §1.4 the CAPACITY CEILING of a deploy body on one axis: post-training cannot push a
 * checkpoint past what models of its size class reach. It is the best qualityBy[axis]
 * among the roster's BASE models (never derived ones) with at most CAPACITY_PEER_SIZE ×
 * its total params, plus CAPACITY_MARGIN. It depends only on the body, so stacking runs
 * cannot ratchet it (RL/distill gains on small models are bounded by base capacity —
 * the DeepSeek-R1 distill results; agentic/SWE is the axis where scale still separates).
 */
export function capacityCeiling(paramsTotalB: number, axis: CapabilityAxis): number {
  const key = `${paramsTotalB}|${axis}`
  const hit = CEILING_MEMO.get(key)
  if (hit !== undefined) return hit
  let best = 0
  for (const m of MODEL_LIST) {
    if (m.paramsTotalB > CAPACITY_PEER_SIZE * paramsTotalB) continue
    if (m.qualityBy[axis] > best) best = m.qualityBy[axis]
  }
  const ceil = Math.min(Q_HI, best + CAPACITY_MARGIN)
  CEILING_MEMO.set(key, ceil)
  return ceil
}

/** The recipe's gain on its axis BEFORE the body's capacity ceiling (depth damp + headroom cap only). */
function uncappedGain(base: ModelDef, recipe: MethodRecipe, axis: CapabilityAxis, effort: number, depth: number): number {
  const depthDamp = 1 / (1 + 0.15 * depth)
  const rawGain = recipe.gainScale * Math.sqrt(effort) * depthDamp
  const headroom = Math.max(0, (Q_HI - base.qualityBy[axis]) / Q_HI)
  return Math.min(rawGain, recipe.gainCap * headroom)
}

/**
 * §1.4 — the quality delta a recipe produces on its target axis.
 *   depthDamp = 1 / (1 + 0.15 × depth)            // deep chains: diminishing returns
 *   rawGain   = gainScale × √effort × depthDamp    // curated-data returns + depth decay
 *   headroom  = (130 − base[axis]) / 130           // harder to push near the ceiling
 *   gain      = min(rawGain, gainCap × headroom)   // PEFT capacity cap (cpt's high cap can exceed it)
 *   gain      = min(gain, ceil(body) − base[axis]) // the body's capacity ceiling (never below 0)
 * Returns the positive gain to add to the target axis (≥0). A `safety` target has
 * no quality axis (gainAxis null) → 0 here (the gain is the alignment.safety boost).
 * Distillation is bounded by its own student-capacity cap instead (computeDerivedFields).
 */
export function deriveQuality(
  base: ModelDef,
  recipe: MethodRecipe,
  target: PostTrainTarget,
  effort: number,
  depth: number,
): number {
  const axis = gainAxis(target)
  if (axis === null) return 0
  let gain = uncappedGain(base, recipe, axis, effort, depth)
  if (recipe.id !== 'distill') gain = Math.min(gain, capacityCeiling(base.paramsTotalB, axis) - base.qualityBy[axis])
  return Math.max(0, gain)
}

/**
 * §2.1/§2.8 catastrophic forgetting compounds with lineage depth: every run on an
 * already-derived checkpoint forgets more of what the base knew (×1 for the first run,
 * ×1.5 for the second, ×2 for the third…), so a deep chain erodes its non-target axes.
 */
export function forgetDepthMul(depth: number): number {
  return 1 + 0.5 * Math.max(0, depth - 1)
}

/**
 * The lineage depth a run starts from: the base's, or for a merge the DEEPER of the two
 * parents — the averaged weights carry the longer chain's history whichever parent is
 * listed first, so a merge's depth, cost and later forgetting never depend on the order.
 */
export function runBaseDepth(base: ModelDef, other: ModelDef | null): number {
  return Math.max(base.lineage?.depth ?? 0, other?.lineage?.depth ?? 0)
}

/**
 * The lowest wrongful-refusal rate safety post-training can reach (§2.4). Even the
 * safe-completion leaders still refuse a few borderline prompts (XSTest / OR-Bench never
 * measure zero; the roster's best is the gpt-oss tier at ~0.03), so Constitutional AI can
 * cut over-refusal toward this floor but never below it.
 */
export const OVERREF_FLOOR = 0.02

/** §1.4 alignment-tax weight by method (rlhf is the crudest → highest tax). */
function alignmentTaxFactor(method: PostTrainMethod): number {
  if (method === 'rlhf') return 1
  if (method === 'cai') return 0.6
  return 0.8
}

/** Catastrophic-forgetting spread applied to every non-target axis (§2.1/§2.8). */
const FORGET_SPREAD = 1

/**
 * §1.4 training cost. `sizeFactor = (activeB/8)^0.7` (8B-active baseline,
 * sub-linear), then compute is scaled by POSTTRAIN_COMPUTE_SCALE, lineage depth,
 * and a mild MoE sparsity surcharge. Data scales with effort, lineage depth, and
 * total params. Reuses research.ts requisition for waves.
 */
export function postTrainSizeFactor(activeB: number): number {
  return Math.pow(Math.max(0.1, activeB) / 8, 0.7)
}

/**
 * §1.4 [fix] the lineage-DEPTH surcharge on a post-training run: stacking a run on an
 * already-derived checkpoint costs progressively MORE (×(1 + 0.6·baseDepth)). `deriveQuality`
 * already DAMPS the gain with depth (1/(1+0.15·depth)); pairing a rising cost with the
 * falling gain makes a 2nd/3rd stacked GRPO a real diminishing-returns INVESTMENT (data +
 * compute), not a free way to climb past a capability wall. baseDepth = runBaseDepth: the
 * base's lineage depth (0 for an original base, 1 for a once-derived checkpoint, …), or the
 * deeper parent's for a merge.
 */
function depthSurcharge(baseDepth: number): number {
  return 1 + 0.6 * Math.max(0, baseDepth)
}

/**
 * §1.4 data scales with the model's CAPACITY (real TOTAL params, not active): a bigger
 * model needs more curated data to move meaningfully (Chinchilla-flavoured, sub-linear).
 * Anchored at an 8B baseline and floored at 1× — size only ADDS data, never discounts a
 * small model. Crucially uses TOTAL, so a sparse 35B-A3B MoE is no longer trained on the
 * data budget of a 3B model (the cheap-MoE-stacking loophole).
 */
function dataSizeFactor(totalB: number): number {
  return Math.max(1, Math.pow(Math.max(0.1, totalB) / 8, 0.45))
}

/**
 * §1.4 the MoE memory/communication surcharge on COMPUTE: training FLOPs are ∝ ACTIVE
 * params (correct — that is the point of MoE), but a sparse model must still HOLD all total
 * params (+ optimizer states) and pay expert all-to-all, costs that scale with the
 * total/active sparsity ratio. Dense models (total = active) pay nothing extra; a 35B-A3B
 * pays ~1.4×, a very sparse 230B-A10B ~1.6×. Mild — active FLOPs stay the dominant term.
 */
function sparsityFactor(totalB: number, activeB: number): number {
  const ratio = Math.max(1, totalB / Math.max(0.1, activeB))
  return 1 + 0.12 * Math.pow(ratio - 1, 0.5)
}

export function postTrainComputeCost(
  recipe: MethodRecipe,
  activeB: number,
  effort: number,
  baseDepth = 0,
  totalB = activeB,
): number {
  return (
    recipe.costCompute *
    postTrainSizeFactor(activeB) *
    effort *
    1000 *
    POSTTRAIN_COMPUTE_SCALE *
    depthSurcharge(baseDepth) *
    sparsityFactor(totalB, activeB)
  )
}

export function postTrainDataCost(recipe: MethodRecipe, effort: number, baseDepth = 0, totalB = 8): number {
  return Math.round(recipe.costData * effort * depthSurcharge(baseDepth) * dataSizeFactor(totalB))
}

/** The 5 discrete effort notches (§1.4 [fix M9]); 1.0 is the default. */
export const EFFORT_NOTCHES = [0.25, 0.5, 1.0, 1.5, 2.0] as const

/**
 * The Data a run on these bases costs up front (a merge partner's depth counts too) — the
 * one rule startPostTrain charges and the UI / bridge rejection reasons quote.
 */
export function postTrainRunDataCost(s: GameState, baseIds: string[], recipe: MethodRecipe, effort: number): number {
  const base = resolveModel(s, baseIds[0] ?? '')
  const other = recipe.id === 'merge' ? resolveModel(s, baseIds[1] ?? '') : null
  return postTrainDataCost(recipe, effort, base ? runBaseDepth(base, other) : 0, base?.paramsTotalB ?? 8)
}

/** A short base label for the derived display name (drops the developer prefix where obvious). */
function baseShort(m: ModelDef): string {
  return m.name
}

const TARGET_LABEL: Record<PostTrainTarget, string> = {
  chat: 'Chat',
  coding: 'Code',
  reasoning: 'Reason',
  general: 'General',
  agentic: 'Agent',
  safety: 'Safe',
  longctx: 'LongCtx',
  domain: 'Domain',
}

const METHOD_LABEL: Record<PostTrainMethod, string> = {
  cpt: 'CPT',
  sft: 'SFT',
  lora: 'LoRA',
  qlora: 'QLoRA',
  dora: 'DoRA',
  dpo: 'DPO',
  rlhf: 'RLHF',
  cai: 'CAI',
  grpo: 'GRPO',
  distill: 'Distill',
  merge: 'Merge',
  qat: 'QAT',
}

/** The snapshot fields a derived checkpoint carries (everything but id/origin/lineage). */
export interface DerivedFields {
  name: string
  tier: ModelDef['tier']
  variant: ModelVariant
  spec: CapabilityAxis
  paramsTotalB: number
  paramsActiveB: number
  isMoE: boolean
  /** §1.4 thinking support: inherited, or 'always' when a reasoning run teaches an instruct model to think. */
  thinking: ThinkingSupport
  isReasoning: boolean
  thinkTokens: number
  quality: number
  qualityBy: Record<CapabilityAxis, number>
  /** a hybrid's instant-mode vector after the run (the run's per-axis change applied to the base's). */
  qualityByInstant?: Record<CapabilityAxis, number>
  layers: number
  kvLayers: number
  kvHeads: number
  headDim: number
  attn: ModelDef['attn']
  kvBytesPerToken: number
  kvStateMbPerReq: number
  nativeWeightBytes: number
  contextWindowK: number
  /** §1.2 long-context skill: a body keeps its own; a distilled student or a merge keeps the weaker one. */
  longCtx: number
  alignment: AlignmentProfile
  instructFollow: number
  desc: string
  /** the resulting lineage depth (runBaseDepth + 1: the base's, or a merge's deeper parent's, + 1). */
  depth: number
}

/**
 * The vector a checkpoint answers instantly with: a hybrid's instant-mode vector, a 'never'
 * model's only one; an 'always' model has none (it cannot answer without thinking).
 */
function instantVector(m: ModelDef): Record<CapabilityAxis, number> | undefined {
  return m.qualityByInstant ?? (m.thinking === 'never' ? m.qualityBy : undefined)
}

/**
 * §2.6 the thinking support of a weight average: parents that agree keep it; averaging a
 * thinker with an instruct sibling (or with a hybrid) gives a checkpoint that can do both.
 */
function mergedSupport(a: ThinkingSupport, b: ThinkingSupport): ThinkingSupport {
  return a === b ? a : 'hybrid'
}

/**
 * §1.2/§1.4 — the SINGLE pure computation of a derived checkpoint's snapshot
 * fields from (base, method, target, effort) and an optional merge partner. Both
 * `deriveModel` (which writes a ModelDef into state) and `studioPreview` (a
 * read-only dry run) call this, so the preview can NEVER drift from what training
 * actually produces. No GameState, no mutation — pure given its inputs.
 */
export function computeDerivedFields(
  base: ModelDef,
  recipe: MethodRecipe,
  target: PostTrainTarget,
  effort: number,
  other: ModelDef | null,
): DerivedFields {
  const method = recipe.id
  // the quality axis the gain lands on (null for safety — its gain is alignment.safety).
  const axis = gainAxis(target)
  const baseDepth = runBaseDepth(base, method === 'merge' ? other : null)
  const depth = baseDepth + 1

  // --- qualityBy (snapshot) ---
  const qualityBy: Record<CapabilityAxis, number> = { ...base.qualityBy }

  if (method === 'merge' && other) {
    // merge: average the two same-base upstreams' axes — no gain, no forgetting.
    for (const a of CAP_AXES) qualityBy[a] = clampQ((base.qualityBy[a] + other.qualityBy[a]) / 2)
  } else {
    if (axis !== null) {
      const gain = deriveQuality(base, recipe, target, effort, depth)
      qualityBy[axis] = clampQ(base.qualityBy[axis] + gain)
    }
    // alignment tax (§1.4): a safety target or crude preference RL lowers GENERAL.
    // (Skip when general is the very axis we just raised — e.g. a 'general' DPO run.)
    if (target === 'safety' || method === 'rlhf' || method === 'cai') {
      const tax = recipe.taxScale * alignmentTaxFactor(method) * Math.sqrt(effort)
      if (axis !== 'general') qualityBy.general = clampQ(qualityBy.general - tax)
    }
    // catastrophic forgetting (§2.1/§2.8): every NON-target capability axis drifts down,
    // more the deeper the chain.
    const forget = recipe.forgetScale * FORGET_SPREAD * Math.sqrt(effort) * forgetDepthMul(depth)
    if (forget > 0) {
      for (const a of CAP_AXES) {
        if (a === axis) continue
        qualityBy[a] = clampQ(qualityBy[a] - forget)
      }
    }
  }

  // --- §1.4 the instant-mode vector of a hybrid: the run moves it by the same per-axis amount ---
  const baseInstant = instantVector(base)
  let qualityByInstant: Record<CapabilityAxis, number> | undefined
  if (method === 'merge' && other) {
    // a weight average answers instantly with the parents' instant paths (either one's, if only it has one)
    const paths = [baseInstant, instantVector(other)].filter((v): v is Record<CapabilityAxis, number> => !!v)
    qualityByInstant = paths.length === 2 ? avgVec(paths[0], paths[1]) : paths.length === 1 ? { ...paths[0] } : undefined
  } else if (baseInstant) {
    qualityByInstant = {} as Record<CapabilityAxis, number>
    for (const a of CAP_AXES) qualityByInstant[a] = clampQ(baseInstant[a] + (qualityBy[a] - base.qualityBy[a]))
  }

  // --- internal state (§3): alignment / instructFollow / thinking support ---
  const alignment: AlignmentProfile = { ...base.alignment }
  let instructFollow = base.instructFollow
  let thinking: ThinkingSupport = base.thinking

  if (method === 'merge' && other) {
    // weight averaging interpolates alignment too (DOSSIER §2.6): the merged checkpoint
    // lands at the mean safety / over-refusal / instruction-following of its parents —
    // never one parent's profile verbatim. A refusal style survives only if both share it.
    alignment.safety = (base.alignment.safety + other.alignment.safety) / 2
    alignment.overRefusal = (base.alignment.overRefusal + other.alignment.overRefusal) / 2
    alignment.refusalStyle =
      base.alignment.refusalStyle === other.alignment.refusalStyle ? base.alignment.refusalStyle : 'hard-refusal'
    instructFollow = (base.instructFollow + other.instructFollow) / 2
  } else if (target === 'safety' || method === 'rlhf' || method === 'cai') {
    // diminishing returns down a chain, like the quality gain: the first run on a checkpoint
    // lands the full effect, each further stacked safety run less (1 / (1 + 0.15 × base depth))
    const alignDamp = 1 / (1 + 0.15 * baseDepth)
    const safetyGain = (method === 'rlhf' ? 28 : method === 'cai' ? 26 : 18) * Math.sqrt(effort) * alignDamp
    alignment.safety = Math.min(100, alignment.safety + safetyGain)
    if (method === 'cai') {
      // CAI is a safe-completion Pareto gain: REDUCES over-refusal (§2.4) — toward the
      // realistic floor, never below it (and never raising a base already under it).
      const cut = 0.04 * Math.sqrt(effort) * alignDamp
      alignment.overRefusal = Math.max(Math.min(OVERREF_FLOOR, alignment.overRefusal), alignment.overRefusal - cut)
      alignment.refusalStyle = 'safe-completion'
    } else {
      // crude RLHF / safety-SFT raises over-refusal (§2.4 tension).
      alignment.overRefusal = Math.min(1, alignment.overRefusal + 0.05 * Math.sqrt(effort))
      if (alignment.refusalStyle === 'none') alignment.refusalStyle = 'hard-refusal'
    }
  }
  if (method === 'sft') instructFollow = Math.min(100, instructFollow + 8 * Math.sqrt(effort))
  // a reasoning run teaches an instruct model to think (DeepSeek-R1 from V3): the result is a
  // dedicated thinker; a hybrid keeps its off switch, a thinker stays one
  if ((method === 'grpo' || (target === 'reasoning' && method !== 'merge')) && thinking === 'never') thinking = 'always'

  // --- deployment fields (§4.8/§5.6/§5.7): only distill / qat / merge reshape ---
  let body: DeployBody = bodyOf(base)
  let contextWindowK = base.contextWindowK
  let longCtx = base.longCtx

  if (method === 'distill') {
    // swap to a smaller STUDENT base's deploy fields + cap qualityBy at min(teacher, student capacity).
    const student = pickDistillStudent(base)
    body = bodyOf(student)
    contextWindowK = Math.min(contextWindowK, student.contextWindowK)
    longCtx = Math.min(longCtx, student.longCtx)
    // student-capacity cap: the small body can't hold the full teacher signal (in either mode).
    // The student imitates the teacher's answers, so it inherits the teacher's thinking support.
    const studentInstant = instantVector(student) ?? student.qualityBy
    for (const a of CAP_AXES) {
      const cap = Math.min(base.qualityBy[a], student.qualityBy[a] + 18)
      qualityBy[a] = clampQ(Math.min(qualityBy[a], cap))
      if (qualityByInstant && baseInstant) {
        const capI = Math.min(baseInstant[a], studentInstant[a] + 18)
        qualityByInstant[a] = clampQ(Math.min(qualityByInstant[a], capI))
      }
    }
  } else if (method === 'qat') {
    // trained AT 4-bit: the checkpoint's release precision is now INT4 (no PTQ tax there).
    body = { ...body, nativeWeightBytes: 0.5 }
    for (const a of CAP_AXES) {
      qualityBy[a] = clampQ(qualityBy[a] - 2)
      if (qualityByInstant) qualityByInstant[a] = clampQ(qualityByInstant[a] - 2)
    }
  } else if (method === 'merge' && other) {
    // both parents share one body (mergeCompatible); the merge is materialized at the
    // higher of the two release precisions (averaging dequantizes a low-bit parent).
    body = { ...body, nativeWeightBytes: Math.max(base.nativeWeightBytes, other.nativeWeightBytes) }
    thinking = mergedSupport(base.thinking, other.thinking)
    contextWindowK = Math.min(contextWindowK, other.contextWindowK)
    longCtx = Math.min(longCtx, other.longCtx)
  }
  // only a hybrid keeps a separate instant-mode vector (a 'never' model's IS its qualityBy)
  if (thinking !== 'hybrid') qualityByInstant = undefined
  const isReasoning = thinking !== 'never'
  // a run that teaches thinking gives the checkpoint a thinking budget; a merge keeps the larger.
  let thinkTokens = method === 'merge' && other ? Math.max(base.thinkTokens, other.thinkTokens) : base.thinkTokens
  if (isReasoning && thinkTokens === 0) thinkTokens = THINK_TOKENS_FALLBACK
  if (!isReasoning) thinkTokens = 0

  const { paramsTotalB } = body
  const tier = pickTier(qualityBy, paramsTotalB)
  const quality = Math.max(...CAP_AXES.map((a) => qualityBy[a]))
  const spec = bestSpec(qualityBy)
  const name =
    method === 'merge' && other
      ? `${baseShort(base)}+${baseShort(other)}-Merge`
      : `${baseShort(base)}-${TARGET_LABEL[target]}-${METHOD_LABEL[method]}`
  const desc =
    method === 'merge' && other
      ? `A merge of ${base.name} and ${other.name}.`
      : `Your ${METHOD_LABEL[method]} of ${base.name}, post-trained for ${TARGET_LABEL[target]} (depth ${depth}).`

  return {
    name,
    tier,
    variant: base.variant,
    spec,
    ...body,
    thinking,
    isReasoning,
    thinkTokens,
    quality,
    qualityBy,
    ...(qualityByInstant ? { qualityByInstant } : {}),
    contextWindowK,
    longCtx,
    alignment,
    instructFollow,
    desc,
    depth,
  }
}

/** The per-axis mean of two capability vectors (a weight average, §2.6). */
function avgVec(a: Record<CapabilityAxis, number>, b: Record<CapabilityAxis, number>): Record<CapabilityAxis, number> {
  const out = {} as Record<CapabilityAxis, number>
  for (const k of CAP_AXES) out[k] = clampQ((a[k] + b[k]) / 2)
  return out
}

/** The deploy body a derived checkpoint inherits as a unit: size, KV layout, release precision. */
type DeployBody = Pick<
  ModelDef,
  'paramsTotalB' | 'paramsActiveB' | 'isMoE' | 'layers' | 'kvLayers' | 'kvHeads' | 'headDim' | 'attn' | 'kvBytesPerToken' | 'kvStateMbPerReq' | 'nativeWeightBytes'
>
function bodyOf(m: ModelDef): DeployBody {
  return {
    paramsTotalB: m.paramsTotalB,
    paramsActiveB: m.paramsActiveB,
    isMoE: m.isMoE,
    layers: m.layers,
    kvLayers: m.kvLayers,
    kvHeads: m.kvHeads,
    headDim: m.headDim,
    attn: m.attn,
    kvBytesPerToken: m.kvBytesPerToken,
    kvStateMbPerReq: m.kvStateMbPerReq,
    nativeWeightBytes: m.nativeWeightBytes,
  }
}

/**
 * The roster base a checkpoint descends from: follow each derived model's first parent
 * back to a base (sim fields only — `lineage`, never `m.real`).
 */
export function lineageRoot(s: GameState, m: ModelDef): ModelDef {
  let cur = m
  for (let guard = 0; guard < 64 && cur.lineage; guard++) {
    const parent = resolveModel(s, cur.lineage.baseModelIds[0])
    if (!parent || parent === cur) break
    cur = parent
  }
  return cur
}

/** Why two checkpoints cannot be weight-averaged (null = they can). */
export type MergeBlock = 'missing' | 'self' | 'root' | 'body'

/**
 * §2.6 weight averaging only works across fine-tunes of ONE base (model soups / TIES /
 * DARE): the two checkpoints must be distinct, descend from the same roster base, and
 * share an identical body (params, layers, KV heads, head dim, attention) — a distilled
 * student or a different architecture has no weights to average with.
 */
export function mergeBlock(s: GameState, aId: string, bId: string | undefined): MergeBlock | null {
  if (!bId) return 'missing'
  if (aId === bId) return 'self'
  const a = resolveModel(s, aId)
  const b = resolveModel(s, bId)
  if (!a || !b) return 'missing'
  if (lineageRoot(s, a).id !== lineageRoot(s, b).id) return 'root'
  const same =
    a.paramsTotalB === b.paramsTotalB &&
    a.paramsActiveB === b.paramsActiveB &&
    a.layers === b.layers &&
    a.kvHeads === b.kvHeads &&
    a.headDim === b.headDim &&
    a.attn === b.attn
  return same ? null : 'body'
}

/** Can these two checkpoints be merged (same base, same body, distinct)? */
export function mergeCompatible(s: GameState, aId: string, bId: string | undefined): boolean {
  return mergeBlock(s, aId, bId) === null
}

/**
 * §1.2 — create a derived ModelDef from a post-training run. NON-RECURSIVE
 * snapshot: the base is fully resolved here and the final qualityBy / alignment /
 * deploy fields are FIXED into the new def (via the SHARED `computeDerivedFields`);
 * resolveModel never recurses. Returns the new ModelDef (already written into
 * `s.derivedModels` and owned), or null if the base(s) can't be resolved.
 */
export function deriveModel(s: GameState, meta: PostTrainMeta): ModelDef | null {
  const recipe = METHOD_RECIPES[meta.method]
  if (!recipe) return null
  const base = resolveModel(s, meta.baseIds[0])
  if (!base) return null
  // merge needs a second, same-base upstream model; everyone else has exactly one base.
  const other = meta.method === 'merge' ? resolveModel(s, meta.baseIds[1] ?? '') : null
  if (meta.method === 'merge' && (!other || !mergeCompatible(s, meta.baseIds[0], meta.baseIds[1]))) return null

  const { method, target, effort } = meta
  if (!Number.isFinite(effort) || effort <= 0) return null // startPostTrain admits only the effort notches
  const f = computeDerivedFields(base, recipe, target, effort, other)

  const lineage: Lineage = {
    baseModelIds: meta.baseIds.slice(),
    relation: recipe.relation,
    method,
    target,
    effort,
    spent: {
      data: meta.dataSpent,
      compute: Math.round(
        postTrainComputeCost(recipe, base.paramsActiveB, effort, runBaseDepth(base, other), base.paramsTotalB),
      ),
      waves: 0,
    },
    depth: f.depth,
    createdAtWave: meta.startWave,
  }

  const id = `drv_${s.derivedSeq++}`
  const derived: ModelDef = {
    id,
    name: f.name,
    tier: f.tier,
    variant: f.variant,
    spec: f.spec,
    origin: 'derived',
    paramsTotalB: f.paramsTotalB,
    paramsActiveB: f.paramsActiveB,
    isMoE: f.isMoE,
    thinking: f.thinking,
    isReasoning: f.isReasoning,
    thinkTokens: f.thinkTokens,
    quality: f.quality,
    qualityBy: f.qualityBy,
    ...(f.qualityByInstant ? { qualityByInstant: f.qualityByInstant } : {}),
    layers: f.layers,
    kvLayers: f.kvLayers,
    kvHeads: f.kvHeads,
    headDim: f.headDim,
    attn: f.attn,
    kvBytesPerToken: f.kvBytesPerToken,
    kvStateMbPerReq: f.kvStateMbPerReq,
    nativeWeightBytes: f.nativeWeightBytes,
    contextWindowK: f.contextWindowK,
    longCtx: f.longCtx,
    alignment: f.alignment,
    instructFollow: f.instructFollow,
    desc: f.desc,
    lineage,
  }

  s.derivedModels[id] = derived
  s.models[id] = true
  return derived
}

/* ------------------------------------------------------------------ *
 *  STUDIO PREVIEW (§5.2 S9) — the read-only dry run the Post-Training  *
 *  Studio UI shows before you commit. It calls the SAME                *
 *  `computeDerivedFields` as `deriveModel`, so the projected qualityBy *
 *  / alignment / cost it displays is EXACTLY what training produces    *
 *  (a parity test asserts this). Pure: no mutation of GameState.       *
 * ------------------------------------------------------------------ */

export interface StudioPreview {
  ok: boolean
  /** the base (and, for merge, the partner) the preview is over. */
  base: ModelDef
  other: ModelDef | null
  /** the projected derived snapshot (qualityBy after, alignment after, name, …). */
  fields: DerivedFields
  /** the base's qualityBy BEFORE training (for before→after sparkbars). */
  before: Record<CapabilityAxis, number>
  /** per-axis delta (after − before), the sign of each axis's movement. */
  delta: Record<CapabilityAxis, number>
  /** projected Data cost (paid up front) and compute cost (FLOPS·s, drives waves). */
  dataCost: number
  computeCost: number
  /** estimated waves to finish, given the fleet's requisition throughput (0 if no fleet). */
  estWaves: number
  /** why a merge cannot run with this partner (null when not a merge, or compatible). */
  mergeBlock: MergeBlock | null
  /**
   * The body's capacity ceiling on the target axis WHEN it limits this run (the recipe
   * would add more than the body can hold), else null — so the UI can say why the gain is small.
   */
  ceiling: { axis: CapabilityAxis; value: number } | null
  /** alignment.safety / over-refusal movement (for the safety chips). */
  safetyDelta: number
  overRefusalDelta: number
}

/**
 * §5.2 S9 — compute the live Studio preview for (baseId, method, target, effort).
 * `requisitionPerWave` is the fleet's per-wave training throughput (FLOPS·s the
 * board can pour into this run each wave); pass 0 if unknown → estWaves is 0.
 * Returns `ok:false` (with a degenerate fields snapshot) when the base(s) can't
 * resolve or the recipe/target is invalid — the UI shows a disabled preview.
 */
export function studioPreview(
  s: GameState,
  baseId: string,
  method: PostTrainMethod,
  target: PostTrainTarget,
  effort: number,
  requisitionPerWave = 0,
  otherId?: string,
): StudioPreview | null {
  const recipe = METHOD_RECIPES[method]
  const base = resolveModel(s, baseId)
  if (!recipe || !base) return null
  // a merge previews only with a compatible same-base partner; otherwise it shows the base
  // unchanged with ok:false and the reason, so the UI can say which partner to pick.
  const block = method === 'merge' ? mergeBlock(s, baseId, otherId) : null
  const other = method === 'merge' && !block && otherId ? resolveModel(s, otherId) : null

  const fields = computeDerivedFields(base, recipe, target, effort, other)
  const before = { ...base.qualityBy }
  const delta = {} as Record<CapabilityAxis, number>
  for (const a of CAP_AXES) delta[a] = fields.qualityBy[a] - before[a]

  const previewDepth = runBaseDepth(base, other)
  const dataCost = postTrainDataCost(recipe, effort, previewDepth, base.paramsTotalB)
  const computeCost = Math.max(1, postTrainComputeCost(recipe, base.paramsActiveB, effort, previewDepth, base.paramsTotalB))
  const estWaves = requisitionPerWave > 0 ? Math.max(1, Math.ceil(computeCost / requisitionPerWave)) : 0

  // does the body's capacity ceiling clip this run's gain? (distill / merge have their own rules)
  const axis = gainAxis(target)
  let ceiling: StudioPreview['ceiling'] = null
  if (axis && method !== 'merge' && method !== 'distill') {
    const value = capacityCeiling(base.paramsTotalB, axis)
    const uncapped = uncappedGain(base, recipe, axis, effort, previewDepth + 1)
    if (base.qualityBy[axis] + uncapped > value + 1e-9) ceiling = { axis, value }
  }

  const okTarget = recipe.allowedTargets.includes(target)
  return {
    ok: okTarget && !block,
    base,
    other,
    fields,
    before,
    delta,
    dataCost,
    computeCost,
    estWaves,
    mergeBlock: block,
    ceiling,
    safetyDelta: fields.alignment.safety - base.alignment.safety,
    overRefusalDelta: fields.alignment.overRefusal - base.alignment.overRefusal,
  }
}

/**
 * Pick a smaller STUDENT base for distillation: the largest roster base strictly
 * smaller than the teacher (a real "distil a giant into a deployable body"). Falls
 * back to a small dense default.
 */
function pickDistillStudent(teacher: ModelDef): ModelDef {
  let best: ModelDef | null = null
  for (const m of Object.values(MODEL_DEFS)) {
    if (m.paramsActiveB >= teacher.paramsActiveB) continue
    if (m.paramsTotalB >= teacher.paramsTotalB) continue
    if (!best || m.paramsActiveB > best.paramsActiveB) best = m
  }
  return best ?? MODEL_DEFS[DEFAULT_MODEL_ID]
}

/** Derive a display tier from the resulting capability + size. */
function pickTier(qualityBy: Record<CapabilityAxis, number>, paramsTotalB: number): ModelDef['tier'] {
  const peak = Math.max(...CAP_AXES.map((a) => qualityBy[a]))
  if (peak >= 95 || paramsTotalB >= 100) return 'frontier'
  if (qualityBy.coding >= qualityBy.reasoning && qualityBy.coding >= 60) return 'coding'
  if (paramsTotalB <= 16) return 'small'
  return 'general'
}

/** The model's strongest CapabilityAxis (its `spec`). */
function bestSpec(qualityBy: Record<CapabilityAxis, number>): CapabilityAxis {
  let spec: CapabilityAxis = 'general'
  let bestQ = -1
  for (const a of CAP_AXES) {
    if (qualityBy[a] > bestQ) {
      bestQ = qualityBy[a]
      spec = a
    }
  }
  return spec
}
