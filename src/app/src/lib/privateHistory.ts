import type { RowView } from '@/lib/activity'
import { shortAddress } from '@/lib/address'
import { formatUnits } from '@/lib/amount'
import type { BridgeStepState } from '@/lib/cctp'
import { depositStatus, planStatus, type ItemStatus } from '@/lib/privateActivity'
import type {
  ShieldedDepositView,
  ShieldedHistoryItem,
  ShieldedPlanView,
  ShieldedStatusView,
} from '@ext-types/index'

// One entry of the private history with what the status holds of it now, ready for the rows of
// public history: its row view, the counterparty said in words, and its time.
export interface PrivateEntry {
  readonly item: ShieldedHistoryItem
  readonly plan: ShieldedPlanView | null
  readonly deposit: ShieldedDepositView | null
  readonly status: ItemStatus
  readonly view: RowView
  readonly counterpartyText: string
  // ISO time, or empty while it is not known.
  readonly timestamp: string
}

const DONE: ItemStatus = { label: 'Done', tone: 'ok', stage: 'done' }

function statusOf(
  item: ShieldedHistoryItem,
  plan: ShieldedPlanView | null,
  deposit: ShieldedDepositView | null,
  unit: (units: bigint | string) => string
): ItemStatus {
  if (plan && (item.kind === 'send' || item.kind === 'unshield')) return planStatus(plan, unit)
  if (deposit) return depositStatus(deposit)
  if (item.kind === 'receive') return { label: 'Received', tone: 'ok', stage: 'done' }
  if (item.kind === 'claim') return { label: 'Claimed', tone: 'ok', stage: 'done' }
  return DONE
}

function labelOf(item: ShieldedHistoryItem, status: ItemStatus): string {
  switch (item.kind) {
    case 'shield':
      return 'Shield'
    case 'send':
      return status.stage === 'done' ? 'Sent' : 'Send'
    case 'receive':
      return 'Received'
    case 'unshield':
      return 'Unshield'
    case 'refund':
      return 'Refund'
    case 'cancel':
      return 'Cancel'
    case 'claim':
      return 'Claim'
  }
}

function counterpartyOf(item: ShieldedHistoryItem): string {
  const to = item.counterparty ? shortAddress(item.counterparty) : ''
  switch (item.kind) {
    case 'shield':
      return 'From Your account'
    case 'receive':
      return 'From Private pool'
    case 'cancel':
    case 'refund':
      return 'To Your account'
    case 'claim':
      return to ? `For ${to}` : ''
    default:
      return to ? `To ${to}` : 'To an unknown address'
  }
}

export function privateEntries(
  items: readonly ShieldedHistoryItem[],
  status: ShieldedStatusView,
  code: string,
  decimals: number,
  unit: (units: bigint | string) => string
): PrivateEntry[] {
  return items.map((item) => {
    const plan = (item.planId && status.plans.find((p) => p.planId === item.planId)) || null
    const deposit =
      (item.depositTx
        ? status.deposits.find((d) => d.txHash === item.depositTx)
        : item.depositId !== null
          ? status.deposits.find((d) => d.txHash === null && d.id === item.depositId)
          : undefined) ?? null
    const s = statusOf(item, plan, deposit, unit)
    const view: RowView = {
      label: labelOf(item, s),
      direction:
        item.kind === 'shield' || item.kind === 'receive'
          ? 'in'
          : item.kind === 'claim'
            ? 'neutral'
            : 'out',
      amount: { value: formatUnits(item.amount, decimals), code },
      status:
        s.stage === 'done'
          ? 'confirmed'
          : s.stage === 'progress'
            ? 'pending'
            : s.stage === 'failed'
              ? 'failed'
              : 'attention',
      statusLabel: s.label,
      code,
      verified: true,
    }
    return {
      item,
      plan,
      deposit,
      status: s,
      view,
      counterpartyText: counterpartyOf(item),
      timestamp: item.time === null ? '' : new Date(item.time).toISOString(),
    }
  })
}

type Step = { label: string; state: BridgeStepState }

// How the entry got where it is, step by step: what is behind it, what it waits on, what failed.
export function stepsOf(entry: PrivateEntry): Step[] {
  const { item, plan, deposit } = entry
  if (plan) {
    const route =
      plan.route.kind === 'relayer'
        ? `Sent through ${new URL(plan.route.url).host}`
        : 'Sent by your account'
    const landed = ['confirmed', 'queued', 'settled', 'stranded'].includes(plan.state)
    const steps: Step[] = [
      { label: 'Proved on this device', state: 'done' },
      plan.state === 'prepared'
        ? { label: 'Not taken yet; it may still be sent until its deadline', state: 'wait' }
        : { label: route, state: 'done' },
      plan.needsUserDecision
        ? { label: 'Whether it landed is not known yet', state: 'error' }
        : plan.state === 'dead'
          ? { label: 'Did not land by its deadline', state: 'error' }
          : landed
            ? { label: 'Landed in the pool', state: 'done' }
            : {
                label: 'Landing in the pool',
                state: plan.state === 'submitted' ? 'active' : 'todo',
              },
    ]
    if (plan.kind === 'unshield') {
      steps.push(
        plan.state === 'settled'
          ? { label: 'Paid out to the destination', state: 'done' }
          : plan.state === 'queued'
            ? { label: 'Waiting in the exit queue', state: 'wait' }
            : plan.state === 'stranded'
              ? { label: 'The destination could not receive it', state: 'error' }
              : { label: 'Paid out to the destination', state: 'todo' }
      )
    }
    return steps
  }
  if (deposit && item.kind === 'shield') {
    const held = deposit.state === 'pending' && deposit.flag !== null
    const admitted = deposit.state === 'admitted'
    const returned = deposit.state === 'cancelled' || deposit.state === 'refunded'
    return [
      deposit.state === 'submitting'
        ? { label: 'Sending the deposit', state: 'active' }
        : deposit.state === 'failed'
          ? { label: 'The deposit did not go through', state: 'error' }
          : deposit.state === 'unresolved'
            ? { label: 'Whether the deposit landed is not known yet', state: 'error' }
            : { label: 'Deposited from your account', state: 'done' },
      held
        ? { label: 'Held by screening', state: 'error' }
        : admitted || deposit.attested
          ? { label: 'Passed screening', state: 'done' }
          : { label: 'Screening', state: deposit.state === 'pending' ? 'active' : 'todo' },
      returned
        ? {
            label: deposit.state === 'cancelled' ? 'Cancelled' : 'Refunded',
            state: deposit.confirmed ? 'done' : 'active',
          }
        : { label: 'In your private balance', state: admitted ? 'done' : 'todo' },
    ]
  }
  if (item.kind === 'cancel' || item.kind === 'refund' || item.kind === 'claim') {
    const confirmed = deposit ? deposit.confirmed : true
    return [
      { label: 'Sent from your account', state: 'done' },
      { label: 'Confirmed by the network', state: confirmed ? 'done' : 'active' },
    ]
  }
  return [{ label: 'In the pool', state: 'done' }]
}
