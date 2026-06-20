// Why did an agent move get rejected? The sim's action functions return a bare
// boolean, so when one fails we re-walk its gates (on the unchanged state — a
// failed action never mutates) and produce a specific, human-readable reason.
// This is what lets a hosted agent (no repo source) understand a `{ok:false}`.
import type { GameState, PostTrainMethod, PostTrainTarget } from '../core/types'
import { buildCost, hardwareUpgradeCost, nextHardware } from '../sim/actions'
import {
  HARDWARE_DEFS,
  METHOD_RECIPES,
  RESEARCH_DEFS,
  TOWER_DEFS,
  UPGRADE_MAP,
  WAVES,
} from '../sim/content'
import { hasLab, hasLiquidLoop, hwNeedsLiquid, loadout, serverFitsMemory } from '../sim/effects'
import { postTrainDataCost, resolveModel } from '../sim/models'
import { isBuildable } from '../sim/pathing'
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
        if (!inPlay(s)) return `cannot deploy during phase "${s.phase}"`
        const m = resolveModel(s, modelId)
        if (!m) return `unknown model "${modelId}" — pick an id from state.models`
        if (t.modelId === modelId) return `${m.name} is already deployed on rack ${towerId}`
        if (!s.models[modelId]) return `model "${modelId}" is not owned`
        if (!serverFitsMemory(s, loadout(s, t.hwId, modelId))) {
          const hbm = HARDWARE_DEFS[t.hwId ?? '']?.hbmGb
          return `${m.name} (${m.paramsTotalB}B) does not fit rack ${towerId}'s VRAM${hbm ? ` (${hbm}GB)` : ''} — upgrade the rack or research weight quantization (inf_wq_fp8 / inf_wq_int4)`
        }
        return 'deploy rejected'
      }
      case 'upgradeHardware': {
        const [towerId] = args as [number]
        const t = s.towers.find((x) => x.id === towerId)
        if (!t) return `no tower with id ${towerId}`
        if (t.def.kind !== 'server') return `tower ${towerId} (${t.def.name}) is not a server rack`
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
        const dc = postTrainDataCost(recipe, effort)
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
