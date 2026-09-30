import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { SERVICE_TYPES } from '@constants/services'
import type { EvmActivity, ServiceResponse } from '@ext-types/index'

// History of the derived EVM address across the active environment's EVM chains. A failure
// yields an empty list, never an error state that would hide the Stellar rows.
export function useEvmActivity(publicKey: string | undefined) {
  const { activeNetwork } = useNetwork()
  const [activity, setActivity] = useState<EvmActivity[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    if (!publicKey) {
      setActivity([])
      setLoading(false)
      return
    }
    setLoading(true)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.FETCH_EVM_ACTIVITY, publicKey },
      (r: ServiceResponse) => {
        setActivity(chrome.runtime.lastError ? [] : (r?.activity ?? []))
        setLoading(false)
      }
    )
  }, [publicKey])

  useEffect(() => {
    refresh()
  }, [refresh, activeNetwork.id])

  return { activity, loading, refresh }
}
