import { Loader2 } from 'lucide-react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { AssetIcon } from '@/components/token/AssetIcon'
import { PhaseBadge } from '@/components/PhaseBadge'
import type { PhaseInfo } from '@/lib/phase'
import { formatTime } from '@/lib/historyUtils'
import { formatAmount, shortAddress, type RowView } from '@/lib/activity'

function StatusPill({ status, label }: { status: RowView['status']; label?: string }) {
  if (status === 'confirmed') return null
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
        <span className="h-1 w-1 rounded-full bg-destructive" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
      <Loader2 size={9} className="animate-spin" />
      {label ?? 'Pending'}
    </span>
  )
}

export function ActivityRow({
  view,
  timestamp,
  icon,
  chainIcon,
  fiat,
  counterparty,
  privatePhase,
  trailing,
  onClick,
}: {
  view: RowView
  timestamp: string
  icon?: string
  chainIcon?: string
  fiat: string | null
  counterparty?: string
  privatePhase?: PhaseInfo | null
  trailing?: string
  onClick: () => void
}) {
  const counterpartyLabel =
    view.direction === 'in' ? 'From' : view.direction === 'out' ? 'To' : 'With'
  return (
    <button
      className="group cursor-pointer flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
      onClick={onClick}
    >
      <AssetIcon code={view.code} icon={icon} chainIcons={[chainIcon]} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium text-foreground">{view.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatTime(timestamp)}
          {counterparty && (
            <>
              {'  '}
              {counterpartyLabel} {shortAddress(counterparty)}
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {view.amount ? (
          <p
            className={`text-sm font-medium tabular-nums ${
              view.direction === 'in'
                ? 'text-green-500'
                : view.direction === 'out'
                  ? 'text-foreground'
                  : 'text-muted-foreground'
            }`}
          >
            {view.direction === 'in' ? '+' : view.direction === 'out' ? '-' : ''}
            {formatAmount(view.amount.value)}{' '}
            <span className="text-xs font-normal text-muted-foreground">{view.amount.code}</span>
            {view.verified ? (
              <VerifiedBadge className="ml-0.5 inline-block h-3 w-3 align-[-1px]" />
            ) : (
              <VerifiedMark
                code={view.amount.code}
                issuer={view.issuer}
                className="ml-0.5 h-3 w-3"
              />
            )}
          </p>
        ) : trailing ? (
          <p className="font-mono text-xs text-muted-foreground">{trailing}</p>
        ) : null}
        {privatePhase ? (
          <PhaseBadge phase={privatePhase} size={13} hideLabel />
        ) : view.status !== 'confirmed' ? (
          <StatusPill status={view.status} label={view.statusLabel} />
        ) : fiat ? (
          <p className="text-xs tabular-nums text-muted-foreground">{fiat}</p>
        ) : null}
      </div>
    </button>
  )
}
