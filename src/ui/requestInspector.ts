/**
 * ui/requestInspector.ts — S4 RequestInspector (§5.2): click a request packet to
 * see its ROOT PROPERTIES (the workload-physics that drive how it must be served):
 * input/output tokens, context length, per-axis difficulty, primary axis, latency
 * class + SLO targets, cacheable / prefix share, tool use, hazards, and $/Mtok
 * pricing. Expert Mode only (the caller gates on isExpert()).
 *
 * Pure presentation over a live Request from GameState. Shown bottom-left, above
 * the BuildBar; the WaveReport sits top-left so they do not collide.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, LAT_CLASS_SLO } from '../config'
import type { GameState } from '../core/types'
import { fmtLatencyMs, fmtTokens } from './metrics'
import { QualitySparks } from './charts'
import { reqName, t } from '../i18n'
import { drawPanel, label } from './theme'

export class RequestInspector {
  readonly view = new Container()
  private bg = new Graphics()
  private title = label('', 14, COLORS.textBright, 'bold')
  private sub = label('', 11, COLORS.textDim)
  private rows: Text[] = []
  private diffHead = label('', 10, COLORS.textDim, 'bold')
  private sparks = new QualitySparks(220)
  private W = 264

  constructor() {
    this.view.addChild(this.bg)
    this.title.x = 14
    this.title.y = 12
    this.sub.x = 14
    this.sub.y = 32
    this.view.addChild(this.title, this.sub)
    for (let i = 0; i < 11; i++) {
      const r = label('', 11, COLORS.text)
      r.x = 14
      r.y = 52 + i * 17
      this.rows.push(r)
      this.view.addChild(r)
    }
    this.diffHead.text = ''
    this.view.addChild(this.diffHead, this.sparks)
    this.view.visible = false
  }

  update(s: GameState, selectedRequestId: number | null): void {
    const r = selectedRequestId == null ? undefined : s.requests.find((x) => x.id === selectedRequestId && x.alive)
    this.view.visible = !!r
    if (!r) return
    const d = r.def

    this.title.text = reqName(d)
    this.sub.text = t('reqi.archetype', { axis: t('spec.' + d.primaryAxis), cls: d.latClass })

    const lines: { text: string; fill: number }[] = []
    lines.push({
      text: t('reqi.tokens', { in: fmtTokens(d.inputTokens), out: fmtTokens(d.outputTokens) }),
      fill: COLORS.text,
    })
    lines.push({ text: t('reqi.context', { v: fmtTokens(r.contextLen) }), fill: COLORS.text })
    // SLO targets for this request's class (+ per-type overrides)
    const cls = LAT_CLASS_SLO[d.latClass]
    const ttftBound = d.ttftSloMs ?? cls.ttftMs
    lines.push({
      text: t('reqi.slo', {
        ttft: Number.isFinite(ttftBound) ? fmtLatencyMs(ttftBound) : '—',
        tpot: Number.isFinite(cls.tpotMs) ? fmtLatencyMs(cls.tpotMs) : '—',
      }),
      fill: COLORS.sla,
    })
    if (d.e2elSloMs !== undefined) {
      lines.push({ text: t('reqi.e2el', { v: fmtLatencyMs(d.e2elSloMs) }), fill: COLORS.sla })
    }
    lines.push({
      text: t('reqi.cache', {
        able: d.cacheable ? t('reqi.yes') : t('reqi.no'),
        prefix: Math.round(d.prefixShare * 100),
      }),
      fill: COLORS.cooling,
    })
    if (d.toolUse) lines.push({ text: t('reqi.tools'), fill: COLORS.data })
    // hazards (open vs cleared)
    const hazKeys = Object.keys(r.hazards)
    if (hazKeys.length) {
      const open = Object.keys(r.hazardsOpen)
      const haz = hazKeys
        .map((h) => `${h} ${Math.round((r.hazards[h as keyof typeof r.hazards] ?? 0) * 100)}%`)
        .join(', ')
      lines.push({ text: t('reqi.hazards', { v: haz }), fill: COLORS.danger })
      lines.push({
        text: open.length ? t('reqi.hazardsOpen', { v: open.join(', ') }) : t('reqi.hazardsClear'),
        fill: open.length ? COLORS.warn : COLORS.good,
      })
    }
    lines.push({
      text: t('reqi.price', { in: d.pricePerMtokIn.toFixed(2), out: d.pricePerMtokOut.toFixed(2) }),
      fill: COLORS.cash,
    })

    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].text = lines[i]?.text ?? ''
      this.rows[i].style.fill = lines[i]?.fill ?? COLORS.text
    }
    const rowsH = 52 + lines.length * 17 + 6

    // per-axis difficulty sparkbars (reusing the quality spark primitive — the
    // SAME 5 axes a model is judged on, so a player can compare directly).
    this.diffHead.text = t('reqi.difficulty')
    this.diffHead.x = 14
    this.diffHead.y = rowsH
    const diff = {
      chat: d.difficulty.chat ?? 0,
      coding: d.difficulty.coding ?? 0,
      reasoning: d.difficulty.reasoning ?? 0,
      general: d.difficulty.general ?? 0,
      agentic: d.difficulty.agentic ?? 0,
    }
    this.sparks.x = 14
    this.sparks.y = rowsH + 16
    this.sparks.draw(diff)

    const h = rowsH + 16 + this.sparks.height2 + 12
    this.bg.clear()
    drawPanel(this.bg, 0, 0, this.W, h, { alpha: 0.95 })
    // bottom-left, clear of the BuildBar
    this.view.x = 12
    this.view.y = DESIGN_H - BUILDBAR_H - h - 10
  }
}
