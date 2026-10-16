/**
 * CuePlayer — turns a cue request into sound on a Mixer.
 *
 * Three channels:
 *   - world cues (outcomes, saves, actions, state) go through the VoicePolicy
 *     pool: rate-limited, capped, prioritized, coalesced, jittered and panned;
 *   - stingers are sequenced on one channel (a stinger never stacks on another:
 *     it waits for the previous one, briefly, and win / lose cut in at once);
 *   - interface sounds only obey a per-cue minimum gap.
 *
 * Used identically by the live engine and the offline level check, so the
 * measured mix is the shipped mix.
 */
import { boardPan, CUE_SPECS, type CueId, type CueParams, type CueSpec } from './cues'
import type { Mixer } from './mixer'
import { RECIPES } from './recipes'
import { Voice, type VoiceOpts } from './synth'
import { VoicePolicy, type Grant } from './voices'

/** A voice that actually started (the offline check taps and replays these). */
export interface Played {
  cue: CueId
  at: number
  count: number
  params: CueParams
  opts: VoiceOpts
}

/** Longest a stinger waits for the previous one before it plays anyway (s). */
const STINGER_MAX_WAIT = 0.8

/** Coalesced mass failures weigh more: +3 dB per doubling, capped at +4 dB. */
function countLevel(cue: CueId, count: number): number {
  if (count <= 1) return 1
  if (cue === 'serve.leak' || cue === 'serve.unservable' || cue === 'serve.unsafe')
    return Math.min(1.6, Math.sqrt(count))
  return 1
}

export class CuePlayer {
  readonly policy: VoicePolicy
  private voices = new Map<number, Voice>()
  private stingers: Voice[] = []
  private stingerEnd = 0
  private uiLast = new Map<CueId, number>()
  /** suppress hover ticks (demo / agent runs: nobody is pointing). */
  quietHover = false
  /** tap: every voice that starts. */
  onPlay?: (p: Played) => void

  constructor(
    readonly mix: Mixer,
    policy?: VoicePolicy,
  ) {
    this.policy = policy ?? new VoicePolicy()
  }

  /**
   * Request `cue` at audio time `now`. `at` schedules a state cue at an exact
   * future time (heartbeat / cash tick — the caller owns their rhythm), which
   * bypasses the voice pool. Returns whether a voice started.
   */
  play(cue: CueId, now: number, params: CueParams = {}, at?: number): boolean {
    const sp = CUE_SPECS[cue]
    if (sp.group === 'ui') return this.playUi(cue, sp, now, params)
    if (sp.stinger) return this.playStinger(cue, sp, now, params)
    if (at !== undefined) {
      this.render(cue, sp, Math.max(now, at), params, {}, 1)
      return true
    }
    const g = this.policy.offer(cue, now, params)
    if (!g) return false
    this.start(cue, sp, now, g)
    return true
  }

  /** Play a cue immediately, bypassing every limit (settings previews, the soundboard). */
  preview(cue: CueId, now: number, params: CueParams = {}): void {
    this.render(cue, CUE_SPECS[cue], now + 0.01, params, {}, 1)
  }

  /** Re-render a recorded voice exactly (offline analysis: split a mix into layers). */
  replay(p: Played): void {
    this.render(p.cue, CUE_SPECS[p.cue], p.at, p.params, p.opts, p.count)
  }

  /** End of a rendered frame: flush deferred failures, reset the frame budget. */
  frame(now: number): void {
    for (const { cue, grant } of this.policy.flush(now)) this.start(cue, CUE_SPECS[cue], now, grant)
    this.policy.beginFrame()
    if (this.voices.size > 32) for (const [id, v] of this.voices) if (v.end < now) this.voices.delete(id)
  }

  /** Cut every sounding voice (context reset). */
  silence(now: number): void {
    for (const v of this.voices.values()) v.steal(now)
    for (const v of this.stingers) v.steal(now)
    this.voices.clear()
    this.stingers = []
    this.stingerEnd = 0
    this.policy.reset()
  }

  private start(cue: CueId, sp: CueSpec, now: number, g: Grant): void {
    for (const id of g.steal) {
      this.voices.get(id)?.steal(now)
      this.voices.delete(id)
    }
    const params = g.chord || g.count > 1 ? { ...g.params, chord: g.chord, count: g.count } : g.params
    const v = this.render(
      cue,
      sp,
      now + g.offset,
      params,
      { detune: g.detune, level: countLevel(cue, g.count) },
      g.count,
    )
    this.voices.set(g.voiceId, v)
  }

  private playStinger(cue: CueId, sp: CueSpec, now: number, params: CueParams): boolean {
    let t = now
    if (cue === 'win' || cue === 'lose') {
      for (const v of this.stingers) v.steal(now)
      this.stingers = []
    } else {
      t = Math.max(now, Math.min(this.stingerEnd, now + STINGER_MAX_WAIT))
    }
    const v = this.render(cue, sp, t, params, {}, 1)
    this.stingers = this.stingers.filter((s) => s.end > now)
    this.stingers.push(v)
    this.stingerEnd = t + sp.lenS
    return true
  }

  private playUi(cue: CueId, sp: CueSpec, now: number, params: CueParams): boolean {
    if (cue === 'ui.hover' && this.quietHover) return false
    const last = this.uiLast.get(cue)
    if (last !== undefined && (now - last) * 1000 < sp.gapMs) return false
    this.uiLast.set(cue, now)
    this.render(cue, sp, now, params, {}, 1)
    return true
  }

  private render(
    cue: CueId,
    sp: CueSpec,
    t: number,
    params: CueParams,
    opts: VoiceOpts,
    count: number,
  ): Voice {
    let pan = sp.center ? 0 : (params.pan ?? boardPan(params.x))
    if (cue === 'serve.unsafe') pan *= 0.5
    const v = new Voice(this.mix, this.mix.bus(sp.bus), { pan, ...opts })
    RECIPES[cue](v, t, params)
    v.seal()
    if (sp.duck) this.mix.duck(t, sp.duck.depth, sp.duck.dur)
    this.onPlay?.({ cue, at: t, count, params, opts: { pan, ...opts } })
    return v
  }
}
