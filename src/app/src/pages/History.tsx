import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useHistory } from '@/hooks/useHistory'
import type { Operation } from '@/hooks/useHistory'
import { getIconMap } from '@/hooks/useBalances'
import { Layout } from '@/components/Layout'
import { usePreferences } from '@/context/PreferencesContext'
import { useNetwork } from '@/context/NetworkContext'
import WalletNavbar from '@/components/WalletNavbar'
import OperationDetailSheet from '@/components/OperationDetailSheet'
import { OpIcon } from '@/components/OpIcon'
import {
  getDirection,
  getOpLabel,
  getAmountDisplay,
  formatTime,
  groupByDate,
} from '@/lib/historyUtils'
import { RefreshCw, ChevronLeft } from 'lucide-react'

export default function History() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { getExplorerTxUrl, hideSmallPayments } = usePreferences()
  const { operations, loading, error, refresh } = useHistory(status.publicKey)
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null)
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    getIconMap(activeNetwork.id).then(setIconMap)
  }, [activeNetwork.id])

  const visibleOps = hideSmallPayments
    ? operations.filter((op) => {
        const display = getAmountDisplay(op)
        if (!display || !display.amount) return true
        return parseFloat(display.amount) >= 0.01
      })
    : operations

  const grouped = groupByDate(visibleOps)
  const publicKey = status.publicKey ?? ''

  return (
    <>
      <Layout navbar={<WalletNavbar />}>
        <div className="flex flex-col gap-4">
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => navigate(-1)}
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">History</h2>
            <button
              onClick={refresh}
              className="cursor-pointer absolute right-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {loading && (
            <div className="flex flex-col gap-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 animate-pulse"
                >
                  <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="h-3.5 w-28 rounded bg-muted" />
                    <div className="h-3 w-16 rounded bg-muted" />
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <div className="h-3.5 w-20 rounded bg-muted" />
                    <div className="h-3 w-10 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-destructive text-center">{error}</p>}

          {!loading && visibleOps.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground">
                Your transaction history will appear here
              </p>
            </div>
          )}

          {grouped.map(({ label, ops }) => (
            <div key={label} className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-1 pt-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  {label}
                </p>
                <div className="flex-1 h-px bg-border" />
              </div>

              {ops.map((op) => {
                const dir = getDirection(op, publicKey)
                const amount = getAmountDisplay(op)

                return (
                  <button
                    key={op.id}
                    className="cursor-pointer flex items-center gap-3 w-full rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors text-left"
                    onClick={() => setSelectedOp(op)}
                  >
                    <OpIcon op={op} publicKey={publicKey} iconMap={iconMap} />

                    <div className="flex flex-col flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {getOpLabel(op, publicKey)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatTime(op.created_at)}</p>
                    </div>

                    {amount && (
                      <div className="text-right shrink-0">
                        {amount.amount && (
                          <p
                            className={`text-sm font-medium tabular-nums ${dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}
                            {amount.amount}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground font-mono">{amount.code}</p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </Layout>

      <OperationDetailSheet
        op={selectedOp}
        publicKey={publicKey}
        horizonUrl={activeNetwork.horizonUrl}
        iconMap={iconMap}
        onClose={() => setSelectedOp(null)}
        getExplorerTxUrl={getExplorerTxUrl}
        networkId={activeNetwork.id}
        networkName={activeNetwork.name}
      />
    </>
  )
}
