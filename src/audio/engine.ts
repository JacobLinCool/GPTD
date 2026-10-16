/**
 * AudioEngine — the procedural Web Audio layer the game talks to. Every sound
 * is synthesized at runtime (no asset files).
 *
 *   Game ──onEvent(ev, s)──► AudioDirector ──cue / music / ambience──► AudioEngine (sink)
 *        ──update(s, dt, view)─┘                                      ├ CuePlayer (voice pool, stingers, UI)
 *   widgets ──uiSound(id)──────────────────────────────────────────────┤ MusicDirector (adaptive score)
 *   Settings ──subscribe──► levels, density, mute-in-background ───────┤ Ambience (room tone)
 *                                                                      └ Mixer (buses, limiter, ceiling)
 *
 * The AudioContext is created lazily on the first user gesture (`resume`).
 * Settings are read straight from the SettingsStore (master / music / sfx / ui
 * volumes with a perceptual taper, mute, mute-in-background, serve-chime
 * density). While the tab is hidden (or unfocused) and mute-in-background is
 * on, the master fades out and a hidden tab's context is suspended; the music
 * clock resyncs on return, so nothing piles up.
 *
 * `?soundboard` mounts the dev soundboard (src/audio/soundboard.ts).
 */
import type { GameEvent, GameState, Outcome } from '../core/types'
import { OUTCOME_STYLE } from '../outcomes'
import { getSettings, subscribe, type AudioSettings } from '../settings'
import { Ambience, type AmbienceDrive } from './ambience'
import { outcomeCue, type CueId, type CueParams } from './cues'
import { AudioDirector, type AudioSink, type AudioView } from './director'
import { busLevels, Mixer, type BusLevels } from './mixer'
import { MusicDirector, type MusicDrive, type MusicScene } from './music'
import { CuePlayer } from './player'
import { setUiSoundSink, type UiSoundId, type UiSoundOpts } from './ui'

export type { AudioView } from './director'

/** A volume bus the Settings panel can preview. */
export type AudioBus = 'master' | 'music' | 'sfx' | 'ui'

/** Soundboard: pin the music to a scene / drive instead of the game state. */
export interface MusicOverride {
  scene?: MusicScene
  intensity?: number
  danger?: number
  muffle?: boolean
}

/** Music scheduler period (ms) and lookahead (s); a hidden tab's timers are throttled to ≥ 1 s. */
const SCHED_MS = 25
const HORIZON = 0.12
const HIDDEN_HORIZON = 1.25

function soundboardRequested(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    return q.has('soundboard') || q.has('sfx')
  } catch {
    return false
  }
}

export class AudioEngine implements AudioSink {
  private ctx: AudioContext | null = null
  private mix: Mixer | null = null
  private player: CuePlayer | null = null
  private musicDir: MusicDirector | null = null
  private amb: Ambience | null = null
  private suspendTimer: ReturnType<typeof setTimeout> | null = null
  private readonly director = new AudioDirector(this)
  private settings: AudioSettings
  private hidden = false
  private focused = true
  private drive: MusicDrive = { scene: 'title', intensity: 0, danger: 0, seed: 0 }
  private override: MusicOverride | null = null

  constructor() {
    this.settings = { ...getSettings().audio }
    subscribe(() => this.applySettings())
    setUiSoundSink((id, opts) => this.ui(id, opts))
    if (typeof document !== 'undefined') {
      this.hidden = document.hidden
      this.focused = document.hasFocus()
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.hidden
        this.applyBackground()
      })
      window.addEventListener('blur', () => {
        this.focused = false
        this.applyBackground()
      })
      window.addEventListener('focus', () => {
        this.focused = true
        this.applyBackground()
      })
      if (soundboardRequested()) {
        void import('./soundboard')
          .then((m) => m.mountSoundboard(this))
          .catch((err) => console.error('[audio] soundboard failed to load', err))
      }
    }
  }

  // ------------------------------------------------------------ lifecycle --

  /** Create / resume the context. Must be called from a user gesture the first time. */
  resume(): void {
    try {
      if (!this.ctx) this.boot()
      if (this.ctx && this.ctx.state === 'suspended' && !this.inBackground()) void this.ctx.resume()
    } catch {
      /* audio unavailable (e.g. headless) — the game stays silent */
    }
  }

  private boot(): void {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.mix = new Mixer(ctx, this.levels())
    this.player = new CuePlayer(this.mix)
    this.player.policy.density = this.settings.sfxDensity
    this.musicDir = new MusicDirector(this.mix)
    this.amb = new Ambience(this.mix)
    this.musicDir.setDrive(this.effectiveDrive(), ctx.currentTime)
    setInterval(() => this.schedule(), SCHED_MS)
  }

  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || !this.musicDir || ctx.state !== 'running' || !this.audible) return
    this.musicDir.pump(ctx.currentTime, this.hidden ? HIDDEN_HORIZON : HORIZON)
  }

  /** Anything can be heard right now (not muted, not backgrounded, master up). */
  private get audible(): boolean {
    return !this.settings.muted && !this.inBackground() && this.settings.master > 0
  }

  private inBackground(): boolean {
    return this.settings.muteInBackground && (this.hidden || !this.focused)
  }

  private levels(): BusLevels {
    return busLevels(this.settings, this.settings.muted || this.inBackground())
  }

  private applySettings(): void {
    this.settings = { ...getSettings().audio }
    if (this.player) this.player.policy.density = this.settings.sfxDensity
    this.applyBackground()
  }

  private applyBackground(): void {
    const ctx = this.ctx
    if (!ctx || !this.mix) return
    this.mix.setLevels(this.levels(), ctx.currentTime, this.inBackground() ? 0.05 : 0.015)
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer)
      this.suspendTimer = null
    }
    if (this.inBackground() && this.hidden) {
      // let the fade finish, then stop the clock (the scheduler resyncs on return)
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null
        if (this.inBackground() && this.hidden && ctx.state === 'running') void ctx.suspend()
      }, 200)
    } else if (!this.inBackground() && ctx.state === 'suspended') {
      void ctx.resume()
    }
  }

  // ------------------------------------------------------------- game API --

  /** A sim event (call once per event, in emission order). */
  onEvent(ev: GameEvent, s: GameState): void {
    this.director.onEvent(ev, s)
  }

  /** Once per rendered frame, after the frame's events: continuous state + UI edges. */
  update(s: GameState, dt: number, view?: AudioView): void {
    if (this.player) this.player.quietHover = !!(view?.demo || view?.agent)
    this.director.update(s, dt, view)
  }

  /** An interface sound (also reachable from any widget via `uiSound`). */
  ui(id: UiSoundId, opts?: UiSoundOpts): void {
    const cue: CueId = `ui.${id}`
    this.cue(cue, opts)
  }

  /** Settings ▸ Audio: make a bus (or one outcome's cue) audible after a change. */
  preview(target: AudioBus | Outcome = 'master'): void {
    if (target in OUTCOME_STYLE) {
      this.playNow(outcomeCue(OUTCOME_STYLE[target as Outcome].cue), { degree: 2 })
      return
    }
    switch (target) {
      case 'sfx':
        this.playNow('serve.clean', { degree: 2 })
        break
      case 'ui':
        this.playNow('ui.click')
        break
      case 'master':
        this.playNow(this.settings.sfx > 0 ? 'serve.clean' : 'ui.click', { degree: 2 })
        break
      case 'music':
        break // the music is its own preview
    }
  }

  /** The clean-serve streak (presentation-only), e.g. for a combo glow. */
  get streak(): number {
    return this.director.streakCount
  }

  // -------------------------------------------------------- sink (director) --

  now(): number {
    return this.ctx?.currentTime ?? 0
  }

  cue(id: CueId, params: CueParams = {}, at?: number): void {
    if (!this.player || !this.ctx || !this.audible) return
    this.player.play(id, this.ctx.currentTime, params, at)
  }

  music(d: MusicDrive): void {
    this.drive = d
    if (this.musicDir && this.ctx) this.musicDir.setDrive(this.effectiveDrive(), this.ctx.currentTime)
  }

  ambience(d: AmbienceDrive | null): void {
    if (this.amb && this.ctx) this.amb.set(this.override ? null : d, this.ctx.currentTime)
  }

  muffle(on: boolean): void {
    if (this.mix && this.ctx) this.mix.setMuffle(this.override?.muffle ?? on, this.ctx.currentTime)
  }

  tapeStop(): void {
    if (this.mix && this.ctx && this.audible) this.mix.tapeStop(this.ctx.currentTime)
  }

  endFrame(): void {
    if (this.player && this.ctx) this.player.frame(this.ctx.currentTime)
  }

  private effectiveDrive(): MusicDrive {
    const o = this.override
    if (!o) return this.drive
    return {
      scene: o.scene ?? this.drive.scene,
      intensity: o.intensity ?? this.drive.intensity,
      danger: o.danger ?? this.drive.danger,
      seed: this.drive.seed,
    }
  }

  private playNow(id: CueId, params: CueParams = {}): void {
    if (!this.player || !this.ctx || !this.audible) return
    this.player.preview(id, this.ctx.currentTime, params)
  }

  // ------------------------------------------------------ dev soundboard --

  /** Soundboard: audition a cue, bypassing every limit (`policy: true` routes it through the voice pool). */
  audition(id: CueId, params: CueParams = {}, policy = false): boolean {
    this.resume()
    if (!this.player || !this.ctx) return false
    if (policy) return this.player.play(id, this.ctx.currentTime, params)
    this.player.preview(id, this.ctx.currentTime, params)
    return true
  }

  /** Soundboard: pin the music (null = follow the game again). */
  setMusicOverride(o: MusicOverride | null): void {
    this.override = o
    this.music(this.drive)
    if (o?.scene !== 'lost' && this.mix && this.ctx && this.mix.isTaped)
      this.mix.restoreMusic(this.ctx.currentTime)
    if (o?.scene === 'lost') this.tapeStop()
  }

  /** Soundboard: live voice-pool stats. */
  get stats(): { live: number; deferred: number; pendingServes: number; state: string } {
    const p = this.player?.policy
    return {
      live: p?.liveCount ?? 0,
      deferred: p?.deferredCount ?? 0,
      pendingServes: p?.pendingServes ?? 0,
      state: this.ctx?.state ?? 'none',
    }
  }

  /** Soundboard: end a synthetic frame (flush deferred failures). */
  frame(): void {
    this.endFrame()
  }
}
