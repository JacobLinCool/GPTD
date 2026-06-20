import type { GameState, SpawnGroup, WaveDef } from '../core/types'
import { WAVES } from './content'

/**
 * Endless mode: past the authored campaign, waves are generated procedurally
 * and the "benchmarks" keep hardening — request complexity, volume, workload,
 * and rewards all climb with the wave index. The model tree caps at 2T while
 * difficulty does not, so every endless run eventually ends; the score is how
 * deep you got.
 */
export interface EndlessScaling {
  count: number
  work: number
  complexity: number
  context: number
  reward: number
  clearBonus: number
}

export function endlessScaling(waveIndex: number): EndlessScaling {
  const d = Math.max(1, waveIndex - (WAVES.length - 1))
  return {
    count: 1 + 0.05 * d,
    work: 1 + 0.035 * d,
    complexity: 1 + 0.03 * d,
    // context demand grows with the era (8k → 128k → 1M…): keeps FlashAttention,
    // KV Cache, and big-window models relevant forever
    context: 1 + 0.025 * d,
    reward: 1 + 0.05 * d,
    clearBonus: 250 + 40 * d,
  }
}

/** Base group templates the generator samples from (weights ≈ traffic mix). The
 *  9 P3a archetypes: volume floods (embed/chat), prefill-heavy (comp/rag/summ),
 *  hard lanes (reason/agent), decode-heavy offline (batch), the hazard (jailbreak). */
const TEMPLATES: { typeId: string; count: number; interval: number; weight: number }[] = [
  { typeId: 'chat', count: 16, interval: 0.85, weight: 3 },
  { typeId: 'embed', count: 26, interval: 0.4, weight: 2 },
  { typeId: 'comp', count: 11, interval: 0.95, weight: 2 },
  { typeId: 'rag', count: 9, interval: 1.15, weight: 2 },
  { typeId: 'summ', count: 8, interval: 1.2, weight: 1 },
  { typeId: 'reason', count: 9, interval: 1.2, weight: 2 },
  { typeId: 'batch', count: 7, interval: 1.25, weight: 1 },
  { typeId: 'jailbreak', count: 9, interval: 1.0, weight: 1 },
  { typeId: 'agent', count: 6, interval: 1.8, weight: 1 },
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

/** Deterministically generate the next endless wave from the seeded RNG. */
export function generateEndlessWave(s: GameState): WaveDef {
  const index = s.waveIndex // already advanced to the new wave by startWave
  const sc = endlessScaling(index)
  const surge = index - WAVES.length + 1
  const groupCount = 3 + s.rng.int(3) // 3..5 bursts
  const groups: SpawnGroup[] = []
  for (let i = 0; i < groupCount; i++) {
    const tpl = pickTemplate(s)
    groups.push({
      typeId: tpl.typeId,
      count: Math.max(1, Math.round(tpl.count * sc.count * (0.85 + s.rng.next() * 0.3))),
      interval: tpl.interval * (0.9 + s.rng.next() * 0.25),
      delay: i * (7 + s.rng.next() * 5),
      workMul: sc.work,
      complexityMul: sc.complexity,
      rewardMul: sc.reward,
      contextMul: sc.context,
    })
  }
  // every surge carries at least one hard lane (reason/agent) so cheap fleets cannot coast
  if (!groups.some((g) => g.typeId === 'reason' || g.typeId === 'agent')) {
    groups.push({
      typeId: s.rng.chance(0.5) ? 'reason' : 'agent',
      count: Math.max(1, Math.round(7 * sc.count)),
      interval: 1.2,
      delay: 10,
      workMul: sc.work,
      complexityMul: sc.complexity,
      rewardMul: sc.reward,
      contextMul: sc.context,
    })
  }
  return {
    name: `Surge ${surge}`,
    brief: 'The benchmarks got harder again. Scale or sink.',
    teaches: 'Endless mode: complexity climbs forever; your model tree does not.',
    clearBonus: Math.round(sc.clearBonus),
    groups,
  }
}
