import { useState, useEffect, useCallback } from 'react'

export interface EvmWatchAsset {
  chain: string // CAIP-2
  address: string
  symbol: string
  decimals: number
}

// EVM "add token" is a client-side watch entry, no transaction; scoped per network and
// account like Stellar trustline-tracked assets.
export function evmWatchKey(networkId: string, account: string): string {
  return `cyphras_evm_watch_${networkId}_${account}`
}

function getStored(networkId: string, account: string): Promise<EvmWatchAsset[]> {
  const key = evmWatchKey(networkId, account)
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const data = result[key]
      resolve(Array.isArray(data) ? (data as EvmWatchAsset[]) : [])
    })
  })
}

export function useEvmWatchAssets(networkId: string, account: string) {
  const [assets, setAssets] = useState<EvmWatchAsset[]>([])

  const load = useCallback(() => {
    if (!account) {
      setAssets([])
      return
    }
    getStored(networkId, account).then(setAssets)
  }, [networkId, account])

  useEffect(load, [load])

  const addAsset = useCallback(
    async (asset: EvmWatchAsset) => {
      const current = await getStored(networkId, account)
      if (
        current.some(
          (a) => a.chain === asset.chain && a.address.toLowerCase() === asset.address.toLowerCase()
        )
      ) {
        return
      }
      const next = [...current, asset]
      await chrome.storage.local.set({ [evmWatchKey(networkId, account)]: next })
      setAssets(next)
    },
    [networkId, account]
  )

  const removeAsset = useCallback(
    async (chain: string, address: string) => {
      const current = await getStored(networkId, account)
      const next = current.filter(
        (a) => !(a.chain === chain && a.address.toLowerCase() === address.toLowerCase())
      )
      await chrome.storage.local.set({ [evmWatchKey(networkId, account)]: next })
      setAssets(next)
    },
    [networkId, account]
  )

  return { assets, addAsset, removeAsset, refresh: load }
}
