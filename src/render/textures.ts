import { Container, Graphics, type Renderer, type Texture } from 'pixi.js'
import { COLORS } from '../config'
import type { RequestTypeDef, TowerDef } from '../core/types'
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

  tower(def: TowerDef): Texture {
    const key = 'tower:' + def.id
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    drawTower(g, def)
    return this.bake(key, c)
  }

  request(def: RequestTypeDef): Texture {
    const key = 'req:' + def.id
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    const W = REQ_BASE
    const body = mix(def.color, 0x0a0e14, 0.15)
    g.roundRect(1, 1, W - 2, W - 2, 5).fill({ color: darken(def.color, 0.55) })
    g.roundRect(2, 2, W - 4, W - 4, 4).fill({ color: body })
    g.roundRect(3, 3, W - 6, Math.floor(W / 2) - 2, 3).fill({ color: lighten(def.color, 0.15), alpha: 0.55 })
    g.roundRect(1.5, 1.5, W - 3, W - 3, 5).stroke({ width: 1, color: lighten(def.color, 0.45), alpha: 0.9 })
    const t = label(def.glyph, 11, 0x0a0e14, 'bold')
    t.anchor.set(0.5)
    t.x = W / 2
    t.y = W / 2 + 0.5
    c.addChild(t)
    return this.bake(key, c)
  }

  /** Codex — the friendly terminal-bot tutorial guide. */
  codex(): Texture {
    const key = 'codex'
    if (this.cache.has(key)) return this.cache.get(key)!
    const c = new Container()
    const g = new Graphics()
    const W = 32
    const cyan = COLORS.sla
    // antenna
    g.rect(W / 2 - 1, 1, 2, 5).fill({ color: darken(cyan, 0.2) })
    g.circle(W / 2, 1.5, 2.2).fill({ color: lighten(cyan, 0.4) })
    // head shell
    g.roundRect(3, 6, W - 6, W - 9, 7).fill({ color: darken(cyan, 0.55) })
    g.roundRect(4, 7, W - 8, W - 11, 6).fill({ color: darken(cyan, 0.3) })
    // screen face
    g.roundRect(6, 9, W - 12, W - 16, 4).fill({ color: 0x081a26 })
    // eyes
    g.circle(W / 2 - 5, 16, 2.7).fill({ color: cyan })
    g.circle(W / 2 + 5, 16, 2.7).fill({ color: cyan })
    g.circle(W / 2 - 5.6, 15.4, 1).fill({ color: 0xffffff })
    g.circle(W / 2 + 4.4, 15.4, 1).fill({ color: 0xffffff })
    // prompt smile
    g.roundRect(W / 2 - 4, 21, 8, 2, 1).fill({ color: lighten(cyan, 0.2) })
    g.rect(W / 2 + 5, 20, 2, 3).fill({ color: lighten(cyan, 0.3) })
    // outline
    g.roundRect(3, 6, W - 6, W - 9, 7).stroke({ width: 1, color: lighten(cyan, 0.45), alpha: 0.9 })
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
    case 'safety': {
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
