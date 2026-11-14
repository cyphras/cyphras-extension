import type { DepositInfo, PlanView } from '@cyphras/private'

const LANDED: readonly PlanView['state'][] = ['confirmed', 'queued', 'settled', 'stranded']

type Attempt = Pick<PlanView, 'planId' | 'familyId' | 'state' | 'createdAt'>

// Whether an attempt of the same payment older than `p` may still land: one the network may still
// take (prepared or submitted, its outcome unknown included), while no attempt of the payment has
// landed. The newest attempt's row then must not say the payment cannot arrive.
export function earlierMayLand(p: Attempt, plans: readonly Attempt[]): boolean {
  const family = plans.filter((q) => q.familyId === p.familyId)
  if (family.some((q) => LANDED.includes(q.state))) return false
  return family.some(
    (q) =>
      q.planId !== p.planId &&
      q.createdAt < p.createdAt &&
      (q.state === 'prepared' || q.state === 'submitted')
  )
}

// One plan per payment for its history row. Every attempt of a payment, its retries and repriced
// proofs, spends the same notes and shares a family, so at most one of them lands: the row stands
// for that one once it landed, else for the newest attempt not superseded.
export function paymentRows<P extends Attempt>(plans: readonly P[]): P[] {
  const rows = new Map<string, P>()
  for (const p of plans) {
    if (p.state === 'superseded') continue
    const seen = rows.get(p.familyId)
    const landed = LANDED.includes(p.state)
    if (
      !seen ||
      (landed && !LANDED.includes(seen.state)) ||
      (landed === LANDED.includes(seen.state) && p.createdAt > seen.createdAt)
    ) {
      rows.set(p.familyId, p)
    }
  }
  return [...rows.values()]
}

// A deposit whose transaction never left the device, as one whose fee review was declined, is not
// history: nothing of it reached the chain.
export const reachedChain = (d: Pick<DepositInfo, 'state' | 'txHash'>): boolean =>
  !(d.state === 'failed' && d.txHash === undefined)
