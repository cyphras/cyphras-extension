import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchPrices, priceKey, type PriceAsset } from '@/lib/api'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse } from '@ext-types/index'
import type { ShieldedPoolOption } from './useShieldedAvailable'

export interface ShieldedPoolBalance {
  balance: string | null
  // Most this pool can move in one relayed 2-note spend, in stroops; null on read failure.
  maxSpendable: string | null
  // Unspent note count; auto-split moves the balance in ceil(noteCount/2) chunks.
  noteCount: string | null
  usdValue: number | null
  change24h: number | null
  usdPrice: number | null
}

interface ShieldedBalancesState {
  byPool: Record<string, ShieldedPoolBalance>
  privateTotalUsd: number | null
  privateChangeUsd: number | null
  privateChangePct: number | null
  loading: boolean
  error: string | null
  refresh: () => void
}

// A pool prices off the asset it shields: XLM for native, else the trustline.
function poolPriceAsset(pool: ShieldedPoolOption): PriceAsset {
  return pool.native ? { code: 'XLM' } : { code: pool.assetCode ?? '', issuer: pool.assetIssuer }
}

// Uses the pool's own decimals since assets differ (USDC is 7, not 6).
function toDecimal(balance: string, decimals: number): number {
  return parseFloat(balance) / 10 ** decimals
}

// Fetches every shielded pool's private balance in one pass, priced by pool code so a pool prices with no public balance; accountPk/networkId are scope keys that re-run on switch.
export function useShieldedBalances(
  enabled: boolean,
  accountPk: string,
  networkId: string,
  pools: ShieldedPoolOption[]
): ShieldedBalancesState {
  const [byPool, setByPool] = useState<Record<string, ShieldedPoolBalance>>({})
  const [privateTotalUsd, setPrivateTotalUsd] = useState<number | null>(null)
  const [privateChangeUsd, setPrivateChangeUsd] = useState<number | null>(null)
  const [privateChangePct, setPrivateChangePct] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drops stale responses so a slow scan never paints the previous context's balances.
  const runIdRef = useRef(0)

  // Latest pools without binding refresh to the array identity, which rebuilds every render and would hammer the scanner.
  const poolsRef = useRef(pools)
  poolsRef.current = pools

  // Deriving from poolIds keeps effect/refresh stable across fresh-but-equal pools arrays.
  const poolKey = pools.map((p) => p.poolId).join(',')

  const readPoolBalance = useCallback(
    (
      poolId: string
    ): Promise<{ balance: string | null; maxSpendable: string | null; noteCount: string | null }> =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: SERVICE_TYPES.SHIELDED_SCAN, poolId },
          (scan: ServiceResponse) => {
            if (chrome.runtime.lastError) {
              resolve({ balance: null, maxSpendable: null, noteCount: null })
              return
            }
            if (scan?.shieldedScan) {
              resolve({
                balance: scan.shieldedScan.balance,
                maxSpendable: scan.shieldedScan.maxSpendable,
                noteCount: scan.shieldedScan.noteCount,
              })
              return
            }
            // Scan failed (locked, off testnet); fall back to a plain read so a transient error does not blank a pool.
            chrome.runtime.sendMessage(
              { type: SERVICE_TYPES.SHIELDED_GET_BALANCE, poolId },
              (bal: ServiceResponse) => {
                if (chrome.runtime.lastError || bal?.error) {
                  resolve({ balance: null, maxSpendable: null, noteCount: null })
                  return
                }
                resolve({
                  balance: typeof bal?.shieldedBalance === 'string' ? bal.shieldedBalance : null,
                  maxSpendable:
                    typeof bal?.shieldedMaxSpendable === 'string' ? bal.shieldedMaxSpendable : null,
                  noteCount:
                    typeof bal?.shieldedNoteCount === 'string' ? bal.shieldedNoteCount : null,
                })
              }
            )
          }
        )
      }),
    []
  )

  const refresh = useCallback(() => {
    const pools = poolsRef.current
    if (!enabled || pools.length === 0) return
    const runId = ++runIdRef.current
    setLoading(true)
    setError(null)

    const run = async () => {
      const reads = await Promise.all(pools.map((p) => readPoolBalance(p.poolId)))
      if (runId !== runIdRef.current) return

      if (reads.every((r) => r.balance === null)) {
        setError('Could not load shielded balances')
      }

      const assetsByKey = new Map(
        pools
          .map(poolPriceAsset)
          .filter((a) => a.code)
          .map((a) => [priceKey(a), a])
      )
      const { prices, changes_24h } = await fetchPrices([...assetsByKey.values()], networkId)
      if (runId !== runIdRef.current) return

      const next: Record<string, ShieldedPoolBalance> = {}
      pools.forEach((pool, i) => {
        const balance = reads[i].balance
        const maxSpendable = reads[i].maxSpendable
        const noteCount = reads[i].noteCount
        const price = prices[priceKey(poolPriceAsset(pool))] ?? null
        const usdValue =
          balance !== null && price !== null ? toDecimal(balance, pool.decimals) * price : null
        const change24h = changes_24h[priceKey(poolPriceAsset(pool))] ?? null
        next[pool.poolId] = { balance, maxSpendable, noteCount, usdValue, change24h, usdPrice: price }
      })

      // Null (not 0) until a pool prices, so the UI shimmers instead of showing a misleading total.
      const values = Object.values(next)
      const hasPrice = values.some((v) => v.usdValue !== null)
      const total = hasPrice
        ? values.reduce((sum, v) => (v.usdValue !== null ? sum + v.usdValue : sum), 0)
        : null
      // 24h change of the private holdings, value-weighted, like the public total card.
      const changeUsd = hasPrice
        ? values.reduce(
            (sum, v) =>
              v.usdValue !== null && v.change24h !== null
                ? sum + (v.usdValue * v.change24h) / 100
                : sum,
            0
          )
        : null
      const changePct = changeUsd !== null && total ? (changeUsd / total) * 100 : null

      setByPool(next)
      setPrivateTotalUsd(total)
      setPrivateChangeUsd(changeUsd)
      setPrivateChangePct(changePct)
      setLoading(false)
    }

    run()
  }, [enabled, accountPk, networkId, poolKey, readPoolBalance])

  useEffect(() => {
    // Invalidate in-flight reads first so a previous context's slow response never paints after a switch.
    runIdRef.current++
    if (!enabled || pools.length === 0) {
      setByPool({})
      setPrivateTotalUsd(null)
      setPrivateChangeUsd(null)
      setPrivateChangePct(null)
      setError(null)
      setLoading(false)
      return
    }
    setByPool({})
    setPrivateTotalUsd(null)
    setPrivateChangeUsd(null)
    setPrivateChangePct(null)
    refresh()
  }, [enabled, accountPk, networkId, poolKey, refresh])

  return { byPool, privateTotalUsd, privateChangeUsd, privateChangePct, loading, error, refresh }
}
