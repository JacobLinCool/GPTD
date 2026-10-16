/**
 * ui/requestInspector.ts — S4 RequestInspector (§5.2): click a request packet to
 * see where it stands and why it will end the way it will.
 *
 *  - a FORECAST chip: the outcome it is heading for if nothing changes (served,
 *    late, wrong, unsafe unless a guardrail clears it, refused, too long);
 *  - LIVE diagnosis: prefill / decode progress, TTFT so far (or latched) and the
 *    TPOT on the rack generating it against their bounds, the judged axis with
 *    its scaled difficulty and the answering rack's quality on that axis (after
 *    the long-context penalty), hidden thinking tokens, the guardrails it passed
 *    and their latency, which rack is answering, and every hazard with whether
 *    anything on the board can still catch it;
 *  - the static workload profile (tokens, context, prefix share, price).
 *
 * Normal Mode gets the same diagnosis in plain words ("needs Chat ≥ 18 · first
 * word ≤ 0.4 s · ≤ 40 ms per word", "smart enough? ✓"). Pure presentation over a
 * live Request; it never mutates the sim. Shown bottom-left, above the BuildBar.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H } from '../config'
import type { GameState, Outcome, Request, SafetyHazard } from '../core/types'
import { isExpert } from '../mode'
import { OUTCOME_STYLE, outcomeColor } from '../outcomes'
import { hiddenTokensFor, loadoutOf } from '../sim/effects'
import { HARDWARE_DEFS } from '../sim/content'
import { diagnoseRequest, fmtLatencyMs, fmtTokens, type HazardVerdict, type RequestDiagnosis } from './metrics'
import { OUTCOME_CHAR } from './charts'
import { modelName, reqName, t } from '../i18n'
import { drawPanel, label } from './theme'

const W = 300
const PAD = 14
const BAR_W = W - PAD * 2

interface Line {
  text: string
  fill: number
  bold?: boolean
}

/** Latency readout colored against its bound (no bound = plain). */
function latFill(ms: number, bound: number): number {
  if (!Number.isFinite(bound)) return COLORS.text
  return ms <= bound ? COLORS.good : COLORS.danger
}

function bound(ms: number): string {
  return Number.isFinite(ms) ? fmtLatencyMs(ms) : '—'
}

function hazardName(h: SafetyHazard): string {
  return t('hazard.' + h)
}

/** The eval that unlocks a guardrail's detection of this hazard (§3.6). */
function unlockEval(h: SafetyHazard): string {
  return t(`research.${h === 'pii' ? 'r_eval_redteam_v2' : 'r_eval_redteam_v1'}.name`)
}

/** A rack has taken the request on: it is prefilling or decoding it, or its first token is out. */
function admitted(r: Request, d: RequestDiagnosis): boolean {
  if (r.prefillDoneAt !== undefined || r.answeredBy != null) return true
  return !!d.rack && (d.rack.prefillId === r.id || !!d.rack.decodeIds?.includes(r.id))
}

export class RequestInspector {
  readonly view = new Container()
  private bg = new Graphics()
  private title = label('', 14, COLORS.textBright, 'bold')
  private sub = label('', 11, COLORS.textDim)
  private chip = label('', 12, COLORS.good, 'bold')
  private rows: Text[] = []
  private axisBar = new Graphics()
  private axisLbl = label('', 10, COLORS.textDim)

  constructor() {
    this.view.addChild(this.bg, this.title, this.sub, this.chip, this.axisBar, this.axisLbl)
    this.title.x = PAD
    this.title.y = 12
    this.sub.x = PAD
    this.sub.y = 32
    this.sub.style.wordWrap = true
    this.sub.style.wordWrapWidth = W - PAD * 2
    this.chip.x = PAD
    this.chip.style.wordWrap = true
    this.chip.style.wordWrapWidth = W - PAD * 2
    this.axisLbl.x = PAD
    this.axisBar.x = PAD
    for (let i = 0; i < 18; i++) {
      const r = label('', 11, COLORS.text)
      r.x = PAD
      r.style.wordWrap = true
      r.style.wordWrapWidth = W - PAD * 2
      r.style.lineHeight = 15
      this.rows.push(r)
      this.view.addChild(r)
    }
    this.view.visible = false
  }

  update(s: GameState, selectedRequestId: number | null): void {
    const r = selectedRequestId == null ? undefined : s.requests.find((x) => x.id === selectedRequestId && x.alive)
    this.view.visible = !!r
    if (!r) return
    const d = diagnoseRequest(s, r)
    const expert = isExpert()

    this.title.text = reqName(r.def)
    this.sub.text = expert
      ? t('reqi.archetype', { axis: t('spec.' + r.def.primaryAxis), cls: r.def.latClass })
      : t('reqi.n.cls.' + r.def.latClass)
    // until a rack admits it there is nothing to judge yet: a neutral status, not "on track"
    const waiting = d.forecast === 'served' && !admitted(r, d)
    this.chip.text = waiting ? t('reqi.predict.waiting') : this.forecastText(d)
    this.chip.style.fill = waiting ? COLORS.textDim : outcomeColor(d.forecast)
    this.chip.y = this.sub.y + this.sub.height + 6

    let y = this.chip.y + this.chip.height + 8
    y = this.drawAxisBar(r, d, y, expert)
    const lines = expert ? this.expertLines(s, r, d) : this.normalLines(s, r, d)
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]
      const line = lines[i]
      if (!line || !line.text) {
        row.visible = false
        if (line) y += 5
        continue
      }
      row.visible = true
      row.text = line.text
      row.style.fill = line.fill
      row.style.fontWeight = line.bold ? 'bold' : 'normal'
      row.y = y
      y += row.height + 2
    }
    const h = y + 10
    this.bg.clear()
    drawPanel(this.bg, 0, 0, W, h, { alpha: 0.95, edge: waiting ? COLORS.panelEdge : outcomeColor(d.forecast) })
    // bottom-left, clear of the BuildBar
    this.view.x = 12
    this.view.y = DESIGN_H - BUILDBAR_H - h - 10
  }

  private forecastText(d: RequestDiagnosis): string {
    const o: Outcome = d.forecast
    const name = isExpert() ? t(OUTCOME_STYLE[o].labelKey) : t('plain.' + o)
    if (o === 'unsafe' && !d.certain) return `${OUTCOME_CHAR[o]} ${t('reqi.predict.maybe', { o: name })}`
    return `${OUTCOME_CHAR[o]} ${t(o === 'served' ? 'reqi.predict.ok' : 'reqi.predict', { o: name })}`
  }

  /** The ONE judged axis: the answering rack's effective quality vs the request's scaled difficulty. */
  private drawAxisBar(r: Request, d: RequestDiagnosis, y: number, expert: boolean): number {
    const g = this.axisBar
    g.clear()
    const axis = t('spec.' + r.def.primaryAxis)
    this.axisLbl.text =
      d.rackQ === null
        ? t('reqi.axis.noRack', { axis, d: d.difficulty.toFixed(0) })
        : t(expert ? 'reqi.axis' : 'reqi.n.axis', { axis, d: d.difficulty.toFixed(0), q: d.rackQ.toFixed(0) })
    this.axisLbl.y = y
    y += this.axisLbl.height + 3
    const max = Math.max(100, d.difficulty, d.rackQ ?? 0) * 1.1
    g.y = y
    g.roundRect(0, 0, BAR_W, 9, 2).fill({ color: 0x0a0e14, alpha: 0.85 })
    if (d.rackQ !== null) {
      const ok = d.rackQ >= d.difficulty
      g.roundRect(0, 0, Math.max(2, (BAR_W * Math.max(0, d.rackQ)) / max), 9, 2).fill({ color: ok ? COLORS.good : COLORS.danger })
    }
    const tx = Math.round((BAR_W * d.difficulty) / max)
    g.rect(tx - 1, -2, 2, 13).fill({ color: COLORS.textBright })
    return y + 16
  }

  private stageLine(r: Request, d: RequestDiagnosis): Line {
    switch (d.stage) {
      case 'queued':
        return { text: t('reqi.stage.queued'), fill: COLORS.textDim }
      case 'prefill':
        return { text: t('reqi.stage.prefill', { pct: Math.round(d.prefillFrac * 100) }), fill: COLORS.power }
      case 'decode':
        return {
          text: t('reqi.stage.decode', { done: fmtTokens(r.maxWork - Math.max(0, r.work)), total: fmtTokens(r.maxWork) }),
          fill: COLORS.cooling,
        }
      default:
        return { text: t('reqi.stage.done'), fill: COLORS.text }
    }
  }

  private rackName(s: GameState, d: RequestDiagnosis): { hw: string; model: string } | null {
    if (!d.rack) return null
    const lo = loadoutOf(s, d.rack)
    const hw = d.rack.hwId ? HARDWARE_DEFS[d.rack.hwId] : null
    return {
      hw: hw ? t(`hw.${hw.id}.short`, undefined, hw.name.replace(' GPU Rack', '')) : '—',
      model: lo.model ? modelName(lo.model) : '—',
    }
  }

  /**
   * §1.4 the mode it is answered in: latched at its first token (instant, or thinking with the
   * hidden tokens it carries), else the mode its current rack's model would use. A request
   * that generates no text (an embedding) has no mode to show.
   */
  private modeLine(s: GameState, r: Request, d: RequestDiagnosis, plain: boolean): Line | null {
    if (!d.mode || r.def.outputTokens <= 0) return null
    if (d.mode === 'instant') {
      return { text: t(plain ? 'reqi.n.mode.instant' : d.modeFinal ? 'reqi.mode.instant' : 'reqi.mode.will.instant'), fill: COLORS.data }
    }
    const rack = d.rack ? loadoutOf(s, d.rack) : null
    const n = d.modeFinal ? d.thinkTokens : rack?.model ? hiddenTokensFor(rack.model, r.def) : 0
    const key = plain ? 'reqi.n.mode.thinking' : d.modeFinal ? (n > 0 ? 'reqi.mode.thinking' : 'reqi.mode.thinking0') : 'reqi.mode.will.thinking'
    return { text: t(key, { n: fmtTokens(n) }), fill: COLORS.data }
  }

  private hazardLines(d: RequestDiagnosis, plain: boolean): Line[] {
    const fill: Record<HazardVerdict, number> = {
      cleared: COLORS.good,
      catchable: COLORS.warn,
      noGuard: COLORS.danger,
      locked: COLORS.danger,
    }
    return d.hazards.map((h) => ({
      text: t((plain ? 'reqi.n.haz.' : 'reqi.haz.') + h.verdict, {
        h: hazardName(h.hazard),
        sev: Math.round(h.severity * 100),
        eval: unlockEval(h.hazard),
      }),
      fill: fill[h.verdict],
    }))
  }

  private expertLines(s: GameState, r: Request, d: RequestDiagnosis): Line[] {
    const out: Line[] = []
    out.push(this.stageLine(r, d))
    if (d.ctxPenalty > 0.5) out.push({ text: t('reqi.ctxPen', { v: d.ctxPenalty.toFixed(0) }), fill: COLORS.warn })
    if (d.margin !== null) {
      out.push({
        text: t('reqi.margin', { v: (d.margin >= 0 ? '+' : '') + d.margin.toFixed(0), ok: t(d.margin >= 0 ? 'reqi.correct' : 'reqi.wrong') }),
        fill: d.margin >= 0 ? COLORS.good : COLORS.danger,
      })
    }
    out.push({
      text: t(d.ttftFinal ? 'reqi.ttft' : 'reqi.ttftSoFar', { v: fmtLatencyMs(d.ttftMs), b: bound(d.bounds.ttftMs) }),
      fill: latFill(d.ttftMs, d.bounds.ttftMs),
    })
    if (d.tpotMs !== null) {
      out.push({ text: t('reqi.tpot', { v: fmtLatencyMs(d.tpotMs), b: bound(d.bounds.tpotMs) }), fill: latFill(d.tpotMs, d.bounds.tpotMs) })
    }
    if (Number.isFinite(d.bounds.e2elMs)) {
      out.push({ text: t('reqi.e2elNow', { v: fmtLatencyMs(d.e2elMs), b: bound(d.bounds.e2elMs) }), fill: latFill(d.e2elMs, d.bounds.e2elMs) })
    }
    const mode = this.modeLine(s, r, d, false)
    if (mode) out.push(mode)
    if (d.guardsPassed > 0) out.push({ text: t('reqi.guards', { n: d.guardsPassed, ms: fmtLatencyMs(d.guardMs) }), fill: COLORS.sla })
    const rack = this.rackName(s, d)
    out.push(rack ? { text: t('reqi.rack', rack), fill: COLORS.text } : { text: t('reqi.noRack'), fill: COLORS.textDim })
    out.push(...this.hazardLines(d, false))
    out.push({ text: '', fill: COLORS.text })
    out.push({ text: t('reqi.tokens', { in: fmtTokens(r.tokensIn), out: fmtTokens(r.tokensOut) }), fill: COLORS.textDim })
    out.push({ text: t('reqi.context', { v: fmtTokens(r.contextLen) }), fill: COLORS.textDim })
    out.push({
      text: t('reqi.cache', { able: r.def.cacheable ? t('reqi.yes') : t('reqi.no'), prefix: Math.round(r.def.prefixShare * 100) }),
      fill: COLORS.textDim,
    })
    if (r.def.toolUse) out.push({ text: t('reqi.tools'), fill: COLORS.textDim })
    out.push({ text: t('reqi.price', { in: r.pricePerMtokIn.toFixed(2), out: r.pricePerMtokOut.toFixed(2) }), fill: COLORS.cash })
    return out
  }

  private normalLines(s: GameState, r: Request, d: RequestDiagnosis): Line[] {
    const out: Line[] = []
    out.push({
      text: Number.isFinite(d.bounds.ttftMs)
        ? t('reqi.n.needs', { ttft: bound(d.bounds.ttftMs), tpot: bound(d.bounds.tpotMs) })
        : Number.isFinite(d.bounds.e2elMs)
          ? t('reqi.n.needsE2E', { v: bound(d.bounds.e2elMs) })
          : t('reqi.n.needsTO'),
      fill: COLORS.text,
    })
    out.push(this.stageLine(r, d))
    if (d.margin !== null) {
      out.push({
        text: t('reqi.n.smart', { ok: d.margin >= 0 ? '✓' : '✗' }),
        fill: d.margin >= 0 ? COLORS.good : COLORS.danger,
      })
    }
    const slow =
      d.ttftMs > d.bounds.ttftMs || (d.tpotMs !== null && d.tpotMs > d.bounds.tpotMs) || d.e2elMs > d.bounds.e2elMs || r.sloViolated
    out.push({
      text: t('reqi.n.fast', { ok: slow ? '✗' : '✓', v: fmtLatencyMs(d.ttftMs) }),
      fill: slow ? COLORS.danger : COLORS.good,
    })
    const mode = this.modeLine(s, r, d, true)
    if (mode) out.push(mode)
    out.push(...this.hazardLines(d, true))
    const rack = this.rackName(s, d)
    out.push(rack ? { text: t('reqi.n.by', rack), fill: COLORS.textDim } : { text: t('reqi.noRack'), fill: COLORS.textDim })
    return out
  }
}
