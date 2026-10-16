/**
 * Interface-sound sink — the one call UI widgets make to sound a control, with
 * no Web Audio dependency (safe to import from any panel / widget / test).
 * The AudioEngine registers itself as the sink; until then calls are no-ops.
 *
 * Who calls what:
 *   UIButton  pointerover (enabled) → 'hover' · pointertap → 'click' (enabled) / 'denied' (disabled)
 *   Toggle    → 'toggle' { on } · SegmentedControl select → 'click'
 *   Slider    drag → 'tick' { value } every 5 % step (the engine rate-limits) ·
 *             commit → AudioEngine.preview(bus) instead
 *   game actions refused (can't afford, tile blocked, model doesn't fit) → 'denied'
 *   Codex bubble message → 'codex' (rate-limited: agent mode narrates every move)
 *   an overlay the Game does not list in its AudioView `panels` → 'open' / 'close'
 * Speed, pause and the panels Game lists in `AudioEngine.update(…, { panels })`
 * are detected from the view state by the engine — do not sound those twice.
 */

export type UiSoundId = 'hover' | 'click' | 'toggle' | 'tick' | 'denied' | 'codex' | 'open' | 'close'

export interface UiSoundOpts {
  /** toggle: the new state. */
  on?: boolean
  /** tick: slider value 0..1 (pitch follows it). */
  value?: number
}

type Sink = (id: UiSoundId, opts?: UiSoundOpts) => void

let sink: Sink | null = null

/** Register the engine (or a test spy); `null` detaches. */
export function setUiSoundSink(fn: Sink | null): void {
  sink = fn
}

/** Sound an interface control. */
export function uiSound(id: UiSoundId, opts?: UiSoundOpts): void {
  sink?.(id, opts)
}
