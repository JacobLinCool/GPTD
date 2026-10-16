/**
 * Voice manager — decides whether a world cue may start NOW, pure TypeScript (no
 * Web Audio) so it is unit-tested in node.
 *
 * Timing is wall-clock (the audio clock), never sim time, so density and
 * loudness stay near-flat from 1× to 12× game speed. Routine success (clean
 * serves, cache hits) is thinned into a texture whose density still conveys
 * throughput — dropped serves are folded into the next chime as a fifth or an
 * octave. Failures (priority ≥ 3) are never silently dropped: a rejected one is
 * deferred, coalesced with its siblings, and flushed a few frames later with a
 * count the recipe turns into weight.
 *
 * Stingers and interface sounds bypass this pool (see player.ts).
 */
import { CUE_SPECS, type CueId, type CueParams, type CueSpec } from './cues'

export type SfxDensity = 'full' | 'reduced'

/** Global cap on live world voices (≈ 120 nodes); the oldest lower-priority voice is stolen. */
export const VOICE_CAP = 24
/** At most this many starts per rendered frame for routine cues (priority < 3). */
export const FRAME_ROUTINE_STARTS = 3
/** Sliding one-second budget for routine starts. */
export const ROUTINE_PER_SEC = 12
/**
 * Sliding one-second budget for failure starts (priority 3–4). At 12× a failing
 * platform offers ~10 failures per wall-second; the excess folds into the next
 * voice of its kind (as weight), so the alarm stays legible instead of a wall.
 * The unsafe alarm (5) and player actions / state cues (6) are exempt.
 */
export const FAILURE_PER_SEC = 3
/** A deferred failure older than this is stale (the board was frozen or the context suspended). */
export const DEFER_STALE_S = 3

/** What the policy grants an admitted cue. */
export interface Grant {
  voiceId: number
  /** start offset from now (s): 0–12 ms, decorrelates the phase of near-simultaneous voices. */
  offset: number
  /** random detune (cents) within the cue's jitter band. */
  detune: number
  /** clean serve only: 1 = add a fifth (≥ 2 serves folded in), 2 = add an octave too (≥ 5). */
  chord: number
  /** how many events this voice stands for (1 = just itself). */
  count: number
  /** live voices to fade out before this one starts (stolen for headroom). */
  steal: number[]
  params: CueParams
}

interface LiveVoice {
  id: number
  cue: CueId
  priority: number
  start: number
  end: number
}

interface Deferred {
  params: CueParams
  count: number
  since: number
}

/** Under 'reduced' density the routine texture is thinned further so failures stand out. */
const REDUCED: Partial<Record<CueId, Partial<CueSpec>>> = {
  'serve.clean': { gapMs: 300, maxVoices: 1 },
  'cache.hit': { gapMs: 450, maxVoices: 1 },
  'model.selfHandle': { gapMs: 600 },
  'guard.catch': { gapMs: 180, maxVoices: 2 },
}

export class VoicePolicy {
  private _density: SfxDensity = 'full'
  private effective: Record<CueId, CueSpec>
  private live: LiveVoice[] = []
  private last = new Map<CueId, number>()
  private frameStarts = 0
  /** start times (s) of routine / budgeted-failure starts within the last second. */
  private routine: number[] = []
  private failures: number[] = []
  private pendingServed = 0
  private deferred = new Map<CueId, Deferred>()
  private seq = 1

  constructor(
    private readonly specs: Record<CueId, CueSpec> = CUE_SPECS,
    private readonly rand: () => number = Math.random,
  ) {
    this.effective = specs
  }

  get density(): SfxDensity {
    return this._density
  }
  set density(d: SfxDensity) {
    if (d === this._density) return
    this._density = d
    if (d === 'full') {
      this.effective = this.specs
      return
    }
    const eff = { ...this.specs }
    for (const [id, patch] of Object.entries(REDUCED) as [CueId, Partial<CueSpec>][])
      eff[id] = { ...eff[id], ...patch }
    this.effective = eff
  }

  /** The cue's policy under the current density. */
  spec(cue: CueId): CueSpec {
    return this.effective[cue]
  }

  /** Live (still sounding) world voices. */
  get liveCount(): number {
    return this.live.length
  }

  /** Clean serves dropped since the last admitted chime. */
  get pendingServes(): number {
    return this.pendingServed
  }

  /** Failures waiting to be flushed. */
  get deferredCount(): number {
    return this.deferred.size
  }

  /** Start of a rendered frame: resets the per-frame routine budget. */
  beginFrame(): void {
    this.frameStarts = 0
  }

  /**
   * Offer a cue at audio time `now` (s). Returns a grant, or null when it is
   * thinned (routine: folded into the next chime) or deferred (failures).
   */
  offer(cue: CueId, now: number, params: CueParams = {}): Grant | null {
    this.expire(now)
    const sp = this.spec(cue)
    const g = this.admit(cue, sp, now, params, 1)
    if (g) return g
    if (cue === 'serve.clean') this.pendingServed++
    else if (sp.priority >= 3) {
      const d = this.deferred.get(cue)
      if (d) {
        d.params = params
        d.count++
      } else this.deferred.set(cue, { params, count: 1, since: now })
    }
    return null
  }

  /** Retry deferred failures (call once per frame); returns the ones admitted now. */
  flush(now: number): { cue: CueId; grant: Grant }[] {
    if (!this.deferred.size) return []
    this.expire(now)
    const out: { cue: CueId; grant: Grant }[] = []
    for (const [cue, d] of this.deferred) {
      if (now - d.since > DEFER_STALE_S) {
        this.deferred.delete(cue)
        continue
      }
      const g = this.admit(cue, this.spec(cue), now, d.params, d.count)
      if (g) {
        out.push({ cue, grant: g })
        this.deferred.delete(cue)
      }
    }
    return out
  }

  /** Forget every live voice and pending cue (context reset / run restart). */
  reset(): void {
    this.live.length = 0
    this.last.clear()
    this.routine.length = 0
    this.failures.length = 0
    this.deferred.clear()
    this.pendingServed = 0
    this.frameStarts = 0
  }

  private admit(cue: CueId, sp: CueSpec, now: number, params: CueParams, count: number): Grant | null {
    const last = this.last.get(cue)
    if (last !== undefined && (now - last) * 1000 < sp.gapMs) return null
    let mine = 0
    for (const v of this.live) if (v.cue === cue) mine++
    if (mine >= sp.maxVoices) return null
    const routine = sp.priority < 3
    const budgeted = sp.priority >= 3 && sp.priority < 5
    if (routine && (this.frameStarts >= FRAME_ROUTINE_STARTS || this.routine.length >= ROUTINE_PER_SEC))
      return null
    if (budgeted && this.failures.length >= FAILURE_PER_SEC) return null

    const steal: number[] = []
    if (this.live.length >= VOICE_CAP) {
      let victim = -1
      for (let i = 0; i < this.live.length; i++) {
        const v = this.live[i]
        if (v.priority < sp.priority && (victim < 0 || v.start < this.live[victim].start)) victim = i
      }
      if (victim < 0) return null
      steal.push(this.live[victim].id)
      this.live.splice(victim, 1)
    }

    this.frameStarts++
    if (routine) this.routine.push(now)
    else if (budgeted) this.failures.push(now)
    this.last.set(cue, now)
    const id = this.seq++
    this.live.push({ id, cue, priority: sp.priority, start: now, end: now + sp.lenS })

    let chord = 0
    if (cue === 'serve.clean') {
      const folded = this.pendingServed
      chord = folded >= 5 ? 2 : folded >= 2 ? 1 : 0
      count = folded + 1
      this.pendingServed = 0
    }
    return {
      voiceId: id,
      offset: this.rand() * 0.012,
      detune: sp.jitterCents ? (this.rand() * 2 - 1) * sp.jitterCents : 0,
      chord,
      count,
      steal,
      params,
    }
  }

  private expire(now: number): void {
    let w = 0
    for (let i = 0; i < this.live.length; i++) if (this.live[i].end > now) this.live[w++] = this.live[i]
    this.live.length = w
    prune(this.routine, now - 1)
    prune(this.failures, now - 1)
  }
}

/** Drop the leading (oldest) entries at or before `cutoff` from a sorted time list. */
function prune(times: number[], cutoff: number): void {
  let drop = 0
  while (drop < times.length && times[drop] <= cutoff) drop++
  if (drop) times.splice(0, drop)
}
