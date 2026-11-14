import { SERVICE_TYPES } from '@constants/services'
import type { ShieldedFeeEntry, ShieldedFeeReason, ShieldedScope } from '@ext-types/index'

// The most a transaction the account submits itself pays the network without asking: the SDK's
// caps of 0.01 XLM to get included and 1 XLM of resources.
export const NETWORK_FEE_CAP_STROOPS = 10_100_000n
export const NETWORK_FEE_CAP_XLM = '1.01'

// A fee review that waits this long for an answer is declined. It ends before the background's
// offer does, so an approval in the last moment never meets an offer that just expired.
export const FEE_REVIEW_TIMEOUT_MS = 3 * 60_000 - 15_000

// What a fee review is about: a transaction the account submits itself for a payment or a deposit,
// or one of its own actions.
export type FeeSubject = 'shield' | 'unshield' | 'cancel' | 'refund' | 'claim' | 'restore'

export const FEE_TITLES: Record<ShieldedFeeReason, string> = {
  network: 'Network fee is high',
  rent: 'Pool storage fee',
  restore: 'Pool restore fee',
}

// The title of a review: by what the fee pays for, or, for a call its own fees stopped, what it
// asks of the user.
export const feeTitle = (reason: ShieldedFeeReason, paid: string | undefined): string =>
  paid === undefined ? FEE_TITLES[reason] : 'Needs your approval'

// `paid`, in XLM, is what the call already paid in network fees before it stopped at the most it
// was shown, as for a restore of the pool before the payment.
export function feeLead(reason: ShieldedFeeReason, paid?: string): string {
  if (paid !== undefined) {
    return `This payment already paid ${paid} XLM in network fees, as for bringing the pool's data back, and its next transaction would take its fees past the most you were shown. Nothing more was sent. Approve the next transaction to go on.`
  }
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
  if (reason === 'restore' && subject !== 'restore') {
    notes.push(
      `Most you will pay includes up to ${NETWORK_FEE_CAP_XLM} XLM for the transaction that follows the restore.`
    )
  }
  notes.push(
    'Most you will pay is the fee plus 10%, rounded up to the next 0.01 XLM, so the fee can move a little before it is sent.',
    'This approval is for this payment only. If its fees would go past this amount, nothing more is sent and you are asked again.'
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

// Two XLM amounts as the popup writes them, compared exactly.
function stroopsOf(amount: string): bigint {
  const [whole, frac = ''] = amount.split('.')
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0').slice(0, 7))
}

// A fee asked again after an approval: above what was approved, or changed in another way, as when
// a restore was approved and the transaction after it needs more than the default.
export function feeChangedText(fee: string, approved: string): string {
  return stroopsOf(fee) > stroopsOf(approved)
    ? `The fee changed while the payment was prepared. It is now about ${fee} XLM, above the ${approved} XLM you approved. Review it again.`
    : `The fee changed while the payment was prepared. It is now about ${fee} XLM. Review it again.`
}

export const REVIEW_TIMED_OUT = 'The review timed out.'

// The relayer still holds the refused payment's proof until its deadline, so a new payment of the
// same could land beside it.
export const NOT_AGAIN =
  'Do not send it again as a new payment. Use Try again in Private activity: it spends the same notes, so at most one can land.'

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
          note: `Nothing has left your private balance yet. Try again later, when fees are lower, or pay the network fee from your account. ${NOT_AGAIN}`,
          payNote: `Your account ${account} pays the network fee, at most ${NETWORK_FEE_CAP_XLM} XLM, and becomes publicly linked to this withdrawal. If it needs more, you are asked first.`,
          payLabel: 'Pay the fee myself',
        }
      : {
          title: 'Relayer did not send it',
          lead,
          note: `Nothing has left your private balance yet. Private transfers always go through a relayer. Try again later. ${NOT_AGAIN}`,
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
        note: `You can pay it from your account. It restores the pool for everyone: the first withdrawal after a long stop pays it once, and later transactions need nothing extra for a long while. ${NOT_AGAIN}`,
        payNote: `Your account ${account} pays the fee, at most ${NETWORK_FEE_CAP_XLM} XLM, and becomes publicly linked to this withdrawal. If it needs more, you are asked first.`,
        payLabel: 'Pay from my account',
      }
    : {
        title: 'Pool needs a restore',
        lead,
        note: `Private transfers go through a relayer, which does not pay for this. You can restore the pool from your account, then retry your payment, or try again later. ${NOT_AGAIN}`,
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

// A private send to an address that a payment of this account has not finished paying.
export const OPEN_SEND = {
  lead: 'A payment to this address has not finished yet. Continue it to pay with the same notes, so at most one arrives.',
  note: 'If you send another payment instead, both may arrive.',
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

export const OFFER_EXPIRED = 'The approval expired. Review the fee again from Private activity.'

export const WAITING_NOTE =
  'Nothing was sent and your funds stay in your private balance. You can review the fee again from Private activity. Do not send it again as a new payment: the review there spends the same notes, so at most one can land.'

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
  'If the relayer keeps refusing it, retry it from Private activity with Submit without a relayer ticked: the retry spends the same notes, and your account pays the network fee and becomes publicly linked to this withdrawal.'

// Tells the background the user said no, so the offer ends now rather than at its expiry.
export function dropOffer(offer: string | undefined, scope: ShieldedScope | null): void {
  if (offer === undefined) return
  chrome.runtime.sendMessage({ type: SERVICE_TYPES.SHIELDED_DROP_OFFER, offer, ...scope })
}
