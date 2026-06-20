import { GRID_COLS, GRID_ROWS, LAT_CLASS_SLO, RACK_UTILIZATION, SIM_DT } from '../config'
import type { CapabilityAxis, GameState } from '../core/types'
import {
  continueEndless,
  cycleRackRole,
  deployModel,
  hardwareUpgradeCost,
  startGame,
  startWave,
  tryBuild,
  upgradeHardware,
} from './actions'
import { HARDWARE_DEFS, HARDWARE_TIERS, RESEARCH_DEFS, RESEARCH_TARGET_SECONDS, TOWER_DEFS, WAVES } from './content'
import {
  loadout,
  loadoutOf,
  serverDeployable,
  serverFitsMemory,
  serverHeat,
  serverPerUserDecodeTokS,
  serverPower,
} from './effects'
import { resolveModel } from './models'
import { CORE_TILE, isBuildable, isPathTile } from './pathing'
import { updatePower } from './power'
import {
  canPostTrain,
  researchOwned,
  researchTrackOf,
  researchUnlocked,
  startPostTrain,
  startResearch,
} from './research'
import { step } from './sim'
import { createState } from './state'

interface Slot {
  col: number
  row: number
}

type Role = 'small' | 'general' | 'frontier'

function adjacentToLane(col: number, row: number): boolean {
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) if (isPathTile(col + dc, row + dr)) return true
  return false
}

function buildSlots(): { lane: Slot[]; back: Slot[]; core: Slot[] } {
  const lane: Slot[] = []
  const back: Slot[] = []
  const core: Slot[] = []
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!isBuildable(c, r)) continue
      if (adjacentToLane(c, r)) {
        lane.push({ col: c, row: r })
        if (Math.abs(c - CORE_TILE.col) <= 5 && Math.abs(r - CORE_TILE.row) <= 4) core.push({ col: c, row: r })
      } else back.push({ col: c, row: r })
    }
  }
  const distToCore = (s: Slot) => Math.abs(s.col - CORE_TILE.col) + Math.abs(s.row - CORE_TILE.row)
  lane.sort((a, b) => distToCore(a) - distToCore(b) || a.col - b.col || a.row - b.row)
  core.sort((a, b) => distToCore(a) - distToCore(b) || a.col - b.col || a.row - b.row)
  return { lane, back, core }
}

const SLOTS = buildSlots()

const CLEAR_LINES: { axis: CapabilityAxis; at: number }[] = [
  { axis: 'chat', at: 18 },
  { axis: 'general', at: 38 },
  { axis: 'general', at: 50 },
  { axis: 'coding', at: 56 },
  { axis: 'reasoning', at: 82 },
  { axis: 'agentic', at: 82 },
]

const RESEARCH_PRIORITY = [
  'inf_batching',
  'inf_paged',
  'inf_wq_fp8',
  'r_pt_lora',
  'r_pt_pref',
  'r_pt_rl',
  'r_eval_redteam_v1',
  'r_eval_redteam_v2',
  'inf_prefix',
  'inf_flash',
  'inf_kvquant_fp8',
  'inf_spec',
  'inf_multistep',
  'inf_par_tp',
  'inf_par_pp',
  'inf_disagg',
  'inf_routing',
  'inf_wq_int4',
  'inf_kvquant_int4',
] as const

function countKind(s: GameState, kind: string): number {
  return s.towers.filter((t) => t.def.kind === kind).length
}

function countDef(s: GameState, id: string): number {
  return s.towers.filter((t) => t.def.id === id).length
}

function freeSlot(s: GameState, list: Slot[]): Slot | undefined {
  return list.find((p) => !s.towers.some((t) => t.col === p.col && t.row === p.row))
}

function place(s: GameState, defId: string, slot: Slot | undefined): boolean {
  if (!slot) return false
  return tryBuild(s, defId, slot.col, slot.row)
}

function estDraw(s: GameState): number {
  return s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' ? serverPower(s, loadoutOf(s, t)) : (t.def.powerDraw ?? 0)),
    0,
  )
}

function estHeat(s: GameState): number {
  return s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' ? serverHeat(s, loadoutOf(s, t)) : (t.def.heat ?? 0)),
    0,
  )
}

function ensureCapacity(s: GameState, addDraw: number, addHeat: number): void {
  updatePower(s)
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  let guard = 0
  while (estDraw(s) + addDraw > s.power.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'power', infraSlot())) break
    updatePower(s)
  }
  guard = 0
  while (estHeat(s) + addHeat > s.cooling.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'cooling', infraSlot())) break
    updatePower(s)
  }
}

function reserveOf(s: GameState): number {
  // Cushion scaled by fleet power draw — a proxy for the next wave's wall-clock operating
  // bill (charged DURING the wave, after the build phase has spent). Scaling harder with
  // draw keeps the autoplayer from over-building into bankruptcy on a tight wave.
  // (Re-tuned to 32 + draw·9 after the composite-benchmark recalibration shifted economics.)
  return 32 + estDraw(s) * 9
}

function hasTowerKind(s: GameState, kind: string): boolean {
  return s.towers.some((t) => t.def.kind === kind)
}

function hasHardware(s: GameState, hwId: string): boolean {
  return s.towers.some((t) => t.def.kind === 'server' && t.hwId === hwId)
}

function serverTargetFor(waveAbout: number): number {
  // past the campaign's teaching arc the gauntlet's volume climbs without bound,
  // so the autoplay keeps adding lane capacity; the finite board (≈145 lane slots,
  // capped in practice by power/cooling) is the real ceiling that self-limits this.
  if (waveAbout >= 17) return Math.min(100, 26 + (waveAbout - 17) * 3)
  if (waveAbout >= 14) return 23
  if (waveAbout >= 11) return 20
  if (waveAbout >= 8) return 17
  if (waveAbout >= 6) return 14
  if (waveAbout >= 4) return 11
  if (waveAbout >= 2) return 9
  return 7
}

function showcaseReserve(s: GameState, waveAbout: number): number {
  let r = reserveOf(s)
  if (waveAbout >= 12 && !hasTowerKind(s, 'cooling_liquid')) r += TOWER_DEFS.cooling_liquid.cost
  if (waveAbout >= 15 && !hasHardware(s, 'hw_pod')) r += HARDWARE_DEFS.hw_pod.cost - HARDWARE_DEFS.hw_frontier.cost
  return r
}

function lanesCleared(s: GameState, id: string): number {
  const q = resolveModel(s, id)?.qualityBy
  if (!q) return 0
  return CLEAR_LINES.reduce((n, l) => n + (q[l.axis] >= l.at ? 1 : 0), 0)
}

function minAxis(s: GameState, id: string): number {
  const q = resolveModel(s, id)?.qualityBy
  if (!q) return 0
  return Math.min(q.chat, q.coding, q.reasoning, q.general)
}

function modelScore(s: GameState, id: string): number {
  const m = resolveModel(s, id)
  if (!m) return -1
  return lanesCleared(s, id) * 1000 + minAxis(s, id) - m.paramsActiveB * 0.01
}

function modelScoreOn(s: GameState, hwId: string | undefined, id: string): number {
  const lo = loadout(s, hwId, id)
  const tpotMs = 1000 / Math.max(1e-6, serverPerUserDecodeTokS(s, lo, 1))
  return modelScore(s, id) + (tpotMs <= LAT_CLASS_SLO.IN.tpotMs ? 100_000 : 0) - tpotMs * 0.5
}

function bestFit(s: GameState, hwId: string | undefined): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const id of Object.keys(s.models)) {
    const m = resolveModel(s, id)
    if (!m || !serverDeployable(s, loadout(s, hwId, id))) continue
    const score = modelScoreOn(s, hwId, id)
    if (score > bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

function deployBest(s: GameState, towerId: number, hwId: string | undefined, curId: string | undefined): void {
  const target = bestFit(s, hwId)
  if (target && target !== curId && (!curId || modelScoreOn(s, hwId, target) > modelScoreOn(s, hwId, curId))) {
    deployModel(s, towerId, target)
  }
}

function maybeStudio(s: GameState): void {
  if (s.research.posttrain) return
  if ((s.upgrades['pt_rl'] ?? 0) === 0) return
  if (s.data < 24) return
  const targetsDone = new Set(Object.values(s.derivedModels).map((m) => m.lineage?.target))
  const target: 'reasoning' | 'agentic' = !targetsDone.has('reasoning') ? 'reasoning' : 'agentic'
  if (targetsDone.has(target)) return
  const fp8 = createState(0)
  fp8.infra.weightQuantBytes = 1
  const base = Object.keys(s.models)
    .map((id) => resolveModel(s, id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.origin === 'base')
    .filter((m) => serverFitsMemory(fp8, loadout(fp8, 'hw_frontier', m.id)))
    .sort((a, b) => b.qualityBy[target] - a.qualityBy[target] || b.quality - a.quality)[0]
  if (base && canPostTrain(s, [base.id], 'grpo', target)) startPostTrain(s, [base.id], 'grpo', target, 1.5)
}

function fp8Ready(s: GameState): boolean {
  return s.infra.weightQuantBytes <= 1
}

function ownsBigSpecialist(s: GameState): boolean {
  return Object.values(s.derivedModels).some((m) => m.paramsTotalB >= 100)
}

function bigRackCount(s: GameState): number {
  return s.towers.filter(
    (t) => t.def.kind === 'server' && (t.hwId === 'hw_frontier' || t.hwId === 'hw_pod' || t.hwId === 'hw_superpod'),
  ).length
}

function chooseRole(s: GameState, waveAbout: number): Role {
  if (waveAbout < 7) return 'general'
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return 'general'
  const servers = countKind(s, 'server')
  const wantBigFrac = waveAbout >= 12 ? 0.3 : 0.18
  return bigRackCount(s) < Math.ceil((servers + 1) * wantBigFrac) ? 'frontier' : 'general'
}

function roleCost(s: GameState, role: Role, waveAbout = 0): number {
  const bc = (v: number) => Math.round(v * s.modifiers.buildCost)
  const edge = HARDWARE_DEFS.hw_edge.cost
  if (role === 'small') return bc(edge)
  if (role === 'frontier') return bc(HARDWARE_DEFS.hw_frontier.cost)
  const top = waveAbout >= 6 ? HARDWARE_DEFS.hw_perf.cost : HARDWARE_DEFS.hw_standard.cost
  return bc(edge) + bc(top - edge)
}

function roleHardware(role: Role) {
  return role === 'frontier'
    ? HARDWARE_DEFS.hw_frontier
    : role === 'small'
      ? HARDWARE_DEFS.hw_edge
      : HARDWARE_DEFS.hw_standard
}

function roleDrawKw(role: Role): number {
  return (roleHardware(role).tdpWatts / 1000) * RACK_UTILIZATION
}

function lastTower(s: GameState) {
  return s.towers[s.towers.length - 1]
}

function buildRole(s: GameState, role: Role, slot: Slot | undefined, waveAbout = 0): boolean {
  if (!slot) return false
  if (role === 'frontier') {
    if (!tryBuild(s, 'srv_frontier', slot.col, slot.row)) return false
    const t = lastTower(s)
    deployBest(s, t.id, t.hwId, t.modelId)
    return true
  }
  if (role === 'small') return tryBuild(s, 'srv_edge', slot.col, slot.row)
  if (!tryBuild(s, 'srv_edge', slot.col, slot.row)) return false
  const t = lastTower(s)
  if (!upgradeHardware(s, t.id)) return false
  if (waveAbout >= 6) upgradeHardware(s, t.id)
  deployBest(s, t.id, t.hwId, t.modelId)
  return true
}

function planResearch(s: GameState): void {
  const fleetFlops = s.towers.reduce(
    (n, t) => n + (t.def.kind === 'server' && t.hwId ? (HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : 0),
    0,
  )
  for (const id of RESEARCH_PRIORITY) {
    const def = RESEARCH_DEFS[id]
    if (!def || researchOwned(s, def)) continue
    if (s.research[researchTrackOf(def)]) continue
    if (def.compute / RESEARCH_TARGET_SECONDS > fleetFlops * 0.3) break
    const strongest = s.towers.reduce(
      (m, t) => (t.def.kind === 'server' && t.hwId ? Math.max(m, HARDWARE_DEFS[t.hwId]?.bf16Tflops ?? 0) : m),
      0,
    )
    const reqSeconds = def.compute / Math.max(1, strongest)
    if (strongest > 130 && reqSeconds > 15 && fleetFlops - strongest < 700) break
    if (researchUnlocked(s, def) && s.data >= def.dataCost) startResearch(s, id)
    break
  }
}

function modernizeFleet(s: GameState): void {
  for (const t of s.towers) {
    if (t.def.kind !== 'server' || !t.modelId) continue
    deployBest(s, t.id, t.hwId, t.modelId)
  }
  const edges = s.towers.filter((t) => t.def.kind === 'server' && t.hwId === 'hw_edge')
  for (let i = 0; i + 2 < edges.length; i++) {
    if (s.meters.cash < reserveOf(s) + 12) break
    const t = edges[i]
    if (upgradeHardware(s, t.id)) {
      if (s.infra.kv.utilization >= 0.96 && s.meters.cash > reserveOf(s) + 30) upgradeHardware(s, t.id)
      deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
  if (s.infra.kv.utilization >= 0.96) {
    for (const t of s.towers) {
      if (t.def.kind !== 'server' || t.hwId !== 'hw_standard') continue
      if (s.meters.cash < reserveOf(s) + 22) break
      if (upgradeHardware(s, t.id)) deployBest(s, t.id, t.hwId, t.modelId)
    }
  }
}

function ensureSupport(s: GameState, kind: string, want: number, slots: Slot[], floor?: number): void {
  let guard = 0
  const minCash = floor ?? reserveOf(s) + 25
  while (countDef(s, kind) < want && s.meters.cash > minCash && guard++ < 6) {
    ensureCapacity(s, 1, 1)
    if (!place(s, kind, freeSlot(s, slots))) break
  }
}

function ensureShowcaseResources(s: GameState, waveAbout: number): void {
  const infraSlot = () => freeSlot(s, SLOTS.back) ?? freeSlot(s, SLOTS.lane)
  if (waveAbout >= 5 && countKind(s, 'power') < 1 && s.meters.cash > reserveOf(s) + TOWER_DEFS.power.cost + 10)
    place(s, 'power', infraSlot())
  if (waveAbout >= 5 && countKind(s, 'cooling') < 1 && s.meters.cash > reserveOf(s) + TOWER_DEFS.cooling.cost + 10)
    place(s, 'cooling', infraSlot())
  if (
    waveAbout >= 12 &&
    !hasTowerKind(s, 'cooling_liquid') &&
    s.meters.cash > reserveOf(s) + TOWER_DEFS.cooling_liquid.cost + 25
  ) {
    place(s, 'cooling_liquid', infraSlot())
  }
}

function ensurePodShowcase(s: GameState, waveAbout: number): void {
  if (waveAbout < 14 || !hasTowerKind(s, 'cooling_liquid') || hasHardware(s, 'hw_pod')) return
  // Stand up ONE Pod (8× H200) for throughput + the showcase by upgrading the
  // strongest existing rack up the tiers (perf → frontier → pod). A Pod packs ~8×
  // the bandwidth per board tile, so this also lifts the throughput ceiling the
  // late gauntlet pushes against — relevant now that cheap strong MoEs let the
  // fleet otherwise coast on single H100s and stall on SLA, never needing big iron.
  let guard = 0
  while (!hasHardware(s, 'hw_pod') && guard++ < 3) {
    const t = s.towers
      .filter((x) => x.def.kind === 'server' && (x.hwId === 'hw_perf' || x.hwId === 'hw_frontier'))
      .sort((a, b) => HARDWARE_TIERS.indexOf(b.hwId ?? '') - HARDWARE_TIERS.indexOf(a.hwId ?? ''))[0]
    if (!t) return
    const cost = hardwareUpgradeCost(s, t)
    if (s.meters.cash <= cost + reserveOf(s)) return // keep the full wave-operating-bill buffer
    if (!upgradeHardware(s, t.id)) return
    deployBest(s, t.id, t.hwId, t.modelId)
  }
}

function assignDisaggRoles(s: GameState): void {
  if (!s.infra.disagg) return
  const servers = s.towers.filter((t) => t.def.kind === 'server')
  if (!servers.some((t) => t.role === 'prefill')) {
    const t = servers.find((x) => x.role === undefined)
    if (t) cycleRackRole(s, t.id)
  }
  if (!servers.some((t) => t.role === 'decode')) {
    const t = servers.find((x) => x.role === undefined)
    if (t) {
      cycleRackRole(s, t.id)
      cycleRackRole(s, t.id)
    }
  }
}

function ensureBigRacks(s: GameState, waveAbout: number, want: number): void {
  if (!fp8Ready(s) || !ownsBigSpecialist(s)) return
  const bigReserve = reserveOf(s) // keep the full wave-operating-bill buffer (was 20 + draw·3)
  let guard = 0
  while (bigRackCount(s) < want && guard++ < 4) {
    const perf = s.towers.find((t) => t.def.kind === 'server' && t.hwId === 'hw_perf')
    if (perf && s.meters.cash > hardwareUpgradeCost(s, perf) + bigReserve) {
      if (upgradeHardware(s, perf.id)) {
        deployBest(s, perf.id, perf.hwId, perf.modelId)
        continue
      }
    }
    if (s.meters.cash < roleCost(s, 'frontier', waveAbout) + bigReserve) break
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    ensureCapacity(s, roleDrawKw('frontier'), roleDrawKw('frontier'))
    if (!buildRole(s, 'frontier', slot, waveAbout)) break
  }
}

export function demoPlan(s: GameState, waveAbout: number): void {
  updatePower(s)
  if (waveAbout >= 2 && countKind(s, 'lab') < 1 && s.meters.cash > 55) place(s, 'lab', freeSlot(s, SLOTS.back))
  ensureShowcaseResources(s, waveAbout)
  modernizeFleet(s)
  let pre = 0
  while (
    countKind(s, 'server') < 7 &&
    s.meters.cash > roleCost(s, 'general', waveAbout) + reserveOf(s) &&
    pre++ < 8
  ) {
    ensureCapacity(s, roleDrawKw('general'), roleDrawKw('general'))
    if (!buildRole(s, 'general', freeSlot(s, SLOTS.lane), waveAbout)) break
  }
  ensureSupport(s, 'router', waveAbout >= 8 ? 2 : waveAbout >= 2 ? 1 : 0, SLOTS.lane)
  const guardSlots = SLOTS.core.length ? SLOTS.core : SLOTS.lane
  ensureSupport(s, 'guard_encoder', waveAbout >= 14 ? 3 : waveAbout >= 10 ? 2 : waveAbout >= 4 ? 1 : 0, guardSlots, 20)
  ensureSupport(s, 'guard_llm', waveAbout >= 14 ? 1 : 0, guardSlots, 30)
  ensureSupport(s, 'cache', waveAbout >= 8 ? 3 : waveAbout >= 6 ? 2 : waveAbout >= 4 ? 1 : 0, SLOTS.lane)
  ensureBigRacks(s, waveAbout, waveAbout >= 12 ? 3 : waveAbout >= 9 ? 2 : 1)
  ensurePodShowcase(s, waveAbout)
  const serverTarget = serverTargetFor(waveAbout)
  let guard = 0
  while (countKind(s, 'server') < serverTarget && s.meters.cash > showcaseReserve(s, waveAbout) + 15 && guard++ < 80) {
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    let role = chooseRole(s, waveAbout)
    if (role === 'frontier' && s.meters.cash < roleCost(s, 'frontier', waveAbout) + showcaseReserve(s, waveAbout))
      role = 'general'
    ensureCapacity(s, roleDrawKw(role), roleDrawKw(role))
    if (s.meters.cash < roleCost(s, role, waveAbout) + 5) break
    if (!buildRole(s, role, slot, waveAbout)) break
  }
  ensurePodShowcase(s, waveAbout)
  planResearch(s)
  maybeStudio(s)
  assignDisaggRoles(s)
}

export function demoRunWave(s: GameState, maxBoardSeconds = 240): void {
  let t = 0
  while (s.phase === 'wave' && t < maxBoardSeconds) {
    step(s)
    t += SIM_DT
  }
}

export function demoAutoplay(seed: number): { reached: number; won: boolean; state: GameState } {
  const s = createState(seed)
  startGame(s)
  let reached = 0
  for (let w = 1; w <= WAVES.length; w++) {
    demoPlan(s, w)
    if (!startWave(s)) break
    demoRunWave(s)
    if (s.phase === 'lost') break
    reached = w
    if (s.phase === 'won') return { reached, won: true, state: s }
  }
  return { reached, won: s.phase === 'won', state: s }
}

export function demoAutoplayEndless(s: GameState, surges: number): number {
  if (!continueEndless(s)) return 0
  let survived = 0
  for (let i = 0; i < surges; i++) {
    demoPlan(s, WAVES.length + i)
    if (!startWave(s)) break
    demoRunWave(s)
    if (s.phase === 'lost') break
    survived++
  }
  return survived
}

export function demoDeployedModelIds(s: GameState): Set<string> {
  const ids = new Set<string>()
  for (const t of s.towers) if (t.def.kind === 'server' && t.modelId) ids.add(t.modelId)
  return ids
}

export function nextDemoWaveNumber(s: GameState): number {
  return s.endless ? s.waveIndex + 1 : s.waveIndex + 2
}

export function demoCanContinueCampaign(s: GameState): boolean {
  return s.phase === 'build' && (s.endless || nextDemoWaveNumber(s) <= WAVES.length)
}
