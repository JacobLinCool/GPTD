/**
 * ui/boardOverlay.ts — shell hints drawn over the board (above the world, below
 * every panel), all click-through:
 *   • the hovered building's range ring + a one-line mini card (no tool active);
 *   • the next wave's single-entry SURGE arrow at its ingress (build phase);
 *   • a cursor label for the active tool (blueprint cost, paint running total,
 *     "tap again to build" on touch);
 *   • the PAUSED pill over a dimmed board, naming why it paused;
 *   • a rotate-to-landscape hint on narrow portrait screens.
 * Presentation only: it reads state handed to it and owns no game rules.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { Tower } from '../core/types'
import { prefersReducedMotion } from '../settings'
import { LANE_PATHS } from '../sim/pathing'
import { drawPanel, label } from './theme'

export interface CursorLabel {
  text: string
  x: number
  y: number
  tone: 'ok' | 'bad' | 'info'
}

export interface BoardOverlayState {
  /** board time for the gentle pulse (frozen while paused). */
  time: number
  /** hovered building (no tool active) and the mini-card line once the hover settled. */
  hover: { tower: Tower; card: string | null } | null
  /** single-entry surge lanes of the next wave (build phase). */
  surgeLanes: number[]
  surgeLabel: string
  /** cursor label for the active tool. */
  cursor: CursorLabel | null
  /** the PAUSED pill text (null = running). */
  paused: string | null
  /** a narrow portrait viewport hint (null = none). */
  rotate: string | null
}

const BOARD_W = GRID_COLS * TILE
const BOARD_H = GRID_ROWS * TILE

export class BoardOverlay {
  readonly view = new Container()
  private g = new Graphics()
  private dim = new Graphics()
  private surgeTags: Text[] = []
  private hoverBg = new Graphics()
  private hoverTxt = label('', 11, COLORS.textBright)
  private cursorBg = new Graphics()
  private cursorTxt = label('', 11, COLORS.textBright, 'bold')
  private pauseBg = new Graphics()
  private pauseTxt = label('', 16, COLORS.textBright, 'bold')
  private rotateBg = new Graphics()
  private rotateTxt = label('', 13, COLORS.warn, 'bold')
  private lastPause = ''

  constructor() {
    this.view.eventMode = 'none'
    this.view.interactiveChildren = false
    this.dim.rect(GRID_X, GRID_Y, BOARD_W, BOARD_H).fill({ color: 0x05080d, alpha: 0.45 })
    this.view.addChild(
      this.dim,
      this.g,
      this.hoverBg,
      this.hoverTxt,
      this.cursorBg,
      this.cursorTxt,
      this.pauseBg,
      this.pauseTxt,
      this.rotateBg,
      this.rotateTxt,
    )
    this.rotateTxt.style.wordWrap = true
    this.rotateTxt.style.breakWords = true
    this.rotateTxt.style.wordWrapWidth = 520
  }

  update(st: BoardOverlayState): void {
    const g = this.g
    g.clear()
    const steady = prefersReducedMotion()
    const pulse = steady ? 1 : 0.6 + 0.4 * Math.sin(st.time * 5)

    // --- hovered building: range ring + mini card ---
    const h = st.hover
    if (h && h.tower.def.range > 0) {
      const r = h.tower.def.range * TILE
      g.circle(h.tower.x, h.tower.y, r).fill({ color: h.tower.def.color, alpha: 0.05 })
      g.circle(h.tower.x, h.tower.y, r).stroke({ width: 1, color: h.tower.def.color, alpha: 0.45 })
    }
    this.hoverBg.visible = this.hoverTxt.visible = !!h?.card
    if (h?.card) {
      if (this.hoverTxt.text !== h.card) this.hoverTxt.text = h.card
      const w = Math.ceil(this.hoverTxt.width) + 16
      const hh = Math.ceil(this.hoverTxt.height) + 8
      const x = Math.max(8, Math.min(DESIGN_W - w - 8, h.tower.x - w / 2))
      const above = h.tower.y - TILE / 2 - hh - 6
      const y = above < GRID_Y ? h.tower.y + TILE / 2 + 6 : above
      this.hoverBg.clear()
      drawPanel(this.hoverBg, x, y, w, hh, { alpha: 0.94, edge: h.tower.def.color, radius: 5 })
      this.hoverTxt.x = x + 8
      this.hoverTxt.y = y + 4
    }

    // --- single-entry surge: a chevron at the flooded ingress + a tag ---
    st.surgeLanes.forEach((laneId, i) => {
      const lane = LANE_PATHS[laneId]
      if (!lane || lane.waypoints.length < 2) return
      const a = lane.waypoints[0]
      const b = lane.waypoints[1]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const ux = (b.x - a.x) / len
      const uy = (b.y - a.y) / len
      const px = -uy
      const py = ux
      for (let k = 0; k < 3; k++) {
        const d = 10 + k * 13
        const cx = a.x + ux * d
        const cy = a.y + uy * d
        g.moveTo(cx - ux * 6 + px * 8, cy - uy * 6 + py * 8)
          .lineTo(cx + ux * 4, cy + uy * 4)
          .lineTo(cx - ux * 6 - px * 8, cy - uy * 6 - py * 8)
          .stroke({ width: 3, color: COLORS.warn, alpha: (0.45 + 0.18 * k) * pulse })
      }
      g.circle(a.x, a.y, 9).stroke({ width: 2, color: COLORS.warn, alpha: 0.9 * pulse })
      let tag = this.surgeTags[i]
      if (!tag) {
        tag = label('', 10, COLORS.warn, 'bold')
        this.surgeTags.push(tag)
        this.view.addChild(tag)
      }
      tag.text = st.surgeLabel
      tag.visible = true
      // keep the tag on the board, offset away from the lane's travel direction
      const tx = a.x - ux * 14 - tag.width / 2
      const ty = a.y - uy * 14 - (uy > 0.5 ? 18 : -6)
      tag.x = Math.round(Math.max(GRID_X + 2, Math.min(GRID_X + BOARD_W - tag.width - 2, tx)))
      tag.y = Math.round(Math.max(GRID_Y + 2, Math.min(GRID_Y + BOARD_H - 14, ty)))
    })
    for (let i = st.surgeLanes.length; i < this.surgeTags.length; i++) this.surgeTags[i].visible = false

    // --- cursor label (blueprint / paint / touch confirm) ---
    const c = st.cursor
    this.cursorBg.visible = this.cursorTxt.visible = !!c
    if (c) {
      const col = c.tone === 'bad' ? COLORS.danger : c.tone === 'info' ? COLORS.sla : COLORS.good
      if (this.cursorTxt.text !== c.text) this.cursorTxt.text = c.text
      this.cursorTxt.style.fill = col
      const w = Math.ceil(this.cursorTxt.width) + 14
      const hh = Math.ceil(this.cursorTxt.height) + 8
      const x = Math.max(8, Math.min(DESIGN_W - w - 8, c.x + 16))
      const y = Math.max(8, Math.min(DESIGN_H - hh - 8, c.y + 18))
      this.cursorBg.clear()
      drawPanel(this.cursorBg, x, y, w, hh, { alpha: 0.92, edge: col, radius: 5 })
      this.cursorTxt.x = x + 7
      this.cursorTxt.y = y + 4
    }

    // --- PAUSED: dim the board + a centered pill ---
    const paused = st.paused
    this.dim.visible = this.pauseBg.visible = this.pauseTxt.visible = !!paused
    if (paused && paused !== this.lastPause) {
      this.lastPause = paused
      this.pauseTxt.text = paused
      const w = Math.ceil(this.pauseTxt.width) + 40
      const hh = Math.ceil(this.pauseTxt.height) + 18
      const x = GRID_X + (BOARD_W - w) / 2
      const y = GRID_Y + (BOARD_H - hh) / 2
      this.pauseBg.clear()
      drawPanel(this.pauseBg, x, y, w, hh, { alpha: 0.96, edge: COLORS.sla, radius: hh / 2 })
      this.pauseTxt.x = x + 20
      this.pauseTxt.y = y + 9
    }
    if (!paused) this.lastPause = ''

    // --- rotate hint (narrow portrait screens) ---
    this.rotateBg.visible = this.rotateTxt.visible = !!st.rotate
    if (st.rotate) {
      if (this.rotateTxt.text !== st.rotate) {
        this.rotateTxt.text = st.rotate
        const w = Math.ceil(this.rotateTxt.width) + 28
        const hh = Math.ceil(this.rotateTxt.height) + 16
        const x = (DESIGN_W - w) / 2
        this.rotateBg.clear()
        drawPanel(this.rotateBg, x, GRID_Y + 8, w, hh, { alpha: 0.96, edge: COLORS.warn })
        this.rotateTxt.x = x + 14
        this.rotateTxt.y = GRID_Y + 16
      }
    }
  }
}
