import { useCallback, useEffect, useState } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { getAssetMeta } from '@/hooks/useBalances'
import { verifiedKey } from '@/lib/assetList'

// Module-level so every badge on a page shares one asset-list read per network.
const loaded = new Map<string, Set<string>>()
const pending = new Map<string, Promise<Set<string>>>()

function loadVerified(networkId: string): Promise<Set<string>> {
  let p = pending.get(networkId)
  if (!p) {
    p = getAssetMeta(networkId).then((meta) => {
      loaded.set(networkId, meta.verified)
      return meta.verified
    })
    pending.set(networkId, p)
    // Let a later mount pick up panel changes once the list's own cache expires.
    p.finally(() => setTimeout(() => pending.delete(networkId), 5 * 60 * 1000))
  }
  return p
}

/** Whether a token is on the Cyphras verified list for the active network. */
export function useVerifiedAssets(): (code: string, issuer?: string) => boolean {
  const { activeNetwork } = useNetwork()
  const [keys, setKeys] = useState<Set<string> | undefined>(() => loaded.get(activeNetwork.id))

  useEffect(() => {
    let cancelled = false
    setKeys(loaded.get(activeNetwork.id))
    loadVerified(activeNetwork.id)
      .then((set) => {
        if (!cancelled) setKeys(set)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])

  return useCallback(
    (code: string, issuer: string = '') =>
      (keys ?? new Set([verifiedKey('XLM', '')])).has(verifiedKey(code, issuer)),
    [keys]
  )
}
