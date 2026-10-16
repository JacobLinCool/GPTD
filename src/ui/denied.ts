/**
 * ui/denied.ts — "why did that not work?" for the human player.
 *
 * The sim's actions return a bare boolean and never mutate on failure, so after
 * a rejected player action the shell re-walks the action's gates on the
 * unchanged state (the same walk `agent/diagnose.ts` does for the agent bridge)
 * and turns the first failed gate into a localized reason: "Need $48 more",
 * "Needs a Liquid Cooling Loop", "Does not fit 24 GB VRAM", "Model swaps happen
 * between waves". A small toast floats the reason at the cursor; disabled
 * buttons reuse the same text in their tooltip.
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, HUD_H } from '../config'
import type { GameState, PostTrainMethod, PostTrainTarget } from '../core/types'
import { modelName, t, towerName } from '../i18n'
import { prefersReducedMotion } from '../settings'
import { buildCost, hardwareUpgradeCost, nextHardware } from '../sim/actions'
import { HARDWARE_DEFS, METHOD_RECIPES, RESEARCH_DEFS, TOWER_DEFS, WAVES } from '../sim/content'
import { hasLab, hasLiquidLoop, hwNeedsLiquid, loadout, serverFitsMemory } from '../sim/effects'
import { mergeBlock, postTrainDataCost, resolveModel } from '../sim/models'
import { isBuildable } from '../sim/pathing'
import { powerBuildOpen } from '../sim/power'
import { methodUnlocked, researchOwned, researchPrereqsMet, researchTrackOf } from '../sim/research'
import { drawPanel, label } from './theme'

/** A localizable rejection: `deny.<code>` with interpolation params. */
export interface DenyReason {
  code: string
  params?: Record<string, string | number>
}

const r = (code: string, params?: Record<string, string | number>): DenyReason => ({ code, params })
const inPlay = (s: GameState): boolean => s.phase === 'build' || s.phase === 'wave'
const cashShort = (s: GameState, cost: number): DenyReason =>
  r('cash', { need: Math.ceil(cost - s.meters.cash), cost: Math.round(cost) })

/** Player actions the shell can explain. */
export type DenyAction =
  /** picking a build card (before any tile): phase and price only. */
  | { fn: 'pick'; defId: string }
  | { fn: 'build'; defId: string; col: number; row: number }
  | { fn: 'sell'; towerId: number }
  | { fn: 'deploy'; towerId: number; modelId: string }
  | { fn: 'upgrade'; towerId: number }
  | { fn: 'role'; towerId: number }
  | { fn: 'research'; id: string }
  | { fn: 'postTrain'; baseIds: string[]; method: PostTrainMethod; target: PostTrainTarget; effort: number }
  | { fn: 'startWave' }
  | { fn: 'train' }

/** The first gate a failed action tripped, on the unchanged state. */
export function denyReason(s: GameState, a: DenyAction): DenyReason {
  try {
    switch (a.fn) {
      case 'pick': {
        const def = TOWER_DEFS[a.defId]
        if (!def) return r('generic')
        if (!inPlay(s)) return r('phasePlay')
        if (def.kind === 'power' && !powerBuildOpen(s)) return r('powerFreeze')
        const cost = buildCost(s, def)
        if (s.meters.cash < cost) return cashShort(s, cost)
        return r('generic')
      }
      case 'build': {
        const def = TOWER_DEFS[a.defId]
        if (!def) return r('generic')
        if (!inPlay(s)) return r('phasePlay')
        if (!isBuildable(a.col, a.row)) return r('path')
        if (s.towers.some((tw) => tw.col === a.col && tw.row === a.row)) return r('occupied')
        if (def.kind === 'server' && def.hardwareId && hwNeedsLiquid(HARDWARE_DEFS[def.hardwareId]) && !hasLiquidLoop(s))
          return r('liquid', { name: towerName(def) })
        if (def.kind === 'power' && !powerBuildOpen(s)) return r('powerFreeze')
        const cost = buildCost(s, def)
        if (s.meters.cash < cost) return cashShort(s, cost)
        return r('generic')
      }
      case 'sell':
        return s.towers.some((tw) => tw.id === a.towerId) ? r('generic') : r('gone')
      case 'deploy': {
        const tw = s.towers.find((x) => x.id === a.towerId)
        if (!tw) return r('gone')
        if (tw.def.kind !== 'server') return r('notRack')
        if (!inPlay(s)) return r('phasePlay')
        const m = resolveModel(s, a.modelId)
        if (!m) return r('generic')
        if (tw.modelId === a.modelId) return r('sameModel', { model: modelName(m) })
        if (!s.models[a.modelId]) return r('notOwned', { model: modelName(m) })
        if (!serverFitsMemory(s, loadout(s, tw.hwId, a.modelId))) {
          const gb = HARDWARE_DEFS[tw.hwId ?? '']?.hbmGb ?? 0
          return r('noFit', { model: modelName(m), gb: Math.round(gb) })
        }
        // every explicit gate passed — the remaining one is the between-waves rule
        return s.phase === 'wave' ? r('swapBetweenWaves') : r('generic')
      }
      case 'upgrade': {
        const tw = s.towers.find((x) => x.id === a.towerId)
        if (!tw) return r('gone')
        if (tw.def.kind !== 'server') return r('notRack')
        if (!inPlay(s)) return r('phasePlay')
        const next = nextHardware(tw)
        if (!next) return r('maxTier')
        if (hwNeedsLiquid(next) && !hasLiquidLoop(s)) return r('liquid', { name: next.name })
        const cost = hardwareUpgradeCost(s, tw)
        if (s.meters.cash < cost) return cashShort(s, cost)
        return s.phase === 'wave' ? r('upgradeBetweenWaves') : r('generic')
      }
      case 'role': {
        if (s.phase !== 'build') return r('roleBetweenWaves')
        if (!s.infra.disagg) return r('needDisagg')
        const tw = s.towers.find((x) => x.id === a.towerId)
        if (!tw || tw.def.kind !== 'server') return r('notRack')
        return r('generic')
      }
      case 'research': {
        const def = RESEARCH_DEFS[a.id]
        if (!def) return r('generic')
        if (s.phase !== 'build') return r('researchBetweenWaves')
        if (!hasLab(s)) return r('noLab')
        const name = t(`research.${def.id}.name`, undefined, def.name)
        if (researchOwned(s, def)) return r('owned', { name })
        if (!researchPrereqsMet(s, def)) {
          const missing = (def.requires ?? [])
            .filter((id) => {
              const dep = RESEARCH_DEFS[id]
              return !dep || !researchOwned(s, dep)
            })
            .map((id) => t(`research.${id}.name`, undefined, RESEARCH_DEFS[id]?.name ?? id))
          return r('prereq', { list: missing.join(', ') })
        }
        if (s.research[researchTrackOf(def)]) return r('trackBusy')
        if (s.data < def.dataCost) return r('data', { need: Math.ceil(def.dataCost - s.data) })
        return r('generic')
      }
      case 'postTrain': {
        const recipe = METHOD_RECIPES[a.method]
        if (!recipe) return r('generic')
        if (s.phase !== 'build') return r('researchBetweenWaves')
        if (!hasLab(s)) return r('noLab')
        if (!methodUnlocked(s, a.method))
          return r('methodLocked', { tech: t(`tech.${recipe.requiresTech ?? ''}`, undefined, recipe.requiresTech ?? '') })
        if (s.research.posttrain) return r('trackBusy')
        const need = a.method === 'merge' ? 2 : 1
        if (a.baseIds.length < need) return r('pickBase')
        for (let i = 0; i < need; i++) {
          if (!resolveModel(s, a.baseIds[i]) || !s.models[a.baseIds[i]]) return r('pickBase')
        }
        if (a.method === 'merge') {
          const block = mergeBlock(s, a.baseIds[0], a.baseIds[1])
          if (block === 'self' || block === 'missing') return r('mergePartner')
          if (block === 'root') return r('mergeRoot')
          if (block === 'body') return r('mergeBody')
        }
        const base = resolveModel(s, a.baseIds[0])
        const cost = postTrainDataCost(recipe, a.effort, base?.lineage?.depth ?? 0, base?.paramsTotalB ?? 8)
        if (s.data < cost) return r('data', { need: Math.ceil(cost - s.data) })
        return r('generic')
      }
      case 'startWave': {
        if (s.phase === 'wave') return r('waveLive')
        if (!s.endless && s.waveIndex + 1 >= WAVES.length) return r('campaignDone')
        return r('generic')
      }
      case 'train': {
        if (!hasLab(s)) return r('noLab')
        if (s.phase !== 'build') return r('researchBetweenWaves')
        return r('generic')
      }
    }
  } catch {
    return r('generic')
  }
}

/** The localized sentence for a reason. */
export function denyText(reason: DenyReason): string {
  return t('deny.' + reason.code, reason.params)
}

/** Shorthand: the localized reason a failed action gives on this state. */
export function explainDenied(s: GameState, a: DenyAction): string {
  return denyText(denyReason(s, a))
}

/* ------------------------------------------------------------------ *
 *  The floating reason toast (one live at a time)                    *
 * ------------------------------------------------------------------ */

const LIFE = 1.6
const MAX_W = 340

export class DeniedToast {
  readonly view = new Container()
  private bg = new Graphics()
  private txt = label('', 12, COLORS.warn, 'bold')
  private life = 0
  private baseY = 0

  constructor() {
    this.txt.style.wordWrap = true
    this.txt.style.breakWords = true
    this.txt.style.wordWrapWidth = MAX_W - 20
    this.view.addChild(this.bg, this.txt)
    this.view.eventMode = 'none'
    this.view.visible = false
  }

  /**
   * Float `text` near a design-space point (cursor / tile / button); a new
   * message replaces the current one. `tone` 'info' draws a neutral prompt
   * (e.g. "press X again to sell") instead of the warn color.
   */
  show(text: string, x: number, y: number, tone: 'warn' | 'info' = 'warn'): void {
    const col = tone === 'warn' ? COLORS.warn : COLORS.sla
    this.txt.text = text
    this.txt.style.fill = col
    const w = Math.min(MAX_W, Math.ceil(this.txt.width) + 20)
    const h = Math.ceil(this.txt.height) + 12
    this.bg.clear()
    drawPanel(this.bg, 0, 0, w, h, { alpha: 0.96, edge: col, radius: 6 })
    this.txt.x = 10
    this.txt.y = 6
    // above the point (below it near the HUD), clamped onto the canvas
    const px = Math.max(8, Math.min(DESIGN_W - w - 8, x - w / 2))
    const above = y - h - 18
    const py = Math.max(8, Math.min(DESIGN_H - h - 8, above < HUD_H + 4 ? y + 34 : above))
    this.view.x = Math.round(px)
    this.baseY = Math.round(py)
    this.view.y = this.baseY
    this.view.alpha = 1
    this.view.visible = true
    this.life = LIFE
  }

  hide(): void {
    this.life = 0
    this.view.visible = false
  }

  update(dt: number): void {
    if (this.life <= 0) return
    this.life -= dt
    if (this.life <= 0) {
      this.view.visible = false
      return
    }
    // a short rise then a fade over the last 0.4 s (held steady under reduced motion)
    const age = LIFE - this.life
    if (!prefersReducedMotion()) this.view.y = this.baseY - Math.min(6, age * 24)
    this.view.alpha = Math.min(1, this.life / 0.4)
  }
}
