import { ASSETS_API } from '@constants/backend'

export interface AssetListItem {
  code: string
  issuer: string
  contract?: string
  name?: string
  org?: string
  domain?: string
  icon?: string
  decimals?: number
  // CAIP-2 id of the instance's chain, for per-chain grouping and badges.
  chain?: string
  // Logical-token id: instances sharing it are the same curated token on
  // different chains and may be aggregated in the UI. Not the ticker, since an
  // anchored BTC on Stellar shares "BTC" with native Bitcoin yet is a
  // different, custodial token.
  group?: string
  // Reviewed by the Cyphras team in the admin panel; drives the badge.
  verified?: boolean
}

/**
 * The key a token is looked up by for its verified badge. EVM contract
 * addresses are case-insensitive (checksum casing varies between sources);
 * Stellar issuers are not.
 */
export function verifiedKey(code: string, issuer: string = ''): string {
  return issuer.toLowerCase().startsWith('0x')
    ? `${code}:${issuer.toLowerCase()}`
    : `${code}:${issuer}`
}

/**
 * The curated icon for an asset, keyed like the icon map ("CODE:ISSUER"). With
 * an issuer it must match that issuer (EVM addresses case-insensitively), so a
 * look-alike token never borrows the real one's logo; without one (CCTP rows,
 * where the protocol fixes the token) the first listed token with that code is used.
 */
export function iconForAsset(
  iconMap: Map<string, string>,
  code: string,
  issuer?: string
): string | undefined {
  const exact = iconMap.get(`${code}:${issuer ?? ''}`)
  if (exact) return exact
  if (issuer?.toLowerCase().startsWith('0x')) {
    const want = verifiedKey(code, issuer)
    for (const [key, url] of iconMap) if (verifiedKey(...splitKey(key)) === want) return url
    return undefined
  }
  if (issuer) return undefined
  for (const [key, url] of iconMap) if (key.startsWith(`${code}:`)) return url
  return undefined
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':')
  return [key.slice(0, i), key.slice(i + 1)]
}

interface ListInstance {
  chain?: string
  network?: string
  type?: string
  code?: string
  issuer?: string
  contract?: string
  address?: string
  decimals?: number
  domain?: string
}

interface ListToken {
  id: string
  symbol?: string
  name?: string
  icon?: string
  verified?: boolean
  instances?: ListInstance[]
}

function deduplicateAssets(assets: AssetListItem[]): AssetListItem[] {
  const seen = new Set<string>()
  return assets.filter((a) => {
    const key = `${a.code}:${a.issuer}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Token metadata and icons come from the curated Cyphras asset list; custom networks have none.
// Stellar entries by default (the trustline directory); the icon map also asks for EVM ones.
export async function fetchAssetList(
  networkId: string,
  families: Array<'stellar' | 'evm' | 'bitcoin'> = ['stellar']
): Promise<AssetListItem[]> {
  if (networkId !== 'mainnet' && networkId !== 'testnet') return []
  try {
    const res = await fetch(`${ASSETS_API}/v1/tokens?network=${networkId}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { tokens?: ListToken[] }

    const items: AssetListItem[] = []
    for (const token of data.tokens ?? []) {
      for (const inst of token.instances ?? []) {
        if (inst.network !== networkId) continue
        if (families.includes('stellar') && inst.chain?.startsWith('stellar')) {
          if (inst.type !== 'classic' || !inst.code || !inst.issuer) continue
          items.push({
            code: inst.code,
            issuer: inst.issuer,
            contract: inst.contract ?? undefined,
            name: token.name,
            domain: inst.domain ?? undefined,
            icon: token.icon ?? undefined,
            decimals: inst.decimals,
            group: token.id,
            chain: inst.chain,
            verified: token.verified === true,
          })
        } else if (families.includes('evm') && inst.chain?.startsWith('eip155')) {
          if (!token.symbol) continue
          items.push({
            code: token.symbol,
            issuer: inst.type === 'native' ? '' : (inst.address ?? ''),
            name: token.name,
            icon: token.icon ?? undefined,
            decimals: inst.decimals,
            group: token.id,
            chain: inst.chain,
            verified: token.verified === true,
          })
        } else if (
          families.includes('bitcoin') &&
          inst.chain?.startsWith('bip122') &&
          inst.type === 'native' &&
          token.symbol
        ) {
          items.push({
            code: token.symbol,
            issuer: '',
            name: token.name,
            icon: token.icon ?? undefined,
            decimals: inst.decimals,
            group: token.id,
            chain: inst.chain,
            verified: token.verified === true,
          })
        }
      }
    }
    return deduplicateAssets(items)
  } catch {
    return []
  }
}
