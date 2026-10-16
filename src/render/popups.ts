import { BitmapFont, BitmapText, Container, Sprite, type Texture } from 'pixi.js'
import { COLORS } from '../config'
import { getLang, t } from '../i18n'
import { FONT } from '../ui/theme'
import { clamp01, easeOutCubic, reducedMotion } from './anim'

/** The board's bitmap font family (popups, banners, rack tags, hint chips). */
export const POP_FONT = 'gptd-pop'
/** Hard cap on live popups; the oldest is recycled when a new one needs a slot. */
const POP_CAP = 32
/** Same-key popups closer than this (px) and younger than MERGE_AGE merge into a ×N counter. */
const MERGE_DIST = 26
const MERGE_AGE = 0.35
/** New popups per key per second before further ones fold into a counter. */
const RATE_PER_KEY = 3
/** Vertical slot height for anti-overlap stacking. */
const SLOT_H = 13

let fontReady = false
/**
 * One bitmap font for every board popup: white fill + a dark outline baked once,
 * tinted per popup (so a popup never re-rasterizes a canvas Text). Glyphs outside
 * the preinstalled ASCII set (zh-TW labels) are rasterized lazily into the same atlas.
 */
export function ensurePopFont(): void {
  if (fontReady) return
  fontReady = true
  BitmapFont.install({
    name: POP_FONT,
    style: {
      fontFamily: FONT,
      fontSize: 26,
      fontWeight: 'bold',
      fill: 0xffffff,
      stroke: { color: 0x05080d, width: 6, join: 'round' },
    },
    chars: [[' ', '~'], '×·→…'],
    resolution: 1,
    padding: 4,
    textureStyle: { scaleMode: 'linear' },
  })
}

interface Pop {
  root: Container
  text: BitmapText
  icon: Sprite
  key: string
  base: string
  count: number
  x: number
  y: number
  age: number
  life: number
  rise: number
  /** half the drawn width (text + icon), for width-aware slotting */
  halfW: number
  /** income popups: the credits shown (a merge adds to it instead of counting "×N") */
  amount: number
}

const fmtCache = new Map<string, Intl.NumberFormat>()
function fmt(v: number, digits: number): string {
  const k = getLang() + digits
  let f = fmtCache.get(k)
  if (!f) {
    f = new Intl.NumberFormat(getLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
    fmtCache.set(k, f)
  }
  return f.format(v)
}

/**
 * Credits for a board popup: cents below 1, one decimal below 10, whole above — a
 * clean serve worth 0.04 reads "+$0.04", never "+$0".
 */
export function fmtCredits(v: number): string {
  const a = Math.abs(v)
  if (a > 0 && a < 0.01) return '<' + fmt(0.01, 2)
  return a < 1 ? fmt(a, 2) : a < 10 ? fmt(a, 1) : fmt(Math.round(a), 0)
}

/**
 * Board popups. Income is aggregated per board region over a short window (one
 * "+$1.42" instead of a smear of "+$0"s); failures pop individually but merge into a
 * "×N" counter when they repeat in one spot or exceed a per-outcome rate; nearby
 * popups stack into slots instead of overprinting.
 */
export class PopupLayer {
  readonly view = new Container()
  private live: Pop[] = []
  private spare: Pop[] = []
  private keyStamps = new Map<string, number[]>()
  private cashBins = new Map<number, { sum: number; x: number; y: number; t: number }>()
  private clock = 0
  private speed = 1

  constructor(private iconFor: (key: string) => Texture | null) {
    this.view.eventMode = 'none'
    ensurePopFont()
  }

  get count(): number {
    return this.live.length
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  /** Accumulate clean-serve income into its board region; flushed as one popup. */
  cash(amount: number, x: number, y: number): void {
    if (!(amount > 0)) return
    const bin = (Math.floor(x / 96) << 8) | Math.floor(y / 96)
    const b = this.cashBins.get(bin)
    if (b) {
      b.sum += amount
      b.x = x
      b.y = y
    } else this.cashBins.set(bin, { sum: amount, x, y, t: this.clock })
  }

  /**
   * Show a popup. `key` groups repeats (merge + rate limit); `icon` is a glyph key
   * resolved through iconFor. Returns false when it folded into an existing popup.
   */
  show(
    text: string,
    color: number,
    x: number,
    y: number,
    key = text,
    icon?: string,
    big = false,
    amount = Number.NaN,
  ): boolean {
    // merge into a same-key popup in the same spot
    for (const p of this.live) {
      if (p.key !== key || p.age > MERGE_AGE) continue
      if (Math.abs(p.x - x) < MERGE_DIST && Math.abs(p.y + p.rise - y) < MERGE_DIST) {
        this.bump(p, amount)
        return false
      }
    }
    // rate limit per key: fold the overflow into that key's newest popup
    const stamps = this.keyStamps.get(key) ?? []
    while (stamps.length && this.clock - stamps[0] > 1) stamps.shift()
    if (stamps.length >= RATE_PER_KEY) {
      let newest: Pop | null = null
      for (const p of this.live) if (p.key === key && (!newest || p.age < newest.age)) newest = p
      if (newest) {
        this.bump(newest, amount)
        return false
      }
    }
    // lay the text out first: the slot search needs its width (a long label next door must not overprint)
    const p = this.spare.pop() ?? this.make()
    p.text.text = text
    p.text.style.fontSize = big ? 17 : 13
    const tex = icon ? this.iconFor(icon) : null
    const halfW = Math.ceil(p.text.width / 2) + (tex ? 8 : 0)
    const slotY = this.freeSlot(x, y, halfW)
    if (slotY === null) {
      this.spare.push(p)
      // every stacking slot here is taken: fold into a same-key popup nearby, or let
      // the outcome glyph carry it alone rather than overprint text
      for (const q of this.live) {
        if (q.key === key && Math.abs(q.x - x) < 64 && Math.abs(q.y - y) < 64) {
          this.bump(q, amount)
          break
        }
      }
      return false
    }
    stamps.push(this.clock)
    this.keyStamps.set(key, stamps)
    if (this.live.length >= POP_CAP) this.recycle(this.live.shift()!)
    p.key = key
    p.base = text
    p.count = 1
    p.amount = amount
    p.halfW = halfW
    p.text.tint = color
    if (tex) {
      p.icon.texture = tex
      p.icon.visible = true
      p.icon.tint = color
      p.icon.x = -Math.round(p.text.width / 2) - 7
    } else p.icon.visible = false
    p.text.x = tex ? 3 : 0
    p.x = x
    p.y = slotY
    p.age = 0
    p.life = this.speed >= 6 ? 0.7 : 0.95
    p.rise = 0
    p.root.position.set(Math.round(p.x), Math.round(p.y))
    p.root.alpha = 1
    p.root.scale.set(1)
    this.view.addChild(p.root)
    this.live.push(p)
    return true
  }

  update(dt: number): void {
    this.clock += dt
    // flush income bins
    const window = this.speed >= 6 ? 0.6 : 0.4
    for (const [k, b] of this.cashBins) {
      if (this.clock - b.t < window) continue
      this.cashBins.delete(k)
      this.show(t('fx.cash', { v: fmtCredits(b.sum) }), COLORS.cash, b.x, b.y - 10, 'cash:' + k, undefined, false, b.sum)
    }
    const calm = reducedMotion()
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      p.age += dt
      const k = clamp01(p.age / p.life)
      if (k >= 1) {
        this.live.splice(i, 1)
        this.recycle(p)
        continue
      }
      p.rise = calm ? -6 * k : -22 * easeOutCubic(k)
      const punch = calm ? 1 : p.age < 0.12 ? 1.25 - 0.25 * (p.age / 0.12) : 1
      p.root.scale.set(punch)
      p.root.y = Math.round(p.y + p.rise)
      p.root.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
    }
  }

  clear(): void {
    for (const p of this.live) this.recycle(p)
    this.live.length = 0
    this.cashBins.clear()
    this.keyStamps.clear()
  }

  /** Fold a repeat into `p`: income adds up ("+$1.2" → "+$1.9"), anything else counts "×N". */
  private bump(p: Pop, amount = Number.NaN): void {
    p.count++
    if (Number.isFinite(p.amount) && Number.isFinite(amount)) {
      p.amount += amount
      p.text.text = t('fx.cash', { v: fmtCredits(p.amount) })
    } else p.text.text = `${p.base} ×${p.count}`
    p.halfW = Math.ceil(p.text.width / 2) + (p.icon.visible ? 8 : 0)
    p.age = Math.min(p.age, 0.05)
    if (p.icon.visible) p.icon.x = -Math.round(p.text.width / 2) - 7
  }

  /** Lowest free stacking slot at (x, y), or null when all are taken (popups never overprint). */
  private freeSlot(x: number, y: number, halfW: number): number | null {
    let ty = y
    for (let slot = 0; slot < 4; slot++) {
      let hit = false
      for (const p of this.live) {
        // two labels collide when their extents overlap (both centred on their x), either
        // where the older one is now or where both end up (every popup rises the same
        // curve, so two with one base row would converge as the older one slows)
        if (
          Math.abs(p.x - x) < p.halfW + halfW + 2 &&
          (Math.abs(p.y + p.rise - ty) < SLOT_H || Math.abs(p.y - ty) < SLOT_H)
        ) {
          hit = true
          break
        }
      }
      if (!hit) return ty
      ty -= SLOT_H
    }
    return null
  }

  private make(): Pop {
    const root = new Container()
    const text = new BitmapText({ text: '', style: { fontFamily: POP_FONT, fontSize: 13 } })
    text.anchor.set(0.5)
    const icon = new Sprite()
    icon.anchor.set(0.5)
    root.addChild(icon, text)
    return { root, text, icon, key: '', base: '', count: 0, x: 0, y: 0, age: 0, life: 1, rise: 0, halfW: 0, amount: Number.NaN }
  }

  private recycle(p: Pop): void {
    this.view.removeChild(p.root)
    if (this.spare.length < POP_CAP) this.spare.push(p)
    else p.root.destroy({ children: true })
  }
}
