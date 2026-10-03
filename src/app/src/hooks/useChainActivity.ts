import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { SERVICE_TYPES } from '@constants/services'
import type { ChainActivity, ServiceResponse } from '@ext-types/index'

// The last result per network and account, so revisits paint at once.
const activityCache = new Map<string, ChainActivity[]>()

// History of the account's EVM and Bitcoin addresses on the active environment's chains. A
// failure yields an empty list, never an error state that would hide the Stellar rows.
// With no key the hook idles and keeps what it shows.
export function useChainActivity(publicKey: string | undefined) {
  const { activeNetwork } = useNetwork()
  const cacheKey = publicKey ? `${activeNetwork.id}|${publicKey}` : ''
  const [activity, setActivity] = useState<ChainActivity[]>(() => activityCache.get(cacheKey) ?? [])
  const [loading, setLoading] = useState(!activityCache.has(cacheKey))

  const refresh = useCallback(() => {
    if (!publicKey) {
      setLoading(false)
      return
    }
    const key = `${activeNetwork.id}|${publicKey}`
    const cached = activityCache.get(key)
    setActivity(cached ?? [])
    setLoading(!cached)
    const load = (type: string) =>
      new Promise<ChainActivity[]>((resolve) =>
        chrome.runtime.sendMessage({ type, publicKey }, (r: ServiceResponse) =>
          resolve(chrome.runtime.lastError ? [] : (r?.activity ?? []))
        )
      )
    Promise.all([
      load(SERVICE_TYPES.FETCH_EVM_ACTIVITY),
      load(SERVICE_TYPES.FETCH_BTC_ACTIVITY),
    ]).then(([evm, btc]) => {
      const merged = [...evm, ...btc].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      activityCache.set(key, merged)
      setActivity(merged)
      setLoading(false)
    })
  }, [publicKey, activeNetwork.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { activity, loading, refresh }
}
