import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import type { GameState, Tower } from '../core/types'
import { INCIDENTS, TECH_PATHS, UPGRADES, WAVES } from '../sim/content'
import {
  cacheChance,
  routeBonus,
  safetyRate,
  serverPower,
  serverQuality,
  serverSpeed,
  serverTargets,
} from '../sim/effects'
import { drawPanel, label, UIButton } from './theme'

/* ----------------------- Inspect Panel ----------------------- */

export class InspectPanel {
  readonly view = new Container()
  private bg = new Graphics()
  private title = label('', 15, COLORS.textBright, 'bold')
  private tag = label('', 12, COLORS.textDim)
  private lines: Text[] = []
  private sellBtn: UIButton
  private W = 250
  private H = 256

  constructor(onSell: (id: number) => void) {
    this.view.x = DESIGN_W - this.W - 12
    this.view.y = 108
    this.view.addChild(this.bg)
    drawPanel(this.bg, 0, 0, this.W, this.H)
    this.add(this.title, 14, 12)
    this.add(this.tag, 14, 34)
    for (let i = 0; i < 7; i++) {
      const t = label('', 12, COLORS.text)
      t.x = 14
      t.y = 58 + i * 19
      this.lines.push(t)
      this.view.addChild(t)
    }
    this.sellBtn = new UIButton({
      w: this.W - 28,
      h: 30,
      accent: COLORS.warn,
      onTap: () => this.curId != null && onSell(this.curId),
    })
    this.sellBtn.x = 14
    this.sellBtn.y = this.H - 40
    this.view.addChild(this.sellBtn)
    this.view.visible = false
  }
  private curId: number | null = null
  private add(t: Text, x: number, y: number): void {
    t.x = x
    t.y = y
    this.view.addChild(t)
  }

  update(s: GameState, selectedId: number | null): void {
    const t = selectedId == null ? undefined : s.towers.find((x) => x.id === selectedId)
    this.view.visible = !!t
    if (!t) {
      this.curId = null
      return
    }
    this.curId = t.id
    this.title.text = t.def.name
    this.tag.text = t.def.tagline
    const ls = statLines(s, t)
    for (let i = 0; i < this.lines.length; i++) {
      this.lines[i].text = ls[i] ?? ''
    }
    this.sellBtn.setTitle('SELL  +$' + Math.round(t.def.cost * 0.6)).layout(0, 0, true)
  }
}

function statLines(s: GameState, t: Tower): string[] {
  const d = t.def
  const out: string[] = []
  if (d.kind === 'server') {
    out.push(`Quality   ${serverQuality(s, d).toFixed(0)}  (vs complexity)`)
    out.push(`Speed     ${serverSpeed(s, d).toFixed(0)} compute/s`)
    out.push(`Specialty ${d.spec}`)
    out.push(`Targets   ${serverTargets(s, d)}`)
    out.push(`Power     ${serverPower(s, d).toFixed(1)}   Heat ${d.heat}`)
    out.push(`Range     ${d.range.toFixed(1)} tiles`)
    out.push(
      t.online ? (t.throttle < 1 ? `Status    ⚠ throttled` : `Status    ✓ online`) : `Status    ✗ brownout`,
    )
  } else if (d.kind === 'router') {
    out.push(`Routing bonus  +${Math.round(routeBonus(s, d) * 100)}%`)
    out.push(`Range     ${d.range.toFixed(1)} tiles`)
    out.push('Boosts matched servers and')
    out.push('prioritizes the right model.')
  } else if (d.kind === 'cache') {
    out.push(`Hit chance ${Math.round(cacheChance(s, d) * 100)}%  per server`)
    out.push(`Range     ${d.range.toFixed(1)} tiles`)
    out.push('Aura — buffs servers in range')
    out.push('with instant cacheable serves.')
  } else if (d.kind === 'safety') {
    out.push(`Clear rate ${safetyRate(s, d).toFixed(2)}/s`)
    out.push(`Range     ${d.range.toFixed(1)} tiles`)
    out.push('Neutralizes Jailbreak risk')
    out.push('before it reaches the core.')
  } else if (d.kind === 'power') {
    out.push(`Capacity  +${d.power} power`)
    out.push('Keeps your GPUs online.')
  } else if (d.kind === 'cooling') {
    out.push(`Capacity  +${d.cooling} cooling`)
    out.push('Prevents thermal throttling.')
  } else if (d.kind === 'lab') {
    out.push('Unlocks the tech tree.')
    out.push('Boosts Data yield from serves.')
  }
  return out
}

/* ----------------------- Incident Banner ----------------------- */

export class IncidentBanner {
  readonly view = new Container()
  private bg = new Graphics()
  private txt = label('', 13, COLORS.warn, 'bold')
  private W = 720
  constructor() {
    this.view.x = (DESIGN_W - this.W) / 2
    this.view.y = 102
    this.view.addChild(this.bg, this.txt)
    this.txt.x = 14
    this.txt.y = 8
    this.view.visible = false
  }
  update(s: GameState): void {
    const inc = s.pendingIncident
    if (!inc) {
      this.view.visible = false
      return
    }
    this.view.visible = true
    const prefix = s.phase === 'wave' ? 'ACTIVE INCIDENT' : 'NEXT WAVE'
    const t = `${inc.icon}  ${prefix}: ${inc.name} — ${inc.desc}`
    this.txt.text = t
    this.txt.style.fill = inc.good ? COLORS.trust : COLORS.warn
    const w = Math.min(DESIGN_W - 40, this.txt.width + 28)
    this.bg.clear()
    drawPanel(this.bg, 0, 0, w, 34, { edge: inc.good ? COLORS.trust : COLORS.warn })
    this.view.x = (DESIGN_W - w) / 2
  }
}

/* ----------------------- Training Panel (modal) ----------------------- */

export class TrainingPanel {
  readonly view = new Container()
  private dim = new Graphics()
  private bg = new Graphics()
  private head = label('', 20, COLORS.textBright, 'bold')
  private res = label('', 14, COLORS.text)
  private btns = new Map<string, UIButton>()
  private closeBtn: UIButton
  private PW = 1060
  private PH = 440

  constructor(onBuy: (id: string) => void, onClose: () => void) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.72 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.bg)
    drawPanel(this.bg, px, py, this.PW, this.PH, { alpha: 0.98 })
    this.head.text = 'TRAINING LAB — four competing research paths'
    this.head.x = px + 24
    this.head.y = py + 18
    this.res.x = px + 24
    this.res.y = py + 46
    this.view.addChild(this.head, this.res)

    const colW = 250
    const gap = 12
    const startX = px + 24
    TECH_PATHS.forEach((path, ci) => {
      const cx = startX + ci * (colW + gap)
      const header = label(path.name.toUpperCase(), 15, path.color, 'bold')
      header.x = cx
      header.y = py + 80
      const theme = label(path.theme, 11, COLORS.textDim)
      theme.x = cx
      theme.y = py + 100
      this.view.addChild(header, theme)
      const ups = UPGRADES.filter((u) => u.path === path.id)
      ups.forEach((u, ri) => {
        const b = new UIButton({ w: colW, h: 92, accent: path.color, onTap: () => onBuy(u.id) })
        b.x = cx
        b.y = py + 120 + ri * 98
        this.view.addChild(b)
        this.btns.set(u.id, b)
      })
    })

    this.closeBtn = new UIButton({ w: 160, h: 34, accent: COLORS.sla, onTap: onClose })
    this.closeBtn.x = px + this.PW - 184
    this.closeBtn.y = py + 14
    this.closeBtn.setTitle('CLOSE  ✕')
    this.view.addChild(this.closeBtn)
    this.view.visible = false
  }

  update(s: GameState): void {
    this.res.text = `Cash $${Math.floor(s.meters.cash)}    ◆ ${Math.floor(s.data)} data`
    this.closeBtn.layout(0, 0, true)
    for (const u of UPGRADES) {
      const b = this.btns.get(u.id)!
      const cur = s.upgrades[u.id] ?? 0
      const maxed = cur >= u.maxLevel
      const prereqOk = !u.requires || u.requires.every((r) => (s.upgrades[r] ?? 0) > 0)
      const affordable = s.meters.cash >= u.cashCost && s.data >= u.dataCost
      b.setTitle(`${u.name}   ${cur}/${u.maxLevel}`)
      b.setSub(maxed ? 'MAXED — fully researched' : `$${u.cashCost}  ◆${u.dataCost}\n${u.desc}`)
      b.setEnabled(!maxed && prereqOk && affordable)
      b.setActive(cur > 0)
      b.layoutCard()
    }
  }
}

/* ----------------------- Overlays (menu / win / lose) ----------------------- */

export class Overlay {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private title = label('', 44, COLORS.textBright, 'bold')
  private subtitle = label('', 16, COLORS.sla)
  private body: Text[] = []
  private actionBtn: UIButton
  private PW = 640
  private PH = 420

  constructor(onAction: () => void) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.82 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.panel)
    drawPanel(this.panel, px, py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.center(this.title, py + 44)
    this.center(this.subtitle, py + 104)
    for (let i = 0; i < 8; i++) {
      const t = label('', 14, COLORS.text)
      t.y = py + 150 + i * 24
      this.body.push(t)
      this.view.addChild(t)
    }
    this.actionBtn = new UIButton({ w: 280, h: 46, accent: COLORS.trust, onTap: onAction })
    this.actionBtn.x = (DESIGN_W - 280) / 2
    this.actionBtn.y = py + this.PH - 72
    this.view.addChild(this.actionBtn)
    this.view.visible = false
  }
  private center(t: Text, y: number): void {
    t.anchor.set(0.5, 0)
    t.x = DESIGN_W / 2
    t.y = y
    this.view.addChild(t)
  }

  show(kind: 'menu' | 'won' | 'lost', s: GameState): void {
    this.view.visible = true
    const lines: string[] = []
    if (kind === 'menu') {
      this.title.text = 'GIGAPROMPT'
      this.subtitle.text = 'T O W E R   D E F E N S E'
      lines.push('Waves of AI user requests flood your serving platform.')
      lines.push('Place GPU servers, route traffic, power & cool the racks,')
      lines.push('and defend Trust, SLA, and Cash across 20 escalating waves.')
      lines.push('')
      lines.push('Codex — your on-call SRE — will guide you through your first wave.')
      lines.push('Press Space to start a wave, 2×/3× to speed up. Good luck!')
      this.actionBtn.setAccent(COLORS.trust).setTitle('▶  START')
    } else if (kind === 'won') {
      this.title.text = 'PLATFORM SCALED'
      this.title.style.fill = COLORS.trust
      this.subtitle.text = s.message
      pushStats(lines, s)
      this.actionBtn.setAccent(COLORS.trust).setTitle('↻  PLAY AGAIN')
    } else {
      this.title.text = 'OUTAGE'
      this.title.style.fill = COLORS.danger
      this.subtitle.text = s.message
      this.subtitle.style.fill = COLORS.danger
      pushStats(lines, s)
      this.actionBtn.setAccent(COLORS.warn).setTitle('↻  TRY AGAIN')
    }
    for (let i = 0; i < this.body.length; i++) {
      const t = this.body[i]
      t.text = lines[i] ?? ''
      t.anchor.set(0.5, 0)
      t.x = DESIGN_W / 2
    }
    this.actionBtn.layout(0, 0, true)
  }
  hide(): void {
    this.view.visible = false
  }
}

function pushStats(lines: string[], s: GameState): void {
  lines.push(`Reached Wave ${s.waveIndex + 1} of ${WAVES.length}`)
  lines.push('')
  lines.push(`Requests served:   ${s.stats.served}`)
  lines.push(`Bad answers:       ${s.stats.bad}`)
  lines.push(`Unsafe answers:    ${s.stats.unsafe}`)
  lines.push(`Leaked:            ${s.stats.leaked}`)
  lines.push(`Total earned:      $${s.stats.cashEarned}`)
}

// referenced so tree-shaking keeps the incident data table importable elsewhere
export const _incidentCount = INCIDENTS.length
