import { useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowDownToLine, ArrowUpFromLine, RotateCcw, Send } from 'lucide-react'
import { formatUnits } from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import {
  depositActions,
  depositStatus,
  needsRetry,
  planActions,
  planStatus,
  routeText,
  type AccountAction,
  type ItemStatus,
  type Tone,
} from '@/lib/privateActivity'
import type { ServiceResponse, ShieldedPlanView, ShieldedStatusView } from '@ext-types/index'

const TONE: Record<Tone, string> = {
  ok: 'bg-green-500/10 text-green-600 dark:text-green-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}

function Row({
  icon,
  title,
  status,
  note,
  action,
}: {
  icon: ReactNode
  title: string
  status: ItemStatus
  note?: string
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
        {note && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>}
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

// The account's payments, the payments it received and its deposits, with where each stands, newest
// first within each.
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
  if (status.deposits.length === 0 && plans.length === 0 && status.received.length === 0) {
    return null
  }
  const amount = (units: bigint | string) => `${formatUnits(units, decimals)} ${code}`
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
          status={planStatus(status, p, amount)}
          note={p.mustRetry ? `Went through: ${routeText(p)}.` : undefined}
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
      {status.received.map((r, i) => (
        <Row
          key={`${r.txHash ?? 'received'}-${i}`}
          icon={<ArrowDownLeft size={14} />}
          title={`Received ${amount(r.amount)}`}
          status={{ label: 'Received', tone: 'ok', done: true }}
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
