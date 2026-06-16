import { useState, useEffect, useCallback } from 'react'

// Scoped per (networkId, account) so a hidden asset never bleeds across accounts or networks.
function hiddenAssetsKey(networkId: string, account: string): string {
  return `cyphras_hidden_assets_${networkId}_${account}`
}

function getStoredHidden(networkId: string, account: string): Promise<string[]> {
  const key = hiddenAssetsKey(networkId, account)
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const data = result[key]
      resolve(Array.isArray(data) ? (data as string[]) : [])
    })
  })
}

export function useHiddenAssets(networkId: string, account: string) {
  const [hiddenAssets, setHiddenAssets] = useState<string[]>([])

  const loadHidden = useCallback(() => {
    if (!account) {
      setHiddenAssets([])
      return
    }
    getStoredHidden(networkId, account).then(setHiddenAssets)
  }, [networkId, account])

  useEffect(() => {
    loadHidden()
  }, [loadHidden])

  function toggleHiddenAsset(key: string) {
    if (!account) return
    setHiddenAssets((prev) => {
      const updated = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      chrome.storage.local.set({ [hiddenAssetsKey(networkId, account)]: updated })
      return updated
    })
  }

  return { hiddenAssets, toggleHiddenAsset }
}
