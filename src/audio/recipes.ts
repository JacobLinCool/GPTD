/**
 * The sound vocabulary — one procedural recipe per cue (no asset files).
 *
 * Design rules for the seven outcomes (the core teaching promise: you can HEAR
 * which way a request went):
 *   served      consonant, bright pluck; climbs the pentatonic with the clean streak
 *   late        the same pluck family, sagging and closing (+ a tick-tock) — right answer, too slow
 *   wrong       dissonant tritone buzz — the model was not smart enough
 *   unsafe      inharmonic FM ring + growl + crack — the loudest world cue
 *   refused     a polite closed-door "nuh-uh" (+ a shield tick when a guardrail did it)
 *   unservable  falling into the core + a bit-crushed "doesn't fit" crunch
 *   leaked      a whoosh falling into a sub thump at the core (always centered)
 * Saves (cache hit, guardrail catch, model self-handle) are small and subordinate.
 *
 * Every recipe draws on `Voice` (synth.ts); `v.out` is the voice output (panned,
 * weighted, stealable). Music ducking is cue policy (`CUE_SPECS[*].duck`), applied
 * by the player. Levels were calibrated by offline render (scripts/audio-check.mjs).
 */
import { pentaHz, PENTA, type CueId, type CueParams } from './cues'
import { semi, type Voice } from './synth'

export type Recipe = (v: Voice, t: number, p: CueParams) => void

// ---------------------------------------------------------------- outcomes ----

const served: Recipe = (v, t, p) => {
  const f = pentaHz(p.degree ?? 0)
  const lp = v.filt('lowpass', 5200, 0.5, v.out)
  v.osc('triangle', f, t, t + 0.16, v.env(lp, t, 0.004, 0.11, 0.12))
  v.osc('sine', f * 2, t, t + 0.1, v.env(lp, t, 0.002, 0.035, 0.07))
  // serves folded in by the voice manager: a fifth (≥ 2), then an octave (≥ 5)
  const chord = p.chord ?? 0
  if (chord >= 1) v.osc('triangle', f * 1.5, t + 0.006, t + 0.16, v.env(lp, t + 0.006, 0.004, 0.055, 0.12))
  if (chord >= 2) v.osc('triangle', f * 2, t + 0.012, t + 0.17, v.env(lp, t + 0.012, 0.004, 0.045, 0.12))
}

const late: Recipe = (v, t, p) => {
  const f = pentaHz(p.degree ?? 0) * 0.5
  const lp = v.filt('lowpass', 2600, 1.2, v.out)
  lp.frequency.setValueAtTime(2600, t)
  lp.frequency.exponentialRampToValueAtTime(500, t + 0.26)
  const o = v.osc('triangle', f, t, t + 0.32, v.env(lp, t, 0.006, 0.14, 0.24, 0.02))
  o.frequency.setValueAtTime(f, t + 0.03)
  o.frequency.exponentialRampToValueAtTime(f * semi(-5), t + 0.28) // sags a fourth
  // the clock "tick-tock": latency, not correctness
  const hp = v.filt('highpass', 3800, 0.7, v.out)
  v.noise('white', t, 0.012, v.env(hp, t, 0.001, 0.05, 0.012))
  v.noise('white', t + 0.13, 0.012, v.env(hp, t + 0.13, 0.001, 0.035, 0.012))
}

const wrong: Recipe = (v, t) => {
  const lp = v.filt('lowpass', 1500, 1, v.out)
  const g = v.env(lp, t, 0.004, 0.075, 0.15)
  const a = v.osc('square', 196, t, t + 0.2, g)
  const b = v.osc('square', 277.2, t, t + 0.2, g) // a tritone above: wrong
  a.frequency.exponentialRampToValueAtTime(176, t + 0.15)
  b.frequency.exponentialRampToValueAtTime(249, t + 0.15)
}

const unsafe: Recipe = (v, t) => {
  const ring = v.env(v.out, t, 0.003, 0.22, 0.34, 0.03)
  v.fm(740, 1.414, 900, 40, t, t + 0.42, 0.35, ring)
  const lp = v.filt('lowpass', 900, 2, v.out)
  const g2 = v.env(lp, t, 0.005, 0.12, 0.3)
  const s1 = v.osc('sawtooth', 110, t, t + 0.36, g2)
  const s2 = v.osc('sawtooth', 116.5, t, t + 0.36, g2)
  s1.frequency.exponentialRampToValueAtTime(82, t + 0.3)
  s2.frequency.exponentialRampToValueAtTime(87, t + 0.3)
  const bp = v.filt('bandpass', 2400, 2, v.out)
  v.noise('white', t, 0.05, v.env(bp, t, 0.001, 0.22, 0.05))
}

const refused: Recipe = (v, t, p) => {
  const guard = p.by === 'guard'
  const lp = v.filt('lowpass', guard ? 3000 : 2200, 0.7, v.out)
  if (guard) {
    // the guardrail's shield tick in front of the "no"
    const bp = v.filt('bandpass', 3600, 5, v.out)
    v.noise('white', t, 0.03, v.env(bp, t, 0.001, 0.16, 0.03))
  }
  v.osc('sine', guard ? 698.5 : 587.3, t, t + 0.08, v.env(lp, t, 0.004, 0.1, 0.06))
  v.osc('sine', 440, t + 0.085, t + 0.2, v.env(lp, t + 0.085, 0.004, 0.1, 0.1))
  const th = v.osc('sine', 140, t + 0.085, t + 0.2, v.env(v.out, t + 0.085, 0.002, 0.16, 0.08))
  th.frequency.exponentialRampToValueAtTime(60, t + 0.17)
}

const leaked: Recipe = (v, t) => {
  const lp = v.filt('lowpass', 2800, 1.5, v.out)
  lp.frequency.setValueAtTime(2800, t)
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.26)
  v.noise('pink', t, 0.28, v.env(lp, t, 0.01, 0.3, 0.26))
  const k = v.osc('sine', 90, t + 0.2, t + 0.42, v.env(v.out, t + 0.2, 0.003, 0.2, 0.2))
  k.frequency.exponentialRampToValueAtTime(42, t + 0.38)
}

const unservable: Recipe = (v, t, p) => {
  leaked(v, t, p)
  v.osc('square', 98, t, t + 0.12, v.shaper(v.mix.crush, v.env(v.out, t, 0.002, 0.06, 0.09)))
}

// ------------------------------------------------------------------- saves ----

const cacheHit: Recipe = (v, t) => {
  for (const [dt, peak] of [
    [0, 0.05],
    [0.075, 0.018],
  ] as const) {
    const o = v.osc('sine', 1568, t + dt, t + dt + 0.07, v.env(v.out, t + dt, 0.002, peak, 0.06))
    o.frequency.exponentialRampToValueAtTime(2349, t + dt + 0.04)
  }
}

const guardCatch: Recipe = (v, t, p) => {
  const bp = v.filt('bandpass', 3600, 5, v.out)
  v.noise('white', t, 0.045, v.env(bp, t, 0.001, 0.35, 0.045))
  const o = v.osc(
    'square',
    1318.5,
    t,
    t + 0.08,
    v.env(v.filt('lowpass', 4000, 0.7, v.out), t, 0.002, 0.035, 0.06),
  )
  o.frequency.exponentialRampToValueAtTime(988, t + 0.05)
  if (p.archetype === 'generative') {
    // a full guard model ran an inference: a heavier body under the tick
    const b = v.osc('sine', 330, t, t + 0.09, v.env(v.out, t, 0.003, 0.05, 0.07))
    b.frequency.exponentialRampToValueAtTime(247, t + 0.08)
  } else if (p.archetype === 'moderation') {
    // a hosted API: the verdict comes back as a faint echo
    v.noise('white', t + 0.07, 0.03, v.env(bp, t + 0.07, 0.001, 0.12, 0.03))
  }
}

const selfHandle: Recipe = (v, t) => {
  // the model's own alignment handled the attack: a soft open-fifth "shield hum"
  const lp = v.filt('lowpass', 2000, 0.6, v.out)
  v.osc('sine', 392, t, t + 0.14, v.env(lp, t, 0.006, 0.045, 0.12))
  v.osc('sine', 587.3, t + 0.01, t + 0.14, v.env(lp, t + 0.01, 0.006, 0.03, 0.11))
  v.noise('pink', t, 0.06, v.env(v.filt('bandpass', 1200, 1.2, v.out), t, 0.01, 0.06, 0.05))
}

// ---------------------------------------------------------------- actions ----

const build: Recipe = (v, t, p) => {
  if (p.rack === false) {
    // a support building (router / cache / guard / power / cooling): lighter
    const k = v.osc('sine', 240, t, t + 0.09, v.env(v.out, t, 0.002, 0.15, 0.07))
    k.frequency.exponentialRampToValueAtTime(120, t + 0.06)
    v.noise('white', t, 0.01, v.env(v.filt('highpass', 3000, 0.7, v.out), t, 0.001, 0.1, 0.01))
    v.osc(
      'square',
      660,
      t + 0.04,
      t + 0.1,
      v.env(v.filt('lowpass', 2500, 0.7, v.out), t + 0.04, 0.003, 0.045, 0.05),
    )
    return
  }
  const k = v.osc('sine', 160, t, t + 0.12, v.env(v.out, t, 0.002, 0.22, 0.09))
  k.frequency.exponentialRampToValueAtTime(70, t + 0.08)
  v.noise('white', t, 0.012, v.env(v.filt('highpass', 2500, 0.7, v.out), t, 0.001, 0.12, 0.012))
  const lp = v.filt('lowpass', 2500, 0.7, v.out)
  v.osc('square', 330, t + 0.04, t + 0.1, v.env(lp, t + 0.04, 0.003, 0.05, 0.05))
  v.osc('square', 495, t + 0.08, t + 0.15, v.env(lp, t + 0.08, 0.003, 0.045, 0.06))
}

const upgrade: Recipe = (v, t, p) => {
  const sz = p.size ?? 0.5
  const lp = v.filt('lowpass', 600, 4, v.out)
  lp.frequency.setValueAtTime(600, t)
  lp.frequency.exponentialRampToValueAtTime(5000, t + 0.3)
  const o = v.osc('sawtooth', 110 * (1 - sz * 0.4), t, t + 0.4, v.env(lp, t, 0.01, 0.07, 0.25, 0.08))
  o.frequency.exponentialRampToValueAtTime(440 * (1 - sz * 0.3), t + 0.3)
  if (p.liquid) {
    // coolant floods the loop
    const bp = v.filt('bandpass', 900, 0.8, v.out)
    bp.frequency.setValueAtTime(500, t)
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.35)
    v.noise('pink', t, 0.36, v.env(bp, t, 0.15, 0.18, 0.2))
  }
  build(v, t + 0.3, { ...p, rack: true })
}

const deploy: Recipe = (v, t, p) => {
  // "weights loading": a rising filtered sweep whose length and pitch encode
  // model size (bigger = longer, lower), then a lock-in blip
  const sz = p.size ?? 0.5
  const dur = 0.18 + sz * 0.5
  const bp = v.filt('bandpass', 400, 3, v.out)
  bp.frequency.setValueAtTime(300 + (1 - sz) * 300, t)
  bp.frequency.exponentialRampToValueAtTime(3000 - sz * 1200, t + dur)
  v.noise('pink', t, dur, v.env(bp, t, dur * 0.7, 0.35, 0.06))
  const f = 880 * semi(-12 * sz)
  v.osc('triangle', f, t + dur, t + dur + 0.12, v.env(v.out, t + dur, 0.003, 0.1, 0.1))
  v.osc('triangle', f * 1.5, t + dur + 0.05, t + dur + 0.18, v.env(v.out, t + dur + 0.05, 0.003, 0.08, 0.12))
}

const sell: Recipe = (v, t) => {
  const o = v.osc('triangle', 400, t, t + 0.12, v.env(v.out, t, 0.004, 0.12, 0.1))
  o.frequency.exponentialRampToValueAtTime(180, t + 0.1)
  v.osc('sine', 1975, t + 0.06, t + 0.12, v.env(v.out, t + 0.06, 0.002, 0.03, 0.05))
  v.osc('sine', 2637, t + 0.1, t + 0.16, v.env(v.out, t + 0.1, 0.002, 0.025, 0.05))
}

const researchStart: Recipe = (v, t, p) => {
  const notes = p.posttrain ? [261.6, 329.6, 392] : [392, 523.3, 659.3]
  notes.forEach((f, i) =>
    v.osc('triangle', f, t + i * 0.05, t + i * 0.05 + 0.12, v.env(v.out, t + i * 0.05, 0.004, 0.08, 0.1)),
  )
  if (p.posttrain) {
    // the Studio spools a training run up
    const bp = v.filt('bandpass', 400, 2, v.out)
    bp.frequency.setValueAtTime(400, t)
    bp.frequency.exponentialRampToValueAtTime(2000, t + 0.25)
    v.noise('pink', t, 0.26, v.env(bp, t, 0.12, 0.14, 0.12))
  }
}

// ---------------------------------------------------------- state cues ----

const powerDown: Recipe = (v, t) => {
  const lp = v.filt('lowpass', 2000, 2, v.out)
  lp.frequency.setValueAtTime(2000, t)
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.5)
  const o = v.osc('sawtooth', 220, t, t + 0.6, v.env(lp, t, 0.005, 0.16, 0.5))
  o.frequency.exponentialRampToValueAtTime(38, t + 0.5)
}

const powerUp: Recipe = (v, t) => {
  const o = v.osc('sawtooth', 60, t, t + 0.4, v.env(v.filt('lowpass', 1500, 2, v.out), t, 0.01, 0.1, 0.3))
  o.frequency.exponentialRampToValueAtTime(240, t + 0.3)
}

const heartbeat: Recipe = (v, t, p) => {
  const lvl = 0.1 + 0.14 * (p.intensity ?? 0.5)
  for (const [dt, f, gg] of [
    [0, 62, 1],
    [0.17, 50, 0.7],
  ] as const) {
    const o = v.osc('sine', f * 1.6, t + dt, t + dt + 0.16, v.env(v.out, t + dt, 0.004, lvl * gg, 0.13))
    o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.05)
  }
}

const cashTick: Recipe = (v, t) => {
  v.noise('white', t, 0.008, v.env(v.filt('highpass', 5000, 0.7, v.out), t, 0.0005, 0.08, 0.008))
}

const milestone: Recipe = (v, t) => {
  ;[5, 7, 9, 10].forEach((d, i) =>
    v.osc(
      'sine',
      pentaHz(d),
      t + i * 0.035,
      t + i * 0.035 + 0.18,
      v.env(v.out, t + i * 0.035, 0.002, 0.035, 0.16),
    ),
  )
}

// ------------------------------------------------------------- stingers ----

const waveStart =
  (boss: boolean): Recipe =>
  (v, t) => {
    const lp = v.filt('lowpass', 800, 3, v.out)
    lp.frequency.setValueAtTime(800, t)
    lp.frequency.exponentialRampToValueAtTime(6000, t + 0.35)
    const notes = boss ? [130.8, 155.6, 185, 196] : [261.6, 349.2, 440]
    notes.forEach((f, i) =>
      v.osc('square', f, t + i * 0.08, t + i * 0.08 + 0.22, v.env(lp, t + i * 0.08, 0.004, 0.08, 0.2)),
    )
    const tn = t + notes.length * 0.08
    v.noise('white', tn, 0.12, v.env(v.filt('bandpass', 1800, 0.8, v.out), tn, 0.002, 0.25, 0.12))
    if (boss) {
      // timpani drop: the gauntlet beat
      const k = v.osc('sine', 110, t, t + 0.9, v.env(v.out, t, 0.005, 0.32, 0.8))
      k.frequency.exponentialRampToValueAtTime(48, t + 0.7)
    }
  }

const waveClear: Recipe = (v, t, p) => {
  const gp = p.goodput ?? 100
  const lp = v.filt('lowpass', gp >= 70 ? 3500 : 2200, 0.7, v.out)
  ;[523.3, 659.3, 784, 1046.5].forEach((f, i) =>
    v.osc('square', f, t + i * 0.07, t + i * 0.07 + 0.2, v.env(lp, t + i * 0.07, 0.004, 0.07, 0.18)),
  )
  // a clean wave sparkles; a ragged one just resolves
  const shimmer = gp >= 95 ? 8 : gp >= 70 ? 6 : 0
  for (let i = 0; i < shimmer; i++) {
    const tt = t + 0.3 + i * 0.035
    v.osc(
      'sine',
      2093 * semi(PENTA[i % 5] + 12 * Math.floor(i / 5)),
      tt,
      tt + 0.15,
      v.env(v.out, tt, 0.002, 0.025, 0.12),
    )
  }
}

const bell = (v: Voice, notes: number[], t: number, peak = 0.065): void => {
  notes.forEach((f, i) => {
    const tt = t + i * 0.09
    v.fm(f, 3.5, f * 1.2, 1, tt, tt + 1, 0.6, v.env(v.out, tt, 0.002, peak, 0.9))
  })
}

const researchDone: Recipe = (v, t) => bell(v, [784, 1174.7], t)
const minted: Recipe = (v, t) => bell(v, [659.3, 987.8, 1318.5], t)

const incidentBad: Recipe = (v, t) => {
  const lp = v.filt('lowpass', 1800, 1, v.out)
  for (let i = 0; i < 4; i++) {
    const f = i % 2 ? 440 : 660
    v.osc('square', f, t + i * 0.16, t + i * 0.16 + 0.15, v.env(lp, t + i * 0.16, 0.006, 0.07, 0.12, 0.02))
  }
}

const incidentGood: Recipe = (v, t) => {
  ;[784, 1046.5].forEach((f, i) =>
    v.osc('triangle', f, t + i * 0.1, t + i * 0.1 + 0.3, v.env(v.out, t + i * 0.1, 0.004, 0.1, 0.28)),
  )
}

const achievement: Recipe = (v, t) => {
  for (let i = 0; i < 6; i++) {
    const tt = t + i * 0.035
    v.osc('sine', pentaHz(5 + i), tt, tt + 0.2, v.env(v.out, tt, 0.002, 0.04, 0.18))
  }
  bell(v, [784, 1174.7], t + 0.22, 0.055)
}

const win: Recipe = (v, t) => {
  // C minor all game long → a C major resolution (Picardy third)
  const lp = v.filt('lowpass', 3500, 0.7, v.out)
  ;[523.3, 659.3, 784, 1046.5].forEach((f, i) =>
    v.osc('square', f, t + i * 0.09, t + i * 0.09 + 0.22, v.env(lp, t + i * 0.09, 0.004, 0.08, 0.2)),
  )
  const tc = t + 0.4
  for (const f of [261.6, 329.6, 392, 523.3]) {
    v.osc('triangle', f, tc, tc + 1.4, v.env(lp, tc, 0.03, 0.07, 1.1, 0.2))
    v.osc('triangle', f * 1.004, tc, tc + 1.4, v.env(lp, tc, 0.03, 0.04, 1.1, 0.2))
  }
  for (let i = 0; i < 8; i++) {
    const tt = tc + 0.1 + i * 0.05
    v.osc(
      'sine',
      2093 * semi([0, 4, 7, 12][i % 4] + 12 * Math.floor(i / 4)),
      tt,
      tt + 0.16,
      v.env(v.out, tt, 0.002, 0.022, 0.13),
    )
  }
}

const lose: Recipe = (v, t, p) => {
  const lp = v.filt('lowpass', 2200, 0.7, v.out)
  ;[440, 349.2, 261.6, 196].forEach((f, i) =>
    v.osc('triangle', f, t + i * 0.16, t + i * 0.16 + 0.42, v.env(lp, t + i * 0.16, 0.006, 0.11, 0.38)),
  )
  // the meter that ended the run, in its own voice
  const tt = t + 0.72
  if (p.meter === 'trust') {
    // the Trust Core breaks: a sub boom
    const k = v.osc('sine', 70, tt, tt + 0.7, v.env(v.out, tt, 0.004, 0.3, 0.6))
    k.frequency.exponentialRampToValueAtTime(30, tt + 0.6)
    v.noise('pink', tt, 0.5, v.env(v.filt('lowpass', 400, 0.8, v.out), tt, 0.01, 0.25, 0.45))
  } else if (p.meter === 'sla') {
    // the SLA clock runs out: slowing ticks and a final tock
    const hp = v.filt('highpass', 3800, 0.7, v.out)
    for (const dt of [0, 0.22, 0.5]) v.noise('white', tt + dt, 0.012, v.env(hp, tt + dt, 0.001, 0.07, 0.012))
    v.osc('triangle', 196, tt + 0.85, tt + 1.1, v.env(v.out, tt + 0.85, 0.004, 0.1, 0.22))
  } else if (p.meter === 'cash') {
    // bankruptcy: the coins drain away
    ;[1975, 1568, 1318.5, 987.8].forEach((f, i) =>
      v.osc('sine', f, tt + i * 0.09, tt + i * 0.09 + 0.07, v.env(v.out, tt + i * 0.09, 0.002, 0.035, 0.06)),
    )
  }
}

// ------------------------------------------------------------- interface ----

const uiHover: Recipe = (v, t) => {
  v.osc('sine', 2400, t, t + 0.03, v.env(v.out, t, 0.002, 0.018, 0.015))
}

const uiClick: Recipe = (v, t) => {
  const o = v.osc('triangle', 620, t, t + 0.05, v.env(v.out, t, 0.002, 0.09, 0.035))
  o.frequency.exponentialRampToValueAtTime(420, t + 0.035)
  v.noise('white', t, 0.006, v.env(v.filt('highpass', 5000, 0.7, v.out), t, 0.0005, 0.06, 0.006))
}

const uiToggle: Recipe = (v, t, p) => {
  const [a, b] = p.on === false ? [780, 520] : [520, 780]
  v.osc('triangle', a, t, t + 0.05, v.env(v.out, t, 0.002, 0.07, 0.03))
  v.osc('triangle', b, t + 0.045, t + 0.1, v.env(v.out, t + 0.045, 0.002, 0.07, 0.04))
}

const uiTick: Recipe = (v, t, p) => {
  v.osc('sine', 300 + 900 * (p.value ?? 0.5), t, t + 0.02, v.env(v.out, t, 0.002, 0.03, 0.012))
}

const sweep = (v: Voice, t: number, from: number, to: number, a: number, peak: number, d: number): void => {
  const bp = v.filt('bandpass', from, 1.5, v.out)
  bp.frequency.setValueAtTime(from, t)
  bp.frequency.exponentialRampToValueAtTime(to, t + 0.12)
  v.noise('pink', t, 0.14, v.env(bp, t, a, peak, d))
}
const uiOpen: Recipe = (v, t) => sweep(v, t, 500, 3000, 0.06, 0.25, 0.07)
const uiClose: Recipe = (v, t) => sweep(v, t, 3000, 500, 0.02, 0.22, 0.1)

const uiDenied: Recipe = (v, t) => {
  const g = v.env(v.filt('lowpass', 700, 1, v.out), t, 0.003, 0.07, 0.11)
  v.osc('square', 110, t, t + 0.14, g)
  v.osc('square', 104, t, t + 0.14, g) // beating: "no"
}

const uiSpeed: Recipe = (v, t, p) => {
  const f = 440 * Math.pow(2, Math.log2(p.speed ?? 1) / 2)
  v.osc('square', f, t, t + 0.05, v.env(v.filt('lowpass', 3000, 0.7, v.out), t, 0.002, 0.05, 0.04))
}

const twoStep = (v: Voice, t: number, a: number, b: number): void => {
  const lp = v.filt('lowpass', 3000, 0.7, v.out)
  v.osc('triangle', a, t, t + 0.05, v.env(lp, t, 0.002, 0.06, 0.04))
  v.osc('triangle', b, t + 0.05, t + 0.11, v.env(lp, t + 0.05, 0.002, 0.06, 0.05))
}
const uiPause: Recipe = (v, t) => twoStep(v, t, 660, 440)
const uiResume: Recipe = (v, t) => twoStep(v, t, 440, 660)

const uiCodex: Recipe = (v, t) => {
  const bp = v.filt('bandpass', 2000, 2, v.out)
  v.osc('square', 1200, t, t + 0.03, v.env(bp, t, 0.002, 0.08, 0.025))
  v.osc('square', 1600, t + 0.035, t + 0.065, v.env(bp, t + 0.035, 0.002, 0.08, 0.025))
}

export const RECIPES: Record<CueId, Recipe> = {
  'serve.clean': served,
  'serve.late': late,
  'serve.wrong': wrong,
  'serve.unsafe': unsafe,
  'serve.refused': refused,
  'serve.unservable': unservable,
  'serve.leak': leaked,
  'cache.hit': cacheHit,
  'guard.catch': guardCatch,
  'model.selfHandle': selfHandle,
  build,
  upgrade,
  deploy,
  sell,
  'research.start': researchStart,
  'power.down': powerDown,
  'power.up': powerUp,
  'danger.heartbeat': heartbeat,
  'cash.tick': cashTick,
  'streak.milestone': milestone,
  'wave.start': waveStart(false),
  'wave.boss': waveStart(true),
  'wave.clear': waveClear,
  'research.done': researchDone,
  'checkpoint.minted': minted,
  'incident.bad': incidentBad,
  'incident.good': incidentGood,
  achievement,
  win,
  lose,
  'ui.hover': uiHover,
  'ui.click': uiClick,
  'ui.toggle': uiToggle,
  'ui.tick': uiTick,
  'ui.open': uiOpen,
  'ui.close': uiClose,
  'ui.denied': uiDenied,
  'ui.speed': uiSpeed,
  'ui.pause': uiPause,
  'ui.resume': uiResume,
  'ui.codex': uiCodex,
}
