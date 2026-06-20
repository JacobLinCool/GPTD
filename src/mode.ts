/**
 * Display mode: how much of the simulation the UI exposes.
 *
 * Both modes run the IDENTICAL deterministic simulation — Expert Mode only
 * reveals the full SRE telemetry (hardware rooflines, rack load, live ops
 * strip, wave reports) that Normal Mode keeps tucked away.
 *
 * The mode is chosen on the title screen and locked for the run; the choice
 * persists to localStorage as the default for the next session. `src/sim/**`
 * must never import or branch on this module (see AGENTS.md §2).
 */
export type GameMode = 'normal' | 'expert'
export const MODES: GameMode[] = ['normal', 'expert']

let current: GameMode = 'normal'
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('gptd_mode') : null
  if (saved === 'normal' || saved === 'expert') current = saved
} catch {
  /* ignore */
}

export function getMode(): GameMode {
  return current
}

export function isExpert(): boolean {
  return current === 'expert'
}

export function setMode(m: GameMode): void {
  current = m
  try {
    localStorage.setItem('gptd_mode', m)
  } catch {
    /* ignore */
  }
}
