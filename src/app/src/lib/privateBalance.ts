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
  const sending: BalanceItem[] = []
  const held: BalanceItem[] = []
  const screening: BalanceItem[] = []
  let outgoing = 0n
  for (const plan of status.plans) {
    if (inFlight(plan)) {
      const amount = BigInt(plan.amount) + BigInt(plan.fee)
      outgoing += amount
      sending.push({ kind: 'plan', plan, amount })
    } else if (plan.state === 'queued') {
      sending.push({ kind: 'plan', plan, amount: owed(plan) })
    } else if (plan.state === 'stranded') {
      held.push({ kind: 'plan', plan, amount: owed(plan) })
    }
  }
  for (const deposit of status.deposits) {
    if (deposit.state !== 'submitting' && deposit.state !== 'pending') continue
    const item: BalanceItem = { kind: 'deposit', deposit, amount: BigInt(deposit.amount) }
    if (deposit.flag) held.push(item)
    else screening.push(item)
  }
  // The notes of payments in flight hold their amounts, their fees and the change that comes back.
  const change = BigInt(status.balance.locked) - outgoing
  const returning: BalanceItem[] =
    change > 0n
      ? sending
          .filter((i) => i.kind === 'plan' && inFlight(i.plan))
          .map((i) => ({ ...i, amount: 0n }))
      : []
  const sum = (items: BalanceItem[]) => items.reduce((s, i) => s + i.amount, 0n)
  const parts: BalancePart[] = [
    { key: 'available', amount: available, items: [] },
    { key: 'sending', amount: sum(sending), items: sending },
    { key: 'returning', amount: change > 0n ? change : 0n, items: returning },
    { key: 'screening', amount: sum(screening), items: screening },
    { key: 'held', amount: sum(held), items: held },
  ]
  return {
    total: parts.reduce((s, p) => s + p.amount, 0n),
    parts: parts.filter((p) => p.amount > 0n),
  }
}

// The change a payment in flight brings back, when it is the only one in flight: the wallet knows
// the change of all of them together, not of each.
export function changeOf(status: ShieldedStatusView, plan: ShieldedPlanView): bigint | null {
  const flying = status.plans.filter(inFlight)
  if (flying.length !== 1 || flying[0].planId !== plan.planId) return null
  const change = BigInt(status.balance.locked) - BigInt(plan.amount) - BigInt(plan.fee)
  return change > 0n ? change : 0n
}
