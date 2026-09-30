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
  // Logical-token key: instances sharing it are the same curated token on
  // different chains and may be aggregated in the UI.
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
  families: Array<'stellar' | 'evm'> = ['stellar']
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
            group: token.symbol ?? undefined,
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
            group: token.symbol,
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
