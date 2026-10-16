/**
 * Locale parity and key coverage: the English chrome (en.ts) and Traditional Chinese
 * (zh-TW.ts) must carry the same keys with the same {placeholders}, every key the UI
 * composes from a content or enum id must resolve in both, and zh-TW stays Taiwan usage.
 */
import { describe, expect, it } from 'vitest'
import { OUTCOMES } from '../src/core/types'
import { ACH_CATEGORIES, ACHIEVEMENTS } from '../src/achievements'
import { en } from '../src/i18n/en'
import { zhTW } from '../src/i18n/zh-TW'
import { OUTCOME_STYLE } from '../src/outcomes'
import { CAMPAIGN_THEMES } from '../src/sim/campaign'
import {
  BUILD_ORDER,
  HARDWARE_TIERS,
  INCIDENTS,
  INFRA_LIST,
  METHOD_RECIPES,
  MODEL_LIST,
  REQUEST_LIST,
  RESEARCH_LIST,
  TOWER_DEFS,
} from '../src/sim/content'
import { WEIGHT_FORMATS } from '../src/sim/effects'
import { ALL_HAZARDS } from '../src/sim/safety'
import { HOTKEY_GROUPS } from '../src/ui/help'
import { AXES } from '../src/ui/metrics'

const placeholders = (s: string): string =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',')

/**
 * Content keys whose English lives in the content tables (content.ts, campaign-data.ts,
 * achievements.ts, browsers.ts CODEX_TECH): only zh-TW carries them.
 */
const ZH_ONLY = /^(req|tower|wave|inc|ach|codex\.tech)\./

const SLO_CAUSES = ['ttft', 'tpot', 'e2el', 'ttfat'] as const

function expectKeys(dict: Record<string, string>, keys: string[], where: string): void {
  const missing = keys.filter((k) => !dict[k])
  expect(missing, `${where} is missing`).toEqual([])
}

describe('i18n — locale parity', () => {
  it('every English key exists in zh-TW, with the same placeholders', () => {
    const missing = Object.keys(en).filter((k) => !(k in zhTW))
    expect(missing).toEqual([])
    const drift = Object.keys(en).filter((k) => placeholders(en[k]) !== placeholders(zhTW[k]))
    expect(drift).toEqual([])
  })

  it('zh-TW has no stray chrome keys: its extras are content translations only', () => {
    const stray = Object.keys(zhTW).filter((k) => !(k in en) && !ZH_ONLY.test(k))
    expect(stray).toEqual([])
  })

  it('no value is empty', () => {
    expect(Object.keys(en).filter((k) => !en[k].trim())).toEqual([])
    expect(Object.keys(zhTW).filter((k) => !zhTW[k].trim())).toEqual([])
  })
})

describe('i18n — composed keys resolve in both locales', () => {
  const both = (keys: string[], what: string): void => {
    expectKeys(en, keys, `en ${what}`)
    expectKeys(zhTW, keys, `zh-TW ${what}`)
  }

  it('outcomes: label, popup, cause and plain words', () => {
    const keys = OUTCOMES.flatMap((o) => [
      OUTCOME_STYLE[o].labelKey,
      OUTCOME_STYLE[o].causeKey,
      `fx.${o}`,
      `plain.${o}`,
    ])
    both(keys, 'outcome keys')
  })

  it('SLO-miss causes in the report, the popups and the WHY advice', () => {
    both(
      SLO_CAUSES.flatMap((c) => [`report.slo.${c}`, `fx.cause.${c}`, `why.sloMiss.${c}`]),
      'SLO-cause keys',
    )
  })

  it('axes, hazards, latency classes, tiers and weight formats', () => {
    both(
      AXES.flatMap((a) => [`spec.${a}`, `axis.short.${a}`]),
      'axis keys',
    )
    both(
      ALL_HAZARDS.flatMap((h) => [`hazard.${h}`, `next.hazard.${h}`]),
      'hazard keys',
    )
    both(
      ['IN', 'NR', 'TO'].map((c) => `reqi.n.cls.${c}`),
      'latency-class keys',
    )
    both([...new Set(MODEL_LIST.map((m) => `tier.${m.tier}`))], 'model tier keys')
    both([...new Set(MODEL_LIST.map((m) => `attn.${m.attn}`))], 'attention keys')
    both(
      [...new Set(MODEL_LIST.map((m) => `rack.refusal.${m.alignment.refusalStyle}`))],
      'refusal-style keys',
    )
    both(
      WEIGHT_FORMATS.map((f) => `fmt.${f}`),
      'weight-format keys',
    )
  })

  it('hardware tiers have a localized name and short label', () => {
    both(
      HARDWARE_TIERS.flatMap((id) => [`hw.${id}.name`, `hw.${id}.short`]),
      'hardware keys',
    )
  })

  it('every research node has a name and description; every Codex research row has zh text', () => {
    both(
      RESEARCH_LIST.flatMap((d) => [`research.${d.id}.name`, `research.${d.id}.desc`]),
      'research keys',
    )
    both([...new Set(INFRA_LIST.map((n) => `infra.${n.category}`))], 'infra category keys')
    // the Codex Research tab shows codex.tech.<id>, falling back to the localized research text
    const noCodex = RESEARCH_LIST.filter((d) => !zhTW[`codex.tech.${d.id}`] && !zhTW[`research.${d.id}.desc`])
    expect(noCodex.map((d) => d.id)).toEqual([])
    for (const n of INFRA_LIST) expect(zhTW[`codex.tech.${n.id}`], n.id).toBeTruthy()
  })

  it('post-training methods and targets', () => {
    const recipes = Object.values(METHOD_RECIPES)
    both(
      recipes.flatMap((r) => [`method.${r.id}`, `method.${r.id}.desc`]),
      'method keys',
    )
    both([...new Set(recipes.flatMap((r) => r.allowedTargets.map((x) => `ptt.${x}`)))], 'target keys')
    both([...new Set(recipes.map((r) => `relation.${r.relation}`))], 'relation keys')
  })

  it('the hotkey sheet: every group heading and row', () => {
    both(
      HOTKEY_GROUPS.map((g) => `key.group.${g.id}`),
      'hotkey groups',
    )
    both([...HOTKEY_GROUPS.flatMap((g) => g.rows.map((r) => `key.${r.id}`)), 'key.sellNow'], 'hotkey rows')
  })

  it('zh-TW translates every request, building, incident, wave and achievement', () => {
    expectKeys(
      zhTW,
      REQUEST_LIST.flatMap((d) => [`req.${d.id}.name`, `req.${d.id}.desc`]),
      'zh-TW requests',
    )
    const towers = [...new Set([...BUILD_ORDER, ...Object.keys(TOWER_DEFS)])]
    expectKeys(
      zhTW,
      towers.flatMap((id) => [`tower.${id}.name`, `tower.${id}.tagline`, `tower.${id}.desc`]),
      'zh-TW towers',
    )
    expectKeys(
      zhTW,
      INCIDENTS.flatMap((i) => [`inc.${i.id}.name`, `inc.${i.id}.desc`]),
      'zh-TW incidents',
    )
    expectKeys(
      zhTW,
      CAMPAIGN_THEMES.flatMap((_, i) => [`wave.${i}.name`, `wave.${i}.brief`, `wave.${i}.teaches`]),
      'zh-TW waves',
    )
    expectKeys(
      zhTW,
      ACHIEVEMENTS.flatMap((a) => [`ach.${a.id}.name`, `ach.${a.id}.desc`]),
      'zh-TW achievements',
    )
    expect(ACH_CATEGORIES.filter((c) => !en[`ach.cat.${c}`] || !zhTW[`ach.cat.${c}`])).toEqual([])
  })
})

describe('i18n — zh-TW wording', () => {
  it('uses Taiwan terms (使用者, 並行, 批次), not mainland ones', () => {
    const offenders = Object.entries(zhTW).filter(([, v]) =>
      /用戶(?!端)|並發|批量|視頻|默認|網絡|軟件|服務器|內存/.test(v),
    )
    expect(offenders.map(([k]) => k)).toEqual([])
  })

  it('keeps 漏接 for the dropped (504) outcome only, and never calls a late answer a timeout', () => {
    const label = zhTW['plain.leaked']
    expect(label).toBe('漏接')
    // an unsafe answer that gets through is "送出", not 漏接 (the 504 word)
    const misuse = Object.entries(zhTW).filter(
      ([k, v]) => /漏接(一個|的)?不安全/.test(v) && !k.startsWith('outcome.'),
    )
    expect(misuse.map(([k]) => k)).toEqual([])
    // 超時 reads as the 504 timeout; a late answer is 延遲超標
    const late = Object.entries(zhTW).filter(([, v]) => v.includes('超時'))
    expect(late.map(([k]) => k)).toEqual([])
  })
})
