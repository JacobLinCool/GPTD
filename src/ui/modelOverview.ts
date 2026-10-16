/**
 * ui/modelOverview.ts — S7 ModelOverview + S8 LineageGraph (§5.2).
 *
 * S7: a scrollable, sortable, filterable table of EVERY checkpoint — the roster
 * base models (MODEL_DEFS) plus every player-derived checkpoint (s.derivedModels).
 * Columns: name, origin (base/derived + depth), params total/active + MoE,
 * context window, the five-axis qualityBy (bars scaled to the strongest roster
 * score; each axis header sorts by that axis), per-user decode speed on the
 * smallest rack that holds the model (colored against the interactive /
 * near-real-time TPOT bounds), alignment safety + refusal style, and VRAM at
 * FP16/FP8. Filters: all / base / derived / fits-my-racks, plus type-to-filter
 * by name. Click a row → a detail card with full stats, the real benchmark
 * breakdown (base) or the Lineage (derived), and DEPLOY WHERE IT FITS.
 *
 * S8: a "Lineage" toggle renders a tidy DAG — base → instruct → reasoning /
 * distill → FT / merge → quantized — from (a) the roster's real lineage edges
 * (`real.baseModelId` + `real.relation`, [fix H6]) and (b) derived models'
 * `lineage.baseModelIds` + relation. Nodes colored by tier, edges labeled.
 *
 * Pure presentation: reads GameState + the metrics layer; it drives the sim only
 * through the deploy callback (the same action the inspect panel uses). The
 * table, detail card and lineage graph rebuild only when their inputs change.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, FRAMEWORK_GB, LAT_CLASS_SLO } from '../config'
import type { CapabilityAxis, GameState, ModelDef } from '../core/types'
import { MODEL_DEFS, sizeLabel } from '../sim/content'
import { AA_BENCH } from '../sim/roster.bench.generated'
import { loadout, resolveModel, serverDeployable, serverPerUserDecodeTokS } from '../sim/effects'
import {
  AXES,
  fmtDollarsPerMtoken,
  fmtGb,
  fmtTokS,
  rackDollarsPerMtoken,
  rolloutTargets,
  smallestRackFor,
} from './metrics'
import { QualitySparks, qualityScale } from './charts'
import { getLang, modelName, t } from '../i18n'
import { KEY } from './help'
import { drawPanel, label, UIButton } from './theme'
import { DragScroll, fitLabel, setButton, setUiPref, uiPref } from './panelKit'
import { instantSourceLine, thinkingLine } from './thinkingCopy'

const MODAL_PAD = 24
const TABLE_W = 760
const TABLE_X = MODAL_PAD
const TABLE_Y = 112
const DETAIL_X = 800
const DETAIL_W = 356
const DETAIL_Y = TABLE_Y
const DETAIL_H_PAD = 142
/** Column layout: name, origin, params, ctx, quality (5 axis bars), speed, safety, vram. */
const COLS = [
  { x: 0, w: 196 },
  { x: 196, w: 56 },
  { x: 252, w: 90 },
  { x: 342, w: 50 },
  { x: 392, w: 146 },
  { x: 538, w: 72 },
  { x: 610, w: 58 },
  { x: 668, w: 74 },
] as const
const SPARK_W = 24
const SPARK_GAP = 4

type SortKey = 'name' | 'origin' | 'paramsTotalB' | 'contextWindowK' | CapabilityAxis | 'speed' | 'safety' | 'vram'
const SORT_KEYS: readonly SortKey[] = [
  'name',
  'origin',
  'paramsTotalB',
  'contextWindowK',
  'chat',
  'coding',
  'reasoning',
  'general',
  'agentic',
  'speed',
  'safety',
  'vram',
]
type OriginFilter = 'all' | 'base' | 'derived' | 'fits'
const FILTERS: readonly OriginFilter[] = ['all', 'base', 'derived', 'fits']

/** A flattened row over a resolved checkpoint with the derived display metrics. */
interface Row {
  m: ModelDef
  vramFp16: number
  vramFp8: number
  /** per-user decode tok/s at batch 1 on the smallest rack that holds it (0 = none does). */
  speed: number
  tpotMs: number
}

function tierColor(tier: ModelDef['tier']): number {
  return tier === 'frontier' ? COLORS.data : tier === 'coding' ? COLORS.good : tier === 'small' ? COLORS.sla : COLORS.cooling
}

function tpotColor(ms: number): number {
  return ms <= LAT_CLASS_SLO.IN.tpotMs ? COLORS.good : ms <= LAT_CLASS_SLO.NR.tpotMs ? COLORS.warn : COLORS.danger
}

function fmtGbCompact(gb: number): string {
  if (gb >= 1000) return (gb / 1000).toFixed(gb >= 10000 ? 0 : 1) + 'T'
  return gb >= 100 ? gb.toFixed(0) + 'G' : gb.toFixed(1) + 'G'
}

function fmtVramPair(fp16: number, fp8: number): string {
  return `${fmtGbCompact(fp16)}/${fmtGbCompact(fp8)}`
}

/**
 * Per-user decode speed on the cheapest rack that holds the model, with one cohort batched
 * (a light load, not a lone stream) — "how fast is it where it fits".
 */
function homeSpeed(s: GameState, m: ModelDef): { speed: number; tpotMs: number; hwId: string | null } {
  const hw = smallestRackFor(s, m)
  if (!hw) return { speed: 0, tpotMs: Infinity, hwId: null }
  const perUser = serverPerUserDecodeTokS(s, { hw, model: m }, 1)
  return { speed: perUser, tpotMs: perUser > 0 ? 1000 / perUser : Infinity, hwId: hw.id }
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
  private key = ''

  constructor(w: number, h: number) {
    super()
    this.W = w
    this.H = h
    this.addChild(this.g, this.nodeLayer)
  }

  /** Forget the drawn graph (a new run). */
  reset(): void {
    this.key = ''
  }

  /** Render the DAG over every resolvable checkpoint with an edge — rebuilt only when the lineage changes. */
  draw(s: GameState): void {
    const key = `${Object.keys(s.derivedModels).length}|${getLang()}`
    if (key === this.key) return
    this.key = key
    this.g.clear()
    for (const c of this.nodeLayer.removeChildren()) c.destroy()

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
    // roots in name order; every later column follows its parents' rows (barycenter), so
    // edges run straight across instead of crossing
    cols.get(0)?.sort((a, b) => a.localeCompare(b))

    const colW = Math.max(250, Math.min(360, (this.W - 56) / (maxDepth + 1)))
    // leave a wide inter-column gap so a relation label ("finetune") fits cleanly
    // between nodes instead of being clipped by the next node box.
    const nodeW = Math.min(310, colW - 56)
    const nodeH = 44
    const rowGap = 14
    const graphW = maxDepth * colW + nodeW
    const startX = Math.max(18, (this.W - graphW) / 2)
    const pos = new Map<string, { x: number; y: number }>()
    const parentY = (id: string): number => {
      let sum = 0
      let n = 0
      for (const e of edges) {
        const p = e.to === id ? pos.get(e.from) : undefined
        if (p) {
          sum += p.y
          n++
        }
      }
      return n ? sum / n : Infinity
    }
    for (let d = 0; d <= maxDepth; d++) {
      const arr = cols.get(d) ?? []
      if (d > 0) {
        const by = new Map(arr.map((id) => [id, parentY(id)]))
        arr.sort((a, b) => by.get(a)! - by.get(b)! || a.localeCompare(b))
      }
      const colX = startX + d * colW
      const totalH = arr.length * (nodeH + rowGap)
      const startY = Math.max(16, (this.H - totalH) / 2)
      arr.forEach((id, i) => {
        pos.set(id, { x: colX, y: startY + i * (nodeH + rowGap) })
      })
    }

    // edges first (under nodes); their relation labels are collected and rendered
    // LAST (on top of the nodes) so a node box can never paint over them.
    const edgeLabels: { chip: Graphics; lbl: Text }[] = []
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
      this.nodeLayer.addChild(node)
      const nm = label('', 10, m.origin === 'derived' ? COLORS.data : COLORS.text, 'bold')
      fitLabel(nm, modelName(m), nodeW - 18, 10, 9)
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

/** Typed characters the name filter accepts (letters always; digits, space, dot, dash once a query exists). */
const QUERY_START = /^\p{L}$/u
const QUERY_CHAR = /^[\p{L}\p{N} .\-_]$/u

export class ModelOverview {
  readonly view = new Container()
  private dim = new Graphics()
  private bg = new Graphics()
  private head = label('', 20, COLORS.textBright, 'bold')
  private sub = label('', 12, COLORS.textDim)
  private queryLbl = label('', 12, COLORS.sla)
  private closeBtn: UIButton
  private lineageBtn: UIButton
  private filterBtns: { f: OriginFilter; btn: UIButton }[] = []

  // table
  private tableView = new Container()
  private headerRow = new Container()
  private headerBtns: { key: SortKey; btn: UIButton; axis: boolean }[] = []
  private rowHost = new Container()
  private rowG = new Graphics()
  private rowCells: { bg: Graphics; texts: Text[]; modelId: string | null }[] = []
  private scrollUp: UIButton
  private scrollDn: UIButton
  private drag: DragScroll

  // detail
  private detail = new Container()
  private detailG = new Graphics()
  private detailTitle = label('', 16, COLORS.textBright, 'bold')
  private detailRows: Text[] = []
  private detailSparks = new QualitySparks(300)
  private deployBtn: UIButton

  // lineage view
  private lineageView = new Container()
  private lineage: LineageGraph

  private sortKey: SortKey = uiPref('models.sort', 'paramsTotalB', SORT_KEYS)
  private sortDir: 1 | -1 = -1
  private filter: OriginFilter = uiPref('models.filter', 'all', FILTERS)
  private query = ''
  private scroll = 0
  private selected: string | null = null
  private showLineage = false
  private state: GameState | null = null
  private tableKey = ''
  private detailKey = ''
  private rowCache: Row[] = []
  private rowCacheKey = ''

  private PW = 1180
  private PH = 620
  private px: number
  private py: number

  constructor(
    onClose: () => void,
    private onDeploy: (towerId: number, modelId: string) => void = () => {},
  ) {
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
    this.queryLbl.x = px + 24
    this.queryLbl.y = py + 72
    this.view.addChild(this.head, this.sub, this.queryLbl)

    this.closeBtn = new UIButton({ w: 150, h: 34, accent: COLORS.sla, onTap: onClose })
    this.closeBtn.x = px + this.PW - 174
    this.closeBtn.y = py + 14
    this.view.addChild(this.closeBtn)

    this.lineageBtn = new UIButton({ w: 150, h: 28, accent: COLORS.data, onTap: () => (this.showLineage = !this.showLineage) })
    this.lineageBtn.x = px + this.PW - 174
    this.lineageBtn.y = py + 56
    this.view.addChild(this.lineageBtn)

    // origin filters (+ "fits my racks")
    FILTERS.forEach((f, i) => {
      const btn = new UIButton({
        w: f === 'fits' ? 150 : 92,
        h: 26,
        accent: COLORS.cooling,
        onTap: () => {
          this.filter = f
          this.scroll = 0
          setUiPref('models.filter', f)
        },
      })
      btn.x = px + 300 + i * 98
      btn.y = py + 64
      this.view.addChild(btn)
      this.filterBtns.push({ f, btn })
    })

    // --- table ---
    this.view.addChild(this.tableView)
    // row backgrounds first, then the quality bars ON TOP of them, then the header
    this.tableView.addChild(this.rowHost, this.rowG, this.headerRow)
    this.tableView.x = px + TABLE_X
    this.tableView.y = py + TABLE_Y

    // sortable headers; the quality column splits into one sort button per axis
    const headers: { key: SortKey; col: number }[] = [
      { key: 'name', col: 0 },
      { key: 'origin', col: 1 },
      { key: 'paramsTotalB', col: 2 },
      { key: 'contextWindowK', col: 3 },
      { key: 'speed', col: 5 },
      { key: 'safety', col: 6 },
      { key: 'vram', col: 7 },
    ]
    for (const h of headers) {
      const col = COLS[h.col]
      const btn = new UIButton({ w: col.w - 6, h: 24, accent: COLORS.power, onTap: () => this.setSort(h.key) })
      btn.x = col.x
      this.headerRow.addChild(btn)
      this.headerBtns.push({ key: h.key, btn, axis: false })
    }
    AXES.forEach((axis, i) => {
      const btn = new UIButton({ w: SPARK_W + 2, h: 24, accent: COLORS.power, radius: 4, onTap: () => this.setSort(axis) })
      btn.x = COLS[4].x + 3 + i * (SPARK_W + SPARK_GAP)
      this.headerRow.addChild(btn)
      this.headerBtns.push({ key: axis, btn, axis: true })
    })

    // pooled rows: 8 text columns each; the 5-axis quality bars are drawn into rowG
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const bg = new Graphics()
      const texts: Text[] = []
      const cell: { bg: Graphics; texts: Text[]; modelId: string | null } = { bg, texts, modelId: null }
      bg.eventMode = 'static'
      bg.cursor = 'pointer'
      bg.on('pointertap', () => {
        if (cell.modelId && !this.drag.swallowTap) this.selected = cell.modelId
      })
      this.rowHost.addChild(bg)
      for (let c = 0; c < COLS.length; c++) {
        const tx = label('', 11, COLORS.text)
        tx.eventMode = 'none'
        texts.push(tx)
        this.rowHost.addChild(tx)
      }
      this.rowCells.push(cell)
    }
    this.rowHost.eventMode = 'static'
    this.rowHost.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= TABLE_W && y >= 32 && y <= 32 + VISIBLE_ROWS * ROW_H }
    this.drag = new DragScroll(this.rowHost, {
      get: () => this.scroll * ROW_H,
      set: (v) => (this.scroll = Math.max(0, Math.round(v / ROW_H))),
      wheelScale: 0.3,
    })

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
    this.deployBtn = new UIButton({ w: DETAIL_W - 24, h: 30, accent: COLORS.data, onTap: () => this.deployWhereFits() })
    this.deployBtn.x = 12
    this.deployBtn.y = this.PH - DETAIL_H_PAD - 40
    this.detail.addChild(this.deployBtn)
    this.view.addChild(this.detail)

    // --- lineage view ---
    this.lineage = new LineageGraph(this.PW - 48, this.PH - 130)
    this.lineageView.x = px + 24
    this.lineageView.y = py + 100
    this.lineageView.addChild(this.lineage)
    this.view.addChild(this.lineageView)

    // type-to-filter: a capture listener ahead of the game hotkeys, live only while open
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true })

    this.view.visible = false
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.view.visible || this.showLineage) return
    const tgt = e.target as HTMLElement | null
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // the panel's own toggle key closes it (Game.onKey) unless a query is being typed
    if (!this.query && e.code === KEY.models) return
    const consume = (): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.scroll = 0
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (!this.query) return
      this.query = e.key === 'Escape' ? '' : this.query.slice(0, -1)
      consume()
    } else if (e.key.length === 1 && (QUERY_START.test(e.key) || (this.query && QUERY_CHAR.test(e.key)))) {
      this.query = (this.query + e.key.toLowerCase()).slice(0, 24)
      consume()
    }
  }

  /**
   * Keyboard (routed by the Game while the modal is open): ↑ / ↓ move the selected row
   * and the table scrolls with it, PgUp / PgDn page, Home / End jump, [ / ] cycle the
   * origin filter. Letters type a filter query (the capture listener above).
   */
  key(code: string): boolean {
    if (!this.view.visible || this.showLineage) return false
    if (code === 'BracketLeft' || code === 'BracketRight') {
      const i = FILTERS.indexOf(this.filter)
      this.filter = FILTERS[(i + (code === 'BracketLeft' ? -1 : 1) + FILTERS.length) % FILTERS.length]
      this.scroll = 0
      setUiPref('models.filter', this.filter)
      return true
    }
    const rows = this.rowCache
    if (!rows.length) return false
    let i = this.selected ? rows.findIndex((r) => r.m.id === this.selected) : -1
    switch (code) {
      case 'ArrowUp':
        i = i < 0 ? this.scroll : i - 1
        break
      case 'ArrowDown':
        i = i < 0 ? this.scroll : i + 1
        break
      case 'PageUp':
        i = (i < 0 ? this.scroll : i) - VISIBLE_ROWS
        break
      case 'PageDown':
        i = (i < 0 ? this.scroll : i) + VISIBLE_ROWS
        break
      case 'Home':
        i = 0
        break
      case 'End':
        i = rows.length - 1
        break
      default:
        return false
    }
    i = Math.max(0, Math.min(rows.length - 1, i))
    this.selected = rows[i].m.id
    if (i < this.scroll) this.scroll = i
    else if (i >= this.scroll + VISIBLE_ROWS) this.scroll = i - VISIBLE_ROWS + 1
    return true
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortDir = (this.sortDir * -1) as 1 | -1
    else {
      this.sortKey = key
      this.sortDir = key === 'name' || key === 'origin' ? 1 : -1
      setUiPref('models.sort', key)
    }
  }
  private nudge(d: number): void {
    this.scroll = Math.max(0, this.scroll + d)
  }

  /** The distinct rack tiers on the board (for the "fits my racks" filter). */
  private boardHw(s: GameState): string[] {
    const ids = new Set<string>()
    for (const tw of s.towers) if (tw.def.kind === 'server' && tw.hwId) ids.add(tw.hwId)
    return [...ids]
  }

  private rows(s: GameState): Row[] {
    const hw = this.boardHw(s)
    const key = [
      Object.keys(s.derivedModels).length,
      JSON.stringify(s.infra),
      hw.join(','),
      this.filter,
      this.query,
      this.sortKey,
      this.sortDir,
      getLang(),
    ].join('|')
    if (key === this.rowCacheKey) return this.rowCache
    this.rowCacheKey = key
    const ids = new Set<string>([...Object.keys(MODEL_DEFS), ...Object.keys(s.derivedModels)])
    const out: Row[] = []
    for (const id of ids) {
      const m = resolveModel(s, id)
      if (!m) continue
      if (this.filter === 'base' && m.origin !== 'base') continue
      if (this.filter === 'derived' && m.origin !== 'derived') continue
      if (this.filter === 'fits' && !hw.some((h) => serverDeployable(s, loadout(s, h, id)))) continue
      if (this.query && !modelName(m).toLowerCase().includes(this.query) && !m.id.toLowerCase().includes(this.query)) continue
      const home = homeSpeed(s, m)
      out.push({
        m,
        vramFp16: m.paramsTotalB * 2 + FRAMEWORK_GB,
        vramFp8: m.paramsTotalB * 1 + FRAMEWORK_GB,
        speed: home.speed,
        tpotMs: home.tpotMs,
      })
    }
    const k = this.sortKey
    const val = (r: Row): number | string => {
      switch (k) {
        case 'name':
          return modelName(r.m)
        case 'origin':
          return r.m.origin + (r.m.lineage?.depth ?? 0)
        case 'safety':
          return r.m.alignment.safety
        case 'vram':
          return r.vramFp16
        case 'speed':
          return r.speed
        case 'paramsTotalB':
          return r.m.paramsTotalB
        case 'contextWindowK':
          return r.m.contextWindowK
        default:
          return r.m.qualityBy[k]
      }
    }
    out.sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      const c = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number)
      return c * this.sortDir || a.m.id.localeCompare(b.m.id)
    })
    this.rowCache = out
    return out
  }

  update(s: GameState): void {
    if (s !== this.state) {
      // a new run: drop everything memoized against the previous state
      this.rowCacheKey = ''
      this.tableKey = ''
      this.detailKey = ''
      this.lineage.reset()
    }
    this.state = s
    this.head.text = t('models.title')
    const total = Object.keys(MODEL_DEFS).length + Object.keys(s.derivedModels).length
    this.sub.text = t('models.sub', { base: Object.keys(MODEL_DEFS).length, derived: Object.keys(s.derivedModels).length, total })
    setButton(this.closeBtn, t('models.close'))
    setButton(this.lineageBtn, this.showLineage ? t('models.viewTable') : t('models.viewLineage'))
    this.lineageBtn.setActive(this.showLineage)
    for (const { f, btn } of this.filterBtns) {
      setButton(btn, t('models.filter.' + f))
      btn.setActive(this.filter === f)
      btn.visible = !this.showLineage
    }
    this.queryLbl.visible = !this.showLineage
    this.queryLbl.text = this.query ? t('models.search', { q: this.query }) : t('models.searchHint')
    this.queryLbl.style.fill = this.query ? COLORS.sla : COLORS.textDim

    // toggle table vs lineage view
    this.tableView.visible = !this.showLineage
    this.detail.visible = !this.showLineage
    this.lineageView.visible = this.showLineage
    if (this.showLineage) {
      this.lineage.draw(s)
      return
    }

    const rows = this.rows(s)
    const maxScroll = Math.max(0, rows.length - VISIBLE_ROWS)
    if (this.scroll > maxScroll) this.scroll = maxScroll
    this.scrollUp.setEnabled(this.scroll > 0)
    this.scrollDn.setEnabled(this.scroll < maxScroll)
    const tableKey = `${this.rowCacheKey}|${this.scroll}|${this.selected}|${rows.length}`
    if (tableKey !== this.tableKey) {
      this.tableKey = tableKey
      this.drawTable(rows)
    }
    this.drawDetail(s)
  }

  private drawTable(rows: Row[]): void {
    for (const { key, btn, axis } of this.headerBtns) {
      const arrow = this.sortKey === key ? (this.sortDir === 1 ? '▲' : '▼') : ''
      const name = axis ? t('axis.short.' + key) : t('models.col.' + key)
      setButton(btn, axis ? (arrow ? arrow : name) : arrow ? `${name} ${arrow}` : name)
      btn.setActive(this.sortKey === key)
    }

    const scale = qualityScale()
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
      cell.bg.roundRect(0, y, TABLE_W - 18, ROW_H - 2, 4).fill({ color: sel ? 0x1a2c44 : i % 2 ? 0x0c1320 : 0x0e1622, alpha: 0.9 })
      // the selected row is marked by its border alone
      if (sel) cell.bg.roundRect(0.5, y + 0.5, TABLE_W - 19, ROW_H - 3, 4).stroke({ width: 2, color: COLORS.data })

      const setT = (c: number, text: string, size = 11, fill: number = COLORS.text): void => {
        const tx = cell.texts[c]
        tx.style.fill = fill
        tx.x = COLS[c].x + 6
        tx.y = y + 7
        fitLabel(tx, text, COLS[c].w - 12, size, 8)
      }
      setT(0, modelName(m), 11, m.origin === 'derived' ? COLORS.data : COLORS.text)
      setT(
        1,
        m.origin === 'derived' ? t('models.d', { d: m.lineage?.depth ?? 0 }) : t('models.base'),
        10,
        m.origin === 'derived' ? COLORS.data : COLORS.textDim,
      )
      setT(2, t('models.params', { total: sizeLabel(m.paramsTotalB), active: sizeLabel(m.paramsActiveB), moe: m.isMoE ? '◇' : '' }), 10)
      setT(3, m.contextWindowK + 'K', 10)
      cell.texts[4].text = ''
      this.drawMiniSparks(this.rowG, COLS[4].x + 4, y + 9, m.qualityBy, scale)
      setT(
        5,
        row.speed > 0 ? fmtTokS(row.speed) + (m.thinking === 'always' ? ' ◷' : m.thinking === 'hybrid' ? ' ◐' : '') : '—',
        10,
        row.speed > 0 ? tpotColor(row.tpotMs) : COLORS.textDim,
      )
      setT(6, m.alignment.safety.toFixed(0), 11, m.alignment.refusalStyle === 'safe-completion' ? COLORS.good : COLORS.trust)
      setT(7, fmtVramPair(row.vramFp16, row.vramFp8), 10, COLORS.textDim)
    }

    this.scrollUp.setTitle('▲').layout(0, 0, true)
    this.scrollDn.setTitle('▼').layout(0, 0, true)
  }

  /** Compact 5-axis quality bars (agentic highlighted), scaled to the roster's strongest score. */
  private drawMiniSparks(g: Graphics, x: number, y: number, q: Record<CapabilityAxis, number>, scale: number): void {
    AXES.forEach((axis, i) => {
      const v = Math.max(0, Math.min(1, (q[axis] ?? 0) / scale))
      const bx = x + i * (SPARK_W + SPARK_GAP)
      const hl = axis === 'agentic'
      const sorted = this.sortKey === axis
      g.roundRect(bx, y, SPARK_W, 9, 2).fill({ color: 0x0a0e14, alpha: 0.85 })
      g.roundRect(bx, y, Math.max(2, SPARK_W * v), 9, 2).fill({ color: hl ? COLORS.cash : COLORS.sla, alpha: sorted || hl ? 1 : 0.8 })
      // the 100 mark, so scores past it read as past it
      g.rect(bx + Math.round((SPARK_W * 100) / scale), y - 1, 1, 11).fill({ color: COLORS.textBright, alpha: 0.35 })
      if (hl) g.roundRect(bx - 1, y - 1, SPARK_W + 2, 11, 3).stroke({ width: 1, color: COLORS.cash, alpha: 0.6 })
    })
  }

  /** Detail-card DEPLOY WHERE IT FITS: the model onto every rack that holds it (build phase, id order). */
  private deployWhereFits(): void {
    const s = this.state
    if (!s || !this.selected || s.phase !== 'build') return
    for (const tw of rolloutTargets(s, this.selected)) this.onDeploy(tw.id, this.selected)
  }

  private drawDetail(s: GameState): void {
    const m = this.selected ? resolveModel(s, this.selected) : null
    const targets = m ? rolloutTargets(s, m.id).length : 0
    const running = m ? s.towers.filter((tw) => tw.def.kind === 'server' && tw.modelId === m.id).length : 0
    const key = `${this.selected}|${JSON.stringify(s.infra)}|${targets}|${running}|${s.phase}|${getLang()}`
    if (key === this.detailKey) return
    this.detailKey = key
    this.detailG.clear()
    if (!m) {
      drawPanel(this.detailG, 0, 0, DETAIL_W, this.PH - DETAIL_H_PAD, { alpha: 0.5, edge: COLORS.panelEdge })
      fitLabel(this.detailTitle, t('models.detail.pick'), DETAIL_W - 24, 16, 12)
      for (const r of this.detailRows) r.text = ''
      this.detailSparks.visible = false
      this.deployBtn.visible = false
      return
    }
    drawPanel(this.detailG, 0, 0, DETAIL_W, this.PH - DETAIL_H_PAD, { alpha: 0.7, edge: tierColor(m.tier) })
    fitLabel(this.detailTitle, modelName(m), DETAIL_W - 24, 16, 12)
    this.detailTitle.style.fill = m.origin === 'derived' ? COLORS.data : COLORS.textBright

    const lines: { text: string; fill: number }[] = []
    lines.push({ text: t('models.detail.tier', { tier: t('tier.' + m.tier), spec: t('spec.' + m.spec) }), fill: COLORS.textDim })
    lines.push({ text: t('models.detail.params', { total: sizeLabel(m.paramsTotalB), active: sizeLabel(m.paramsActiveB), moe: m.isMoE ? t('rack.model.moe') : t('rack.model.dense') }), fill: COLORS.text })
    lines.push({ text: t('models.detail.arch', { layers: m.layers, kv: m.kvHeads, head: m.headDim, attn: t(`attn.${m.attn}`, undefined, m.attn) }), fill: COLORS.text })
    lines.push({ text: t('models.detail.kv', { kvb: (m.kvBytesPerToken / 1024).toFixed(1), kvLayers: m.kvLayers, layers: m.layers, state: m.kvStateMbPerReq.toFixed(0) }), fill: COLORS.text })
    lines.push({ text: t('models.detail.window', { win: m.contextWindowK, bytes: m.nativeWeightBytes }), fill: COLORS.text })
    // §1.4 thinking support: which traffic it answers instantly, which it thinks about first
    lines.push({ text: thinkingLine(m), fill: m.thinking === 'always' ? COLORS.warn : COLORS.data })
    lines.push({ text: t('models.detail.vram', { fp16: fmtGb(m.paramsTotalB * 2), fp8: fmtGb(m.paramsTotalB) }), fill: COLORS.cooling })
    // serve speed / cost on the smallest rack that holds it
    const home = homeSpeed(s, m)
    const hw = home.hwId ? smallestRackFor(s, m) : null
    if (hw) {
      lines.push({
        text: t('models.detail.serve', {
          tok: fmtTokS(home.speed),
          hw: t(`hw.${hw.id}.short`, undefined, hw.name.replace(' GPU Rack', '')),
          dpm: fmtDollarsPerMtoken(rackDollarsPerMtoken(s, { hw, model: m })),
        }),
        fill: tpotColor(home.tpotMs),
      })
    } else {
      lines.push({ text: t('models.detail.serveNoFit'), fill: COLORS.warn })
    }
    // a hybrid's second vector (thinking off) rides on the bars below: where it comes from
    const instantSrc = instantSourceLine(m)
    if (instantSrc) lines.push({ text: instantSrc, fill: COLORS.data })
    lines.push({
      text: t('models.detail.align', {
        safety: m.alignment.safety.toFixed(0),
        style: t('rack.refusal.' + m.alignment.refusalStyle),
        over: (m.alignment.overRefusal * 100).toFixed(0),
      }),
      fill: COLORS.trust,
    })
    lines.push({ text: '', fill: COLORS.text })

    if (m.origin === 'derived' && m.lineage) {
      const lg = m.lineage
      lines.push({ text: t('models.detail.lineage'), fill: COLORS.textBright })
      const bases = lg.baseModelIds.map((id) => modelName(resolveModel(s, id) ?? MODEL_DEFS[id]) || id).join(' + ')
      lines.push({ text: t('models.detail.from', { base: bases }), fill: COLORS.data })
      lines.push({
        text: t('models.detail.method', {
          method: t('method.' + lg.method, undefined, lg.method),
          target: t('ptt.' + lg.target, undefined, lg.target),
          effort: lg.effort,
          depth: lg.depth,
        }),
        fill: COLORS.text,
      })
      lines.push({ text: t('models.detail.spent', { data: lg.spent.data, compute: Math.round(lg.spent.compute / 1000) }), fill: COLORS.textDim })
    } else if (m.real) {
      lines.push({ text: t('models.detail.real'), fill: COLORS.textBright })
      lines.push({ text: t('models.detail.dev', { dev: m.real.developer, lic: m.real.license, rel: m.real.released }), fill: COLORS.text })
      // The real Artificial Analysis benchmarks that feed this checkpoint's
      // qualityBy (src/sim/roster.bench.generated.ts). Wraps to two lines.
      // A cell AA no longer publishes is bridged from the measured ones: marked ≈.
      const bench = AA_BENCH[m.id]
      const source = m.real.benchmarkSource ?? {}
      const benchParts: string[] = []
      if (bench) {
        const add = (lbl: string, v: number | undefined, field?: keyof typeof source): void => {
          if (v != null) benchParts.push(`${lbl} ${field && source[field]?.startsWith('bridge') ? '≈' : ''}${Math.round(v)}`)
        }
        add('GPQA', bench.gpqaDiamond, 'gpqaDiamond')
        add('IFBench', bench.ifBench, 'ifBench')
        add('LCR', bench.lcr, 'lcr')
        add('SciCode', bench.sciCode, 'sciCode')
        add('TB-Hard', bench.terminalBenchHard, 'terminalBenchHard')
        add('HLE', bench.hle, 'hle')
      }
      lines.push({ text: benchParts.join(' · ') || t('models.detail.noBench'), fill: COLORS.sla })
      if (Object.values(source).some((v) => v?.startsWith('bridge'))) lines.push({ text: t('models.bench.legend'), fill: COLORS.textDim })
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
    // qualityBy bars (scaled to the roster's strongest score), then the deploy action
    this.detailSparks.visible = true
    this.detailSparks.y = Math.min(this.PH - DETAIL_H_PAD - 124, y + 8)
    this.detailSparks.draw(m.qualityBy, { max: qualityScale(), alt: m.qualityByInstant })
    this.deployBtn.visible = true
    const building = s.phase === 'build'
    setButton(
      this.deployBtn,
      targets
        ? t('models.detail.deploy', { n: targets })
        : running
          ? t('models.detail.deployDone', { n: running })
          : t('models.detail.deployNone'),
      building ? '' : t('inspect.betweenWaves'),
    )
    this.deployBtn.setEnabled(building && targets > 0)
  }
}
