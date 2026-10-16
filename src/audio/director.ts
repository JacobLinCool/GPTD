/**
 * AudioDirector — what the game should SOUND like, decided from sim events and
 * state. Pure logic (no Web Audio): it talks to an `AudioSink` (the engine), so
 * it is unit-tested in node with a recording sink.
 *
 * - every terminal request outcome → its cue (OUTCOME_STYLE), panned by board x;
 * - a presentation-only clean-serve streak climbs the served chime up the
 *   pentatonic and falls back to the root on any failure (the drop is itself
 *   information), with a soft sparkle at streak milestones;
 * - player actions, research, incidents, waves and the end of the run → their
 *   cues / stingers (deploy weight scales with model size, upgrade with tier);
 * - continuous state → music scene + intensity + danger, the room-tone
 *   ambience, the low-Trust/SLA heartbeat, the bankruptcy clock tick, the
 *   pause muffle, and UI edges (speed, pause, panels opening/closing);
 * - power cues only on brownout TRANSITIONS (the sim's `brownout` event), never
 *   while the board is frozen.
 */
import type { GameEvent, GameState, Outcome, RefusedBy } from '../core/types'
import { OUTCOME_STYLE } from '../outcomes'
import { CAMPAIGN_THEMES, MAX_TIER } from '../sim/campaign'
import { HARDWARE_DEFS, HARDWARE_TIERS, INCIDENTS, TOWER_DEFS } from '../sim/content'
import { resolveModel } from '../sim/models'
import { isBrownout, isThrottling } from '../sim/power'
import { outcomeCue, STREAK_MILESTONES, streakDegree, type CueId, type CueParams } from './cues'
import type { AmbienceDrive } from './ambience'
import type { MusicDrive, MusicScene } from './music'

/** What the director drives (implemented by the engine; a recorder in tests). */
export interface AudioSink {
  /** the audio clock (s). */
  now(): number
  /** request a cue; `at` = schedule exactly at that audio time (rhythmic state cues). */
  cue(id: CueId, params?: CueParams, at?: number): void
  music(d: MusicDrive): void
  ambience(d: AmbienceDrive | null): void
  /** pause / system menu: muffle the music behind glass. */
  muffle(on: boolean): void
  /** game over: tape-stop the music. */
  tapeStop(): void
  /** end of a rendered frame: flush deferred voices. */
  endFrame(): void
}

/** Presentation-side game state the director cannot read from the sim. */
export interface AudioView {
  /** the wave sim advanced this frame (not paused, no modal freezing it). */
  running: boolean
  /** the explicit pause toggle. */
  paused: boolean
  /** gameplay speed multiplier. */
  speed: number
  /** the autoplay demo owns the run (no speed / pause chatter). */
  demo?: boolean
  /** a remote agent drives the run. */
  agent?: boolean
  /** overlay panels by name; an edge plays the open / close whoosh. The hub ones muffle the music. */
  panels?: Record<string, boolean>
}

/** Panels that are the pause hub (the music goes behind glass while they are up). */
const HUB_PANELS = ['system', 'settings', 'browser']

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** A boss beat: the campaign's authored boss rows, and every 10th endless surge. */
export function isBossWave(s: GameState): boolean {
  const theme = CAMPAIGN_THEMES[s.waveIndex]
  if (theme) return !!theme.boss
  return (s.waveIndex + 1) % 10 === 0
}

/**
 * How hard the platform is working, 0..1: fleet utilization, the era's tier,
 * requests on the board, and how far through the wave we are.
 */
export function computeIntensity(s: GameState): number {
  if (s.phase !== 'wave') return 0
  const theme = CAMPAIGN_THEMES[s.waveIndex]
  const tier = theme ? theme.tier / MAX_TIER : 1
  let spawned = 0
  let total = 0
  for (const g of s.spawns) {
    spawned += g.spawned
    total += g.count
  }
  const progress = total ? spawned / total : 0
  return clamp01(
    0.35 * clamp01(s.utilization) +
      0.25 * tier +
      0.25 * Math.min(1, s.requests.length / 40) +
      0.15 * progress,
  )
}

/** How close the run is to failing, 0..1: the lower of Trust/SLA, open hazards on the board, a brownout. */
export function computeDanger(s: GameState): number {
  if (s.phase !== 'wave') return 0
  const m = Math.min(s.meters.trust, s.meters.sla)
  let hazards = 0
  for (const r of s.requests) if (r.alive && r.safetyRisk > 0) hazards++
  return Math.max(clamp01((30 - m) / 25), Math.min(0.7, hazards / 8), isBrownout(s) ? 0.6 : 0)
}

/** Model size → 0..1 (log params, ≈1B → 0, ≈3T → 1): bigger loads longer and lower. */
export function modelSize(paramsTotalB: number | undefined): number {
  if (!paramsTotalB || paramsTotalB <= 1) return 0
  return clamp01(Math.log10(paramsTotalB) / Math.log10(3000))
}

export class AudioDirector {
  private run: GameState | null = null
  private streak = 0
  private lastMilestone = -Infinity
  /** power state as last announced (true = a rack is dark). */
  private power = false
  private pendingPower: boolean | null = null
  private bossIndex = -1
  private boss = false
  private intensity = 0
  private danger = 0
  private heartbeat = false
  private nextBeat = 0
  private cashEma = 0
  private lastCash: number | null = null
  private nextTick = 0
  private frozen = false
  private lastSpeed: number | null = null
  private lastPaused: boolean | null = null
  private lastPanels: Record<string, boolean> = {}

  constructor(private readonly sink: AudioSink) {}

  /** the current clean-serve streak (presentation-only; the VFX may read it for a combo glow). */
  get streakCount(): number {
    return this.streak
  }

  /** A new GameState object = a new run: forget per-run presentation state. */
  private bind(s: GameState): void {
    if (s === this.run) return
    this.run = s
    this.streak = 0
    this.power = false
    this.pendingPower = null
    this.bossIndex = -1
    this.boss = false
    this.intensity = 0
    this.danger = 0
    this.heartbeat = false
    this.cashEma = 0
    this.lastCash = null
  }

  onEvent(ev: GameEvent, s: GameState): void {
    this.bind(s)
    const k = this.sink
    switch (ev.type) {
      case 'outcome':
        this.outcome(ev.outcome, ev.x, ev.refusedBy)
        break
      case 'cache':
        k.cue('cache.hit', { x: ev.x })
        break
      case 'guard':
        // a wrong guard refusal is announced by its `overRefused` outcome (refusedBy: guard)
        if (ev.result === 'caught') k.cue('guard.catch', { x: ev.x, archetype: ev.archetype })
        break
      case 'selfHandle':
        k.cue('model.selfHandle', { x: ev.x })
        break
      case 'build':
        this.lastCash = null
        k.cue('build', { x: ev.x, rack: TOWER_DEFS[ev.defId]?.kind === 'server' })
        break
      case 'upgrade': {
        this.lastCash = null
        const tier = HARDWARE_TIERS.indexOf(ev.hwId)
        k.cue('upgrade', {
          x: ev.x,
          size: tier < 0 ? 0.5 : tier / Math.max(1, HARDWARE_TIERS.length - 1),
          liquid: HARDWARE_DEFS[ev.hwId]?.cooling === 'liquid',
        })
        break
      }
      case 'deploy':
        this.lastCash = null
        k.cue('deploy', { x: ev.x, size: modelSize(resolveModel(s, ev.modelId)?.paramsTotalB) })
        break
      case 'research-start':
        k.cue('research.start', { posttrain: ev.track === 'posttrain' })
        break
      case 'sell':
        this.lastCash = null
        k.cue('sell', { x: ev.x })
        break
      case 'brownout':
        this.powerEdge(ev.on ?? true, this.frozen)
        break
      case 'incident': {
        const def = INCIDENTS.find((i) => i.id === ev.id) ?? s.pendingIncident
        k.cue(def?.good ? 'incident.good' : 'incident.bad')
        break
      }
      case 'wave-start': {
        this.streak = 0
        this.bossIndex = ev.index
        this.boss = ev.boss ?? isBossWave(s)
        k.cue(this.boss ? 'wave.boss' : 'wave.start')
        break
      }
      case 'wave-clear':
        k.cue('wave.clear', { goodput: ev.goodputPct ?? s.lastReport?.goodputPct })
        break
      case 'research-done':
        // a Studio checkpoint finishing is "minted" (its posttrain-done plays that), not "researched"
        if (!s.derivedModels[ev.id]) k.cue('research.done')
        break
      case 'posttrain-done':
        k.cue('checkpoint.minted')
        break
      case 'win':
        k.cue('win')
        break
      case 'lose': {
        const meter = ev.meter ?? (s.meters.trust <= 0 ? 'trust' : s.meters.sla <= 0 ? 'sla' : 'cash')
        k.tapeStop()
        k.cue('lose', { meter })
        break
      }
    }
  }

  /** Per rendered frame, after the frame's events. */
  update(s: GameState, dt: number, view?: AudioView): void {
    this.bind(s)
    const v: AudioView = view ?? { running: s.phase === 'wave', paused: false, speed: 1 }
    const k = this.sink
    const now = k.now()
    const panels = v.panels ?? {}
    const hub = HUB_PANELS.some((p) => panels[p])
    this.frozen = (s.phase === 'wave' && !v.running) || hub

    // a power transition that happened while the board was frozen sounds when it resumes
    if (this.pendingPower !== null && !this.frozen) {
      if (this.pendingPower === this.power) k.cue(this.power ? 'power.down' : 'power.up')
      this.pendingPower = null
    }

    // ---- music + ambience ----
    if (s.phase === 'wave' && this.bossIndex !== s.waveIndex) {
      this.bossIndex = s.waveIndex
      this.boss = isBossWave(s)
    }
    const a = 1 - Math.exp(-Math.max(0, dt) / 1.5)
    this.intensity += (computeIntensity(s) - this.intensity) * a
    this.danger += (computeDanger(s) - this.danger) * a
    k.music({ scene: this.scene(s), intensity: this.intensity, danger: this.danger, seed: s.waveIndex })
    k.muffle(this.frozen)
    k.ambience(this.ambience(s))

    // ---- warnings: only while the wave is actually running ----
    this.updateHeartbeat(s, v.running, now)
    this.updateCashTick(s, v.running, dt, now)

    // ---- interface edges ----
    const playing = s.phase === 'build' || s.phase === 'wave'
    const chatter = playing && !v.demo && !v.agent
    if (this.lastSpeed !== null && v.speed !== this.lastSpeed && chatter)
      k.cue('ui.speed', { speed: v.speed })
    if (this.lastPaused !== null && v.paused !== this.lastPaused && chatter && s.phase === 'wave')
      k.cue(v.paused ? 'ui.pause' : 'ui.resume')
    let opened = false
    let closed = false
    for (const key of Object.keys(panels)) {
      const was = this.lastPanels[key] ?? false
      if (panels[key] && !was) opened = true
      else if (!panels[key] && was) closed = true
    }
    if (opened) k.cue('ui.open')
    else if (closed) k.cue('ui.close')
    this.lastSpeed = v.speed
    this.lastPaused = v.paused
    this.lastPanels = { ...panels }

    k.endFrame()
  }

  private scene(s: GameState): MusicScene {
    switch (s.phase) {
      case 'menu':
        return 'title'
      case 'build':
        return 'build'
      case 'wave':
        return this.boss ? 'boss' : 'wave'
      case 'won':
        return 'won'
      case 'lost':
        return 'lost'
    }
  }

  private ambience(s: GameState): AmbienceDrive | null {
    if (s.phase !== 'build' && s.phase !== 'wave') return null
    let racks = 0
    for (const t of s.towers) if (t.def.kind === 'server') racks++
    return {
      util: s.phase === 'wave' ? s.utilization : 0,
      racks,
      cooling: s.cooling.cap > 0 ? s.cooling.used / s.cooling.cap : 0,
      throttling: isThrottling(s),
      dark: isBrownout(s),
    }
  }

  private outcome(o: Outcome, x: number, by?: RefusedBy): void {
    const cue = outcomeCue(OUTCOME_STYLE[o].cue)
    if (o === 'served') {
      this.streak++
      this.sink.cue(cue, { x, degree: streakDegree(this.streak) })
      if ((STREAK_MILESTONES as readonly number[]).includes(this.streak)) {
        const now = this.sink.now()
        if (now - this.lastMilestone >= 4) {
          this.lastMilestone = now
          this.sink.cue('streak.milestone')
        }
      }
      return
    }
    this.streak = 0
    this.sink.cue(cue, { x, by })
  }

  /** A power-state transition; while frozen it waits for the board to resume. */
  private powerEdge(dark: boolean, frozen: boolean): void {
    if (dark === this.power) {
      this.pendingPower = null
      return
    }
    this.power = dark
    if (frozen) {
      this.pendingPower = dark
      return
    }
    this.pendingPower = null
    this.sink.cue(dark ? 'power.down' : 'power.up')
  }

  /** "lub-dub" under Trust/SLA 30 (off above 35), faster and louder as the meter falls. */
  private updateHeartbeat(s: GameState, running: boolean, now: number): void {
    const m = Math.min(s.meters.trust, s.meters.sla)
    if (!this.heartbeat && m < 30) this.heartbeat = true
    else if (this.heartbeat && m > 35) this.heartbeat = false
    if (!running || !this.heartbeat || s.phase !== 'wave') {
      this.nextBeat = 0
      return
    }
    const danger = clamp01((30 - m) / 25)
    const interval = 1.2 + (0.5 - 1.2) * danger
    if (this.nextBeat < now) this.nextBeat = now + 0.05
    while (this.nextBeat < now + 0.15) {
      this.sink.cue('danger.heartbeat', { intensity: danger }, this.nextBeat)
      this.nextBeat += interval
    }
  }

  /** A soft 4 Hz clock tick when cash is projected to run out within ~20 wall-seconds. */
  private updateCashTick(s: GameState, running: boolean, dt: number, now: number): void {
    if (!running || s.phase !== 'wave') {
      this.lastCash = null
      this.nextTick = 0
      return
    }
    const cash = s.meters.cash
    if (this.lastCash !== null && dt > 0) {
      const rate = (cash - this.lastCash) / dt
      this.cashEma += (rate - this.cashEma) * (1 - Math.exp(-dt / 2))
    }
    this.lastCash = cash
    const burning = this.cashEma < 0 && cash > 0 && cash / -this.cashEma < 20
    if (!burning) {
      this.nextTick = 0
      return
    }
    if (this.nextTick < now) this.nextTick = now + 0.05
    while (this.nextTick < now + 0.15) {
      this.sink.cue('cash.tick', {}, this.nextTick)
      this.nextTick += 0.25
    }
  }
}
