/**
 * One visual + audio language for the seven request outcomes (§2.5).
 *
 * The board FX, the HUD, the wave report, the request inspector, the end screen
 * and the audio engine all read THIS table, so a "too slow" answer looks and
 * sounds the same everywhere and never like a "wrong" one. Presentation-only:
 * the sim never imports this file.
 *
 * Every outcome carries a distinct glyph as well as a color, so meaning never
 * rests on hue alone; `colorblind` swaps in an Okabe–Ito-derived palette tuned
 * for the dark board.
 */
import type { Outcome } from './core/types'
import { getSettings } from './settings'

/** Pixel glyphs the renderer draws for each outcome (see src/render). */
export type OutcomeGlyph = 'check' | 'clock' | 'cross' | 'hazard' | 'noentry' | 'overflow' | 'drop'

/** Audio cue ids the audio engine implements for each outcome. */
export type OutcomeCue =
  | 'serve.clean'
  | 'serve.late'
  | 'serve.wrong'
  | 'serve.unsafe'
  | 'serve.refused'
  | 'serve.unservable'
  | 'serve.leak'

export interface OutcomeStyle {
  color: number
  /** colorblind-safe alternative. */
  colorCb: number
  glyph: OutcomeGlyph
  cue: OutcomeCue
  /** 0 = good, 1 = mild, 2 = costly, 3 = severe — drives FX intensity, shake and audio priority. */
  severity: 0 | 1 | 2 | 3
  /** i18n key of the long label ("SLO-miss"). */
  labelKey: string
  /** i18n key of the short board popup ("SLOW"). */
  shortKey: string
  /** i18n key of a one-line plain-language cause ("answered correctly but too late"). */
  causeKey: string
}

export const OUTCOME_STYLE: Record<Outcome, OutcomeStyle> = {
  served: {
    color: 0x57e39b,
    colorCb: 0x56b4e9,
    glyph: 'check',
    cue: 'serve.clean',
    severity: 0,
    labelKey: 'outcome.served',
    shortKey: 'fx.served',
    causeKey: 'cause.served',
  },
  sloMiss: {
    color: 0xffb454,
    colorCb: 0xf0e442,
    glyph: 'clock',
    cue: 'serve.late',
    severity: 1,
    labelKey: 'outcome.sloMiss',
    shortKey: 'fx.sloMiss',
    causeKey: 'cause.sloMiss',
  },
  bad: {
    color: 0xff7a45,
    colorCb: 0xe69f00,
    glyph: 'cross',
    cue: 'serve.wrong',
    severity: 2,
    labelKey: 'outcome.bad',
    shortKey: 'fx.bad',
    causeKey: 'cause.bad',
  },
  unsafe: {
    color: 0xff3b5c,
    colorCb: 0xff5a1f,
    glyph: 'hazard',
    cue: 'serve.unsafe',
    severity: 3,
    labelKey: 'outcome.unsafe',
    shortKey: 'fx.unsafe',
    causeKey: 'cause.unsafe',
  },
  overRefused: {
    color: 0xf78fb3,
    colorCb: 0xcc79a7,
    glyph: 'noentry',
    cue: 'serve.refused',
    severity: 1,
    labelKey: 'outcome.overRefused',
    shortKey: 'fx.overRefused',
    causeKey: 'cause.overRefused',
  },
  unservable: {
    color: 0x7a8aa3,
    colorCb: 0x9aa5b8,
    glyph: 'overflow',
    cue: 'serve.unservable',
    severity: 2,
    labelKey: 'outcome.unservable',
    shortKey: 'fx.unservable',
    causeKey: 'cause.unservable',
  },
  leaked: {
    color: 0xc0504d,
    colorCb: 0xd0d0d0,
    glyph: 'drop',
    cue: 'serve.leak',
    severity: 2,
    labelKey: 'outcome.leaked',
    shortKey: 'fx.leaked',
    causeKey: 'cause.leaked',
  },
}

/** The outcome's display color under the player's current palette setting. */
export function outcomeColor(o: Outcome): number {
  const st = OUTCOME_STYLE[o]
  return getSettings().a11y.colorblind ? st.colorCb : st.color
}
