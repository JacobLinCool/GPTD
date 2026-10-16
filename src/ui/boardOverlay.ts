/**
 * ui/boardOverlay.ts — shell hints drawn over the board (above the world, below
 * every panel), all click-through:
 *   • the hovered building's range ring + a one-line mini card (no tool active);
 *   • a cursor label for the active tool (blueprint cost, paint running total,
 *     "tap again to build" on touch);
 *   • the PAUSED pill over a dimmed board, naming why it paused (the pill lives in
 *     `pauseView`, which the game layers above the Codex bubble so a tip never hides it);
 *   • a rotate-to-landscape hint on narrow portrait screens.
 * Presentation only: it reads state handed to it and owns no game rules.
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W, GRID_COLS, GRID_ROWS, GRID_X, GRID_Y, TILE } from '../config'
import type { Tower } from '../core/types'
import { towerRangeTiles } from '../sim/effects'
import { drawPanel, label } from './theme'

export interface CursorLabel {
  text: string
  x: number
  y: number
  tone: 'ok' | 'bad' | 'info'
}

export interface BoardOverlayState {
  /** hovered building (no tool active) and the mini-card line once the hover settled. */
  hover: { tower: Tower; card: string | null } | null
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
  /** the PAUSED pill, layered separately (above the Codex bubble). */
  readonly pauseView = new Container()
  private g = new Graphics()
  private dim = new Graphics()
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
    this.pauseView.eventMode = 'none'
    this.pauseView.interactiveChildren = false
    this.pauseView.addChild(this.pauseBg, this.pauseTxt)
    this.dim.rect(GRID_X, GRID_Y, BOARD_W, BOARD_H).fill({ color: 0x05080d, alpha: 0.45 })
    this.view.addChild(
      this.dim,
      this.g,
      this.hoverBg,
      this.hoverTxt,
      this.cursorBg,
      this.cursorTxt,
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

    // --- hovered building: range ring + mini card ---
    const h = st.hover
    const reach = h ? towerRangeTiles(h.tower) : 0
    if (h && reach > 0) {
      const r = reach * TILE
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
