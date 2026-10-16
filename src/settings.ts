/**
 * SettingsStore — the single source of truth for player preferences.
 *
 * Design: docs/SYSTEM-MENU.md §7. One namespaced localStorage blob holds the
 * NEW preferences (audio volumes, accessibility, gameplay); language and display
 * mode keep their existing dedicated keys (`gptd_lang` / `gptd_mode`) owned by
 * `i18n` / `mode`, which this module re-exports so callers have ONE API surface
 * and never touch raw keys.
 *
 * Consumers READ the store (e.g. `AudioEngine` initial gains, `world` reduced
 * motion, `Game` tooltips/default-speed); the UI WRITES via the typed setters.
 * Every write persists and notifies subscribers.
 */

// --- façade: language + display mode live in their own modules (decision #3) ---
export { getLang, setLang, cycleLang, LANGS, LANG_LABEL, onLangChange } from './i18n'
export type { Lang } from './i18n'
export { getMode, setMode, isExpert, MODES } from './mode'
export type { GameMode } from './mode'

/**
 * Volume sliders are 0..1 positions, not gains: the mixer (audio/mixer.ts) maps each
 * through a perceptual taper (`taper`, half-way ≈ −12 dB) times its bus scale
 * (`MIX_SCALE`).
 */
export interface AudioSettings {
  /** master volume, 0..1 slider. */
  master: number
  /** music volume, 0..1 slider. */
  music: number
  /** sound-effect volume, 0..1 slider; it also drives the alert and ambience buses. */
  sfx: number
  /** interface sounds (hover / click / toggle), 0..1 slider. */
  ui: number
  muted: boolean
  /** silence everything while the tab is hidden / unfocused. */
  muteInBackground: boolean
  /** 'full' = every clean serve chimes; 'reduced' = routine serves are thinned so failures stand out. */
  sfxDensity: 'full' | 'reduced'
}
export type FxLevel = 'full' | 'reduced' | 'minimal'
export interface A11ySettings {
  /** hold idle/looping animations steady (core pulse, ambient motion, tweens shortened). */
  reducedMotion: boolean
  /** board shake on Trust Core hits / big failures. */
  screenShake: boolean
  /** limit full-screen flashes and rapid blinking. */
  reduceFlashing: boolean
  /** colorblind-safe outcome palette (every outcome also keeps a distinct glyph). */
  colorblind: boolean
  /** particle / popup density: full, reduced, or minimal (outcome glyphs only). */
  fxLevel: FxLevel
}
export interface GameplaySettings {
  /** initial speed multiplier for a new run. */
  defaultSpeed: number
  /** hover tooltips on/off. */
  tooltips: boolean
  /** start the next wave automatically after a short countdown in the build phase. */
  autoStartWave: boolean
  /** countdown length (seconds) for autoStartWave. */
  autoStartDelay: number
  /** require a second click to confirm selling a building. */
  confirmSell: boolean
  /** show hotkey badges on the build bar and action buttons. */
  showHotkeys: boolean
  /** pause automatically when the tab loses focus (never in agent mode). */
  pauseOnBlur: boolean
}
export interface Settings {
  v: number
  audio: AudioSettings
  a11y: A11ySettings
  gameplay: GameplaySettings
}

const KEY = 'gptd_settings'
const VERSION = 2

/** The OS-level reduced-motion preference seeds the default (the player can still override it). */
const osReducedMotion = (): boolean => {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const DEFAULTS: Settings = {
  v: VERSION,
  audio: { master: 0.5, music: 0.5, sfx: 1.0, ui: 0.6, muted: false, muteInBackground: true, sfxDensity: 'full' },
  a11y: { reducedMotion: osReducedMotion(), screenShake: true, reduceFlashing: false, colorblind: false, fxLevel: 'full' },
  gameplay: {
    defaultSpeed: 1,
    tooltips: true,
    autoStartWave: false,
    autoStartDelay: 5,
    confirmSell: true,
    showHotkeys: true,
    pauseOnBlur: false,
  },
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Merge a parsed (possibly partial / older) blob over DEFAULTS, section by section. */
function withDefaults(p: Partial<Settings> | null | undefined): Settings {
  const s = p ?? {}
  return {
    v: VERSION,
    audio: { ...DEFAULTS.audio, ...(s.audio ?? {}) },
    a11y: { ...DEFAULTS.a11y, ...(s.a11y ?? {}) },
    gameplay: { ...DEFAULTS.gameplay, ...(s.gameplay ?? {}) },
  }
}

function load(): Settings {
  try {
    if (typeof localStorage === 'undefined') return withDefaults(null)
    const raw = localStorage.getItem(KEY)
    if (!raw) return withDefaults(null)
    return withDefaults(JSON.parse(raw) as Partial<Settings>)
  } catch {
    return withDefaults(null)
  }
}

let state: Settings = load()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore (private mode / quota) */
  }
}

function commit(): void {
  persist()
  for (const fn of listeners) fn()
}

/** Read-only snapshot of the live settings. */
export function getSettings(): Readonly<Settings> {
  return state
}

/** Subscribe to any settings change; returns an unsubscribe fn. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// --- typed setters (each persists + notifies) ---
export function setMasterVolume(v: number): void {
  state.audio.master = clamp01(v)
  commit()
}
export function setMusicVolume(v: number): void {
  state.audio.music = clamp01(v)
  commit()
}
export function setSfxVolume(v: number): void {
  state.audio.sfx = clamp01(v)
  commit()
}
export function setMuted(b: boolean): void {
  state.audio.muted = b
  commit()
}
export function setReducedMotion(b: boolean): void {
  state.a11y.reducedMotion = b
  commit()
}
export function setDefaultSpeed(n: number): void {
  state.gameplay.defaultSpeed = n
  commit()
}
export function setTooltips(b: boolean): void {
  state.gameplay.tooltips = b
  commit()
}

/** Generic typed patch for any section (persists + notifies). Prefer this for new settings. */
export function updateSettings<K extends 'audio' | 'a11y' | 'gameplay'>(section: K, patch: Partial<Settings[K]>): void {
  state[section] = { ...state[section], ...patch } as Settings[K]
  commit()
}

export function resetToDefaults(): void {
  state = withDefaults(null)
  commit()
}

/** Convenience read for the render layer (avoids importing the whole snapshot). */
export function prefersReducedMotion(): boolean {
  return state.a11y.reducedMotion
}
