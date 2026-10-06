import { useEffect, useRef } from 'react'
import { ChevronLeft, QrCode, Send } from 'lucide-react'
import { ActivityRow } from '@/components/ActivityRow'
import { HistorySkeleton } from '@/components/HistoryList'
import { PrivatePartRows } from '@/components/PrivateBalance'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { NetworkValue, PrivateAddressValue } from '@/components/TxDetailParts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PrivatePage } from '@/components/PrivatePage'
import { usePreferences } from '@/context/PreferencesContext'
import { useStellarChain } from '@/hooks/useStellarChain'
import type { BalancePartKey, PrivateBalance } from '@/lib/privateBalance'
import type { PrivateEntry } from '@/lib/privateHistory'

interface PrivateToken {
  poolId: string
  code: string
  icon?: string
  usdValue: number | null
  usdPrice?: number | null
}

// A private token's page, the twin of the public token page: the whole balance, its parts in plain
// words, the token's facts, its private activity, and Send and Receive at the foot.
export function PrivateTokenPage({
  token,
  balance,
  address,
  entries,
  format,
  fiat,
  chainIcon,
  fiatOf,
  onOpenPart,
  onSelectEntry,
  onHistory,
  onSend,
  onReceive,
  onClose,
}: {
  token: PrivateToken | null
  balance: PrivateBalance | null
  address: string | null
  entries: PrivateEntry[] | null
  format: (units: bigint) => string
  fiat: (units: bigint) => string | null
  chainIcon?: string
  fiatOf: (entry: PrivateEntry) => string | null
  onOpenPart: (key: BalancePartKey) => void
  onSelectEntry: (entry: PrivateEntry) => void
  onHistory: () => void
  onSend: (poolId: string) => void
  onReceive: () => void
  onClose: () => void
}) {
  const { formatValue, formatPrice } = usePreferences()
  const stellarChain = useStellarChain()
  // Keep the last token so content stays visible during the close slide.
  const lastToken = useRef<PrivateToken | null>(null)
  if (token) lastToken.current = token
  const t = token ?? lastToken.current
  const isOpen = token !== null

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!t) return null
  return (
    <PrivatePage open={isOpen} onHistory={onHistory}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        <button
          onClick={onClose}
          aria-label="Back"
          className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <AssetIcon code={t.code} icon={t.icon} size="lg" />
          <div className="flex flex-col">
            <p className="flex items-center gap-1 text-lg font-bold leading-tight text-foreground">
              {t.code}
              <VerifiedBadge className="inline-block h-4 w-4 shrink-0 align-[-2px]" />
            </p>
            <p className="text-xs text-muted-foreground">Private balance</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-4 rounded-xl bg-card px-4 py-4 text-center">
          {balance ? (
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {format(balance.total)}{' '}
              <span className="text-xl text-muted-foreground">{t.code}</span>
            </p>
          ) : (
            <Skeleton className="mx-auto my-1 h-7 w-36 rounded" />
          )}
          {t.usdValue !== null && (
            <p className="mt-1 text-sm text-muted-foreground">{formatValue(t.usdValue)}</p>
          )}
        </div>

        {balance && balance.parts.length > 0 && (
          <PrivatePartRows
            balance={balance}
            format={(units) => `${format(units)} ${t.code}`}
            fiat={fiat}
            onOpen={onOpenPart}
          />
        )}

        <div className="mb-4 divide-y divide-border rounded-xl bg-card">
          {t.usdPrice != null && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-muted-foreground">Price</span>
              <span className="text-sm font-medium tabular-nums text-foreground">
                {formatPrice(t.usdPrice)}
              </span>
            </div>
          )}
          {address && (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="shrink-0 text-sm text-muted-foreground">Private address</span>
              <PrivateAddressValue address={address} />
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="text-sm font-medium text-foreground">
              <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 px-1">
            <p className="pixel-label whitespace-nowrap text-[10px] text-muted-foreground">
              Activity
            </p>
            {entries && entries.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {entries.length}
              </span>
            )}
            <div className="h-px flex-1 bg-border" />
          </div>
          {entries === null ? (
            <HistorySkeleton rows={2} header={false} />
          ) : entries.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No transactions yet</p>
          ) : (
            entries.map((entry) => (
              <ActivityRow
                key={entry.item.id}
                view={entry.view}
                timestamp={entry.timestamp}
                icon={t.icon}
                chainIcon={chainIcon}
                fiat={fiatOf(entry)}
                counterpartyText={entry.counterpartyText}
                onClick={() => onSelectEntry(entry)}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => {
            onClose()
            onSend(t.poolId)
          }}
        >
          <Send size={14} />
          Send
        </Button>
        <Button
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => {
            onClose()
            onReceive()
          }}
        >
          <QrCode size={14} />
          Receive
        </Button>
      </div>
    </PrivatePage>
  )
}
