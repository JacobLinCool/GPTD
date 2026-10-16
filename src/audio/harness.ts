/**
 * Offline level check — renders the SHIPPED mixer, voice policy, recipes and
 * music into OfflineAudioContexts and measures them (ITU-R BS.1770 loudness,
 * sample peak, clipped samples). Used by scripts/audio-check.mjs (headless
 * Chrome, CI-style regression) and by the dev soundboard's "Level check".
 *
 * What it proves:
 *   - the mix hierarchy: every failure cue is louder than a routine clean serve,
 *     the unsafe alarm is the loudest outcome, saves / hovers sit underneath;
 *   - density: through the voice policy the routine bed of a 12× late-game
 *     stream stays within a few LU of the same stream at 1× (only the failures,
 *     which are never dropped, add weight), far under the unmanaged stream, and
 *     nothing clips — not even with every slider at 100 %;
 *   - legibility under load: in that 12× stream (with music), failures land
 *     clearly above the routine bed at their onsets.
 * Browser-only (needs OfflineAudioContext); nothing here runs in the game loop.
 */
import { CUE_IDS, CUE_SPECS, streakDegree, type CueId, type CueParams } from './cues'
import { busLevels, DEFAULT_LEVELS, Mixer, type BusLevels } from './mixer'
import { MusicDirector, type MusicScene } from './music'
import { CuePlayer, type Played } from './player'
import { VoicePolicy } from './voices'

const SR = 48000

export interface CueLevel {
  id: CueId
  peakDb: number
  /** max momentary loudness (400 ms window), LUFS. */
  lufsM: number
}
export interface StreamLevel {
  label: string
  speed: number
  music: boolean
  levels: 'default' | 'max'
  offered: number
  played: number
  /** integrated loudness (gated), LUFS. */
  lufs: number
  peakDb: number
  /** samples at or beyond full scale. */
  clipped: number
  /** median, over failure voices, of failure-layer minus bed-layer (routine + music) loudness in the 100 ms after onset (LU). */
  failureLift: number | null
  /** integrated loudness of the routine bed (+ music) and of the failure layer alone, LUFS. */
  bedLufs: number | null
  failLufs: number | null
  /** failure voices started (each may stand for several coalesced failures). */
  failVoices: number
}
export interface MusicLevel {
  scene: MusicScene
  intensity: number
  danger: number
  lufs: number
  peakDb: number
}
export interface LevelCheck {
  name: string
  pass: boolean
  detail: string
}
export interface LevelReport {
  cues: CueLevel[]
  streams: StreamLevel[]
  music: MusicLevel[]
  checks: LevelCheck[]
  /** optional 16-bit mono renders for audition (name → samples at 48 kHz). */
  wavs?: Record<string, number[]>
}

// ------------------------------------------------------------- metering --

/** BS.1770 K-weighting biquads at 48 kHz (pre-filter shelf + RLB high-pass). */
const K1 = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [-1.69065929318241, 0.73248077421585],
}
const K2 = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] }

function biquad(x: Float32Array, f: { b: number[]; a: number[] }): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  const [b0, b1, b2] = f.b
  const [a1, a2] = f.a
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** Prefix sums of the channel-summed, K-weighted squared signal (index i = samples [0, i)). */
function kPrefix(chans: Float32Array[]): Float64Array {
  const n = chans[0].length
  const sq = new Float64Array(n)
  for (const ch of chans) {
    const k = biquad(biquad(ch, K1), K2)
    for (let i = 0; i < n; i++) sq[i] += k[i] * k[i]
  }
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sq[i]
  return pre
}

const lufsOf = (ms: number): number => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity)

/** Loudness of the window [t, t + dur) (s), LUFS. */
function windowLufs(pre: Float64Array, t: number, dur: number): number {
  const n = pre.length - 1
  const a = Math.max(0, Math.min(n, Math.floor(t * SR)))
  const b = Math.max(a, Math.min(n, Math.floor((t + dur) * SR)))
  return b > a ? lufsOf((pre[b] - pre[a]) / (b - a)) : -Infinity
}

/** Integrated (gated, BS.1770) loudness and max momentary (400 ms) loudness. */
export function loudness(chans: Float32Array[]): { integrated: number; momentaryMax: number } {
  const pre = kPrefix(chans)
  const hop = SR / 10
  const mom: number[] = []
  for (let a = 0; a + 4 * hop <= pre.length - 1; a += hop) mom.push((pre[a + 4 * hop] - pre[a]) / (4 * hop))
  let momentaryMax = -Infinity
  for (const m of mom) momentaryMax = Math.max(momentaryMax, lufsOf(m))
  const abs = mom.filter((m) => lufsOf(m) > -70)
  if (!abs.length) return { integrated: -Infinity, momentaryMax }
  const rel = lufsOf(abs.reduce((acc, v) => acc + v, 0) / abs.length) - 10
  const gated = abs.filter((m) => lufsOf(m) > rel)
  return { integrated: lufsOf(gated.reduce((acc, v) => acc + v, 0) / gated.length), momentaryMax }
}

function peakOf(chans: Float32Array[]): { peakDb: number; clipped: number } {
  let peak = 0
  let clipped = 0
  for (const ch of chans)
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
      if (a >= 1) clipped++
    }
  return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, clipped }
}

const round = (v: number, d = 1): number => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v)

function toWav(chans: Float32Array[], seconds?: number): number[] {
  const n = seconds ? Math.min(chans[0].length, Math.floor(seconds * SR)) : chans[0].length
  const out: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = (chans[0][i] + chans[1][i]) * 0.5
    out[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767)
  }
  return out
}

async function render(
  seconds: number,
  levels: BusLevels,
  build: (m: Mixer) => void,
): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR)
  const m = new Mixer(ctx, levels)
  build(m)
  const buf = await ctx.startRendering()
  return [buf.getChannelData(0), buf.getChannelData(1)]
}

/** Deterministic PRNG for the synthetic event streams (the check is reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --------------------------------------------------------------- scenarios --

/** A late-game board second: what the sim emits per board-second (scaled by game speed). */
export const LATE_GAME_RATES: Partial<Record<CueId, number>> = {
  'serve.clean': 8,
  'cache.hit': 6,
  'guard.catch': 0.8,
  'model.selfHandle': 0.5,
  'serve.late': 0.3,
  'serve.wrong': 0.2,
  'serve.refused': 0.3,
  'serve.leak': 0.1,
  'serve.unsafe': 0.05,
}
const ROUTINE: ReadonlySet<CueId> = new Set(['serve.clean', 'cache.hit', 'guard.catch', 'model.selfHandle'])

/** Representative knobs for rendering a cue on its own. */
const CUE_PARAMS: Partial<Record<CueId, CueParams>> = {
  'serve.clean': { degree: 3 },
  'serve.refused': { by: 'model' },
  deploy: { size: 0.6 },
  upgrade: { size: 0.5 },
  'danger.heartbeat': { intensity: 0.5 },
  'wave.clear': { goodput: 96 },
  lose: { meter: 'trust' },
  'ui.speed': { speed: 6 },
  'ui.toggle': { on: true },
}

async function cueLevel(id: CueId, wavs?: Record<string, number[]>): Promise<CueLevel> {
  const chans = await render(2.6, DEFAULT_LEVELS, (m) => {
    const p = new CuePlayer(m, new VoicePolicy())
    p.preview(id, 0.05, { ...(CUE_PARAMS[id] ?? {}), pan: 0 })
  })
  const { peakDb } = peakOf(chans)
  if (wavs) wavs[`cue_${id}`] = toWav(chans, 2)
  return { id, peakDb: round(peakDb), lufsM: round(loudness(chans).momentaryMax) }
}

async function stream(
  speed: number,
  withMusic: boolean,
  levelsKind: 'default' | 'max',
  wavs?: Record<string, number[]>,
  unmanaged = false,
): Promise<StreamLevel> {
  const seconds = 6
  const levels = levelsKind === 'max' ? busLevels({ master: 1, music: 1, sfx: 1, ui: 1 }) : DEFAULT_LEVELS
  const rand = mulberry32(1234 + speed)
  const played: Played[] = []
  let offered = 0
  const addMusic = (m: Mixer): void => {
    if (!withMusic) return
    const music = new MusicDirector(m)
    music.setDrive({ scene: 'wave', intensity: 0.8, danger: 0.25, seed: 77 }, 0)
    for (let t = 0.2; t < seconds - 0.2; t += 1 / 60) music.pump(t)
  }
  const chans = await render(seconds, levels, (m) => {
    const p = new CuePlayer(m, new VoicePolicy(undefined, rand))
    p.onPlay = (e) => played.push(e)
    addMusic(m)
    const acc: Partial<Record<CueId, number>> = {}
    let streak = 0
    for (let f = 0; f < 60 * (seconds - 0.6); f++) {
      const now = 0.2 + f / 60
      const boardDt = speed / 60
      for (const [id, rate] of Object.entries(LATE_GAME_RATES) as [CueId, number][]) {
        acc[id] = (acc[id] ?? 0) + rate * boardDt
        while ((acc[id] ?? 0) >= 1) {
          acc[id] = (acc[id] ?? 0) - 1
          offered++
          if (id === 'serve.clean') streak++
          else if (!ROUTINE.has(id)) streak = 0
          const params = { x: 64 + rand() * 1152, degree: streakDegree(streak) }
          // unmanaged: every event plays (what the board would sound like without the voice manager)
          if (unmanaged) p.preview(id, now - 0.01, params)
          else p.play(id, now, params)
        }
      }
      p.frame(now)
    }
  })
  const { peakDb, clipped } = peakOf(chans)
  const lu = loudness(chans)

  // Legibility: replay the admitted voices as two layers — the routine bed (+ music)
  // and the failures — and compare them over the 100 ms after each failure onset.
  const fails = played.filter((e) => !ROUTINE.has(e.cue))
  let lift: number | null = null
  let bedLufs: number | null = null
  let failLufs: number | null = null
  if (fails.length && !unmanaged) {
    const replay = (voices: Played[], bedOf?: Played[]) =>
      render(seconds, levels, (m) => {
        const p = new CuePlayer(m)
        for (const e of voices) p.replay(e)
        if (!bedOf) return
        addMusic(m)
        // the music still ducks under the failures it is measured against
        for (const e of bedOf) {
          const d = CUE_SPECS[e.cue].duck
          if (d) m.duck(e.at, d.depth, d.dur)
        }
      })
    const bedChans = await replay(
      played.filter((e) => ROUTINE.has(e.cue)),
      withMusic ? fails : undefined,
    )
    const failChans = await replay(fails)
    bedLufs = round(loudness(bedChans).integrated)
    failLufs = round(loudness(failChans).integrated)
    const bed = kPrefix(bedChans)
    const fail = kPrefix(failChans)
    const diffs = fails
      .map((e) => windowLufs(fail, e.at, 0.1) - windowLufs(bed, e.at, 0.1))
      .sort((a, b) => a - b)
    lift = diffs[Math.floor(diffs.length / 2)]
  }
  const label = `${speed}x${withMusic ? '+music' : ''}${levelsKind === 'max' ? ' @100%' : ''}${unmanaged ? ' unmanaged' : ''}`
  if (wavs) wavs[`stream_${label.replace(/[^a-z0-9]+/gi, '_')}`] = toWav(chans)
  return {
    label,
    speed,
    music: withMusic,
    levels: levelsKind,
    offered,
    played: played.length,
    lufs: round(lu.integrated),
    peakDb: round(peakDb),
    clipped,
    failureLift: lift === null ? null : round(lift),
    bedLufs,
    failLufs,
    failVoices: fails.length,
  }
}

async function musicLevel(
  scene: MusicScene,
  intensity: number,
  danger: number,
  wavs?: Record<string, number[]>,
): Promise<MusicLevel> {
  const seconds = 9
  const chans = await render(seconds, DEFAULT_LEVELS, (m) => {
    const music = new MusicDirector(m)
    music.setDrive({ scene, intensity, danger, seed: 42 }, 0)
    for (let t = 0; t < seconds - 0.3; t += 0.05) music.pump(t)
  })
  const { peakDb } = peakOf(chans)
  if (wavs) wavs[`music_${scene}_${Math.round(intensity * 100)}`] = toWav(chans)
  return { scene, intensity, danger, lufs: round(loudness(chans).integrated), peakDb: round(peakDb) }
}

// ------------------------------------------------------------------ check --

/** Run every render and evaluate the regression checks. */
export async function runLevelCheck(opts: { wav?: boolean } = {}): Promise<LevelReport> {
  const wavs = opts.wav ? ({} as Record<string, number[]>) : undefined
  const cues: CueLevel[] = []
  for (const id of CUE_IDS) cues.push(await cueLevel(id, wavs))
  const streams: StreamLevel[] = []
  for (const sp of [1, 3, 6, 12]) streams.push(await stream(sp, false, 'default', wavs))
  streams.push(await stream(12, false, 'default', wavs, true))
  streams.push(await stream(12, true, 'default', wavs))
  streams.push(await stream(12, true, 'max', wavs))
  const music: MusicLevel[] = []
  for (const [scene, i, d] of [
    ['title', 0, 0],
    ['build', 0.1, 0],
    ['wave', 0.3, 0],
    ['wave', 0.85, 0],
    ['boss', 0.9, 0.8],
  ] as [MusicScene, number, number][])
    music.push(await musicLevel(scene, i, d, wavs))

  const L = (id: CueId): number => cues.find((c) => c.id === id)?.lufsM ?? -Infinity
  const checks: LevelCheck[] = []
  const check = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail })
  }
  const served = L('serve.clean')
  for (const [id, margin] of [
    ['serve.late', 2],
    ['serve.refused', 2],
    ['serve.wrong', 2],
    ['serve.unservable', 3],
    ['serve.leak', 3],
    ['serve.unsafe', 6],
  ] as [CueId, number][])
    check(
      `${id} above a clean serve`,
      L(id) >= served + margin,
      `${L(id)} vs ${served} LUFS (needs +${margin} LU)`,
    )
  const loudestOther = Math.max(
    ...['serve.late', 'serve.wrong', 'serve.refused', 'serve.unservable', 'serve.leak'].map((i) =>
      L(i as CueId),
    ),
  )
  check(
    'unsafe is the loudest outcome',
    L('serve.unsafe') > loudestOther,
    `${L('serve.unsafe')} vs ${loudestOther} LUFS`,
  )
  check('cache hit under a clean serve', L('cache.hit') <= served - 3, `${L('cache.hit')} vs ${served} LUFS`)
  check(
    'saves under a clean serve',
    L('guard.catch') <= served && L('model.selfHandle') <= served,
    `guard ${L('guard.catch')}, self-handle ${L('model.selfHandle')} vs ${served}`,
  )
  check('hover far under a clean serve', L('ui.hover') <= served - 10, `${L('ui.hover')} vs ${served} LUFS`)
  check(
    'no cue peaks above −1 dBFS alone',
    cues.every((c) => c.peakDb <= -1),
    `max ${Math.max(...cues.map((c) => c.peakDb))} dBFS`,
  )
  const managed = streams.filter((s) => !s.label.includes('unmanaged'))
  const s1 = managed.find((s) => s.speed === 1 && !s.music)
  const s12 = managed.find((s) => s.speed === 12 && !s.music)
  const raw12 = streams.find((s) => s.label.includes('unmanaged'))
  if (s1 && s12) {
    const bedGrowth = (s12.bedLufs ?? 0) - (s1.bedLufs ?? 0)
    check(
      'routine bed flat 1×→12× (≤ 3 LU)',
      bedGrowth <= 3,
      `${s1.bedLufs} → ${s12.bedLufs} LUFS (+${round(bedGrowth)} LU)`,
    )
    check(
      'whole mix 1×→12× bounded (≤ 7 LU)',
      s12.lufs - s1.lufs <= 7,
      `${s1.lufs} → ${s12.lufs} LUFS (+${round(s12.lufs - s1.lufs)} LU; failures are never dropped)`,
    )
    if (raw12)
      check(
        'voice manager tames 12× (≥ 6 LU under unmanaged)',
        raw12.lufs - s12.lufs >= 6,
        `${raw12.lufs} unmanaged → ${s12.lufs} LUFS (${raw12.played} → ${s12.played} voices)`,
      )
  }
  check(
    'no clipping in any stream',
    streams.every((s) => s.clipped === 0),
    streams.map((s) => `${s.label}: ${s.clipped}`).join(', '),
  )
  const mixDefault = streams.find((s) => s.music && s.levels === 'default')
  if (mixDefault) {
    check('12× + music headroom at default (≤ −1 dBFS)', mixDefault.peakDb <= -1, `${mixDefault.peakDb} dBFS`)
    check(
      'failures cut through a 12× bed + music (≥ 3 LU)',
      (mixDefault.failureLift ?? -Infinity) >= 3,
      `failures sit +${mixDefault.failureLift} LU over the routine bed + music at their onsets`,
    )
  }
  check(
    'music scenes peak ≤ −1 dBFS',
    music.every((m) => m.peakDb <= -1),
    music.map((m) => `${m.scene}@${m.intensity}: ${m.peakDb}`).join(', '),
  )
  const calm = music.find((m) => m.scene === 'build')
  const busy = music.find((m) => m.scene === 'wave' && m.intensity > 0.5)
  if (calm && busy)
    check(
      'a busy wave is louder than the build pad',
      busy.lufs > calm.lufs,
      `${calm.lufs} → ${busy.lufs} LUFS`,
    )

  return { cues, streams, music, checks, wavs }
}
