import { useState, useEffect, useCallback } from 'react'
import { SERVICE_TYPES } from '@constants/services'

export interface CustomAsset {
  code: string
  issuer: string
  domain?: string
}

function customAssetsKey(networkId: string): string {
  return `cyphras_custom_assets_${networkId}`
}

function getStoredAssets(networkId: string): Promise<CustomAsset[]> {
  const key = customAssetsKey(networkId)
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const data = result[key]
      resolve(Array.isArray(data) ? (data as CustomAsset[]) : [])
    })
  })
}

export function useCustomAssets(networkId: string, horizonUrl: string, networkPassphrase: string) {
  const [assets, setAssets] = useState<CustomAsset[]>([])

  const loadAssets = useCallback(() => {
    getStoredAssets(networkId).then(setAssets)
  }, [networkId])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  async function addAsset(asset: CustomAsset): Promise<{ txHash?: string; error?: string }> {
    const current = await getStoredAssets(networkId)
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
          await chrome.storage.local.set({ [customAssetsKey(networkId)]: updated })
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
          const current = await getStoredAssets(networkId)
          const updated = current.filter((a) => !(a.code === code && a.issuer === issuer))
          await chrome.storage.local.set({ [customAssetsKey(networkId)]: updated })
          setAssets(updated)
          resolve({ txHash: response.txHash })
        }
      )
    })
  }

  return { assets, addAsset, removeAsset }
}
