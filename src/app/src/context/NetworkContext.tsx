import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { SERVICE_TYPES } from '@constants/services'
import type { NetworkConfig } from '@constants/networks'
import { DEFAULT_NETWORKS, ACTIVE_NETWORK_KEY, NETWORK_STORAGE_KEY } from '@constants/networks'

interface NetworkContextValue {
  networks: NetworkConfig[]
  activeNetwork: NetworkConfig
  loading: boolean
  setActiveNetwork: (networkId: string) => Promise<void>
  addNetwork: (network: NetworkConfig) => Promise<{ error?: string }>
  editNetwork: (network: NetworkConfig) => Promise<{ error?: string }>
  removeNetwork: (networkId: string) => Promise<{ error?: string }>
  refreshNetworks: () => void
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [networks, setNetworks] = useState<NetworkConfig[]>(DEFAULT_NETWORKS)
  const [activeNetwork, setActiveNetworkState] = useState<NetworkConfig>(DEFAULT_NETWORKS[0])
  const [loading, setLoading] = useState(true)

  // A popup opened while the service worker starts can get no usable answer;
  // retry rather than stay on the default (mainnet) while the background runs testnet.
  const refreshNetworks = useCallback((attempt = 0) => {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_NETWORKS }, (response) => {
      // While the worker boots, another listener (offscreen document, window-message
      // fallback) can reply first without a network; that is not the answer yet.
      if (chrome.runtime.lastError || !response?.activeNetwork) {
        if (attempt < 12)
          setTimeout(() => refreshNetworks(attempt + 1), Math.min(250 * (attempt + 1), 1500))
        return
      }
      if (response.networks) setNetworks(response.networks)
      if (response.activeNetwork) setActiveNetworkState(response.activeNetwork)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    refreshNetworks()
    // Keeps popup, side panel and tab on the same network when any of them
    // (or the background) switches it.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && (ACTIVE_NETWORK_KEY in changes || NETWORK_STORAGE_KEY in changes))
        refreshNetworks()
    }
    chrome.storage.onChanged.addListener(onChanged)
    // Re-check when the popup or side panel is shown again, so a missed update
    // corrects itself instead of lasting the whole session.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshNetworks()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      chrome.storage.onChanged.removeListener(onChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshNetworks])

  async function setActiveNetwork(networkId: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: SERVICE_TYPES.SET_ACTIVE_NETWORK, networkId },
        (response) => {
          if (chrome.runtime.lastError) return resolve()
          if (response?.activeNetwork) setActiveNetworkState(response.activeNetwork)
          resolve()
        }
      )
    })
  }

  async function addNetwork(network: NetworkConfig): Promise<{ error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.ADD_NETWORK, network }, (response) => {
        if (chrome.runtime.lastError) return resolve({ error: 'Extension error' })
        if (response?.error) return resolve({ error: response.error })
        if (response?.networks) setNetworks(response.networks)
        resolve({})
      })
    })
  }

  async function editNetwork(network: NetworkConfig): Promise<{ error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.EDIT_NETWORK, network }, (response) => {
        if (chrome.runtime.lastError) return resolve({ error: 'Extension error' })
        if (response?.error) return resolve({ error: response.error })
        if (response?.networks) setNetworks(response.networks)
        resolve({})
      })
    })
  }

  async function removeNetwork(networkId: string): Promise<{ error?: string }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.REMOVE_NETWORK, networkId }, (response) => {
        if (chrome.runtime.lastError) return resolve({ error: 'Extension error' })
        if (response?.error) return resolve({ error: response.error })
        if (response?.networks) setNetworks(response.networks)
        if (response?.activeNetwork) setActiveNetworkState(response.activeNetwork)
        resolve({})
      })
    })
  }

  return (
    <NetworkContext.Provider
      value={{
        networks,
        activeNetwork,
        loading,
        setActiveNetwork,
        addNetwork,
        editNetwork,
        removeNetwork,
        refreshNetworks,
      }}
    >
      {children}
    </NetworkContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook lives with its provider
export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider')
  return ctx
}
