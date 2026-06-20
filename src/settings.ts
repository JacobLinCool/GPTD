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

export interface AudioSettings {
  /** master bus, 0..1 (raw gain). */
  master: number
  /** music bus, 0..1 UI scale (mapped to a 0..0.32 gain). */
  music: number
  /** sfx bus, 0..1 (raw gain). */
  sfx: number
  muted: boolean
}
export interface A11ySettings {
  /** hold idle/looping animations steady (core pulse, etc.). */
  reducedMotion: boolean
}
export interface GameplaySettings {
  /** initial speed multiplier for a new run. */
  defaultSpeed: number
  /** hover tooltips on/off. */
  tooltips: boolean
}
export interface Settings {
  v: number
  audio: AudioSettings
  a11y: A11ySettings
  gameplay: GameplaySettings
}

const KEY = 'gptd_settings'
const VERSION = 1

const DEFAULTS: Settings = {
  v: VERSION,
  audio: { master: 0.5, music: 0.5, sfx: 1.0, muted: false },
  a11y: { reducedMotion: false },
  gameplay: { defaultSpeed: 1, tooltips: true },
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

export function resetToDefaults(): void {
  state = withDefaults(null)
  commit()
}

/** Convenience read for the render layer (avoids importing the whole snapshot). */
export function prefersReducedMotion(): boolean {
  return state.a11y.reducedMotion
}
