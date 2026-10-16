/**
 * ui/cjkWrap.ts — line breaking for Chinese text in word-wrapped Pixi labels.
 *
 * Pixi wraps at spaces only: a run of Han characters is one "word", and a word that
 * does not fit the rest of a line is moved whole to the next one. zh-TW copy mixes
 * spaced Latin terms with long unspaced Han runs ("2023 年 2 月：服務台灣馬祖的…"),
 * so the stock wrap leaves a stub line ("2023 年 2") before every long run. Here
 * every Han character (and CJK punctuation) is its own break opportunity, Latin
 * words stay whole, and closing punctuation never starts a line (it hangs at the end
 * of the previous one) while opening brackets never end one. Text with no CJK goes
 * through Pixi's own wrap untouched.
 */
import type { ICanvas, TextStyle } from 'pixi.js'

/** Han, kana, CJK symbols/punctuation and full-width forms. */
const CJK_CHAR = '\\u2e80-\\u2fff\\u3000-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef'
const HAS_CJK = new RegExp(`[${CJK_CHAR}]`)
/** one CJK character, a run of spaces, or a run of anything else (a Latin word, a number) */
const TOKEN = new RegExp(`[${CJK_CHAR}]|[ \\t]+|[^ \\t${CJK_CHAR}]+`, 'g')
/** never at the start of a line (they hang on the previous one) */
const NO_START = new Set('，。、：；！？）」』】〉》…‥・·％,.;:!?)]}%')
/** never at the end of a line (they move down with what they open) */
const NO_END = new Set('（「『【〈《([{')
/** a number and the short unit after it ("200 ms", "2.0 s", "80 GB") stay on one line */
const NUMBER_END = /\d[\d.,]*%?$/
const UNIT = /^[A-Za-z/]{1,5}$/

export function hasCjk(text: string): boolean {
  return HAS_CJK.test(text)
}

/**
 * Greedy line filling over CJK-aware tokens. `measure` returns a string's advance
 * width; `maxW` is the wrap width. Newlines in the text are kept.
 */
export function wrapCjkLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r\n|\r|\n/)) {
    let line = ''
    let w = 0
    /** where the last word started in `line`, and that word */
    let lastAt = -1
    let lastTok = ''
    const push = (): void => {
      // an opening bracket left at the end moves down with what it opens
      let carry = ''
      while (line.length > 1 && NO_END.has(line[line.length - 1])) {
        carry = line[line.length - 1] + carry
        line = line.slice(0, -1)
      }
      out.push(line.trimEnd())
      line = carry
      w = carry ? measure(carry) : 0
      lastAt = -1
      lastTok = ''
    }
    for (const tok of para.match(TOKEN) ?? []) {
      if (tok[0] === ' ' || tok[0] === '\t') {
        // spaces collapse to one, and never start a wrapped line
        if (line) {
          line += ' '
          w += measure(' ')
        }
        continue
      }
      const tw = measure(tok)
      if (tw > maxW) {
        // a single word wider than the box: break it by character, from where the line is
        for (const ch of tok) {
          const cw = measure(ch)
          if (w + cw > maxW && line.trim()) push()
          line += ch
          w += cw
        }
        continue
      }
      if (w + tw > maxW && line.trim()) {
        // closing punctuation hangs on the line it closes
        if (NO_START.has(tok[0])) {
          line += tok
          w += tw
          continue
        }
        if (lastAt > 0 && NUMBER_END.test(lastTok) && UNIT.test(tok)) {
          // the number moves down with its unit
          const num = line.slice(lastAt)
          line = line.slice(0, lastAt)
          push()
          line = num
          w = measure(num)
        } else push()
      }
      lastAt = line.length
      lastTok = tok
      line += tok
      w += tw
    }
    out.push(line.trimEnd())
  }
  return out
}

type WrapFn = (text: string, style: TextStyle, canvas?: ICanvas) => string

let installed = false

/**
 * Route word-wrapped labels that contain CJK through wrapCjkLines (once, at boot).
 * `metricsClass` is Pixi's CanvasTextMetrics (passed in so this module stays free of
 * runtime Pixi imports and its line breaker can be unit-tested headless).
 */
export function installCjkWrap(metricsClass: object): void {
  if (installed) return
  installed = true
  const metrics = metricsClass as { _wordWrap: WrapFn; _canvas: ICanvas }
  const pixiWrap = metrics._wordWrap.bind(metricsClass)
  metrics._wordWrap = (text, style, canvas = metrics._canvas) => {
    if (!hasCjk(text)) return pixiWrap(text, style, canvas)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return pixiWrap(text, style, canvas)
    ctx.font = style._fontString
    const ls = style.letterSpacing
    const cache = new Map<string, number>()
    const measure = (s: string): number => {
      let v = cache.get(s)
      if (v === undefined) {
        v = ctx.measureText(s).width + ls * [...s].length
        cache.set(s, v)
      }
      return v
    }
    return wrapCjkLines(text, style.wordWrapWidth, measure).join('\n')
  }
}
