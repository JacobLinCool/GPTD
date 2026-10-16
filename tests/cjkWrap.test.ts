import { describe, expect, it } from 'vitest'
import { hasCjk, wrapCjkLines } from '../src/ui/cjkWrap'

// a monospace-like measure: Latin / digits / space 1 unit, CJK (incl. full-width punctuation) 2 units
const measure = (s: string): number => [...s].reduce((w, ch) => w + (hasCjk(ch) ? 2 : 1), 0)

describe('ui/cjkWrap — line breaking for zh-TW labels', () => {
  it('fills a line before breaking inside a Han run (no stub line before a long run)', () => {
    const text = '2023 年 2 月：服務台灣馬祖的兩條海底電纜中斷'
    const lines = wrapCjkLines(text, 19, measure)
    // a space-only wrap would leave "2023 年 2" alone on the first line
    expect(lines).toEqual(['2023 年 2 月：服務', '台灣馬祖的兩條海底', '電纜中斷'])
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(19)
    expect(lines.join('')).toBe(text)
  })

  it('keeps Latin words whole and splits one only when it alone is wider than the box', () => {
    expect(wrapCjkLines('部署 Continuous Batching 才能同時服務', 12, measure)).toEqual([
      '部署',
      'Continuous',
      'Batching 才',
      '能同時服務',
    ])
    expect(wrapCjkLines('超長Supercalifragilistic', 8, measure)).toEqual(['超長Supe', 'rcalifra', 'gilistic'])
  })

  it('hangs closing punctuation on the previous line and moves an opening bracket down', () => {
    // "。" would start line 2: it hangs on line 1 instead
    expect(wrapCjkLines('一二三四五。六七', 10, measure)).toEqual(['一二三四五。', '六七'])
    // "（" would end line 1: it moves down with what it opens
    expect(wrapCjkLines('一二三四（五六）', 10, measure)).toEqual(['一二三四', '（五六）'])
  })

  it('keeps a number with its unit', () => {
    // "200" fits line 1 but "ms" does not: the pair moves down together
    expect(wrapCjkLines('之後每字 ≤ 200 ms', 14, measure)).toEqual(['之後每字 ≤', '200 ms'])
  })

  it('keeps explicit newlines and drops spaces at a wrap', () => {
    expect(wrapCjkLines('第一行\n第二行', 40, measure)).toEqual(['第一行', '第二行'])
    expect(wrapCjkLines('一二三四五   六七', 10, measure)).toEqual(['一二三四五', '六七'])
  })

  it("detects CJK text (anything else keeps Pixi's own wrap)", () => {
    expect(hasCjk('Interactive Chat')).toBe(false)
    expect(hasCjk('互動對話 ×9')).toBe(true)
    expect(hasCjk('SLO miss，')).toBe(true)
  })
})
