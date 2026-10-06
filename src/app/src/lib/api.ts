import { API_ENDPOINTS, PRICES_VERSION } from '@constants/backend'

export interface PriceAsset {
  code: string
  issuer?: string
}

export interface PricesResponse {
  prices: Record<string, number | null>
  changes_24h: Record<string, number | null>
  // Identity is in the curated Cyphras asset list (v2 only; empty in v1 mode).
  verified: Record<string, boolean>
}

// The key assets are priced under in every fetchPrices result, regardless of
// the API version in use: natives by symbol, Stellar lines as "CODE-GISSUER",
// EVM tokens by their bare 0x contract address (matching the server's
// identity registry). A stable key is what lets backend.ts switch versions
// without touching callers.
export function priceKey(asset: PriceAsset): string {
  if (asset.issuer?.startsWith('0x') || asset.issuer?.startsWith('0X')) {
    return asset.issuer.toUpperCase()
  }
  const code = asset.code.toUpperCase()
  return asset.issuer ? `${code}-${asset.issuer.toUpperCase()}` : code
}

export async function fetchPrices(
  assets: PriceAsset[],
  network?: string
): Promise<PricesResponse> {
  const wanted = assets.filter((a) => a.code)
  if (wanted.length === 0) return { prices: {}, changes_24h: {}, verified: {} }

  const tokens =
    PRICES_VERSION === 'v2'
      ? [...new Set(wanted.map(priceKey))]
      : [...new Set(wanted.map((a) => a.code.toUpperCase()))]

  // Identities resolve per network server-side; custom networks fall through
  // to the server default rather than sending an unknown value it would 400.
  const headers: Record<string, string> =
    network === 'testnet' || network === 'mainnet' ? { 'X-Cyphras-Network': network } : {}

  try {
    const res = await fetch(`${API_ENDPOINTS.prices}?tokens=${tokens.join(',')}`, {
      headers,
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { prices: {}, changes_24h: {}, verified: {} }
    const data = (await res.json()) as {
      prices: Record<string, number | null>
      changes_24h?: Record<string, number | null>
      verified?: Record<string, boolean>
    }
    if (PRICES_VERSION === 'v2') {
      return {
        prices: data.prices,
        changes_24h: data.changes_24h ?? {},
        verified: data.verified ?? {},
      }
    }
    // v1 responses are keyed by bare code; remap onto the stable identity keys
    const out: PricesResponse = { prices: {}, changes_24h: {}, verified: {} }
    for (const asset of wanted) {
      const key = priceKey(asset)
      const code = asset.code.toUpperCase()
      out.prices[key] = data.prices[code] ?? null
      out.changes_24h[key] = data.changes_24h?.[code] ?? null
    }
    return out
  } catch {
    return { prices: {}, changes_24h: {}, verified: {} }
  }
}
