/**
 * ui/nextWave.ts — the build-phase NEXT WAVE card: what is coming (name, era,
 * brief, lesson, incident, single-entry surge) and, per archetype, a four-check
 * readiness forecast of the CURRENT fleet against it:
 *
 *   SMART — some rack covering its lanes answers correctly (quality margin ≥ 0 on
 *           the judged axis, after the long-context and INT4 terms combat applies);
 *   FAST  — some covering rack meets its TTFT / TPOT / E2E bounds at its batch;
 *   FITS  — some covering rack's context window holds prompt + answer;
 *   SAFE  — every hazard it carries is caught by a guard covering its lanes (with
 *           the detection category unlocked) or self-handled by every covering model.
 *
 * Estimates only: they read the same getters the sim serves with, but ignore
 * queueing and contention. Pure presentation — reads state, never mutates it.
 */
import { Container, Graphics, Sprite, Text } from 'pixi.js'
import { BUILDBAR_H, COLORS, DESIGN_H, DESIGN_W, LAT_CLASS_SLO, TILE } from '../config'
import type { GameState, LatencyClass, SafetyHazard, Tower } from '../core/types'
import { getLang, incName, reqName, t, waveBrief, waveName } from '../i18n'
import { isExpert } from '../mode'
import type { TextureFactory } from '../render/textures'
import { REQUEST_TYPES, WAVES } from '../sim/content'
import {
  int4ContextPenalty,
  loadoutOf,
  serverContext,
  serverCtxWindowTokens,
  serverFitsMemory,
  serverQualityVs,
} from '../sim/effects'
import { LANE_PATHS } from '../sim/pathing'
import type { WavePreview, WavePreviewEntry } from '../sim/preview'
import { categoryUnlocked, pSelfHandle } from '../sim/safety'
import { fmtLatencyMs, fmtTokens, latencyOf } from './metrics'
import { getPref, setPref } from './prefs'
import { drawPanel, label, UIButton } from './theme'
import { addTooltip, type TooltipSpec } from './tooltip'

/* ------------------------------------------------------------------ *
 *  Readiness forecast (pure)                                         *
 * ------------------------------------------------------------------ */

/** ok = the fleet handles it · fail = it does not · none = no rack covers its lanes · na = not applicable. */
export type CheckState = 'ok' | 'fail' | 'none' | 'na'

export interface HazardCheck {
  hazard: SafetyHazard
  /** a covering guard catches it (category unlocked). */
  guarded: boolean
  /** a covering guard lists it but cannot catch it yet (Red-Team Eval locked). */
  locked: boolean
  /** the weakest covering model's chance to self-handle it (0..1). */
  selfHandle: number
}

export interface Readiness {
  smart: CheckState
  fast: CheckState
  fits: CheckState
  safe: CheckState
  /** racks whose range covers the archetype's lanes. */
  racks: number
  /** best quality margin on the judged axis among covering racks. */
  bestMargin: number
  /** fastest covering rack's TTFT / TPOT (ms) and the bounds. */
  bestTtftMs: number
  bestTpotMs: number
  /** fastest covering rack's end-to-end time for the whole answer (ms). */
  bestE2elMs: number
  ttftBoundMs: number
  tpotBoundMs: number
  e2elBoundMs: number
  /** largest covering context window (tokens) vs what the request needs. */
  bestWindow: number
  needTokens: number
  hazards: HazardCheck[]
}

/** A tower's reach in design px (the sim's targeting range). */
function rangePx(t: Tower): number {
  return t.def.range * TILE
}

/** Does a circle at (x,y) of radius r touch the lane polyline? */
function circleTouchesLane(x: number, y: number, r: number, laneId: number): boolean {
  const lane = LANE_PATHS[laneId]
  if (!lane) return false
  const r2 = r * r
  for (const seg of lane.segments) {
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - seg.a.x) * dx + (y - seg.a.y) * dy) / len2)) : 0
    const px = seg.a.x + dx * u - x
    const py = seg.a.y + dy * u - y
    if (px * px + py * py <= r2) return true
  }
  return false
}

/** Towers whose range covers any of these lanes. */
export function towersCovering(s: GameState, lanes: number[], pred: (t: Tower) => boolean): Tower[] {
  return s.towers.filter((t) => pred(t) && lanes.some((l) => circleTouchesLane(t.x, t.y, rangePx(t), l)))
}

/** The four-check forecast of the current fleet against one upcoming archetype. */
export function forecastReadiness(s: GameState, e: WavePreviewEntry): Readiness {
  const def = REQUEST_TYPES[e.typeId]
  const cls = LAT_CLASS_SLO[e.latClass as LatencyClass]
  const ttftBound = def?.ttftSloMs ?? cls.ttftMs
  const tpotBound = cls.tpotMs
  const e2elBound = def?.e2elSloMs ?? Infinity
  const need = e.inputTokens + e.outputTokens
  const racks = towersCovering(s, e.lanes, (t) => t.def.kind === 'server' && !!t.modelId)
  const out: Readiness = {
    smart: 'none',
    fast: 'none',
    fits: 'none',
    safe: e.hazards.length ? 'none' : 'na',
    racks: racks.length,
    bestMargin: -Infinity,
    bestTtftMs: Infinity,
    bestTpotMs: Infinity,
    bestE2elMs: Infinity,
    ttftBoundMs: ttftBound,
    tpotBoundMs: tpotBound,
    e2elBoundMs: e2elBound,
    bestWindow: 0,
    needTokens: need,
    hazards: [],
  }
  const noLatencySlo = !Number.isFinite(ttftBound) && !Number.isFinite(tpotBound) && !Number.isFinite(e2elBound)
  let anyFast = false
  let minSelf: Partial<Record<SafetyHazard, number>> = {}
  let serving = 0
  for (const tw of racks) {
    const lo = loadoutOf(s, tw)
    if (!lo.hw || !lo.model || !serverFitsMemory(s, lo)) continue
    serving++
    // SMART — the same margin combat latches (judged axis − long-context gap − INT4 long-ctx tax)
    const gap = Math.max(0, e.context - serverContext(s, lo))
    const margin = serverQualityVs(s, lo, e.axis) - gap * 0.45 - int4ContextPenalty(s, need) - e.difficulty
    if (margin > out.bestMargin) out.bestMargin = margin
    // FAST — the rack's own prefill/decode at its effective batch
    const lat = latencyOf(s, lo, e.inputTokens, e.outputTokens)
    if (lat.ttftMs < out.bestTtftMs) out.bestTtftMs = lat.ttftMs
    if (lat.tpotMs < out.bestTpotMs) out.bestTpotMs = lat.tpotMs
    if (lat.e2elMs < out.bestE2elMs) out.bestE2elMs = lat.e2elMs
    const tpotOk = e.outputTokens <= 1 || lat.tpotMs <= tpotBound
    if (lat.ttftMs <= ttftBound && tpotOk && lat.e2elMs <= e2elBound) anyFast = true
    // FITS — the hard window gate
    out.bestWindow = Math.max(out.bestWindow, serverCtxWindowTokens(s, lo))
    // SAFE (layer 1) — the weakest model that may admit it
    for (const h of e.hazards) {
      const p = pSelfHandle(lo.model, h, e.hazardSeverity[h] ?? 0)
      minSelf[h] = Math.min(minSelf[h] ?? 1, p)
    }
  }
  if (serving === 0) {
    minSelf = {}
  } else {
    out.smart = out.bestMargin >= 0 ? 'ok' : 'fail'
    out.fast = noLatencySlo ? 'na' : anyFast ? 'ok' : 'fail'
    out.fits = out.bestWindow >= need ? 'ok' : 'fail'
  }
  if (e.hazards.length) {
    const guards = towersCovering(s, e.lanes, (t) => t.def.kind === 'guardrail' && !!t.def.guardrail)
    let allSafe = true
    for (const h of e.hazards) {
      const listing = guards.filter((g) => g.def.guardrail!.catches.includes(h))
      const unlocked = categoryUnlocked(s, h)
      const hc: HazardCheck = {
        hazard: h,
        guarded: unlocked && listing.length > 0,
        locked: !unlocked && listing.length > 0,
        selfHandle: minSelf[h] ?? 0,
      }
      out.hazards.push(hc)
      if (!hc.guarded && !(serving > 0 && hc.selfHandle >= 0.9)) allSafe = false
    }
    out.safe = serving === 0 && guards.length === 0 ? 'none' : allSafe ? 'ok' : 'fail'
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  Card                                                              *
 * ------------------------------------------------------------------ */

const W = 340
const PAD = 12
const ROW_H = 30
const MAX_ROWS = 9
const CHECKS = ['smart', 'fast', 'fits', 'safe'] as const
const CHECK_W = 40

const checkColor = (c: CheckState): number =>
  c === 'ok' ? COLORS.good : c === 'fail' ? COLORS.danger : c === 'none' ? COLORS.warn : COLORS.textDim
const checkGlyph = (c: CheckState): string => (c === 'ok' ? '✓' : c === 'fail' ? '✗' : c === 'none' ? '?' : '–')

const LAT_WORD: Record<LatencyClass, string> = { IN: 'next.lat.IN', NR: 'next.lat.NR', TO: 'next.lat.TO' }

function fmtBound(ms: number): string {
  return Number.isFinite(ms) ? fmtLatencyMs(ms) : '—'
}

class Row {
  readonly view = new Container()
  readonly icon = new Sprite()
  readonly name = label('', 12, COLORS.textBright, 'bold')
  readonly sub = label('', 10, COLORS.textDim)
  readonly checks: Text[] = []
  entry: WavePreviewEntry | null = null
  ready: Readiness | null = null

  constructor() {
    this.icon.width = 20
    this.icon.height = 20
    this.icon.x = 0
    this.icon.y = 4
    this.name.x = 26
    this.name.y = 1
    this.sub.x = 26
    this.sub.y = 16
    this.view.addChild(this.icon, this.name, this.sub)
    for (let i = 0; i < CHECKS.length; i++) {
      const c = label('', 13, COLORS.textDim, 'bold')
      c.anchor.set(0.5, 0)
      c.x = W - PAD * 2 - CHECK_W * (CHECKS.length - i) + CHECK_W / 2
      c.y = 6
      this.checks.push(c)
      this.view.addChild(c)
    }
    this.view.eventMode = 'static'
    this.view.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= W - PAD * 2 && y >= 0 && y <= ROW_H - 2 }
  }
}

export class NextWaveCard {
  readonly view = new Container()
  private bg = new Graphics()
  private head = label('', 10, COLORS.textDim, 'bold')
  private counter = label('', 10, COLORS.textDim)
  private title = label('', 14, COLORS.textBright, 'bold')
  private brief = label('', 11, COLORS.text)
  private lesson = label('', 11, COLORS.sla)
  private chips = label('', 11, COLORS.warn, 'bold')
  private colHead: Text[] = []
  private rule = new Graphics()
  private rows: Row[] = []
  private foot = label('', 10, COLORS.textDim)
  private note = label('', 9, COLORS.textDim)
  private toggle: UIButton
  private collapsed = getPref('nextWave.collapsed', false)
  private key = ''
  private lastPreview: WavePreview | null = null
  private height = 0

  constructor(private factory: TextureFactory) {
    this.view.x = DESIGN_W - W - 12
    this.view.addChild(this.bg, this.head, this.counter, this.title, this.brief, this.lesson, this.chips, this.rule)
    for (const tl of [this.brief, this.lesson, this.title]) {
      tl.style.wordWrap = true
      tl.style.breakWords = true // CJK runs have no spaces to wrap at
      tl.style.wordWrapWidth = W - PAD * 2
      tl.style.lineHeight = tl === this.title ? 18 : 15
    }
    for (let i = 0; i < CHECKS.length; i++) {
      const c = label('', 9, COLORS.textDim, 'bold')
      c.anchor.set(0.5, 0)
      c.x = PAD + W - PAD * 2 - CHECK_W * (CHECKS.length - i) + CHECK_W / 2
      this.colHead.push(c)
      this.view.addChild(c)
      const key = CHECKS[i]
      addTooltip(c, () => ({ title: t(`next.${key}`), body: t(`next.${key}.tip`) }))
    }
    this.view.addChild(this.foot, this.note)
    this.toggle = new UIButton({
      w: 24,
      h: 18,
      accent: COLORS.sla,
      radius: 4,
      onTap: () => {
        this.collapsed = !this.collapsed
        setPref('nextWave.collapsed', this.collapsed)
        this.key = ''
      },
      tooltip: () => ({ title: t(this.collapsed ? 'next.expand' : 'next.collapse') }),
    })
    this.toggle.x = W - PAD - 24
    this.toggle.y = 7
    this.view.addChild(this.toggle)
    addTooltip(this.title, () => this.titleTip())
    this.view.eventMode = 'static'
    this.view.visible = false
  }

  /** Card height last frame (for stacking other surfaces around it). */
  get bottom(): number {
    return this.view.visible ? this.view.y + this.height : this.view.y
  }

  /**
   * `ghost` = the player holds a build tool: the card fades and lets clicks through,
   * so the board under it stays buildable without collapsing the forecast.
   */
  update(s: GameState, preview: WavePreview | null, top: number, show: boolean, ghost = false): void {
    this.view.visible = show && !!preview
    if (!this.view.visible || !preview) return
    this.view.y = Math.round(top)
    this.view.alpha = ghost ? 0.22 : 1
    this.view.eventMode = ghost ? 'none' : 'static'
    const key = this.stateKey(s, preview, top)
    if (key === this.key) return
    this.key = key
    this.lastPreview = preview
    this.render(s, preview, top)
  }

  /** Everything the card's text depends on — re-render only when it changes. */
  private stateKey(s: GameState, p: WavePreview, top: number): string {
    let k = `${p.index}|${getLang()}|${isExpert() ? 1 : 0}|${this.collapsed ? 1 : 0}|${Math.round(top)}|`
    k += `${p.volumeMul}|${p.incident?.id ?? ''}|${p.surgeLane ?? ''}|${Math.round(p.projectedBill)}|`
    k += `${s.infra.weightQuantBytes}|${s.infra.kv.flash}|${s.infra.kv.prefixHitCeil}|${s.upgrades['eval_redteam'] ?? 0}|`
    k += Object.keys(s.upgrades).length + '|'
    for (const tw of s.towers) k += `${tw.id}:${tw.hwId ?? ''}:${tw.modelId ?? ''}:${tw.role ?? ''};`
    return k
  }

  private render(s: GameState, p: WavePreview, top: number): void {
    const expert = isExpert()
    this.head.text = t('next.head')
    this.head.x = PAD
    this.head.y = 10
    this.counter.text = p.endless
      ? t('next.surgeCounter', { n: p.surgeNumber })
      : `${t('next.counter', { n: p.index + 1, total: WAVES.length })}${p.era ? ' · ' + p.era : ''}`
    this.counter.x = PAD + this.head.width + 8
    this.counter.y = 10
    this.toggle.setTitle(this.collapsed ? '+' : '−').layout(0, 0, true)

    let y = 28
    this.title.text = p.def ? waveName(p.def, p.index) + (p.boss ? `  ${t('next.boss')}` : '') : t('next.endlessTitle', { n: p.surgeNumber })
    this.title.x = PAD
    this.title.y = y
    y += this.title.height + 4

    const body = [this.brief, this.lesson, this.chips, this.foot, this.note, this.rule, ...this.colHead]
    for (const o of body) o.visible = !this.collapsed
    for (const r of this.rows) r.view.visible = false
    if (this.collapsed) {
      this.finish(y + 6)
      return
    }

    const chips: string[] = []
    if (p.incident) chips.push(`${p.incident.icon} ${incName(p.incident)}`)
    if (p.surgeLane !== null) chips.push(t('next.surge', { lane: p.surgeLane + 1 }))
    if (p.volumeMul !== 1) chips.push(t('next.volume', { mul: String(Math.round(p.volumeMul * 100) / 100) }))
    this.chips.text = chips.join('   ')
    this.chips.style.fill = p.incident?.good ? COLORS.trust : COLORS.warn

    // archetype rows (≤ MAX_ROWS); endless surges roll their mix at start
    const entries = p.entries.slice(0, MAX_ROWS)
    while (this.rows.length < entries.length) {
      const r = new Row()
      const idx = this.rows.length
      addTooltip(r.view, () => this.rowTip(idx))
      this.rows.push(r)
      this.view.addChild(r.view)
    }

    // Measure the optional prose, dropping the brief (then the lesson) when the
    // card would run into the build bar; the title tooltip still carries them.
    const brief = p.def ? waveBrief(p.def, p.index) : t('next.endlessBrief')
    const lesson = p.def ? waveLesson(p.def.teaches, p.index) : ''
    this.brief.text = brief
    this.lesson.text = lesson ? t('next.lesson', { v: lesson }) : ''
    const fixed = y + (chips.length ? 20 : 0) + 22 + entries.length * ROW_H + 40
    const room = DESIGN_H - BUILDBAR_H - 12 - top
    let showBrief = true
    let showLesson = !!lesson
    if (fixed + this.brief.height + this.lesson.height + 10 > room) showBrief = false
    if (fixed + (showBrief ? this.brief.height : 0) + this.lesson.height + 6 > room) showLesson = false
    this.brief.visible = showBrief
    this.lesson.visible = showLesson
    if (showBrief) {
      this.brief.x = PAD
      this.brief.y = y
      y += this.brief.height + 4
    }
    if (showLesson) {
      this.lesson.x = PAD
      this.lesson.y = y
      y += this.lesson.height + 4
    }
    this.chips.visible = chips.length > 0
    if (chips.length) {
      this.chips.x = PAD
      this.chips.y = y
      y += 18
    }

    if (!entries.length) {
      for (const c of this.colHead) c.visible = false
      this.rule.visible = false
      this.foot.text = t('next.endlessMix')
      this.foot.x = PAD
      this.foot.y = y + 4
      this.note.visible = false
      this.finish(y + 24)
      return
    }

    y += 4
    this.rule.clear()
    this.rule.rect(PAD, y, W - PAD * 2, 1).fill({ color: COLORS.panelEdge, alpha: 0.9 })
    y += 5
    CHECKS.forEach((c, i) => {
      this.colHead[i].text = t(`next.${c}`)
      this.colHead[i].y = y
    })
    y += 14

    entries.forEach((e, i) => {
      const row = this.rows[i]
      const def = REQUEST_TYPES[e.typeId]
      const ready = forecastReadiness(s, e)
      row.entry = e
      row.ready = ready
      row.view.visible = true
      row.view.x = PAD
      row.view.y = y
      if (def) row.icon.texture = this.factory.request(def)
      // a hazard-carrying archetype is flagged on its name line (the hazards are named below / in the tooltip)
      fitLine(row.name, `${def ? reqName(def) : e.typeId} ×${e.count}${e.hazards.length ? ' ⚠' : ''}`, NAME_W, 12)
      const axis = t('spec.' + e.axis)
      let sub = expert
        ? t('next.subExpert', {
            cls: e.latClass,
            axis,
            d: Math.round(e.difficulty),
            tok: `${fmtTokens(e.inputTokens)}→${fmtTokens(e.outputTokens)}`,
          })
        : t('next.subNormal', { lat: t(LAT_WORD[e.latClass]), axis, d: Math.round(e.difficulty) })
      if (e.hazards.length) sub += ' · ' + e.hazards.map((h) => t('next.hazard.' + h)).join(', ')
      fitLine(row.sub, sub, NAME_W, 10)
      row.name.style.fill = e.hazards.length ? COLORS.warn : COLORS.textBright
      CHECKS.forEach((c, j) => {
        const st = ready[c]
        row.checks[j].text = checkGlyph(st)
        row.checks[j].style.fill = checkColor(st)
      })
      y += ROW_H
    })

    this.foot.text = t('next.foot', {
      n: p.totalRequests,
      bill: Math.max(0, Math.round(p.projectedBill)),
      bonus: p.clearBonus,
    })
    this.foot.x = PAD
    this.foot.y = y + 2
    this.note.text = t('next.estimate')
    this.note.x = PAD
    this.note.y = y + 17
    this.note.visible = true
    this.finish(y + 32)
  }

  private finish(h: number): void {
    this.height = h
    this.bg.clear()
    drawPanel(this.bg, 0, 0, W, h, { alpha: 0.94, edge: COLORS.laneGlow })
  }

  private titleTip(): TooltipSpec | null {
    const p = this.lastPreview
    if (!p) return null
    if (!p.def) return { title: t('next.endlessTitle', { n: p.surgeNumber }), body: t('next.endlessBrief') }
    const lesson = waveLesson(p.def.teaches, p.index)
    const brief = waveBrief(p.def, p.index)
    return { title: waveName(p.def, p.index), body: lesson ? `${brief}\n\n${t('next.lesson', { v: lesson })}` : brief }
  }

  private rowTip(i: number): TooltipSpec | null {
    const row = this.rows[i]
    const e = row?.entry
    const r = row?.ready
    if (!e || !r) return null
    const def = REQUEST_TYPES[e.typeId]
    const lines: string[] = []
    const mark = (c: CheckState): string => checkGlyph(c)
    if (r.racks === 0 || r.smart === 'none') lines.push(t('next.tip.noRack'))
    else {
      lines.push(
        `${mark(r.smart)} ${t('next.tip.smart', { axis: t('spec.' + e.axis), d: Math.round(e.difficulty), m: fmtSigned(r.bestMargin) })}`,
      )
      if (r.fast !== 'na') {
        lines.push(
          `${mark(r.fast)} ${t('next.tip.fast', {
            ttft: fmtLatencyMs(r.bestTtftMs),
            ttftB: fmtBound(r.ttftBoundMs),
            tpot: fmtLatencyMs(r.bestTpotMs),
            tpotB: fmtBound(r.tpotBoundMs),
          })}${
            Number.isFinite(r.e2elBoundMs)
              ? ' · ' + t('next.tip.e2e', { e2e: fmtLatencyMs(r.bestE2elMs), e2eB: fmtBound(r.e2elBoundMs) })
              : ''
          }`,
        )
      }
      lines.push(`${mark(r.fits)} ${t('next.tip.fits', { win: fmtTokens(r.bestWindow), need: fmtTokens(r.needTokens) })}`)
    }
    for (const h of r.hazards) {
      const name = t('next.hazard.' + h.hazard)
      if (h.guarded) lines.push(`✓ ${t('next.tip.guarded', { h: name })}`)
      else if (h.locked) lines.push(`✗ ${t('next.tip.locked', { h: name, p: Math.round(h.selfHandle * 100) })}`)
      else lines.push(`${h.selfHandle >= 0.9 ? '✓' : '✗'} ${t('next.tip.self', { h: name, p: Math.round(h.selfHandle * 100) })}`)
    }
    lines.push(t('next.estimate'))
    return { title: `${def ? reqName(def) : e.typeId} ×${e.count}`, body: lines.join('\n') }
  }
}

/**
 * A wave's lesson in the player's language: the localized `wave.<i>.teaches` when
 * one exists, the canonical English in English, otherwise nothing (no mixed-language card).
 */
function waveLesson(english: string, index: number): string {
  const localized = t(`wave.${index}.teaches`, undefined, '')
  if (localized) return localized
  return getLang() === 'en' ? english : ''
}

/** Width left for a row's name / sub line before the four check columns. */
const NAME_W = W - PAD * 2 - CHECK_W * CHECKS.length - 30

/** Set `text`, shrinking the font (to 9 px) and then ellipsizing so it fits `maxW`. */
function fitLine(tl: Text, text: string, maxW: number, base: number): void {
  tl.style.fontSize = base
  tl.text = text
  if (tl.width > maxW) tl.style.fontSize = Math.max(9, Math.floor((base * maxW) / tl.width))
  let s = text
  while (s.length > 2 && tl.width > maxW) {
    s = s.slice(0, -1)
    tl.text = s.trimEnd() + '…'
  }
}

function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return r >= 0 ? `+${r}` : String(r)
}
