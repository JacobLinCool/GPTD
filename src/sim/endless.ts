import type { GameState, SpawnGroup, WaveDef } from '../core/types'
import {
  BASE_INTERVAL,
  burstSpacing,
  groupMuls,
  hazardMulOf,
  MAX_TIER,
  novelShareOf,
  tierBonus,
  VOLUME_FACTOR,
  waveBudget,
} from './campaign'
import { WAVES } from './content'

/**
 * Endless mode: past the authored campaign, surges are generated procedurally from
 * the seeded RNG. They RESUME at the wave-100 load — the same per-request scaling
 * (campaign.ts groupMuls at the max tier), wave 100's tier-12 extreme boss request
 * budget, cadence, hazard pressure and SLA contract — and climb from there: volume, the
 * contract and per-request work grow every surge, and after a short grace the quality
 * lines harden by a small additive step. The model tree tops out at the roster's largest
 * open checkpoint while difficulty does not, so every endless run eventually ends;
 * the score is how deep you got.
 */
export interface EndlessScaling {
  /** request budget over wave 100's. */
  count: number
  /** per-request work over wave 100's. */
  work: number
  /** the quality-line multiplier (wave 100's, plus the additive climb). */
  complexity: number
  /** era hazard pressure and novel-attack share. */
  hazardMul: number
  novelShare: number
  /** the SLA-contract value of clearing the surge (pre-CLEAR_BONUS_SCALE): wave 100's, + 40 a surge. */
  clearBonus: number
}

/** Surges before the quality lines start to harden past wave 100's. */
const COMPLEXITY_GRACE = 2

export function endlessScaling(waveIndex: number): EndlessScaling {
  const d = Math.max(1, waveIndex - (WAVES.length - 1))
  const base = groupMuls(MAX_TIER, 'chat')
  return {
    count: 1 + 0.05 * d,
    work: 1 + 0.035 * d,
    complexity: base.complexityMul + 0.01 * Math.max(0, d - COMPLEXITY_GRACE),
    hazardMul: hazardMulOf(MAX_TIER) * (1 + 0.01 * d),
    novelShare: Math.min(0.65, novelShareOf(MAX_TIER) + 0.005 * d),
    // a surge carries wave 100's boss-sized load, so its contract resumes at wave 100's (boss) contract
    clearBonus: tierBonus(MAX_TIER, true) + 40 * d,
  }
}

/** Base group templates the generator samples from (weights ≈ traffic mix). The
 *  9 archetypes: volume floods (embed/chat), prefill-heavy (comp/rag/summ),
 *  hard lanes (reason/agent), decode-heavy offline (batch), the hazard (jailbreak). */
const TEMPLATES: { typeId: string; weight: number }[] = [
  { typeId: 'chat', weight: 3 },
  { typeId: 'embed', weight: 2 },
  { typeId: 'comp', weight: 2 },
  { typeId: 'rag', weight: 2 },
  { typeId: 'summ', weight: 1 },
  { typeId: 'reason', weight: 2 },
  { typeId: 'batch', weight: 1 },
  { typeId: 'jailbreak', weight: 1 },
  { typeId: 'agent', weight: 1 },
]

function pickTemplate(s: GameState) {
  const total = TEMPLATES.reduce((n, t) => n + t.weight, 0)
  let roll = s.rng.next() * total
  for (const t of TEMPLATES) {
    roll -= t.weight
    if (roll <= 0) return t
  }
  return TEMPLATES[0]
}

/** Deterministically generate the next endless surge from the seeded RNG. */
export function generateEndlessWave(s: GameState): WaveDef {
  const index = s.waveIndex // already advanced to the new wave by startWave
  const sc = endlessScaling(index)
  const surge = index - WAVES.length + 1
  const groupCount = 3 + s.rng.int(3) // 3..5 bursts
  const picks = Array.from({ length: groupCount }, () => pickTemplate(s))
  // every surge carries at least one hard lane (reason/agent) so cheap fleets cannot coast
  if (!picks.some((p) => p.typeId === 'reason' || p.typeId === 'agent')) {
    const hardLane = s.rng.chance(0.5) ? 'reason' : 'agent' // one draw, outside the lookup
    picks.push(TEMPLATES.find((t) => t.typeId === hardLane)!)
  }
  // the wave-100 (boss) budget, split by template weight (a hard lane never gets less than a
  // fair share); the per-burst jitter only ever adds, so a surge never undercuts wave 100
  const budget = waveBudget(MAX_TIER, 'extreme', true) * sc.count
  const totalWeight = picks.reduce((n, p) => n + p.weight, 0)
  const vf = Math.sqrt(VOLUME_FACTOR.extreme)
  const groups: SpawnGroup[] = picks.map((tpl, i) => {
    const hard = tpl.typeId === 'reason' || tpl.typeId === 'agent'
    const share = Math.max(tpl.weight / totalWeight, hard ? 1 / picks.length : 0)
    const muls = groupMuls(MAX_TIER, tpl.typeId)
    return {
      typeId: tpl.typeId,
      count: Math.max(1, Math.round(budget * share * (1 + s.rng.next() * 0.2))),
      interval: Math.round(((BASE_INTERVAL[tpl.typeId] ?? 1) / vf) * (0.9 + s.rng.next() * 0.25) * 100) / 100,
      delay: Math.round(i * burstSpacing(MAX_TIER) * (0.85 + s.rng.next() * 0.3) * 10) / 10,
      workMul: Math.round(muls.workMul * sc.work * 100) / 100,
      complexityMul: Math.round(sc.complexity * 1000) / 1000,
      contextMul: muls.contextMul,
      hazardMul: Math.round(sc.hazardMul * 1000) / 1000,
      novelShare: Math.round(sc.novelShare * 1000) / 1000,
    }
  })
  return {
    name: `Surge ${surge}`,
    brief:
      'Past the campaign: the wave-100 load comes back every surge, a little heavier, then a little harder.',
    teaches:
      'Endless mode: volume and work climb every surge and the quality lines keep hardening; your model tree does not.',
    clearBonus: Math.round(sc.clearBonus),
    groups,
  }
}
