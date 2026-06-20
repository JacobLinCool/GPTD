import { getSettings } from '../settings'

/** Music slider (0..1 UI) maps to this peak bus gain — 0.5 → 0.16 (the prior default). */
const MUSIC_SCALE = 0.32

/**
 * Procedural Web Audio engine. Every sound is synthesized at runtime — no asset
 * files. SFX are short oscillator envelopes; music is a scheduled chiptune loop.
 *
 * Three gain buses: `master` (all output) ← `sfxGain` (SFX) and `musicGain`
 * (music). Initial levels come from the SettingsStore; the Settings panel drives
 * them live via setMaster/Music/SfxVolume + setMuted.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private muted = false
  private musicOn = true
  private musicTimer: number | null = null
  private step = 0
  private nextNoteTime = 0
  // cached UI-scale volumes (so mute can restore master without re-reading).
  private masterVol = 0.5
  private musicVol = 0.5
  private sfxVol = 1

  /** Create/resume the context. Must be called from a user gesture. */
  resume(): void {
    try {
      if (!this.ctx) {
        const s = getSettings().audio
        this.masterVol = s.master
        this.musicVol = s.music
        this.sfxVol = s.sfx
        this.muted = s.muted
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : this.masterVol
        this.master.connect(this.ctx.destination)
        this.musicGain = this.ctx.createGain()
        this.musicGain.gain.value = this.musicVol * MUSIC_SCALE
        this.musicGain.connect(this.master)
        this.sfxGain = this.ctx.createGain()
        this.sfxGain.gain.value = this.sfxVol
        this.sfxGain.connect(this.master)
        this.musicOn = this.musicVol > 0
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      if (this.musicOn && this.musicTimer === null) this.startMusic()
    } catch {
      /* audio unavailable (e.g. headless) — ignore */
    }
  }

  get isMuted(): boolean {
    return this.muted
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  /** Settings ▸ Audio — drive the gain buses live. Volumes are 0..1 UI scale. */
  setMuted(b: boolean): void {
    this.muted = b
    if (this.master) this.master.gain.value = b ? 0 : this.masterVol
  }
  setMasterVolume(v: number): void {
    this.masterVol = v
    if (this.master) this.master.gain.value = this.muted ? 0 : v
  }
  setMusicVolume(v: number): void {
    this.musicVol = v
    this.musicOn = v > 0
    if (this.musicGain) this.musicGain.gain.value = v * MUSIC_SCALE
    if (this.musicOn) this.startMusic()
    else this.stopMusic()
  }
  setSfxVolume(v: number): void {
    this.sfxVol = v
    if (this.sfxGain) this.sfxGain.gain.value = v
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    gain = 0.3,
    when = 0,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.sfxGain || this.muted) return
    const t = this.ctx.currentTime + when
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.sfxGain)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private noise(dur: number, gain = 0.2, when = 0, hp = 400): void {
    if (!this.ctx || !this.sfxGain || this.muted) return
    const t = this.ctx.currentTime + when
    const len = Math.floor(this.ctx.sampleRate * dur)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = gain
    const filt = this.ctx.createBiquadFilter()
    filt.type = 'highpass'
    filt.frequency.value = hp
    src.connect(filt)
    filt.connect(g)
    g.connect(this.sfxGain)
    src.start(t)
  }

  private arp(freqs: number[], step: number, dur: number, type: OscillatorType, gain: number): void {
    freqs.forEach((f, i) => this.tone(f, dur, type, gain, i * step))
  }

  // --- game cues ---
  place(): void {
    this.tone(330, 0.07, 'square', 0.25)
    this.tone(495, 0.08, 'square', 0.2, 0.05)
  }
  sell(): void {
    this.tone(400, 0.1, 'triangle', 0.22, 0, 180)
  }
  click(): void {
    this.tone(280, 0.04, 'square', 0.15)
  }
  serveGood(): void {
    this.arp([523, 659, 784], 0.045, 0.09, 'square', 0.16)
  }
  serveBad(): void {
    this.tone(180, 0.16, 'sawtooth', 0.18, 0, 120)
  }
  serveUnsafe(): void {
    this.tone(140, 0.22, 'sawtooth', 0.26, 0, 70)
    this.noise(0.16, 0.12, 0.02)
  }
  cache(): void {
    this.tone(880, 0.05, 'sine', 0.18, 0, 1320)
  }
  leak(): void {
    this.tone(220, 0.2, 'triangle', 0.22, 0, 110)
    this.noise(0.12, 0.1)
  }
  train(): void {
    this.arp([392, 523, 659, 880], 0.05, 0.12, 'triangle', 0.18)
  }
  waveStart(): void {
    this.arp([262, 349, 440], 0.08, 0.18, 'square', 0.2)
  }
  waveClear(): void {
    this.arp([523, 659, 784, 1047], 0.07, 0.18, 'square', 0.2)
  }
  brownout(): void {
    this.tone(120, 0.18, 'sawtooth', 0.16, 0, 90)
  }
  win(): void {
    this.arp([523, 659, 784, 1047, 1319], 0.1, 0.3, 'square', 0.22)
  }
  lose(): void {
    this.arp([440, 349, 262, 196], 0.16, 0.4, 'triangle', 0.24)
  }

  // --- music: a simple looping chiptune ---
  toggleMusic(): boolean {
    this.musicOn = !this.musicOn
    if (this.musicOn) this.startMusic()
    else this.stopMusic()
    return this.musicOn
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return
    this.nextNoteTime = this.ctx.currentTime + 0.1
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 60)
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer)
      this.musicTimer = null
    }
  }

  // C minor pentatonic-ish bassline + sparse lead.
  private static BASS = [130.81, 130.81, 196.0, 174.61, 155.56, 155.56, 196.0, 146.83]
  private static LEAD = [
    523.25, 0, 622.25, 0, 466.16, 0, 392.0, 0, 523.25, 0, 698.46, 0, 622.25, 0, 466.16, 0,
  ]

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicGain || this.muted || !this.musicOn) return
    const spb = 0.26 // seconds per 8th
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      const t = this.nextNoteTime
      const b = AudioEngine.BASS[this.step % AudioEngine.BASS.length]
      this.musicNote(b, t, 0.24, 'triangle', 0.5)
      const lead = AudioEngine.LEAD[this.step % AudioEngine.LEAD.length]
      if (lead > 0) this.musicNote(lead, t, 0.18, 'square', 0.22)
      this.step++
      this.nextNoteTime += spb
    }
  }

  private musicNote(freq: number, t: number, dur: number, type: OscillatorType, gain: number): void {
    if (!this.ctx || !this.musicGain) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g)
    g.connect(this.musicGain)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }
}
