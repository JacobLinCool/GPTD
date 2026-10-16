import { describe, expect, it } from 'vitest'
import type { GameEvent, Outcome, Tower } from '../src/core/types'
import { boardPan, pentaHz, streakDegree, CUE_SPECS, type CueId, type CueParams } from '../src/audio/cues'
import {
  AudioDirector,
  computeDanger,
  computeIntensity,
  isBossWave,
  modelSize,
  type AudioSink,
  type AudioView,
} from '../src/audio/director'
import type { MusicDrive } from '../src/audio/music'
import {
  FAILURE_PER_SEC,
  FRAME_ROUTINE_STARTS,
  ROUTINE_PER_SEC,
  VOICE_CAP,
  VoicePolicy,
} from '../src/audio/voices'
import { CAMPAIGN_THEMES } from '../src/sim/campaign'
import { INCIDENTS } from '../src/sim/content'
import { createState } from '../src/sim/state'

/** A deterministic policy (no jitter randomness). */
const policy = (): VoicePolicy => new VoicePolicy(undefined, () => 0)

describe('audio/voices — wall-clock voice manager', () => {
  it('enforces a per-cue minimum gap and folds dropped serves into the next chime', () => {
    const p = policy()
    expect(p.offer('serve.clean', 1)).not.toBeNull()
    // six more serves inside the 90 ms gap are thinned, not lost…
    for (let i = 0; i < 6; i++) expect(p.offer('serve.clean', 1.01 + i * 0.005)).toBeNull()
    expect(p.pendingServes).toBe(6)
    p.beginFrame()
    // …the next admitted chime carries them as a chord (≥ 5 folded → fifth + octave)
    const g = p.offer('serve.clean', 1.2)
    expect(g?.chord).toBe(2)
    expect(g?.count).toBe(7)
    expect(p.pendingServes).toBe(0)
  })

  it('caps routine starts per frame and per second, but never budgets failures that way', () => {
    const p = policy()
    const routine: CueId[] = ['serve.clean', 'cache.hit', 'guard.catch', 'model.selfHandle']
    const granted = routine.map((c) => p.offer(c, 5) !== null)
    expect(granted.filter(Boolean).length).toBe(FRAME_ROUTINE_STARTS)
    // a failure in the same full frame still starts
    expect(p.offer('serve.wrong', 5)).not.toBeNull()

    const q = policy()
    let starts = 0
    for (let f = 0; f < 60; f++) {
      q.beginFrame()
      if (q.offer('serve.clean', 10 + f / 60)) starts++
      if (q.offer('cache.hit', 10 + f / 60)) starts++
    }
    expect(starts).toBeLessThanOrEqual(ROUTINE_PER_SEC)
  })

  it('defers and coalesces rejected failures, then flushes them with their count', () => {
    const p = policy()
    expect(p.offer('serve.leak', 2)).not.toBeNull()
    expect(p.offer('serve.leak', 2)).toBeNull()
    expect(p.offer('serve.leak', 2.01, { x: 900 })).toBeNull()
    expect(p.deferredCount).toBe(1)
    expect(p.flush(2.05)).toEqual([]) // still inside the 160 ms gap
    const out = p.flush(2.2)
    expect(out).toHaveLength(1)
    expect(out[0].cue).toBe('serve.leak')
    expect(out[0].grant.count).toBe(2)
    expect(out[0].grant.params.x).toBe(900) // the latest position wins
    expect(p.deferredCount).toBe(0)
  })

  it('budgets failure starts per second, except the unsafe alarm', () => {
    const p = policy()
    const failures: CueId[] = ['serve.late', 'serve.wrong', 'serve.refused', 'serve.leak', 'serve.unservable']
    const ok = failures.map((c) => p.offer(c, 3) !== null)
    expect(ok.filter(Boolean).length).toBe(FAILURE_PER_SEC)
    expect(p.offer('serve.unsafe', 3)).not.toBeNull()
    expect(p.deferredCount).toBe(failures.length - FAILURE_PER_SEC)
    // a second later the budget refills and the deferred failure gets through
    expect(p.flush(4.1).length).toBe(failures.length - FAILURE_PER_SEC)
  })

  it('steals the oldest lower-priority voice when the pool is full', () => {
    const specs = {
      ...CUE_SPECS,
      'cache.hit': { ...CUE_SPECS['cache.hit'], gapMs: 0, maxVoices: 99, lenS: 30 },
    }
    const p = new VoicePolicy(specs, () => 0)
    const ids: number[] = []
    for (let i = 0; i < VOICE_CAP; i++) {
      p.beginFrame()
      ids.push(p.offer('cache.hit', i * 0.1)!.voiceId)
    }
    expect(p.liveCount).toBe(VOICE_CAP)
    p.beginFrame()
    expect(p.offer('cache.hit', 3)).toBeNull() // nothing lower to steal
    const g = p.offer('serve.unsafe', 3)
    expect(g?.steal).toEqual([ids[0]])
  })

  it("thins routine chimes further under 'reduced' density", () => {
    const p = policy()
    p.density = 'reduced'
    expect(p.offer('serve.clean', 1)).not.toBeNull()
    p.beginFrame()
    expect(p.offer('serve.clean', 1.2)).toBeNull() // 300 ms gap
    p.beginFrame()
    expect(p.offer('serve.clean', 1.35)).not.toBeNull()
    p.density = 'full'
    expect(p.spec('serve.clean').gapMs).toBe(CUE_SPECS['serve.clean'].gapMs)
  })

  it('jitters start time and detunes failures within their band', () => {
    const p = new VoicePolicy(undefined, () => 1)
    const g = p.offer('serve.wrong', 1)!
    expect(g.offset).toBeCloseTo(0.012)
    expect(g.detune).toBeCloseTo(CUE_SPECS['serve.wrong'].jitterCents)
    expect(p.offer('serve.clean', 1)!.detune).toBe(0) // the served chime stays in tune
  })
})

describe('audio/cues — pan, pitch, streak', () => {
  it('maps board x to stereo pan around the core', () => {
    expect(boardPan(640)).toBe(0)
    expect(boardPan(64)).toBeCloseTo(-0.6)
    expect(boardPan(1216)).toBeCloseTo(0.6)
    expect(boardPan(5000)).toBeCloseTo(0.6)
    expect(boardPan(undefined)).toBe(0)
  })

  it('climbs the C-minor pentatonic with the streak and caps it', () => {
    expect(pentaHz(0)).toBeCloseTo(523.25)
    expect(pentaHz(5)).toBeCloseTo(1046.5)
    expect(pentaHz(-1)).toBeCloseTo(466.16, 1)
    expect(streakDegree(0)).toBe(0)
    const ds = [1, 3, 7, 15, 31, 63, 1000].map(streakDegree)
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThanOrEqual(ds[i - 1])
    expect(streakDegree(1_000_000)).toBe(9)
  })
})

/** A sink that records what the director asks for. */
class Recorder implements AudioSink {
  t = 10
  cues: { id: CueId; params: CueParams; at?: number }[] = []
  drives: MusicDrive[] = []
  muffled: boolean[] = []
  taped = 0
  now(): number {
    return this.t
  }
  cue(id: CueId, params: CueParams = {}, at?: number): void {
    this.cues.push({ id, params, at })
  }
  music(d: MusicDrive): void {
    this.drives.push(d)
  }
  ambience(): void {}
  muffle(on: boolean): void {
    this.muffled.push(on)
  }
  tapeStop(): void {
    this.taped++
  }
  endFrame(): void {}
  ids(): CueId[] {
    return this.cues.map((c) => c.id)
  }
}

const outcomeEv = (
  outcome: Outcome,
  extra: Partial<Extract<GameEvent, { type: 'outcome' }>> = {},
): GameEvent => ({
  type: 'outcome',
  requestId: 1,
  typeId: 'chat',
  laneId: 0,
  x: 300,
  y: 200,
  outcome,
  cash: 0,
  dTrust: 0,
  dSla: 0,
  ...extra,
})

const RUN: AudioView = { running: true, paused: false, speed: 1 }

describe('audio/director — events → cues', () => {
  it('climbs the served chime with the clean streak and drops to the root on a failure', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'wave'
    for (let i = 0; i < 7; i++) d.onEvent(outcomeEv('served'), s)
    d.onEvent(outcomeEv('sloMiss'), s)
    d.onEvent(outcomeEv('served'), s)
    const degrees = rec.cues.filter((c) => c.id === 'serve.clean').map((c) => c.params.degree)
    expect(degrees.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7].map(streakDegree))
    expect(rec.ids()).toContain('serve.late')
    expect(degrees[7]).toBe(streakDegree(1))
    expect(d.streakCount).toBe(1)
  })

  it('gives every outcome its own cue and tells a guard refusal from a model refusal', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    const all: Outcome[] = ['served', 'sloMiss', 'bad', 'unsafe', 'overRefused', 'unservable', 'leaked']
    for (const o of all) d.onEvent(outcomeEv(o, { refusedBy: o === 'overRefused' ? 'guard' : undefined }), s)
    expect(new Set(rec.ids()).size).toBe(all.length)
    expect(rec.cues.find((c) => c.id === 'serve.refused')?.params.by).toBe('guard')
  })

  it('plays legacy serve/leak events only until the precise outcome vocabulary is seen', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'wave'
    // legacy-only frame: played at the end of the frame
    d.onEvent({ type: 'serve', x: 100, y: 100, kind: 'good', amount: 3 }, s)
    d.onEvent({ type: 'leak', x: 600, y: 300, unsafe: true }, s)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual(['serve.clean', 'serve.unsafe'])
    // a frame with both twins plays once
    rec.cues.length = 0
    d.onEvent({ type: 'serve', x: 100, y: 100, kind: 'bad', amount: 0 }, s)
    d.onEvent(outcomeEv('sloMiss'), s)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual(['serve.late'])
    // from then on legacy events are ignored
    rec.cues.length = 0
    d.onEvent({ type: 'serve', x: 100, y: 100, kind: 'good', amount: 3 }, s)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual([])
  })

  it('sounds a guardrail catch at the guard, but leaves a guard refusal to its outcome', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    const guard = (result: 'caught' | 'overRefused'): GameEvent => ({
      type: 'guard',
      towerId: 3,
      requestId: 9,
      x: 1000,
      y: 300,
      result,
      archetype: 'generative',
    })
    d.onEvent(guard('caught'), s)
    d.onEvent(guard('overRefused'), s)
    expect(rec.cues).toEqual([
      { id: 'guard.catch', params: { x: 1000, archetype: 'generative' }, at: undefined },
    ])
  })

  it('weights a deploy by model size and upgrades by hardware tier', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    expect(modelSize(1)).toBe(0)
    expect(modelSize(3000)).toBeCloseTo(1)
    expect(modelSize(8)).toBeLessThan(modelSize(400))
    d.onEvent({ type: 'upgrade', towerId: 1, hwId: 'hw_edge', x: 0, y: 0 }, s)
    d.onEvent({ type: 'upgrade', towerId: 1, hwId: 'hw_giga', x: 0, y: 0 }, s)
    const [lo, hi] = rec.cues.map((c) => c.params)
    expect(lo.size).toBe(0)
    expect(hi.size).toBe(1)
    expect(hi.liquid).toBe(true)
  })

  it('announces a boss wave, tape-stops on a loss and names the meter', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    const bossIdx = CAMPAIGN_THEMES.findIndex((t) => t.boss)
    s.waveIndex = bossIdx
    expect(isBossWave(s)).toBe(true)
    d.onEvent({ type: 'wave-start', index: bossIdx }, s)
    s.meters.sla = 0
    d.onEvent({ type: 'lose' }, s)
    expect(rec.ids()).toEqual(['wave.boss', 'lose'])
    expect(rec.cues[1].params.meter).toBe('sla')
    expect(rec.taped).toBe(1)
  })

  it('tells a minted checkpoint from finished research', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.derivedModels['drv_1'] = {} as never
    d.onEvent({ type: 'research-done', id: 'inf_batching' }, s)
    d.onEvent({ type: 'research-done', id: 'drv_1' }, s)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual(['research.done', 'checkpoint.minted'])
    // once the sim announces posttrain-done, the legacy twin is ignored
    rec.cues.length = 0
    d.onEvent({ type: 'research-done', id: 'drv_1' }, s)
    d.onEvent({ type: 'posttrain-done', modelId: 'drv_1' }, s)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual(['checkpoint.minted'])
  })
})

describe('audio/director — continuous state', () => {
  const darkRack = { def: { kind: 'server' }, online: false } as unknown as Tower

  it('plays power cues only on brownout transitions, never while the board is frozen', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'wave'
    d.update(s, 1 / 60, RUN)
    s.towers.push(darkRack)
    for (let i = 0; i < 5; i++) d.update(s, 1 / 60, RUN)
    expect(rec.ids().filter((c) => c.startsWith('power.'))).toEqual(['power.down'])
    // the sim's precise event while paused waits for the board to resume
    rec.cues.length = 0
    const paused: AudioView = { running: false, paused: true, speed: 1 }
    d.update(s, 1 / 60, paused)
    d.onEvent({ type: 'brownout', on: false }, s)
    d.update(s, 1 / 60, paused)
    expect(rec.ids().filter((c) => c.startsWith('power.'))).toEqual([])
    d.update(s, 1 / 60, RUN)
    expect(rec.ids().filter((c) => c.startsWith('power.'))).toEqual(['power.up'])
  })

  it('beats a heartbeat under Trust/SLA 30 with hysteresis, only while the wave runs', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'wave'
    const beats = (): number => rec.cues.filter((c) => c.id === 'danger.heartbeat').length
    s.meters.trust = 50
    d.update(s, 1 / 60, RUN)
    expect(beats()).toBe(0)
    s.meters.trust = 20
    d.update(s, 1 / 60, RUN)
    expect(beats()).toBe(1)
    expect(rec.cues.at(-1)?.at).toBeGreaterThan(rec.t)
    s.meters.trust = 33 // inside the hysteresis band: keeps beating
    rec.t += 2
    d.update(s, 1 / 60, RUN)
    expect(beats()).toBe(2)
    s.meters.trust = 36
    rec.t += 2
    d.update(s, 1 / 60, RUN)
    expect(beats()).toBe(2)
    s.meters.trust = 10
    rec.t += 2
    d.update(s, 1 / 60, { running: false, paused: true, speed: 1 })
    expect(beats()).toBe(2)
  })

  it('announces a telegraphed incident once from state when the sim does not emit it', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'build'
    d.update(s, 1 / 60, RUN)
    const bad = INCIDENTS.find((i) => !i.good)!
    s.pendingIncident = bad
    d.update(s, 1 / 60, RUN)
    d.update(s, 1 / 60, RUN)
    expect(rec.ids()).toEqual(['incident.bad'])
  })

  it('drives the music scene, intensity and the pause muffle from the game', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    d.update(s, 1 / 60, RUN)
    expect(rec.drives.at(-1)?.scene).toBe('title')
    s.phase = 'wave'
    s.waveIndex = CAMPAIGN_THEMES.findIndex((t) => !t.boss)
    s.meters.trust = 5
    expect(computeDanger(s)).toBeGreaterThan(0.9)
    for (let i = 0; i < 120; i++) d.update(s, 1 / 30, RUN)
    expect(rec.drives.at(-1)?.scene).toBe('wave')
    expect(rec.drives.at(-1)!.danger).toBeGreaterThan(0.8)
    expect(rec.muffled.at(-1)).toBe(false)
    d.update(s, 1 / 60, { running: false, paused: true, speed: 1 })
    expect(rec.muffled.at(-1)).toBe(true)
    s.phase = 'build'
    expect(computeIntensity(s)).toBe(0)
  })

  it('sounds speed, pause and panel edges — but not for the autoplay demo', () => {
    const rec = new Recorder()
    const d = new AudioDirector(rec)
    const s = createState(1)
    s.phase = 'wave'
    d.update(s, 1 / 60, { ...RUN, panels: { models: false } })
    d.update(s, 1 / 60, { ...RUN, speed: 3, panels: { models: true } })
    d.update(s, 1 / 60, { ...RUN, speed: 3, paused: true, panels: { models: false } })
    expect(rec.ids()).toEqual(['ui.speed', 'ui.open', 'ui.pause', 'ui.close'])
    rec.cues.length = 0
    d.update(s, 1 / 60, { ...RUN, speed: 12, demo: true })
    expect(rec.ids()).toEqual([])
  })
})
