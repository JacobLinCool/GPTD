import { describe, expect, it } from 'vitest'
import { GRID_COLS, GRID_ROWS, SIM_DT } from '../src/config'
import type { GameState } from '../src/core/types'
import { buildCost, buyUpgrade, startGame, startWave, tryBuild } from '../src/sim/actions'
import { TOWER_DEFS, WAVES } from '../src/sim/content'
import { serverPower } from '../src/sim/effects'
import { isBuildable, isPathTile } from '../src/sim/pathing'
import { updatePower } from '../src/sim/power'
import { step } from '../src/sim/sim'
import { createState } from '../src/sim/state'

interface Slot {
  col: number
  row: number
}

function adjacentToLane(col: number, row: number): boolean {
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) if (isPathTile(col + dc, row + dr)) return true
  return false
}

function buildSlots(): { lane: Slot[]; back: Slot[]; core: Slot[] } {
  const top: Slot[] = []
  const mid: Slot[] = []
  const bottom: Slot[] = []
  const back: Slot[] = []
  const core: Slot[] = []
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (!isBuildable(c, r)) continue
      if (adjacentToLane(c, r)) {
        if (r <= 2) top.push({ col: c, row: r })
        else if (r <= 6) mid.push({ col: c, row: r })
        else bottom.push({ col: c, row: r })
        if (c >= 16 && r >= 6) core.push({ col: c, row: r })
      } else back.push({ col: c, row: r })
    }
  }
  // interleave the three runs so coverage spreads along the whole path
  const lane: Slot[] = []
  const maxLen = Math.max(top.length, mid.length, bottom.length)
  for (let i = 0; i < maxLen; i++) {
    if (top[i]) lane.push(top[i])
    if (mid[i]) lane.push(mid[i])
    if (bottom[i]) lane.push(bottom[i])
  }
  return { lane, back, core }
}

const SLOTS = buildSlots()

function countKind(s: GameState, kind: string): number {
  return s.towers.filter((t) => t.def.kind === kind).length
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
    (n, t) => n + (t.def.kind === 'server' ? serverPower(s, t.def) : (t.def.powerDraw ?? 0)),
    0,
  )
}
function estHeat(s: GameState): number {
  return s.towers.reduce((n, t) => n + (t.def.heat ?? 0), 0)
}
function ensureCapacity(s: GameState, addDraw: number, addHeat: number): void {
  updatePower(s)
  let guard = 0
  while (estDraw(s) + addDraw > s.power.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'power', freeSlot(s, SLOTS.back))) break
    updatePower(s)
  }
  guard = 0
  while (estHeat(s) + addHeat > s.cooling.cap - 1 && s.meters.cash >= 70 && guard++ < 12) {
    if (!place(s, 'cooling', freeSlot(s, SLOTS.back))) break
    updatePower(s)
  }
}

const UPGRADE_PRIORITY = [
  'scale_pretrain',
  'prod_route',
  'saf_rlhf',
  'eff_quant',
  'prod_batch',
  'scale_throughput',
  'prod_cache',
  'saf_redteam',
  'eff_spec',
  'eff_distill',
]

function countDef(s: GameState, id: string): number {
  return s.towers.filter((t) => t.def.id === id).length
}

/** Cash buffer that scales with power draw, to bridge a wave's power costs until income flows. */
function reserveOf(s: GameState): number {
  return 90 + estDraw(s) * 3
}

function buyAffordable(s: GameState, budget: number): void {
  let bought = 0
  for (let pass = 0; pass < 6 && bought < budget; pass++) {
    let any = false
    for (const id of UPGRADE_PRIORITY) {
      if (bought >= budget) break
      if (s.meters.cash < reserveOf(s) + 120) continue
      if (buyUpgrade(s, id)) {
        bought++
        any = true
      }
    }
    if (!any) break
  }
}

function chooseServer(s: GameState, waveAbout: number): string {
  const servers = countKind(s, 'server')
  const frontiers = countDef(s, 'srv_frontier')
  const coding = countDef(s, 'srv_coding')
  const wantFrac = waveAbout >= 12 ? 0.42 : waveAbout >= 7 ? 0.3 : waveAbout >= 5 ? 0.2 : 0
  if (wantFrac > 0 && frontiers < Math.ceil((servers + 1) * wantFrac)) return 'srv_frontier'
  if (waveAbout >= 2 && coding < 2 && servers % 4 === 3) return 'srv_coding'
  if (waveAbout <= 1 && servers < 2) return 'srv_small'
  return 'srv_general'
}

function ensureSupport(s: GameState, kind: string, want: number, slots: Slot[]): void {
  let guard = 0
  while (countKind(s, kind) < want && s.meters.cash > reserveOf(s) + 100 && guard++ < 6) {
    ensureCapacity(s, 1, 1)
    if (!place(s, kind, freeSlot(s, slots))) break
  }
}

function plan(s: GameState, waveAbout: number): void {
  updatePower(s)
  if (waveAbout >= 3 && countKind(s, 'lab') < 1 && s.meters.cash > reserveOf(s) + 140)
    place(s, 'lab', freeSlot(s, SLOTS.back))
  if (countKind(s, 'lab') > 0) buyAffordable(s, 2)
  ensureSupport(s, 'router', waveAbout >= 8 ? 2 : waveAbout >= 2 ? 1 : 0, SLOTS.lane)
  ensureSupport(
    s,
    'safety',
    waveAbout >= 14 ? 3 : waveAbout >= 10 ? 2 : waveAbout >= 4 ? 1 : 0,
    SLOTS.core.length ? SLOTS.core : SLOTS.lane,
  )
  ensureSupport(s, 'cache', waveAbout >= 6 ? 2 : 0, SLOTS.lane)

  let guard = 0
  while (s.meters.cash > reserveOf(s) && guard++ < 80) {
    const slot = freeSlot(s, SLOTS.lane)
    if (!slot) break
    const defId = chooseServer(s, waveAbout)
    const def = TOWER_DEFS[defId]
    ensureCapacity(s, serverPower(s, def), def.heat ?? 0)
    if (s.meters.cash < buildCost(s, def) + 5) break
    if (!place(s, defId, slot)) break
  }
}

function runWave(s: GameState): void {
  let t = 0
  while (s.phase === 'wave' && t < 240) {
    step(s)
    t += SIM_DT
  }
}

function autoplay(seed: number): { reached: number; won: boolean; state: GameState } {
  const s = createState(seed)
  startGame(s)
  let reached = 0
  for (let w = 1; w <= WAVES.length; w++) {
    plan(s, w)
    if (!startWave(s)) break
    runWave(s)
    if (s.phase === 'lost') break
    reached = w
    if (s.phase === 'won') return { reached, won: true, state: s }
  }
  return { reached, won: s.phase === 'won', state: s }
}

describe('balance: heuristic autoplay', () => {
  it('a sensible strategy clears the full campaign', () => {
    const r = autoplay(2026)
    const fr = countDef(r.state, 'srv_frontier')
    const sf = countKind(r.state, 'safety')
    console.log(
      `autoplay reached wave ${r.reached}/${WAVES.length}, won=${r.won}, ` +
        `trust=${r.state.meters.trust.toFixed(0)} sla=${r.state.meters.sla.toFixed(0)} ` +
        `cash=${r.state.meters.cash.toFixed(0)} towers=${r.state.towers.length} ` +
        `frontier=${fr} safety=${sf} stats=${JSON.stringify(r.state.stats)} ` +
        `pretrain=${r.state.upgrades['scale_pretrain'] ?? 0} rlhf=${r.state.upgrades['saf_rlhf'] ?? 0}`,
    )
    // A strong, well-rounded build clears the full 20-wave campaign.
    expect(r.won).toBe(true)
    expect(r.reached).toBe(WAVES.length)
  })

  it('is winnable across multiple seeds', () => {
    const results = [101, 202, 303].map((seed) => autoplay(seed))
    for (const r of results) {
      console.log(`seed reached ${r.reached}, won=${r.won}`)
    }
    expect(results.every((r) => r.won)).toBe(true)
  })
})
