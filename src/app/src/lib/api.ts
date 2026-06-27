export const CYPHRAS_API = 'https://api.cyphras.com'

export interface PricesResponse {
  prices: Record<string, number | null>
  changes_24h: Record<string, number | null>
}

export async function fetchPrices(tokens: string[]): Promise<PricesResponse> {
  if (tokens.length === 0) return { prices: {}, changes_24h: {} }
  try {
    const res = await fetch(`${CYPHRAS_API}/prices?tokens=${tokens.join(',')}`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { prices: {}, changes_24h: {} }
    const data = (await res.json()) as {
      prices: Record<string, number | null>
      changes_24h?: Record<string, number | null>
    }
    return {
      prices: data.prices,
      changes_24h: data.changes_24h ?? {},
    }
  } catch {
    return { prices: {}, changes_24h: {} }
  }
}

export async function fetchStellarToml(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`${CYPHRAS_API}/toml?domain=${domain}`)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
