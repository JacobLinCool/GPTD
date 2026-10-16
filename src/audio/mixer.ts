/**
 * The mixer: one fixed bus graph per AudioContext (live or offline).
 *
 *   destination ← ceiling ← limiter ← master ← ┬ music → tape → musicLP → musicPause → musicDuck
 *                                              ├ sfx     (routine world cues)
 *                                              ├ alerts  (failures, state cues, stingers)
 *                                              ├ ui      (interface sounds)
 *                                              └ amb     (datacenter ambience)
 *
 * The limiter is a fast compressor (safety net, rarely engaged at default
 * levels); the ceiling is a soft-knee waveshaper whose curve tops out below
 * 0 dBFS, so no sample can clip whatever the slider positions. Every level
 * change is smoothed (setTargetAtTime) — no zipper noise, no pops. Noise
 * sources share two pre-rendered buffers instead of allocating per call.
 */
import type { AudioSettings } from '../settings'
import type { BusId } from './cues'

/** Linear bus gains, post-taper. */
export interface BusLevels {
  master: number
  music: number
  sfx: number
  ui: number
  amb: number
}

/**
 * Calibration: the default slider positions (master 0.5, music 0.5, sfx 1.0,
 * ui 0.6) land on the reference mix that scripts/audio-check.mjs measures.
 */
export const MIX_SCALE: BusLevels = { master: 3.2, music: 1.6, sfx: 0.9, ui: 1.4, amb: 0.35 }

/** Perceptual slider taper: half-way is −12 dB, not −6 dB. */
export const taper = (v: number): number => {
  const c = v < 0 ? 0 : v > 1 ? 1 : v
  return c * c
}

/** Slider settings (+ mute / background state) → bus gains. */
export function busLevels(
  a: Pick<AudioSettings, 'master' | 'music' | 'sfx' | 'ui'>,
  silent = false,
): BusLevels {
  return {
    master: silent ? 0 : MIX_SCALE.master * taper(a.master),
    music: MIX_SCALE.music * taper(a.music),
    sfx: MIX_SCALE.sfx * taper(a.sfx),
    ui: MIX_SCALE.ui * taper(a.ui),
    amb: MIX_SCALE.amb * taper(a.sfx),
  }
}

/** The default-settings reference mix (what the level check measures). */
export const DEFAULT_LEVELS: BusLevels = busLevels({ master: 0.5, music: 0.5, sfx: 1, ui: 0.6 })

const TAPE_MAX_S = 1.2

/** Hold the param's current value at `t`, then cancel what follows (Firefox lacks cancelAndHold). */
export function holdAt(p: AudioParam, t: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }
  if (typeof anyP.cancelAndHoldAtTime === 'function') anyP.cancelAndHoldAtTime(t)
  else {
    const v = p.value
    p.cancelScheduledValues(t)
    p.setValueAtTime(v, t)
  }
}

/** Glide a param toward `v` with time constant `tau` starting at `t`. */
export function glide(p: AudioParam, v: number, t: number, tau = 0.015): void {
  holdAt(p, t)
  p.setTargetAtTime(v, t, tau)
}

function makeNoise(ctx: BaseAudioContext, seconds: number, pink: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < len; i++) {
    // presentation-only randomness (the sim never hears it)
    const w = Math.random() * 2 - 1
    if (!pink) d[i] = w
    else {
      // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
    }
  }
  return buf
}

/** Soft-knee ceiling: identity up to −1 dBFS, tanh knee above, hard bound ≈ −0.3 dBFS. */
function ceilingCurve(n = 4097): Float32Array<ArrayBuffer> {
  const knee = 0.89
  const top = 0.985
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee))
    c[i] = Math.sign(x) * y
  }
  return c
}

/** 3-bit quantizer curve (the "doesn't fit" crunch of an unservable request). */
function crushCurve(): Float32Array<ArrayBuffer> {
  const c = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1
    c[i] = Math.round(x * 3) / 3
  }
  return c
}

export class Mixer {
  readonly ctx: BaseAudioContext
  readonly limiter: DynamicsCompressorNode
  readonly ceiling: WaveShaperNode
  readonly master: GainNode
  /** music volume bus — the music director writes its layers here. */
  readonly music: GainNode
  readonly tape: DelayNode
  readonly musicLP: BiquadFilterNode
  readonly musicPause: GainNode
  readonly musicDuck: GainNode
  readonly sfx: GainNode
  readonly alerts: GainNode
  readonly ui: GainNode
  readonly amb: GainNode
  readonly white: AudioBuffer
  readonly pink: AudioBuffer
  readonly crush: Float32Array<ArrayBuffer>
  private muffled = false
  private taped = false

  constructor(ctx: BaseAudioContext, levels: BusLevels = DEFAULT_LEVELS) {
    this.ctx = ctx
    this.ceiling = ctx.createWaveShaper()
    this.ceiling.curve = ceilingCurve()
    this.ceiling.oversample = 'none'
    this.ceiling.connect(ctx.destination)

    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -6
    this.limiter.knee.value = 4
    this.limiter.ratio.value = 16
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.12
    this.limiter.connect(this.ceiling)

    this.master = this.gain(levels.master, this.limiter)

    this.musicDuck = this.gain(1, this.master)
    this.musicPause = this.gain(1, this.musicDuck)
    this.musicLP = ctx.createBiquadFilter()
    this.musicLP.type = 'lowpass'
    this.musicLP.frequency.value = 18000
    this.musicLP.Q.value = 0.7
    this.musicLP.connect(this.musicPause)
    this.tape = ctx.createDelay(TAPE_MAX_S)
    this.tape.delayTime.value = 0
    this.tape.connect(this.musicLP)
    this.music = this.gain(levels.music, this.tape)

    this.sfx = this.gain(levels.sfx, this.master)
    this.alerts = this.gain(levels.sfx, this.master)
    this.ui = this.gain(levels.ui, this.master)
    this.amb = this.gain(levels.amb, this.master)

    this.white = makeNoise(ctx, 2, false)
    this.pink = makeNoise(ctx, 2, true)
    this.crush = crushCurve()
  }

  private gain(v: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = v
    g.connect(to)
    return g
  }

  bus(id: BusId): GainNode {
    return id === 'ui' ? this.ui : id === 'alerts' ? this.alerts : this.sfx
  }

  /** Smoothly move every bus to new levels (volume sliders, mute, background). */
  setLevels(l: BusLevels, t: number, tau = 0.015): void {
    glide(this.master.gain, l.master, t, tau)
    glide(this.music.gain, l.music, t, tau)
    glide(this.sfx.gain, l.sfx, t, tau)
    glide(this.alerts.gain, l.sfx, t, tau)
    glide(this.ui.gain, l.ui, t, tau)
    glide(this.amb.gain, l.amb, t, tau)
  }

  /** Duck the music under an alert: dip to `depth` quickly, recover after `dur`. */
  duck(t: number, depth: number, dur: number): void {
    const p = this.musicDuck.gain
    holdAt(p, t)
    p.setTargetAtTime(depth, t, 0.012)
    p.setTargetAtTime(1, t + dur, 0.25)
  }

  /** Paused / system menu: the music goes behind glass (low-passed, quieter). */
  setMuffle(on: boolean, t: number): void {
    if (on === this.muffled || this.taped) return
    this.muffled = on
    glide(this.musicLP.frequency, on ? 700 : 18000, t, on ? 0.08 : 0.15)
    glide(this.musicPause.gain, on ? 0.6 : 1, t, 0.1)
  }

  /** Game over: the music slows to a halt like a tape machine losing power. */
  tapeStop(t: number, dur = 1.3): void {
    if (this.taped) return
    this.taped = true
    const n = 64
    const curve = new Float32Array(n)
    // delay d(τ) = τ²/2T ⇒ playback rate 1 − d′(τ) = 1 − τ/T falls linearly to 0.
    for (let i = 0; i < n; i++) {
      const tau = (i / (n - 1)) * dur
      curve[i] = Math.min(TAPE_MAX_S - 0.01, (tau * tau) / (2 * dur))
    }
    holdAt(this.tape.delayTime, t)
    this.tape.delayTime.setValueCurveAtTime(curve, t, dur)
    holdAt(this.musicLP.frequency, t)
    this.musicLP.frequency.exponentialRampToValueAtTime(120, t + dur)
    holdAt(this.musicPause.gain, t)
    this.musicPause.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  }

  /** Undo tape-stop / muffle (a fresh scene begins). */
  restoreMusic(t: number): void {
    if (!this.taped && !this.muffled) return
    this.taped = false
    this.muffled = false
    this.tape.delayTime.cancelScheduledValues(t)
    this.tape.delayTime.setValueAtTime(0, t)
    glide(this.musicLP.frequency, 18000, t, 0.2)
    glide(this.musicPause.gain, 1, t, 0.3)
  }

  get isTaped(): boolean {
    return this.taped
  }
}
