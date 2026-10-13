import { useCallback, useEffect, useRef, useState } from 'react'
import { SERVICE_TYPES } from '@constants/services'
import type {
  ServiceResponse,
  ShieldedHistoryItem,
  ShieldedScope,
  ShieldedStatusView,
} from '@ext-types/index'

// The account's private history in a pool, asked for again whenever a sync changes the status it
// is built from, and for what that status was read for. Items stay null until the first reply, so a
// page can show its skeleton.
export function usePrivateHistory(
  enabled: boolean,
  scope: ShieldedScope | null,
  poolId: string,
  status: ShieldedStatusView | null
) {
  const [items, setItems] = useState<ShieldedHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const runRef = useRef(0)
  // syncedAt moves on every sync and says nothing new.
  const content = status ? JSON.stringify({ ...status, syncedAt: null }) : ''

  const load = useCallback(() => {
    const run = ++runRef.current
    setLoading(true)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_HISTORY, poolId, ...scope },
      (r: ServiceResponse) => {
        if (run !== runRef.current) return
        setLoading(false)
        if (chrome.runtime.lastError) {
          setError('The extension restarted. Try again.')
        } else if (r?.shieldedHistory) {
          setItems(r.shieldedHistory)
          setError(null)
        } else {
          setError(r?.error ?? 'Private history is unavailable')
        }
      }
    )
  }, [poolId, scope])

  useEffect(() => {
    if (!enabled || !content || !scope) {
      runRef.current++
      setItems(null)
      setError(null)
      setLoading(false)
      return
    }
    load()
  }, [enabled, content, scope, load])

  return { items, error, loading, refresh: load }
}
