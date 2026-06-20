/**
 * System menu (pause hub) + Settings panel — docs/SYSTEM-MENU.md §2/§5.
 *
 * SystemMenu is the navigation hub (Resume / Settings / content browsers /
 * Restart / Quit) shown over a dim backdrop while the sim is paused. SettingsPanel
 * is the tabbed preferences view (Audio / Display / Accessibility / Gameplay). Both
 * write through the SettingsStore; the Game subscribes and applies side-effects.
 */
import { Container, Graphics } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { t } from '../i18n'
import {
  getLang,
  setLang,
  LANG_LABEL,
  LANGS,
  getMode,
  setMode,
  type GameMode,
  type Lang,
  getSettings,
  setMasterVolume,
  setMusicVolume,
  setSfxVolume,
  setMuted,
  setReducedMotion,
  setDefaultSpeed,
  setTooltips,
  resetToDefaults,
} from '../settings'
import { drawPanel, label, UIButton } from './theme'
import { Slider, SegmentedControl, Toggle } from './widgets'

// ---------------------------------------------------------------- System menu --

export interface SystemMenuCallbacks {
  onResume: () => void
  onSettings: () => void
  onHelp: () => void
  onCodex: () => void
  onAbout: () => void
  onAchievements: () => void
  onRestart: () => void
  onQuit: () => void
}

export class SystemMenu {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private title = label('', 26, COLORS.textBright, 'bold')
  private rows: { btn: UIButton; key: string; fallback: string; soon?: boolean }[] = []
  private PW = 360
  private PH = 470

  constructor(cb: SystemMenuCallbacks) {
    const px = (DESIGN_W - this.PW) / 2
    const py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.78 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.panel, this.title)
    drawPanel(this.panel, px, py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.title.x = px + 24
    this.title.y = py + 22

    const defs: { key: string; fallback: string; onTap: () => void; accent?: number; soon?: boolean }[] = [
      { key: 'sys.resume', fallback: 'Resume', onTap: cb.onResume, accent: COLORS.trust },
      { key: 'sys.settings', fallback: 'Settings', onTap: cb.onSettings, accent: COLORS.sla },
      { key: 'sys.help', fallback: 'How to Play', onTap: cb.onHelp, accent: COLORS.data },
      { key: 'sys.codex', fallback: 'Codex', onTap: cb.onCodex, accent: COLORS.data },
      { key: 'sys.about', fallback: 'About', onTap: cb.onAbout, accent: COLORS.data },
      { key: 'sys.ach', fallback: 'Achievements', onTap: cb.onAchievements, soon: true },
      { key: 'sys.restart', fallback: 'Restart Run', onTap: cb.onRestart, accent: COLORS.warn },
      { key: 'sys.quit', fallback: 'Quit to Title', onTap: cb.onQuit, accent: COLORS.danger },
    ]
    let y = py + 70
    for (const d of defs) {
      const btn = new UIButton({ w: this.PW - 48, h: 40, accent: d.accent ?? COLORS.sla, onTap: d.onTap })
      btn.x = px + 24
      btn.y = y
      if (d.soon) btn.setEnabled(false)
      this.view.addChild(btn)
      this.rows.push({ btn, key: d.key, fallback: d.fallback, soon: d.soon })
      y += 48
    }
    this.view.visible = false
  }

  show(): void {
    this.refresh()
    this.view.visible = true
  }
  hide(): void {
    this.view.visible = false
  }
  get visible(): boolean {
    return this.view.visible
  }

  refresh(): void {
    this.title.text = t('sys.title', undefined, 'System')
    for (const r of this.rows) {
      r.btn.setTitle(t(r.key, undefined, r.fallback))
      if (r.soon) r.btn.setSub(t('sys.soon', undefined, 'Coming soon'))
      r.btn.layout(0, 14, true)
    }
  }
}

// ----------------------------------------------------------------- Settings ----

export interface SettingsCallbacks {
  /** back to the System menu hub. */
  onBack: () => void
  /** play a short tick so a volume change is audible. */
  onPreview: () => void
  /** re-arm the tutorial. */
  onReplayTutorial: () => void
  /** mode is switchable on the title or once the tutorial is finished. */
  isModeUnlocked: () => boolean
}

const TABS = [
  { id: 'audio', key: 'set.tab.audio', fallback: 'Audio' },
  { id: 'display', key: 'set.tab.display', fallback: 'Display' },
  { id: 'a11y', key: 'set.tab.a11y', fallback: 'Accessibility' },
  { id: 'gameplay', key: 'set.tab.gameplay', fallback: 'Gameplay' },
] as const

export class SettingsPanel {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private title = label('', 24, COLORS.textBright, 'bold')
  private tabBtns: UIButton[] = []
  private pages: Container[] = []
  private current = 0
  private PW = 580
  private PH = 440
  private px: number
  private py: number
  private cb: SettingsCallbacks

  // controls whose values/labels must sync on refresh
  private sMaster!: Slider
  private sMusic!: Slider
  private sSfx!: Slider
  private vMaster = label('', 13, COLORS.textDim)
  private vMusic = label('', 13, COLORS.textDim)
  private vSfx = label('', 13, COLORS.textDim)
  private tgMute!: Toggle
  private segLang!: SegmentedControl<Lang>
  private segMode!: SegmentedControl<GameMode>
  private lblModeLock = label('', 11, COLORS.warn)
  private tgReduced!: Toggle
  private segSpeed!: SegmentedControl<number>
  private tgTooltips!: Toggle
  private btnReplay!: UIButton
  private btnBack!: UIButton
  private btnReset!: UIButton
  /** closures that re-apply localized text (run on refresh). */
  private relabels: (() => void)[] = []

  constructor(cb: SettingsCallbacks) {
    this.cb = cb
    this.px = (DESIGN_W - this.PW) / 2
    this.py = (DESIGN_H - this.PH) / 2
    this.dim.rect(0, 0, DESIGN_W, DESIGN_H).fill({ color: 0x05080d, alpha: 0.82 })
    this.dim.eventMode = 'static'
    this.view.addChild(this.dim, this.panel, this.title)
    drawPanel(this.panel, this.px, this.py, this.PW, this.PH, { alpha: 0.98, radius: 12 })
    this.title.x = this.px + 24
    this.title.y = this.py + 20

    this.buildTabs()
    this.buildAudio()
    this.buildDisplay()
    this.buildA11y()
    this.buildGameplay()
    this.buildFooter()
    this.selectTab(0)
    this.view.visible = false
  }

  // --- layout helpers ---
  private rowY(i: number): number {
    return this.py + 104 + i * 56
  }
  private addRowLabel(page: Container, key: string, fallback: string, y: number): void {
    const l = label('', 15, COLORS.text, 'bold')
    l.x = this.px + 28
    l.y = y
    page.addChild(l)
    this.relabels.push(() => (l.text = t(key, undefined, fallback)))
  }

  private buildTabs(): void {
    const segW = 124
    const gap = 6
    const total = TABS.length * segW + (TABS.length - 1) * gap
    const x0 = this.px + (this.PW - total) / 2
    TABS.forEach((tab, i) => {
      const btn = new UIButton({ w: segW, h: 30, accent: COLORS.sla, onTap: () => this.selectTab(i) })
      btn.x = x0 + i * (segW + gap)
      btn.y = this.py + 58
      this.view.addChild(btn)
      this.tabBtns.push(btn)
      this.relabels.push(() => btn.setTitle(t(tab.key, undefined, tab.fallback)).layout(0, 0, true))
    })
  }

  private newPage(): Container {
    const c = new Container()
    this.view.addChild(c)
    this.pages.push(c)
    return c
  }

  private buildAudio(): void {
    const page = this.newPage()
    const a = getSettings().audio
    const sx = this.px + 200
    const sw = 250
    const mk = (i: number, v: number, vlabel: typeof this.vMaster, on: (x: number) => void): Slider => {
      const s = new Slider({
        w: sw,
        value: v,
        accent: COLORS.sla,
        onChange: (x) => {
          on(x)
          vlabel.text = Math.round(x * 100) + '%'
        },
        onCommit: () => this.cb.onPreview(),
      })
      s.x = sx
      s.y = this.rowY(i) + 4
      vlabel.x = sx + sw + 14
      vlabel.y = this.rowY(i)
      vlabel.text = Math.round(v * 100) + '%'
      page.addChild(s, vlabel)
      return s
    }
    this.addRowLabel(page, 'set.master', 'Master', this.rowY(0))
    this.sMaster = mk(0, a.master, this.vMaster, setMasterVolume)
    this.addRowLabel(page, 'set.music', 'Music', this.rowY(1))
    this.sMusic = mk(1, a.music, this.vMusic, setMusicVolume)
    this.addRowLabel(page, 'set.sfx', 'SFX', this.rowY(2))
    this.sSfx = mk(2, a.sfx, this.vSfx, setSfxVolume)
    this.addRowLabel(page, 'set.mute', 'Mute', this.rowY(3))
    this.tgMute = new Toggle({ value: a.muted, accent: COLORS.danger, onChange: (v) => setMuted(v) })
    this.tgMute.x = sx
    this.tgMute.y = this.rowY(3)
    page.addChild(this.tgMute)
  }

  private buildDisplay(): void {
    const page = this.newPage()
    const sx = this.px + 200
    this.addRowLabel(page, 'set.language', 'Language', this.rowY(0))
    this.segLang = new SegmentedControl<Lang>({
      options: LANGS.map((l) => ({ value: l, label: LANG_LABEL[l] })),
      value: getLang(),
      segW: 70,
      onChange: (l) => setLang(l),
    })
    this.segLang.x = sx
    this.segLang.y = this.rowY(0) - 4
    page.addChild(this.segLang)

    this.addRowLabel(page, 'set.mode', 'Display Mode', this.rowY(1))
    this.segMode = new SegmentedControl<GameMode>({
      options: [
        { value: 'normal', label: t('set.mode.normal', undefined, 'Normal') },
        { value: 'expert', label: t('set.mode.expert', undefined, 'Expert') },
      ],
      value: getMode(),
      segW: 96,
      onChange: (m) => setMode(m),
    })
    this.segMode.x = sx
    this.segMode.y = this.rowY(1) - 4
    page.addChild(this.segMode)
    this.lblModeLock.x = sx
    this.lblModeLock.y = this.rowY(1) + 30
    page.addChild(this.lblModeLock)
    this.relabels.push(() =>
      this.segMode.relabel((m) =>
        m === 'normal' ? t('set.mode.normal', undefined, 'Normal') : t('set.mode.expert', undefined, 'Expert'),
      ),
    )
  }

  private buildA11y(): void {
    const page = this.newPage()
    const sx = this.px + 280
    this.addRowLabel(page, 'set.reducedMotion', 'Reduced Motion', this.rowY(0))
    const sub = label('', 11, COLORS.textDim)
    sub.x = this.px + 28
    sub.y = this.rowY(0) + 20
    page.addChild(sub)
    this.relabels.push(
      () => (sub.text = t('set.reducedMotion.sub', undefined, 'Hold pulsing animations steady')),
    )
    this.tgReduced = new Toggle({ value: getSettings().a11y.reducedMotion, onChange: (v) => setReducedMotion(v) })
    this.tgReduced.x = sx
    this.tgReduced.y = this.rowY(0)
    page.addChild(this.tgReduced)
  }

  private buildGameplay(): void {
    const page = this.newPage()
    const g = getSettings().gameplay
    const sx = this.px + 240
    this.addRowLabel(page, 'set.defaultSpeed', 'Default Speed', this.rowY(0))
    this.segSpeed = new SegmentedControl<number>({
      options: [1, 2, 3].map((n) => ({ value: n, label: n + '×' })),
      value: g.defaultSpeed,
      segW: 60,
      onChange: (n) => setDefaultSpeed(n),
    })
    this.segSpeed.x = sx
    this.segSpeed.y = this.rowY(0) - 4
    page.addChild(this.segSpeed)

    this.addRowLabel(page, 'set.tooltips', 'Tooltips', this.rowY(1))
    this.tgTooltips = new Toggle({ value: g.tooltips, onChange: (v) => setTooltips(v) })
    this.tgTooltips.x = sx
    this.tgTooltips.y = this.rowY(1)
    page.addChild(this.tgTooltips)

    this.addRowLabel(page, 'set.replayTut', 'Tutorial', this.rowY(2))
    this.btnReplay = new UIButton({ w: 180, h: 34, accent: COLORS.data, onTap: () => this.cb.onReplayTutorial() })
    this.btnReplay.x = sx
    this.btnReplay.y = this.rowY(2) - 6
    page.addChild(this.btnReplay)
    this.relabels.push(() =>
      this.btnReplay.setTitle(t('set.replayTutBtn', undefined, 'Replay Tutorial')).layout(0, 0, true),
    )
  }

  private buildFooter(): void {
    this.btnReset = new UIButton({ w: 200, h: 38, accent: COLORS.warn, onTap: () => this.doReset() })
    this.btnReset.x = this.px + 24
    this.btnReset.y = this.py + this.PH - 54
    this.btnBack = new UIButton({ w: 200, h: 38, accent: COLORS.trust, onTap: () => this.cb.onBack() })
    this.btnBack.x = this.px + this.PW - 24 - 200
    this.btnBack.y = this.py + this.PH - 54
    this.view.addChild(this.btnReset, this.btnBack)
    this.relabels.push(() => {
      this.btnReset.setTitle(t('set.reset', undefined, 'Reset to Defaults')).layout(0, 0, true)
      this.btnBack.setTitle(t('set.back', undefined, 'Back')).layout(0, 0, true)
    })
  }

  private selectTab(i: number): void {
    this.current = i
    this.pages.forEach((p, idx) => (p.visible = idx === i))
    this.tabBtns.forEach((b, idx) => b.setActive(idx === i))
  }

  private doReset(): void {
    resetToDefaults()
    this.syncControls()
  }

  /** Pull live store values into the controls (after external changes / reset). */
  private syncControls(): void {
    const s = getSettings()
    this.sMaster.setValue(s.audio.master)
    this.sMusic.setValue(s.audio.music)
    this.sSfx.setValue(s.audio.sfx)
    this.vMaster.text = Math.round(s.audio.master * 100) + '%'
    this.vMusic.text = Math.round(s.audio.music * 100) + '%'
    this.vSfx.text = Math.round(s.audio.sfx * 100) + '%'
    this.tgMute.setValue(s.audio.muted)
    this.tgReduced.setValue(s.a11y.reducedMotion)
    this.tgTooltips.setValue(s.gameplay.tooltips)
    this.segSpeed.setValue(s.gameplay.defaultSpeed)
    this.segLang.setValue(getLang())
    this.segMode.setValue(getMode())
    const unlocked = this.cb.isModeUnlocked()
    this.segMode.setEnabled(unlocked)
    this.lblModeLock.text = unlocked ? '' : t('set.mode.locked', undefined, 'Unlocks after the tutorial')
  }

  show(): void {
    this.refresh()
    this.view.visible = true
  }
  hide(): void {
    this.view.visible = false
  }
  get visible(): boolean {
    return this.view.visible
  }

  refresh(): void {
    this.title.text = t('set.title', undefined, 'Settings')
    for (const fn of this.relabels) fn()
    this.syncControls()
    this.selectTab(this.current)
  }
}
