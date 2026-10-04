import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, Send } from 'lucide-react'
import { formatUnits } from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import type {
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
    detail: 'The deposit goes back to your account.',
  },
  legal_hold: {
    label: 'Legal hold',
    tone: 'bad',
    detail: "Held under an authority's order. You can still take it back yourself.",
  },
  refused: {
    label: 'Refused by screening',
    tone: 'bad',
    detail: 'The deposit goes back to your account.',
  },
  cancelled: { label: 'Cancelled', tone: 'muted', detail: 'You took the deposit back.' },
  unknown: {
    label: 'Unknown flag',
    tone: 'warn',
    detail: 'This version does not know what this flag means.',
  },
}

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
        const refund = d.refundableAt ? ` Refundable from ${when(d.refundableAt)}.` : ''
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
      return { label: `Cancelled${unconfirmed}`, tone: 'muted' }
    case 'refunded':
      return {
        label: `Refunded${unconfirmed}`,
        tone: 'muted',
        detail: d.refundKind ? SCREENING[d.refundKind].label : undefined,
      }
    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: 'Nothing was deposited.' }
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
      return { label: 'Prepared', tone: 'warn' }
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
      return { label: `Paid out${unconfirmed}`, tone: 'ok' }
    case 'stranded':
      return {
        label: `Stranded${unconfirmed}`,
        tone: 'bad',
        detail: 'The destination could not receive the payout; it waits for a claim.',
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
  code: string
  decimals: number
  onRetry: (plan: ShieldedPlanView) => void
}

// The account's deposits and payments with where each stands, newest first.
export default function ShieldedActivity({
  status,
  code,
  decimals,
  onRetry,
}: ShieldedActivityProps) {
  const plans = status.plans.filter((p) => p.state !== 'superseded')
  if (status.deposits.length === 0 && plans.length === 0) return null
  const amount = (units: string) => `${formatUnits(units, decimals)} ${code}`

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
            needsRetry(p) && (
              <button
                onClick={() => onRetry(p)}
                className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <RotateCcw size={12} /> Retry with the same notes
              </button>
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
        />
      ))}
    </div>
  )
}
