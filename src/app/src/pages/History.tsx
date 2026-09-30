import { useState, useEffect, useMemo, useCallback } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useHistory } from '@/hooks/useHistory'
import { useEvmActivity } from '@/hooks/useEvmActivity'
import { useCctpJobs } from '@/hooks/useCctpJobs'
import { getIconMap } from '@/hooks/useBalances'
import { Layout } from '@/components/Layout'
import { usePreferences } from '@/context/PreferencesContext'
import { useNetwork } from '@/context/NetworkContext'
import WalletNavbar from '@/components/WalletNavbar'
import OperationDetailSheet from '@/components/OperationDetailSheet'
import { EvmTxSheet } from '@/components/EvmTxSheet'
import { BridgeJobSheet } from '@/components/BridgeJobSheet'
import { NetworkFilterButton, NetworkFilterSheet } from '@/components/NetworkFilterSheet'
import { ActivityRow } from '@/components/ActivityRow'
import { Alert } from '@/components/Alert'
import { Button } from '@/components/ui/button'
import { enrichWithPrivate } from '@/lib/historyUtils'
import {
  type HistoryRow,
  type RowView,
  stellarRows,
  evmRows,
  bridgeRows,
  foldBridgeHashes,
  sortRows,
  groupRowsByDate,
  stellarView,
  evmView,
  bridgeView,
  formatFiat,
} from '@/lib/activity'
import { getChainIcons } from '@/lib/chainInfo'
import { getRegistryChains } from '@bg/chainRegistry'
import { fetchPrices, priceKey } from '@/lib/api'
import {
  BUILTIN_CHAINS,
  LEGACY_NETWORK_TO_CHAIN,
  chainById,
  type ChainEntry,
} from '@constants/chains'
import { SERVICE_TYPES } from '@constants/services'
import type { PrivateNote, ServiceResponse } from '@ext-types/index'
import { RefreshCw, ChevronLeft, Inbox, Loader2 } from 'lucide-react'

export default function History() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { getExplorerTxUrl, hideSmallPayments } = usePreferences()
  const publicKey = status.publicKey ?? ''

  const { operations, loading, error, refresh } = useHistory(status.publicKey)
  const { activity, loading: evmLoading, refresh: refreshEvm } = useEvmActivity(status.publicKey)
  const { jobs, refresh: refreshJobs } = useCctpJobs(publicKey)

  const [selected, setSelected] = useState<HistoryRow | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())
  const [chains, setChains] = useState<ChainEntry[]>(BUILTIN_CHAINS)
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [notes, setNotes] = useState<PrivateNote[]>([])
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [poolSet, setPoolSet] = useState<Set<string>>(new Set())

  const stellarChainId = LEGACY_NETWORK_TO_CHAIN[activeNetwork.id] ?? activeNetwork.id
  const bridgeEvmChainId = activeNetwork.id === 'testnet' ? 'eip155:11155111' : 'eip155:1'
  const chainOf = useCallback(
    (id: string) => chains.find((c) => c.id === id) ?? chainById(id),
    [chains]
  )
  const chainName = useCallback(
    (id: string) => chainOf(id)?.name ?? (id === stellarChainId ? activeNetwork.name : id),
    [chainOf, stellarChainId, activeNetwork.name]
  )

  const hasInFlight = notes.some(
    (n) => n.status === 'pending' || n.status === 'committed' || n.status === 'scheduled'
  )

  useEffect(() => {
    getIconMap(activeNetwork.id).then(setIconMap)
  }, [activeNetwork.id])

  useEffect(() => {
    let cancelled = false
    getRegistryChains().then((c) => {
      if (!cancelled && c.length > 0) setChains(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  const rows = useMemo(
    () =>
      sortRows(
        foldBridgeHashes([
          ...stellarRows(enriched, stellarChainId),
          ...evmRows(activity),
          ...bridgeRows(jobs, stellarChainId, bridgeEvmChainId),
        ])
      ),
    [enriched, activity, jobs, stellarChainId, bridgeEvmChainId]
  )

  // Titles name the chain family only ("Bridge to Stellar"); the network
  // itself is spelled out in the sheet, where there is room for it.
  const shortChainName = useCallback(
    (id: string) => (id.startsWith('stellar') ? 'Stellar' : chainName(id)),
    [chainName]
  )

  const bridgeFrom = useCallback(
    (row: Extract<HistoryRow, { kind: 'bridge' }>) =>
      row.job.direction === 'stellar-to-evm' ? stellarChainId : bridgeEvmChainId,
    [stellarChainId, bridgeEvmChainId]
  )

  const viewOf = useCallback(
    (row: HistoryRow): RowView => {
      if (row.kind === 'stellar') return stellarView(row.op, publicKey)
      if (row.kind === 'evm') return evmView(row.tx)
      return bridgeView(
        row.job,
        row.leg,
        shortChainName(bridgeFrom(row)),
        shortChainName(row.toChain)
      )
    },
    [publicKey, bridgeFrom, shortChainName]
  )

  // Chain filter chips: the Stellar network plus every EVM chain of this environment.
  const envChains = useMemo(() => {
    const isTestnet = activeNetwork.id === 'testnet'
    const evm =
      activeNetwork.id === 'mainnet' || isTestnet
        ? chains.filter((c) => c.family === 'evm' && c.enabled && c.isTestnet === isTestnet)
        : []
    return [
      { id: stellarChainId, name: chainOf(stellarChainId)?.name ?? activeNetwork.name },
      ...evm.map((c) => ({ id: c.id, name: c.name })),
    ]
  }, [chains, chainOf, activeNetwork.id, activeNetwork.name, stellarChainId])

  useEffect(() => {
    let cancelled = false
    getChainIcons(envChains.map((c) => c.id)).then((icons) => {
      if (!cancelled) setChainIcons(icons)
    })
    return () => {
      cancelled = true
    }
  }, [envChains])

  useEffect(() => {
    if (!envChains.some((c) => c.id === filter)) setFilter('all')
  }, [envChains, filter])

  // Fiat per row from the same price service Home uses, keyed by full identity so a copied
  // token code never borrows the real token's price.
  const priceAssetsKey = useMemo(() => {
    const seen = new Set<string>()
    for (const r of rows) {
      const v = viewOf(r)
      if (!v.amount) continue
      seen.add(`${v.amount.code}|${v.issuer ?? ''}`)
    }
    return [...seen].sort().join(',')
  }, [rows, viewOf])

  useEffect(() => {
    if (!priceAssetsKey) return
    let cancelled = false
    const assets = priceAssetsKey.split(',').map((k) => {
      const [code, issuer] = k.split('|')
      return { code, issuer: issuer || undefined }
    })
    fetchPrices(assets, activeNetwork.id)
      .then(({ prices: p }) => {
        if (!cancelled) setPrices(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [priceAssetsKey, activeNetwork.id])

  const fiatOf = useCallback(
    (view: RowView): string | null => {
      if (!view.amount) return null
      const price = prices[priceKey({ code: view.amount.code, issuer: view.issuer || undefined })]
      if (price === undefined || price === null) return null
      const n = parseFloat(view.amount.value)
      if (!Number.isFinite(n)) return null
      return formatFiat(n * price)
    },
    [prices]
  )

  const iconFor = useCallback(
    (code: string, issuer?: string): string | undefined => {
      const exact = iconMap.get(`${code}:${issuer ?? ''}`)
      if (exact) return exact
      for (const [k, v] of iconMap) if (k.startsWith(`${code}:`)) return v
      return undefined
    },
    [iconMap]
  )

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (filter !== 'all' && row.chain !== filter) return false
      if (!hideSmallPayments) return true
      const v = viewOf(row)
      if (!v.amount) return true
      return parseFloat(v.amount.value) >= 0.01
    })
  }, [rows, filter, hideSmallPayments, viewOf])

  const grouped = groupRowsByDate(visibleRows)

  // The sheet captures a row when opened; re-derive the Stellar op from the live list so a
  // private send's ETA and split phases keep advancing while the sheet stays open.
  const liveSelectedOp =
    selected?.kind === 'stellar'
      ? (enriched.find((o) => o.id === selected.op.id) ?? selected.op)
      : null

  // Gate on both so public and private rows render in one paint, not public rows first.
  const showSkeleton = loading || !notesLoaded

  const refreshAll = () => {
    refresh()
    refreshNotes()
    refreshEvm()
    void refreshJobs()
  }

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
              onClick={refreshAll}
              aria-label="Refresh history"
              className="cursor-pointer absolute right-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCw size={14} className={loading || evmLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {envChains.length > 1 && (
            <div className="self-start">
              <NetworkFilterButton
                value={filter}
                options={envChains}
                chainIcons={chainIcons}
                onClick={() => setFilterOpen(true)}
              />
            </div>
          )}

          {showSkeleton && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-1 py-2">
                <Skeleton className="h-2.5 w-20 rounded" />
                <div className="h-px flex-1 bg-border" />
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
                  <div className="relative shrink-0">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <span className="absolute -bottom-1 -right-0.5 h-[21px] w-[21px] rounded-full border-[1.5px] border-card bg-muted" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-28 rounded" />
                    <Skeleton className="h-3 w-36 rounded" />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Skeleton className="h-3.5 w-16 rounded" />
                    <Skeleton className="h-3 w-10 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <Alert message={error} onRetry={refreshAll} retrying={loading} />}

          {!showSkeleton && evmLoading && envChains.length > 1 && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Syncing EVM activity
            </div>
          )}

          {!showSkeleton && visibleRows.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Inbox size={24} className="text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  {filter === 'all' ? 'No transactions yet' : `No activity on ${chainName(filter)}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {filter === 'all'
                    ? 'Your transaction history will appear here'
                    : 'Transfers on this network will show up here'}
                </p>
              </div>
              {filter === 'all' && (
                <Button variant="outline" onClick={() => navigate('/receive')}>
                  Receive
                </Button>
              )}
            </div>
          )}

          {!showSkeleton &&
            grouped.map(({ label, rows: dayRows }, gi) => (
              <div
                key={`${filter}:${label}`}
                className="row-enter flex flex-col gap-2"
                style={{ animationDelay: `${Math.min(gi, 6) * 45}ms` }}
              >
                {/* -top-5 cancels the scroller's 20px top padding: at top-0 the header
                    stuck 20px low and rows showed through the gap above it */}
                <div className="sticky -top-5 z-10 -mx-1 bg-background px-1 py-2">
                  <div className="flex items-center gap-3 px-1">
                    <p className="pixel-label text-[10px] text-muted-foreground whitespace-nowrap">
                      {label}
                    </p>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                </div>

                {dayRows.map((row) => {
                  const view = viewOf(row)
                  const fiat = fiatOf(view)
                  const privatePhase =
                    row.kind === 'stellar' &&
                    row.op.cyphras_private?.direction === 'out' &&
                    row.op.cyphras_private.phase &&
                    row.op.cyphras_private.phase.key !== 'delivered'
                      ? row.op.cyphras_private.phase
                      : null
                  // Recipients of a private send only ever see a plain receive; never
                  // surface the pool contract as a counterparty.
                  const counterparty =
                    row.kind === 'stellar' && row.op.cyphras_private ? undefined : view.counterparty

                  return (
                    <ActivityRow
                      key={row.id}
                      view={view}
                      timestamp={row.timestamp}
                      icon={iconFor(view.code, view.issuer)}
                      chainIcon={chainIcons.get(row.chain)}
                      fiat={fiat}
                      counterparty={counterparty}
                      privatePhase={privatePhase}
                      trailing={
                        row.kind === 'stellar' && row.op.type === 'change_trust'
                          ? row.op.asset_code
                          : undefined
                      }
                      onClick={() => setSelected(row)}
                    />
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
        onClose={() => setSelected(null)}
        getExplorerTxUrl={getExplorerTxUrl}
        networkId={activeNetwork.id}
        networkName={activeNetwork.name}
        onAction={refreshNotes}
      />

      {selected?.kind === 'evm' && (
        <EvmTxSheet
          tx={selected.tx}
          chain={chainOf(selected.tx.chain)}
          chainName={chainName(selected.tx.chain)}
          chainIcon={chainIcons.get(selected.tx.chain)}
          icon={iconFor(selected.tx.code, selected.tx.tokenAddress)}
          fiat={fiatOf(evmView(selected.tx))}
          onClose={() => setSelected(null)}
        />
      )}

      {selected?.kind === 'bridge' && (
        <BridgeJobSheet
          job={jobs.find((j) => j.id === selected.job.id) ?? selected.job}
          title={viewOf(selected).label}
          leg={selected.leg}
          fromChainId={bridgeFrom(selected)}
          toChainId={selected.toChain}
          fromChainName={chainName(bridgeFrom(selected))}
          toChainName={chainName(selected.toChain)}
          fromIcon={chainIcons.get(bridgeFrom(selected))}
          toIcon={chainIcons.get(selected.toChain)}
          chains={chains}
          icon={iconFor('USDC')}
          price={prices[priceKey({ code: 'USDC' })] ?? null}
          onClose={() => setSelected(null)}
          onOpenBridge={() => navigate('/bridge', { state: { direction: selected.job.direction } })}
        />
      )}

      <NetworkFilterSheet
        open={filterOpen}
        value={filter}
        options={envChains}
        chainIcons={chainIcons}
        onSelect={setFilter}
        onClose={() => setFilterOpen(false)}
      />
    </>
  )
}
