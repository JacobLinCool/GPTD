import { describe, expect, it } from 'vitest'
import { SIM_DT } from '../src/config'
import { startGame, startWave, tryBuild } from '../src/sim/actions'
import { CAMPAIGN_THEMES } from '../src/sim/campaign'
import { WAVES } from '../src/sim/content'
import { towerOpexPerSec } from '../src/sim/effects'
import { fleetBurnPerSec, previewNextWave } from '../src/sim/preview'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'

/** A buildable tile next to the first lane (row 0 sits above lane 0's top run). */
const TILE = { col: 4, row: 0 }

describe('next-wave preview (sim/preview.ts)', () => {
  it('forecasts exactly the spawns startWave creates, without touching state or the RNG', () => {
    const s = createState(11)
    startGame(s)
    s.modifiers.volume = 1.5 // a telegraphed volume incident is already folded in at build time
    const before = JSON.stringify({ ...s, rng: undefined, events: [] })
    const rngProbe = createState(11).rng.next()
    const p = previewNextWave(s)
    expect(p).not.toBeNull()
    // pure: no mutation, no RNG draw
    expect(JSON.stringify({ ...s, rng: undefined, events: [] })).toBe(before)
    expect(s.rng.next()).toBe(rngProbe)

    const s2 = createState(11)
    startGame(s2)
    s2.modifiers.volume = 1.5
    const p2 = previewNextWave(s2)!
    expect(startWave(s2)).toBe(true)
    const spawned = s2.spawns.reduce((n, g) => n + g.count, 0)
    expect(p2.index).toBe(0)
    expect(p2.def).toBe(WAVES[0])
    expect(p2.totalRequests).toBe(spawned)
    expect(p2.entries.reduce((n, e) => n + e.count, 0)).toBe(spawned)
    expect(p2.era).toBe(CAMPAIGN_THEMES[0].era)
    expect(p2.estDurationSec).toBeGreaterThan(0)
  })

  it('names the single ingress of an authored single-lane surge', () => {
    const idx = CAMPAIGN_THEMES.findIndex((t) => t.special === 'single-lane-surge')
    expect(idx).toBeGreaterThan(0)
    const s = createState(5)
    startGame(s)
    s.waveIndex = idx - 1
    const p = previewNextWave(s)!
    const lane = WAVES[idx].groups[0].lane
    expect(lane).toBeDefined()
    expect(p.surgeLane).toBe(lane)
    for (const e of p.entries) expect(e.lanes).toEqual([lane])
  })

  it('names the funnel lane of a concentrate incident and leaves a spread wave un-surged', () => {
    const s = createState(6)
    startGame(s)
    expect(previewNextWave(s)!.surgeLane).toBeNull()
    s.laneWindow = [2]
    const p = previewNextWave(s)!
    expect(p.surgeLane).toBe(2)
    expect(p.lanes).toEqual([2])
  })

  it('bills the fleet like the wave economy tick, at a busy rack’s energy draw', () => {
    const s = createState(7)
    startGame(s)
    expect(tryBuild(s, 'srv_edge', TILE.col, TILE.row)).toBe(true)
    const burn = fleetBurnPerSec(s)
    expect(burn).toBeGreaterThan(0)
    const p = previewNextWave(s)!
    expect(p.projectedBill).toBeCloseTo(burn * p.estDurationSec, 6)
    // the busy-wave burn = every tower's GPU-hour line + its energy line at full load
    const busy = s.towers.reduce((n, t) => {
      const op = towerOpexPerSec(s, t, 1)
      return n + op.gpu + op.energy
    }, 0)
    expect(burn).toBeCloseTo(busy, 12)
    startWave(s)
    const cash = s.meters.cash
    const live = s.towers.reduce((n, t) => {
      const op = towerOpexPerSec(s, t)
      return n + op.gpu + op.energy
    }, 0)
    step(s)
    // the first tick earns nothing yet, so the cash drop is the operating bill alone — an idle
    // rack still pays its GPU-hours, but draws (and pays) less energy than a busy one
    expect(cash - s.meters.cash).toBeCloseTo(live * SIM_DT, 12)
    expect(live).toBeLessThan(burn)
  })
})
