import { START } from '../config'
import { RNG } from '../core/rng'
import type { ActiveModifiers, GameState } from '../core/types'

export function defaultModifiers(): ActiveModifiers {
  return { powerPrice: 1, coolingCap: 1, buildCost: 1, safetyDamage: 1, volume: 1, reward: 1 }
}

export function createState(seed = 12345): GameState {
  return {
    phase: 'menu',
    time: 0,
    meters: { trust: START.trust, sla: START.sla, cash: START.cash },
    data: START.data,
    power: { used: 0, cap: START.basePower },
    cooling: { used: 0, cap: START.baseCooling },
    routingPower: 0,
    towers: [],
    requests: [],
    rng: new RNG(seed),
    seed,
    waveIndex: -1,
    waveActive: false,
    waveTime: 0,
    spawns: [],
    upgrades: {},
    modifiers: defaultModifiers(),
    pendingIncident: null,
    stats: { served: 0, bad: 0, unsafe: 0, leaked: 0, cashEarned: 0, peakConcurrent: 0 },
    events: [],
    nextId: 1,
    message: '',
  }
}
