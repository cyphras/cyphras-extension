import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { SERVICE_TYPES } from '@constants/services'
import type { NetworkConfig } from '@constants/networks'
import { DEFAULT_NETWORKS } from '@constants/networks'

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

  const refreshNetworks = useCallback(() => {
    chrome.runtime.sendMessage({ type: SERVICE_TYPES.GET_NETWORKS }, (response) => {
      if (chrome.runtime.lastError) return
      if (response?.networks) setNetworks(response.networks)
      if (response?.activeNetwork) setActiveNetworkState(response.activeNetwork)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    refreshNetworks()
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

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider')
  return ctx
}
