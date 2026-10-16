import type { GameState, Outcome, RefusedBy, Request } from '../core/types'
import { dataMult, serveRevenue } from './effects'
import { addToLedger, recordOutcome } from './telemetry'

/* ------------------------------------------------------------------ *
 *  TERMINAL OUTCOMES (§2.5) — the one place a request's fate is paid  *
 *  out: revenue, the Trust / SLA meters, run stats, the per-outcome   *
 *  ledgers, wave telemetry and the `outcome` event. Combat (answers,  *
 *  refusals, blocked attacks) and movement (leaks) both resolve here,  *
 *  so the table below is the whole rulebook:                          *
 *                                                                      *
 *    outcome      pay     Trust              SLA                       *
 *    served       100%    +0.25              +0.15                     *
 *    sloMiss       50%    −0.25·trustPen     −0.5·slaPen   (SLA credit)*
 *    bad            0     −0.5·trustPen       0            (refunded)  *
 *    unsafe         0     −trustPen·safetyDmg 0            (a breach)  *
 *    overRefused    0     −0.25·trustPen     −0.2·slaPen               *
 *    unservable     0     −trustPen          −slaPen                   *
 *    leaked         0     −trustPen (0 for an attack) −slaPen          *
 *                                                                      *
 *  Pay is token-priced on the tokens actually processed (the prompt    *
 *  ingested, cached prefix included, plus the tokens generated), so a  *
 *  blocked attack earns nothing and a refused one only its prompt and  *
 *  its short refusal.                                                  *
 * ------------------------------------------------------------------ */

/** Meter gain of a clean serve (Trust / SLA points). */
const SERVED_TRUST_GAIN = 0.25
const SERVED_SLA_GAIN = 0.15

/** §2.5 a late but correct answer is billed at half price: the SLA credit owed for missing the SLO. */
export const SLO_MISS_PAY_SHARE = 0.5

/** Penalty multipliers on the request's trustPenalty / slaPenalty for each non-served outcome. */
const PENALTY: Record<Exclude<Outcome, 'served'>, { trust: number; sla: number }> = {
  sloMiss: { trust: 0.25, sla: 0.5 },
  bad: { trust: 0.5, sla: 0 },
  // a delivered unsafe answer is a Trust incident (× the incident's safetyDamage), not an availability one
  unsafe: { trust: 1, sla: 0 },
  // §3.6 over-refusing real users hurts, but one refusal must not outweigh several clean serves
  overRefused: { trust: 0.25, sla: 0.2 },
  unservable: { trust: 1, sla: 1 },
  leaked: { trust: 1, sla: 1 },
}

/** Extra facts an outcome carries (an overRefused outcome: who refused). */
export interface ResolveDetail {
  refusedBy?: RefusedBy
}

/**
 * Token-priced revenue (credits) for the tokens this request actually had processed:
 * the prompt ingested so far (a cached prefix counts — it was served) plus the tokens
 * generated so far.
 */
export function processedRevenue(s: GameState, r: Request): number {
  const tokIn = Math.max(0, r.tokensIn - r.prefill)
  const tokOut = Math.max(0, r.maxWork - Math.max(0, r.work))
  return serveRevenue(s, tokIn, tokOut, r.pricePerMtokIn, r.pricePerMtokOut)
}

/** Apply a meter delta with the 0..100 clamp; returns the delta actually applied. */
function applyMeter(s: GameState, meter: 'trust' | 'sla', delta: number): number {
  const before = s.meters[meter]
  const after = before + delta < 0 ? 0 : before + delta > 100 ? 100 : before + delta
  s.meters[meter] = after
  return after - before
}

/**
 * Resolve one request into a terminal outcome: pay it out, move the meters, update the
 * run stats + ledgers + wave telemetry, and emit the precise `outcome` event.
 */
export function resolveOutcome(s: GameState, r: Request, outcome: Outcome, detail: ResolveDetail = {}): void {
  r.alive = false
  if (outcome === 'overRefused') r.refusedBy = detail.refusedBy ?? r.refusedBy ?? 'model'

  let trustDelta: number
  let slaDelta: number
  let pay = 0
  if (outcome === 'served') {
    trustDelta = SERVED_TRUST_GAIN
    slaDelta = SERVED_SLA_GAIN
    pay = processedRevenue(s, r)
  } else {
    const pen = PENALTY[outcome]
    trustDelta = -r.trustPenalty * pen.trust
    slaDelta = -r.slaPenalty * pen.sla
    if (outcome === 'unsafe') trustDelta *= s.modifiers.safetyDamage
    // an attacker who got no answer harms nobody's trust: dropping it is an availability miss only
    if (outcome === 'leaked' && r.def.adversarial) trustDelta = 0
    if (outcome === 'sloMiss') pay = processedRevenue(s, r) * SLO_MISS_PAY_SHARE
  }
  const dTrust = applyMeter(s, 'trust', trustDelta)
  const dSla = applyMeter(s, 'sla', slaDelta)
  if (pay > 0) {
    s.meters.cash += pay
    s.stats.cashEarned += pay
  }
  // serving traffic yields usage logs (Data) whenever an answer was produced and kept
  if (outcome === 'served' || outcome === 'bad') s.data += r.data * dataMult(s)

  s.stats[outcome]++
  const trustLost = (s.stats.trustLostBy ??= {})
  const slaLost = (s.stats.slaLostBy ??= {})
  addToLedger(trustLost, outcome, -dTrust)
  addToLedger(slaLost, outcome, -dSla)
  const cause = outcome === 'sloMiss' ? r.sloCause : undefined
  const refusedBy = outcome === 'overRefused' ? r.refusedBy : undefined
  recordOutcome(s, r, outcome, { pay, dTrust, dSla, cause, refusedBy })

  const judged = r.qualTokW > 0 && !r.attackHandled
  s.events.push({
    type: 'outcome',
    requestId: r.id,
    typeId: r.def.id,
    laneId: r.laneId,
    x: r.x,
    y: r.y,
    outcome,
    cash: pay,
    dTrust,
    dSla,
    cause,
    axis: judged ? r.def.primaryAxis : undefined,
    margin: judged ? r.bestQuality : undefined,
    refusedBy,
    towerId: r.answeredBy,
    modelId: r.answeredModelId,
    cached: r.cachedTokens > 0,
  })
}
