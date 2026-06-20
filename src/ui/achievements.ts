/**
 * Achievements UI: a grid panel (over the ContentPanel scroll base) + a small
 * unlock toast. Every achievement gets a hand-drawn vector glyph in the house
 * pixel-neon style (drawAchIcon), the same approach as the HUD speaker/gear/note
 * glyphs and the request/tower textures — no asset files.
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_W } from '../config'
import type { GameState } from '../core/types'
import { t } from '../i18n'
import { ACH_CATEGORIES, ACHIEVEMENTS, type AchCategory, type AchievementDef, type AchievementTracker } from '../achievements'
import { ContentPanel } from './browsers'
import { drawPanel, label } from './theme'

const CAT_COLOR: Record<AchCategory, number> = {
  progress: COLORS.trust,
  economy: COLORS.cash,
  serving: COLORS.sla,
  safety: COLORS.good,
  models: COLORS.data,
  studio: COLORS.data,
  research: COLORS.sla,
  hardware: COLORS.power,
  history: COLORS.warn,
  hidden: COLORS.textDim,
}

// ---------------------------------------------------------------- icons --------

/** Draw a 28×28 achievement glyph (origin 0,0) in `col`. Kept to a few primitives each. */
export function drawAchIcon(g: Graphics, id: string, col: number): void {
  g.clear()
  const ring = (): void => {
    g.circle(14, 14, 11).stroke({ width: 1.5, color: col, alpha: 0.7 })
  }
  switch (id) {
    // --- progress ---
    case 'p_wave10': // ascending steps
      g.rect(5, 18, 5, 5).rect(11, 13, 5, 10).rect(17, 8, 5, 15).fill({ color: col })
      break
    case 'p_wave50': // flag
      g.rect(7, 4, 1.6, 20).fill({ color: col })
      g.poly([9, 5, 22, 9, 9, 13]).fill({ color: col })
      break
    case 'p_win': // trophy: cup + two handles + stem + base
      g.poly([8, 5, 20, 5, 18, 13, 10, 13]).fill({ color: col })
      g.moveTo(9, 6).quadraticCurveTo(4, 9, 9, 12).stroke({ width: 1.5, color: col })
      g.moveTo(19, 6).quadraticCurveTo(24, 9, 19, 12).stroke({ width: 1.5, color: col })
      g.rect(13, 13, 2, 5).fill({ color: col })
      g.rect(10, 18, 8, 2).rect(8, 20, 12, 2.6).fill({ color: col })
      break
    case 'p_endless': // infinity
      g.circle(9, 14, 4).circle(19, 14, 4).stroke({ width: 1.8, color: col })
      break
    case 'p_brink': // low bar / heartbeat
      g.moveTo(4, 14).lineTo(9, 14).lineTo(12, 7).lineTo(15, 21).lineTo(18, 14).lineTo(24, 14).stroke({ width: 1.6, color: col })
      break
    case 'p_comeback': // rebound arrow up
      g.moveTo(5, 20).lineTo(13, 9).lineTo(18, 14).lineTo(24, 6).stroke({ width: 1.7, color: col })
      g.poly([24, 6, 19, 6, 24, 11]).fill({ color: col })
      break
    // --- economy ---
    case 'e_tycoon': // coin stack
      for (let i = 0; i < 3; i++) g.ellipse(14, 19 - i * 5, 9, 3).fill({ color: col, alpha: 0.5 + i * 0.2 })
      break
    case 'e_hyperscaler': // tall server towers
      g.rect(5, 10, 5, 14).rect(12, 6, 5, 18).rect(19, 13, 5, 11).fill({ color: col })
      break
    case 'e_fulltilt': // full gauge
      g.arc(14, 16, 9, Math.PI, 0).stroke({ width: 2, color: col })
      g.moveTo(14, 16).lineTo(21, 11).stroke({ width: 1.8, color: col })
      break
    case 'e_lean': // single rack + check
      g.roundRect(7, 6, 9, 16, 2).stroke({ width: 1.5, color: col })
      g.moveTo(16, 14).lineTo(19, 18).lineTo(24, 9).stroke({ width: 1.8, color: col })
      break
    // --- serving ---
    case 's_flawless': // star + check
      g.poly([14, 4, 16, 11, 23, 11, 17, 15, 19, 22, 14, 18, 9, 22, 11, 15, 5, 11, 12, 11]).fill({ color: col })
      break
    case 's_throughput': // rising bars
      g.rect(5, 17, 4, 6).rect(11, 12, 4, 11).rect(17, 7, 4, 16).fill({ color: col })
      g.poly([22, 6, 24, 8, 20, 9]).fill({ color: col })
      break
    case 's_zeroleak': // droplet with slash
      g.poly([14, 5, 19, 16, 9, 16]).arc(14, 16, 5, 0, Math.PI).fill({ color: col, alpha: 0.6 })
      g.moveTo(6, 22).lineTo(22, 6).stroke({ width: 1.8, color: COLORS.danger })
      break
    case 's_cache': // stacked disks
      for (let i = 0; i < 3; i++) {
        g.ellipse(14, 9 + i * 5, 8, 2.6).fill({ color: col, alpha: 0.85 })
      }
      break
    case 's_speed': // lightning
      g.poly([15, 4, 8, 15, 13, 15, 11, 24, 19, 12, 14, 12, 17, 4]).fill({ color: col })
      break
    // --- safety ---
    case 'sf_cleanhands': // shield + check
      g.poly([14, 4, 23, 8, 23, 15, 14, 24, 5, 15, 5, 8]).stroke({ width: 1.5, color: col })
      g.moveTo(10, 14).lineTo(13, 18).lineTo(19, 9).stroke({ width: 1.7, color: col })
      break
    case 'sf_unbreached': // solid shield
      g.poly([14, 4, 23, 8, 23, 15, 14, 24, 5, 15, 5, 8]).fill({ color: col })
      break
    case 'sf_depth': // layered shields
      g.poly([14, 4, 22, 7, 22, 14, 14, 22, 6, 14, 6, 7]).stroke({ width: 1.3, color: col, alpha: 0.5 })
      g.poly([14, 8, 20, 10, 20, 15, 14, 21, 8, 15, 8, 10]).stroke({ width: 1.5, color: col })
      break
    case 'sf_nofalse': // shield + balance
      g.poly([14, 4, 23, 8, 23, 15, 14, 24, 5, 15, 5, 8]).stroke({ width: 1.4, color: col })
      g.moveTo(9, 13).lineTo(19, 13).moveTo(14, 10).lineTo(14, 18).stroke({ width: 1.3, color: col })
      break
    // --- models ---
    case 'm_trillion': // chip with T
      g.roundRect(7, 7, 14, 14, 2).stroke({ width: 1.5, color: col })
      g.moveTo(11, 11).lineTo(17, 11).moveTo(14, 11).lineTo(14, 18).stroke({ width: 1.6, color: col })
      break
    case 'm_longmem': // wide scroll / window
      g.roundRect(4, 9, 20, 10, 2).stroke({ width: 1.5, color: col })
      g.moveTo(8, 14).lineTo(20, 14).stroke({ width: 1.2, color: col, alpha: 0.7 })
      break
    case 'm_david': // small vs big
      g.rect(5, 16, 6, 7).fill({ color: col })
      g.rect(14, 6, 9, 17).stroke({ width: 1.4, color: col, alpha: 0.6 })
      break
    case 'm_collector': // grid of chips
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) g.roundRect(7 + c * 8, 7 + r * 8, 6, 6, 1).fill({ color: col, alpha: 0.85 })
      break
    // --- studio ---
    case 'st_first': // flask
      g.poly([11, 5, 11, 12, 6, 22, 22, 22, 17, 12, 17, 5]).stroke({ width: 1.5, color: col })
      g.moveTo(9, 17).lineTo(19, 17).stroke({ width: 3, color: col, alpha: 0.6 })
      break
    case 'st_mad': // atom
      ring()
      g.ellipse(14, 14, 11, 4).stroke({ width: 1.2, color: col })
      g.circle(14, 14, 2).fill({ color: col })
      break
    case 'st_deep': // lineage tree
      g.circle(14, 6, 2.4).circle(7, 20, 2.4).circle(21, 20, 2.4).fill({ color: col })
      g.moveTo(14, 8).lineTo(7, 18).moveTo(14, 8).lineTo(21, 18).stroke({ width: 1.3, color: col })
      break
    case 'st_reasoner': // brain sigma
      g.moveTo(20, 7).lineTo(9, 7).lineTo(15, 14).lineTo(9, 21).lineTo(20, 21).stroke({ width: 1.7, color: col })
      break
    case 'st_alchemist': // merge arrows
      g.moveTo(6, 7).lineTo(14, 14).moveTo(22, 7).lineTo(14, 14).lineTo(14, 23).stroke({ width: 1.6, color: col })
      break
    // --- research ---
    case 'r_tree': // checklist tree
      g.rect(6, 6, 4, 4).rect(6, 13, 4, 4).rect(6, 20, 4, 4).stroke({ width: 1.2, color: col })
      g.moveTo(13, 8).lineTo(22, 8).moveTo(13, 15).lineTo(22, 15).moveTo(13, 22).lineTo(22, 22).stroke({ width: 1.4, color: col })
      break
    case 'r_side': // fork
      g.moveTo(14, 22).lineTo(14, 13).lineTo(7, 6).moveTo(14, 13).lineTo(21, 6).stroke({ width: 1.7, color: col })
      break
    case 'r_kv': // stacked layers
      for (let i = 0; i < 3; i++) g.poly([14, 5 + i * 5, 22, 8 + i * 5, 14, 11 + i * 5, 6, 8 + i * 5]).stroke({ width: 1.2, color: col })
      break
    case 'r_parallel': // parallel bars
      g.rect(6, 6, 3, 16).rect(13, 6, 3, 16).rect(20, 6, 3, 16).fill({ color: col })
      break
    case 'r_redteam': // crosshair
      ring()
      g.moveTo(14, 2).lineTo(14, 26).moveTo(2, 14).lineTo(26, 14).stroke({ width: 1, color: col, alpha: 0.7 })
      break
    // --- hardware ---
    case 'h_pod': // 8-gpu node grid
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g.rect(4 + c * 5.2, 9 + r * 6, 4, 4).fill({ color: col, alpha: 0.85 })
      break
    case 'h_giga': // big rack
      g.roundRect(8, 4, 12, 20, 2).stroke({ width: 1.5, color: col })
      for (let i = 0; i < 4; i++) g.rect(10, 7 + i * 4.2, 8, 2.4).fill({ color: col, alpha: 0.8 })
      break
    case 'h_liquid': // droplet + flow
      g.poly([14, 5, 19, 15, 9, 15]).arc(14, 15, 5, 0, Math.PI).fill({ color: col })
      break
    case 'h_oneofeach': // mixed shapes
      g.rect(5, 16, 6, 7).fill({ color: col })
      g.circle(16, 9, 4).fill({ color: col })
      g.poly([20, 16, 24, 23, 16, 23]).fill({ color: col })
      break
    // --- history ---
    case 'hi_gpu': // chip + warning
      g.roundRect(6, 8, 12, 12, 2).stroke({ width: 1.4, color: col })
      g.poly([20, 8, 25, 18, 15, 18]).stroke({ width: 1.3, color: COLORS.warn })
      g.rect(19.4, 12, 1.3, 3).rect(19.4, 16, 1.3, 1.3).fill({ color: COLORS.warn })
      break
    case 'hi_price': // coin down-arrow
      g.circle(11, 12, 6).stroke({ width: 1.5, color: col })
      g.moveTo(20, 8).lineTo(20, 20).moveTo(16, 16).lineTo(20, 21).lineTo(24, 16).stroke({ width: 1.5, color: COLORS.danger })
      break
    case 'hi_euact': // gavel
      g.rect(6, 18, 14, 3).fill({ color: col })
      g.roundRect(13, 6, 8, 5, 1).fill({ color: col })
      g.rect(15.5, 10, 2, 9).fill({ color: col })
      break
    case 'hi_power': // bolt
      g.poly([16, 3, 8, 14, 13, 14, 11, 25, 20, 11, 14, 11, 18, 3]).fill({ color: col })
      break
    case 'hi_heat': // thermometer
      g.roundRect(12, 4, 4, 13, 2).stroke({ width: 1.4, color: col })
      g.circle(14, 20, 4).fill({ color: COLORS.danger })
      g.rect(13, 9, 2, 9).fill({ color: COLORS.danger })
      break
    case 'hi_reroute': // diverging arrows
      g.moveTo(5, 14).lineTo(14, 14).lineTo(22, 7).moveTo(14, 14).lineTo(22, 21).stroke({ width: 1.5, color: col })
      g.poly([22, 7, 17, 7, 22, 12]).poly([22, 21, 17, 21, 22, 16]).fill({ color: col })
      break
    case 'hi_boss': // skull
      g.circle(14, 12, 8).fill({ color: col })
      g.circle(11, 11, 2).circle(17, 11, 2).fill({ color: COLORS.bg })
      g.rect(10, 20, 8, 3).fill({ color: col })
      break
    // --- hidden / fun ---
    case 'x_brownout': // cracked bolt
      g.poly([16, 3, 8, 14, 13, 14, 11, 25, 20, 11, 14, 11, 18, 3]).stroke({ width: 1.4, color: col })
      break
    case 'x_minimalist': // single block
      g.roundRect(9, 9, 10, 10, 2).fill({ color: col })
      break
    case 'x_agent': // robot
      g.roundRect(7, 9, 14, 11, 3).stroke({ width: 1.5, color: col })
      g.circle(11, 14, 1.6).circle(17, 14, 1.6).fill({ color: col })
      g.moveTo(14, 9).lineTo(14, 5).stroke({ width: 1.3, color: col })
      g.circle(14, 4, 1.6).fill({ color: col })
      break
    case 'x_hoarder': // coin pile
      g.ellipse(10, 19, 6, 3).ellipse(18, 19, 6, 3).ellipse(14, 14, 6, 3).fill({ color: col, alpha: 0.85 })
      break
    default: // medal
      ring()
      g.circle(14, 14, 4).fill({ color: col })
  }
}

// ------------------------------------------------------------- grid panel ------

const COLS = 2
const GAP = 16
const CELL_H = 66

export class AchievementsPanel extends ContentPanel {
  constructor(
    onBack: () => void,
    private tracker: AchievementTracker,
    private getState: () => GameState | null,
  ) {
    super(onBack, 'sys.ach', 'Achievements')
  }

  refresh(): void {
    this.refreshChrome()
    this.clearBody()
    const s = this.getState()
    const cellW = (this.bodyW - GAP) / COLS
    let y = 0
    // header: unlocked X / Y
    this.addText(
      t('ach.progress', { n: this.tracker.unlockedCount(), total: ACHIEVEMENTS.length }, `Unlocked ${this.tracker.unlockedCount()} / ${ACHIEVEMENTS.length}`),
      13,
      COLORS.textDim,
      0,
      y,
    )
    y += 28

    for (const cat of ACH_CATEGORIES) {
      const defs = ACHIEVEMENTS.filter((a) => a.category === cat)
      if (!defs.length) continue
      y = this.sectionHeader(t('ach.cat.' + cat, undefined, cat), y)
      defs.forEach((def, i) => {
        const cx = (i % COLS) * (cellW + GAP)
        if (i % COLS === 0 && i > 0) y += CELL_H + 8
        this.drawCell(def, cx, y, cellW, s)
      })
      y += CELL_H + 8 + 8
    }
    this.setContentHeight(y + 10)
  }

  private drawCell(def: AchievementDef, cx: number, cy: number, w: number, s: GameState | null): void {
    const unlocked = this.tracker.isUnlocked(def.id)
    const hiddenLock = def.hidden && !unlocked
    const accent = unlocked ? CAT_COLOR[def.category] : COLORS.textDim

    const card = new Graphics()
    drawPanel(card, cx, cy, w, CELL_H, { alpha: unlocked ? 0.6 : 0.35, edge: unlocked ? accent : COLORS.panelEdge })
    this.body.addChild(card)

    const icon = new Graphics()
    drawAchIcon(icon, hiddenLock ? 'default' : def.id, accent)
    icon.x = cx + 12
    icon.y = cy + 12
    icon.alpha = unlocked ? 1 : 0.5
    this.body.addChild(icon)

    const tx = cx + 50
    const name = hiddenLock ? '???' : t(`ach.${def.id}.name`, undefined, def.name)
    this.addText(name, 13, unlocked ? COLORS.textBright : COLORS.text, tx, cy + 9, true)

    if (hiddenLock) {
      this.addText(t('ach.hiddenHint', undefined, 'Hidden — keep playing'), 10, COLORS.textDim, tx, cy + 28)
      return
    }

    if (def.goals) {
      const pr = this.tracker.progressOf(def.id, s)
      const lvl = ['', 'I', 'II', 'III'][pr.level] ?? String(pr.level)
      const capped = pr.level >= def.goals.length
      const label2 = capped
        ? t('ach.maxed', { lvl }, `Maxed (${lvl})`)
        : t('ach.tierprog', { cur: Math.floor(pr.cur), max: pr.max, lvl: lvl || '–' }, `${Math.floor(pr.cur)} / ${pr.max}`)
      this.addText(label2, 10, accent, tx, cy + 28)
      // mini bar
      const bw = w - 50 - 16
      const frac = capped ? 1 : Math.max(0, Math.min(1, pr.cur / pr.max))
      const bar = new Graphics()
      bar.roundRect(tx, cy + 46, bw, 5, 2).fill({ color: 0x0a0e14, alpha: 0.9 })
      if (frac > 0) bar.roundRect(tx, cy + 46, Math.max(4, bw * frac), 5, 2).fill({ color: accent })
      this.body.addChild(bar)
    } else {
      this.addText(t(`ach.${def.id}.desc`, undefined, def.desc), 10, COLORS.textDim, tx, cy + 28, false, w - 50 - 12)
    }
  }
}

// ----------------------------------------------------------------- toast -------

/** A small transient banner shown when an achievement unlocks. */
export class AchievementToast {
  readonly view = new Container()
  private bg = new Graphics()
  private icon = new Graphics()
  private head = label('', 11, COLORS.textDim, 'bold')
  private name = label('', 14, COLORS.textBright, 'bold')
  private queue: AchievementDef[] = []
  private timer = 0
  private readonly W = 320
  private readonly H = 52

  constructor() {
    drawPanel(this.bg, 0, 0, this.W, this.H, { alpha: 0.96, edge: COLORS.trust, radius: 10 })
    this.icon.x = 20
    this.icon.y = 12
    this.head.x = 64
    this.head.y = 9
    this.name.x = 64
    this.name.y = 24
    this.view.addChild(this.bg, this.icon, this.head, this.name)
    this.view.x = (DESIGN_W - this.W) / 2
    this.view.y = 104
    this.view.visible = false
  }

  push(defs: AchievementDef[]): void {
    this.queue.push(...defs)
  }

  update(dt: number): void {
    if (this.timer > 0) {
      this.timer -= dt
      // fade out the last ~0.4s
      this.view.alpha = Math.min(1, this.timer / 0.4)
      if (this.timer <= 0) this.view.visible = false
      return
    }
    const next = this.queue.shift()
    if (!next) return
    this.head.text = t('ach.unlocked', undefined, 'Achievement unlocked')
    this.name.text = t(`ach.${next.id}.name`, undefined, next.name)
    drawAchIcon(this.icon, next.id, CAT_COLOR[next.category])
    this.view.alpha = 1
    this.view.visible = true
    this.timer = 3.4
  }
}
