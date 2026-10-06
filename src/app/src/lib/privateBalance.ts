import type { ShieldedDepositView, ShieldedPlanView, ShieldedStatusView } from '@ext-types/index'

// The private balance as the user owns it: everything in the pool that is theirs, in parts that
// say where each piece stands, so a payment in flight never makes funds look gone. The parts add
// up to the SDK's balance: spendable, locked, pending deposits and payouts still owed.
export type BalancePartKey = 'available' | 'sending' | 'returning' | 'screening' | 'held'

export type BalanceItem =
  | { readonly kind: 'plan'; readonly plan: ShieldedPlanView; readonly amount: bigint }
  | { readonly kind: 'deposit'; readonly deposit: ShieldedDepositView; readonly amount: bigint }

interface BalancePart {
  readonly key: BalancePartKey
  readonly amount: bigint
  readonly items: readonly BalanceItem[]
}

export interface PrivateBalance {
  readonly total: bigint
  // In the order the glossary names them, zero parts left out.
  readonly parts: readonly BalancePart[]
}

export const PART_LABELS: Record<BalancePartKey, string> = {
  available: 'Available',
  sending: 'Sending',
  returning: 'Returning',
  screening: 'Screening',
  held: 'Held',
}

export const PART_EXPLANATIONS: Record<BalancePartKey, string> = {
  available: 'Yours to send or unshield now.',
  sending:
    'Payments on their way, with their fees. They leave your balance once they confirm, or come back to Available if they do not land.',
  returning: 'The change from payments on their way. It comes back to Available once they confirm.',
  screening: 'Deposits the pool is screening. Each one is usable from the time it shows.',
  held: 'Funds the pool is holding: a deposit held for review or under a legal hold, or a payout the destination could not receive. Each one says what you can do.',
}

// A payment the network may still be taking: its notes are out of Available until it confirms or
// its deadline passes.
export const inFlight = (p: ShieldedPlanView): boolean =>
  p.state === 'prepared' || p.state === 'submitted'

const owed = (p: ShieldedPlanView): bigint => BigInt(p.payoutLeft ?? p.amount)

export function privateBalance(status: ShieldedStatusView): PrivateBalance {
  const available = BigInt(status.balance.spendable)
  const flying = status.plans.filter(inFlight)
  // A payment and its retries, or a repriced proof, spend the same notes and share a family: only
  // one of them can land, so each family counts once, by its newest plan still in flight.
  const newest = new Map<string, ShieldedPlanView>()
  for (const plan of flying) {
    const seen = newest.get(plan.familyId)
    if (!seen || plan.createdAt > seen.createdAt) newest.set(plan.familyId, plan)
  }
  const counted = [...newest.values()]
  const paying: BalanceItem[] = flying.map((plan) => ({
    kind: 'plan',
    plan,
    amount: newest.get(plan.familyId) === plan ? BigInt(plan.amount) + BigInt(plan.fee) : 0n,
  }))
  const returning: BalanceItem[] = counted
    .filter((plan) => BigInt(plan.change) > 0n)
    .map((plan) => ({ kind: 'plan', plan, amount: BigInt(plan.change) }))
  const queued: BalanceItem[] = status.plans
    .filter((plan) => plan.state === 'queued')
    .map((plan) => ({ kind: 'plan', plan, amount: owed(plan) }))
  const held: BalanceItem[] = status.plans
    .filter((plan) => plan.state === 'stranded')
    .map((plan) => ({ kind: 'plan', plan, amount: owed(plan) }))
  const screening: BalanceItem[] = []
  for (const deposit of status.deposits) {
    if (deposit.state !== 'submitting' && deposit.state !== 'pending') continue
    const item: BalanceItem = { kind: 'deposit', deposit, amount: BigInt(deposit.amount) }
    if (deposit.flag) held.push(item)
    else screening.push(item)
  }
  const sending = [...paying, ...queued]
  const sum = (items: BalanceItem[]) => items.reduce((s, i) => s + i.amount, 0n)
  const parts: BalancePart[] = [
    { key: 'available', amount: available, items: [] },
    { key: 'sending', amount: sum(sending), items: sending },
    { key: 'returning', amount: sum(returning), items: returning },
    { key: 'screening', amount: sum(screening), items: screening },
    { key: 'held', amount: sum(held), items: held },
  ]
  return {
    total: parts.reduce((s, p) => s + p.amount, 0n),
    parts: parts.filter((p) => p.amount > 0n),
  }
}
