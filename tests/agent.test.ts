/**
 * The agent bridge's tab side (src/agent/**): the /state snapshot an agent with no repo
 * plays from, and the rejection reasons it reads when a move fails.
 */
import { describe, expect, it } from 'vitest'
import type { GameState, WaveReport } from '../src/core/types'
import { explainRejection } from '../src/agent/diagnose'
import { serializeState } from '../src/agent/snapshot'
import { setRackPrecision, tryBuild } from '../src/sim/actions'
import { isBuildable } from '../src/sim/pathing'
import { GRID_COLS, GRID_ROWS } from '../src/config'
import { createState } from '../src/sim/state'

function buildPhase(): GameState {
  const s = createState(21)
  s.phase = 'build'
  s.meters.cash = 1e6
  return s
}

function placeRack(s: GameState): number {
  for (let col = 0; col < GRID_COLS; col++)
    for (let row = 0; row < GRID_ROWS; row++)
      if (isBuildable(col, row) && tryBuild(s, 'srv_edge', col, row)) return s.towers[s.towers.length - 1].id
  throw new Error('no tile')
}

describe('agent snapshot', () => {
  it('describes every research option, including the infra nodes whose text lives in the locale', () => {
    const snap = serializeState(buildPhase())
    expect(snap.research.options.length).toBeGreaterThan(0)
    const blank = snap.research.options.filter((o) => !o.desc)
    expect(blank.map((o) => o.id)).toEqual([])
  })

  it('shows each rack its weight format, its setting and the formats it may switch to', () => {
    const s = buildPhase()
    const id = placeRack(s)
    const rack = serializeState(s).towers.find((t) => t.id === id)!
    expect(rack.formatSetting).toBe('auto')
    expect(rack.formats).toContain(rack.format)
    expect(rack.formats).toContain('bf16')
  })

  it('rounds the operating bill and its GPU-hour / energy split', () => {
    const s = buildPhase()
    const rep = {
      waveIndex: 0,
      served: 1,
      sloMiss: 0,
      bad: 0,
      unservable: 0,
      unsafe: 0,
      overRefused: 0,
      leaked: 0,
      cacheHits: 0,
      cashIn: 1.23456,
      clearBonus: 12.3456,
      powerCost: 0.84297346,
      gpuCost: 0.42148673015874344,
      energyCost: 0.42148673015874344,
      avgLatency: 0,
      p95Latency: 0,
      avgTtft: 0,
      p95Ttft: 0,
      goodputPct: 100,
      duration: 1,
      byType: {},
    } satisfies WaveReport
    s.lastReport = rep
    const r = serializeState(s).lastReport!
    expect(r.gpuCost).toBe(0.421)
    expect(r.energyCost).toBe(0.421)
    expect(r.powerCost).toBe(0.843)
    expect(r.clearBonus).toBe(12.35)
  })
})

describe('agent rejection reasons', () => {
  it('explains a weight-format change that cannot happen', () => {
    const s = buildPhase()
    const id = placeRack(s)
    expect(explainRejection(s, 'setRackPrecision', [id, 'fp4'])).toMatch(/unknown format/)
    expect(explainRejection(s, 'setRackPrecision', [id, 'int4'])).toMatch(/not researched/)
    expect(explainRejection(s, 'setRackPrecision', [id, 'nvfp4'])).toMatch(/Blackwell/)
    expect(explainRejection(s, 'setRackPrecision', [id, 'auto'])).toMatch(/already set to auto/)
    s.phase = 'wave'
    expect(explainRejection(s, 'setRackPrecision', [id, 'bf16'])).toMatch(/between waves/)
  })

  it('a format the rack can take is accepted by the sim action the agent calls', () => {
    const s = buildPhase()
    const id = placeRack(s)
    expect(setRackPrecision(s, id, 'bf16')).toBe(true)
    expect(serializeState(s).towers.find((t) => t.id === id)!.formatSetting).toBe('bf16')
  })
})
