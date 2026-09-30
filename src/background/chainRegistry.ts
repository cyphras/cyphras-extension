import {
  BUILTIN_CHAINS,
  type ChainEntry,
  type StellarChainConfig,
  type EvmChainConfig,
} from '@constants/chains'

// The backend chain registry lets the admin panel add or disable chains
// without an extension release. Shipped builtins stay as the fail-safe: if
// the registry is unreachable the last-known-good copy applies, and if there
// is none the wallet still works on builtins alone. The registry never
// carries relayer/shielded config - those stay shipped-only.
const REGISTRY_URL = 'https://assets.cyphras.com/v2/chains'
const CACHE_KEY = 'cyphras_chain_registry'
const CACHE_TTL_MS = 5 * 60 * 1000

interface RegistryPayloadEntry {
  id: string
  family: 'stellar' | 'evm'
  name: string
  icon?: string
  isTestnet: boolean
  enabled: boolean
  explorer: { tx: string; account: string; token?: string }
  nativeCurrency: { symbol: string; decimals: number }
  config?: { stellar?: StellarChainConfig; evm?: EvmChainConfig }
}

interface CachedRegistry {
  chains: ChainEntry[]
  cachedAt: number
}

function toChainEntry(raw: RegistryPayloadEntry): ChainEntry {
  return {
    id: raw.id,
    family: raw.family,
    name: raw.name,
    icon: raw.icon,
    isTestnet: raw.isTestnet,
    enabled: raw.enabled,
    explorer: raw.explorer,
    nativeCurrency: raw.nativeCurrency,
    stellar: raw.config?.stellar,
    evm: raw.config?.evm,
  }
}

async function fetchRegistry(): Promise<ChainEntry[] | null> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = (await res.json()) as { chains?: RegistryPayloadEntry[] }
    if (!Array.isArray(data.chains)) return null
    return data.chains.map(toChainEntry)
  } catch {
    return null
  }
}

// A healthy registry response is authoritative: the public endpoint serves
// enabled chains only, so a chain disabled in the panel drops out of wallet
// defaults on the next refresh (builtins are NOT re-added, that would undo
// the kill-switch). Builtins apply only when no registry copy exists at all.
export async function getRegistryChains(): Promise<ChainEntry[]> {
  const stored = await chrome.storage.local.get(CACHE_KEY)
  let cached = stored[CACHE_KEY] as CachedRegistry | undefined

  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    const fetched = await fetchRegistry()
    if (fetched) {
      cached = { chains: fetched, cachedAt: Date.now() }
      chrome.storage.local.set({ [CACHE_KEY]: cached })
    }
  }

  return cached ? cached.chains : BUILTIN_CHAINS
}

export async function getEvmChainsForEnv(envId: string): Promise<ChainEntry[]> {
  if (envId !== 'mainnet' && envId !== 'testnet') return []
  const chains = await getRegistryChains()
  return chains.filter(
    (c) => c.family === 'evm' && c.enabled && c.isTestnet === (envId === 'testnet')
  )
}
