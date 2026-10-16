/**
 * ui/help.ts — the hotkey map: ONE table drives the key dispatch codes, the
 * build-bar / HUD key badges, the in-game hotkey sheet (H or ?) and the How to
 * Play hotkey section, so the documented keys can never drift from the bound ones.
 *
 * Keys bind on `KeyboardEvent.code` (the physical key), so the layout stays the
 * same on AZERTY / Dvorak keyboards and under an IME; the CAPS shown on badges
 * come from the browser's keyboard layout map when it offers one.
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { t } from '../i18n'
import { drawPanel, label, UIButton } from './theme'

/** Physical keys for the build bar, left to right (BUILD_ORDER[0..9]). */
export const BUILD_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'] as const

/** Physical keys for the named actions. */
export const KEY = {
  start: 'Space',
  confirm: 'Enter',
  cancel: 'Escape',
  upgrade: 'KeyZ',
  sell: 'KeyX',
  copy: 'KeyC',
  role: 'KeyV',
  prevRack: 'Comma',
  nextRack: 'Period',
  train: 'KeyL',
  models: 'KeyK',
  help: 'KeyH',
  helpAlt: 'Slash',
  speedDown: 'Minus',
  speedUp: 'Equal',
  fast: 'KeyF',
  mute: 'KeyM',
  ranges: 'KeyG',
  metrics: 'Backquote',
  metricsAlt: 'Tab',
  tabPrev: 'BracketLeft',
  tabNext: 'BracketRight',
} as const

/** Direct speed keys → multiplier. */
export const SPEED_CODES: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit6: 6, Digit0: 12 }

/** QWERTY fallbacks for the caps we draw. */
const FALLBACK: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Comma: ',',
  Period: '.',
  Minus: '−',
  Equal: '=',
  Slash: '?',
  Backquote: '`',
  Tab: 'Tab',
  BracketLeft: '[',
  BracketRight: ']',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

let layout: Map<string, string> | null = null
// The Keyboard API (Chromium) maps physical codes to the user's layout; best effort.
try {
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard
  void kb
    ?.getLayoutMap?.()
    .then((m) => (layout = m))
    .catch(() => undefined)
} catch {
  /* non-browser host */
}

/** Printable keys whose cap depends on the layout (letters, digits, punctuation). */
const LAYOUT_DEPENDENT = /^(Key[A-Z]|Digit\d|Comma|Period|Minus|Equal|Slash|Backquote|BracketLeft|BracketRight)$/

/** The cap to draw for a physical key code on THIS keyboard ("Q" on QWERTY, "A" on AZERTY). */
export function keyCap(code: string): string {
  if (LAYOUT_DEPENDENT.test(code)) {
    const mapped = layout?.get(code)
    if (mapped && mapped.trim()) return mapped.length === 1 ? mapped.toUpperCase() : mapped
  }
  if (FALLBACK[code]) return FALLBACK[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/** One row of the hotkey sheet: caps (codes or literal labels) + the i18n key of what it does. */
interface HotkeyRow {
  caps: string[]
  /** `key.<id>` describes the action. */
  id: string
}

interface HotkeyGroup {
  /** `key.group.<id>` heading. */
  id: string
  rows: HotkeyRow[]
}

/** literal caps for pointer gestures (localized). */
const GESTURE = (k: string): string => `@${k}`

export const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    id: 'board',
    rows: [
      { caps: [KEY.start], id: 'start' },
      { caps: [BUILD_CODES[0], '…', BUILD_CODES[9]], id: 'build' },
      { caps: [GESTURE('drag')], id: 'paint' },
      { caps: [KEY.cancel, GESTURE('rightClick')], id: 'cancel' },
      { caps: [KEY.prevRack, KEY.nextRack], id: 'cycle' },
      { caps: [KEY.ranges, GESTURE('holdAlt')], id: 'ranges' },
    ],
  },
  {
    id: 'rack',
    rows: [
      { caps: [KEY.upgrade], id: 'upgrade' },
      { caps: [KEY.sell], id: 'sell' },
      { caps: [KEY.copy], id: 'copy' },
      { caps: [KEY.role], id: 'role' },
      { caps: [KEY.tabPrev, KEY.tabNext], id: 'inspectTabs' },
    ],
  },
  {
    id: 'speed',
    rows: [
      { caps: ['Digit1', 'Digit2', 'Digit3', 'Digit6', 'Digit0'], id: 'speed' },
      { caps: [KEY.speedDown, KEY.speedUp], id: 'speedStep' },
      { caps: [KEY.fast], id: 'fast' },
      { caps: [KEY.mute], id: 'mute' },
    ],
  },
  {
    id: 'panels',
    rows: [
      { caps: [KEY.train], id: 'train' },
      { caps: [KEY.models], id: 'models' },
      { caps: [KEY.metrics, KEY.metricsAlt], id: 'metrics' },
      { caps: [KEY.help, KEY.helpAlt], id: 'help' },
      { caps: [KEY.confirm], id: 'confirm' },
      { caps: ['ArrowUp', 'ArrowDown', KEY.tabPrev, KEY.tabNext], id: 'menus' },
      { caps: ['PageUp', 'PageDown'], id: 'page' },
    ],
  },
]

/** A cap's display text (a key code, an ellipsis, or a localized gesture). */
export function capText(cap: string): string {
  if (cap === '…') return '…'
  if (cap.startsWith('@')) return t('key.gesture.' + cap.slice(1))
  return keyCap(cap)
}

/** Flattened rows for list surfaces (How to Play). */
export function hotkeyRows(): { caps: string; desc: string }[] {
  const out: { caps: string; desc: string }[] = []
  for (const g of HOTKEY_GROUPS) {
    for (const r of g.rows) out.push({ caps: r.caps.map(capText).join(' '), desc: t('key.' + r.id) })
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  The hotkey sheet overlay (H / ?)                                  *
 * ------------------------------------------------------------------ */

export class HotkeyOverlay {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private body = new Container()
  private title = label('', 20, COLORS.textBright, 'bold')
  private hint = label('', 11, COLORS.textDim)
  private close: UIButton
  private PW = 900
  private PH = 520

  constructor(onClose: () => void) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.78 })
    this.dim.eventMode = 'static'
    this.dim.on('pointertap', () => onClose())
    drawPanel(this.panel, px, py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.panel.eventMode = 'static'
    this.title.x = px + 24
    this.title.y = py + 18
    this.hint.x = px + 24
    this.hint.y = py + 46
    this.close = new UIButton({ w: 110, h: 30, accent: COLORS.trust, onTap: onClose })
    this.close.x = px + this.PW - 24 - 110
    this.close.y = py + 16
    this.body.x = px + 24
    this.body.y = py + 74
    this.view.addChild(this.dim, this.panel, this.title, this.hint, this.close, this.body)
    this.view.visible = false
  }

  get visible(): boolean {
    return this.view.visible
  }

  show(): void {
    this.refresh()
    this.view.visible = true
  }

  hide(): void {
    this.view.visible = false
  }

  /** Rebuild the sheet (language / layout map may have changed). */
  refresh(): void {
    this.title.text = t('key.title')
    this.hint.text = t('key.hint', { a: keyCap(KEY.help), b: keyCap(KEY.helpAlt) })
    this.close.setTitle(t('set.back', undefined, 'Back')).layout(0, 0, true)
    this.body.removeChildren().forEach((c) => c.destroy())
    const colW = (this.PW - 48 - 24) / 2
    const cols = [0, 0]
    HOTKEY_GROUPS.forEach((g, gi) => {
      const col = gi % 2
      let y = cols[col]
      const x = col * (colW + 24)
      const head = label(t('key.group.' + g.id), 13, COLORS.sla, 'bold')
      head.x = x
      head.y = y
      this.body.addChild(head)
      y += 22
      for (const r of g.rows) {
        let cx = x
        for (const cap of r.caps) {
          const txt = capText(cap)
          if (cap === '…') {
            const dots = label('…', 11, COLORS.textDim)
            dots.x = cx
            dots.y = y + 3
            this.body.addChild(dots)
            cx += dots.width + 4
            continue
          }
          const k = label(txt, 11, COLORS.cash, 'bold')
          const w = Math.max(20, Math.ceil(k.width) + 10)
          const bg = new Graphics()
          bg.roundRect(cx, y, w, 20, 4).fill({ color: 0x0a0e14, alpha: 0.9 })
          bg.roundRect(cx + 0.5, y + 0.5, w - 1, 19, 4).stroke({ width: 1, color: COLORS.panelEdge })
          k.x = cx + (w - k.width) / 2
          k.y = y + 3
          this.body.addChild(bg, k)
          cx += w + 4
        }
        const d = label(t('key.' + r.id), 11, COLORS.text)
        d.x = Math.max(cx + 6, x + 150)
        d.y = y + 3
        d.style.wordWrap = true
        d.style.breakWords = true
        d.style.wordWrapWidth = x + colW - d.x
        d.style.lineHeight = 14
        this.body.addChild(d)
        y += Math.max(26, d.height + 10)
      }
      cols[col] = y + 12
    })
  }
}
