/**
 * ui/modelOverview.ts — S7 ModelOverview + S8 LineageGraph (§5.2).
 *
 * S7: a scrollable, sortable, filterable table of EVERY checkpoint — the 16
 * roster base models (MODEL_DEFS) plus every player-derived checkpoint
 * (s.derivedModels). Columns: name, origin (base/derived + depth), params
 * total/active (dual-written) + MoE, context window, the 5-axis qualityBy
 * (mini sparkbars, agentic highlighted), alignment safety + refusal style,
 * serve speed / $-Mtoken (on a reference H100), VRAM at FP16/FP8, and license
 * (base) or lineage method (derived). Click a row → a detail card with full
 * stats + the real benchmark breakdown (base) or the Lineage (derived).
 *
 * S8: a "Lineage" toggle renders a tidy DAG — base → instruct → reasoning /
 * distill → FT / merge → quantized — from (a) the roster's real lineage edges
 * (`real.baseModelId` + `real.relation`, [fix H6]) and (b) derived models'
 * `lineage.baseModelIds` + relation. Nodes colored by tier, edges labeled by
 * relation.
 *
 * Pure presentation: reads GameState + the metrics layer; never mutates the sim.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, FRAMEWORK_GB } from '../config'
import type { CapabilityAxis, GameState, ModelDef } from '../core/types'
import { MODEL_DEFS, sizeLabel } from '../sim/content'
import { AA_BENCH } from '../sim/roster.bench.generated'
import { loadout, resolveModel, serverFitsMemory } from '../sim/effects'
import { fmtDollarsPerMtoken, fmtGb, fmtTokS, rackDollarsPerMtoken, rooflineOf } from './metrics'
import { QualitySparks } from './charts'
import { modelName, t } from '../i18n'
import { drawPanel, label, UIButton } from './theme'

const AXES: CapabilityAxis[] = ['chat', 'coding', 'reasoning', 'general', 'agentic']
/** A reference rack for relative serve-speed / $/Mtoken (an H100-class GPU, §5.7). */
const REF_HW = 'hw_perf'
const MODAL_PAD = 24
const TABLE_W = 760
const TABLE_X = MODAL_PAD
const TABLE_Y = 112
const DETAIL_X = 800
const DETAIL_W = 356
const DETAIL_Y = TABLE_Y
const DETAIL_H_PAD = 142
const COLS = [
  { x: 0, w: 224 },
  { x: 224, w: 70 },
  { x: 294, w: 96 },
  { x: 390, w: 62 },
  { x: 452, w: 146 },
  { x: 598, w: 72 },
  { x: 670, w: 78 },
] as const

type SortKey = 'name' | 'origin' | 'paramsTotalB' | 'paramsActiveB' | 'contextWindowK' | 'quality' | 'agentic' | 'safety' | 'vram'
type OriginFilter = 'all' | 'base' | 'derived' | 'owned'

/** A flattened row over a resolved checkpoint with the derived display metrics. */
interface Row {
  m: ModelDef
  owned: boolean
  vramFp16: number
  vramFp8: number
}

function tierColor(tier: ModelDef['tier']): number {
  return tier === 'frontier'
    ? COLORS.data
    : tier === 'coding'
      ? COLORS.good
      : tier === 'small'
        ? COLORS.sla
        : COLORS.cooling
}

function fitText(t: Text, text: string, maxW: number, opts: { size?: number; minSize?: number; ellipsis?: boolean } = {}): void {
  const currentSize = Number(t.style.fontSize)
  const base = opts.size ?? (Number.isFinite(currentSize) ? currentSize : 11)
  const minSize = opts.minSize ?? Math.max(8, base - 2)
  t.style.fontSize = base
  t.text = text
  if (!text || t.width <= maxW) return
  const scaled = Math.max(minSize, Math.floor((base * maxW) / Math.max(1, t.width)))
  t.style.fontSize = scaled
  if (!opts.ellipsis || t.width <= maxW) return
  let lo = 0
  let hi = text.length
  let best = ''
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const candidate = text.slice(0, mid).trimEnd() + '…'
    t.text = candidate
    if (t.width <= maxW) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  t.text = best || '…'
}

function fmtGbCompact(gb: number): string {
  if (gb >= 1000) return (gb / 1000).toFixed(gb >= 10000 ? 0 : 1) + 'T'
  return gb >= 100 ? gb.toFixed(0) + 'G' : gb.toFixed(1) + 'G'
}

function fmtVramPair(fp16: number, fp8: number): string {
  return `${fmtGbCompact(fp16)}/${fmtGbCompact(fp8)}`
}

/* ------------------------------------------------------------------ *
 *  S8 LineageGraph — a tidy DAG of base → … → derived                 *
 * ------------------------------------------------------------------ */

interface Edge {
  from: string
  to: string
  relation: string
}

class LineageGraph extends Container {
  private g = new Graphics()
  private nodeLayer = new Container()
  private W: number
  private H: number

  constructor(w: number, h: number) {
    super()
    this.W = w
    this.H = h
    this.addChild(this.g, this.nodeLayer)
  }

  /** Render the DAG over every resolvable checkpoint that has an edge or is a root with children. */
  draw(s: GameState): void {
    this.g.clear()
    this.nodeLayer.removeChildren()

    // collect all nodes (roster + derived) and the edges between them.
    const all = new Map<string, ModelDef>()
    for (const m of Object.values(MODEL_DEFS)) all.set(m.id, m)
    for (const id of Object.keys(s.derivedModels)) {
      const m = resolveModel(s, id)
      if (m) all.set(id, m)
    }
    const edges: Edge[] = []
    for (const m of all.values()) {
      if (m.origin === 'base' && m.real?.baseModelId && all.has(m.real.baseModelId)) {
        edges.push({ from: m.real.baseModelId, to: m.id, relation: m.real.relation ?? 'finetune' })
      }
      if (m.origin === 'derived' && m.lineage) {
        for (const b of m.lineage.baseModelIds) {
          if (all.has(b)) edges.push({ from: b, to: m.id, relation: m.lineage.relation })
        }
      }
    }

    // assign each node a depth (longest path from a root) for column layout.
    const depth = new Map<string, number>()
    const childrenOf = new Map<string, string[]>()
    for (const e of edges) {
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, [])
      childrenOf.get(e.from)!.push(e.to)
    }
    const parents = new Set(edges.map((e) => e.to))
    const compute = (id: string, seen: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!
      if (seen.has(id)) return 0
      seen.add(id)
      let d = 0
      for (const e of edges) if (e.to === id) d = Math.max(d, compute(e.from, seen) + 1)
      depth.set(id, d)
      return d
    }

    // only show nodes that participate in a lineage (have an edge); roots without
    // children stay out of the graph (they are the flat roster — the table is for them).
    const inGraph = new Set<string>()
    for (const e of edges) {
      inGraph.add(e.from)
      inGraph.add(e.to)
    }
    if (!inGraph.size) {
      const empty = label(t('models.lineage.empty'), 13, COLORS.textDim)
      empty.x = 16
      empty.y = 16
      this.nodeLayer.addChild(empty)
      return
    }

    for (const id of inGraph) compute(id, new Set())

    // group nodes by depth column, sort within a column for stable rows.
    const cols = new Map<number, string[]>()
    let maxDepth = 0
    for (const id of inGraph) {
      const d = depth.get(id) ?? 0
      maxDepth = Math.max(maxDepth, d)
      if (!cols.has(d)) cols.set(d, [])
      cols.get(d)!.push(id)
    }
    for (const arr of cols.values()) arr.sort((a, b) => a.localeCompare(b))

    const colW = Math.max(250, Math.min(360, (this.W - 56) / (maxDepth + 1)))
    // leave a wide inter-column gap so a relation label ("finetune") fits cleanly
    // between nodes instead of being clipped by the next node box.
    const nodeW = Math.min(310, colW - 56)
    const nodeH = 44
    const rowGap = 14
    const graphW = maxDepth * colW + nodeW
    const startX = Math.max(18, (this.W - graphW) / 2)
    const pos = new Map<string, { x: number; y: number }>()
    for (let d = 0; d <= maxDepth; d++) {
      const arr = cols.get(d) ?? []
      const colX = startX + d * colW
      const totalH = arr.length * (nodeH + rowGap)
      const startY = Math.max(16, (this.H - totalH) / 2)
      arr.forEach((id, i) => {
        pos.set(id, { x: colX, y: startY + i * (nodeH + rowGap) })
      })
    }

    // edges first (under nodes); their relation labels are collected and rendered
    // LAST (on top of the nodes) so a node box can never paint over them.
    const edgeLabels: { chip: Graphics; lbl: ReturnType<typeof label> }[] = []
    for (const e of edges) {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) continue
      const x1 = a.x + nodeW
      const y1 = a.y + nodeH / 2
      const x2 = b.x
      const y2 = b.y + nodeH / 2
      const mx = (x1 + x2) / 2
      this.g.moveTo(x1, y1).bezierCurveTo(mx, y1, mx, y2, x2, y2).stroke({ width: 1.5, color: COLORS.laneGlow, alpha: 0.55 })
      this.g.circle(x2 - 2, y2, 2.5).fill({ color: COLORS.laneGlow, alpha: 0.8 })
      const relLbl = label(t('relation.' + e.relation, undefined, e.relation), 8, COLORS.textDim)
      // center the label in the inter-column gap (kept off both node boxes).
      const lo = x1 + 4
      const hi = Math.max(lo, x2 - relLbl.width - 4)
      relLbl.x = Math.round(Math.min(Math.max(mx - relLbl.width / 2, lo), hi))
      relLbl.y = Math.round(Math.min(y1, y2) - 14)
      const chip = new Graphics()
      chip.roundRect(relLbl.x - 4, relLbl.y - 2, relLbl.width + 8, relLbl.height + 4, 4).fill({ color: COLORS.panel, alpha: 0.92 })
      edgeLabels.push({ chip, lbl: relLbl })
    }

    // nodes
    for (const id of inGraph) {
      const m = all.get(id)
      const p = pos.get(id)
      if (!m || !p) continue
      const isRoot = !parents.has(id)
      const col = tierColor(m.tier)
      const node = new Graphics()
      drawPanel(node, p.x, p.y, nodeW, nodeH, { alpha: 0.95, edge: col, radius: 6 })
      node.roundRect(p.x, p.y, 4, nodeH, 2).fill({ color: col, alpha: 0.95 })
      this.nodeLayer.addChild(node)
      const nm = label('', 10, m.origin === 'derived' ? COLORS.data : COLORS.text, 'bold')
      fitText(nm, modelName(m), nodeW - 18, { size: 10, minSize: 9, ellipsis: true })
      nm.x = p.x + 9
      nm.y = p.y + 7
      const sub = label(
        `${m.origin === 'derived' ? t('models.lineage.derived', { depth: m.lineage?.depth ?? 0 }) : isRoot ? t('models.lineage.root') : t('models.lineage.variant')} · ${sizeLabel(m.paramsTotalB)}`,
        9,
        COLORS.textDim,
      )
      sub.x = p.x + 9
      sub.y = p.y + 25
      this.nodeLayer.addChild(nm, sub)
    }

    // relation labels last → always legible above the nodes they connect.
    for (const { chip, lbl } of edgeLabels) this.nodeLayer.addChild(chip, lbl)
  }
}

/* ------------------------------------------------------------------ *
 *  S7 ModelOverview modal                                            *
 * ------------------------------------------------------------------ */

const ROW_H = 28
const VISIBLE_ROWS = 16

export class ModelOverview {
  readonly view = new Container()
  private dim = new Graphics()
  private bg = new Graphics()
  private head = label('', 20, COLORS.textBright, 'bold')
  private sub = label('', 12, COLORS.textDim)
  private closeBtn: UIButton
  private lineageBtn: UIButton
  private filterBtns: { f: OriginFilter; btn: UIButton }[] = []

  // table
  private tableView = new Container()
  private headerRow = new Container()
  private headerBtns: { key: SortKey; btn: UIButton }[] = []
  private rowHost = new Container()
  private rowG = new Graphics()
  private rowCells: { bg: Graphics; texts: Text[]; modelId: string | null }[] = []
  private scrollUp: UIButton
  private scrollDn: UIButton

  // detail
  private detail = new Container()
  private detailG = new Graphics()
  private detailTitle = label('', 16, COLORS.textBright, 'bold')
  private detailRows: Text[] = []
  private detailSparks = new QualitySparks(300)

  // lineage view
  private lineageView = new Container()
  private lineage: LineageGraph

  private sortKey: SortKey = 'paramsTotalB'
  private sortDir: 1 | -1 = -1
  private filter: OriginFilter = 'all'
  private scroll = 0
  private selected: string | null = null
  private showLineage = false

  private PW = 1180
  private PH = 620
  private px: number
  private py: number

  constructor(onClose: () => void) {
    this.px = (DESIGN_W - this.PW) / 2
    this.py = (DESIGN_H - this.PH) / 2
    const { px, py } = this

    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.72 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.bg)
    drawPanel(this.bg, px, py, this.PW, this.PH, { alpha: 0.98 })
    this.head.x = px + 24
    this.head.y = py + 16
    this.sub.x = px + 24
    this.sub.y = py + 44
    this.view.addChild(this.head, this.sub)

    this.closeBtn = new UIButton({ w: 150, h: 34, accent: COLORS.sla, onTap: onClose })
    this.closeBtn.x = px + this.PW - 174
    this.closeBtn.y = py + 14
    this.view.addChild(this.closeBtn)

    this.lineageBtn = new UIButton({ w: 150, h: 28, accent: COLORS.data, onTap: () => (this.showLineage = !this.showLineage) })
    this.lineageBtn.x = px + this.PW - 174
    this.lineageBtn.y = py + 56
    this.view.addChild(this.lineageBtn)

    // origin filters
    const filters: OriginFilter[] = ['all', 'base', 'derived', 'owned']
    filters.forEach((f, i) => {
      const btn = new UIButton({ w: 92, h: 26, accent: COLORS.cooling, onTap: () => { this.filter = f; this.scroll = 0 } })
      btn.x = px + 300 + i * 98
      btn.y = py + 64
      this.view.addChild(btn)
      this.filterBtns.push({ f, btn })
    })

    // --- table ---
    this.view.addChild(this.tableView)
    this.tableView.addChild(this.headerRow, this.rowG, this.rowHost)
    const tableX = px + TABLE_X
    const tableY = py + TABLE_Y
    this.tableView.x = tableX
    this.tableView.y = tableY

    // sortable headers
    const headers: { key: SortKey; col: number }[] = [
      { key: 'name', col: 0 },
      { key: 'origin', col: 1 },
      { key: 'paramsTotalB', col: 2 },
      { key: 'contextWindowK', col: 3 },
      { key: 'quality', col: 4 },
      { key: 'safety', col: 5 },
      { key: 'vram', col: 6 },
    ]
    for (const h of headers) {
      const col = COLS[h.col]
      const btn = new UIButton({ w: col.w - 6, h: 24, accent: COLORS.power, onTap: () => this.setSort(h.key) })
      btn.x = col.x
      btn.y = 0
      this.headerRow.addChild(btn)
      this.headerBtns.push({ key: h.key, btn })
    }

    // pooled rows: 7 text columns each (name, origin, params, ctx, safety, vram,
    // + a spare); the 5-axis quality sparkbars are drawn directly into rowG.
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const bg = new Graphics()
      const texts: Text[] = []
      const cell: { bg: Graphics; texts: Text[]; modelId: string | null } = { bg, texts, modelId: null }
      bg.eventMode = 'static'
      bg.cursor = 'pointer'
      bg.on('pointertap', () => { if (cell.modelId) this.selected = cell.modelId })
      this.rowHost.addChild(bg)
      for (let c = 0; c < 7; c++) {
        const tx = label('', 11, COLORS.text)
        texts.push(tx)
        this.rowHost.addChild(tx)
      }
      this.rowCells.push(cell)
    }

    this.scrollUp = new UIButton({ w: 24, h: 24, accent: COLORS.sla, onTap: () => this.nudge(-1) })
    this.scrollDn = new UIButton({ w: 24, h: 24, accent: COLORS.sla, onTap: () => this.nudge(1) })
    this.scrollUp.x = TABLE_W - 14
    this.scrollUp.y = 32
    this.scrollDn.x = TABLE_W - 14
    this.scrollDn.y = 32 + (VISIBLE_ROWS - 1) * ROW_H
    this.scrollUp.setTitle('▲').layout(0, 0, true)
    this.scrollDn.setTitle('▼').layout(0, 0, true)
    this.tableView.addChild(this.scrollUp, this.scrollDn)

    // --- detail card ---
    this.detail.x = px + DETAIL_X
    this.detail.y = py + DETAIL_Y
    this.detail.addChild(this.detailG, this.detailTitle)
    this.detailTitle.x = 12
    this.detailTitle.y = 10
    for (let i = 0; i < 16; i++) {
      const r = label('', 11, COLORS.text)
      r.x = 12
      r.y = 36 + i * 16
      r.style.wordWrap = true
      r.style.wordWrapWidth = DETAIL_W - 24
      r.style.lineHeight = 14
      this.detailRows.push(r)
      this.detail.addChild(r)
    }
    this.detailSparks.x = 12
    this.detail.addChild(this.detailSparks)
    this.view.addChild(this.detail)

    // --- lineage view ---
    this.lineage = new LineageGraph(this.PW - 48, this.PH - 130)
    this.lineageView.x = px + 24
    this.lineageView.y = py + 100
    this.lineageView.addChild(this.lineage)
    this.view.addChild(this.lineageView)

    this.view.visible = false
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortDir = (this.sortDir * -1) as 1 | -1
    else {
      this.sortKey = key
      this.sortDir = key === 'name' || key === 'origin' ? 1 : -1
    }
  }
  private nudge(d: number): void {
    this.scroll = Math.max(0, this.scroll + d)
  }

  private rows(s: GameState): Row[] {
    const ids = new Set<string>([...Object.keys(MODEL_DEFS), ...Object.keys(s.derivedModels)])
    const out: Row[] = []
    for (const id of ids) {
      const m = resolveModel(s, id)
      if (!m) continue
      const owned = !!s.models[id]
      if (this.filter === 'base' && m.origin !== 'base') continue
      if (this.filter === 'derived' && m.origin !== 'derived') continue
      if (this.filter === 'owned' && !owned) continue
      out.push({
        m,
        owned,
        vramFp16: m.paramsTotalB * 2 + FRAMEWORK_GB,
        vramFp8: m.paramsTotalB * 1 + FRAMEWORK_GB,
      })
    }
    const k = this.sortKey
    out.sort((a, b) => {
      let av: number | string
      let bv: number | string
      switch (k) {
        case 'name': av = a.m.name; bv = b.m.name; break
        case 'origin': av = a.m.origin + (a.m.lineage?.depth ?? 0); bv = b.m.origin + (b.m.lineage?.depth ?? 0); break
        case 'agentic': av = a.m.qualityBy.agentic; bv = b.m.qualityBy.agentic; break
        case 'safety': av = a.m.alignment.safety; bv = b.m.alignment.safety; break
        case 'vram': av = a.vramFp16; bv = b.vramFp16; break
        case 'quality': av = a.m.quality; bv = b.m.quality; break
        default: av = a.m[k] as number; bv = b.m[k] as number; break
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * this.sortDir
      return ((av as number) - (bv as number)) * this.sortDir
    })
    return out
  }

  update(s: GameState): void {
    this.head.text = t('models.title')
    const total = Object.keys(MODEL_DEFS).length + Object.keys(s.derivedModels).length
    this.sub.text = t('models.sub', { base: Object.keys(MODEL_DEFS).length, derived: Object.keys(s.derivedModels).length, total })
    this.closeBtn.setTitle(t('models.close')).layout(0, 0, true)
    this.lineageBtn.setTitle(this.showLineage ? t('models.viewTable') : t('models.viewLineage')).setActive(this.showLineage).layout(0, 0, true)

    for (const { f, btn } of this.filterBtns) {
      btn.setTitle(t('models.filter.' + f)).setActive(this.filter === f).layout(0, 0, true)
    }

    // toggle table vs lineage view
    this.tableView.visible = !this.showLineage
    this.detail.visible = !this.showLineage
    this.lineageView.visible = this.showLineage
    if (this.showLineage) {
      this.lineage.draw(s)
      return
    }

    // header labels with sort arrows
    for (const { key, btn } of this.headerBtns) {
      const arrow = this.sortKey === key ? (this.sortDir === 1 ? ' ▲' : ' ▼') : ''
      btn.setTitle(t('models.col.' + key) + arrow).setActive(this.sortKey === key).layout(0, 0, true)
    }

    const rows = this.rows(s)
    const maxScroll = Math.max(0, rows.length - VISIBLE_ROWS)
    if (this.scroll > maxScroll) this.scroll = maxScroll
    this.scrollUp.setEnabled(this.scroll > 0)
    this.scrollDn.setEnabled(this.scroll < maxScroll)

    this.rowG.clear()
    for (let i = 0; i < this.rowCells.length; i++) {
      const cell = this.rowCells[i]
      const row = rows[i + this.scroll]
      const y = 32 + i * ROW_H
      if (!row) {
        cell.modelId = null
        cell.bg.clear()
        cell.bg.eventMode = 'none'
        for (const tx of cell.texts) tx.text = ''
        continue
      }
      const m = row.m
      cell.modelId = m.id
      cell.bg.eventMode = 'static'
      const sel = this.selected === m.id
      cell.bg.clear()
      cell.bg.roundRect(0, y, TABLE_W, ROW_H - 2, 4).fill({
        color: sel ? 0x1a2c44 : i % 2 ? 0x0c1320 : 0x0e1622,
        alpha: 0.9,
      })
      if (sel) cell.bg.roundRect(0, y, 3, ROW_H - 2, 2).fill({ color: COLORS.data })

      const setT = (c: number, slot: number, text: string, size = 11, fill: number = COLORS.text): void => {
        const tx = cell.texts[slot]
        tx.style.fill = fill
        tx.x = COLS[c].x + 6
        tx.y = y + 7
        fitText(tx, text, COLS[c].w - 12, { size, minSize: 8, ellipsis: true })
      }
      setT(0, 0, modelName(m), 11, m.origin === 'derived' ? COLORS.data : COLORS.text)
      setT(1, 1, m.origin === 'derived' ? t('models.d', { d: m.lineage?.depth ?? 0 }) : t('models.base'), 10, m.origin === 'derived' ? COLORS.data : COLORS.textDim)
      setT(2, 2, t('models.params', { total: sizeLabel(m.paramsTotalB), active: sizeLabel(m.paramsActiveB), moe: m.isMoE ? '◇' : '' }), 10)
      setT(3, 3, m.contextWindowK + 'K', 10)
      // 5-axis quality sparkbars at column 4 (drawn into rowG)
      this.drawMiniSparks(this.rowG, COLS[4].x + 4, y + 6, m.qualityBy)
      // safety + refusal at column 5
      setT(5, 4, m.alignment.safety.toFixed(0), 11, m.alignment.refusalStyle === 'safe-completion' ? COLORS.good : COLORS.trust)
      // VRAM FP16/FP8 at column 6
      setT(6, 5, fmtVramPair(row.vramFp16, row.vramFp8), 10, COLORS.textDim)
      cell.texts[6].text = ''
    }

    this.scrollUp.setTitle('▲').layout(0, 0, true)
    this.scrollDn.setTitle('▼').layout(0, 0, true)

    this.drawDetail(s)
  }

  /** Compact 5-axis quality bars (agentic highlighted) for a table row. */
  private drawMiniSparks(g: Graphics, x: number, y: number, q: Record<CapabilityAxis, number>): void {
    const barW = 24
    const gap = 4
    AXES.forEach((axis, i) => {
      const v = Math.max(0, Math.min(1, (q[axis] ?? 0) / 100))
      const bx = x + i * (barW + gap)
      const hl = axis === 'agentic'
      g.roundRect(bx, y, barW, 9, 2).fill({ color: 0x0a0e14, alpha: 0.85 })
      g.roundRect(bx, y, Math.max(2, barW * v), 9, 2).fill({ color: hl ? COLORS.cash : COLORS.sla, alpha: hl ? 1 : 0.85 })
      if (hl) g.roundRect(bx - 1, y - 1, barW + 2, 11, 3).stroke({ width: 1, color: COLORS.cash, alpha: 0.6 })
    })
  }

  private drawDetail(s: GameState): void {
    const m = this.selected ? resolveModel(s, this.selected) : null
    this.detailG.clear()
    if (!m) {
      drawPanel(this.detailG, 0, 0, DETAIL_W, this.PH - DETAIL_H_PAD, { alpha: 0.5, edge: COLORS.panelEdge })
      fitText(this.detailTitle, t('models.detail.pick'), DETAIL_W - 24, { size: 16, minSize: 12, ellipsis: true })
      for (const r of this.detailRows) r.text = ''
      this.detailSparks.visible = false
      return
    }
    drawPanel(this.detailG, 0, 0, DETAIL_W, this.PH - DETAIL_H_PAD, { alpha: 0.7, edge: tierColor(m.tier) })
    fitText(this.detailTitle, modelName(m), DETAIL_W - 24, { size: 16, minSize: 12, ellipsis: true })
    this.detailTitle.style.fill = m.origin === 'derived' ? COLORS.data : COLORS.textBright

    const lines: { text: string; fill: number }[] = []
    lines.push({ text: t('models.detail.tier', { tier: t('tier.' + m.tier), spec: t('spec.' + m.spec) }), fill: COLORS.textDim })
    lines.push({ text: t('models.detail.params', { total: sizeLabel(m.paramsTotalB), active: sizeLabel(m.paramsActiveB), moe: m.isMoE ? t('rack.model.moe') : t('rack.model.dense') }), fill: COLORS.text })
    lines.push({ text: t('models.detail.arch', { layers: m.layers, kv: m.kvHeads, head: m.headDim, attn: m.attn }), fill: COLORS.text })
    lines.push({ text: t('models.detail.window', { win: m.contextWindowK, bytes: m.weightBytes }), fill: COLORS.text })
    lines.push({ text: t('models.detail.vram', { fp16: fmtGb(m.paramsTotalB * 2), fp8: fmtGb(m.paramsTotalB) }), fill: COLORS.cooling })
    // serve speed / cost on the reference rack
    const lo = loadout(s, REF_HW, m.id)
    if (serverFitsMemory(s, lo)) {
      const rf = rooflineOf(s, lo)
      lines.push({ text: t('models.detail.serve', { tok: fmtTokS(rf.decodeTokSb1), dpm: fmtDollarsPerMtoken(rackDollarsPerMtoken(s, lo)) }), fill: COLORS.cash })
    } else {
      lines.push({ text: t('models.detail.serveNoFit'), fill: COLORS.warn })
    }
    lines.push({ text: t('models.detail.align', { safety: m.alignment.safety.toFixed(0), style: t('rack.refusal.' + m.alignment.refusalStyle), over: (m.alignment.overRefusal * 100).toFixed(0) }), fill: COLORS.trust })
    lines.push({ text: '', fill: COLORS.text })

    if (m.origin === 'derived' && m.lineage) {
      const lg = m.lineage
      lines.push({ text: t('models.detail.lineage'), fill: COLORS.textBright })
      const bases = lg.baseModelIds.map((id) => modelName(resolveModel(s, id) ?? MODEL_DEFS[id]) ?? id).join(' + ')
      lines.push({ text: t('models.detail.from', { base: bases }), fill: COLORS.data })
      lines.push({ text: t('models.detail.method', { method: t('method.' + lg.method, undefined, lg.method), target: t('ptt.' + lg.target, undefined, lg.target), effort: lg.effort, depth: lg.depth }), fill: COLORS.text })
      lines.push({ text: t('models.detail.spent', { data: lg.spent.data, compute: Math.round(lg.spent.compute / 1000) }), fill: COLORS.textDim })
    } else if (m.real) {
      lines.push({ text: t('models.detail.real'), fill: COLORS.textBright })
      lines.push({ text: t('models.detail.dev', { dev: m.real.developer, lic: m.real.license, rel: m.real.released }), fill: COLORS.text })
      // The six real Artificial Analysis benchmarks that feed this checkpoint's
      // qualityBy (src/sim/roster.bench.generated.ts). Wraps to two lines.
      const bench = AA_BENCH[m.id]
      const benchParts: string[] = []
      if (bench) {
        const add = (lbl: string, v: number | undefined): void => {
          if (v != null) benchParts.push(`${lbl} ${Math.round(v)}`)
        }
        add('GPQA', bench.gpqaDiamond)
        add('IFBench', bench.ifBench)
        add('LCR', bench.lcr)
        add('SciCode', bench.sciCode)
        add('TB-Hard', bench.terminalBenchHard)
        add('HLE', bench.hle)
      }
      lines.push({ text: benchParts.join(' · ') || t('models.detail.noBench'), fill: COLORS.sla })
    }

    let y = 38
    for (let i = 0; i < this.detailRows.length; i++) {
      const r = this.detailRows[i]
      const line = lines[i]
      r.text = line?.text ?? ''
      r.style.fill = line?.fill ?? COLORS.text
      r.y = y
      if (line && !line.text) y += 8
      else if (line?.text) y += Math.max(14, r.height) + 3
    }
    // qualityBy sparkbars at the bottom of the detail
    this.detailSparks.visible = true
    this.detailSparks.y = Math.min(this.PH - DETAIL_H_PAD - 82, y + 8)
    this.detailSparks.draw(m.qualityBy)
  }
}
