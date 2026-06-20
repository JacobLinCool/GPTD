/**
 * Tiny runtime i18n. Default language is English; Traditional Chinese is the second.
 * Player-facing strings must never be hardcoded — look them up with t().
 *
 * t(key, params?, fallback?):
 *   - resolves DICTS[current][key] → DICTS.en[key] → fallback → key
 *   - interpolates {placeholder} tokens from params
 *
 * Content (request/tower/wave/incident/upgrade names & descriptions) keeps its
 * canonical English in src/sim/content.ts; the display helpers below pass that
 * English as the fallback, so a missing locale key degrades to English.
 */
import { en } from './en'
import { zhTW } from './zh-TW'

export type Lang = 'en' | 'zh-TW'
export const LANGS: Lang[] = ['en', 'zh-TW']
export const LANG_LABEL: Record<Lang, string> = { en: 'EN', 'zh-TW': '中' }

const DICTS: Record<Lang, Record<string, string>> = { en, 'zh-TW': zhTW }

let current: Lang = 'en'
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('gptd_lang') : null
  if (saved === 'en' || saved === 'zh-TW') current = saved
} catch {
  /* ignore */
}

const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

export function setLang(l: Lang): void {
  if (l === current) return
  current = l
  try {
    localStorage.setItem('gptd_lang', l)
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn()
}

export function cycleLang(): Lang {
  const i = LANGS.indexOf(current)
  setLang(LANGS[(i + 1) % LANGS.length])
  return current
}

export function onLangChange(fn: () => void): void {
  listeners.add(fn)
}

export function t(key: string, params?: Record<string, string | number>, fallback?: string): string {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? fallback ?? key
  if (params) {
    for (const k in params) s = s.replaceAll('{' + k + '}', String(params[k]))
  }
  return s
}

// ---- content display helpers (English source lives in content.ts) ----
import type { IncidentDef, ModelDef, RequestTypeDef, TowerDef, UpgradeDef, WaveDef } from '../core/types'

/**
 * A checkpoint's display name. Base roster models look up `model.<id>.name`
 * (falling back to the English in content.ts); player-derived checkpoints carry
 * their generated name verbatim (it is composed, not a translatable string).
 */
export const modelName = (m: ModelDef | null | undefined): string =>
  m ? (m.origin === 'derived' ? m.name : t(`model.${m.id}.name`, undefined, m.name)) : ''

export const reqName = (d: RequestTypeDef) => t(`req.${d.id}.name`, undefined, d.name)
export const reqDesc = (d: RequestTypeDef) => t(`req.${d.id}.desc`, undefined, d.desc)
export const towerName = (d: TowerDef) => t(`tower.${d.id}.name`, undefined, d.name)
export const towerTagline = (d: TowerDef) => t(`tower.${d.id}.tagline`, undefined, d.tagline)
export const towerDesc = (d: TowerDef) => t(`tower.${d.id}.desc`, undefined, d.desc)
export const incName = (i: IncidentDef) => t(`inc.${i.id}.name`, undefined, i.name)
export const incDesc = (i: IncidentDef) => t(`inc.${i.id}.desc`, undefined, i.desc)
export const upName = (u: UpgradeDef) => t(`up.${u.id}.name`, undefined, u.name)
export const upDesc = (u: UpgradeDef) => t(`up.${u.id}.desc`, undefined, u.desc)
export const waveName = (w: WaveDef, i: number) => t(`wave.${i}.name`, undefined, w.name)
export const waveBrief = (w: WaveDef, i: number) => t(`wave.${i}.brief`, undefined, w.brief)
