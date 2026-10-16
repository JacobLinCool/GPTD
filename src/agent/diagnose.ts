// Why did an agent move get rejected? The sim's action functions return a bare
// boolean, so when one fails we re-walk its gates (on the unchanged state — a
// failed action never mutates) and produce a specific, human-readable reason.
// This is what lets a hosted agent (no repo source) understand a `{ok:false}`.
import type { GameState, PostTrainMethod, PostTrainTarget, WeightFormat } from '../core/types'
import { buildCost, hardwareUpgradeCost, nextHardware } from '../sim/actions'
import {
  HARDWARE_DEFS,
  METHOD_RECIPES,
  RESEARCH_DEFS,
  TOWER_DEFS,
  UPGRADE_MAP,
  WAVES,
} from '../sim/content'
import {
  availableFormats,
  deployBlocker,
  formatResearched,
  hasLab,
  hasLiquidLoop,
  hwNeedsLiquid,
  isBlackwell,
  loadout,
  serverFitsMemory,
  WEIGHT_FORMATS,
} from '../sim/effects'
import { mergeBlock, postTrainDataCost, resolveModel } from '../sim/models'
import { isBuildable } from '../sim/pathing'
import { powerBuildOpen } from '../sim/power'
import { methodUnlocked, researchOwned, researchPrereqsMet, researchTrackOf } from '../sim/research'

const cash = (s: GameState): number => Math.floor(s.meters.cash)
const data = (s: GameState): number => Math.floor(s.data)
const inPlay = (s: GameState): boolean => s.phase === 'build' || s.phase === 'wave'

export function explainRejection(s: GameState, fn: string, args: unknown[]): string {
  try {
    switch (fn) {
      case 'build': {
        const [defId, col, row] = args as [string, number, number]
        const def = TOWER_DEFS[defId]
        if (!def) return `unknown tower type "${defId}" — pick a defId from state.catalog`
        if (!inPlay(s)) return `cannot build during phase "${s.phase}"`
        if (!Number.isInteger(col) || !Number.isInteger(row)) return `col/row must be integers (got ${col},${row})`
        if (!isBuildable(col, row)) return `tile (${col},${row}) is off-grid or sits on a lane path`
        if (s.towers.some((t) => t.col === col && t.row === row)) return `tile (${col},${row}) is already occupied`
        if (def.kind === 'server' && def.hardwareId && hwNeedsLiquid(HARDWARE_DEFS[def.hardwareId]) && !hasLiquidLoop(s))
          return `${def.name} is liquid-cooled — build a Liquid Cooling Loop (cooling_liquid) first`
        if (def.kind === 'power' && !powerBuildOpen(s))
          return `an interconnection freeze is in force: no new Power Plant can be connected until this wave is cleared — fit the fleet inside the power you have`
        const c = buildCost(s, def)
        if (s.meters.cash < c) return `not enough cash: ${def.name} costs ${c}, have ${cash(s)}`
        return 'build rejected'
      }
      case 'sell': {
        const [id] = args as [number]
        if (!s.towers.some((t) => t.id === id)) return `no tower with id ${id}`
        return 'sell rejected'
      }
      case 'deploy': {
        const [towerId, modelId] = args as [number, string]
        const t = s.towers.find((x) => x.id === towerId)
        if (!t) return `no tower with id ${towerId}`
        if (t.def.kind !== 'server') return `tower ${towerId} (${t.def.name}) is not a server rack`
        if (s.phase === 'wave')
          return `models can only be swapped between waves (phase "build"): loading new weights drains the rack — mid-wave only a LoRA adapter of the loaded base can be swapped in, with Multi-LoRA Serving (inf_multilora)`
        if (!inPlay(s)) return `cannot deploy during phase "${s.phase}"`
        const m = resolveModel(s, modelId)
        if (!m) return `unknown model "${modelId}" — pick an id from state.models`
        if (t.modelId === modelId) return `${m.name} is already deployed on rack ${towerId}`
        if (!s.models[modelId]) return `model "${modelId}" is not owned`
        const lo = loadout(s, t.hwId, modelId, t.precision)
        if (!serverFitsMemory(s, lo)) {
          const blocker = deployBlocker(s, lo)
          if (blocker === 'tp')
            return `${m.name} has to span several GPUs of rack ${towerId} — research Tensor Parallelism (inf_par_tp) first`
          if (blocker === 'pp')
            return `${m.name} needs more than 8 GPUs per copy — research Pipeline Parallelism (inf_par_pp) first`
          const hbm = HARDWARE_DEFS[t.hwId ?? '']?.hbmGb
          return `${m.name} (${m.paramsTotalB}B) does not fit rack ${towerId}'s VRAM${hbm ? ` (${hbm}GB)` : ''} — upgrade the rack, research weight quantization (inf_wq_fp8 / inf_wq_int4), or set the rack to a smaller researched format first (setRackPrecision [${towerId}, "int4"]; a 4-bit format below the release precision costs some quality)`
        }
        return 'deploy rejected'
      }
      case 'upgradeHardware': {
        const [towerId] = args as [number]
        const t = s.towers.find((x) => x.id === towerId)
        if (!t) return `no tower with id ${towerId}`
        if (t.def.kind !== 'server') return `tower ${towerId} (${t.def.name}) is not a server rack`
        if (s.phase === 'wave') return `rack hardware can only be upgraded between waves (phase "build"): new GPUs mean reloading the model`
        if (!inPlay(s)) return `cannot upgrade during phase "${s.phase}"`
        const next = nextHardware(t)
        if (!next) return `rack ${towerId} is already at the top hardware tier`
        if (hwNeedsLiquid(next) && !hasLiquidLoop(s))
          return `${next.name} is liquid-cooled — build a Liquid Cooling Loop (cooling_liquid) first`
        const c = hardwareUpgradeCost(s, t)
        if (s.meters.cash < c) return `not enough cash: upgrade to ${next.name} costs ${c}, have ${cash(s)}`
        return 'upgrade rejected'
      }
      case 'cycleRackRole': {
        const [towerId] = args as [number]
        if (s.phase !== 'build') return `rack roles can only change during the build phase (now "${s.phase}")`
        if (!s.infra.disagg) return `P/D disaggregation must be researched first (research inf_disagg)`
        const t = s.towers.find((x) => x.id === towerId)
        if (!t || t.def.kind !== 'server') return `tower ${towerId} is not a server rack`
        return 'role change rejected'
      }
      case 'setRackPrecision': {
        const [towerId, raw] = args as [number, string | null | undefined]
        const t = s.towers.find((x) => x.id === towerId)
        if (!t) return `no tower with id ${towerId}`
        if (t.def.kind !== 'server' || !t.hwId) return `tower ${towerId} (${t.def.name}) is not a server rack`
        if (s.phase !== 'build') return `a rack's weight format can only change between waves (phase "build"): it reloads the weights`
        const fmt = raw == null || raw === 'auto' ? undefined : (String(raw) as WeightFormat)
        if (fmt !== undefined && !WEIGHT_FORMATS.includes(fmt))
          return `unknown format "${raw}" — use one of ${WEIGHT_FORMATS.join(', ')}, or "auto" for the default`
        if (t.precision === fmt) return `rack ${towerId} is already set to ${fmt ?? 'auto'}`
        const hw = HARDWARE_DEFS[t.hwId]
        const m = t.modelId ? resolveModel(s, t.modelId) : null
        if (fmt !== undefined && !availableFormats(s, hw, m).includes(fmt)) {
          if (fmt === 'nvfp4' && !isBlackwell(hw)) return `NVFP4 runs only on Blackwell racks (DGX B200 / GB200 NVL72) with FP4 Tensor Cores`
          if (!formatResearched(s, fmt)) return `${fmt.toUpperCase()} weights are not researched yet (inf_wq_${fmt})`
          return `${fmt.toUpperCase()} is not available on rack ${towerId}`
        }
        if (m && !serverFitsMemory(s, loadout(s, t.hwId, t.modelId, fmt)))
          return `${m.name} would not fit rack ${towerId}'s VRAM in ${fmt ?? 'its auto format'}`
        return 'precision change rejected'
      }
      case 'buyUpgrade': {
        const [id] = args as [string]
        const u = UPGRADE_MAP[id]
        if (!u) return `unknown upgrade "${id}"`
        if (!hasLab(s)) return `buying upgrades needs a Training Lab on the board`
        const cur = s.upgrades[id] ?? 0
        if (cur >= u.maxLevel) return `${u.name} is already at max level`
        if (!(u.requires ?? []).every((r) => (s.upgrades[r] ?? 0) > 0))
          return `${u.name} prerequisites not met: ${(u.requires ?? []).join(', ')}`
        if (s.meters.cash < u.cashCost) return `not enough cash: ${u.name} costs ${u.cashCost}, have ${cash(s)}`
        if (s.data < u.dataCost) return `not enough data: ${u.name} needs ${u.dataCost}, have ${data(s)}`
        return 'upgrade rejected'
      }
      case 'research': {
        const [id] = args as [string]
        const def = RESEARCH_DEFS[id]
        if (!def) return `unknown research "${id}" — pick an id from state.research.options`
        if (s.phase !== 'build') return `research can only start in the build phase (now "${s.phase}")`
        if (!hasLab(s)) return `research needs a Training Lab on the board`
        if (researchOwned(s, def)) return `${def.name} is already researched`
        if (!researchPrereqsMet(s, def))
          return `${def.name} prerequisites not met: ${(def.requires ?? []).map((r) => RESEARCH_DEFS[r]?.name ?? r).join(', ')}`
        const track = researchTrackOf(def)
        if (s.research[track]) return `the ${track} research track is busy`
        if (s.data < def.dataCost) return `not enough data: ${def.name} needs ${def.dataCost}, have ${data(s)}`
        return 'research rejected'
      }
      case 'postTrain': {
        const [rawBases, method, target, effort] = args as [string[] | string, PostTrainMethod, PostTrainTarget, number]
        const baseIds = Array.isArray(rawBases) ? rawBases : rawBases != null ? [rawBases] : []
        const recipe = METHOD_RECIPES[method]
        if (!recipe) return `unknown post-training method "${method}" — see state.studio.methods`
        if (s.phase !== 'build') return `the Studio runs in the build phase only (now "${s.phase}")`
        if (!hasLab(s)) return `post-training needs a Training Lab on the board`
        if (!methodUnlocked(s, method)) return `method "${method}" is locked — research ${recipe.requiresTech} first`
        if (!recipe.allowedTargets.includes(target))
          return `${recipe.name} cannot target "${target}" (allowed: ${recipe.allowedTargets.join(', ')})`
        if (s.research.posttrain) return `a post-training run is already in progress`
        const need = method === 'merge' ? 2 : 1
        if (!Array.isArray(baseIds) || baseIds.length < need)
          return `${recipe.name} needs ${need} base model id(s) as args[0]`
        for (let i = 0; i < need; i++) {
          if (!resolveModel(s, baseIds[i]) || !s.models[baseIds[i]]) return `base model "${baseIds[i]}" is not owned`
        }
        if (method === 'merge') {
          const block = mergeBlock(s, baseIds[0], baseIds[1])
          if (block === 'self') return `a merge needs two DIFFERENT checkpoints (merging a model with itself changes nothing)`
          if (block === 'root')
            return `merge partners must descend from the same base model (weights of different bases cannot be averaged)`
          if (block === 'body')
            return `merge partners must share one architecture (same params, layers, KV heads, head dim, attention) — a distilled or differently shaped checkpoint has no weights to average`
        }
        const base = resolveModel(s, baseIds[0])
        const dc = postTrainDataCost(recipe, effort, base?.lineage?.depth ?? 0, base?.paramsTotalB ?? 8)
        if (s.data < dc) return `not enough data: this run needs ${dc}, have ${data(s)}`
        return 'post-training rejected'
      }
      case 'startWave': {
        if (s.phase !== 'build') return `can only start a wave from the build phase (now "${s.phase}")`
        if (s.waveActive) return `a wave is already active`
        if (!s.endless && s.waveIndex + 1 >= WAVES.length + 1) return `the campaign is already complete`
        return 'start wave rejected'
      }
      case 'continueEndless': {
        if (s.phase !== 'won') return `endless mode unlocks only after winning the campaign`
        if (s.endless) return `already in endless mode`
        return 'continue endless rejected'
      }
      case 'select': {
        const [id] = args as [number]
        return `no tower with id ${id}`
      }
      default:
        return `unknown action: ${fn}`
    }
  } catch {
    return `${fn} rejected (could not determine the reason — check your args against state/help)`
  }
}
