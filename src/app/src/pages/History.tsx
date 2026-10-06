import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@/context/WalletContext'
import { useHistory } from '@/hooks/useHistory'
import { useChainActivity } from '@/hooks/useChainActivity'
import { useCctpJobs } from '@/hooks/useCctpJobs'
import { getIconMap } from '@/hooks/useBalances'
import { iconForAsset } from '@/lib/assetList'
import { Layout } from '@/components/Layout'
import { usePreferences } from '@/context/PreferencesContext'
import { useNetwork } from '@/context/NetworkContext'
import WalletNavbar from '@/components/WalletNavbar'
import OperationDetailSheet from '@/components/OperationDetailSheet'
import { ChainTxSheet } from '@/components/ChainTxSheet'
import { BridgeJobSheet } from '@/components/BridgeJobSheet'
import { NetworkFilterButton, NetworkFilterSheet } from '@/components/NetworkFilterSheet'
import { ActivityRow } from '@/components/ActivityRow'
import { HistoryEmpty, HistoryGroups, HistorySkeleton } from '@/components/HistoryList'
import { Alert } from '@/components/Alert'
import { Button } from '@/components/ui/button'
import {
  type HistoryRow,
  type RowView,
  stellarRows,
  chainTxRows,
  bridgeRows,
  foldBridgeHashes,
  sortRows,
  groupRowsByDate,
  stellarView,
  chainTxView,
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
import { RefreshCw, ChevronLeft, Loader2 } from 'lucide-react'

export default function History() {
  const navigate = useNavigate()
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const { getExplorerTxUrl, hideSmallPayments } = usePreferences()
  const publicKey = status.publicKey ?? ''

  const { operations, loading, error, refresh } = useHistory(status.publicKey)
  const { activity, loading: evmLoading, refresh: refreshEvm } = useChainActivity(status.publicKey)
  const { jobs, refresh: refreshJobs } = useCctpJobs(publicKey)

  const [selected, setSelected] = useState<HistoryRow | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map())
  const [chains, setChains] = useState<ChainEntry[]>(BUILTIN_CHAINS)
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  const [prices, setPrices] = useState<Record<string, number | null>>({})

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

  const rows = useMemo(
    () =>
      sortRows(
        foldBridgeHashes([
          ...stellarRows(operations, stellarChainId),
          ...chainTxRows(activity),
          ...bridgeRows(jobs, stellarChainId, bridgeEvmChainId),
        ])
      ),
    [operations, activity, jobs, stellarChainId, bridgeEvmChainId]
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
      if (row.kind === 'evm') return chainTxView(row.tx)
      return bridgeView(
        row.job,
        row.leg,
        shortChainName(bridgeFrom(row)),
        shortChainName(row.toChain)
      )
    },
    [publicKey, bridgeFrom, shortChainName]
  )

  // Chain filter chips: the Stellar network plus every Bitcoin and EVM chain of this environment.
  const envChains = useMemo(() => {
    const isTestnet = activeNetwork.id === 'testnet'
    const others = (family: 'evm' | 'bip122') =>
      activeNetwork.id === 'mainnet' || isTestnet
        ? chains.filter((c) => c.family === family && c.enabled && c.isTestnet === isTestnet)
        : []
    return [
      { id: stellarChainId, name: chainOf(stellarChainId)?.name ?? activeNetwork.name },
      ...[...others('bip122'), ...others('evm')].map((c) => ({ id: c.id, name: c.name })),
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
    (code: string, issuer?: string) => iconForAsset(iconMap, code, issuer),
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

  const refreshAll = () => {
    refresh()
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

          {loading && <HistorySkeleton />}

          {error && <Alert message={error} onRetry={refreshAll} retrying={loading} />}

          {!loading && evmLoading && envChains.length > 1 && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Syncing EVM activity
            </div>
          )}

          {!loading && visibleRows.length === 0 && (
            <HistoryEmpty
              title={
                filter === 'all' ? 'No transactions yet' : `No activity on ${chainName(filter)}`
              }
              subtitle={
                filter === 'all'
                  ? 'Your transaction history will appear here'
                  : 'Transfers on this network will show up here'
              }
              action={
                filter === 'all' && (
                  <Button variant="outline" onClick={() => navigate('/receive')}>
                    Receive
                  </Button>
                )
              }
            />
          )}

          {!loading && (
            <HistoryGroups
              groups={grouped}
              groupKey={(label) => `${filter}:${label}`}
              renderRow={(row) => {
                const view = viewOf(row)
                return (
                  <ActivityRow
                    key={row.id}
                    view={view}
                    timestamp={row.timestamp}
                    icon={iconFor(view.code, view.issuer)}
                    chainIcon={chainIcons.get(row.chain)}
                    fiat={fiatOf(view)}
                    counterparty={view.counterparty}
                    trailing={
                      row.kind === 'stellar' && row.op.type === 'change_trust'
                        ? row.op.asset_code
                        : undefined
                    }
                    onClick={() => setSelected(row)}
                  />
                )
              }}
            />
          )}
        </div>
      </Layout>

      <OperationDetailSheet
        op={selected?.kind === 'stellar' ? selected.op : null}
        publicKey={publicKey}
        horizonUrl={activeNetwork.horizonUrl}
        iconMap={iconMap}
        onClose={() => setSelected(null)}
        getExplorerTxUrl={getExplorerTxUrl}
        networkId={activeNetwork.id}
        networkName={activeNetwork.name}
      />

      {selected?.kind === 'evm' && (
        <ChainTxSheet
          tx={selected.tx}
          chain={chainOf(selected.tx.chain)}
          chainName={chainName(selected.tx.chain)}
          chainIcon={chainIcons.get(selected.tx.chain)}
          icon={iconFor(selected.tx.code, selected.tx.tokenAddress)}
          fiat={fiatOf(chainTxView(selected.tx))}
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
