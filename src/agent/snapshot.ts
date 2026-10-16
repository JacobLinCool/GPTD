// Agent snapshot: a compact, JSON-safe view of the live GameState for a remote
// agent to reason over. GameState itself is NOT safe to JSON.stringify (it holds
// the RNG class instance, Sets, and shared `def` object references), so we build
// a flat, self-sufficient decision context here from the same helpers the UI uses
// — an agent with NO repo source should be able to play from this alone.
import { GRID_COLS, GRID_ROWS } from '../config'
import type { GameState, Outcome, SafetyHazard, TowerDef, WaveReport } from '../core/types'
import { buildCost, hardwareUpgradeCost, isLastWave, nextHardware, towerValue } from '../sim/actions'
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
import {
  availableFormats,
  guardLatencyMs,
  hasLab,
  hasLiquidLoop,
  hwNeedsLiquid,
  loadout,
  loadoutOf,
  servingFormat,
  serverFitsMemory,
  towerRangeTiles,
} from '../sim/effects'
import { en } from '../i18n/en'
import { guardCoveredLanes } from '../sim/guards'
import { EFFORT_NOTCHES, postTrainDataCost, resolveModel } from '../sim/models'
import { CORE_TILE, isBuildable, isPathTile } from '../sim/pathing'
import { methodUnlocked, requisitionPreview, researchUnlocked } from '../sim/research'
import { alignmentTax, categoryUnlocked, effRecall, overRefuse, overrefMul, redteamRecallBonus } from '../sim/safety'
import { previewNextWave } from '../sim/preview'

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
  /** servers: the weight format the rack serves in right now ('bf16' | 'fp8' | 'int4' | 'nvfp4'). */
  format?: string
  /** servers: the rack's format setting — 'auto' (the fastest lossless one that fits) or an explicit format. */
  formatSetting?: string
  /** servers: the formats this rack may be set to with setRackPrecision (researched + its model's release format). */
  formats?: string[]
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
  /**
   * display class (small / general / coding / frontier): the band the UI files a checkpoint
   * under, set by its peak capability as well as its size, so a strong small model can read
   * 'frontier'. It is not a size class: read paramsTotalB for size.
   */
  tier: string
  quality: number
  /** answer quality per capability axis (before the alignment tax); a request is judged on ONE axis. */
  qualityBy: Record<string, number>
  contextWindowK: number
  paramsTotalB: number
  paramsActiveB: number
  isMoE: boolean
  isReasoning: boolean
  /**
   * thinking support: 'hybrid' answers interactive traffic (chat, completion) with thinking off,
   * judged on `qualityByInstant`, and thinks about the rest; 'always' thinks on every answer;
   * 'never' answers at once.
   */
  thinking: string
  /** a hybrid's capability with thinking off (absent for single-mode models). */
  qualityByInstant?: Record<string, number>
  /** hidden reasoning tokens per thinking-mode answer at full effort (× the archetype's thinkMul). */
  thinkTokens: number
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
  /** the Liquid Cooling Loops' own pool (inside `cooling`): it cools only liquid-cooled racks. */
  coolingLiquid: { used: number; cap: number }
  flags: { hasLab: boolean; hasLiquidLoop: boolean }
  modifiers: {
    buildCost: number
    powerPrice: number
    coolingCap: number
    safetyDamage: number
    volume: number
    reward: number
    /** usable share of the power feed (a grid curtailment order cuts it). */
    powerCap: number
    /** 0 = no new Power Plant can be connected (interconnection freeze). */
    powerBuild: number
    /** multiplier on every SLA penalty (an enterprise pilot). */
    slaDamage: number
  }
  incident: { id: string; name: string; desc: string; good: boolean } | null
  nextWave:
    | {
        wave: number
        name: string
        brief: string
        /** the wave's SLA contract in credits at 100% Goodput; the paid bonus is this × Goodput. */
        clearBonus: number
        /** requests the wave will spawn — the incident's volume multiplier already folded in. */
        totalRequests: number
        /** per archetype: count, latency class, the judged axis and its difficulty, tokens, hazards. */
        mix: Array<{
          typeId: string
          count: number
          latClass: string
          axis: string
          difficulty: number
          inputTokens: number
          outputTokens: number
          hazards: SafetyHazard[]
        }>
        /** the volume multiplier the telegraphed incident applies (1 = none). */
        volumeMul: number
        /** estimated board seconds until the last request has walked its lane. */
        estDurationSec: number
        /** the fleet's operating bill over that estimate (credits) — START warns when cash is below it. */
        projectedBill: number
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
    /** what starting one more project would lend right now (strongest racks that fit the cap). */
    requisition: { rackIds: number[]; lentTflops: number; capTflops: number; servingLossPct: number; blocked: boolean }
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
/** the operating-bill lines are small credit amounts (1 credit = $1,000): keep a tenth of a cent of a credit. */
const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** The racks one more research / Studio project would lend right now (research.ts requisitionPreview). */
function requisitionView(s: GameState): AgentSnapshot['research']['requisition'] {
  const rq = requisitionPreview(s, 0, true)
  return {
    rackIds: rq.rackIds,
    lentTflops: Math.round(rq.lentTflops),
    capTflops: Math.round(rq.capTflops),
    servingLossPct: Math.round(rq.servingLoss * 1000) / 10,
    blocked: rq.blocked,
  }
}

function roundLedger<K extends string>(l: Partial<Record<K, number>> | undefined): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {}
  for (const [k, v] of Object.entries(l ?? {}) as [K, number][]) out[k] = round2(v)
  return out
}

function modelView(s: GameState, id: string): AgentModelView | null {
  const m = resolveModel(s, id)
  if (!m) return null
  const round1 = (v: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [axis, q] of Object.entries(v)) out[axis] = Math.round(q * 10) / 10
    return out
  }
  const qualityBy = round1(m.qualityBy)
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
    thinking: m.thinking,
    ...(m.qualityByInstant ? { qualityByInstant: round1(m.qualityByInstant) } : {}),
    thinkTokens: m.thinkTokens,
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
    clearBonus: round2(r.clearBonus),
    // the operating bill and its split: GPU-hour amortization + energy (powerCost = gpuCost + energyCost)
    powerCost: round3(r.powerCost),
    gpuCost: r.gpuCost === undefined ? undefined : round3(r.gpuCost),
    energyCost: r.energyCost === undefined ? undefined : round3(r.energyCost),
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
      // a rack reaches as far as its hardware tier (what it would have once placed)
      range: def.kind === 'server' && def.hardwareId ? (HARDWARE_DEFS[def.hardwareId]?.range ?? def.range) : def.range,
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
      ...(t.def.kind === 'server' && t.hwId
        ? {
            format: servingFormat(s, loadoutOf(s, t)),
            formatSetting: t.precision ?? 'auto',
            formats: availableFormats(s, HARDWARE_DEFS[t.hwId], t.modelId ? resolveModel(s, t.modelId) : null),
          }
        : {}),
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
    // the infra nodes keep their description in the locale files only: an agent reads the English one
    desc: def.desc || en[`research.${def.id}.desc`] || '',
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

  // the wave a build-phase startWave will launch next — the same read-only preview the
  // in-game NEXT WAVE card shows (incident volume folded in, the sim's surge-lane rule)
  let nextWave: AgentSnapshot['nextWave'] = null
  const p = s.phase === 'build' ? previewNextWave(s) : null
  if (p && p.def) {
    nextWave = {
      wave: p.index + 1,
      name: p.def.name,
      brief: p.def.brief,
      clearBonus: p.clearBonus,
      totalRequests: p.totalRequests,
      mix: p.entries.map((e) => ({
        typeId: e.typeId,
        count: e.count,
        latClass: e.latClass,
        axis: e.axis,
        difficulty: Math.round(e.difficulty * 10) / 10,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        hazards: [...e.hazards],
      })),
      volumeMul: p.volumeMul,
      estDurationSec: Math.round(p.estDurationSec * 10) / 10,
      projectedBill: Math.round(p.projectedBill * 10) / 10,
      boss: p.boss,
      surgeLane: p.surgeLane,
      incidentId: p.incident?.id ?? null,
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
    coolingLiquid: { used: round2(s.coolingLiquid.used), cap: round2(s.coolingLiquid.cap) },
    flags: { hasLab: labReady, hasLiquidLoop: liquidReady },
    modifiers: {
      buildCost: s.modifiers.buildCost,
      powerPrice: s.modifiers.powerPrice,
      coolingCap: s.modifiers.coolingCap,
      safetyDamage: s.modifiers.safetyDamage,
      volume: s.modifiers.volume,
      reward: s.modifiers.reward,
      powerCap: s.modifiers.powerCap,
      powerBuild: s.modifiers.powerBuild,
      slaDamage: s.modifiers.slaDamage,
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
      requisition: requisitionView(s),
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
