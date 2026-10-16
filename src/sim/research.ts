import type {
  GameState,
  InfraNodeDef,
  PostTrainMethod,
  PostTrainTarget,
  ResearchDef,
  ResearchSlot,
  ResearchTrack,
  Tower,
} from '../core/types'
import {
  HARDWARE_DEFS,
  INFRA_NODES,
  METHOD_RECIPES,
  RESEARCH_DEFS,
  RESEARCH_MAX_SHARE,
  RESEARCH_TARGET_SECONDS,
} from './content'
import { hasLab, isBlackwell, lvl } from './effects'
import { deriveModel, mergeCompatible, postTrainComputeCost, postTrainDataCost, resolveModel } from './models'

/** Tech/eval nodes sharing a techId stack levels; a node's level is its position. */
export function researchLevelOf(def: ResearchDef): number {
  return def.id.endsWith('_2') || def.id.endsWith('_v2') ? 2 : 1
}

/**
 * Which concurrent track (§4.5 / C7) a research def runs on: a model post-training
 * run takes the 'posttrain' track, an infra tech the 'infra' track, and a dev-time
 * red-team eval the 'eval' track (§3.6 — the P0.5-reserved third track, now used).
 */
export function researchTrackOf(def: ResearchDef): ResearchTrack {
  return def.kind === 'model' ? 'posttrain' : def.kind === 'eval' ? 'eval' : 'infra'
}

/** The slot currently running this exact def, if any (null if its track is idle or busy with another def). */
export function activeSlotFor(s: GameState, def: ResearchDef): ResearchSlot | null {
  const slot = s.research[researchTrackOf(def)]
  return slot && slot.id === def.id ? slot : null
}

/** Any research running on any track right now (§4.5 / C7). */
export function anyResearchActive(s: GameState): boolean {
  return !!(s.research.infra || s.research.posttrain || s.research.eval)
}

/** Has this research node already been completed? */
export function researchOwned(s: GameState, def: ResearchDef): boolean {
  if (def.kind === 'model') return !!(def.modelId && s.models[def.modelId])
  return (s.upgrades[def.techId ?? ''] ?? 0) >= researchLevelOf(def)
}

export function researchPrereqsMet(s: GameState, def: ResearchDef): boolean {
  return (def.requires ?? []).every((r) => {
    const dep = RESEARCH_DEFS[r]
    return dep ? researchOwned(s, dep) : false
  })
}

/** A researched node this one is mutually exclusive with (§4.3 chunked ⟂ disagg, §4.9 SGLang ⟂ TensorRT-LLM), if any. */
export function researchConflict(s: GameState, def: ResearchDef): string | null {
  for (const id of INFRA_NODES[def.id]?.conflicts ?? []) {
    const other = RESEARCH_DEFS[id]
    if (other && researchOwned(s, other)) return id
  }
  return null
}

/** A Blackwell-only technique (NVFP4) needs a Blackwell rack on the board to be worth anything. */
export function researchNeedsBlackwell(s: GameState, def: ResearchDef): boolean {
  if (!INFRA_NODES[def.id]?.requiresBlackwell) return false
  return !s.towers.some((t) => t.def.kind === 'server' && isBlackwell(t.hwId ? HARDWARE_DEFS[t.hwId] : null))
}

/**
 * Can the project be started right now (ignoring the Data bill)? Prerequisites met, not a
 * conflicting alternative of something already researched, and — for a Blackwell-only
 * technique — a Blackwell rack to run it on. One rule for the UI, the agent bridge and the demo.
 */
export function researchUnlocked(s: GameState, def: ResearchDef): boolean {
  return (
    !researchOwned(s, def) &&
    researchPrereqsMet(s, def) &&
    researchConflict(s, def) === null &&
    !researchNeedsBlackwell(s, def)
  )
}

/**
 * Start a training run on its track: build-phase + a Training Lab, the track
 * must be free (other tracks may run concurrently — that's the whole point of
 * C7: training a model no longer blocks infra research), then pay the Data and
 * waves requisition compute.
 */
export function startResearch(s: GameState, id: string): boolean {
  if (s.phase !== 'build') return false
  if (!hasLab(s)) return false // the Training Lab runs the experiments
  const def = RESEARCH_DEFS[id]
  if (!def || !researchUnlocked(s, def)) return false
  const track = researchTrackOf(def)
  if (s.research[track]) return false // this track is busy (others may still run)
  if (s.data < def.dataCost) return false
  s.data -= def.dataCost
  s.research[track] = { id, kind: track, progress: 0, compute: def.compute }
  s.events.push({ type: 'research-start', id, track })
  return true
}

/**
 * §1 POST-TRAINING STUDIO. Whether a recipe's method-unlock has been researched.
 * `sft` is the starter — it needs no unlock. Everything else needs its
 * `requiresTech` flag set (an infra-track tech node, e.g. `pt_lora`).
 */
export function methodUnlocked(s: GameState, method: PostTrainMethod): boolean {
  const recipe = METHOD_RECIPES[method]
  if (!recipe) return false
  if (!recipe.requiresTech) return true // sft
  return lvl(s, recipe.requiresTech) > 0
}

/**
 * Can a post-training run be STARTED right now (ignoring the Data bill)?
 * Validates: build phase, a Training Lab, the method is unlocked, the posttrain
 * track is free, the target is allowed for the method, and every base is owned.
 * `baseIds` is 1 id for finetune/adapter/quantized, 2 for merge.
 */
export function canPostTrain(
  s: GameState,
  baseIds: string[],
  method: PostTrainMethod,
  target: PostTrainTarget,
): boolean {
  if (s.phase !== 'build') return false
  if (!hasLab(s)) return false
  const recipe = METHOD_RECIPES[method]
  if (!recipe) return false
  if (!methodUnlocked(s, method)) return false
  if (!recipe.allowedTargets.includes(target)) return false
  if (s.research.posttrain) return false // the posttrain track is busy
  const need = method === 'merge' ? 2 : 1
  if (baseIds.length < need) return false
  for (let i = 0; i < need; i++) {
    const id = baseIds[i]
    if (!resolveModel(s, id) || !s.models[id]) return false // base not resolvable / not owned
  }
  // §2.6 a merge averages two DISTINCT checkpoints of one base with one body
  if (method === 'merge' && !mergeCompatible(s, baseIds[0], baseIds[1])) return false
  return true
}

/**
 * §1 Start a post-training run on the posttrain track (§4.5 / C7). Validates via
 * `canPostTrain`, pays the Data cost up front, then creates a posttrain slot with
 * `compute = computeCost` and the `meta` payload. On completion (updateResearch →
 * completeResearch) `deriveModel(s, meta)` snapshots the derived checkpoint.
 */
export function startPostTrain(
  s: GameState,
  baseIds: string[],
  method: PostTrainMethod,
  target: PostTrainTarget,
  effort: number,
): boolean {
  if (!canPostTrain(s, baseIds, method, target)) return false
  const recipe = METHOD_RECIPES[method]
  const base = resolveModel(s, baseIds[0])
  if (!base) return false
  const baseDepth = base.lineage?.depth ?? 0
  const dataCost = postTrainDataCost(recipe, effort, baseDepth, base.paramsTotalB)
  if (s.data < dataCost) return false
  const computeCost = postTrainComputeCost(recipe, base.paramsActiveB, effort, baseDepth, base.paramsTotalB)
  s.data -= dataCost
  s.research.posttrain = {
    id: `pt_${method}_${target}`,
    kind: 'posttrain',
    progress: 0,
    compute: Math.max(1, computeCost),
    meta: {
      baseIds: baseIds.slice(0, method === 'merge' ? 2 : 1),
      method,
      target,
      effort,
      dataSpent: dataCost,
      startWave: s.waveIndex,
    },
  }
  s.events.push({ type: 'research-start', id: s.research.posttrain.id, track: 'posttrain' })
  return true
}

function rackFlops(hwId: string | undefined): number {
  // Use real aggregate BF16 TFLOPS as the training-throughput proxy (§6.3).
  return hwId ? (HARDWARE_DEFS[hwId]?.bf16Tflops ?? 0) : 0
}

/** The fleet's aggregate training throughput (sum of server racks' bf16 TFLOPS). */
function fleetFlops(s: GameState): number {
  return s.towers.reduce((n, t) => n + (t.def.kind === 'server' ? rackFlops(t.hwId) : 0), 0)
}

/**
 * The ceiling of the shared requisition pool across all active tracks: RESEARCH_MAX_SHARE
 * of the fleet's FLOPS, so serving never fully stops (§4.5 / C7).
 */
function poolCap(s: GameState): number {
  return fleetFlops(s) * RESEARCH_MAX_SHARE
}

/**
 * WHICH racks research lends (§4.5 / C7): whole racks, strongest first, that FIT under the
 * RESEARCH_MAX_SHARE pool — a rack that would push the lent FLOPS past the cap is skipped
 * (the granularity rounds DOWN, never over the cap). If nothing fits (e.g. two equal
 * racks), the weakest online rack is lent so research can still move — but never the last
 * one: a single-rack datacenter keeps serving and its research waits. Browned-out racks
 * can neither serve nor train and are never picked.
 */
export function requisitionPick(s: GameState): Tower[] {
  const online = s.towers
    .filter((t) => t.def.kind === 'server' && t.online)
    .sort((a, b) => rackFlops(b.hwId) - rackFlops(a.hwId) || a.id - b.id)
  const pool = poolCap(s)
  const pick: Tower[] = []
  let taken = 0
  for (const t of online) {
    const f = rackFlops(t.hwId)
    if (taken + f <= pool) {
      pick.push(t)
      taken += f
    }
  }
  if (!pick.length && online.length >= 2) pick.push(online[online.length - 1])
  return pick
}

/** What lending racks to research would look like right now (pure; the R&D / Studio preview). */
export interface RequisitionPreview {
  /** the racks that would train (strongest that fit the cap). */
  rackIds: number[]
  /** bf16 TFLOPS those racks contribute (at their current thermal throttle). */
  lentTflops: number
  /** the fleet's total bf16 TFLOPS and the RESEARCH_MAX_SHARE cap on lending. */
  fleetTflops: number
  capTflops: number
  /** share (0..1) of the fleet's serving compute that goes dark while training. */
  servingLoss: number
  /** concurrent research tracks that would share the lent compute (incl. the new project). */
  tracks: number
  /** this project's training rate (TFLOPS, after the per-track split). */
  ratePerSec: number
  /** board seconds of wave time the project needs, and that as waves of ~RESEARCH_TARGET_SECONDS. */
  seconds: number
  waves: number
  /** true when the fleet cannot lend anything (fewer than two online racks). */
  blocked: boolean
}

/**
 * Preview the requisition for a project of `compute` TF·s (pure — no state change): which
 * racks would be lent, the serving compute lost while they train, and how long it would
 * take. `includeNew` adds the project as one more track (a run not yet started); pass
 * false to preview a project that is already running. Research only advances during waves,
 * so `waves` divides the board seconds by `waveSeconds` (the caller may pass the next
 * wave's projected length; RESEARCH_TARGET_SECONDS otherwise).
 */
export function requisitionPreview(
  s: GameState,
  compute: number,
  includeNew = true,
  waveSeconds: number = RESEARCH_TARGET_SECONDS,
): RequisitionPreview {
  const pick = requisitionPick(s)
  const fleet = fleetFlops(s)
  const lent = pick.reduce((n, t) => n + rackFlops(t.hwId) * (t.throttle > 0 ? t.throttle : 1), 0)
  const running = (['infra', 'posttrain', 'eval'] as const).filter((tr) => s.research[tr] != null).length
  const tracks = Math.max(1, running + (includeNew ? 1 : 0))
  const ratePerSec = lent / tracks
  const seconds = ratePerSec > 0 ? Math.max(0, compute) / ratePerSec : Infinity
  return {
    rackIds: pick.map((t) => t.id),
    lentTflops: lent,
    fleetTflops: fleet,
    capTflops: poolCap(s),
    servingLoss: fleet > 0 ? pick.reduce((n, t) => n + rackFlops(t.hwId), 0) / fleet : 0,
    tracks,
    ratePerSec,
    seconds,
    waves: Number.isFinite(seconds) ? seconds / Math.max(1, waveSeconds) : Infinity,
    blocked: pick.length === 0,
  }
}

/**
 * Advance every active track by one wave tick. The three tracks SHARE one requisition
 * pool (§4.5 / C7): lend the strongest online racks that fit under the cap
 * (requisitionPick), then split exactly the lent rate EQUALLY across the active tracks —
 * so running two tracks halves each one's speed (compute is genuinely shared), and
 * nothing lent is ever wasted.
 */
export function updateResearch(s: GameState, dt: number): void {
  const tracks: ResearchTrack[] = ['infra', 'posttrain', 'eval']
  const active = tracks.filter((tr): tr is ResearchTrack => s.research[tr] != null)
  if (!active.length) {
    for (const t of s.towers) if (t.training) t.training = false
    return
  }

  const pick = new Set(requisitionPick(s))
  let rate = 0
  for (const t of s.towers) {
    if (t.def.kind !== 'server') continue
    t.training = pick.has(t)
    if (t.training) rate += rackFlops(t.hwId) * t.throttle
  }
  const perTrackRate = rate / active.length
  for (const tr of active) {
    const slot = s.research[tr]
    if (!slot) continue
    slot.progress += perTrackRate * dt
    if (slot.progress >= slot.compute) completeResearch(s, tr)
  }
}

/**
 * §4.2 apply an infra node's flat effect bag to the typed `s.infra` (the single
 * source of truth for serving physics). Each key maps to a switch/level/byte set;
 * unknown keys are ignored (forward-compatible). Determinism: pure mutation, no RNG.
 */
export function applyInfraEffects(s: GameState, effects: InfraNodeDef['effects']): void {
  const inf = s.infra
  for (const [key, raw] of Object.entries(effects)) {
    const v = raw ?? 0
    switch (key) {
      // scheduling
      case 'schedBatch': inf.scheduling.batch = true; break
      case 'multiStep': inf.scheduling.multiStep += v; break
      case 'chunked': inf.scheduling.chunked = true; break
      case 'disagg': inf.disagg = true; break
      // kv-memory
      case 'kvUtilization': inf.kv.utilization = Math.max(inf.kv.utilization, v); break
      case 'prefixHitCeil': inf.kv.prefixHitCeil = Math.max(inf.kv.prefixHitCeil, v); break
      case 'kvQuantBytes': inf.kv.quantBytes = Math.min(inf.kv.quantBytes, v); break
      case 'offloadGb': inf.kv.offloadGb += v; break
      case 'flash': inf.kv.flash += v; break
      // weight formats (PTQ): each rack then picks its own precision among the researched ones
      case 'quantFp8': inf.quant.fp8 = true; break
      case 'quantInt4': inf.quant.int4 = true; break
      case 'quantNvfp4': inf.quant.nvfp4 = true; break
      // decoding
      case 'specEnabled': inf.spec.enabled = true; break
      case 'specLevel': inf.spec.level = Math.max(inf.spec.level, v); break
      // parallelism
      case 'parTp': inf.par.tp = true; break
      case 'parPp': inf.par.pp = true; break
      case 'parDp': inf.par.dp = true; break
      case 'parEp': inf.par.ep = true; break
      // routing / multi-lora / engine
      case 'routingKvAware': inf.routing.kvAware = true; break
      case 'loraSlots': inf.loraSlots = Math.max(inf.loraSlots, v); break
      case 'engineTier': inf.engineTier = Math.max(inf.engineTier, v) as 0 | 1 | 2; break
    }
  }
}

/** Apply a finished track's effect, free its slot, and drop training flags only if no track remains. */
function completeResearch(s: GameState, track: ResearchTrack): void {
  const slot = s.research[track]
  s.research[track] = null
  if (slot?.meta) {
    // §1 a Post-Training Studio run: snapshot the derived model (writes
    // s.derivedModels[id] + s.models[id]) and emit research-done with its id.
    const derived = deriveModel(s, slot.meta)
    if (derived) {
      s.events.push({ type: 'posttrain-done', modelId: derived.id })
      s.events.push({ type: 'research-done', id: derived.id })
    }
  } else {
    const def = slot ? RESEARCH_DEFS[slot.id] : null
    if (def) {
      const node = INFRA_NODES[def.id]
      if (node) {
        // §4.2 an infra serving node: mutate s.infra. The researched MARKER still
        // lives in s.upgrades[node.id] (so researchOwned / prereqs / panels work),
        // but s.infra is the single source of truth the effects getters read.
        applyInfraEffects(s, node.effects)
        s.upgrades[def.techId ?? def.id] = 1
      } else if (def.kind === 'model' && def.modelId) {
        s.models[def.modelId] = true
      } else if (def.techId) {
        // a post-training method-unlock flag (pt_lora / pt_pref / …).
        s.upgrades[def.techId] = (s.upgrades[def.techId] ?? 0) + 1
      }
      s.events.push({ type: 'research-done', id: def.id })
    }
  }
  if (!anyResearchActive(s)) for (const t of s.towers) if (t.training) t.training = false
}
