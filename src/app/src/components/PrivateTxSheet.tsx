import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { StepList } from '@/components/BridgeProgress'
import { PrivateActions } from '@/components/PrivateActions'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { Button } from '@/components/ui/button'
import {
  AddressValue,
  AdvancedDetails,
  CopyValue,
  DetailRow,
  PrivateAddressValue,
  StatusPill,
  type StatusTone,
} from '@/components/TxDetailParts'
import { usePreferences } from '@/context/PreferencesContext'
import { formatAmount } from '@/lib/activity'
import { trimZeros, stroopsToXlm } from '@/lib/historyUtils'
import { routeText, SCREENING, type Tone } from '@/lib/privateActivity'
import { stepsOf, type PrivateEntry } from '@/lib/privateHistory'
import type { ShieldedPlanView } from '@ext-types/index'

const PILL_TONE: Record<Tone, StatusTone> = { ok: 'ok', warn: 'warn', bad: 'bad', muted: 'warn' }

// The detail of one private history entry, laid out like a public transaction's: amount and status,
// the parties, the fee and the route, the transaction, how it got here, and what the user can do.
export function PrivateTxSheet({
  entry,
  networkId,
  horizonUrl,
  accountPk,
  icon,
  chainIcon,
  fiat,
  poolId,
  onRetry,
  onChanged,
  onClose,
}: {
  entry: PrivateEntry | null
  networkId: string
  horizonUrl: string
  accountPk: string
  icon?: string
  chainIcon?: string
  fiat: string | null
  poolId: string
  onRetry: (plan: ShieldedPlanView) => void
  onChanged: () => void
  onClose: () => void
}) {
  const { getExplorerTxUrl } = usePreferences()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // The network fee of a transaction the account sent itself; a relayed payment's fee is the
  // relayer's, and looking its transaction up would tie this account to it.
  const [networkFee, setNetworkFee] = useState<string | null>(null)
  const item = entry?.item
  const ownTx =
    !!item?.txHash &&
    (item.kind === 'shield' ||
      item.kind === 'cancel' ||
      item.kind === 'refund' ||
      item.kind === 'claim' ||
      entry?.plan?.route.kind === 'self')
  useEffect(() => {
    setNetworkFee(null)
    if (!ownTx || !item?.txHash) return
    let current = true
    fetch(`${horizonUrl}/transactions/${item.txHash}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tx: { fee_charged?: string } | null) => {
        if (current && tx?.fee_charged) setNetworkFee(trimZeros(stroopsToXlm(tx.fee_charged)))
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [ownTx, item?.txHash, horizonUrl])

  if (!entry || !item) return <BottomSheet open={false} title={null} onClose={onClose} />
  const { view, plan, deposit, status } = entry
  const sign = view.direction === 'in' ? '+' : view.direction === 'out' ? '-' : ''
  const when = item.time
    ? new Date(item.time).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not known yet'
  const counterparty = item.counterparty
  const party =
    item.kind === 'send' && counterparty ? (
      <PrivateAddressValue address={counterparty} />
    ) : (item.kind === 'unshield' || item.kind === 'claim') && counterparty ? (
      <AddressValue address={counterparty} isYou={counterparty === accountPk} />
    ) : item.kind === 'receive' ? (
      'Private pool'
    ) : (
      'Your account'
    )
  // A relayed payment or a received one is the account's private business: an explorer that shows
  // its transaction learns that this browser looked at it.
  const privateTx = item.kind === 'receive' || (plan !== null && plan.route.kind === 'relayer')

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <AssetIcon code={view.code} icon={icon} chainIcons={[chainIcon]} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{view.label}</p>
            <p className="text-xs font-normal text-muted-foreground">Private pool</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-card px-4 py-5 text-center">
          {view.amount && (
            <>
              <p
                className={`text-2xl font-bold tabular-nums ${view.direction === 'in' ? 'text-green-500' : 'text-foreground'}`}
              >
                {sign}
                {formatAmount(view.amount.value)}{' '}
                <span className="text-base font-medium text-muted-foreground">
                  {view.amount.code}
                </span>
                <VerifiedBadge className="ml-1 inline-block h-4 w-4 align-[-2px]" />
              </p>
              {fiat && <p className="mt-1 text-sm text-muted-foreground">{fiat}</p>}
            </>
          )}
          <StatusPill text={status.label} tone={PILL_TONE[status.tone]} />
          {status.detail && (
            <p className="mt-3 text-xs leading-snug text-muted-foreground">{status.detail}</p>
          )}
        </div>

        {(plan || deposit) && (
          <PrivateActions
            plan={plan}
            deposit={deposit}
            poolId={poolId}
            onRetry={(p) => {
              onClose()
              onRetry(p)
            }}
            onChanged={onChanged}
          />
        )}

        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <DetailRow label="Date">{when}</DetailRow>
          <DetailRow label={view.direction === 'in' ? 'From' : 'To'}>{party}</DetailRow>
          {item.fee !== null && item.fee !== '0' ? (
            <DetailRow label="Relayer fee">
              <span className="tabular-nums">
                {formatAmount(trimZeros(stroopsToXlm(item.fee)))} {view.code}
              </span>
            </DetailRow>
          ) : (
            networkFee && (
              <DetailRow label="Network fee">
                <span className="tabular-nums">{networkFee} XLM, from your account</span>
              </DetailRow>
            )
          )}
          {plan && <DetailRow label="Route">{routeText(plan)}</DetailRow>}
          {deposit?.flag && (
            <DetailRow label="Screening">{SCREENING[deposit.flag.kind].label}</DetailRow>
          )}
          {item.txHash && (
            <DetailRow label="Transaction">
              <CopyValue value={item.txHash} />
            </DetailRow>
          )}
        </div>

        <StepList steps={stepsOf(entry)} />

        <AdvancedDetails open={advancedOpen} onToggle={() => setAdvancedOpen((p) => !p)}>
          {item.ledger !== null && (
            <DetailRow label="Ledger">#{item.ledger.toLocaleString()}</DetailRow>
          )}
          {deposit?.id !== undefined && deposit?.id !== null && (
            <DetailRow label="Deposit">#{deposit.id}</DetailRow>
          )}
          {plan?.relayerStatus && <DetailRow label="Relayer says">{plan.relayerStatus}</DetailRow>}
          <DetailRow label="Amount">
            <span className="font-mono">{view.amount?.value}</span>
          </DetailRow>
        </AdvancedDetails>

        {item.txHash && (
          <div className="flex flex-col gap-1.5">
            <Button variant="outline" className="w-full" asChild>
              <a
                href={getExplorerTxUrl(item.txHash, networkId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on explorer
                <ExternalLink size={13} className="ml-1.5" />
              </a>
            </Button>
            {privateTx && (
              <p className="px-1 text-center text-[11px] leading-snug text-muted-foreground">
                The explorer learns that this browser looked at this transaction.
              </p>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
