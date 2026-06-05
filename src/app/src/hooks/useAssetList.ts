import { useState, useEffect, useCallback } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { fetchAssetList } from '@/lib/assetList'
import type { AssetListItem } from '@/lib/assetList'

const CACHE_KEY_PREFIX = 'cyphras_asset_list_'
const CACHE_TTL_MS = 10 * 60 * 1000

interface CachedAssetList {
  assets: AssetListItem[]
  cachedAt: number
}

export function useAssetList() {
  const { activeNetwork } = useNetwork()
  const [assets, setAssets] = useState<AssetListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setError(null)

    const cacheKey = `${CACHE_KEY_PREFIX}${activeNetwork.id}`

    try {
      const cached = await new Promise<CachedAssetList | null>((resolve) => {
        chrome.storage.local.get(cacheKey, (result) => {
          const data = result[cacheKey]
          resolve(data && typeof data === 'object' ? (data as CachedAssetList) : null)
        })
      })

      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        setAssets(cached.assets)
        setLoading(false)
        return
      }

      const fetched = await fetchAssetList(activeNetwork.id)

      const toCache: CachedAssetList = { assets: fetched, cachedAt: Date.now() }
      chrome.storage.local.set({ [cacheKey]: toCache })

      setAssets(fetched)
    } catch {
      setError('Failed to load asset list')
    } finally {
      setLoading(false)
    }
  }, [activeNetwork.id])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  return { assets, loading, error, refresh: loadAssets }
}
