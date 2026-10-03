import { useEffect, useState } from 'react'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { Check, Plus, Trash2, Search } from 'lucide-react'
import { useWallet } from '@/context/WalletContext'
import { useNetwork } from '@/context/NetworkContext'
import { useEvmWatchAssets } from '@/hooks/useEvmWatchAssets'
import { fetchAssetList, type AssetListItem } from '@/lib/assetList'
import { getChainIcons } from '@/lib/chainInfo'
import { evmChainsForEnv, type ChainEntry } from '@constants/chains'
import { getEvmChainsForEnv } from '@bg/chainRegistry'
import { AssetIcon } from '@/components/token/AssetIcon'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Reads symbol() and decimals() straight from the contract, so a custom token
// is described by the chain itself rather than by user input.
async function lookupToken(
  rpcUrl: string,
  address: string
): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 0,
          method: 'eth_call',
          params: [{ to: address, data: '0x95d89b41' }, 'latest'],
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: address, data: '0x313ce567' }, 'latest'],
        },
      ]),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const results = (await res.json()) as Array<{ id: number; result?: string }>
    const symbolHex = results.find((r) => r.id === 0)?.result
    const decimalsHex = results.find((r) => r.id === 1)?.result
    if (!symbolHex || !decimalsHex || symbolHex === '0x') return null

    const raw = symbolHex.slice(2)
    const length = parseInt(raw.slice(64, 128), 16)
    let symbol = ''
    for (let i = 0; i < length; i++) {
      symbol += String.fromCharCode(parseInt(raw.slice(128 + i * 2, 130 + i * 2), 16))
    }
    return { symbol, decimals: parseInt(decimalsHex, 16) }
  } catch {
    return null
  }
}

export function AddEvmToken() {
  const { status } = useWallet()
  const { activeNetwork } = useNetwork()
  const {
    assets: watched,
    addAsset,
    removeAsset,
  } = useEvmWatchAssets(activeNetwork.id, status.publicKey ?? '')

  // Registry-backed chain set (builtins seed the first paint) so chains added
  // in the admin panel appear without an extension release.
  const [evmChains, setEvmChains] = useState<ChainEntry[]>(() => evmChainsForEnv(activeNetwork.id))
  // Target chain for the custom-token form; curated tokens carry their own.
  const [selChainId, setSelChainId] = useState<string | null>(null)
  const [curated, setCurated] = useState<AssetListItem[]>([])
  const [chainIcons, setChainIcons] = useState<Map<string, string>>(new Map())
  const [loadingList, setLoadingList] = useState(true)
  const [search, setSearch] = useState('')
  const [customAddress, setCustomAddress] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [added, setAdded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    getEvmChainsForEnv(activeNetwork.id).then((chains) => {
      if (cancelled) return
      if (chains.length > 0) setEvmChains(chains)
      // Icons resolve against the registry chain set, so a chain the cached
      // map does not know yet forces a refresh instead of waiting out the TTL.
      getChainIcons(chains.map((c) => c.id)).then((icons) => {
        if (!cancelled) setChainIcons(icons)
      })
    })
    fetchAssetList(activeNetwork.id, ['evm']).then((items) => {
      if (cancelled) return
      setCurated(items.filter((i) => i.issuer !== ''))
      setLoadingList(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])

  const selChain = evmChains.find((c) => c.id === selChainId) ?? evmChains[0]

  if (!selChain) {
    return (
      <div className="rounded-xl bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">No EVM chain is available on this network.</p>
      </div>
    )
  }

  const isWatched = (chain: string, address: string) =>
    watched.some((w) => w.chain === chain && w.address.toLowerCase() === address.toLowerCase())

  const q = search.trim().toLowerCase()
  const shown = curated.filter(
    (item) =>
      q === '' ||
      item.code.toLowerCase().includes(q) ||
      (item.name ?? '').toLowerCase().includes(q) ||
      item.issuer.toLowerCase().includes(q)
  )

  const watchCurated = (item: AssetListItem) => {
    addAsset({
      chain: item.chain ?? selChain.id,
      address: item.issuer,
      symbol: item.code,
      decimals: item.decimals ?? 18,
    })
    setAdded(item.issuer)
    setTimeout(() => setAdded(null), 1500)
  }

  const addCustom = async () => {
    const address = customAddress.trim()
    setLookupError('')
    if (!EVM_ADDRESS_RE.test(address)) {
      setLookupError('Enter a valid 0x contract address.')
      return
    }
    const rpcUrl = selChain.evm?.rpcUrls[0]
    if (!rpcUrl) return
    setLooking(true)
    const info = await lookupToken(rpcUrl, address)
    setLooking(false)
    if (!info || !info.symbol) {
      setLookupError('Could not read this contract as an ERC-20 token.')
      return
    }
    await addAsset({ chain: selChain.id, address, symbol: info.symbol, decimals: info.decimals })
    setCustomAddress('')
    setAdded(address)
    setTimeout(() => setAdded(null), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      {watched.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Watching</p>
          {watched.map((w) => (
            <div
              key={`${w.chain}:${w.address}`}
              className="flex items-center justify-between rounded-xl bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <AssetIcon
                  icon={
                    curated.find((c) => c.issuer.toLowerCase() === w.address.toLowerCase())?.icon
                  }
                  code={w.symbol}
                  chainIcons={[chainIcons.get(w.chain)]}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-foreground">{w.symbol}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {w.address.slice(0, 10)}...{w.address.slice(-8)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => removeAsset(w.chain, w.address)}
                aria-label={`Stop watching ${w.symbol}`}
                className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-card p-4 flex flex-col gap-3">
        <p className="text-xs font-medium text-muted-foreground">
          Add custom token on {selChain.name}
        </p>
        {evmChains.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto">
            {evmChains.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelChainId(c.id)}
                className={`cursor-pointer shrink-0 flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3 text-xs font-medium whitespace-nowrap transition-colors ${
                  selChain.id === c.id
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {chainIcons.get(c.id) && (
                  <img
                    src={chainIcons.get(c.id)}
                    alt=""
                    className="h-4 w-4 rounded-full object-cover"
                  />
                )}
                {c.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          spellCheck={false}
          placeholder="0x token contract address"
          value={customAddress}
          onChange={(e) => setCustomAddress(e.target.value.trim())}
          className="w-full rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
        <button
          onClick={addCustom}
          disabled={looking || customAddress === ''}
          className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {looking ? 'Checking contract...' : 'Look up and add'}
        </button>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Symbol and decimals are read from the contract itself. Custom tokens are unverified and
          tracked only on this device.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search curated tokens"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="flex flex-col gap-2">
        {loadingList ? (
          <div className="rounded-xl bg-card p-4 text-center text-xs text-muted-foreground">
            Loading curated tokens...
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl bg-card p-4 text-center text-xs text-muted-foreground">
            No curated tokens match.
          </div>
        ) : (
          // Grouped per chain so the same symbol on two EVM chains stays distinguishable.
          evmChains.map((chain) => {
            const tokens = shown.filter((i) => i.chain === chain.id)
            if (tokens.length === 0) return null
            return (
              <div key={chain.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 px-1 pt-1">
                  {chainIcons.get(chain.id) && (
                    <img
                      src={chainIcons.get(chain.id)}
                      alt=""
                      className="h-4 w-4 rounded-full object-cover"
                    />
                  )}
                  <p className="text-xs font-medium text-muted-foreground">{chain.name}</p>
                </div>
                {tokens.map((item) => (
                  <div
                    key={`${chain.id}:${item.issuer}`}
                    className="flex items-center justify-between rounded-xl bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <AssetIcon
                        icon={item.icon}
                        code={item.code}
                        chainIcons={[chainIcons.get(chain.id)]}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                          {item.code}
                          <VerifiedMark code={item.code} issuer={item.issuer} />
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.name ?? `${item.issuer.slice(0, 10)}...`}
                        </span>
                      </div>
                    </div>
                    {isWatched(chain.id, item.issuer) || added === item.issuer ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-500">
                        <Check size={14} className="pop-enter" /> Added
                      </span>
                    ) : (
                      <button
                        onClick={() => watchCurated(item)}
                        aria-label={`Watch ${item.code}`}
                        className="cursor-pointer rounded-lg bg-muted p-2 text-foreground hover:bg-muted/70 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
