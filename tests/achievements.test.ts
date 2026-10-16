/**
 * Achievement unlock rules (src/achievements.ts): every achievement must be earnable
 * under the current rules, and none may be free.
 */
import { describe, expect, it } from 'vitest'
import type { GameState, WaveReport } from '../src/core/types'
import {
  ACH_BY_ID,
  AchievementTracker,
  infraTreeComplete,
  laneHasTwoGuardFamilies,
} from '../src/achievements'
import { tryBuild } from '../src/sim/actions'
import { CAMPAIGN_THEMES } from '../src/sim/campaign'
import { GRID_COLS, GRID_ROWS } from '../src/config'
import { INFRA_LIST, MODEL_LIST } from '../src/sim/content'
import { guardCoveredLanes } from '../src/sim/guards'
import { isBuildable, isPathTile } from '../src/sim/pathing'
import { createState } from '../src/sim/state'

function buildPhase(): GameState {
  const s = createState(11)
  s.phase = 'build'
  s.meters.cash = 1e7
  return s
}

/** A clean wave report (every count given; the rest zero). */
function report(waveIndex: number, counts: Partial<WaveReport> = {}): WaveReport {
  const base: WaveReport = {
    waveIndex,
    served: 40,
    sloMiss: 0,
    bad: 0,
    unservable: 0,
    unsafe: 0,
    overRefused: 0,
    leaked: 0,
    cacheHits: 0,
    cashIn: 0,
    clearBonus: 0,
    powerCost: 0,
    avgLatency: 0,
    p95Latency: 0,
    avgTtft: 0,
    p95Ttft: 0,
    goodputPct: 100,
    duration: 1,
    byType: {},
  }
  const r = { ...base, ...counts }
  r.total = r.served + r.sloMiss + r.bad + r.unservable + r.unsafe + r.overRefused + r.leaked
  return r
}

const unlocked = (tr: AchievementTracker): string[] => tr.drainUnlocks().map((d) => d.id)

/** A buildable tile next to a lane (guards screen the lanes their range touches). */
function laneSideTiles(): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  for (let col = 0; col < GRID_COLS; col++)
    for (let row = 0; row < GRID_ROWS; row++) {
      if (!isBuildable(col, row)) continue
      if ([-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => isPathTile(col + dc, row + dr))))
        out.push({ col, row })
    }
  return out
}

describe('achievements — Tech Tree Complete counts one side of each fork', () => {
  const all = Object.fromEntries(INFRA_LIST.map((n) => [n.id, 1]))

  it('is complete with every node except the rival side of each fork', () => {
    const up = { ...all }
    delete up['inf_disagg']
    delete up['inf_engine_trtllm']
    expect(infraTreeComplete(up)).toBe(true)
    const other = { ...all }
    delete other['inf_chunked']
    delete other['inf_engine_sglang']
    expect(infraTreeComplete(other)).toBe(true)
  })

  it('is not complete while a node outside the forks is missing, or a fork is untouched', () => {
    const up = { ...all }
    delete up['inf_disagg']
    delete up['inf_engine_trtllm']
    delete up['inf_flash']
    expect(infraTreeComplete(up)).toBe(false)
    const fork = { ...all }
    delete fork['inf_chunked']
    delete fork['inf_disagg']
    expect(infraTreeComplete(fork)).toBe(false)
  })
})

describe('achievements — Defense in Depth needs two guard families on one lane', () => {
  it('one family (even several copies) is not enough; an encoder plus an LLM judge on a shared lane is', () => {
    const s = buildPhase()
    const tiles = laneSideTiles()
    const [a, b] = tiles
    expect(tryBuild(s, 'guard_encoder', a.col, a.row)).toBe(true)
    expect(tryBuild(s, 'guard_encoder', b.col, b.row)).toBe(true)
    expect(laneHasTwoGuardFamilies(s)).toBe(false)
    const enc = s.towers.find((t) => t.col === a.col && t.row === a.row)!
    const lanes = new Set(guardCoveredLanes(enc))
    // an LLM guard on a tile that shares a lane with the encoder
    for (const tile of tiles.slice(2)) {
      if (!tryBuild(s, 'guard_llm', tile.col, tile.row)) continue
      const llm = s.towers[s.towers.length - 1]
      if (guardCoveredLanes(llm).some((l) => lanes.has(l))) break
      s.towers.pop()
    }
    expect(laneHasTwoGuardFamilies(s)).toBe(true)
    const tr = new AchievementTracker()
    tr.tick(s)
    expect(unlocked(tr)).toContain('sf_depth')
  })
})

describe('achievements — David is earned on a hard wave only', () => {
  it('the small starter fleet does not earn it on an ordinary early wave', () => {
    const s = buildPhase()
    const t = laneSideTiles()[0]
    expect(tryBuild(s, 'srv_edge', t.col, t.row)).toBe(true)
    const tr = new AchievementTracker()
    tr.onWaveCleared(s, report(0))
    expect(unlocked(tr)).not.toContain('m_david')
  })

  it('a boss wave or any wave from 20 on cleared with only ≤9B models earns it', () => {
    const boss = CAMPAIGN_THEMES.findIndex((th) => th.boss)
    expect(boss).toBeGreaterThanOrEqual(0)
    for (const idx of [boss, 19]) {
      const s = buildPhase()
      const t = laneSideTiles()[0]
      expect(tryBuild(s, 'srv_edge', t.col, t.row)).toBe(true)
      const tr = new AchievementTracker()
      tr.onWaveCleared(s, report(idx))
      expect(unlocked(tr), `wave index ${idx}`).toContain('m_david')
    }
  })
})

describe('achievements — Flawless means every outcome was clean', () => {
  it('a single late, refused or dropped request breaks it', () => {
    const s = buildPhase()
    for (const bad of [{ sloMiss: 1 }, { overRefused: 1 }, { leaked: 1 }, { unservable: 1 }]) {
      const tr = new AchievementTracker()
      tr.onWaveCleared(s, report(3, bad))
      expect(unlocked(tr), JSON.stringify(bad)).not.toContain('s_flawless')
    }
    const tr = new AchievementTracker()
    tr.onWaveCleared(s, report(3))
    expect(unlocked(tr)).toContain('s_flawless')
  })
})

describe('achievements — Collector scales with the active roster', () => {
  it('its tiers end at the whole active roster', () => {
    const n = MODEL_LIST.length
    expect(ACH_BY_ID['m_collector'].goals).toEqual([Math.min(10, n), Math.round(n * 0.6), n])
  })
})
