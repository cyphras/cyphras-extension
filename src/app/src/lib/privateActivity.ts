import { SERVICE_TYPES } from '@constants/services'
import type {
  ShieldedDepositView,
  ShieldedPlanView,
  ShieldedScreening,
  ShieldedStatusView,
} from '@ext-types/index'
import { changeOf } from '@/lib/privateBalance'

// Where a deposit or payment stands, in the glossary's words: a short label for its pill, a tone,
// a sentence that says what is happening and when it resolves, and its stage: done, on its way,
// waiting on the user or a hold, or failed for good.
export type Tone = 'ok' | 'warn' | 'bad' | 'muted'

type Stage = 'done' | 'progress' | 'attention' | 'failed'

export interface ItemStatus {
  readonly label: string
  readonly tone: Tone
  readonly detail?: string
  readonly stage: Stage
}

export function when(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// A proof expires 120 ledgers after it is built, about twelve minutes at testnet's pace, and the
// wallet sees it after its next sync, so its funds are back two minutes later at the latest.
const DEADLINE_MS = 14 * 60_000

const deadlineOf = (p: ShieldedPlanView): number => Math.floor((p.createdAt + DEADLINE_MS) / 1000)

// Screening reason codes, by what they mean rather than as a refusal by default.
export const SCREENING: Record<ShieldedScreening, { label: string; tone: Tone; detail: string }> = {
  held_for_review: {
    label: 'Held for review',
    tone: 'warn',
    detail: 'Not a refusal: it may still be admitted, or is refunded a day after the hold.',
  },
  refused_by_reviewer: {
    label: 'Refused by a reviewer',
    tone: 'bad',
    detail: 'It goes back to your account a day after the flag, or now if you cancel it.',
  },
  legal_hold: {
    label: 'Legal hold',
    tone: 'bad',
    detail: "Held under an authority's order. You can still cancel it to take it back.",
  },
  refused: {
    label: 'Refused by screening',
    tone: 'bad',
    detail: 'It goes back to your account a day after the flag, or now if you cancel it.',
  },
  cancelled: { label: 'Cancelled', tone: 'muted', detail: 'You took the deposit back.' },
  unknown: {
    label: 'Unknown flag',
    tone: 'warn',
    detail: 'This version does not know what this flag means.',
  },
}

// A state that rests on the pool's indexer alone, until the chain confirms it.
const INDEXER_ONLY = "So far only the pool's indexer reports this."

export function depositStatus(d: ShieldedDepositView): ItemStatus {
  const unconfirmed = d.confirmed ? '' : ` ${INDEXER_ONLY}`
  switch (d.state) {
    case 'submitting':
      return {
        label: 'Depositing',
        tone: 'warn',
        detail: 'Waiting for the network to confirm it.',
        stage: 'progress',
      }
    case 'pending': {
      if (d.flag) {
        const s = SCREENING[d.flag.kind]
        const code = d.flag.kind === 'unknown' ? ` (code ${d.flag.reason})` : ''
        const refund =
          d.refundableAt === null
            ? ''
            : d.refundableAt * 1000 <= Date.now()
              ? ' Refundable now.'
              : ` Refundable from ${when(d.refundableAt)}.`
        return {
          label: `${s.label}${code}`,
          tone: s.tone,
          detail: `${s.detail}${refund}${unconfirmed}`,
          stage: 'attention',
        }
      }
      const at = d.earliestAdmission ? when(d.earliestAdmission) : null
      return {
        label: 'Screening',
        tone: 'warn',
        detail:
          (d.attested
            ? at
              ? `Passed screening. Usable from about ${at}.`
              : "Passed screening. Usable once the pool's delay ends."
            : at
              ? `Usable from ${at} at the earliest.`
              : 'The time it can be used shows once the pool reports it.') + unconfirmed,
        stage: 'progress',
      }
    }
    case 'admitted':
      return {
        label: 'Shielded',
        tone: 'ok',
        detail: d.confirmed ? undefined : INDEXER_ONLY,
        stage: 'done',
      }
    case 'cancelled':
      return {
        label: 'Cancelled',
        tone: 'muted',
        detail: d.confirmed
          ? 'You took the deposit back.'
          : 'Sent. It counts once the network confirms it.',
        stage: d.confirmed ? 'done' : 'progress',
      }
    case 'refunded':
      return {
        label: 'Refunded',
        tone: 'muted',
        detail: d.confirmed
          ? d.refundKind
            ? `${SCREENING[d.refundKind].label}. It went back to your account.`
            : 'It went back to your account.'
          : 'Sent. It counts once the network confirms it.',
        stage: d.confirmed ? 'done' : 'progress',
      }
    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: 'Nothing was deposited.', stage: 'failed' }
    case 'unresolved':
      return {
        label: 'Outcome unknown',
        tone: 'warn',
        detail:
          'It can no longer land, but whether it did is unknown. If it did, it shows here once the pool confirms it.',
        stage: 'attention',
      }
  }
}

// A payment that may still land, or failed only by the wallet's last reading of the chain, is paid
// again through a retry with the same notes, so at most one of the two can land.
export function needsRetry(p: ShieldedPlanView): boolean {
  return p.mustRetry && (p.state === 'dead' || p.needsUserDecision)
}

export function planStatus(
  status: ShieldedStatusView,
  p: ShieldedPlanView,
  unit: (units: bigint | string) => string
): ItemStatus {
  const indexerOnly = p.exitConfirmed === false ? ` ${INDEXER_ONLY}` : ''
  if (p.needsUserDecision) {
    return {
      label: 'Outcome unknown',
      tone: 'warn',
      detail:
        'Its deadline passed before the wallet saw the whole pool. A retry with the same notes cannot pay twice.',
      stage: 'attention',
    }
  }
  switch (p.state) {
    case 'prepared':
      return {
        label: 'May still land',
        tone: 'warn',
        detail: `It may still land. Your funds come back if it does not, by ${when(deadlineOf(p))}.`,
        stage: 'attention',
      }
    case 'submitted': {
      const change = changeOf(status, p)
      const what = `${p.kind === 'send' ? 'Sending' : 'Unshielding'} ${unit(p.amount)}.`
      return {
        label: p.relayerStatus === 'held' ? 'Scheduled' : 'Sending',
        tone: 'warn',
        detail:
          change === null
            ? `${what} The change returns when it confirms.`
            : change > 0n
              ? `${what} Your ${unit(change)} change returns when it confirms.`
              : what,
        stage: 'progress',
      }
    }
    case 'confirmed':
      return p.kind === 'send'
        ? { label: 'Sent', tone: 'ok', stage: 'done' }
        : { label: 'Landed', tone: 'warn', detail: 'The payout follows.', stage: 'progress' }
    case 'settled':
      return p.kind === 'send'
        ? { label: 'Sent', tone: 'ok', stage: 'done' }
        : { label: 'Paid out', tone: 'ok', detail: indexerOnly.trim() || undefined, stage: 'done' }
    case 'queued':
      return {
        label: 'Sending',
        tone: 'warn',
        detail: `Waiting in the pool's exit queue, which pays out in order.${indexerOnly}`,
        stage: 'progress',
      }
    case 'stranded':
      return {
        label: 'Held',
        tone: 'bad',
        detail:
          p.exitConfirmed === true
            ? 'The destination could not receive the payout. Claim it once it can.'
            : "Only the pool's indexer says the destination could not receive the payout. A claim is offered once the vault's own events show it.",
        stage: 'attention',
      }
    case 'superseded':
      return { label: 'Replaced by a retry', tone: 'muted', stage: 'done' }
    case 'dead':
      return {
        label: 'Not sent',
        tone: 'bad',
        detail:
          'Its deadline passed without it landing, so your funds are back in Available. A retry with the same notes cannot pay twice.',
        stage: 'attention',
      }
  }
}

// Who holds a payment that may still land, and where its retry goes first.
export function routeText(p: ShieldedPlanView): string {
  return p.route.kind === 'relayer'
    ? `Relayer ${new URL(p.route.url).host}`
    : `Your account ${p.route.account.slice(0, 4)}...${p.route.account.slice(-4)}`
}

// What the account itself can do about a deposit or a payout, each a transaction it signs and pays
// the network fee of.
export interface AccountAction {
  readonly key: string
  readonly type:
    | typeof SERVICE_TYPES.SHIELDED_CANCEL
    | typeof SERVICE_TYPES.SHIELDED_REFUND
    | typeof SERVICE_TYPES.SHIELDED_CLAIM
  readonly id: number
  readonly label: string
  readonly explain: string
}

const FEE_NOTE = 'Your account pays a network fee of up to 1.01 XLM.'

export function depositActions(d: ShieldedDepositView, now: number): AccountAction[] {
  if (d.state !== 'pending' || d.id === null) return []
  const actions: AccountAction[] = [
    {
      key: `cancel:${d.id}`,
      type: SERVICE_TYPES.SHIELDED_CANCEL,
      id: d.id,
      label: 'Cancel deposit',
      explain: `The deposit goes back to your account. ${FEE_NOTE}`,
    },
  ]
  if (d.flag && d.refundableAt !== null && d.refundableAt <= now) {
    actions.push({
      key: `refund:${d.id}`,
      type: SERVICE_TYPES.SHIELDED_REFUND,
      id: d.id,
      label: 'Claim refund',
      explain: `The refund goes to the account that deposited. ${FEE_NOTE}`,
    })
  }
  return actions
}

// A claim is offered only on a stranded exit the vault's own events show: the vault refuses any
// other, and the claim's simulation would still show the RPC this account beside the exit.
export function planActions(p: ShieldedPlanView): AccountAction[] {
  if (p.state !== 'stranded' || p.exitConfirmed !== true) return []
  return p.strandedExits.map((id) => ({
    key: `claim:${id}`,
    type: SERVICE_TYPES.SHIELDED_CLAIM,
    id,
    label: 'Claim payout',
    explain: `The payout goes back into the exit queue and is paid once the destination can receive. Your account submits the claim and becomes publicly linked to this withdrawal. ${FEE_NOTE}`,
  }))
}

// Whether a deposit or payment has anything for the user to do about it.
export function hasActions(
  plan: ShieldedPlanView | null,
  deposit: ShieldedDepositView | null
): boolean {
  if (plan) return needsRetry(plan) || planActions(plan).length > 0
  return deposit ? depositActions(deposit, Math.floor(Date.now() / 1000)).length > 0 : false
}
