/**
 * ui/uiSound.ts — the interface-sound call widgets and the shell make
 * (hover / click / toggle / denied / arm / countdown …).
 *
 * A thin re-export of the audio layer's sink (src/audio/ui.ts) so UI code never
 * imports the Web Audio engine: the AudioEngine registers itself as the sink, and
 * with no engine (headless tests, the sim) every call is a silent no-op.
 */
export { uiSound, type UiSoundId, type UiSoundOpts } from '../audio/ui'
