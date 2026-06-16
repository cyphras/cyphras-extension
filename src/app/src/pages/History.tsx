import { useState, useEffect, useMemo, useCallback } from 'react'
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
import { PhaseBadge } from '@/components/PhaseBadge'
import { Alert } from '@/components/Alert'
import {
  getDirection,
  getOpLabel,
  getAmountDisplay,
  formatTime,
  groupByDate,
  enrichWithPrivate,
} from '@/lib/historyUtils'
import { SERVICE_TYPES } from '@constants/services'
import type { PrivateNote, ServiceResponse } from '@ext-types/index'
import { RefreshCw, ChevronLeft, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function History() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { getExplorerTxUrl, hideSmallPayments } = usePreferences()
  const { operations, loading, error, refresh } = useHistory(status.publicKey)
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null)
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())
  const [notes, setNotes] = useState<PrivateNote[]>([])
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [poolSet, setPoolSet] = useState<Set<string>>(new Set())

  const publicKey = status.publicKey ?? ''

  const hasInFlight = notes.some(
    (n) => n.status === 'pending' || n.status === 'committed' || n.status === 'scheduled'
  )

  useEffect(() => {
    getIconMap(activeNetwork.id).then(setIconMap)
  }, [activeNetwork.id])

  // Local notes drive the sender rows; pool addresses identify a private receive. Both are
  // best-effort, history renders without them.
  const refreshNotes = useCallback(() => {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.PRIVATE_LIST_NOTES }, (r: ServiceResponse) => {
      setNotes(r?.notes ?? [])
      setNotesLoaded(true)
    })
  }, [])

  useEffect(() => {
    // Reset loaded first so an account switch holds the skeleton until the new account's notes
    // resolve, instead of flashing the previous account's rows.
    setNotesLoaded(false)
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.PRIVATE_PROCESS_NOTES })
    refreshNotes()
  }, [publicKey, refreshNotes])

  useEffect(() => {
    // Poll only while a payment is in flight; each tick nudges the processor so reveals confirm in
    // seconds rather than waiting for the background's 1-minute alarm.
    if (!hasInFlight) return
    const id = setInterval(() => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.PRIVATE_PROCESS_NOTES })
      refreshNotes()
    }, 4000)
    return () => clearInterval(id)
  }, [hasInFlight, refreshNotes])

  useEffect(() => {
    // Repaint when the background processor advances note state. A short-lived MV3 service worker
    // cannot hold a WebSocket open across the relayer's minutes-long delay, so storage is the push.
    if (!publicKey) return
    const noteKey = `cyphras_private_notes_${publicKey}`
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes[noteKey]) refreshNotes()
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [publicKey, refreshNotes])

  useEffect(() => {
    const url = activeNetwork.relayerUrl
    if (!url) {
      setPoolSet(new Set())
      return
    }
    let cancelled = false
    fetch(`${url.replace(/\/$/, '')}/v1/info/pools`, {
      headers: { 'X-Cyphras-Network': activeNetwork.id },
    })
      .then((r) => r.json())
      .then((body: { pools?: { address: string }[] }) => {
        if (!cancelled) setPoolSet(new Set((body.pools ?? []).map((p) => p.address)))
      })
      .catch(() => {
        if (!cancelled) setPoolSet(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.relayerUrl, activeNetwork.id])

  const enriched = useMemo(() => {
    const formatStroops = (stroops: string, asset: string): string => {
      const decimals = activeNetwork.privateAssets?.find((a) => a.asset === asset)?.decimals ?? 7
      const base = 10n ** BigInt(decimals)
      const v = BigInt(stroops)
      const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '')
      return frac ? `${v / base}.${frac}` : (v / base).toString()
    }
    return enrichWithPrivate(operations, notes, poolSet, publicKey, formatStroops)
  }, [operations, notes, poolSet, publicKey, activeNetwork.privateAssets])

  // The sheet captures an op by reference when opened; re-derive it from the live list each render so a
  // private send's ETA and split phases keep advancing while the sheet stays open over the delay.
  const liveSelectedOp = selectedOp
    ? (enriched.find((o) => o.id === selectedOp.id) ?? selectedOp)
    : null

  const visibleOps = hideSmallPayments
    ? enriched.filter((op) => {
        const display = getAmountDisplay(op)
        if (!display || !display.amount) return true
        return parseFloat(display.amount) >= 0.01
      })
    : enriched

  const grouped = groupByDate(visibleOps)

  // Gate on both so public and private rows render in one paint, not public rows first.
  const showSkeleton = loading || !notesLoaded

  return (
    <>
      <Layout navbar={<WalletNavbar />}>
        <div className="flex flex-col gap-4">
          <div className="relative flex items-center justify-center">
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">History</h2>
            <button
              onClick={() => {
                refresh()
                refreshNotes()
              }}
              aria-label="Refresh history"
              className="cursor-pointer absolute right-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {showSkeleton && (
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

          {error && (
            <Alert
              message={error}
              onRetry={() => {
                refresh()
                refreshNotes()
              }}
              retrying={loading}
            />
          )}

          {!showSkeleton && visibleOps.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Inbox size={24} className="text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">No transactions yet</p>
                <p className="text-xs text-muted-foreground">
                  Your transaction history will appear here
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate('/receive')}>
                Receive
              </Button>
            </div>
          )}

          {!showSkeleton &&
            grouped.map(({ label, ops }) => (
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

                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="truncate text-sm font-medium text-foreground">
                          {getOpLabel(op, publicKey)}
                        </p>
                        {op.cyphras_private?.direction === 'out' &&
                        op.cyphras_private.phase &&
                        op.cyphras_private.phase.key !== 'delivered' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">
                              {formatTime(op.created_at)}
                            </span>
                            <PhaseBadge phase={op.cyphras_private.phase} size={13} hideLabel />
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {formatTime(op.created_at)}
                          </p>
                        )}
                      </div>

                      {amount && (
                        <div className="shrink-0 text-right">
                          {amount.amount ? (
                            <p
                              className={`text-sm font-medium tabular-nums ${dir === 'in' ? 'text-green-500' : dir === 'out' ? 'text-red-500' : 'text-muted-foreground'}`}
                            >
                              {dir === 'in' ? '+' : dir === 'out' ? '-' : ''}
                              {amount.amount}{' '}
                              <span className="text-xs font-normal">{amount.code}</span>
                            </p>
                          ) : (
                            <p className="font-mono text-xs text-muted-foreground">{amount.code}</p>
                          )}
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
        op={liveSelectedOp}
        publicKey={publicKey}
        horizonUrl={activeNetwork.horizonUrl}
        iconMap={iconMap}
        onClose={() => setSelectedOp(null)}
        getExplorerTxUrl={getExplorerTxUrl}
        networkId={activeNetwork.id}
        networkName={activeNetwork.name}
        onAction={refreshNotes}
      />
    </>
  )
}
