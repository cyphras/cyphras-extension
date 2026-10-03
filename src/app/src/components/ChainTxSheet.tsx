import { useState } from 'react'
import { usePreferences } from '@/context/PreferencesContext'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { ExternalLink } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { AssetIcon } from '@/components/token/AssetIcon'
import { Button } from '@/components/ui/button'
import {
  AddressValue,
  AdvancedDetails,
  CopyValue,
  DetailRow,
  NetworkValue,
  StatusPill,
} from '@/components/TxDetailParts'
import { explorerUrl, type ChainEntry } from '@constants/chains'
import type { ChainActivity } from '@ext-types/index'
import { chainTxView, formatAmount } from '@/lib/activity'
import { formatSignificant } from '@/lib/amount'

export function ChainTxSheet({
  tx,
  chain,
  chainName,
  chainIcon,
  icon,
  fiat,
  onClose,
}: {
  tx: ChainActivity | null
  chain?: ChainEntry
  chainName: string
  chainIcon?: string
  icon?: string
  fiat: string | null
  onClose: () => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const { chainExplorer } = usePreferences()
  if (!tx) return null
  const view = chainTxView(tx)
  const explorer = chain ? explorerUrl(chainExplorer(chain).tx, tx.hash) : null
  const when = new Date(tx.timestamp)
  const sentByYou = tx.direction !== 'in'

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <AssetIcon code={view.code} icon={icon} chainIcons={[chainIcon]} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{view.label}</p>
            <p className="text-xs font-normal text-muted-foreground">{chainName}</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-card px-4 py-5 text-center">
          {view.amount ? (
            <>
              <p
                className={`text-2xl font-bold tabular-nums ${view.direction === 'in' ? 'text-green-500' : 'text-foreground'}`}
              >
                {view.direction === 'in' ? '+' : view.direction === 'out' ? '-' : ''}
                {formatAmount(view.amount.value)}{' '}
                <span className="text-base font-medium text-muted-foreground">
                  {view.amount.code}
                </span>
                <VerifiedMark
                  code={view.amount.code}
                  issuer={view.issuer}
                  className="ml-1 h-4 w-4"
                />
              </p>
              {fiat && <p className="mt-1 text-sm text-muted-foreground">{fiat}</p>}
            </>
          ) : (
            <p className="text-lg font-semibold text-foreground">{view.label}</p>
          )}
          <StatusPill
            text={
              view.status === 'failed'
                ? 'Failed'
                : view.status === 'pending'
                  ? 'Pending'
                  : 'Confirmed'
            }
            tone={view.status === 'failed' ? 'bad' : view.status === 'pending' ? 'warn' : 'ok'}
          />
        </div>

        <div className="rounded-xl bg-card px-4 divide-y divide-border/60">
          <DetailRow label="Date">
            {when.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </DetailRow>
          <DetailRow label="Network">
            <NetworkValue name={chainName} icon={chainIcon} />
          </DetailRow>
          <DetailRow label="From">
            <AddressValue address={tx.from} isYou={sentByYou} />
          </DetailRow>
          <DetailRow label="To">
            <AddressValue address={tx.to || undefined} isYou={tx.direction !== 'out'} />
          </DetailRow>
          {tx.fee && sentByYou && (
            <DetailRow label="Network fee">
              <span className="tabular-nums">
                {formatSignificant(tx.fee)} {tx.feeCode}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Transaction">
            <CopyValue value={tx.hash} />
          </DetailRow>
        </div>

        <AdvancedDetails open={advancedOpen} onToggle={() => setAdvancedOpen((p) => !p)}>
          <DetailRow label="Type">
            <span className="font-mono">{tx.kind}</span>
          </DetailRow>
          {tx.method && (
            <DetailRow label="Method">
              <span className="font-mono">{tx.method}</span>
            </DetailRow>
          )}
          {tx.tokenAddress && (
            <DetailRow label="Token contract">
              <CopyValue value={tx.tokenAddress} />
            </DetailRow>
          )}
          {tx.fee && !sentByYou && (
            <DetailRow label="Fee paid by sender">
              <span className="tabular-nums">
                {formatSignificant(tx.fee)} {tx.feeCode}
              </span>
            </DetailRow>
          )}
          <DetailRow label="Amount">
            <span className="font-mono">{tx.amount}</span>
          </DetailRow>
        </AdvancedDetails>

        {explorer && (
          <Button variant="outline" className="w-full" asChild>
            <a href={explorer} target="_blank" rel="noopener noreferrer">
              View on explorer
              <ExternalLink size={13} className="ml-1.5" />
            </a>
          </Button>
        )}
      </div>
    </BottomSheet>
  )
}
