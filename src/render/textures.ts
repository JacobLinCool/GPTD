import { Container, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js'
import { COLORS } from '../config'
import type { RequestTypeDef, TowerDef } from '../core/types'
import { HARDWARE_DEFS, HARDWARE_TIERS } from '../sim/content'
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

/**
 * Display sizes (design px). Every world texture is baked on a SQUARE frame of
 * exactly its display size at BAKE_RES texels per design px, so a sprite is drawn
 * at scale 1 — no non-uniform stretch, no uneven "mixels" (the old 23×22 crop drawn
 * at 40×40 was a 1.74×1.82 stretch).
 */
export const TOWER_PX = 40
export const REQ_PX = 24
export const CORE_PX = 62
const BAKE_RES = 2

/** Metallic rack ladder: a rack reads by silhouette (size, trays, pipes) on a dark tier-tinted
 *  floor plate, with the tier colour only on its stripe and cap — so a rack never shares its
 *  bright body colour with a request archetype or the training state. */
const METAL_D = 0x2d384d
const METAL = 0x4b5a75
const METAL_L = 0x6e7f9c
const METAL_H = 0xb4c2da
const SLOT = 0x121924
const COOLANT = 0x36e0e0
const OUTLINE = 0x05080d

/** The pixel glyph set: outcomes, rack causes and action stamps (9×9 masks, white + dark rim). */
export type GlyphName =
  | 'check'
  | 'clock'
  | 'cross'
  | 'hazard'
  | 'noentry'
  | 'overflow'
  | 'drop'
  | 'shield'
  | 'bolt'
  | 'droplet'
  | 'thermo'
  | 'question'
  | 'coin'
  | 'spark'
  | 'chevron'
  | 'download'

const GLYPHS: Record<GlyphName, string[]> = {
  check: [
    '.........',
    '........#',
    '.......##',
    '#.....##.',
    '##...##..',
    '.##.##...',
    '..###....',
    '...#.....',
    '.........',
  ],
  clock: [
    '..#####..',
    '.#.....#.',
    '#...#...#',
    '#...#...#',
    '#...###.#',
    '#.......#',
    '#.......#',
    '.#.....#.',
    '..#####..',
  ],
  cross: [
    '##.....##',
    '###...###',
    '.###.###.',
    '..#####..',
    '...###...',
    '..#####..',
    '.###.###.',
    '###...###',
    '##.....##',
  ],
  hazard: [
    '....#....',
    '...###...',
    '...#.#...',
    '..##.##..',
    '..##.##..',
    '.#######.',
    '.###.###.',
    '#########',
    '.........',
  ],
  noentry: [
    '..#####..',
    '.#######.',
    '#########',
    '#.......#',
    '#.......#',
    '#########',
    '.#######.',
    '..#####..',
    '.........',
  ],
  overflow: [
    '######...',
    '#....#...',
    '#.####.##',
    '#....#...',
    '#.#######',
    '#....#...',
    '#.####.##',
    '#....#...',
    '######...',
  ],
  drop: [
    '...#.#...',
    '...#.#...',
    '...#.#...',
    '.###.###.',
    '..#...#..',
    '...#.#...',
    '....#....',
    '.........',
    '##.....##',
  ],
  shield: [
    '#########',
    '#########',
    '###...###',
    '###...###',
    '.##...##.',
    '.###.###.',
    '..#####..',
    '...###...',
    '....#....',
  ],
  bolt: [
    '.....###.',
    '....###..',
    '...###...',
    '..######.',
    '.######..',
    '....###..',
    '...###...',
    '..##.....',
    '.#.......',
  ],
  droplet: [
    '....#....',
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
    '.#######.',
    '.#######.',
    '..#####..',
    '...###...',
  ],
  thermo: [
    '...##....',
    '..#..#...',
    '..#..#...',
    '..#..#...',
    '..####...',
    '..####...',
    '.######..',
    '.######..',
    '..####...',
  ],
  question: [
    '..####...',
    '.##..##..',
    '.....##..',
    '....##...',
    '...##....',
    '...##....',
    '.........',
    '...##....',
    '...##....',
  ],
  coin: [
    '..#####..',
    '.##...##.',
    '##.###.##',
    '##.#...##',
    '##.###.##',
    '##...#.##',
    '##.###.##',
    '.##...##.',
    '..#####..',
  ],
  spark: [
    '....#....',
    '....#....',
    '..#.#.#..',
    '...###...',
    '#########',
    '...###...',
    '..#.#.#..',
    '....#....',
    '....#....',
  ],
  chevron: [
    '....#....',
    '...###...',
    '..##.##..',
    '.##...##.',
    '##.....##',
    '....#....',
    '...###...',
    '..##.##..',
    '.##...##.',
  ],
  download: [
    '...###...',
    '...###...',
    '...###...',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
    '.........',
    '#########',
  ],
}
/** Glyph texture edge (9 + a 1-px dark rim on each side). */
export const GLYPH_PX = 11

/** Particle frames (white, tinted per particle) packed into the shared FX atlas. */
export type ParticleFrame = 'px' | 'sq2' | 'sq3' | 'shard' | 'dot' | 'spark' | 'chevron' | 'ring' | 'glow'

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
      g.moveTo(cx - 2, cy + 3)
        .lineTo(cx - 4, cy + 6)
        .lineTo(cx + 1, cy + 3)
        .closePath()
        .fill({ color: ink })
      return true
    case 'comp': // code completion: angle brackets
      g.moveTo(cx - 2, cy - 4)
        .lineTo(cx - 6, cy)
        .lineTo(cx - 2, cy + 4)
        .stroke({ width: 1.4, color: ink })
      g.moveTo(cx + 2, cy - 4)
        .lineTo(cx + 6, cy)
        .lineTo(cx + 2, cy + 4)
        .stroke({ width: 1.4, color: ink })
      return true
    case 'rag': // long-context retrieval: stacked document lines + a lens
      for (let i = 0; i < 3; i++) g.rect(cx - 6, cy - 4 + i * 3, 8, 1.4).fill({ color: ink2 })
      g.circle(cx + 4, cy + 3, 2.2).stroke({ width: 1.2, color: ink })
      g.moveTo(cx + 5.5, cy + 4.5)
        .lineTo(cx + 7, cy + 6)
        .stroke({ width: 1.2, color: ink })
      return true
    case 'summ': // summarization: long lines collapsing to a short one
      g.rect(cx - 6, cy - 4, 12, 1.4).fill({ color: ink2 })
      g.rect(cx - 6, cy - 1, 12, 1.4).fill({ color: ink2 })
      g.rect(cx - 6, cy + 2, 6, 1.6).fill({ color: ink })
      return true
    case 'reason': // extreme decode / chain-of-thought: a branching tree
      g.circle(cx, cy - 4, 1.6).fill({ color: ink })
      g.moveTo(cx, cy - 3)
        .lineTo(cx - 4, cy + 2)
        .stroke({ width: 1.2, color: ink2 })
      g.moveTo(cx, cy - 3)
        .lineTo(cx + 4, cy + 2)
        .stroke({ width: 1.2, color: ink2 })
      g.circle(cx - 4, cy + 3, 1.4).fill({ color: ink })
      g.circle(cx + 4, cy + 3, 1.4).fill({ color: ink })
      return true
    case 'agent': // agentic loop: a circular arrow (tool loop)
      g.circle(cx, cy, 4).stroke({ width: 1.3, color: ink })
      g.moveTo(cx + 4, cy - 2)
        .lineTo(cx + 4, cy + 1)
        .lineTo(cx + 6.5, cy - 0.5)
        .closePath()
        .fill({ color: ink })
      return true
    case 'batch': // offline throughput: a grid of cells
      for (let r = 0; r < 2; r++)
        for (let col = 0; col < 3; col++)
          g.rect(cx - 5 + col * 4, cy - 3 + r * 4, 2.6, 2.6).fill({ color: ink2 })
      return true
    case 'jailbreak': // adversarial hazard: a warning triangle with a bang
      g.moveTo(cx, cy - 5)
        .lineTo(cx + 5, cy + 4)
        .lineTo(cx - 5, cy + 4)
        .closePath()
        .stroke({ width: 1.3, color: ink })
      g.rect(cx - 0.8, cy - 2, 1.6, 3.5).fill({ color: ink })
      g.circle(cx, cy + 3, 0.9).fill({ color: ink })
      return true
    default:
      return false
  }
}

/** Index of a hardware tier on the upgrade ladder (0 = Edge … 6 = NVL72). */
export function rackTierIndex(hwId: string | undefined): number {
  const i = hwId ? HARDWARE_TIERS.indexOf(hwId) : -1
  return i < 0 ? 0 : i
}

export class TextureFactory {
  private cache = new Map<string, Texture>()
  private atlas: Texture | null = null
  private frames = new Map<string, Texture>()
  constructor(readonly renderer: Renderer) {}

  /** Bake a container onto an exact square/rect frame (0,0,w,h) at BAKE_RES texels per px. */
  private bake(key: string, target: Container, w: number, h: number): Texture {
    const cached = this.cache.get(key)
    if (cached) return cached
    const tex = this.renderer.generateTexture({
      target,
      frame: new Rectangle(0, 0, w, h),
      resolution: BAKE_RES,
      antialias: false,
    })
    tex.source.scaleMode = 'nearest'
    this.cache.set(key, tex)
    target.destroy({ children: true })
    return tex
  }

  /** Tower sprite. For servers, pass the current rack tier so upgraded racks change silhouette. */
  tower(def: TowerDef, hwId?: string): Texture {
    const hw = def.kind === 'server' ? HARDWARE_DEFS[hwId ?? def.hardwareId ?? ''] : undefined
    const key = 'tower:' + (hw ? `rack_${hw.id}` : def.id)
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    if (hw) drawRack(g, rackTierIndex(hw.id), hw.color, hw.cooling === 'liquid')
    else drawSupport(g, def)
    return this.bake(key, c, TOWER_PX, TOWER_PX)
  }

  /** The Cooling Tower's fan blades (spun as an overlay sprite while the cooling plant works). */
  fanBlades(def: TowerDef): Texture {
    const key = 'fan:' + def.id
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    const cx = TOWER_PX / 2
    const cy = TOWER_PX / 2 - 1
    for (let a = 0; a < 4; a++) {
      const ang = (a / 4) * Math.PI * 2
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      // a skewed blade: a quad from the hub out to the housing ring
      const p = (r: number, off: number) => [cx + ca * r - sa * off, cy + sa * r + ca * off]
      const [x1, y1] = p(3, -2)
      const [x2, y2] = p(10, -3)
      const [x3, y3] = p(10, 2)
      const [x4, y4] = p(3, 2)
      g.moveTo(x1, y1)
        .lineTo(x2, y2)
        .lineTo(x3, y3)
        .lineTo(x4, y4)
        .closePath()
        .fill({ color: lighten(def.color, 0.25) })
    }
    g.circle(cx, cy, 3).fill({ color: def.accent })
    return this.bake(key, c, TOWER_PX, TOWER_PX)
  }

  /**
   * §5.3 the request marker: a double-layer icon on a frame whose SILHOUETTE encodes
   * the latency class — rounded = interactive (IN), square = near-real-time (NR),
   * chamfered = throughput/offline (TO), spiked = adversarial (carries a hazard).
   * Centre = the archetype's workload primitive; top = a short head label.
   */
  request(def: RequestTypeDef): Texture {
    const key = 'req:' + def.id
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    const W = REQ_PX
    const body = mix(def.color, 0x0a0e14, 0.15)
    const rim = darken(def.color, 0.55)
    const edge = lighten(def.color, 0.45)
    const hostile = Object.keys(def.hazards ?? {}).length > 0
    if (hostile) {
      // spiked frame: a body with four edge spikes
      const m = W / 2
      g.moveTo(m, 0)
        .lineTo(m + 3, 3)
        .lineTo(W - 3, 3)
        .lineTo(W - 3, m - 3)
        .lineTo(W, m)
        .lineTo(W - 3, m + 3)
      g.lineTo(W - 3, W - 3)
        .lineTo(m + 3, W - 3)
        .lineTo(m, W)
        .lineTo(m - 3, W - 3)
        .lineTo(3, W - 3)
        .lineTo(3, m + 3)
      g.lineTo(0, m)
        .lineTo(3, m - 3)
        .lineTo(3, 3)
        .lineTo(m - 3, 3)
        .closePath()
        .fill({ color: rim })
      g.rect(4, 4, W - 8, W - 8).fill({ color: body })
      g.rect(3.5, 3.5, W - 7, W - 7).stroke({ width: 1, color: edge, alpha: 0.9 })
    } else if (def.latClass === 'TO') {
      // chamfered (notched) corners: offline / throughput traffic
      const k = 5
      const oct = (o: number) =>
        g
          .moveTo(o + k, o)
          .lineTo(W - o - k, o)
          .lineTo(W - o, o + k)
          .lineTo(W - o, W - o - k)
          .lineTo(W - o - k, W - o)
          .lineTo(o + k, W - o)
          .lineTo(o, W - o - k)
          .lineTo(o, o + k)
          .closePath()
      oct(1).fill({ color: rim })
      oct(2).fill({ color: body })
      oct(1.5).stroke({ width: 1, color: edge, alpha: 0.9 })
    } else {
      const radius = def.latClass === 'IN' ? 7 : 2
      g.roundRect(1, 1, W - 2, W - 2, radius).fill({ color: rim })
      g.roundRect(2, 2, W - 4, W - 4, radius - 1).fill({ color: body })
      g.roundRect(1.5, 1.5, W - 3, W - 3, radius).stroke({ width: 1, color: edge, alpha: 0.9 })
    }
    // the archetype primitive, drawn on the legacy 20-unit grid and scaled 1.2× so
    // it keeps its familiar on-board size inside the 24-px frame.
    const ig = new Graphics()
    const known = drawRequestIcon(ig, def.id, def.color, 20)
    ig.scale.set(1.2)
    c.addChild(ig)
    if (!known) {
      const gl = label(def.glyph, 10, lighten(def.color, 0.6), 'bold')
      gl.anchor.set(0.5)
      gl.x = W / 2
      gl.y = W / 2 + 2
      c.addChild(gl)
    }
    // head label (archetype short code) on a dark strip
    const hg = new Graphics()
    hg.roundRect(4, 2, W - 8, 8, 2).fill({ color: 0x05080d, alpha: 0.8 })
    c.addChild(hg)
    const head = label(
      REQ_HEAD[def.id] ?? def.id.slice(0, 3).toUpperCase(),
      7,
      lighten(def.color, 0.7),
      'bold',
    )
    head.anchor.set(0.5, 0)
    head.x = W / 2
    head.y = 1.5
    c.addChild(head)
    return this.bake(key, c, W, W)
  }

  /** Codex — the friendly terminal-bot tutorial guide. */
  codex(): Texture {
    const key = 'codex'
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    // cloud-headed terminal bot: blue cloud, dark screen face, cyan eyes + chest prompt
    const OUT = 0x2a2d63
    const BLUE = 0x6b7be6
    const BLUEH = 0x9aa6ff
    const SCREEN = 0x151b3c
    const SCREEN2 = 0x0b0f28
    const cyan = 0x7fe8ff

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
    return this.bake(key, c, 40, 40)
  }

  /**
   * The Trust Core crystal, baked in NEUTRAL greys so the trust-band tint reads true
   * (a cyan bake tinted red used to come out a calm mauve).
   */
  core(): Texture {
    const key = 'core'
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    const W = CORE_PX
    const m = W / 2
    g.roundRect(7, 9, W - 14, W - 14, 9).fill({ color: 0x2a2f38 })
    g.roundRect(7.5, 9.5, W - 15, W - 15, 9).stroke({ width: 1, color: 0x5a6270 })
    const diamond = (inset: number) =>
      g
        .moveTo(m, inset)
        .lineTo(W - inset, m)
        .lineTo(m, W - inset)
        .lineTo(inset, m)
        .closePath()
    diamond(3).fill({ color: 0x6b7482 })
    diamond(10).fill({ color: 0xb4bcc8 })
    diamond(19).fill({ color: 0xffffff })
    // facet lines
    g.moveTo(m, 10)
      .lineTo(m, W - 10)
      .stroke({ width: 1, color: 0x8a93a0, alpha: 0.8 })
    g.moveTo(10, m)
      .lineTo(W - 10, m)
      .stroke({ width: 1, color: 0x8a93a0, alpha: 0.8 })
    c.addChild(g)
    return this.bake(key, c, W, W)
  }

  /** Crack overlay for the Trust Core damage stages (1 = trust < 50, 2 = < 25, 3 = < 10). */
  coreCrack(stage: 1 | 2 | 3): Texture {
    const key = 'coreCrack:' + stage
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = new Container()
    const g = new Graphics()
    const W = CORE_PX
    const paths: [number, number][][] = [
      [
        [31, 8],
        [28, 18],
        [33, 24],
        [29, 31],
      ],
      [
        [50, 30],
        [41, 33],
        [38, 40],
        [31, 44],
      ],
      [
        [14, 34],
        [22, 30],
        [24, 22],
        [19, 16],
      ],
      [
        [31, 54],
        [34, 46],
        [29, 40],
        [33, 33],
      ],
      [
        [44, 14],
        [39, 22],
        [42, 27],
      ],
      [
        [12, 22],
        [20, 26],
      ],
    ]
    const n = stage === 1 ? 2 : stage === 2 ? 4 : 6
    for (let i = 0; i < n; i++) {
      const p = paths[i]
      g.moveTo(p[0][0], p[0][1])
      for (let k = 1; k < p.length; k++) g.lineTo(p[k][0], p[k][1])
      g.stroke({ width: 2, color: OUTLINE, alpha: 0.95 })
      g.moveTo(p[0][0] + 1, p[0][1])
      for (let k = 1; k < p.length; k++) g.lineTo(p[k][0] + 1, p[k][1])
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.35 })
    }
    c.addChild(g)
    return this.bake(key, c, W, W)
  }

  /** A pixel glyph (white body + dark rim) from the shared FX atlas; tint it per use. */
  glyph(name: GlyphName): Texture {
    return this.frame('g:' + name)
  }

  /** A white particle frame from the shared FX atlas (one texture source → one batch). */
  particle(name: ParticleFrame): Texture {
    return this.frame('p:' + name)
  }

  /** The FX atlas source: every particle frame and glyph lives in this one texture. */
  atlasTexture(): Texture {
    this.ensureAtlas()
    return this.atlas!
  }

  private frame(key: string): Texture {
    this.ensureAtlas()
    return this.frames.get(key) ?? Texture.WHITE
  }

  /**
   * Pack every glyph and particle frame into ONE render texture (2-px padding), so
   * the particle container, badges and outcome stamps all draw from one source.
   */
  private ensureAtlas(): void {
    if (this.atlas) return
    const c = new Container()
    const g = new Graphics()
    c.addChild(g)
    const slots: { key: string; x: number; y: number; w: number; h: number }[] = []
    let x = 1
    let y = 1
    let rowH = 0
    const place = (key: string, w: number, h: number): { x: number; y: number } => {
      if (x + w + 1 > 128) {
        x = 1
        y += rowH + 2
        rowH = 0
      }
      const at = { x, y }
      slots.push({ key, x, y, w, h })
      x += w + 2
      rowH = Math.max(rowH, h)
      return at
    }
    // --- glyphs: white mask + 8-neighbour dark rim ---
    for (const name of Object.keys(GLYPHS) as GlyphName[]) {
      const mask = GLYPHS[name]
      const at = place('g:' + name, GLYPH_PX, GLYPH_PX)
      const on = (cx: number, cy: number) => cy >= 0 && cy < 9 && cx >= 0 && cx < 9 && mask[cy][cx] === '#'
      for (let cy = -1; cy <= 9; cy++) {
        for (let cx = -1; cx <= 9; cx++) {
          if (on(cx, cy)) continue
          let near = false
          for (let dy = -1; dy <= 1 && !near; dy++)
            for (let dx = -1; dx <= 1; dx++) if (on(cx + dx, cy + dy)) near = true
          if (near) g.rect(at.x + 1 + cx, at.y + 1 + cy, 1, 1).fill({ color: OUTLINE, alpha: 0.9 })
        }
      }
      for (let cy = 0; cy < 9; cy++)
        for (let cx = 0; cx < 9; cx++)
          if (on(cx, cy)) g.rect(at.x + 1 + cx, at.y + 1 + cy, 1, 1).fill({ color: 0xffffff })
    }
    // --- particle frames (white; tinted per particle) ---
    const W = 0xffffff
    let p = place('p:px', 1, 1)
    g.rect(p.x, p.y, 1, 1).fill({ color: W })
    p = place('p:sq2', 2, 2)
    g.rect(p.x, p.y, 2, 2).fill({ color: W })
    p = place('p:sq3', 3, 3)
    g.rect(p.x, p.y, 3, 3).fill({ color: W })
    p = place('p:shard', 3, 3)
    g.rect(p.x + 1, p.y, 1, 3).fill({ color: W })
    g.rect(p.x, p.y + 1, 3, 1).fill({ color: W })
    p = place('p:dot', 4, 4)
    g.rect(p.x + 1, p.y, 2, 4).fill({ color: W })
    g.rect(p.x, p.y + 1, 4, 2).fill({ color: W })
    p = place('p:spark', 5, 5)
    g.rect(p.x + 2, p.y, 1, 5).fill({ color: W })
    g.rect(p.x, p.y + 2, 5, 1).fill({ color: W })
    g.rect(p.x + 1, p.y + 1, 3, 3).fill({ color: W, alpha: 0.6 })
    p = place('p:chevron', 4, 5)
    g.rect(p.x, p.y, 2, 1).fill({ color: W })
    g.rect(p.x + 1, p.y + 1, 2, 1).fill({ color: W })
    g.rect(p.x + 2, p.y + 2, 2, 1).fill({ color: W })
    g.rect(p.x + 1, p.y + 3, 2, 1).fill({ color: W })
    g.rect(p.x, p.y + 4, 2, 1).fill({ color: W })
    p = place('p:ring', 16, 16)
    g.circle(p.x + 8, p.y + 8, 7.25).stroke({ width: 1.5, color: W })
    p = place('p:glow', 16, 16)
    for (let r = 8; r >= 1; r--) g.circle(p.x + 8, p.y + 8, r).fill({ color: W, alpha: 0.09 })
    const tex = this.renderer.generateTexture({
      target: c,
      frame: new Rectangle(0, 0, 128, y + rowH + 2),
      resolution: BAKE_RES,
      antialias: false,
    })
    tex.source.scaleMode = 'nearest'
    c.destroy({ children: true })
    this.atlas = tex
    for (const s of slots) {
      this.frames.set(s.key, new Texture({ source: tex.source, frame: new Rectangle(s.x, s.y, s.w, s.h) }))
    }
  }
}

/**
 * The rack ladder (tier 0 Edge/L4 … 6 GB200 NVL72): a metallic chassis whose SIZE,
 * unit count and columns grow with the tier (a single GPU box → an 8-GPU pod → a
 * full liquid-cooled rack), plus a tier-colour stripe and cap. Liquid tiers carry
 * coolant pipes. The front bezel at the bottom holds the live batch-slot LEDs,
 * which are overlay sprites (see racks.ts), not baked art.
 */
function drawRack(g: Graphics, tier: number, color: number, liquid: boolean): void {
  const cw = [22, 26, 28, 30, 32, 34, 34][tier]
  const ch = [19, 22, 24, 26, 26, 28, 29][tier]
  const cols = [1, 1, 1, 1, 2, 2, 3][tier]
  const rows = [2, 3, 3, 4, 4, 5, 5][tier]
  const x0 = Math.round(20 - cw / 2)
  const y0 = 31 - ch
  // floor shadow + a dark tier-tinted floor plate so the rack reads against the board
  g.roundRect(3, 34, 34, 5, 2).fill({ color: COLORS.shadow, alpha: 0.6 })
  g.roundRect(3, 3, 34, 35, 4).fill({ color: darken(color, 0.66) })
  g.roundRect(3.5, 3.5, 33, 34, 4).stroke({ width: 1, color: darken(color, 0.2), alpha: 0.9 })
  // coolant pipes behind the chassis (liquid tiers)
  if (liquid) {
    for (const px of [x0 - 3, x0 + cw + 1]) {
      g.rect(px, y0 + 3, 2, ch - 3).fill({ color: darken(COOLANT, 0.3) })
      g.rect(px, y0 + 3, 1, ch - 3).fill({ color: COOLANT })
    }
    g.rect(x0 - 3, y0 + 2, cw + 6, 2).fill({ color: darken(COOLANT, 0.25) })
  }
  // chassis
  g.rect(x0, y0, cw, ch).fill({ color: METAL_D })
  g.rect(x0 + 1, y0 + 1, cw - 2, ch - 2).fill({ color: METAL })
  g.rect(x0 + 1, y0 + 1, cw - 2, 1).fill({ color: METAL_H, alpha: 0.8 })
  // tier stripe (left edge) + tier cap (top): the hardware ladder colour
  g.rect(x0, y0, 3, ch).fill({ color })
  g.rect(x0, y0, cw, 2).fill({ color })
  // heat-sink fins on the high tiers
  if (tier >= 3)
    for (let fx = x0 + 5; fx < x0 + cw - 2; fx += 3) g.rect(fx, y0 - 2, 1, 2).fill({ color: METAL_L })
  // compute units (GPU trays)
  const innerX = x0 + 4
  const innerW = cw - 6
  const colW = (innerW - (cols - 1)) / cols
  const unitH = (ch - 5) / rows
  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      const ux = innerX + ci * (colW + 1)
      const uy = y0 + 3 + ri * unitH
      g.rect(ux, uy, colW, Math.max(2, unitH - 1)).fill({ color: SLOT })
      g.rect(ux, uy + Math.max(2, unitH - 1) - 1, colW, 1).fill({ color: METAL_L, alpha: 0.7 })
      g.rect(ux + colW - 3, uy + 1, 2, 1).fill({ color: lighten(color, 0.3) })
    }
  }
  g.rect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1).stroke({ width: 1, color: OUTLINE, alpha: 0.9 })
  // front bezel: the batch-slot LED strip (lit by overlay sprites)
  g.rect(5, 31, 30, 6).fill({ color: SLOT })
  g.rect(5.5, 31.5, 29, 5).stroke({ width: 1, color: METAL_D })
}

/** Support buildings on the 40-px frame (router / cache / guardrails / power / cooling / lab). */
function drawSupport(g: Graphics, def: TowerDef): void {
  const W = TOWER_PX
  const col = def.color
  const acc = def.accent
  // base shadow + plate
  g.roundRect(4, W - 7, W - 8, 5, 2).fill({ color: COLORS.shadow, alpha: 0.55 })
  g.roundRect(4, 5, W - 8, W - 10, 5).fill({ color: darken(col, 0.62) })
  g.roundRect(5, 6, W - 10, W - 12, 4).fill({ color: darken(col, 0.32) })
  const cx = W / 2
  const cy = W / 2 - 1
  switch (def.kind) {
    case 'router': {
      g.circle(cx, cy, 6).fill({ color: acc })
      g.circle(cx, cy, 3).fill({ color: lighten(col, 0.4) })
      const off = [
        [cx, 10],
        [cx, W - 12],
        [10, cy],
        [W - 10, cy],
      ]
      for (const [x, y] of off) {
        g.moveTo(cx, cy).lineTo(x, y).stroke({ width: 2, color: acc, alpha: 0.85 })
        g.circle(x, y, 3).fill({ color: lighten(col, 0.2) })
      }
      break
    }
    case 'cache': {
      for (let i = 0; i < 3; i++) {
        const y = 12 + i * 6
        g.ellipse(cx, y, 11, 3.5).fill({ color: i === 0 ? lighten(col, 0.3) : darken(col, 0.1) })
        g.ellipse(cx, y, 11, 3.5).stroke({ width: 1, color: acc, alpha: 0.75 })
      }
      break
    }
    case 'guardrail': {
      const shield = () =>
        g
          .moveTo(cx, 8)
          .lineTo(W - 10, 12)
          .lineTo(W - 11, cy + 4)
          .lineTo(cx, W - 9)
          .lineTo(11, cy + 4)
          .lineTo(10, 12)
          .closePath()
      shield().fill({ color: darken(col, 0.1) })
      shield().stroke({ width: 1.5, color: acc })
      const arch = def.guardrail?.archetype
      if (arch === 'encoder') {
        // a fast classifier: scan lines across the shield
        for (let i = 0; i < 3; i++) g.rect(cx - 6, 15 + i * 4, 12, 1.5).fill({ color: lighten(col, 0.55) })
      } else if (arch === 'generative') {
        // an LLM judge: a small chip on the shield
        g.rect(cx - 5, cy - 5, 10, 10).fill({ color: darken(col, 0.45) })
        g.rect(cx - 5, cy - 5, 10, 10).stroke({ width: 1, color: lighten(col, 0.5) })
        for (let i = -1; i <= 1; i++) {
          g.rect(cx + i * 3 - 0.5, cy - 7, 1, 2).fill({ color: lighten(col, 0.5) })
          g.rect(cx + i * 3 - 0.5, cy + 5, 1, 2).fill({ color: lighten(col, 0.5) })
        }
      } else {
        // a content moderator: a check mark
        g.moveTo(cx - 5, cy)
          .lineTo(cx - 1, cy + 4)
          .lineTo(cx + 6, cy - 4)
          .stroke({ width: 2, color: lighten(col, 0.55) })
      }
      break
    }
    case 'power': {
      g.moveTo(cx + 3, 8)
        .lineTo(12, cy + 2)
        .lineTo(cx - 1, cy + 2)
        .lineTo(cx - 4, W - 9)
        .lineTo(W - 12, cy - 3)
        .lineTo(cx + 1, cy - 3)
        .closePath()
        .fill({ color: acc })
      break
    }
    case 'cooling': {
      // fan housing; the blades are a separate spinning overlay (fanBlades)
      g.circle(cx, cy, 12).fill({ color: darken(col, 0.55) })
      g.circle(cx, cy, 12).stroke({ width: 1.5, color: lighten(col, 0.2) })
      break
    }
    case 'cooling_liquid': {
      g.circle(cx, cy, 11).stroke({ width: 3, color: lighten(col, 0.25) })
      g.moveTo(cx, cy - 6)
        .lineTo(cx - 4, cy + 1)
        .lineTo(cx + 4, cy + 1)
        .closePath()
        .fill({ color: acc })
      g.circle(cx, cy + 3, 4).fill({ color: acc })
      break
    }
    case 'lab': {
      g.moveTo(cx - 3, 9)
        .lineTo(cx - 3, cy - 1)
        .lineTo(12, W - 10)
        .lineTo(W - 12, W - 10)
        .lineTo(cx + 3, cy - 1)
        .lineTo(cx + 3, 9)
        .closePath()
        .fill({ color: darken(col, 0.05) })
      g.rect(13, W - 15, W - 26, 4).fill({ color: acc })
      g.rect(cx - 5, 8, 10, 3).fill({ color: lighten(col, 0.4) })
      break
    }
  }
  g.roundRect(4.5, 5.5, W - 9, W - 11, 5).stroke({ width: 1, color: lighten(col, 0.35), alpha: 0.9 })
}
