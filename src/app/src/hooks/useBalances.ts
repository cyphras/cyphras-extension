import { useState, useEffect, useCallback, useRef } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { fetchPrices } from '@/lib/api'
import { fetchAssetList } from '@/lib/assetList'
import { SERVICE_TYPES } from '@constants/services'

const ASSET_LIST_CACHE_KEY_PREFIX = 'cyphras_asset_list_'
const CACHE_TTL_MS = 10 * 60 * 1000

export interface AssetBalance {
  code: string
  issuer: string
  balance: string
  usdPrice: number | null
  usdValue: number | null
  change24h: number | null
  isNative: boolean
  icon?: string
}

export interface BalanceState {
  balances: AssetBalance[]
  totalUsd: number | null
  dailyChangeUsd: number | null
  dailyChangePct: number | null
  loading: boolean
  error: string | null
  isFunded: boolean
  subentryCount: number
}

interface CachedAssetList {
  assets: Array<{
    code: string
    issuer: string
    icon?: string
  }>
  cachedAt: number
}

export async function getIconMap(networkId: string): Promise<Map<string, string>> {
  const iconMap = new Map<string, string>()
  const cacheKey = `${ASSET_LIST_CACHE_KEY_PREFIX}${networkId}`
  try {
    const cached = await new Promise<CachedAssetList | null>((resolve) => {
      chrome.storage.local.get(cacheKey, (r) => {
        const data = r[cacheKey]
        resolve(data && typeof data === 'object' ? (data as CachedAssetList) : null)
      })
    })

    let assets = cached?.assets

    if (!assets || Date.now() - (cached?.cachedAt ?? 0) > CACHE_TTL_MS) {
      const fetched = await fetchAssetList(networkId)
      assets = fetched.map((a) => ({ code: a.code, issuer: a.issuer, icon: a.icon }))
      chrome.storage.local.set({ [cacheKey]: { assets: fetched, cachedAt: Date.now() } })
    }

    for (const a of assets) {
      if (a.icon) iconMap.set(`${a.code}:${a.issuer}`, a.icon)
    }
  } catch {
    // Icons are non-critical - silently fail
  }
  return iconMap
}

// Native first, then by USD value, then alphabetically; before prices load (usdValue null) it falls to native-then-alphabetical.
function compareBalances(a: AssetBalance, b: AssetBalance): number {
  if (a.isNative) return -1
  if (b.isNative) return 1
  if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue
  if (a.usdValue !== null) return -1
  if (b.usdValue !== null) return 1
  return a.code.localeCompare(b.code)
}

export function useBalances(publicKey: string | undefined): BalanceState & { refresh: () => void } {
  const { activeNetwork } = useNetwork()
  const [state, setState] = useState<BalanceState>({
    balances: [],
    totalUsd: null,
    dailyChangeUsd: null,
    dailyChangePct: null,
    loading: true,
    error: null,
    isFunded: false,
    subentryCount: 0,
  })

  // A fetch only commits state if its captured id still matches, so a slow response for a previous
  // account never paints the current account's screen.
  const runIdRef = useRef(0)

  const fetchBalances = useCallback(
    async (showLoading = false) => {
      const runId = runIdRef.current

      if (!publicKey) {
        setState((prev) => ({ ...prev, loading: false }))
        return
      }

      if (showLoading) {
        setState((prev) => ({ ...prev, loading: true, error: null }))
      }

      try {
        const response = await new Promise<{
          unfunded?: boolean
          rawBalances?: Array<{
            balance: string
            asset_type: string
            asset_code?: string
            asset_issuer?: string
          }> | null
          subentryCount?: number
          error?: string
        }>((resolve) => {
          chrome.runtime.sendMessage(
            { type: SERVICE_TYPES.FETCH_HORIZON_ACCOUNT, publicKey },
            (r) => {
              if (chrome.runtime.lastError || !r) resolve({ error: 'Extension error' })
              else resolve(r)
            }
          )
        })

        if (runId !== runIdRef.current) return

        if (response.unfunded) {
          setState({
            balances: [],
            totalUsd: null,
            dailyChangeUsd: null,
            dailyChangePct: null,
            loading: false,
            error: null,
            isFunded: false,
            subentryCount: 0,
          })
          return
        }

        if (response.error || !response.rawBalances)
          throw new Error(response.error ?? 'Fetch failed')

        const subentryCount = response.subentryCount ?? 0
        const account = { balances: response.rawBalances }

        const rawBalances: AssetBalance[] = account.balances.map((b) => ({
          code: b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? ''),
          issuer: b.asset_issuer ?? '',
          balance: b.balance,
          isNative: b.asset_type === 'native',
          usdPrice: null,
          usdValue: null,
          change24h: null,
          icon: undefined,
        }))

        // Show amounts as soon as the account loads so the wallet opens without waiting on prices; totalUsd null marks prices still loading.
        setState({
          balances: [...rawBalances].sort(compareBalances),
          totalUsd: null,
          dailyChangeUsd: null,
          dailyChangePct: null,
          loading: false,
          error: null,
          isFunded: true,
          subentryCount,
        })

        const tokenCodes = [...new Set(rawBalances.map((b) => b.code))]
        const [{ prices, changes_24h }, iconMap] = await Promise.all([
          fetchPrices(tokenCodes),
          getIconMap(activeNetwork.id),
        ])

        if (runId !== runIdRef.current) return

        const balancesWithPrices = rawBalances
          .map((b) => {
            const price = prices[b.code] ?? null
            const usdValue = price !== null ? parseFloat(b.balance) * price : null
            const change24h = changes_24h[b.code] ?? null
            const icon = b.isNative ? undefined : iconMap.get(`${b.code}:${b.issuer}`)
            return { ...b, usdPrice: price, usdValue, change24h, icon }
          })
          .sort(compareBalances)

        const totalUsd = balancesWithPrices.reduce((sum, b) => {
          return b.usdValue !== null ? sum + b.usdValue : sum
        }, 0)

        // Portfolio-weighted 24h change: sum(asset_usd_value * asset_change%) / totalUsd
        let dailyChangeUsd: number | null = null
        let dailyChangePct: number | null = null
        const changeableBalances = balancesWithPrices.filter(
          (b) => b.usdValue !== null && b.change24h !== null
        )
        if (changeableBalances.length > 0 && totalUsd > 0) {
          const changeUsd = changeableBalances.reduce((sum, b) => {
            return sum + (b.usdValue! * b.change24h!) / 100
          }, 0)
          dailyChangeUsd = changeUsd
          dailyChangePct = (changeUsd / totalUsd) * 100
        }

        setState({
          balances: balancesWithPrices,
          totalUsd,
          dailyChangeUsd,
          dailyChangePct,
          loading: false,
          error: null,
          isFunded: true,
          subentryCount,
        })
      } catch {
        if (runId !== runIdRef.current) return
        setState((prev) => ({
          ...prev,
          dailyChangeUsd: null,
          dailyChangePct: null,
          loading: false,
          error: 'Failed to fetch balances',
        }))
      }
    },
    [publicKey, activeNetwork.id]
  )

  useEffect(() => {
    // Bump the run token to invalidate the previous key's in-flight fetch, then clear its balances so
    // consumers see a loading state rather than stale amounts.
    runIdRef.current += 1
    setState({
      balances: [],
      totalUsd: null,
      dailyChangeUsd: null,
      dailyChangePct: null,
      loading: true,
      error: null,
      isFunded: false,
      subentryCount: 0,
    })
    fetchBalances(true)
    const interval = setInterval(fetchBalances, 30000)
    return () => clearInterval(interval)
  }, [fetchBalances])

  const refresh = useCallback(() => fetchBalances(true), [fetchBalances])

  return { ...state, refresh }
}
