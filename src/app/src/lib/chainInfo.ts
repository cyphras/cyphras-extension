import { ASSETS_API } from '@constants/backend'
import { toDataUrls } from '@/lib/iconCache'
import { RemoteCache } from '@/lib/remoteCache'

export interface ChainInfo {
  id: string
  name: string
  icon?: string
}

type ChainMap = Record<string, { name: string; icon?: string }>

// Bounds how long a panel edit takes to reach the UI; the map is a few KB, so short is cheap.
// Icon URLs are content-hashed, so the byte cache refetches a changed icon on its own.
const CHAINS_TTL_MS = 10 * 60 * 1000

const chainsCache = new RemoteCache<ChainMap>('cyphras_chains', CHAINS_TTL_MS, async () => {
  // no-cache: revalidate with the server instead of reusing the browser's
  // copy for its max-age, which would stack an hour on top of our own TTL
  const res = await fetch(`${ASSETS_API}/v1/chains`, {
    cache: 'no-cache',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  return (await res.json()) as ChainMap
})

// The active Stellar network maps to its CAIP-2 chain id; custom networks have
// no curated chain entry.
function chainIdFor(networkId: string): string | null {
  if (networkId === 'mainnet') return 'stellar:pubnet'
  if (networkId === 'testnet') return 'stellar:testnet'
  return null
}

// Serves the cached map, but a caller who needs ids the copy does not know
// forces a refresh: a chain enabled in the panel minutes ago must not wait
// out the TTL to get its name and icon.
async function loadChains(requiredIds?: string[]): Promise<ChainMap | null> {
  let chains = await chainsCache.get()
  if (chains && requiredIds?.some((id) => !(id in chains!))) {
    chains = (await chainsCache.refresh()) ?? chains
  }
  return chains
}

export async function getChainInfo(networkId: string): Promise<ChainInfo | null> {
  const chainId = chainIdFor(networkId)
  if (!chainId) return null
  try {
    const chains = await loadChains([chainId])
    const meta = chains?.[chainId]
    if (!meta) return null
    const icons = await toDataUrls(new Map(meta.icon ? [[chainId, meta.icon]] : []))
    return { id: chainId, name: meta.name, icon: icons.get(chainId) }
  } catch {
    return null
  }
}

// Icons for every curated chain at once, byte-cached, for per-row badges in
// the unified portfolio.
export async function getChainIcons(requiredIds?: string[]): Promise<Map<string, string>> {
  try {
    const chains = await loadChains(requiredIds)
    if (!chains) return new Map()
    const urls = new Map<string, string>()
    for (const [id, meta] of Object.entries(chains)) {
      if (meta.icon) urls.set(id, meta.icon)
    }
    return await toDataUrls(urls)
  } catch {
    return new Map()
  }
}

// Display names keyed by CAIP-2 id, for surfaces that would otherwise fall
// back to builtins and print raw ids for panel-added chains.
export async function getChainNames(requiredIds?: string[]): Promise<Map<string, string>> {
  try {
    const chains = await loadChains(requiredIds)
    if (!chains) return new Map()
    return new Map(Object.entries(chains).map(([id, meta]) => [id, meta.name]))
  } catch {
    return new Map()
  }
}
