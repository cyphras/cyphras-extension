import { useState, useEffect, useCallback } from 'react'
import { SERVICE_TYPES } from '@constants/services'

export interface CustomAsset {
  code: string
  issuer: string
  domain?: string
}

// Scoped per account: a trustline is per-account on-chain, so an asset added by one account must not
// appear under another on the same network.
function customAssetsKey(networkId: string, account: string): string {
  return `cyphras_custom_assets_${networkId}_${account}`
}

function getStoredAssets(networkId: string, account: string): Promise<CustomAsset[]> {
  const key = customAssetsKey(networkId, account)
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const data = result[key]
      resolve(Array.isArray(data) ? (data as CustomAsset[]) : [])
    })
  })
}

export function useCustomAssets(
  networkId: string,
  horizonUrl: string,
  networkPassphrase: string,
  account: string
) {
  const [assets, setAssets] = useState<CustomAsset[]>([])

  const loadAssets = useCallback(() => {
    if (!account) {
      setAssets([])
      return
    }
    getStoredAssets(networkId, account).then(setAssets)
  }, [networkId, account])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  async function addAsset(asset: CustomAsset): Promise<{ txHash?: string; error?: string }> {
    const current = await getStoredAssets(networkId, account)
    const exists = current.find((a) => a.code === asset.code && a.issuer === asset.issuer)
    if (exists) return { error: 'Asset already added' }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: SERVICE_TYPES.ADD_TRUSTLINE,
          trustline: { assetCode: asset.code, assetIssuer: asset.issuer },
          horizonUrl,
          networkPassphrase,
        },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
            return
          }
          const updated = [...current, asset]
          await chrome.storage.local.set({ [customAssetsKey(networkId, account)]: updated })
          setAssets(updated)
          resolve({ txHash: response.txHash })
        }
      )
    })
  }

  async function removeAsset(
    code: string,
    issuer: string
  ): Promise<{ txHash?: string; error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: SERVICE_TYPES.REMOVE_TRUSTLINE,
          trustline: { assetCode: code, assetIssuer: issuer },
          horizonUrl,
          networkPassphrase,
        },
        async (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: 'Extension error' })
            return
          }
          if (response?.error) {
            resolve({ error: response.error })
            return
          }
          const current = await getStoredAssets(networkId, account)
          const updated = current.filter((a) => !(a.code === code && a.issuer === issuer))
          await chrome.storage.local.set({ [customAssetsKey(networkId, account)]: updated })
          setAssets(updated)
          resolve({ txHash: response.txHash })
        }
      )
    })
  }

  return { assets, addAsset, removeAsset }
}
