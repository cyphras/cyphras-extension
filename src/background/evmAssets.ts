// Curated ERC-20 token set per network, from the Cyphras asset list. Only
// curated tokens are queried for balances (plus user watch-assets later);
// anything else would mean scanning the whole chain.
const TOKENS_URL = 'https://assets.cyphras.com/v1/tokens'
const CACHE_KEY_PREFIX = 'cyphras_evm_tokens_'
const CACHE_TTL_MS = 10 * 60 * 1000

export interface EvmToken {
  chain: string
  symbol: string
  address: string
  decimals: number
}

interface CachedTokens {
  tokens: EvmToken[]
  cachedAt: number
}

interface ListInstance {
  chain?: string
  network?: string
  type?: string
  address?: string
  decimals?: number
}

interface ListToken {
  symbol?: string
  instances?: ListInstance[]
}

export async function getCuratedEvmTokens(network: string): Promise<EvmToken[]> {
  if (network !== 'mainnet' && network !== 'testnet') return []
  const cacheKey = `${CACHE_KEY_PREFIX}${network}`
  const stored = await chrome.storage.local.get(cacheKey)
  let cached = stored[cacheKey] as CachedTokens | undefined

  if (!cached || Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    try {
      const res = await fetch(`${TOKENS_URL}?network=${network}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = (await res.json()) as { tokens?: ListToken[] }
        const tokens: EvmToken[] = []
        for (const token of data.tokens ?? []) {
          if (!token.symbol) continue
          for (const inst of token.instances ?? []) {
            if (!inst.chain?.startsWith('eip155') || inst.network !== network) continue
            if (inst.type !== 'erc20' || !inst.address) continue
            tokens.push({
              chain: inst.chain,
              symbol: token.symbol,
              address: inst.address,
              decimals: inst.decimals ?? 18,
            })
          }
        }
        cached = { tokens, cachedAt: Date.now() }
        chrome.storage.local.set({ [cacheKey]: cached })
      }
    } catch {
      // fall through to last-known-good
    }
  }

  return cached?.tokens ?? []
}
