import { useEffect, useState } from 'react'
import { getUiAsset, type UiAssetKey } from '@/lib/uiAssets'

// Resolves a UI asset to a byte-cached data URL; null until the first
// resolution so callers can fall back to a bundled placeholder.
export function useUiAsset(key: UiAssetKey): string | null {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getUiAsset(key).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return src
}
