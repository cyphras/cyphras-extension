import { useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, Send } from 'lucide-react'
import { formatUnits } from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import { SERVICE_TYPES } from '@constants/services'
import type {
  ServiceResponse,
  ShieldedDepositView,
  ShieldedPlanView,
  ShieldedScreening,
  ShieldedStatusView,
} from '@ext-types/index'

type Tone = 'ok' | 'warn' | 'bad' | 'muted'

const TONE: Record<Tone, string> = {
  ok: 'bg-green-500/10 text-green-600 dark:text-green-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}

interface RowStatus {
  label: string
  tone: Tone
  detail?: string
}

function when(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// Screening reason codes, shown by what they mean rather than as a refusal by default.
const SCREENING: Record<ShieldedScreening, { label: string; tone: Tone; detail: string }> = {
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

// A cancel or refund sent early in a deposit's life settles only once the deposit's own proof can
// no longer land, which takes a few minutes.
const SENT_UNCONFIRMED = 'Sent. It counts once the network confirms it.'

function depositStatus(d: ShieldedDepositView): RowStatus {
  const unconfirmed = d.confirmed === false ? ' (unconfirmed)' : ''
  switch (d.state) {
    case 'submitting':
      return {
        label: 'Submitting',
        tone: 'warn',
        detail: d.id === null ? 'Waiting for the network to confirm its deposit ID.' : undefined,
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
        return { label: s.label + code + unconfirmed, tone: s.tone, detail: s.detail + refund }
      }
      const at = d.earliestAdmission ? when(d.earliestAdmission) : null
      if (d.attested) {
        return {
          label: `Screened${unconfirmed}`,
          tone: 'warn',
          detail: at
            ? `Passed screening. Usable from about ${at}.`
            : "Passed screening. Usable once the pool's delay ends.",
        }
      }
      return {
        label: `Pending${unconfirmed}`,
        tone: 'warn',
        detail: at
          ? `Screening. Usable from ${at} at the earliest.`
          : 'Screening. The time it can be used shows once the pool reports it.',
      }
    }
    case 'admitted':
      return { label: `Admitted${unconfirmed}`, tone: 'ok' }
    case 'cancelled':
      return {
        label: `Cancelled${unconfirmed}`,
        tone: 'muted',
        detail: d.confirmed ? undefined : SENT_UNCONFIRMED,
      }
    case 'refunded':
      return {
        label: `Refunded${unconfirmed}`,
        tone: 'muted',
        detail: d.confirmed
          ? d.refundKind
            ? SCREENING[d.refundKind].label
            : undefined
          : SENT_UNCONFIRMED,
      }
    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: 'Nothing was deposited.' }
    case 'unresolved':
      return {
        label: 'Outcome unknown',
        tone: 'warn',
        detail:
          'It can no longer land, but whether it did is unknown. If it did, it shows here once the pool confirms it.',
      }
  }
}

// A payment that may still land, or failed only by the wallet's last reading of the chain, is
// paid again through a retry with the same notes, so at most one of the two can land.
function needsRetry(p: ShieldedPlanView): boolean {
  return p.mustRetry && (p.state === 'dead' || p.needsUserDecision)
}

function planStatus(p: ShieldedPlanView): RowStatus {
  const unconfirmed = p.exitConfirmed === false ? ' (unconfirmed)' : ''
  if (p.needsUserDecision) {
    return {
      label: 'Outcome unknown',
      tone: 'warn',
      detail: 'Its deadline passed before the wallet saw the whole pool. A retry cannot pay twice.',
    }
  }
  switch (p.state) {
    case 'prepared':
      return {
        label: 'Prepared',
        tone: 'warn',
        detail: 'It may still land until its deadline passes, and holds its notes until then.',
      }
    case 'submitted':
      return {
        label: p.relayerStatus === 'held' ? 'Held by the relayer' : 'Submitted',
        tone: 'warn',
      }
    case 'confirmed':
      return { label: p.kind === 'send' ? 'Sent' : 'Confirmed', tone: 'ok' }
    case 'queued':
      return {
        label: `Queued for payout${unconfirmed}`,
        tone: 'warn',
        detail: "The payout waits in the pool's exit queue and is paid in order.",
      }
    case 'settled':
      // A transfer settles as soon as it lands: its payment is the recipient's note, not a payout.
      return p.kind === 'send'
        ? { label: 'Sent', tone: 'ok' }
        : { label: `Paid out${unconfirmed}`, tone: 'ok' }
    case 'stranded':
      return {
        label: `Stranded${unconfirmed}`,
        tone: 'bad',
        detail:
          p.exitConfirmed === true
            ? 'The destination could not receive the payout. Claim it once it can.'
            : "Only the pool's indexer says the destination could not receive the payout. A claim is offered once the vault's own events show it.",
      }
    case 'superseded':
      return { label: 'Replaced by a retry', tone: 'muted' }
    case 'dead':
      return {
        label: 'Not sent',
        tone: 'bad',
        detail: 'Its deadline passed without it landing. A retry cannot pay twice.',
      }
  }
}

// What the account itself can do about a deposit or a payout, each a transaction it signs and pays
// the network fee of.
interface AccountAction {
  key: string
  type:
    | typeof SERVICE_TYPES.SHIELDED_CANCEL
    | typeof SERVICE_TYPES.SHIELDED_REFUND
    | typeof SERVICE_TYPES.SHIELDED_CLAIM
  id: number
  label: string
  explain: string
}

const FEE_NOTE = 'Your account pays a network fee of up to 1.01 XLM.'

function depositActions(d: ShieldedDepositView, now: number): AccountAction[] {
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
function planActions(p: ShieldedPlanView): AccountAction[] {
  if (p.state !== 'stranded' || p.exitConfirmed !== true) return []
  return p.strandedExits.map((id) => ({
    key: `claim:${id}`,
    type: SERVICE_TYPES.SHIELDED_CLAIM,
    id,
    label: 'Claim payout',
    explain: `The payout goes back into the exit queue and is paid once the destination can receive. Your account submits the claim and becomes publicly linked to this withdrawal. ${FEE_NOTE}`,
  }))
}

function Row({
  icon,
  title,
  status,
  action,
}: {
  icon: ReactNode
  title: string
  status: RowStatus
  action?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card px-4 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE[status.tone]}`}
        >
          {status.label}
        </span>
        {status.detail && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{status.detail}</p>
        )}
        {action}
      </div>
    </div>
  )
}

interface ShieldedActivityProps {
  status: ShieldedStatusView
  poolId: string
  code: string
  decimals: number
  onRetry: (plan: ShieldedPlanView) => void
  onChanged: () => void
}

// The account's deposits and payments with where each stands, newest first.
export default function ShieldedActivity({
  status,
  poolId,
  code,
  decimals,
  onRetry,
  onChanged,
}: ShieldedActivityProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const plans = status.plans.filter((p) => p.state !== 'superseded')
  if (status.deposits.length === 0 && plans.length === 0) return null
  const amount = (units: string) => `${formatUnits(units, decimals)} ${code}`
  const now = Math.floor(Date.now() / 1000)

  function run(action: AccountAction) {
    setConfirming(null)
    setRunning(action.key)
    chrome.runtime.sendMessage(
      { type: action.type, poolId, id: action.id },
      (r: ServiceResponse) => {
        setRunning(null)
        // A restart after the request left may still have sent the transaction.
        const outcome = chrome.runtime.lastError
          ? {
              ok: true,
              text: 'The extension restarted, so it may have been sent. The next sync shows what became of it.',
            }
          : r?.error
            ? { ok: false, text: r.error }
            : { ok: true, text: 'Sent.' }
        setOutcomes((prev) => ({ ...prev, [action.key]: outcome }))
        onChanged()
      }
    )
  }

  function actionsOf(actions: AccountAction[]): ReactNode {
    if (actions.length === 0) return null
    return (
      <div className="mt-2 flex flex-col gap-2">
        {actions.map((action) =>
          confirming === action.key ? (
            <div key={action.key} className="rounded-lg bg-muted px-3 py-2">
              <p className="text-[11px] leading-snug text-muted-foreground">{action.explain}</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setConfirming(null)}
                  className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background"
                >
                  Keep
                </button>
                <button
                  onClick={() => run(action)}
                  className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  {action.label}
                </button>
              </div>
            </div>
          ) : (
            <div key={action.key}>
              <button
                onClick={() => setConfirming(action.key)}
                disabled={running !== null}
                className="inline-flex cursor-pointer items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:opacity-50"
              >
                {running === action.key ? 'Sending...' : action.label}
              </button>
              {outcomes[action.key] && (
                <p
                  className={`mt-1 text-[11px] ${outcomes[action.key].ok ? 'text-muted-foreground' : 'text-destructive'}`}
                >
                  {outcomes[action.key].text}
                </p>
              )}
            </div>
          )
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="pixel-label px-1 text-[10px] text-muted-foreground">Private activity</p>
      {plans.map((p) => (
        <Row
          key={p.planId}
          icon={p.kind === 'send' ? <Send size={14} /> : <ArrowUpFromLine size={14} />}
          title={`${p.kind === 'send' ? 'Send' : 'Unshield'} ${amount(p.amount)} to ${shortAddress(p.to)}`}
          status={planStatus(p)}
          action={
            needsRetry(p) ? (
              <button
                onClick={() => onRetry(p)}
                className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <RotateCcw size={12} /> Retry with the same notes
              </button>
            ) : (
              actionsOf(planActions(p))
            )
          }
        />
      ))}
      {status.deposits.map((d, i) => (
        <Row
          key={d.txHash ?? `deposit-${i}`}
          icon={<ArrowDownToLine size={14} />}
          title={`Shield ${amount(d.amount)}`}
          status={depositStatus(d)}
          action={actionsOf(depositActions(d, now))}
        />
      ))}
    </div>
  )
}
