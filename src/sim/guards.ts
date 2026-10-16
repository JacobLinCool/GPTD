import { TILE } from '../config'
import type { GameState, GuardrailArchetype, Request, SafetyHazard, Tower } from '../core/types'
import { guardLatencyMs, towerRangeTiles } from './effects'
import { LANE_PATHS } from './pathing'
import {
  ALL_HAZARDS,
  categoryUnlocked,
  effRecall,
  isBenign,
  NOVEL_RECALL_MUL,
  overRefuse,
  overrefMul,
  redteamRecallBonus,
  refreshHazardFlags,
} from './safety'
import { recordGuardCatch } from './telemetry'

/* ------------------------------------------------------------------ *
 *  GUARDRAIL SCREENING (§3.3, layer 2) — by LANE COVERAGE.             *
 *  A guardrail is a pipeline stage on the request path (input → guard  *
 *  → LLM → guard → user), not a turret: it screens every request on    *
 *  the lanes its range touches, wherever on the lane it sits. Each      *
 *  request is screened ONCE, at its first contact with a rack, and per  *
 *  guard FAMILY present on its lane:                                    *
 *    - input latency once (→ TTFT), output latency once (→ E2EL);       *
 *    - a benign request rolls one false positive per family;            *
 *    - a hazard is caught with the family's best recall — replicas of   *
 *      one classifier add coverage, never extra recall (the same model  *
 *      on the same input returns the same verdict);                      *
 *    - distinct families stack (defense in depth).                      *
 *  Input checks run before any compute, so a blocked attack costs no    *
 *  prefill; output checks run on the finished answer before delivery.   *
 * ------------------------------------------------------------------ */

/** Stable screening order of the guard families (deterministic rng draws). */
const FAMILIES: GuardrailArchetype[] = ['encoder', 'generative', 'moderation']

/** One guard family present on a lane: its covering towers (by id) per side, and that side's check latency. */
export interface LaneGuardStage {
  archetype: GuardrailArchetype
  /** covering towers that check the prompt (side input / both). */
  input: Tower[]
  /** covering towers that check the answer (side output / both). */
  output: Tower[]
  /** real seconds one input / output check of this family takes (the slowest covering tower). */
  inSec: number
  outSec: number
}

/** Does a circle (center, radius in px) touch a lane's polyline? */
function circleTouchesLane(x: number, y: number, radius: number, laneId: number): boolean {
  const lane = LANE_PATHS[laneId]
  if (!lane) return false
  const r2 = radius * radius
  for (const seg of lane.segments) {
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len2 = dx * dx + dy * dy
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - seg.a.x) * dx + (y - seg.a.y) * dy) / len2)) : 0
    const px = seg.a.x + dx * u - x
    const py = seg.a.y + dy * u - y
    if (px * px + py * py <= r2) return true
  }
  return false
}

/** The ingress lanes a guardrail screens: every lane its range circle touches (display + sim). */
export function guardCoveredLanes(t: Tower): number[] {
  const radius = towerRangeTiles(t) * TILE
  return LANE_PATHS.filter((lane) => circleTouchesLane(t.x, t.y, radius, lane.id)).map((lane) => lane.id)
}

/** Per-lane guard stages from the online guardrails, families in a fixed order. */
export function laneGuardStages(s: GameState): LaneGuardStage[][] {
  const guards = s.towers
    .filter((t) => t.def.kind === 'guardrail' && t.online && t.def.guardrail)
    .sort((a, b) => a.id - b.id)
  const lanes: LaneGuardStage[][] = LANE_PATHS.map(() => [])
  if (!guards.length) return lanes
  const latSec = new Map<Tower, number>(guards.map((g) => [g, guardLatencyMs(s, g.def.guardrail!) / 1000]))
  const covered = guards.map((g) => ({ g, lanes: guardCoveredLanes(g) }))
  for (const lane of LANE_PATHS) {
    for (const family of FAMILIES) {
      const fam = covered
        .filter((c) => c.lanes.includes(lane.id) && c.g.def.guardrail!.archetype === family)
        .map((c) => c.g)
      if (!fam.length) continue
      const input = fam.filter((g) => g.def.guardrail!.side !== 'output')
      const output = fam.filter((g) => g.def.guardrail!.side !== 'input')
      const slowest = (ts: Tower[]): number => ts.reduce((m, g) => Math.max(m, latSec.get(g) ?? 0), 0)
      lanes[lane.id].push({
        archetype: family,
        input,
        output,
        inSec: slowest(input),
        outSec: slowest(output),
      })
    }
  }
  return lanes
}

/** Emit one guard result event (at the request's position; the renderer links it to the guard tower). */
function guardEvent(
  s: GameState,
  g: Tower,
  r: Request,
  result: 'caught' | 'overRefused',
  archetype: GuardrailArchetype,
  hazard?: SafetyHazard,
): void {
  s.events.push({ type: 'guard', towerId: g.id, requestId: r.id, x: r.x, y: r.y, result, archetype, hazard })
}

/**
 * Roll a false positive on a BENIGN request for one family: its borderline rate at the
 * global threshold × the archetype's refusal exposure. Returns true when it refused.
 */
function rollFalsePositive(s: GameState, r: Request, st: LaneGuardStage, rep: Tower): boolean {
  const p = overRefuse(st.archetype, s.guardrailThreshold, overrefMul(s)) * r.def.refusalExposure
  if (p <= 0 || !s.rng.chance(p)) return false
  r.overRefused = true
  r.refusedBy = 'guard'
  guardEvent(s, rep, r, 'overRefused', st.archetype)
  return true
}

/**
 * Roll each open, unlocked hazard against the best recall among one family's towers on one
 * side. A novel attack (the era's adaptive variants) keeps only the family's NOVEL_RECALL_MUL.
 */
function catchHazards(s: GameState, r: Request, towers: Tower[], family: GuardrailArchetype): void {
  const threshold = s.guardrailThreshold
  const bonus = redteamRecallBonus(s)
  const novelty = r.novel ? NOVEL_RECALL_MUL[family] : 1
  for (const h of ALL_HAZARDS) {
    if (r.hazardsOpen[h] === undefined || !categoryUnlocked(s, h)) continue
    let best: Tower | null = null
    let recall = 0
    for (const g of towers) {
      const spec = g.def.guardrail!
      if (!spec.catches.includes(h)) continue
      const e = effRecall(spec.baseRecall, threshold, bonus) * novelty
      if (e > recall) {
        recall = e
        best = g
      }
    }
    if (!best || !s.rng.chance(recall)) continue
    delete r.hazardsOpen[h]
    recordGuardCatch(s)
    guardEvent(s, best, r, 'caught', family, h)
  }
  refreshHazardFlags(r)
}

/**
 * Screen a request at its first hardware contact against every guard family covering
 * its lane: charge each family's input / output latency once, roll a benign request's
 * false positive at each family's input check, and run the input-side hazard checks
 * (before any compute). Sets `r.overRefused` on a false positive.
 */
export function screenInput(s: GameState, r: Request, stages: LaneGuardStage[]): void {
  r.screened = true
  const benign = isBenign(r.hazards)
  for (const st of stages) {
    const rep = st.input[0] ?? st.output[0]
    r.guardsSeen.add(rep.id)
    if (st.input.length) r.guardInSec += st.inSec
    // an output check reads the generated text; an embedding generates none
    if (st.output.length && r.maxWork > 0) r.guardOutSec += st.outSec
    if (!st.input.length) continue
    if (benign) {
      if (rollFalsePositive(s, r, st, st.input[0])) return
    } else {
      catchHazards(s, r, st.input, st.archetype)
    }
  }
}

/**
 * Screen a finished answer before delivery: output-side hazard checks (an unsafe answer
 * the model produced can still be stopped here), and the false positive of a family that
 * only checks output. Sets `r.overRefused` on a false positive.
 */
export function screenOutput(s: GameState, r: Request, stages: LaneGuardStage[]): void {
  if (r.maxWork <= 0) return
  const benign = isBenign(r.hazards)
  for (const st of stages) {
    if (!st.output.length) continue
    if (benign) {
      // a family with an input check already rolled its one false positive there
      if (!st.input.length && rollFalsePositive(s, r, st, st.output[0])) return
    } else if (!r.safetyCleared) {
      catchHazards(s, r, st.output, st.archetype)
    }
  }
}
