import { START } from '../config'
import { RNG } from '../core/rng'
import type { ActiveModifiers, GameState } from '../core/types'
import { STARTER_MODELS } from './content'

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
    stats: { served: 0, sloMiss: 0, bad: 0, unservable: 0, unsafe: 0, overRefused: 0, leaked: 0, cashEarned: 0, peakConcurrent: 0 },
    waveStats: null,
    lastReport: null,
    models: Object.fromEntries(STARTER_MODELS.map((id) => [id, true as const])),
    derivedModels: {},
    derivedSeq: 0,
    // P3c: the SINGLE source of truth for serving physics. Neutral pre-research
    // defaults; InfraNodeDef research mutates these via applyInfraEffects.
    infra: {
      scheduling: { batch: false, multiStep: 0, chunked: false },
      kv: { utilization: 0.55, prefixHitCeil: 0, quantBytes: 2, offloadGb: 0, flash: 0 },
      disagg: false,
      spec: { enabled: false, level: 0 },
      weightQuantBytes: 2,
      par: { tp: false, pp: false, dp: false, ep: false },
      routing: { kvAware: false },
      loraSlots: 0,
      engineTier: 0,
      throughput: 0,
    },
    research: { infra: null, posttrain: null, eval: null },
    // §3.6 global guardrail decision threshold (no-free-lunch): default 0.5.
    guardrailThreshold: 0.5,
    marketPriceMul: 1,
    utilization: 0,
    fleetCapexUsd: 0,
    endless: false,
    currentWave: null,
    events: [],
    nextId: 1,
    nextLaneId: 0,
    laneWindow: [],
    message: '',
  }
}
