/**
 * Adaptive procedural music — a lookahead 16th-note step sequencer in C minor
 * (the key the game has always been in), so the soundtrack is a live gauge of
 * the datacenter:
 *
 *   title   84 BPM  pad + a sparse FM-bell melody
 *   build  100 BPM  pad + a soft 8th-note arpeggio (calm: planning time)
 *   wave   120 BPM  pad, then bass → kick → hats → snare → lead as load rises
 *   boss   132 BPM  the wave groove with a darker progression, phrygian bass
 *                   passing tones, octave-doubled bass and a tom fill every 4 bars
 *   won     84 BPM  the title theme again after the fanfare
 *   lost            nothing new — the mixer's tape-stop lets the last bar die
 *
 * A danger drone (root + minor second, tremolo) rises with Trust/SLA danger and
 * open hazards on the board. Layers change at bar boundaries (crossfaded), the
 * scene switches at the next bar (with a one-beat tom fill into a wave), and each
 * wave picks its own reproducible progression from a presentation-only LCG
 * seeded by the wave index — the sim RNG is never touched.
 *
 * Works on any BaseAudioContext: the live engine pumps it from a 25 ms timer
 * (`pump(ctx.currentTime)`), the offline check pumps a virtual clock.
 */
import { glide, type Mixer } from './mixer'
import { semi, Voice } from './synth'

export type MusicScene = 'title' | 'build' | 'wave' | 'boss' | 'won' | 'lost'

export interface MusicDrive {
  scene: MusicScene
  /** 0..1 — how hard the platform is working (layers enter as it rises). */
  intensity: number
  /** 0..1 — how close the run is to failing (the tension drone). */
  danger: number
  /** wave index (or 0): picks this wave's progression. */
  seed: number
}

const BPM: Record<MusicScene, number> = { title: 84, build: 100, wave: 120, boss: 132, won: 84, lost: 84 }

interface Chord {
  /** pad voicing, semitones from C4. */
  tones: readonly number[]
  /** bass root, semitones from C3. */
  root: number
}
const CHORD: Record<string, Chord> = {
  Cm: { tones: [0, 3, 7], root: 0 },
  Ab: { tones: [0, 3, 8], root: -4 },
  Eb: { tones: [-2, 3, 7], root: 3 },
  Bb: { tones: [-2, 2, 5], root: -2 },
  Fm: { tones: [0, 5, 8], root: -7 },
  G: { tones: [-1, 2, 7], root: -5 },
}
/** Three 4-bar progressions; the boss always takes the darker B (with its leading-tone G). */
const PROGRESSIONS: readonly (readonly Chord[])[] = [
  [CHORD.Cm, CHORD.Ab, CHORD.Eb, CHORD.Bb],
  [CHORD.Cm, CHORD.Fm, CHORD.Ab, CHORD.G],
  [CHORD.Cm, CHORD.Bb, CHORD.Ab, CHORD.Bb],
]

const C3 = 130.81
const C4 = 261.63
const C5 = 523.25

/** The GPTD motif (semitones from C5, quarter notes over two bars) and its variants. */
const MOTIF = [0, 3, -2, -5, 0, 5, 3, -2]
const MOTIF_INV = [0, -2, 3, 5, 0, -5, -2, 3] // diatonic mirror in the pentatonic
/** Driving 8th-note bass line (offsets from the chord root) and its accents. */
const BASS_LINE = [0, 0, 12, 0, 0, 0, 7, 0]
const BASS_ACC = [1, 0.55, 0.8, 0.55, 0.9, 0.55, 0.8, 0.6]
const FILL_TOMS = [196, 174.6, 146.8, 130.8]

type LayerId = 'pad' | 'arp' | 'bell' | 'bass' | 'drums' | 'lead'
const LAYERS: readonly LayerId[] = ['pad', 'arp', 'bell', 'bass', 'drums', 'lead']
/** Wave-scene entry thresholds (intensity) for each groove layer. */
const ENTER = { bass: 0.15, kick: 0.3, hats: 0.5, lead: 0.55, snare: 0.7, busyHats: 0.8, extraKick: 0.85 }
const HYST = 0.04

/** A small presentation-only LCG (never the sim RNG). */
function lcg(seed: number): () => number {
  let x = (seed * 2654435761 + 0x9e3779b9) >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 4294967296
  }
}

export class MusicDirector {
  private drive: MusicDrive = { scene: 'title', intensity: 0, danger: 0, seed: 0 }
  private scene: MusicScene | null = null
  private bpm = BPM.title
  private nextT = 0
  private step = 0
  private bar = 0
  private prog: readonly Chord[] = PROGRESSIONS[0]
  private progSeed = -1
  private melody = lcg(0)
  private fillBar = false
  private on: Record<string, boolean> = {}
  private layer: Record<LayerId, GainNode>
  private padLP: BiquadFilterNode
  private hatHP: BiquadFilterNode
  private snareBP: BiquadFilterNode
  private leadLP: BiquadFilterNode
  private arpLP: BiquadFilterNode
  private droneGain: GainNode
  private droneLevel = 0
  private droneSrc: OscillatorNode[] = []

  constructor(private readonly mix: Mixer) {
    const ctx = mix.ctx
    const g = (to: AudioNode, v = 0): GainNode => {
      const n = ctx.createGain()
      n.gain.value = v
      n.connect(to)
      return n
    }
    const f = (type: BiquadFilterType, freq: number, q: number, to: AudioNode): BiquadFilterNode => {
      const n = ctx.createBiquadFilter()
      n.type = type
      n.frequency.value = freq
      n.Q.value = q
      n.connect(to)
      return n
    }
    const bus = mix.music
    this.layer = {} as Record<LayerId, GainNode>
    for (const id of LAYERS) this.layer[id] = g(bus)
    this.padLP = f('lowpass', 900, 0.5, this.layer.pad)
    this.arpLP = f('lowpass', 1800, 0.7, this.layer.arp)
    this.leadLP = f('lowpass', 2500, 0.7, this.layer.lead)
    this.hatHP = f('highpass', 7000, 0.7, this.layer.drums)
    this.snareBP = f('bandpass', 1800, 0.8, this.layer.drums)

    // L4 danger drone: persistent root + minor second through a band-pass, 6 Hz tremolo.
    this.droneGain = g(bus)
    const trem = g(f('bandpass', 600, 3, this.droneGain), 0.5)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 6
    const depth = ctx.createGain()
    depth.gain.value = 0.5
    depth.connect(trem.gain)
    lfo.connect(depth)
    for (const hz of [C3, C3 * semi(1)]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = hz
      o.connect(trem)
      o.start()
      this.droneSrc.push(o)
    }
    lfo.start()
    this.droneSrc.push(lfo)
  }

  get currentScene(): MusicScene | null {
    return this.scene
  }

  private get s16(): number {
    return 60 / this.bpm / 4
  }

  /** Update what the music should express; `now` is the audio clock. */
  setDrive(d: MusicDrive, now: number): void {
    this.drive = d
    // leaving silence (first start / after a loss) or entering a loss happens at once
    if (d.scene !== this.scene && (this.scene === null || this.scene === 'lost' || d.scene === 'lost')) {
      this.nextT = now + 0.05
      this.step = 0
    }
    const drone = d.scene === 'wave' || d.scene === 'boss' ? 0.12 * d.danger : 0
    // re-aim the drone only on a meaningful change (danger is smoothed upstream)
    if (Math.abs(drone - this.droneLevel) > 0.006 || (drone === 0 && this.droneLevel !== 0)) {
      this.droneLevel = drone
      glide(this.droneGain.gain, drone, now, 0.6)
    }
  }

  /** Schedule every step that starts before `now + horizon`. */
  pump(now: number, horizon = 0.12): void {
    // clock resync: never schedule a backlog after a mute, a suspend or a throttled timer
    if (this.nextT < now + 0.03) {
      if (now + 0.03 - this.nextT > this.s16) this.step = 0
      this.nextT = now + 0.03
    }
    while (this.nextT < now + horizon) {
      const i = this.step % 16
      if (i === 0) this.onBar(this.nextT)
      this.onStep(i, this.nextT)
      this.nextT += this.s16
      this.step++
    }
  }

  /** Stop the persistent drone sources (engine teardown). */
  dispose(): void {
    for (const o of this.droneSrc) {
      try {
        o.stop()
      } catch {
        /* not started */
      }
    }
    this.droneSrc = []
  }

  private intensity(): number {
    const d = this.drive
    return this.scene === 'boss' ? Math.max(0.6, d.intensity) : d.intensity
  }

  private gate(key: keyof typeof ENTER, v: number): boolean {
    const thr = ENTER[key]
    const on = this.on[key] ? v >= thr - HYST : v >= thr + HYST
    this.on[key] = on
    return on
  }

  private onBar(t: number): void {
    const d = this.drive
    if (d.scene !== this.scene) {
      const from = this.scene
      this.scene = d.scene
      this.bpm = BPM[d.scene]
      this.bar = 0
      this.fillBar = false
      this.on = {}
      if (from === 'lost' || from === null) this.mix.restoreMusic(t)
      this.melody = lcg(d.scene === 'title' || d.scene === 'won' ? 7 : d.seed)
      this.pickProgression(d.seed, true)
    } else if (this.bar % 4 === 0 && d.seed !== this.progSeed) {
      this.pickProgression(d.seed, false)
    }
    const sc = this.scene
    const groove = sc === 'wave' || sc === 'boss'
    const inten = this.intensity()
    const target: Record<LayerId, number> = {
      pad:
        sc === 'title' || sc === 'won' ? 1 : sc === 'build' ? 0.9 : groove ? (sc === 'boss' ? 0.7 : 0.75) : 0,
      arp: sc === 'build' ? 1 : 0,
      bell: sc === 'title' || sc === 'won' ? 1 : 0,
      bass: groove && this.gate('bass', inten) ? 1 : 0,
      drums: groove && this.gate('kick', inten) ? 1 : 0,
      lead: groove && this.gate('lead', inten) ? 1 : 0,
    }
    if (groove) {
      this.gate('hats', inten)
      this.gate('snare', inten)
      this.gate('busyHats', inten)
      this.gate('extraKick', inten)
    }
    for (const id of LAYERS) glide(this.layer[id].gain, target[id], t, 0.4)
    glide(this.padLP.frequency, 900 + 1500 * (groove ? inten : 0.2), t, 0.5)
    if (sc === 'lost') return

    // L0 pad: the bar's chord, two slightly detuned triangles per tone
    const chord = this.prog[this.bar % 4]
    const barLen = 16 * this.s16
    const attack = sc === 'title' || sc === 'won' ? 0.8 : 0.35
    const peak = groove ? 0.05 : 0.045
    for (const n of chord.tones) {
      const v = new Voice(this.mix, this.padLP, { direct: true })
      const env = v.env(this.padLP, t, attack, peak, 0.8, Math.max(0.05, barLen - attack - 0.4))
      const hz = C4 * semi(n)
      v.osc('triangle', hz, t, t + barLen + 0.5, env)
      v.osc('triangle', hz * 1.003, t, t + barLen + 0.5, env)
    }
    // a tom fill into the next bar: every 4th boss bar
    this.fillBar = sc === 'boss' && this.bar % 4 === 3
    this.bar++
  }

  private pickProgression(seed: number, force: boolean): void {
    if (!force && seed === this.progSeed) return
    this.progSeed = seed
    this.prog = this.scene === 'boss' ? PROGRESSIONS[1] : PROGRESSIONS[Math.floor(lcg(seed)() * 3) % 3]
  }

  private onStep(i: number, t: number): void {
    const sc = this.scene
    if (sc === null || sc === 'lost') return
    // the bar index was advanced at step 0; the chord sounding now is bar − 1
    const barNo = this.bar - 1
    const chord = this.prog[((barNo % 4) + 4) % 4]
    const s16 = this.s16
    // a one-beat tom fill into a wave that is about to start
    if (i === 12 && this.drive.scene !== sc && (this.drive.scene === 'wave' || this.drive.scene === 'boss'))
      this.fillBar = true
    if (this.fillBar && i >= 12) this.tom(FILL_TOMS[i - 12], t)

    if (sc === 'title' || sc === 'won') {
      if (i % 4 === 0 && this.melody() < 0.5) {
        const deg = Math.floor(this.melody() * 7)
        const hz = C5 * semi([0, 3, 5, 7, 10][deg % 5] + 12 * Math.floor(deg / 5))
        const v = new Voice(this.mix, this.layer.bell, { direct: true })
        v.fm(hz, 2, hz * 0.8, 1, t, t + 1.6, 1.2, v.env(this.layer.bell, t, 0.004, 0.035, 1.4))
      }
      return
    }
    if (sc === 'build') {
      if (i % 2 === 0) {
        const k = i / 2
        const idx = [0, 1, 2, 1][k % 4]
        const up = barNo % 2 === 1 && k >= 4 ? 12 : 0
        const hz = C5 * semi(chord.tones[idx] + up)
        const v = new Voice(this.mix, this.arpLP, { direct: true })
        v.osc('triangle', hz, t, t + s16 * 2, v.env(this.arpLP, t, 0.006, 0.035, s16 * 1.7))
      }
      return
    }

    // ---- wave / boss groove ----
    const boss = sc === 'boss'
    if (this.on.bass && i % 2 === 0) {
      const k = i / 2
      let n = chord.root + BASS_LINE[k]
      // phrygian Db passing tone at the end of every second boss bar
      if (boss && k === 7 && barNo % 2 === 1) n = chord.root + 1
      const hz = C3 * semi(n)
      const v = new Voice(this.mix, this.layer.bass, { direct: true })
      v.osc('triangle', hz, t, t + s16 * 1.9, v.env(this.layer.bass, t, 0.005, 0.32 * BASS_ACC[k], s16 * 1.6))
      if (boss)
        v.osc(
          'triangle',
          hz * 2,
          t,
          t + s16 * 1.6,
          v.env(this.layer.bass, t, 0.005, 0.12 * BASS_ACC[k], s16 * 1.3),
        )
    }
    if (this.on.kick && (i % 4 === 0 || (this.on.extraKick && i === 14))) {
      const v = new Voice(this.mix, this.layer.drums, { direct: true })
      const k = v.osc(
        'sine',
        150,
        t,
        t + 0.16,
        v.env(this.layer.drums, t, 0.002, i === 14 ? 0.32 : 0.5, 0.13),
      )
      k.frequency.exponentialRampToValueAtTime(45, t + 0.1)
    }
    if (this.on.hats && (i % 4 === 2 || (this.on.busyHats && i % 2 === 1))) {
      const v = new Voice(this.mix, this.hatHP, { direct: true })
      v.noise('white', t, 0.03, v.env(this.hatHP, t, 0.001, i % 4 === 2 ? 0.07 : 0.035, 0.03))
    }
    if (this.on.snare && (i === 4 || i === 12)) {
      const v = new Voice(this.mix, this.snareBP, { direct: true })
      v.noise('white', t, 0.1, v.env(this.snareBP, t, 0.001, 0.22, 0.1))
      v.osc('triangle', 180, t, t + 0.08, v.env(this.layer.drums, t, 0.001, 0.15, 0.06))
    }
    if (this.on.lead) this.lead(i, t, barNo, chord)
  }

  /** L3: the GPTD motif (4 variants) over bars 1–2 of each phrase, chord arpeggio over bars 3–4. */
  private lead(i: number, t: number, barNo: number, chord: Chord): void {
    const s16 = this.s16
    const inPhrase = ((barNo % 4) + 4) % 4
    const variant = Math.floor(barNo / 4) % 4
    let n: number | null = null
    if (inPhrase < 2) {
      const shift = variant === 2 ? 2 : 0 // displaced by an 8th
      if ((i - shift) % 4 === 0 && i >= shift) {
        const q = inPhrase * 4 + (i - shift) / 4
        const src = variant === 1 ? MOTIF_INV : MOTIF
        n = src[q] + (variant === 3 ? 12 : 0)
      }
    } else if (i % 2 === 0) {
      // chord tones (voiced from C4) an octave up, climbing another octave to close the phrase
      const k = i / 2
      n = chord.tones[[0, 1, 2, 1][k % 4]] + (inPhrase === 3 && k >= 4 ? 12 : 0)
    }
    if (n === null) return
    const hz = C5 * semi(n)
    const v = new Voice(this.mix, this.leadLP, { direct: true })
    v.osc('square', hz, t, t + s16 * 1.4, v.env(this.leadLP, t, 0.004, 0.05, s16 * 1.2))
  }

  private tom(hz: number, t: number): void {
    const v = new Voice(this.mix, this.mix.music, { direct: true })
    const o = v.osc('sine', hz, t, t + 0.16, v.env(this.mix.music, t, 0.002, 0.28, 0.13))
    o.frequency.exponentialRampToValueAtTime(hz * 0.6, t + 0.12)
  }
}
