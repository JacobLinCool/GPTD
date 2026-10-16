/**
 * System menu (pause hub) + Settings panel — docs/SYSTEM-MENU.md §2/§5.
 *
 * SystemMenu is the navigation hub (Resume / Settings / content browsers /
 * Restart / Quit) shown over a dim backdrop while the sim is paused. Restart and
 * Quit are two-step: the first tap arms "tap again — this run will be lost".
 * SettingsPanel is the tabbed preferences view (Audio / Display / Accessibility /
 * Gameplay) covering every SettingsStore field. Both write through the
 * SettingsStore; the Game subscribes and applies side-effects. Arrow keys + Enter
 * drive the hub; [ and ] switch settings tabs.
 */
import { Container, Graphics, Text } from 'pixi.js'
import { COLORS, DESIGN_H, DESIGN_W } from '../config'
import { t } from '../i18n'
import {
  getLang,
  setLang,
  LANG_LABEL,
  LANGS,
  getMode,
  setMode,
  type FxLevel,
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
  updateSettings,
} from '../settings'
import { getPref, setPref } from './prefs'
import { drawPanel, FocusList, label, UIButton } from './theme'
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
  private focus = new FocusList(() => this.rows.map((r) => r.btn))
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

    // destructive rows confirm with a second tap (no modal): the first tap arms them
    const twoStep = (key: string, run: () => void) => (): void => {
      const row = this.rows.find((r) => r.key === key)
      if (!row) return
      if (row.btn.isArmed) {
        row.btn.disarm()
        run()
      } else {
        for (const r of this.rows) if (r !== row) r.btn.disarm()
        row.btn.arm(t(key === 'sys.restart' ? 'sys.confirmRestart' : 'sys.confirmQuit'), 2500)
      }
    }
    const defs: { key: string; fallback: string; onTap: () => void; accent?: number; soon?: boolean }[] = [
      { key: 'sys.resume', fallback: 'Resume', onTap: cb.onResume, accent: COLORS.trust },
      { key: 'sys.settings', fallback: 'Settings', onTap: cb.onSettings, accent: COLORS.sla },
      { key: 'sys.help', fallback: 'How to Play', onTap: cb.onHelp, accent: COLORS.data },
      { key: 'sys.codex', fallback: 'Codex', onTap: cb.onCodex, accent: COLORS.data },
      { key: 'sys.about', fallback: 'About', onTap: cb.onAbout, accent: COLORS.data },
      { key: 'sys.ach', fallback: 'Achievements', onTap: cb.onAchievements, accent: COLORS.trust },
      { key: 'sys.restart', fallback: 'Restart Run', onTap: twoStep('sys.restart', cb.onRestart), accent: COLORS.warn },
      { key: 'sys.quit', fallback: 'Quit to Title', onTap: twoStep('sys.quit', cb.onQuit), accent: COLORS.danger },
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
    this.focus.clear()
    for (const r of this.rows) r.btn.disarm()
  }
  get visible(): boolean {
    return this.view.visible
  }

  /** Keyboard: ↑/↓ move the focus, Enter picks. Returns true when the key was used. */
  key(code: string): boolean {
    if (code === 'ArrowUp') this.focus.move(0, -1)
    else if (code === 'ArrowDown') this.focus.move(0, 1)
    else if (code === 'Enter' || code === 'NumpadEnter') return this.focus.activate()
    else return false
    return true
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

/** Default-speed choices: every speed step the HUD offers. */
const SPEEDS = [1, 2, 3, 6, 12]
/** Auto-start choices: 0 = off, else the countdown in seconds. */
const AUTO_START = [0, 5, 10]
const FX_LEVELS: FxLevel[] = ['full', 'reduced', 'minimal']

export class SettingsPanel {
  readonly view = new Container()
  private dim = new Graphics()
  private panel = new Graphics()
  private title = label('', 24, COLORS.textBright, 'bold')
  private tabBtns: UIButton[] = []
  private pages: Container[] = []
  private current = Math.max(0, Math.min(TABS.length - 1, getPref('settings.tab', 0)))
  private PW = 620
  private PH = 560
  private px: number
  private py: number
  private cb: SettingsCallbacks

  // controls whose values/labels must sync on refresh
  private sliders: { s: Slider; v: Text; read: () => number }[] = []
  private toggles: { tg: Toggle; read: () => boolean }[] = []
  private segLang!: SegmentedControl<Lang>
  private segMode!: SegmentedControl<GameMode>
  private segDensity!: SegmentedControl<'full' | 'reduced'>
  private segFx!: SegmentedControl<FxLevel>
  private segSpeed!: SegmentedControl<number>
  private segAuto!: SegmentedControl<number>
  private lblModeLock = label('', 11, COLORS.warn)
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
    this.selectTab(this.current)
    this.view.visible = false
  }

  // --- layout helpers ---
  private rowY(i: number): number {
    return this.py + 110 + i * 52
  }
  /** the left edge of every non-slider control (toggles, segmented choices, buttons). */
  private ctrlX(): number {
    return this.px + 300
  }
  /** A bold row label with an optional dim one-line explanation beneath it. */
  private addRowLabel(page: Container, key: string, fallback: string, y: number, subKey?: string): void {
    const l = label('', 15, COLORS.text, 'bold')
    l.x = this.px + 28
    l.y = y
    page.addChild(l)
    this.relabels.push(() => (l.text = t(key, undefined, fallback)))
    if (subKey) {
      const sub = label('', 11, COLORS.textDim)
      sub.x = this.px + 28
      sub.y = y + 20
      sub.style.wordWrap = true
      sub.style.breakWords = true
      sub.style.wordWrapWidth = this.ctrlX() - this.px - 44
      page.addChild(sub)
      this.relabels.push(() => (sub.text = t(subKey)))
    }
  }
  private addToggle(page: Container, i: number, read: () => boolean, write: (v: boolean) => void, accent?: number): void {
    const tg = new Toggle({ value: read(), accent, onChange: write })
    tg.x = this.ctrlX()
    tg.y = this.rowY(i)
    page.addChild(tg)
    this.toggles.push({ tg, read })
  }

  private buildTabs(): void {
    const segW = 132
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
    const sx = this.ctrlX()
    const sw = 230
    const mk = (i: number, read: () => number, on: (x: number) => void): void => {
      const vlabel = label('', 13, COLORS.textDim)
      const s = new Slider({
        w: sw,
        value: read(),
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
      vlabel.text = Math.round(read() * 100) + '%'
      page.addChild(s, vlabel)
      this.sliders.push({ s, v: vlabel, read })
    }
    const a = (): Readonly<ReturnType<typeof getSettings>['audio']> => getSettings().audio
    this.addRowLabel(page, 'set.master', 'Master', this.rowY(0))
    mk(0, () => a().master, setMasterVolume)
    this.addRowLabel(page, 'set.music', 'Music', this.rowY(1))
    mk(1, () => a().music, setMusicVolume)
    this.addRowLabel(page, 'set.sfx', 'SFX', this.rowY(2))
    mk(2, () => a().sfx, setSfxVolume)
    this.addRowLabel(page, 'set.uiVolume', 'Interface', this.rowY(3))
    mk(3, () => a().ui, (v) => updateSettings('audio', { ui: Math.max(0, Math.min(1, v)) }))

    this.addRowLabel(page, 'set.mute', 'Mute', this.rowY(4))
    this.addToggle(page, 4, () => a().muted, (v) => setMuted(v), COLORS.danger)
    this.addRowLabel(page, 'set.muteInBackground', 'Mute in Background', this.rowY(5), 'set.muteInBackground.sub')
    this.addToggle(page, 5, () => a().muteInBackground, (v) => updateSettings('audio', { muteInBackground: v }))

    this.addRowLabel(page, 'set.sfxDensity', 'Serve Sounds', this.rowY(6), 'set.sfxDensity.sub')
    this.segDensity = new SegmentedControl<'full' | 'reduced'>({
      options: [
        { value: 'full', label: t('set.sfxDensity.full') },
        { value: 'reduced', label: t('set.sfxDensity.reduced') },
      ],
      value: a().sfxDensity,
      segW: 120,
      onChange: (v) => updateSettings('audio', { sfxDensity: v }),
    })
    this.segDensity.x = this.ctrlX()
    this.segDensity.y = this.rowY(6) - 4
    page.addChild(this.segDensity)
    this.relabels.push(() => this.segDensity.relabel((v) => t('set.sfxDensity.' + v)))
  }

  private buildDisplay(): void {
    const page = this.newPage()
    const sx = this.ctrlX()
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
    const a = (): Readonly<ReturnType<typeof getSettings>['a11y']> => getSettings().a11y
    this.addRowLabel(page, 'set.reducedMotion', 'Reduced Motion', this.rowY(0), 'set.reducedMotion.sub')
    this.addToggle(page, 0, () => a().reducedMotion, (v) => setReducedMotion(v))
    this.addRowLabel(page, 'set.screenShake', 'Screen Shake', this.rowY(1), 'set.screenShake.sub')
    this.addToggle(page, 1, () => a().screenShake, (v) => updateSettings('a11y', { screenShake: v }))
    this.addRowLabel(page, 'set.reduceFlashing', 'Reduce Flashing', this.rowY(2), 'set.reduceFlashing.sub')
    this.addToggle(page, 2, () => a().reduceFlashing, (v) => updateSettings('a11y', { reduceFlashing: v }))
    this.addRowLabel(page, 'set.colorblind', 'Colorblind-Safe Colors', this.rowY(3), 'set.colorblind.sub')
    this.addToggle(page, 3, () => a().colorblind, (v) => updateSettings('a11y', { colorblind: v }))
    this.addRowLabel(page, 'set.fxLevel', 'Effects', this.rowY(4), 'set.fxLevel.sub')
    this.segFx = new SegmentedControl<FxLevel>({
      options: FX_LEVELS.map((v) => ({ value: v, label: t('set.fxLevel.' + v) })),
      value: a().fxLevel,
      segW: 88,
      onChange: (v) => updateSettings('a11y', { fxLevel: v }),
    })
    this.segFx.x = this.ctrlX()
    this.segFx.y = this.rowY(4) - 4
    page.addChild(this.segFx)
    this.relabels.push(() => this.segFx.relabel((v) => t('set.fxLevel.' + v)))
  }

  private buildGameplay(): void {
    const page = this.newPage()
    const g = (): Readonly<ReturnType<typeof getSettings>['gameplay']> => getSettings().gameplay
    this.addRowLabel(page, 'set.defaultSpeed', 'Default Speed', this.rowY(0))
    this.segSpeed = new SegmentedControl<number>({
      options: SPEEDS.map((n) => ({ value: n, label: n + '×' })),
      value: g().defaultSpeed,
      segW: 50,
      gap: 4,
      onChange: (n) => setDefaultSpeed(n),
    })
    this.segSpeed.x = this.ctrlX()
    this.segSpeed.y = this.rowY(0) - 4
    page.addChild(this.segSpeed)

    this.addRowLabel(page, 'set.autoStart', 'Auto-Start Next Wave', this.rowY(1), 'set.autoStart.sub')
    this.segAuto = new SegmentedControl<number>({
      options: AUTO_START.map((n) => ({ value: n, label: n ? t('set.autoStart.sec', { n }) : t('set.autoStart.off') })),
      value: g().autoStartWave ? g().autoStartDelay : 0,
      segW: 70,
      gap: 4,
      onChange: (n) => updateSettings('gameplay', n ? { autoStartWave: true, autoStartDelay: n } : { autoStartWave: false }),
    })
    this.segAuto.x = this.ctrlX()
    this.segAuto.y = this.rowY(1) - 4
    page.addChild(this.segAuto)
    this.relabels.push(() =>
      this.segAuto.relabel((n) => (n ? t('set.autoStart.sec', { n }) : t('set.autoStart.off'))),
    )

    this.addRowLabel(page, 'set.confirmSell', 'Confirm Before Selling', this.rowY(2), 'set.confirmSell.sub')
    this.addToggle(page, 2, () => g().confirmSell, (v) => updateSettings('gameplay', { confirmSell: v }))
    this.addRowLabel(page, 'set.pauseOnBlur', 'Pause When Unfocused', this.rowY(3), 'set.pauseOnBlur.sub')
    this.addToggle(page, 3, () => g().pauseOnBlur, (v) => updateSettings('gameplay', { pauseOnBlur: v }))
    this.addRowLabel(page, 'set.tooltips', 'Tooltips', this.rowY(4))
    this.addToggle(page, 4, () => g().tooltips, (v) => setTooltips(v))
    this.addRowLabel(page, 'set.showHotkeys', 'Hotkey Badges', this.rowY(5), 'set.showHotkeys.sub')
    this.addToggle(page, 5, () => g().showHotkeys, (v) => updateSettings('gameplay', { showHotkeys: v }))

    this.addRowLabel(page, 'set.replayTut', 'Tutorial', this.rowY(6))
    this.btnReplay = new UIButton({ w: 180, h: 34, accent: COLORS.data, onTap: () => this.cb.onReplayTutorial() })
    this.btnReplay.x = this.ctrlX()
    this.btnReplay.y = this.rowY(6) - 6
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
    setPref('settings.tab', i)
    this.pages.forEach((p, idx) => (p.visible = idx === i))
    this.tabBtns.forEach((b, idx) => b.setActive(idx === i))
  }

  /** Keyboard: [ / ] (and ←/→) cycle the tabs. Returns true when the key was used. */
  key(code: string): boolean {
    const step = code === 'BracketLeft' || code === 'ArrowLeft' ? -1 : code === 'BracketRight' || code === 'ArrowRight' ? 1 : 0
    if (!step) return false
    this.selectTab((this.current + step + TABS.length) % TABS.length)
    return true
  }

  private doReset(): void {
    resetToDefaults()
    this.syncControls()
  }

  /** Pull live store values into the controls (after external changes / reset). */
  private syncControls(): void {
    const s = getSettings()
    for (const sl of this.sliders) {
      sl.s.setValue(sl.read())
      sl.v.text = Math.round(sl.read() * 100) + '%'
    }
    for (const tg of this.toggles) tg.tg.setValue(tg.read())
    this.segDensity.setValue(s.audio.sfxDensity)
    this.segFx.setValue(s.a11y.fxLevel)
    this.segSpeed.setValue(s.gameplay.defaultSpeed)
    this.segAuto.setValue(s.gameplay.autoStartWave ? s.gameplay.autoStartDelay : 0)
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
