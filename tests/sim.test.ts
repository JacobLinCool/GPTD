import { describe, expect, it } from 'vitest'
import { SIM_DT } from '../src/config'
import type { GameState } from '../src/core/types'
import { buyUpgrade, startGame, startWave, tryBuild } from '../src/sim/actions'
import { TOWER_DEFS } from '../src/sim/content'
import { serverQuality } from '../src/sim/effects'
import { isBrownout, updatePower } from '../src/sim/power'
import { spawnRequest } from '../src/sim/spawn'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'

function runFor(s: GameState, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i++) step(s)
}

/** Put the state into an active, group-less wave so we can inject requests directly. */
function liveWave(s: GameState): void {
  s.phase = 'wave'
  s.waveActive = true
  s.waveTime = 0
  s.spawns = []
}

function richBuild(s: GameState): void {
  s.meters.cash = 99999
  s.phase = 'build'
}

describe('request resolution', () => {
  it('a server serves a Simple Chat and earns cash', () => {
    const s = createState(1)
    richBuild(s)
    expect(tryBuild(s, 'srv_general', 2, 2)).toBe(true)
    expect(tryBuild(s, 'srv_general', 4, 2)).toBe(true)
    const cashBefore = s.meters.cash
    liveWave(s)
    spawnRequest(s, 'chat')
    runFor(s, 12)
    expect(s.stats.served).toBe(1)
    expect(s.meters.cash).toBeGreaterThan(cashBefore)
    expect(s.requests.length).toBe(0)
  })

  it('an unanswered request leaks and damages Trust + SLA', () => {
    const s = createState(2)
    liveWave(s)
    const t0 = s.meters.trust
    const sla0 = s.meters.sla
    spawnRequest(s, 'reason')
    runFor(s, 75)
    expect(s.stats.leaked).toBe(1)
    expect(s.meters.trust).toBeLessThan(t0)
    expect(s.meters.sla).toBeLessThan(sla0)
  })

  it('a weak model ships a bad answer when it finishes a too-hard request', () => {
    const s = createState(3)
    richBuild(s)
    // Many Small Servers (quality 34) can grind out a Coding request (work 96)
    // but quality is below its complexity (56) — so it lands as a bad answer.
    for (const col of [2, 4, 6, 8, 10, 12]) tryBuild(s, 'srv_small', col, 2)
    liveWave(s)
    spawnRequest(s, 'code')
    runFor(s, 30)
    expect(s.stats.served).toBe(0)
    expect(s.stats.bad).toBeGreaterThanOrEqual(1)
  })

  it('jailbreaks need a Safety Gate or they become unsafe answers', () => {
    const unsafe = createState(4)
    richBuild(unsafe)
    tryBuild(unsafe, 'srv_general', 3, 2)
    liveWave(unsafe)
    spawnRequest(unsafe, 'jail')
    // worked to zero but never cleared → held, then breaches (unsafe) at the core
    runFor(unsafe, 45)
    expect(unsafe.stats.unsafe).toBe(1)

    const safe = createState(4)
    richBuild(safe)
    tryBuild(safe, 'srv_general', 3, 2)
    tryBuild(safe, 'safety', 3, 0)
    liveWave(safe)
    spawnRequest(safe, 'jail')
    runFor(safe, 12)
    expect(safe.stats.unsafe).toBe(0)
    expect(safe.stats.served).toBe(1)
  })
})

describe('power & cooling', () => {
  it('browns out when GPUs exceed power capacity, recovers with a Power Plant', () => {
    const s = createState(5)
    richBuild(s)
    // base power is 8; three Frontier servers draw 6 each = 18 > 8.
    tryBuild(s, 'srv_frontier', 3, 2)
    tryBuild(s, 'srv_frontier', 5, 2)
    tryBuild(s, 'srv_frontier', 7, 2)
    updatePower(s)
    expect(isBrownout(s)).toBe(true)
    tryBuild(s, 'power', 3, 4)
    tryBuild(s, 'power', 5, 4)
    updatePower(s)
    expect(isBrownout(s)).toBe(false)
  })
})

describe('campaign flow', () => {
  it('clears Wave 1 with a sensible build and keeps Trust healthy', () => {
    const s = createState(7)
    richBuild(s)
    startGame(s)
    // blanket the top run, power and cool it
    for (const col of [3, 8, 14, 20]) tryBuild(s, 'srv_general', col, 2)
    for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
    for (const col of [6, 12, 18]) tryBuild(s, 'cooling', col, 4)
    expect(startWave(s)).toBe(true)
    runFor(s, 60)
    expect(s.phase).toBe('build') // wave cleared, back to building
    expect(s.meters.trust).toBeGreaterThan(50)
    expect(s.stats.served).toBeGreaterThan(5)
  })

  it('is deterministic for identical inputs', () => {
    const play = (seed: number) => {
      const s = createState(seed)
      richBuild(s)
      startGame(s)
      for (const col of [3, 8, 14, 20]) tryBuild(s, 'srv_general', col, 2)
      for (const col of [4, 10, 16]) tryBuild(s, 'power', col, 4)
      startWave(s)
      runFor(s, 40)
      return s
    }
    const a = play(11)
    const b = play(11)
    expect(a.meters).toEqual(b.meters)
    expect(a.stats).toEqual(b.stats)
    expect(Math.round(a.data)).toEqual(Math.round(b.data))
  })
})

describe('tech tree', () => {
  it('requires a Training Lab and spends cash + data', () => {
    const s = createState(8)
    s.phase = 'build'
    s.meters.cash = 1000
    s.data = 50
    expect(buyUpgrade(s, 'scale_pretrain')).toBe(false) // no lab yet
    tryBuild(s, 'lab', 3, 2)
    const cash0 = s.meters.cash
    const data0 = s.data
    expect(buyUpgrade(s, 'scale_pretrain')).toBe(true)
    expect(s.upgrades['scale_pretrain']).toBe(1)
    expect(s.meters.cash).toBeLessThan(cash0)
    expect(s.data).toBeLessThan(data0)
  })

  it('Pretraining raises effective server quality', () => {
    const s = createState(9)
    const def = TOWER_DEFS['srv_small']
    s.upgrades['scale_pretrain'] = 2
    expect(serverQuality(s, def)).toBe((def.quality ?? 0) + 16)
  })
})
