import { useState, useEffect, useCallback, useRef } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { fetchPrices, priceKey } from '@/lib/api'
import { fetchAssetList, verifiedKey } from '@/lib/assetList'
import { toDataUrls } from '@/lib/iconCache'
import { SERVICE_TYPES } from '@constants/services'
import { LEGACY_NETWORK_TO_CHAIN } from '@constants/chains'
import type { ChainBalance } from '@ext-types/index'

const ASSET_LIST_CACHE_KEY_PREFIX = 'cyphras_asset_list_v3_' // bump when the cached shape changes
const CACHE_TTL_MS = 10 * 60 * 1000

export interface AssetBalance {
  chain: string // CAIP-2
  code: string
  issuer: string
  balance: string
  decimals: number
  usdPrice: number | null
  usdValue: number | null
  change24h: number | null
  isNative: boolean
  icon?: string
  // Display name from the curated list, e.g. "Ethereum" for ETH.
  name?: string
  // Logical-token key from the curated list; instances sharing it are the
  // same token on different chains.
  group?: string
  // Marked verified by the Cyphras team in the curated asset list.
  verified: boolean
  // See ChainBalance.locked: what the network keeps back from this balance.
  locked?: string
  // The Stellar account does not exist on-chain yet; only set on the XLM row.
  inactive?: boolean
}

export interface GroupedBalance extends AssetBalance {
  // Per-chain constituents, largest USD value first; length 1 for
  // single-chain tokens.
  parts: AssetBalance[]
}

// Merge curated instances of the same logical token across chains. Only
// list-backed rows carry a group, so a counterfeit ticker the user added can
// never ride a real token's total.
export function groupBalances(balances: AssetBalance[]): GroupedBalance[] {
  const out: GroupedBalance[] = []
  const byGroup = new Map<string, GroupedBalance>()
  for (const b of balances) {
    const existing = b.group ? byGroup.get(b.group) : undefined
    if (!existing) {
      const grouped: GroupedBalance = { ...b, parts: [b] }
      if (b.group) byGroup.set(b.group, grouped)
      out.push(grouped)
      continue
    }
    existing.parts.push(b)
    existing.parts.sort((x, y) => (y.usdValue ?? 0) - (x.usdValue ?? 0))
    const total = existing.parts.reduce((sum, p) => sum + parseFloat(p.balance), 0)
    existing.balance = total.toFixed(7).replace(/\.?0+$/, '')
    const values = existing.parts.map((p) => p.usdValue).filter((v): v is number => v !== null)
    existing.usdValue = values.length ? values.reduce((sum, v) => sum + v, 0) : null
    const primary = existing.parts[0]
    existing.chain = primary.chain
    existing.issuer = primary.issuer
    existing.isNative = primary.isNative
    existing.usdPrice = primary.usdPrice ?? existing.usdPrice
    existing.icon = existing.icon ?? b.icon
    existing.name = existing.name ?? b.name
  }
  return out
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
    name?: string
    group?: string
    verified?: boolean
  }>
  cachedAt: number
}

export interface AssetMeta {
  icons: Map<string, string>
  names: Map<string, string>
  groups: Map<string, string>
  // verifiedKey()s of the curated tokens the team marked verified.
  verified: Set<string>
}

// XLM is the network's own asset: it cannot be counterfeited, so it always
// carries the badge even before the curated list loads.
const ALWAYS_VERIFIED = [verifiedKey('XLM', '')]

// One load per network shared by every caller: a page and its sheets mount
// together and would otherwise each read storage and refetch the list.
const metaMemo = new Map<string, { at: number; meta: Promise<AssetMeta> }>()

// All curated-list metadata from one load, so callers never race two loads of the same cache.
// cacheOnly never waits on the network (stale is fine), so first paint shows names, not tickers.
export function getAssetMeta(
  networkId: string,
  opts?: { cacheOnly?: boolean }
): Promise<AssetMeta> {
  const hit = metaMemo.get(networkId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.meta
  if (opts?.cacheOnly) return loadAssetMeta(networkId, true)
  const meta = loadAssetMeta(networkId, false)
  metaMemo.set(networkId, { at: Date.now(), meta })
  // An empty result means the list could not load; the next caller tries again.
  void meta.then((m) => {
    if (m.names.size === 0 && m.icons.size === 0) metaMemo.delete(networkId)
  })
  return meta
}

async function loadAssetMeta(networkId: string, cacheOnly: boolean): Promise<AssetMeta> {
  const icons = new Map<string, string>()
  const names = new Map<string, string>()
  const groups = new Map<string, string>()
  const verified = new Set<string>(ALWAYS_VERIFIED)
  const cacheKey = `${ASSET_LIST_CACHE_KEY_PREFIX}${networkId}`
  try {
    const cached = await new Promise<CachedAssetList | null>((resolve) => {
      chrome.storage.local.get(cacheKey, (r) => {
        const data = r[cacheKey]
        resolve(data && typeof data === 'object' ? (data as CachedAssetList) : null)
      })
    })

    let assets = cached?.assets
    const stale = !assets || Date.now() - (cached?.cachedAt ?? 0) > CACHE_TTL_MS

    if (stale && !cacheOnly) {
      const fetched = await fetchAssetList(networkId, ['stellar', 'evm', 'bitcoin'])
      // An empty list is a failed fetch; the stale copy beats losing every icon and name.
      if (fetched.length > 0) {
        assets = fetched
        chrome.storage.local.set({ [cacheKey]: { assets: fetched, cachedAt: Date.now() } })
      }
    }

    for (const a of assets ?? []) {
      if (a.icon) icons.set(`${a.code}:${a.issuer}`, a.icon)
      if (a.name) names.set(`${a.code}:${a.issuer}`, a.name)
      if (a.group) groups.set(`${a.code}:${a.issuer}`, a.group)
      if (a.verified) verified.add(verifiedKey(a.code, a.issuer))
    }
    return { icons: await toDataUrls(icons), names, groups, verified }
  } catch {
    // Asset metadata is non-critical - silently fail
  }
  return { icons, names, groups, verified }
}

export async function getIconMap(networkId: string): Promise<Map<string, string>> {
  return (await getAssetMeta(networkId)).icons
}

// Stellar is the home network, so XLM and Stellar tokens lead, then Bitcoin, then EVM native
// coins and EVM tokens.
// Within a tier the larger USD value comes first; unpriced rows follow alphabetically.
function balanceTier(b: AssetBalance): number {
  const family = b.chain.startsWith('bip122') ? 2 : b.chain.startsWith('eip155') ? 3 : 0
  return family + (b.isNative ? 0 : 1)
}

function compareBalances(a: AssetBalance, b: AssetBalance): number {
  const tier = balanceTier(a) - balanceTier(b)
  if (tier !== 0) return tier
  if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue
  if (a.usdValue !== null) return -1
  if (b.usdValue !== null) return 1
  return a.code.localeCompare(b.code)
}

const EMPTY_STATE: BalanceState = {
  balances: [],
  totalUsd: null,
  dailyChangeUsd: null,
  dailyChangePct: null,
  loading: true,
  error: null,
  isFunded: false,
  subentryCount: 0,
}

// The last full result per network and account: any page paints from it at
// once while the network refresh runs, and the stored copy covers the next
// popup open. Balances are public chain data, so nothing secret is kept.
const SNAPSHOT_KEY_PREFIX = 'cyphras_balance_snapshot_'
const snapshots = new Map<string, BalanceState>()

export function useBalances(publicKey: string | undefined): BalanceState & { refresh: () => void } {
  const { activeNetwork } = useNetwork()
  const snapshotKey = publicKey ? `${activeNetwork.id}_${publicKey}` : ''
  const [state, setState] = useState<BalanceState>(() => snapshots.get(snapshotKey) ?? EMPTY_STATE)

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
        // Unified portfolio: EVM and Bitcoin balances ride alongside the Stellar
        // ones, all read at once. Best-effort - an outage there never blocks Stellar.
        const otherChains = (type: string) =>
          new Promise<{ balances?: ChainBalance[] }>((resolve) => {
            chrome.runtime.sendMessage({ type, publicKey }, (r) =>
              resolve(chrome.runtime.lastError || !r ? {} : r)
            )
          })
        const [response, evm, btc, cachedMeta] = await Promise.all([
          new Promise<{
            unfunded?: boolean
            balances?: ChainBalance[] | null
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
          }),
          otherChains(SERVICE_TYPES.FETCH_EVM_BALANCES),
          otherChains(SERVICE_TYPES.FETCH_BTC_BALANCES),
          // Cache-only meta so the first paint already carries names and icons;
          // the priced pass below refreshes them from the network.
          getAssetMeta(activeNetwork.id, { cacheOnly: true }),
        ])

        if (runId !== runIdRef.current) return

        // Unfunded is not an error: the account can still hold EVM balances.
        const isFunded = !response.unfunded
        if (isFunded && (response.error || !response.balances))
          throw new Error(response.error ?? 'Fetch failed')
        // An unactivated account still shows its XLM row at zero, so a new
        // wallet reads as a Stellar wallet instead of an empty list.
        const stellarBalances: Array<ChainBalance & { inactive?: boolean }> = isFunded
          ? (response.balances ?? [])
          : [
              {
                chain: LEGACY_NETWORK_TO_CHAIN[activeNetwork.id] ?? activeNetwork.id,
                code: 'XLM',
                issuer: '',
                amount: '0',
                decimals: 7,
                isNative: true,
                inactive: true,
              },
            ]
        const subentryCount = isFunded ? (response.subentryCount ?? 0) : 0

        const rawBalances: AssetBalance[] = [
          ...stellarBalances,
          ...(evm.balances ?? []),
          ...(btc.balances ?? []),
        ].map((b: ChainBalance & { inactive?: boolean }) => ({
          chain: b.chain,
          code: b.code,
          issuer: b.issuer,
          balance: b.amount,
          decimals: b.decimals,
          isNative: b.isNative,
          locked: b.locked,
          inactive: b.inactive,
          usdPrice: null,
          usdValue: null,
          change24h: null,
          icon:
            b.isNative && b.code === 'XLM'
              ? undefined
              : cachedMeta.icons.get(`${b.code}:${b.issuer}`),
          name:
            cachedMeta.names.get(`${b.code}:${b.issuer}`) ??
            (b.isNative && b.code === 'XLM' ? 'Stellar Lumens' : undefined),
          group: cachedMeta.groups.get(`${b.code}:${b.issuer}`),
          verified: false,
        }))

        setState((prev) => {
          const priced = rawBalances.map((b) => {
            const prior = prev.balances.find((p) => p.code === b.code && p.issuer === b.issuer)
            const usdPrice = prior?.usdPrice ?? null
            const usdValue = usdPrice !== null ? parseFloat(b.balance) * usdPrice : null
            return {
              ...b,
              usdPrice,
              usdValue,
              change24h: prior?.change24h ?? null,
              icon: prior?.icon ?? b.icon,
              name: b.name ?? prior?.name,
              group: b.group ?? prior?.group,
              verified: prior?.verified ?? false,
            }
          })
          const totalUsd = priced.some((b) => b.usdValue !== null)
            ? priced.reduce((sum, b) => (b.usdValue !== null ? sum + b.usdValue : sum), 0)
            : priced.length === 0
              ? 0
              : null
          return {
            ...prev,
            balances: priced.sort(compareBalances),
            totalUsd,
            loading: false,
            error: null,
            isFunded,
            subentryCount,
          }
        })

        // Priced by full identity (code + issuer), so a counterfeit token with a
        // copied code never inherits the real token's price.
        const keyOf = (b: AssetBalance) =>
          priceKey({ code: b.code, issuer: b.isNative ? undefined : b.issuer })
        const [
          { prices, changes_24h, verified },
          { icons: iconMap, names, groups, verified: listed },
        ] = await Promise.all([
          fetchPrices(
            rawBalances.map((b) => ({ code: b.code, issuer: b.isNative ? undefined : b.issuer })),
            activeNetwork.id
          ),
          getAssetMeta(activeNetwork.id),
        ])

        if (runId !== runIdRef.current) return

        const balancesWithPrices = rawBalances
          .map((b) => {
            const price = prices[keyOf(b)] ?? null
            const usdValue = price !== null ? parseFloat(b.balance) * price : null
            const change24h = changes_24h[keyOf(b)] ?? null
            // XLM keeps the built-in vector icon; every other asset,
            // including EVM natives like ETH, resolves from the curated list.
            const icon =
              b.isNative && b.code === 'XLM' ? undefined : iconMap.get(`${b.code}:${b.issuer}`)
            const name =
              names.get(`${b.code}:${b.issuer}`) ??
              (b.isNative && b.code === 'XLM' ? 'Stellar Lumens' : undefined)
            return {
              ...b,
              usdPrice: price,
              usdValue,
              change24h,
              icon,
              name,
              group: groups.get(`${b.code}:${b.issuer}`),
              // The curated list is the source of truth; the price service's copy can lag it.
              verified: !!verified[keyOf(b)] || listed.has(verifiedKey(b.code, b.issuer)),
            }
          })
          .sort(compareBalances)

        // Null (not 0) until a price loads, so the UI shows a shimmer not a misleading $0.00
        const hasPrice = balancesWithPrices.some((b) => b.usdValue !== null)
        const totalUsd = hasPrice
          ? balancesWithPrices.reduce((sum, b) => (b.usdValue !== null ? sum + b.usdValue : sum), 0)
          : balancesWithPrices.length === 0
            ? 0
            : null

        // Portfolio-weighted 24h change: sum(asset_usd_value * asset_change%) / totalUsd
        let dailyChangeUsd: number | null = null
        let dailyChangePct: number | null = null
        const changeableBalances = balancesWithPrices.filter(
          (b) => b.usdValue !== null && b.change24h !== null
        )
        if (changeableBalances.length > 0 && totalUsd !== null && totalUsd > 0) {
          const changeUsd = changeableBalances.reduce((sum, b) => {
            return sum + (b.usdValue! * b.change24h!) / 100
          }, 0)
          dailyChangeUsd = changeUsd
          dailyChangePct = (changeUsd / totalUsd) * 100
        }

        const next: BalanceState = {
          balances: balancesWithPrices,
          totalUsd,
          dailyChangeUsd,
          dailyChangePct,
          loading: false,
          error: null,
          isFunded,
          subentryCount,
        }
        setState(next)
        const key = `${activeNetwork.id}_${publicKey}`
        snapshots.set(key, next)
        chrome.storage.local.set({ [`${SNAPSHOT_KEY_PREFIX}${key}`]: next })
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
    // Bump the run token to invalidate the previous key's in-flight fetch. The
    // last snapshot for this key paints at once; without one, consumers see a
    // loading state rather than another account's amounts.
    runIdRef.current += 1
    const runId = runIdRef.current
    const cached = snapshots.get(snapshotKey)
    setState(cached ?? EMPTY_STATE)
    if (!cached && snapshotKey) {
      const storageKey = `${SNAPSHOT_KEY_PREFIX}${snapshotKey}`
      chrome.storage.local.get(storageKey, (r) => {
        const stored = r[storageKey] as BalanceState | undefined
        // Only while nothing fresher has landed.
        if (stored && runId === runIdRef.current) {
          snapshots.set(snapshotKey, stored)
          setState((prev) => (prev.loading ? stored : prev))
        }
      })
    }
    fetchBalances(!cached)
    const interval = setInterval(fetchBalances, 30000)
    return () => clearInterval(interval)
  }, [fetchBalances, snapshotKey])

  const refresh = useCallback(() => fetchBalances(true), [fetchBalances])

  return { ...state, refresh }
}
