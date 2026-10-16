/**
 * Datacenter ambience — the room tone of the board, on the `amb` bus (follows
 * the SFX slider, far below every cue):
 *
 *   compute hum   two beating saws at 55 / 55.4 Hz, low-passed wider as fleet
 *                 utilization rises, louder with more racks;
 *   fans          looping pink noise through a band-pass, louder as the cooling
 *                 budget fills;
 *   throttling    a slow LFO wobbles the fan band and the hum detunes (strain);
 *   brownout      the hum cuts out (the racks went dark) until power returns.
 *
 * Built once when a run reaches the board, faded out on the title / game over.
 */
import { glide, type Mixer } from './mixer'

export interface AmbienceDrive {
  /** fleet utilization 0..1 (s.utilization; 0 between waves). */
  util: number
  /** server racks on the board. */
  racks: number
  /** cooling load / capacity, 0..1+. */
  cooling: number
  throttling: boolean
  /** a rack is dark (brownout or liquid-cooling gate). */
  dark: boolean
}

interface Graph {
  hum: OscillatorNode[]
  humLP: BiquadFilterNode
  humGain: GainNode
  fan: AudioBufferSourceNode
  fanBP: BiquadFilterNode
  fanGain: GainNode
  lfo: OscillatorNode
  lfoDepth: GainNode
  out: GainNode
}

const q = (v: number, step: number): number => Math.round(v / step) * step

export class Ambience {
  private g: Graph | null = null
  private live = false
  private key = ''
  private stopAt = 0

  constructor(private readonly mix: Mixer) {}

  /** Drive the room tone (`null` = fade out); `t` is the audio clock. */
  set(d: AmbienceDrive | null, t: number): void {
    if (!d) {
      if (this.live && this.g) {
        glide(this.g.out.gain, 0, t, 0.6)
        this.stopAt = t + 3
      }
      this.live = false
      this.key = ''
      if (this.g && this.stopAt && t >= this.stopAt) this.teardown()
      return
    }
    if (!this.g) this.g = this.build(t)
    const g = this.g
    if (!this.live) {
      glide(g.out.gain, 1, t, 0.8)
      this.live = true
      this.stopAt = 0
    }
    const util = Math.max(0, Math.min(1, d.util))
    const cool = Math.max(0, Math.min(1, d.cooling))
    // only touch the params when something audible changed
    const key = `${q(util, 0.05)}|${Math.min(12, d.racks)}|${q(cool, 0.05)}|${+d.throttling}|${+d.dark}`
    if (key === this.key) return
    this.key = key
    glide(g.humLP.frequency, 120 + 900 * util, t, 0.5)
    glide(g.humGain.gain, d.dark ? 0 : 0.015 + 0.04 * Math.min(1, d.racks / 12), t, d.dark ? 0.03 : 0.6)
    glide(g.fanGain.gain, 0.01 + 0.05 * cool, t, 0.8)
    glide(g.lfoDepth.gain, d.throttling ? 300 : 0, t, 0.5)
    for (const o of g.hum) glide(o.detune, d.throttling ? 8 : 0, t, 0.5)
  }

  private build(t: number): Graph {
    const ctx = this.mix.ctx
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(this.mix.amb)

    const humGain = ctx.createGain()
    humGain.gain.value = 0
    humGain.connect(out)
    const humLP = ctx.createBiquadFilter()
    humLP.type = 'lowpass'
    humLP.frequency.value = 120
    humLP.connect(humGain)
    const hum = [55, 55.4].map((hz) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz
      o.connect(humLP)
      o.start(t)
      return o
    })

    const fanGain = ctx.createGain()
    fanGain.gain.value = 0
    fanGain.connect(out)
    const fanBP = ctx.createBiquadFilter()
    fanBP.type = 'bandpass'
    fanBP.frequency.value = 800
    fanBP.Q.value = 0.6
    fanBP.connect(fanGain)
    const fan = ctx.createBufferSource()
    fan.buffer = this.mix.pink
    fan.loop = true
    fan.connect(fanBP)
    fan.start(t)

    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.5
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0
    lfo.connect(lfoDepth)
    lfoDepth.connect(fanBP.frequency)
    lfo.start(t)

    return { hum, humLP, humGain, fan, fanBP, fanGain, lfo, lfoDepth, out }
  }

  private teardown(): void {
    const g = this.g
    if (!g) return
    for (const s of [...g.hum, g.fan, g.lfo]) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    g.out.disconnect()
    this.g = null
    this.stopAt = 0
  }
}
