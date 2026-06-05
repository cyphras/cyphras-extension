export interface AssetListItem {
  code: string
  issuer: string
  contract?: string
  name?: string
  org?: string
  domain?: string
  icon?: string
  decimals?: number
}

interface RawAsset {
  code?: string
  issuer?: string
  contract?: string
  name?: string
  org?: string
  domain?: string
  icon?: string
  decimals?: number
}

interface StandardResponse {
  assets?: RawAsset[]
  tokens?: RawAsset[]
}

interface LobstrAsset {
  asset_code?: string
  asset_issuer?: string
  name?: string
  org?: string
  domain?: string
  icon?: string
}

interface LobstrResponse {
  results?: LobstrAsset[]
}

const SOURCES = {
  mainnet: [
    'https://api.stellar.expert/explorer/public/asset-list/top50',
    'https://raw.githubusercontent.com/soroswap/token-list/main/tokenList.json',
    'https://lobstr.co/api/v1/sep/assets/curated.json',
  ],
  testnet: ['https://api.stellar.expert/explorer/testnet/asset-list/top50'],
}

function normalizeAsset(raw: RawAsset): AssetListItem | null {
  if (!raw.code || !raw.issuer) return null
  return {
    code: raw.code,
    issuer: raw.issuer,
    contract: raw.contract,
    name: raw.name,
    org: raw.org,
    domain: raw.domain,
    icon: raw.icon,
    decimals: raw.decimals,
  }
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

async function fetchStandard(url: string): Promise<AssetListItem[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as StandardResponse
  const raw = data.assets ?? data.tokens ?? []
  return raw.map(normalizeAsset).filter((a): a is AssetListItem => a !== null)
}

async function fetchLobstr(url: string): Promise<AssetListItem[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as LobstrResponse
  return (data.results ?? [])
    .filter((a) => a.asset_code && a.asset_issuer)
    .map((a) => ({
      code: a.asset_code!,
      issuer: a.asset_issuer!,
      name: a.name,
      org: a.org,
      domain: a.domain,
      icon: a.icon,
    }))
}

async function fetchFromUrl(url: string): Promise<AssetListItem[]> {
  try {
    if (url.includes('lobstr')) return await fetchLobstr(url)
    return await fetchStandard(url)
  } catch {
    return []
  }
}

export async function fetchAssetList(networkId: string): Promise<AssetListItem[]> {
  const sources = networkId === 'mainnet' ? SOURCES.mainnet : SOURCES.testnet
  const results = await Promise.allSettled(sources.map(fetchFromUrl))

  const all: AssetListItem[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      all.push(...result.value)
    }
  }

  return deduplicateAssets(all)
}
