/**
 * ui/thinkingCopy.ts — the words every surface uses for a model's thinking support (§1.4):
 * which traffic it answers instantly, which it thinks about first, how long it thinks, and
 * (Expert) the serving-stack switch and both capability vectors of a hybrid. Pure text: the
 * split itself comes from the engine's policy (`answerMode`, via ui/metrics `modeSplit`).
 */
import type { ModelDef, RequestTypeDef } from '../core/types'
import { reqName, t } from '../i18n'
import { fmtTokens, modeSplit } from './metrics'

const shortName = (d: RequestTypeDef): string => t(`reqshort.${d.id}`, undefined, reqName(d))
const listOf = (defs: RequestTypeDef[]): string => defs.map(shortName).join(t('think.listSep'))

/**
 * Expert one-liner: "Thinking: hybrid · instant on Chat, Code · ~4K tok on the rest". An
 * always-thinking model thinks on everything; a 'never' model on nothing.
 */
export function thinkingLine(m: ModelDef): string {
  const n = fmtTokens(m.thinkTokens)
  if (m.thinking === 'hybrid') return t('think.line.hybrid', { instant: listOf(modeSplit(m).instant), n })
  return m.thinking === 'always' ? t('think.line.always', { n }) : t('think.line.never')
}

/** Normal Mode, in plain words. */
export function thinkingPlain(m: ModelDef): string {
  if (m.thinking === 'hybrid') {
    const split = modeSplit(m)
    return t('think.n.hybrid', { instant: listOf(split.instant), thinking: listOf(split.thinking) })
  }
  return t('think.n.' + m.thinking)
}

/**
 * Expert: from the chat template, the switch a serving stack flips to turn a hybrid's thinking
 * off, or an always-thinker's effort knob (or that it has no off switch at all).
 */
export function thinkingToggle(m: ModelDef): string {
  const toggle = m.real?.thinkingToggle
  if (!toggle || m.thinking === 'never') return ''
  if (m.thinking === 'hybrid') return t('think.toggle', { toggle })
  return toggle === 'none' ? t('think.noSwitch') : t('think.effort', { toggle })
}

/**
 * Expert legend for a hybrid's second vector (the ▏ notches and purple values on its bars):
 * where its thinking-off capability was calibrated from — AA's Non-reasoning row of the same
 * checkpoint, or the thinking→instant pair fit. null for a single-mode model.
 */
export function instantSourceLine(m: ModelDef): string | null {
  if (m.thinking !== 'hybrid' || !m.qualityByInstant) return null
  const via = m.real?.instantVia
  return via ? t('think.alt.via', { via }) : t('think.alt.pairFit')
}
