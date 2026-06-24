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
} from '../core/types'
import { POSTTRAIN_COMPUTE_SCALE } from '../config'
import { DEFAULT_MODEL_ID, METHOD_RECIPES, MODEL_DEFS } from './content'

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

/**
 * §1.4 — the quality delta a recipe produces on its target axis.
 *   depthDamp = 1 / (1 + 0.15 × depth)          // deep chains: diminishing returns
 *   rawGain   = gainScale × √effort × depthDamp  // curated-data returns + depth decay
 *   headroom  = (130 − base[axis]) / 130         // harder to push near the ceiling
 *   gain      = min(rawGain, gainCap × headroom) // PEFT capacity cap (cpt's high cap can exceed it)
 * Returns the positive gain to add to the target axis (≥0). A `safety` target has
 * no quality axis (gainAxis null) → 0 here (the gain is the alignment.safety boost).
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
  const depthDamp = 1 / (1 + 0.15 * depth)
  const rawGain = recipe.gainScale * Math.sqrt(effort) * depthDamp
  const headroom = Math.max(0, (Q_HI - base.qualityBy[axis]) / Q_HI)
  const gain = Math.min(rawGain, recipe.gainCap * headroom)
  return Math.max(0, gain)
}

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
 * compute), not a free way to climb past a capability wall. baseDepth = the base's lineage
 * depth (0 for an original base, 1 for a once-derived checkpoint, …).
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
  isReasoning: boolean
  quality: number
  qualityBy: Record<CapabilityAxis, number>
  layers: number
  kvHeads: number
  headDim: number
  attn: ModelDef['attn']
  weightBytes: 2 | 1 | 0.5
  contextWindowK: number
  alignment: AlignmentProfile
  instructFollow: number
  desc: string
  /** the resulting lineage depth (base depth + 1). */
  depth: number
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
  const depth = (base.lineage?.depth ?? 0) + 1

  // --- qualityBy (snapshot) ---
  const qualityBy: Record<CapabilityAxis, number> = { ...base.qualityBy }

  if (method === 'merge' && other) {
    // merge: average the two upstreams' axes — no gain, no forgetting.
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
    // catastrophic forgetting (§2.1/§2.8): every NON-target capability axis drifts down.
    const forget = recipe.forgetScale * FORGET_SPREAD * Math.sqrt(effort)
    if (forget > 0) {
      for (const a of CAP_AXES) {
        if (a === axis) continue
        qualityBy[a] = clampQ(qualityBy[a] - forget)
      }
    }
  }

  // --- internal state (§3): alignment / instructFollow / isReasoning ---
  const alignment: AlignmentProfile = { ...base.alignment }
  let instructFollow = base.instructFollow
  let isReasoning = base.isReasoning

  if (target === 'safety' || method === 'rlhf' || method === 'cai') {
    const safetyGain = (method === 'rlhf' ? 28 : method === 'cai' ? 26 : 18) * Math.sqrt(effort)
    alignment.safety = Math.min(100, alignment.safety + safetyGain)
    if (method === 'cai') {
      // CAI is a safe-completion Pareto gain: REDUCES over-refusal (§2.4).
      alignment.overRefusal = Math.max(0, alignment.overRefusal - 0.04 * Math.sqrt(effort))
      alignment.refusalStyle = 'safe-completion'
    } else {
      // crude RLHF / safety-SFT raises over-refusal (§2.4 tension).
      alignment.overRefusal = Math.min(1, alignment.overRefusal + 0.05 * Math.sqrt(effort))
      if (alignment.refusalStyle === 'none') alignment.refusalStyle = 'hard-refusal'
    }
  }
  if (method === 'sft') instructFollow = Math.min(100, instructFollow + 8 * Math.sqrt(effort))
  if (method === 'grpo' || (target === 'reasoning' && method !== 'merge')) isReasoning = true

  // --- deployment fields (§4.8/§5.6/§5.7): only distill / qat / merge reshape ---
  let paramsTotalB = base.paramsTotalB
  let paramsActiveB = base.paramsActiveB
  let isMoE = base.isMoE
  let layers = base.layers
  let kvHeads = base.kvHeads
  let headDim = base.headDim
  let attn = base.attn
  let weightBytes = base.weightBytes
  let contextWindowK = base.contextWindowK

  if (method === 'distill') {
    // swap to a smaller STUDENT base's deploy fields + cap qualityBy at min(teacher, student capacity).
    const student = pickDistillStudent(base)
    paramsTotalB = student.paramsTotalB
    paramsActiveB = student.paramsActiveB
    isMoE = student.isMoE
    layers = student.layers
    kvHeads = student.kvHeads
    headDim = student.headDim
    attn = student.attn
    weightBytes = student.weightBytes
    contextWindowK = Math.min(contextWindowK, student.contextWindowK)
    // student-capacity cap: the small body can't hold the full teacher signal.
    for (const a of CAP_AXES) {
      const cap = Math.min(base.qualityBy[a], student.qualityBy[a] + 18)
      qualityBy[a] = clampQ(Math.min(qualityBy[a], cap))
    }
  } else if (method === 'qat') {
    weightBytes = 0.5
    for (const a of CAP_AXES) qualityBy[a] = clampQ(qualityBy[a] - 2)
  } else if (method === 'merge' && other) {
    // a merge inherits the larger of the two bodies (the union must fit).
    if (other.paramsTotalB > paramsTotalB) {
      paramsTotalB = other.paramsTotalB
      paramsActiveB = other.paramsActiveB
      isMoE = other.isMoE
      layers = other.layers
      kvHeads = other.kvHeads
      headDim = other.headDim
      attn = other.attn
    }
    isMoE = isMoE || other.isMoE
    isReasoning = isReasoning || other.isReasoning
    contextWindowK = Math.min(contextWindowK, other.contextWindowK)
  }

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
    paramsTotalB,
    paramsActiveB,
    isMoE,
    isReasoning,
    quality,
    qualityBy,
    layers,
    kvHeads,
    headDim,
    attn,
    weightBytes,
    contextWindowK,
    alignment,
    instructFollow,
    desc,
    depth,
  }
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
  // merge needs a second upstream model; everyone else has exactly one base.
  const other = meta.method === 'merge' ? resolveModel(s, meta.baseIds[1] ?? meta.baseIds[0]) : null
  if (meta.method === 'merge' && !other) return null

  const { method, target, effort } = meta
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
        postTrainComputeCost(recipe, base.paramsActiveB, effort, base.lineage?.depth ?? 0, base.paramsTotalB),
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
    isReasoning: f.isReasoning,
    quality: f.quality,
    qualityBy: f.qualityBy,
    layers: f.layers,
    kvHeads: f.kvHeads,
    headDim: f.headDim,
    attn: f.attn,
    weightBytes: f.weightBytes,
    contextWindowK: f.contextWindowK,
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
  const other = method === 'merge' ? resolveModel(s, otherId ?? baseId) : null
  if (method === 'merge' && !other) return null

  const fields = computeDerivedFields(base, recipe, target, effort, other)
  const before = { ...base.qualityBy }
  const delta = {} as Record<CapabilityAxis, number>
  for (const a of CAP_AXES) delta[a] = fields.qualityBy[a] - before[a]

  const previewDepth = base.lineage?.depth ?? 0
  const dataCost = postTrainDataCost(recipe, effort, previewDepth, base.paramsTotalB)
  const computeCost = Math.max(1, postTrainComputeCost(recipe, base.paramsActiveB, effort, previewDepth, base.paramsTotalB))
  const estWaves = requisitionPerWave > 0 ? Math.max(1, Math.ceil(computeCost / requisitionPerWave)) : 0

  const okTarget = recipe.allowedTargets.includes(target)
  return {
    ok: okTarget,
    base,
    other,
    fields,
    before,
    delta,
    dataCost,
    computeCost,
    estWaves,
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
