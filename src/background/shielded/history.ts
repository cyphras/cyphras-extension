import type { DepositInfo, PlanView } from '@cyphras/private'

const LANDED: readonly PlanView['state'][] = ['confirmed', 'queued', 'settled', 'stranded']

// One plan per payment for its history row. Every attempt of a payment, its retries and repriced
// proofs, spends the same notes and shares a family, so at most one of them lands: the row stands
// for that one once it landed, else for the newest attempt not superseded.
export function paymentRows<P extends Pick<PlanView, 'familyId' | 'state' | 'createdAt'>>(
  plans: readonly P[]
): P[] {
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
