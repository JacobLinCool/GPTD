// Agent snapshot: a compact, JSON-safe view of the live GameState for a remote
// agent to reason over. GameState itself is NOT safe to JSON.stringify (it holds
// the RNG class instance, Sets, and shared `def` object references), so we build
// a flat, self-sufficient decision context here from the same helpers the UI uses
// — an agent with NO repo source should be able to play from this alone.
import { GRID_COLS, GRID_ROWS } from '../config'
import type { GameState, Outcome, SafetyHazard, TowerDef, WaveReport } from '../core/types'
import { buildCost, hardwareUpgradeCost, isLastWave, nextHardware, towerValue } from '../sim/actions'
import { CAMPAIGN_THEMES } from '../sim/campaign'
import {
  BUILD_ORDER,
  HARDWARE_DEFS,
  HARDWARE_TIERS,
  METHOD_RECIPES,
  RESEARCH_DEFS,
  RESEARCH_LIST,
  TOWER_DEFS,
  UPGRADES,
  WAVES,
} from '../sim/content'
import { guardLatencyMs, hasLab, hasLiquidLoop, hwNeedsLiquid, loadout, serverFitsMemory, towerRangeTiles } from '../sim/effects'
import { guardCoveredLanes } from '../sim/guards'
import { EFFORT_NOTCHES, postTrainDataCost, resolveModel } from '../sim/models'
import { CORE_TILE, isBuildable, isPathTile } from '../sim/pathing'
import { methodUnlocked, researchUnlocked } from '../sim/research'
import { alignmentTax, categoryUnlocked, effRecall, overRefuse, overrefMul, redteamRecallBonus } from '../sim/safety'
import { surgeLaneOf } from '../sim/spawn'

export interface AgentTowerView {
  id: number
  defId: string
  name: string
  kind: string
  col: number
  row: number
  level: number
  online: boolean
  /** coverage radius in tiles (a server's grows with its hardware tier). */
  range: number
  /** guardrails only: the ingress lanes it screens (every request on them, wherever it sits). */
  coversLanes?: number[]
  hwId?: string
  modelId?: string
  role?: string
  training?: boolean
  load: number
  sellValue: number
  nextHwId?: string
  upgradeCost?: number
  /** owned model ids that fit this rack's VRAM right now (deploy targets) */
  deployableModelIds: string[]
}

/** A guardrail building's screening behaviour at the current threshold and red-team level. */
export interface AgentGuardrailSpec {
  archetype: string
  /** input → adds to TTFT (and can block before any compute); output → adds to E2EL; both → each end once. */
  side: string
  /** real ms one check adds. */
  latencyMs: number
  /** catch probability for each hazard it covers (replicas of one archetype add lane coverage, not recall). */
  recall: number
  /** wrongly-blocked rate on a BORDERLINE benign request (× each archetype's refusal exposure). */
  falsePositiveRate: number
  catches: Array<{ hazard: string; locked: boolean; unlockedBy?: string }>
}

export interface AgentCatalogEntry {
  defId: string
  name: string
  kind: string
  cost: number
  range: number
  affordable: boolean
  blockedReason?: string
  guardrail?: AgentGuardrailSpec
}

export interface AgentModelView {
  id: string
  name: string
  tier: string
  quality: number
  /** answer quality per capability axis (before the alignment tax); a request is judged on ONE axis. */
  qualityBy: Record<string, number>
  contextWindowK: number
  paramsTotalB: number
  paramsActiveB: number
  isMoE: boolean
  isReasoning: boolean
  /** layer-1 alignment: intrinsic safety 0..100, refusal style, borderline over-refusal rate. */
  alignment: { safety: number; refusalStyle: string; overRefusal: number }
  /** quality points the alignment costs on every axis at serve time. */
  alignmentTax: number
}

/** A wave report with its Trust/SLA ledgers, ready for JSON (values rounded). */
export type AgentWaveReport = Omit<WaveReport, 'waveIndex'> & { wave: number }

export interface AgentHardwareView {
  id: string
  name: string
  hbmGb: number
  gpus: number
  cooling: string
  tier: number
  deployableModelIds: string[]
}

export interface AgentUpgradeView {
  id: string
  name: string
  path: string
  cashCost: number
  dataCost: number
  level: number
  maxLevel: number
  buyable: boolean
}

export interface AgentResearchOption {
  id: string
  kind: string
  name: string
  desc: string
  dataCost: number
  compute: number
  requires: string[]
}

export interface AgentStudioMethod {
  id: string
  name: string
  relation: string
  allowedTargets: string[]
  dataCost: number
  unlocked: boolean
  requiresTech: string | null
  desc: string
}

export interface AgentSnapshot {
  phase: string
  wave: number
  totalWaves: number
  isLastWave: boolean
  waveActive: boolean
  endless: boolean
  meters: { cash: number; trust: number; sla: number; data: number }
  power: { used: number; cap: number }
  cooling: { used: number; cap: number }
  flags: { hasLab: boolean; hasLiquidLoop: boolean }
  modifiers: {
    buildCost: number
    powerPrice: number
    coolingCap: number
    safetyDamage: number
    volume: number
    reward: number
  }
  incident: { id: string; name: string; desc: string; good: boolean } | null
  nextWave:
    | {
        wave: number
        name: string
        brief: string
        clearBonus: number
        totalRequests: number
        mix: Array<{ typeId: string; count: number }>
        boss: boolean
        /** the one ingress lane the whole wave funnels into (authored surge or incident), null = spread. */
        surgeLane: number | null
        /** the incident telegraphed for this wave (details in `incident`), null = none. */
        incidentId: string | null
      }
    | null
  /** the settled report of the last cleared wave, incl. per-outcome Trust/SLA ledgers. */
  lastReport: AgentWaveReport | null
  board: { cols: number; rows: number; core: { col: number; row: number }; freeTiles: Array<{ col: number; row: number; nearLane: boolean }> }
  towers: AgentTowerView[]
  catalog: AgentCatalogEntry[]
  hardware: AgentHardwareView[]
  models: AgentModelView[]
  upgrades: AgentUpgradeView[]
  research: {
    infra: string | null
    posttrain: string | null
    eval: string | null
    options: AgentResearchOption[]
  }
  studio: {
    available: boolean
    baseModelIds: string[]
    targets: string[]
    effortNotches: number[]
    methods: AgentStudioMethod[]
    activeRun: { method: string | null; target: string | null; effort: number | null; progressPct: number } | null
  }
  stats: {
    served: number
    sloMiss: number
    bad: number
    unservable: number
    unsafe: number
    overRefused: number
    leaked: number
    cashEarned: number
    peakConcurrent: number
    lastReportWave: number | null
    /** cumulative Trust / SLA lost per outcome over the run (what is draining the meters). */
    trustLostBy: Partial<Record<Outcome, number>>
    slaLostBy: Partial<Record<Outcome, number>>
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100

function roundLedger<K extends string>(l: Partial<Record<K, number>> | undefined): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {}
  for (const [k, v] of Object.entries(l ?? {}) as [K, number][]) out[k] = round2(v)
  return out
}

function modelView(s: GameState, id: string): AgentModelView | null {
  const m = resolveModel(s, id)
  if (!m) return null
  const qualityBy: Record<string, number> = {}
  for (const [axis, q] of Object.entries(m.qualityBy)) qualityBy[axis] = Math.round(q * 10) / 10
  return {
    id: m.id,
    name: m.name,
    tier: m.tier,
    quality: Math.round(m.quality),
    qualityBy,
    contextWindowK: m.contextWindowK,
    paramsTotalB: m.paramsTotalB,
    paramsActiveB: m.paramsActiveB,
    isMoE: m.isMoE,
    isReasoning: m.isReasoning,
    alignment: {
      safety: Math.round(m.alignment.safety),
      refusalStyle: m.alignment.refusalStyle,
      overRefusal: Math.round(m.alignment.overRefusal * 1000) / 1000,
    },
    alignmentTax: round2(alignmentTax(m)),
  }
}

/** The red-team eval that unlocks a guardrail's detection of a hazard category (§3.6). */
const UNLOCKED_BY: Partial<Record<SafetyHazard, string>> = {
  injection: 'r_eval_redteam_v1',
  pii: 'r_eval_redteam_v2',
}

function guardrailView(s: GameState, def: TowerDef): AgentGuardrailSpec | undefined {
  const g = def.guardrail
  if (!g) return undefined
  return {
    archetype: g.archetype,
    side: g.side,
    latencyMs: Math.round(guardLatencyMs(s, g)),
    recall: Math.round(effRecall(g.baseRecall, s.guardrailThreshold, redteamRecallBonus(s)) * 1000) / 1000,
    falsePositiveRate: Math.round(overRefuse(g.archetype, s.guardrailThreshold, overrefMul(s)) * 10000) / 10000,
    catches: g.catches.map((h) => {
      const locked = !categoryUnlocked(s, h)
      return locked ? { hazard: h, locked, unlockedBy: UNLOCKED_BY[h] } : { hazard: h, locked }
    }),
  }
}

function reportView(r: WaveReport | null): AgentWaveReport | null {
  if (!r) return null
  const { waveIndex, ...rest } = r
  return {
    ...rest,
    wave: waveIndex + 1,
    cashIn: round2(r.cashIn),
    powerCost: round2(r.powerCost),
    avgLatency: Math.round(r.avgLatency * 1000) / 1000,
    p95Latency: Math.round(r.p95Latency * 1000) / 1000,
    avgTtft: Math.round(r.avgTtft * 1000) / 1000,
    p95Ttft: Math.round(r.p95Ttft * 1000) / 1000,
    goodputPct: Math.round(r.goodputPct * 10) / 10,
    sloAttainPct: r.sloAttainPct === undefined ? undefined : Math.round(r.sloAttainPct * 10) / 10,
    duration: round2(r.duration),
    trustLostBy: roundLedger(r.trustLostBy),
    slaLostBy: roundLedger(r.slaLostBy),
    byType: Object.fromEntries(Object.entries(r.byType).map(([k, v]) => [k, { ...v, cash: round2(v.cash) }])),
  }
}

export function serializeState(s: GameState): AgentSnapshot {
  const ownedIds = Object.keys(s.models)

  // Per-hardware-tier deployability (VRAM fit) — computed once, reused per rack.
  const deployableByHw: Record<string, string[]> = {}
  for (const hwId of HARDWARE_TIERS) {
    deployableByHw[hwId] = ownedIds.filter((id) => serverFitsMemory(s, loadout(s, hwId, id)))
  }

  const occupied = new Set(s.towers.map((t) => `${t.col},${t.row}`))
  const freeTiles: Array<{ col: number; row: number; nearLane: boolean }> = []
  for (let col = 0; col < GRID_COLS; col++) {
    for (let row = 0; row < GRID_ROWS; row++) {
      if (!isBuildable(col, row) || occupied.has(`${col},${row}`)) continue
      let nearLane = false
      for (let dc = -1; dc <= 1 && !nearLane; dc++) {
        for (let dr = -1; dr <= 1 && !nearLane; dr++) {
          if (isPathTile(col + dc, row + dr)) nearLane = true
        }
      }
      freeTiles.push({ col, row, nearLane })
    }
  }

  const liquidReady = hasLiquidLoop(s)
  const catalog: AgentCatalogEntry[] = BUILD_ORDER.map((id) => {
    const def = TOWER_DEFS[id]
    const cost = buildCost(s, def)
    const needsLiquid =
      def.kind === 'server' && def.hardwareId ? hwNeedsLiquid(HARDWARE_DEFS[def.hardwareId]) : false
    let blockedReason: string | undefined
    if (needsLiquid && !liquidReady) blockedReason = 'needs a Liquid Cooling Loop on the board'
    else if (s.meters.cash < cost) blockedReason = 'not enough cash'
    return {
      defId: def.id,
      name: def.name,
      kind: def.kind,
      cost,
      range: def.range,
      affordable: s.meters.cash >= cost,
      blockedReason,
      guardrail: guardrailView(s, def),
    }
  })

  const hardware: AgentHardwareView[] = HARDWARE_TIERS.map((hwId, i) => {
    const hw = HARDWARE_DEFS[hwId]
    return {
      id: hwId,
      name: hw.name,
      hbmGb: hw.hbmGb,
      gpus: hw.gpus,
      cooling: hw.cooling,
      tier: i,
      deployableModelIds: deployableByHw[hwId] ?? [],
    }
  })

  const towers: AgentTowerView[] = s.towers.map((t) => {
    const nh = nextHardware(t)
    return {
      id: t.id,
      defId: t.def.id,
      name: t.def.name,
      kind: t.def.kind,
      col: t.col,
      row: t.row,
      level: t.level,
      online: t.online,
      range: towerRangeTiles(t),
      coversLanes: t.def.kind === 'guardrail' ? guardCoveredLanes(t) : undefined,
      hwId: t.hwId,
      modelId: t.modelId,
      role: t.role,
      training: t.training,
      load: Math.round(t.load * 100) / 100,
      sellValue: towerValue(s, t),
      nextHwId: nh?.id,
      upgradeCost: nh ? hardwareUpgradeCost(s, t) : undefined,
      deployableModelIds: t.def.kind === 'server' && t.hwId ? (deployableByHw[t.hwId] ?? []) : [],
    }
  })

  const models = ownedIds.map((id) => modelView(s, id)).filter((m): m is AgentModelView => m !== null)

  const labReady = hasLab(s)
  const upgrades: AgentUpgradeView[] = labReady
    ? UPGRADES.map((u) => {
        const level = s.upgrades[u.id] ?? 0
        const prereqMet = (u.requires ?? []).every((r) => (s.upgrades[r] ?? 0) > 0)
        const buyable =
          level < u.maxLevel && prereqMet && s.meters.cash >= u.cashCost && s.data >= u.dataCost
        return {
          id: u.id,
          name: u.name,
          path: u.path,
          cashCost: u.cashCost,
          dataCost: u.dataCost,
          level,
          maxLevel: u.maxLevel,
          buyable,
        }
      })
    : []

  const researchOptions: AgentResearchOption[] = RESEARCH_LIST.filter((def) =>
    researchUnlocked(s, def),
  ).map((def) => ({
    id: def.id,
    kind: def.kind,
    name: def.name,
    desc: def.desc,
    dataCost: def.dataCost,
    compute: def.compute,
    requires: (def.requires ?? []).map((r) => RESEARCH_DEFS[r]?.name ?? r),
  }))

  const methods: AgentStudioMethod[] = Object.values(METHOD_RECIPES).map((r) => ({
    id: r.id,
    name: r.name,
    relation: r.relation,
    allowedTargets: r.allowedTargets,
    dataCost: postTrainDataCost(r, 1),
    unlocked: methodUnlocked(s, r.id),
    requiresTech: r.requiresTech ?? null,
    desc: r.desc,
  }))
  const targets = [...new Set(Object.values(METHOD_RECIPES).flatMap((r) => r.allowedTargets))]
  const pt = s.research.posttrain
  const activeRun = pt
    ? {
        method: pt.meta?.method ?? null,
        target: pt.meta?.target ?? null,
        effort: pt.meta?.effort ?? null,
        progressPct: pt.compute > 0 ? Math.round((pt.progress / pt.compute) * 100) : 0,
      }
    : null

  // startWave does waveIndex++ then plays WAVES[waveIndex], so the wave a build-phase
  // startWave will launch next is WAVES[waveIndex + 1] (waveIndex starts at -1).
  let nextWave: AgentSnapshot['nextWave'] = null
  const upcomingIdx = s.waveIndex + 1
  const upcoming = s.phase === 'build' && !s.endless && upcomingIdx < WAVES.length ? WAVES[upcomingIdx] : null
  if (upcoming) {
    const mixMap: Record<string, number> = {}
    let total = 0
    for (const g of upcoming.groups) {
      mixMap[g.typeId] = (mixMap[g.typeId] ?? 0) + g.count
      total += g.count
    }
    nextWave = {
      wave: upcomingIdx + 1,
      name: upcoming.name,
      brief: upcoming.brief,
      clearBonus: upcoming.clearBonus,
      totalRequests: total,
      mix: Object.entries(mixMap)
        .map(([typeId, count]) => ({ typeId, count }))
        .sort((a, b) => b.count - a.count),
      boss: CAMPAIGN_THEMES[upcomingIdx]?.boss ?? false,
      surgeLane: surgeLaneOf(upcoming.groups, s.laneWindow) ?? null,
      incidentId: s.pendingIncident?.id ?? null,
    }
  }

  return {
    phase: s.phase,
    wave: s.waveIndex + 1,
    totalWaves: WAVES.length,
    isLastWave: isLastWave(s),
    waveActive: s.waveActive,
    endless: s.endless,
    meters: {
      cash: Math.floor(s.meters.cash),
      trust: Math.round(s.meters.trust),
      sla: Math.round(s.meters.sla),
      data: Math.floor(s.data),
    },
    // live in every phase: the sim recomputes power after each build action (refreshPower)
    power: { used: round2(s.power.used), cap: round2(s.power.cap) },
    cooling: { used: round2(s.cooling.used), cap: round2(s.cooling.cap) },
    flags: { hasLab: labReady, hasLiquidLoop: liquidReady },
    modifiers: {
      buildCost: s.modifiers.buildCost,
      powerPrice: s.modifiers.powerPrice,
      coolingCap: s.modifiers.coolingCap,
      safetyDamage: s.modifiers.safetyDamage,
      volume: s.modifiers.volume,
      reward: s.modifiers.reward,
    },
    incident: s.pendingIncident
      ? {
          id: s.pendingIncident.id,
          name: s.pendingIncident.name,
          desc: s.pendingIncident.desc,
          good: s.pendingIncident.good ?? false,
        }
      : null,
    nextWave,
    lastReport: reportView(s.lastReport),
    board: {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      core: { col: CORE_TILE.col, row: CORE_TILE.row },
      freeTiles,
    },
    towers,
    catalog,
    hardware,
    models,
    upgrades,
    research: {
      infra: s.research.infra?.id ?? null,
      posttrain: s.research.posttrain?.id ?? null,
      eval: s.research.eval?.id ?? null,
      options: researchOptions,
    },
    studio: {
      available: labReady,
      baseModelIds: ownedIds,
      targets,
      effortNotches: [...EFFORT_NOTCHES],
      methods,
      activeRun,
    },
    stats: {
      served: s.stats.served,
      sloMiss: s.stats.sloMiss,
      bad: s.stats.bad,
      unservable: s.stats.unservable,
      unsafe: s.stats.unsafe,
      overRefused: s.stats.overRefused,
      leaked: s.stats.leaked,
      cashEarned: Math.round(s.stats.cashEarned),
      peakConcurrent: s.stats.peakConcurrent,
      lastReportWave: s.lastReport ? s.lastReport.waveIndex + 1 : null,
      trustLostBy: roundLedger(s.stats.trustLostBy),
      slaLostBy: roundLedger(s.stats.slaLostBy),
    },
  }
}
