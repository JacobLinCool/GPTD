/**
 * ui/uiSound.ts — the interface-sound sink (hover / click / toggle / denied …).
 *
 * Widgets and the shell call `uiSound(id)` without knowing anything about the
 * audio engine; the Game wires ONE sink (`setUiSound`) to whatever the engine
 * exposes for its UI bus. With no sink installed every call is a silent no-op,
 * so headless tests and the sim never depend on audio.
 */

/** The interface cue vocabulary (all routed to the UI bus / UI volume). */
export type UiSoundId =
  | 'hover'
  | 'click'
  | 'toggle'
  | 'tick'
  | 'denied'
  | 'open'
  | 'close'
  | 'speed'
  | 'pause'
  | 'unpause'
  | 'arm'
  | 'countdown'

export interface UiSoundOpts {
  /** toggle: the new state. */
  on?: boolean
  /** slider tick: the 0..1 value (pitch). */
  value?: number
  /** speed cue: the new speed multiplier. */
  speed?: number
}

type Sink = (id: UiSoundId, opts?: UiSoundOpts) => void

let sink: Sink | null = null
let lastHover = 0
let lastTick = 0

/** Install (or clear) the engine-side sink. */
export function setUiSound(fn: Sink | null): void {
  sink = fn
}

/** Fire one interface cue. Hover and slider ticks are rate-limited so sweeps never buzz. */
export function uiSound(id: UiSoundId, opts?: UiSoundOpts): void {
  if (!sink) return
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (id === 'hover') {
    if (now - lastHover < 40) return
    lastHover = now
  } else if (id === 'tick') {
    if (now - lastTick < 30) return
    lastTick = now
  }
  try {
    sink(id, opts)
  } catch {
    /* audio must never break the UI */
  }
}
