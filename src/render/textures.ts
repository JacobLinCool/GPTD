import { Container, Graphics, type Renderer, type Texture } from 'pixi.js'
import { COLORS } from '../config'
import type { RequestTypeDef, TowerDef } from '../core/types'
import { HARDWARE_DEFS } from '../sim/content'
import { label } from '../ui/theme'

function mix(c: number, t: number, amt: number): number {
  const r = (c >> 16) & 255
  const g = (c >> 8) & 255
  const b = c & 255
  const tr = (t >> 16) & 255
  const tg = (t >> 8) & 255
  const tb = t & 255
  const m = (a: number, bb: number) => Math.round(a + (bb - a) * amt)
  return (m(r, tr) << 16) | (m(g, tg) << 8) | m(b, tb)
}
const darken = (c: number, a: number) => mix(c, 0x000000, a)
const lighten = (c: number, a: number) => mix(c, 0xffffff, a)

const TOWER_BASE = 26
const REQ_BASE = 20

/** §5.3 short readable head-label per archetype (the 9 P3a archetypes). */
const REQ_HEAD: Record<string, string> = {
  embed: 'EMB',
  chat: 'CHAT',
  comp: 'CODE',
  rag: 'RAG',
  summ: 'SUM',
  reason: 'RSN',
  agent: 'AGNT',
  batch: 'BTCH',
  jailbreak: 'JAIL',
}

/**
 * §5.3 draw a distinctive vector primitive per archetype into the icon's lower
 * region (centered around y≈W*0.58). Returns true if the archetype was recognized
 * (so callers can fall back to the legacy glyph for anything unknown). Each shape
 * reads at a glance the request's WORKLOAD shape (prefill/decode/context/hazard).
 */
function drawRequestIcon(g: Graphics, id: string, color: number, W: number): boolean {
  const cx = W / 2
  const cy = W * 0.58
  const ink = lighten(color, 0.6)
  const ink2 = lighten(color, 0.35)
  switch (id) {
    case 'embed': // pure prefill: a row of dots (a vector embedding)
      for (let i = -2; i <= 2; i++) g.circle(cx + i * 3, cy, 1.1).fill({ color: ink })
      return true
    case 'chat': // balanced interactive: a speech bubble
      g.roundRect(cx - 5, cy - 4, 10, 7, 2).fill({ color: ink })
      g.moveTo(cx - 2, cy + 3).lineTo(cx - 4, cy + 6).lineTo(cx + 1, cy + 3).closePath().fill({ color: ink })
      return true
    case 'comp': // code completion: angle brackets
      g.moveTo(cx - 2, cy - 4).lineTo(cx - 6, cy).lineTo(cx - 2, cy + 4).stroke({ width: 1.4, color: ink })
      g.moveTo(cx + 2, cy - 4).lineTo(cx + 6, cy).lineTo(cx + 2, cy + 4).stroke({ width: 1.4, color: ink })
      return true
    case 'rag': // long-context retrieval: stacked document lines + a lens
      for (let i = 0; i < 3; i++) g.rect(cx - 6, cy - 4 + i * 3, 8, 1.4).fill({ color: ink2 })
      g.circle(cx + 4, cy + 3, 2.2).stroke({ width: 1.2, color: ink })
      g.moveTo(cx + 5.5, cy + 4.5).lineTo(cx + 7, cy + 6).stroke({ width: 1.2, color: ink })
      return true
    case 'summ': // summarization: long lines collapsing to a short one
      g.rect(cx - 6, cy - 4, 12, 1.4).fill({ color: ink2 })
      g.rect(cx - 6, cy - 1, 12, 1.4).fill({ color: ink2 })
      g.rect(cx - 6, cy + 2, 6, 1.6).fill({ color: ink })
      return true
    case 'reason': // extreme decode / chain-of-thought: a branching tree
      g.circle(cx, cy - 4, 1.6).fill({ color: ink })
      g.moveTo(cx, cy - 3).lineTo(cx - 4, cy + 2).stroke({ width: 1.2, color: ink2 })
      g.moveTo(cx, cy - 3).lineTo(cx + 4, cy + 2).stroke({ width: 1.2, color: ink2 })
      g.circle(cx - 4, cy + 3, 1.4).fill({ color: ink })
      g.circle(cx + 4, cy + 3, 1.4).fill({ color: ink })
      return true
    case 'agent': // agentic loop: a circular arrow (tool loop)
      g.circle(cx, cy, 4).stroke({ width: 1.3, color: ink })
      g.moveTo(cx + 4, cy - 2).lineTo(cx + 4, cy + 1).lineTo(cx + 6.5, cy - 0.5).closePath().fill({ color: ink })
      return true
    case 'batch': // offline throughput: a grid of cells
      for (let r = 0; r < 2; r++)
        for (let col = 0; col < 3; col++) g.rect(cx - 5 + col * 4, cy - 3 + r * 4, 2.6, 2.6).fill({ color: ink2 })
      return true
    case 'jailbreak': // adversarial hazard: a warning triangle with a bang
      g.moveTo(cx, cy - 5).lineTo(cx + 5, cy + 4).lineTo(cx - 5, cy + 4).closePath().stroke({ width: 1.3, color: ink })
      g.rect(cx - 0.8, cy - 2, 1.6, 3.5).fill({ color: ink })
      g.circle(cx, cy + 3, 0.9).fill({ color: ink })
      return true
    default:
      return false
  }
}

export class TextureFactory {
  private cache = new Map<string, Texture>()
  constructor(private renderer: Renderer) {}

  private bake(key: string, target: Container): Texture {
    const cached = this.cache.get(key)
    if (cached) return cached
    const tex = this.renderer.generateTexture({ target, resolution: 1, antialias: false })
    tex.source.scaleMode = 'nearest'
    this.cache.set(key, tex)
    target.destroy({ children: true })
    return tex
  }

  /** Tower sprite. For servers, pass the current rack tier so upgraded racks recolor. */
  tower(def: TowerDef, hwId?: string): Texture {
    const hw = def.kind === 'server' && hwId ? HARDWARE_DEFS[hwId] : undefined
    const key = 'tower:' + (hw ? `rack_${hw.id}` : def.id)
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    drawTower(g, hw ? { ...def, color: hw.color, accent: hw.accent } : def)
    return this.bake(key, c)
  }

  /**
   * §5.3 the redesigned request marker: a clear DOUBLE-LAYER icon, no cryptic
   * single-letter glyph. Outer = a type-colored rounded frame; centre = a vector
   * primitive drawn per the request's ARCHETYPE (the 9 P3a archetypes, keyed off
   * `def.id`); top = a tiny readable head-label (archetype short code). The legacy
   * `glyph` is kept only as a fallback for any unknown archetype.
   */
  request(def: RequestTypeDef): Texture {
    const key = 'req:' + def.id
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    const W = REQ_BASE
    const body = mix(def.color, 0x0a0e14, 0.15)
    // layer 1: the type-colored frame
    g.roundRect(1, 1, W - 2, W - 2, 5).fill({ color: darken(def.color, 0.55) })
    g.roundRect(2, 2, W - 4, W - 4, 4).fill({ color: body })
    g.roundRect(1.5, 1.5, W - 3, W - 3, 5).stroke({ width: 1, color: lighten(def.color, 0.45), alpha: 0.9 })
    // layer 2: the archetype vector primitive (drawn in the lower 2/3, bright)
    const known = drawRequestIcon(g, def.id, def.color, W)
    if (!known) {
      // unknown archetype → fall back to the legacy glyph (kept for compat)
      const gl = label(def.glyph, 10, lighten(def.color, 0.6), 'bold')
      gl.anchor.set(0.5)
      gl.x = W / 2
      gl.y = W / 2 + 2
      c.addChild(gl)
    }
    // layer 3: a small head-label (archetype short code) sitting on a dark strip
    g.roundRect(2.5, 1.5, W - 5, 7, 2).fill({ color: 0x05080d, alpha: 0.78 })
    const head = label(REQ_HEAD[def.id] ?? def.id.slice(0, 3).toUpperCase(), 6, lighten(def.color, 0.7), 'bold')
    head.anchor.set(0.5, 0)
    head.x = W / 2
    head.y = 1.5
    c.addChild(head)
    return this.bake(key, c)
  }

  /** Codex — the friendly terminal-bot tutorial guide. */
  codex(): Texture {
    const key = 'codex'
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    // cloud-headed terminal bot: blue cloud, dark screen face, cyan eyes + chest prompt
    const OUT = 0x2a2d63
    const BLUE = 0x6b7be6
    const BLUEH = 0x9aa6ff
    const SCREEN = 0x151b3c
    const SCREEN2 = 0x0b0f28
    const cyan = 0x7fe8ff

    // square frame so the baked texture is centered/consistent
    g.rect(0, 0, 40, 40).fill({ color: 0x000000, alpha: 0 })

    // arms + legs (behind the body)
    for (const x of [6, 29]) {
      g.roundRect(x - 1, 24, 7, 8, 3).fill({ color: OUT })
      g.roundRect(x, 25, 5, 6, 2).fill({ color: BLUE })
    }
    for (const x of [15, 21]) {
      g.roundRect(x - 1, 33, 6, 7, 2).fill({ color: OUT })
      g.roundRect(x, 34, 4, 5, 2).fill({ color: BLUE })
    }

    // body
    g.roundRect(12, 22, 16, 14, 6).fill({ color: OUT })
    g.roundRect(13, 23, 14, 12, 5).fill({ color: BLUE })
    g.roundRect(14, 24, 12, 4, 3).fill({ color: BLUEH, alpha: 0.45 })

    // cloud head (outline pass, then fill pass)
    const lobes: [number, number, number][] = [
      [20, 16, 9],
      [11, 15, 6],
      [29, 15, 6],
      [13, 9, 6],
      [27, 9, 6],
      [20, 8, 6],
      [7, 18, 4.5],
      [33, 18, 4.5],
    ]
    for (const [x, y, r] of lobes) g.circle(x, y, r + 1.2).fill({ color: OUT })
    for (const [x, y, r] of lobes) g.circle(x, y, r).fill({ color: BLUE })
    for (const [x, y, r] of [
      [20, 8, 6],
      [13, 9, 6],
      [27, 9, 6],
    ] as [number, number, number][])
      g.circle(x, y - 1, r - 2).fill({ color: BLUEH, alpha: 0.4 })

    // screen face
    g.roundRect(11, 11, 18, 12, 5).fill({ color: SCREEN2 })
    g.roundRect(12, 12, 16, 10, 4).fill({ color: SCREEN })
    // sleepy cyan eyes
    g.moveTo(15.5, 16.5).quadraticCurveTo(17.5, 18.8, 19.5, 16.5).stroke({ width: 1.6, color: cyan })
    g.moveTo(20.5, 16.5).quadraticCurveTo(22.5, 18.8, 24.5, 16.5).stroke({ width: 1.6, color: cyan })

    // chest prompt  >_
    g.moveTo(16.5, 27).lineTo(19.5, 29).lineTo(16.5, 31).stroke({ width: 1.4, color: cyan })
    g.moveTo(21, 31).lineTo(24.5, 31).stroke({ width: 1.4, color: cyan })

    c.addChild(g)
    return this.bake(key, c)
  }

  /** The Trust Core crystal at the end of the lane. */
  core(): Texture {
    const key = 'core'
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    const W = 40
    g.roundRect(4, 6, W - 8, W - 8, 6).fill({ color: COLORS.coreDark })
    g.moveTo(W / 2, 2)
      .lineTo(W - 4, W / 2)
      .lineTo(W / 2, W - 2)
      .lineTo(4, W / 2)
      .closePath()
      .fill({ color: mix(COLORS.core, 0x000000, 0.35) })
    g.moveTo(W / 2, 7)
      .lineTo(W - 9, W / 2)
      .lineTo(W / 2, W - 7)
      .lineTo(9, W / 2)
      .closePath()
      .fill({ color: COLORS.core, alpha: 0.85 })
    g.moveTo(W / 2, 12)
      .lineTo(W - 14, W / 2)
      .lineTo(W / 2, W - 12)
      .lineTo(14, W / 2)
      .closePath()
      .fill({ color: lighten(COLORS.core, 0.5) })
    c.addChild(g)
    return this.bake(key, c)
  }
}

function drawTower(g: Graphics, def: TowerDef): void {
  const W = TOWER_BASE
  const col = def.color
  const acc = def.accent
  // base shadow + plate
  g.roundRect(2, W - 5, W - 4, 4, 2).fill({ color: COLORS.shadow, alpha: 0.5 })
  g.roundRect(2, 3, W - 4, W - 6, 4).fill({ color: darken(col, 0.62) })
  g.roundRect(3, 4, W - 6, W - 8, 3).fill({ color: darken(col, 0.32) })

  switch (def.kind) {
    case 'server': {
      // a rack with three blinking units
      for (let i = 0; i < 3; i++) {
        const y = 6 + i * 5
        g.rect(6, y, W - 12, 3).fill({ color: darken(col, 0.1) })
        g.rect(W - 9, y, 2, 2).fill({ color: acc })
        g.rect(6, y, 2, 2).fill({ color: lighten(col, 0.3) })
      }
      break
    }
    case 'router': {
      // hub + 4 nodes
      g.circle(W / 2, W / 2, 4).fill({ color: acc })
      g.circle(W / 2, W / 2, 2).fill({ color: lighten(col, 0.4) })
      const off = [
        [W / 2, 6],
        [W / 2, W - 6],
        [7, W / 2],
        [W - 7, W / 2],
      ]
      for (const [x, y] of off) {
        g.moveTo(W / 2, W / 2)
          .lineTo(x, y)
          .stroke({ width: 1.5, color: acc, alpha: 0.8 })
        g.circle(x, y, 2).fill({ color: lighten(col, 0.2) })
      }
      break
    }
    case 'cache': {
      // stacked disks
      for (let i = 0; i < 3; i++) {
        const y = 7 + i * 4
        g.ellipse(W / 2, y, 7, 2.4).fill({ color: i === 0 ? lighten(col, 0.3) : darken(col, 0.1) })
        g.ellipse(W / 2, y, 7, 2.4).stroke({ width: 1, color: acc, alpha: 0.7 })
      }
      break
    }
    case 'guardrail': {
      // shield
      g.moveTo(W / 2, 5)
        .lineTo(W - 7, 8)
        .lineTo(W - 8, W / 2 + 2)
        .lineTo(W / 2, W - 5)
        .lineTo(7, W / 2 + 2)
        .lineTo(8, 8)
        .closePath()
        .fill({ color: darken(col, 0.1) })
      g.moveTo(W / 2, 5)
        .lineTo(W - 7, 8)
        .lineTo(W - 8, W / 2 + 2)
        .lineTo(W / 2, W - 5)
        .lineTo(7, W / 2 + 2)
        .lineTo(8, 8)
        .closePath()
        .stroke({ width: 1.2, color: acc })
      g.moveTo(W / 2 - 3, W / 2)
        .lineTo(W / 2 - 1, W / 2 + 3)
        .lineTo(W / 2 + 4, W / 2 - 3)
        .stroke({ width: 1.5, color: lighten(col, 0.5) })
      break
    }
    case 'power': {
      // lightning bolt
      g.moveTo(W / 2 + 2, 5)
        .lineTo(8, W / 2 + 1)
        .lineTo(W / 2 - 1, W / 2 + 1)
        .lineTo(W / 2 - 3, W - 5)
        .lineTo(W - 8, W / 2 - 2)
        .lineTo(W / 2 + 1, W / 2 - 2)
        .closePath()
        .fill({ color: acc })
      break
    }
    case 'cooling': {
      // fan / snowflake
      g.circle(W / 2, W / 2, 3).fill({ color: acc })
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2
        const x = W / 2 + Math.cos(ang) * 7
        const y = W / 2 + Math.sin(ang) * 7
        g.moveTo(W / 2, W / 2)
          .lineTo(x, y)
          .stroke({ width: 1.4, color: lighten(col, 0.2) })
      }
      break
    }
    case 'cooling_liquid': {
      // coolant loop: a ring of pipe with a droplet
      g.circle(W / 2, W / 2, 7).stroke({ width: 2, color: lighten(col, 0.25) })
      g.moveTo(W / 2, W / 2 - 4)
        .lineTo(W / 2 - 3, W / 2 + 1)
        .lineTo(W / 2 + 3, W / 2 + 1)
        .closePath()
        .fill({ color: acc })
      g.circle(W / 2, W / 2 + 2, 2.5).fill({ color: acc })
      break
    }
    case 'lab': {
      // flask
      g.moveTo(W / 2 - 2, 6)
        .lineTo(W / 2 - 2, W / 2 - 1)
        .lineTo(8, W - 6)
        .lineTo(W - 8, W - 6)
        .lineTo(W / 2 + 2, W / 2 - 1)
        .lineTo(W / 2 + 2, 6)
        .closePath()
        .fill({ color: darken(col, 0.05) })
      g.rect(9, W - 9, W - 18, 3).fill({ color: acc })
      g.rect(W / 2 - 3, 5, 6, 2).fill({ color: lighten(col, 0.4) })
      break
    }
  }
  // outline
  g.roundRect(2, 3, W - 4, W - 6, 4).stroke({ width: 1, color: lighten(col, 0.35), alpha: 0.9 })
}
