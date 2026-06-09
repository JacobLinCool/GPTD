import type { RNG } from './rng'

export interface Vec2 {
  x: number
  y: number
}

export type Phase = 'menu' | 'build' | 'wave' | 'won' | 'lost'

export type ServerSpec = 'general' | 'chat' | 'coding' | 'reasoning'

export type TowerKind = 'server' | 'router' | 'cache' | 'safety' | 'power' | 'cooling' | 'lab'

/** Static definition of a kind of incoming request (the "enemy"). */
export interface RequestTypeDef {
  id: string
  name: string
  glyph: string
  color: number
  work: number
  /** path-tiles per second */
  speed: number
  /** quality threshold a model must meet to answer correctly */
  complexity: number
  /** 0..1; >0 means it must pass a Safety Gate or it damages Trust */
  safetyRisk: number
  reward: number
  trustPenalty: number
  slaPenalty: number
  data: number
  cacheable: boolean
  /** which server spec answers it best */
  affinity: ServerSpec
  desc: string
}

/** Static definition of a buildable tower / building. */
export interface TowerDef {
  id: string
  name: string
  kind: TowerKind
  cost: number
  /** tiles; 0 = non-targeting support building */
  range: number
  color: number
  accent: number
  desc: string
  tagline: string
  // --- server fields ---
  quality?: number
  /** base compute per second */
  speed?: number
  spec?: ServerSpec
  powerDraw?: number
  heat?: number
  /** can hit this many requests at once (batching) */
  targets?: number
  // --- support fields ---
  power?: number
  cooling?: number
  cacheChance?: number
  routeBonus?: number
  /** safety clears/second applied to risky requests in range */
  safetyRate?: number
}

/** Runtime request instance. */
export interface Request {
  id: number
  def: RequestTypeDef
  /** distance travelled along the lane, in design pixels */
  dist: number
  work: number
  maxWork: number
  speed: number
  complexity: number
  safetyRisk: number
  reward: number
  trustPenalty: number
  slaPenalty: number
  data: number
  /** best (model quality - complexity) margin seen from any server that hit it */
  bestQuality: number
  safetyCleared: boolean
  routed: boolean
  cacheTried: boolean
  x: number
  y: number
  hitFlash: number
  cacheFlash: number
  alive: boolean
}

/** Runtime tower instance. */
export interface Tower {
  id: number
  def: TowerDef
  col: number
  row: number
  x: number
  y: number
  level: number
  online: boolean
  /** 1 = full speed, < 1 = thermally throttled */
  throttle: number
  cooldown: number
  muzzle: number
  targetId: number | null
}

export interface Meters {
  trust: number
  sla: number
  cash: number
}

export interface Capacity {
  used: number
  cap: number
}

/** One scheduled burst of spawns inside a wave. */
export interface SpawnGroup {
  typeId: string
  count: number
  /** seconds between spawns in this group */
  interval: number
  /** seconds before this group begins (from wave start) */
  delay: number
  workMul?: number
  speedMul?: number
}

export interface WaveDef {
  name: string
  brief: string
  teaches: string
  /** bonus cash paid for clearing the wave */
  clearBonus: number
  groups: SpawnGroup[]
}

export type ModifierTarget = 'powerPrice' | 'coolingCap' | 'buildCost' | 'safetyDamage' | 'volume' | 'reward'

export interface IncidentDef {
  id: string
  name: string
  icon: string
  desc: string
  /** active multipliers applied during the next wave */
  mods: Partial<Record<ModifierTarget, number>>
  /** one-shot effect applied immediately when the incident is accepted */
  instant?: (s: GameState) => void
  good?: boolean
}

export interface UpgradeDef {
  id: string
  path: 'scale' | 'efficiency' | 'safety' | 'product'
  name: string
  cashCost: number
  dataCost: number
  desc: string
  /** prerequisite upgrade ids */
  requires?: string[]
  /** max times it can be bought */
  maxLevel: number
}

export interface RuntimeSpawn extends SpawnGroup {
  spawned: number
  timer: number
  started: boolean
}

export type GameEvent =
  | { type: 'fire'; fx: { x: number; y: number }; tx: number; ty: number; color: number }
  | { type: 'serve'; x: number; y: number; kind: 'good' | 'bad' | 'unsafe'; amount: number }
  | { type: 'cache'; x: number; y: number }
  | { type: 'leak'; x: number; y: number; unsafe: boolean }
  | { type: 'place'; x: number; y: number }
  | { type: 'sell'; x: number; y: number }
  | { type: 'brownout' }
  | { type: 'wave-start'; index: number }
  | { type: 'wave-clear'; index: number }
  | { type: 'train' }
  | { type: 'win' }
  | { type: 'lose' }

export interface GameStats {
  served: number
  bad: number
  unsafe: number
  leaked: number
  cashEarned: number
  peakConcurrent: number
}

export interface ActiveModifiers {
  powerPrice: number
  coolingCap: number
  buildCost: number
  safetyDamage: number
  volume: number
  reward: number
}

export interface GameState {
  phase: Phase
  time: number
  meters: Meters
  data: number
  power: Capacity
  cooling: Capacity
  routingPower: number
  towers: Tower[]
  requests: Request[]
  rng: RNG
  seed: number
  waveIndex: number
  waveActive: boolean
  waveTime: number
  spawns: RuntimeSpawn[]
  upgrades: Record<string, number>
  modifiers: ActiveModifiers
  pendingIncident: IncidentDef | null
  stats: GameStats
  events: GameEvent[]
  nextId: number
  message: string
}
