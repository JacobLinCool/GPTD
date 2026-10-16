/**
 * Voice — a tiny node builder for one sound. A recipe or a music note builds its
 * oscillators / envelopes / filters through it; the voice tracks its sources so
 * it can be stolen (faded and stopped early) and disconnects itself once the
 * last source ends. Works on any BaseAudioContext (live or offline).
 */
import type { Mixer } from './mixer'

export const semi = (n: number): number => Math.pow(2, n / 12)
const FLOOR = 0.0001

export interface VoiceOpts {
  /** stereo position −1..1 (0 / unsupported → no panner node). */
  pan?: number
  /** voice output gain (coalesced count weight, preview level …). */
  level?: number
  /** detune (cents) applied to every oscillator of this voice. */
  detune?: number
  /**
   * Write straight into `dest` without an own output gain (music notes: cheaper,
   * never stolen).
   */
  direct?: boolean
}

export class Voice {
  readonly ctx: BaseAudioContext
  /** the voice's output — recipes connect their final stage here. */
  readonly out: AudioNode
  private outGain: GainNode | null = null
  private panner: StereoPannerNode | null = null
  private sources: AudioScheduledSourceNode[] = []
  /** the source that ends last — its `onended` frees the voice. */
  private lastSrc: AudioScheduledSourceNode | null = null
  private endT = 0
  private detune: number

  constructor(
    readonly mix: Mixer,
    dest: AudioNode,
    opts: VoiceOpts = {},
  ) {
    this.ctx = mix.ctx
    this.detune = opts.detune ?? 0
    if (opts.direct) {
      this.out = dest
      return
    }
    const g = this.ctx.createGain()
    let level = opts.level ?? 1
    let to = dest
    const pan = opts.pan ?? 0
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      this.panner = this.ctx.createStereoPanner()
      this.panner.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan
      this.panner.connect(dest)
      to = this.panner
      // the equal-power panner sits 3 dB under a centered (up-mixed mono) voice:
      // compensate so a voice keeps its power wherever it is panned
      level *= Math.SQRT2
    }
    g.gain.value = level
    g.connect(to)
    this.outGain = g
    this.out = g
  }

  /** latest scheduled end time (s). */
  get end(): number {
    return this.endT
  }

  private track(src: AudioScheduledSourceNode, end: number): void {
    this.sources.push(src)
    if (end >= this.endT) {
      this.endT = end
      this.lastSrc = src
    }
  }

  /** An oscillator from `t` to `end` at frequency `f` into `dest`. */
  osc(type: OscillatorType, f: number, t: number, end: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    if (this.detune) o.detune.value = this.detune
    o.connect(dest)
    o.start(t)
    o.stop(end)
    this.track(o, end)
    return o
  }

  /** Exponential AD(H)R envelope gain: silent → `peak` in `a`, hold, decay in `d`. */
  env(dest: AudioNode, t: number, a: number, peak: number, d: number, hold = 0): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(FLOOR, t)
    g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak), t + a)
    if (hold > 0) g.gain.setValueAtTime(Math.max(FLOOR, peak), t + a + hold)
    g.gain.exponentialRampToValueAtTime(FLOOR, t + a + hold + d)
    g.connect(dest)
    return g
  }

  filt(type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    b.connect(dest)
    return b
  }

  /** A slice of the shared white / pink noise buffer, `dur` seconds from `t`. */
  noise(kind: 'white' | 'pink', t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
    const buf = kind === 'pink' ? this.mix.pink : this.mix.white
    const s = this.ctx.createBufferSource()
    s.buffer = buf
    s.connect(dest)
    const len = Math.min(dur + 0.01, buf.duration - 0.02)
    const offset = Math.random() * Math.max(0, buf.duration - len - 0.01)
    s.start(t, offset, len)
    this.track(s, t + len)
    return s
  }

  /** Exponential glide of an AudioParam from its value at `t` to `to` by `t1`. */
  slide(p: AudioParam, from: number, to: number, t: number, t1: number): void {
    p.setValueAtTime(Math.max(FLOOR, from), t)
    p.exponentialRampToValueAtTime(Math.max(FLOOR, to), t1)
  }

  /** FM pair: a sine carrier at `f` whose frequency is modulated at `f × ratio`, index decaying. */
  fm(
    f: number,
    ratio: number,
    index0: number,
    index1: number,
    t: number,
    end: number,
    decay: number,
    dest: AudioNode,
  ): OscillatorNode {
    const car = this.osc('sine', f, t, end, dest)
    const mod = this.ctx.createOscillator()
    mod.frequency.value = f * ratio
    const mi = this.ctx.createGain()
    mi.gain.setValueAtTime(Math.max(FLOOR, index0), t)
    mi.gain.exponentialRampToValueAtTime(Math.max(FLOOR, index1), t + decay)
    mod.connect(mi)
    mi.connect(car.frequency)
    mod.start(t)
    mod.stop(end)
    this.track(mod, end)
    return car
  }

  /** A waveshaper stage (bit-crush etc.). */
  shaper(curve: Float32Array<ArrayBuffer>, dest: AudioNode): WaveShaperNode {
    const ws = this.ctx.createWaveShaper()
    ws.curve = curve
    ws.connect(dest)
    return ws
  }

  /** Finish building: free the output once the last source ends. Returns the end time. */
  seal(): number {
    const g = this.outGain
    const last = this.lastSrc
    if (g && last) {
      last.onended = () => {
        try {
          g.disconnect()
          this.panner?.disconnect()
        } catch {
          /* already disconnected */
        }
      }
    }
    return this.endT
  }

  /** Steal: fade this voice out over ~10 ms and stop its sources. */
  steal(now: number): void {
    if (this.outGain) {
      const p = this.outGain.gain
      p.cancelScheduledValues(now)
      p.setTargetAtTime(0, now, 0.004)
    }
    for (const s of this.sources) {
      try {
        s.stop(now + 0.03)
      } catch {
        /* already stopped */
      }
    }
  }
}
