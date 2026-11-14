import type {
  ShieldedFeeApproval,
  ShieldedFeeEntry,
  ShieldedFeeReason,
  ShieldedFeeView,
} from '@ext-types/index'

// The most a transaction the account submits itself pays the network without asking: the SDK's
// caps of 0.01 XLM to get included and 1 XLM of resources.
export const NETWORK_FEE_CAP_STROOPS = 10_100_000n
export const NETWORK_FEE_CAP_XLM = '1.01'

// A fee review that waits this long for an answer is declined, as a payment review is.
export const FEE_REVIEW_TIMEOUT_MS = 3 * 60_000

// The approval of a reviewed fee, for that fee's one transaction.
export function approvalOf(fee: ShieldedFeeView): ShieldedFeeApproval {
  return { reason: fee.reason, inclusionCap: fee.inclusionCap, ceiling: fee.ceiling }
}

// What a fee review is about: a transaction the account submits itself for a payment or a deposit,
// or one of its own actions.
export type FeeSubject = 'shield' | 'unshield' | 'cancel' | 'refund' | 'claim' | 'restore'

export const FEE_TITLES: Record<ShieldedFeeReason, string> = {
  network: 'Network fee is high',
  rent: 'Pool storage fee',
  restore: 'Pool restore fee',
}

export function feeLead(reason: ShieldedFeeReason): string {
  const more = `more than the ${NETWORK_FEE_CAP_XLM} XLM this wallet pays without asking`
  switch (reason) {
    case 'network':
      return `The network is charging more than usual, so this transaction needs ${more}.`
    case 'rent':
      return `The pool's data is close to expiring on the network. This transaction also pays to renew it, which costs ${more}.`
    case 'restore':
      return `Nobody has used the pool for a while, so the network put its data into storage. The first transaction after that brings it back, which costs ${more}.`
  }
}

const ENTRY_LABELS: Record<ShieldedFeeEntry, string> = {
  code: "The pool's program",
  instance: "The pool's settings",
  tree: "The pool's payment records",
  balance: "The pool's balance",
  asset: "The asset's contract",
  record: 'Records of past or waiting payments',
  other: 'Other pool data',
}

// What a fee restores or renews, in words, each once, anything the wallet has no words for last.
export function entryLines(entries: readonly ShieldedFeeEntry[]): string[] {
  const known = entries.filter((e) => e !== 'other').map((e) => ENTRY_LABELS[e])
  const lines = [...new Set(known)]
  if (entries.includes('other')) lines.push(ENTRY_LABELS.other)
  return lines
}

export interface FeeNotes {
  // Amber, above the muted notes, when the fee is not smaller than the payment.
  readonly warning: string | null
  readonly notes: readonly string[]
}

// The notes under a fee review, in order: what the fee does for the pool, what paying it from the
// account discloses, and the bounds of the approval.
export function feeNotes(
  reason: ShieldedFeeReason,
  subject: FeeSubject,
  account: string,
  feeAtLeastPayment: boolean
): FeeNotes {
  const notes: string[] = []
  if (reason === 'restore') {
    notes.push(
      'This fee restores the pool for everyone, not only for you. After it, later transactions do not pay it for a long while.'
    )
  }
  if (reason === 'rent') {
    notes.push("The pool's data needs renewing. This keeps it on the network for everyone.")
  }
  if (subject === 'unshield' || subject === 'claim') {
    notes.push(
      `Your account ${account} pays this fee and becomes publicly linked to this withdrawal.`
    )
  }
  notes.push(
    'Most you will pay is the fee plus 10%, room for it to move before it is sent, never more.',
    'This approval covers this one transaction only. If the fee goes higher, you are asked again.'
  )
  const payment = subject === 'shield' || subject === 'unshield'
  return {
    warning:
      payment && feeAtLeastPayment ? 'This fee is as large as your payment, or larger.' : null,
    notes,
  }
}

// What the account lacks to pay a fee up to `ceiling` from what it can spend, rounded up to 0.01
// XLM; null when it has enough, or when its balance is not known.
export function shortfall(ceiling: bigint, available: bigint | null): bigint | null {
  if (available === null || available >= ceiling) return null
  const step = 100_000n
  return ((ceiling - available + step - 1n) / step) * step
}

export const notEnoughText = (more: string): string =>
  `Your account needs about ${more} more XLM to pay this. Add XLM to this account, then try again.`

export const feeChangedText = (fee: string, approved: string): string =>
  `The fee changed while the payment was prepared. It is now about ${fee} XLM, above the ${approved} XLM you approved. Review it again.`

export const REVIEW_TIMED_OUT = 'The review timed out.'

export interface RefusalCopy {
  readonly title: string
  readonly lead: string
  readonly note: string
  // Under the button that pays from the account, what doing so costs and discloses; null where
  // there is no such button.
  readonly payNote: string | null
  readonly payLabel: string | null
}

// A relayer that did not send a payment, and what the user can do. `fee` is the relayer's fee of
// the payment in XLM, when the popup knows it.
export function refusalCopy(
  refusal: 'network_fee_high' | 'restore_needed',
  kind: 'send' | 'unshield',
  fee: string | null,
  account: string
): RefusalCopy {
  if (refusal === 'network_fee_high') {
    const covers = fee === null ? "the relayer's fee" : `the relayer's fee of ${fee} XLM`
    const lead = `The network fee is high right now, more than ${covers} covers. The relayer did not send your payment.`
    return kind === 'unshield'
      ? {
          title: 'Relayer did not send it',
          lead,
          note: 'Your private balance is unchanged. Try again later, when fees are lower, or pay the network fee from your account.',
          payNote: `Your account ${account} pays the network fee, at most ${NETWORK_FEE_CAP_XLM} XLM, and becomes publicly linked to this withdrawal. If it needs more, you are asked first.`,
          payLabel: 'Pay the fee myself',
        }
      : {
          title: 'Relayer did not send it',
          lead,
          note: 'Your private balance is unchanged. Private transfers always go through a relayer. Try again later.',
          payNote: null,
          payLabel: null,
        }
  }
  const lead =
    'Nobody has used the pool for a while, so the network put part of its data into storage. Bringing it back costs a fee that relayers do not pay, so the relayer did not send your payment.'
  return kind === 'unshield'
    ? {
        title: 'Pool needs a restore',
        lead,
        note: 'You can pay it from your account. It restores the pool for everyone: the first withdrawal after a long stop pays it once, and later transactions need nothing extra for a long while.',
        payNote: `Your account ${account} pays the fee and becomes publicly linked to this withdrawal. The fee is shown before anything is sent.`,
        payLabel: 'Pay from my account',
      }
    : {
        title: 'Pool needs a restore',
        lead,
        note: 'Private transfers go through a relayer, which does not pay for this. You can restore the pool from your account, then retry your payment, or try again later.',
        payNote: null,
        payLabel: null,
      }
}

// The pool restore, offered only under Advanced: what it costs, who pays and what it shows.
export const restoreWarning = (account: string): string =>
  `Your account ${account} pays a one-off fee to bring the pool's data back from storage, up to ${NETWORK_FEE_CAP_XLM} XLM. If it costs more, you are asked first. Everyone can use the pool again without paying it. This moves none of your funds, and it shows your account as the payer on the network.`

export const RESTORE_ADVANCED =
  "Only needed while the pool's data is in storage. A restore can cost far more than a normal fee."

export function restoreOutcome(restored: number, heldPayment: boolean): string {
  if (restored === 0) return 'Nothing needed restoring. The pool is ready.'
  return heldPayment
    ? 'The pool is restored. You can retry your payment now.'
    : 'The pool is restored.'
}

export const OPEN_PAYMENT = {
  title: 'Payment already pending',
  lead: 'A payment to this address has not finished yet. Finish it first so the same payment is not made twice.',
  note: 'It may still land. If it does not, your funds come back after its deadline.',
}

export const FEE_TOO_LARGE_NOTE =
  'Try again later. If the pool needs a restore, the fee can fall once someone pays it.'
export const STAYS_PENDING =
  'Your payment stays pending; you can retry it later from Private activity.'
export const RESTORE_NOT_SENT = 'Your payment was not sent. You can retry it from Private activity.'

export const WAITING_NOTE =
  'Nothing was sent and your funds stay in your private balance. You can review the fee again from Private activity.'

// A relayed payment the pool will queue, whose relayer asks its queued fee: `fee` and `usual` in XLM.
export function queuedNote(kind: 'send' | 'unshield', fee: string, usual: string): string {
  return kind === 'unshield'
    ? `This payout waits in the pool's exit queue and is paid in order. The relayer's fee is ${fee} XLM instead of the usual ${usual} XLM because queuing costs the network more.`
    : `The pool has a queue today, so the relayer's fee is ${fee} XLM instead of the usual ${usual} XLM. Your payment inside the pool is not delayed.`
}

// What follows the error of a relayer's queued fee above the wallet's limit, by what was paid.
export const queuedCapHint = (kind: 'send' | 'unshield'): string =>
  kind === 'unshield' ? ' You can also tick Submit without a relayer.' : ' Try again later.'

// A relayer that keeps refusing a withdrawal, as when a note it spends was spent elsewhere, may
// still let the account submit it itself.
export const RELAY_KEEPS_FAILING =
  'If the relayer keeps refusing it, tick Submit without a relayer: your account pays the network fee and becomes publicly linked to this withdrawal.'
