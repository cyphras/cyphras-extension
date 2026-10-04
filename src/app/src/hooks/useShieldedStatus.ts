import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPrices, priceKey, type PriceAsset } from '@/lib/api'
import { formatUnits } from '@/lib/amount'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse, ShieldedStatusView } from '@ext-types/index'
import type { ShieldedPoolOption } from './useShieldedAvailable'

interface ShieldedPoolState {
  status: ShieldedStatusView | null
  // The spendable balance in USD, with the asset's price and 24h change.
  usdValue: number | null
  usdPrice: number | null
  change24h: number | null
}

interface ShieldedStatusState {
  byPool: Record<string, ShieldedPoolState>
  privateTotalUsd: number | null
  privateChangeUsd: number | null
  privateChangePct: number | null
  syncing: boolean
  error: string | null
  // Syncs every pool with the chain; reload only rereads what the background holds.
  refresh: () => void
  reload: () => void
}

// While a deposit or payment is in flight the next sync comes sooner, and backs off again each time
// a sync finds nothing new, as a deposit can wait for screening for a day.
const BUSY_SYNC_MS = 15_000
const IDLE_SYNC_MS = 120_000

type StatusRequest = typeof SERVICE_TYPES.SHIELDED_STATUS | typeof SERVICE_TYPES.SHIELDED_SYNC

function readStatus(
  type: StatusRequest,
  poolId: string
): Promise<{ status: ShieldedStatusView | null; error: string | null }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, poolId }, (r: ServiceResponse) => {
      if (chrome.runtime.lastError) resolve({ status: null, error: 'Extension error' })
      else if (r?.shieldedStatus) resolve({ status: r.shieldedStatus, error: null })
      else resolve({ status: null, error: r?.error ?? 'Private mode is unavailable' })
    })
  })
}

// A stranded payout is left out: it waits for a claim, which no sync brings.
function shieldedInFlight(status: ShieldedStatusView): boolean {
  return (
    status.deposits.some((d) => d.state === 'submitting' || d.state === 'pending') ||
    status.plans.some((p) => ['prepared', 'submitted', 'queued'].includes(p.state))
  )
}

// What a sync can change in a status; syncedAt moves on every sync and says nothing new.
const contentOf = (statuses: (ShieldedStatusView | null)[]): string =>
  JSON.stringify(statuses.map((s) => s && { ...s, syncedAt: null }))

// A pool prices off the asset it shields.
function poolPriceAsset(pool: ShieldedPoolOption): PriceAsset {
  return pool.native ? { code: 'XLM' } : { code: pool.assetCode ?? '', issuer: pool.assetIssuer }
}

// Every pool's private status for the active account; it syncs once when private mode becomes
// available and keeps syncing while it is open. accountPk and networkId scope the reads.
export function useShieldedStatus(
  enabled: boolean,
  open: boolean,
  accountPk: string,
  networkId: string,
  pools: ShieldedPoolOption[]
): ShieldedStatusState {
  const [statuses, setStatuses] = useState<Record<string, ShieldedStatusView>>({})
  const [prices, setPrices] = useState<
    Record<string, { price: number | null; change: number | null }>
  >({})
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drops replies from a previous account or network so they never paint after a switch. Syncs of
  // the current scope can overlap, so syncing stays on until the last one ends.
  const runIdRef = useRef(0)
  const syncsRef = useRef(0)
  // Syncs in a row that found nothing new, which stretch the wait before the next one.
  const quietRef = useRef(0)
  const contentRef = useRef('')
  const poolsRef = useRef(pools)
  poolsRef.current = pools
  const poolKey = pools.map((p) => p.poolId).join(',')

  const read = useCallback(
    async (type: StatusRequest) => {
      const current = poolsRef.current
      if (!enabled || current.length === 0) return
      const runId = runIdRef.current
      const sync = type === SERVICE_TYPES.SHIELDED_SYNC
      if (sync) {
        syncsRef.current++
        setSyncing(true)
      }
      const replies = await Promise.all(current.map((p) => readStatus(type, p.poolId)))
      if (runId !== runIdRef.current) return
      if (sync) {
        syncsRef.current--
        setSyncing(syncsRef.current > 0)
        const content = contentOf(replies.map((r) => r.status))
        quietRef.current = content === contentRef.current ? quietRef.current + 1 : 0
        contentRef.current = content
      }
      setStatuses((prev) => {
        const next = { ...prev }
        current.forEach((p, i) => {
          const status = replies[i].status
          if (status) next[p.poolId] = status
        })
        return next
      })
      setError(replies.find((r) => r.error)?.error ?? null)
    },
    [enabled]
  )

  const refresh = useCallback(() => {
    quietRef.current = 0
    void read(SERVICE_TYPES.SHIELDED_SYNC)
  }, [read])
  const reload = useCallback(() => void read(SERVICE_TYPES.SHIELDED_STATUS), [read])

  useEffect(() => {
    runIdRef.current++
    syncsRef.current = 0
    quietRef.current = 0
    contentRef.current = ''
    setStatuses({})
    setError(null)
    setSyncing(false)
    if (!enabled || poolsRef.current.length === 0) return
    const runId = runIdRef.current
    const assets = poolsRef.current.map(poolPriceAsset)
    fetchPrices(assets, networkId).then(({ prices: p, changes_24h }) => {
      if (runId !== runIdRef.current) return
      const next: Record<string, { price: number | null; change: number | null }> = {}
      poolsRef.current.forEach((pool, i) => {
        const key = priceKey(assets[i])
        next[pool.poolId] = { price: p[key] ?? null, change: changes_24h[key] ?? null }
      })
      setPrices(next)
    })
    // What the background already holds paints first; the sync then brings it up to the chain.
    void read(SERVICE_TYPES.SHIELDED_STATUS).then(() => {
      if (runId === runIdRef.current) return read(SERVICE_TYPES.SHIELDED_SYNC)
    })
    // poolKey stands for the pools, whose array is rebuilt on every render.
  }, [enabled, accountPk, networkId, poolKey, read])

  const busy = Object.values(statuses).some(shieldedInFlight)
  useEffect(() => {
    if (!enabled || !open || syncing) return
    const wait = busy ? Math.min(BUSY_SYNC_MS * 2 ** quietRef.current, IDLE_SYNC_MS) : IDLE_SYNC_MS
    const timer = setTimeout(() => void read(SERVICE_TYPES.SHIELDED_SYNC), wait)
    return () => clearTimeout(timer)
  }, [enabled, open, syncing, busy, read, statuses])

  const byPool: Record<string, ShieldedPoolState> = {}
  for (const pool of pools) {
    const status = statuses[pool.poolId] ?? null
    const price = prices[pool.poolId]?.price ?? null
    const spendable = status
      ? parseFloat(formatUnits(status.balance.spendable, pool.decimals))
      : null
    byPool[pool.poolId] = {
      status,
      usdValue: spendable !== null && price !== null ? spendable * price : null,
      usdPrice: price,
      change24h: prices[pool.poolId]?.change ?? null,
    }
  }

  // Null until a pool prices, so the card shimmers instead of showing a misleading total.
  const values = Object.values(byPool)
  const priced = values.filter((v) => v.usdValue !== null)
  const privateTotalUsd =
    priced.length > 0 ? priced.reduce((s, v) => s + (v.usdValue ?? 0), 0) : null
  const privateChangeUsd =
    priced.length > 0
      ? priced.reduce((s, v) => s + ((v.usdValue ?? 0) * (v.change24h ?? 0)) / 100, 0)
      : null
  const privateChangePct =
    privateChangeUsd !== null && privateTotalUsd ? (privateChangeUsd / privateTotalUsd) * 100 : null

  return {
    byPool,
    privateTotalUsd,
    privateChangeUsd,
    privateChangePct,
    syncing,
    error,
    refresh,
    reload,
  }
}
