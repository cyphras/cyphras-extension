import { DEFAULT_NETWORKS, NETWORK_STORAGE_KEY, ACTIVE_NETWORK_KEY } from '@constants/networks'
import type { NetworkConfig } from '@constants/networks'

function validateNetworkConfig(network: NetworkConfig): string | null {
  if (!network.id || typeof network.id !== 'string') return 'Network ID is required'
  if (!network.name || typeof network.name !== 'string') return 'Network name is required'
  if (!network.passphrase || typeof network.passphrase !== 'string')
    return 'Network passphrase is required'

  for (const field of ['horizonUrl', 'sorobanRpcUrl'] as const) {
    const url = network[field]
    if (!url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') return `${field} must use HTTPS`
    } catch {
      return `${field} is not a valid URL`
    }
  }

  if (network.friendbotUrl) {
    try {
      const parsed = new URL(network.friendbotUrl)
      if (parsed.protocol !== 'https:') return 'friendbotUrl must use HTTPS'
    } catch {
      return 'friendbotUrl is not a valid URL'
    }
  }

  if (network.explorerUrl) {
    try {
      const parsed = new URL(network.explorerUrl)
      if (parsed.protocol !== 'https:') return 'explorerUrl must use HTTPS'
    } catch {
      return 'explorerUrl is not a valid URL'
    }
  }

  if (
    network.txTimeout !== undefined &&
    (typeof network.txTimeout !== 'number' || network.txTimeout < 30 || network.txTimeout > 300)
  ) {
    return 'txTimeout must be between 30 and 300 seconds'
  }

  return null
}

function migrateNetwork(n: Partial<NetworkConfig> & { id: string }): NetworkConfig {
  const defaults = DEFAULT_NETWORKS.find((d) => d.id === n.id)
  return {
    id: n.id,
    name: n.name ?? n.id,
    horizonUrl: n.horizonUrl ?? '',
    sorobanRpcUrl: n.sorobanRpcUrl ?? '',
    passphrase: n.passphrase ?? '',
    friendbotUrl: n.friendbotUrl ?? '',
    explorerUrl: n.explorerUrl ?? defaults?.explorerUrl,
    txTimeout: n.txTimeout ?? defaults?.txTimeout ?? 90,
    isDefault: n.isDefault ?? false,
    // For built-in networks the shipped defaults override stored values, so a stale or tampered
    // entry cannot redirect private payments. Custom networks (no defaults) keep their own.
    privatePoolFactory: defaults?.privatePoolFactory ?? n.privatePoolFactory,
    relayerUrl: defaults?.relayerUrl ?? n.relayerUrl,
    privateAssets: defaults?.privateAssets ?? n.privateAssets,
    // Only the shipped defaults can enable private mode; stored values never do
    shielded: defaults ? defaults.shielded : undefined,
  }
}

export async function getNetworks(): Promise<NetworkConfig[]> {
  const result = await chrome.storage.local.get(NETWORK_STORAGE_KEY)
  if (!result[NETWORK_STORAGE_KEY]) {
    await chrome.storage.local.set({ [NETWORK_STORAGE_KEY]: DEFAULT_NETWORKS })
    return DEFAULT_NETWORKS
  }
  return (result[NETWORK_STORAGE_KEY] as Partial<NetworkConfig>[]).map((n) =>
    migrateNetwork(n as Partial<NetworkConfig> & { id: string })
  )
}

export async function getActiveNetwork(): Promise<NetworkConfig> {
  const networks = await getNetworks()
  const result = await chrome.storage.local.get(ACTIVE_NETWORK_KEY)
  const activeId = result[ACTIVE_NETWORK_KEY] ?? 'mainnet'
  return networks.find((n) => n.id === activeId) ?? networks[0]
}

export async function setActiveNetwork(networkId: string): Promise<void> {
  const networks = await getNetworks()
  if (!networks.find((n) => n.id === networkId)) throw new Error('Network not found')
  await chrome.storage.local.set({ [ACTIVE_NETWORK_KEY]: networkId })
}

export async function addNetwork(network: NetworkConfig): Promise<NetworkConfig[]> {
  const error = validateNetworkConfig(network)
  if (error) throw new Error(error)

  const networks = await getNetworks()
  if (networks.find((n) => n.id === network.id || n.name === network.name)) {
    throw new Error('A network with this ID or name already exists')
  }

  // Strip shielded so a user-added network can never carry a private-mode block
  const { shielded: _addShielded, ...addClean } = network
  const updated = [
    ...networks,
    { ...addClean, txTimeout: network.txTimeout ?? 90, isDefault: false },
  ]
  await chrome.storage.local.set({ [NETWORK_STORAGE_KEY]: updated })
  return updated
}

export async function editNetwork(network: NetworkConfig): Promise<NetworkConfig[]> {
  const error = validateNetworkConfig(network)
  if (error) throw new Error(error)

  const networks = await getNetworks()
  const existing = networks.find((n) => n.id === network.id)
  if (!existing) throw new Error('Network not found')

  // Strip shielded so an edit cannot inject a private-mode block; defaults re-apply it on read
  const { shielded: _editShielded, ...editClean } = network
  const updated = networks.map((n) =>
    n.id === network.id
      ? { ...editClean, txTimeout: network.txTimeout ?? 90, isDefault: n.isDefault }
      : n
  )
  await chrome.storage.local.set({ [NETWORK_STORAGE_KEY]: updated })
  return updated
}

export async function removeNetwork(networkId: string): Promise<NetworkConfig[]> {
  const networks = await getNetworks()
  const target = networks.find((n) => n.id === networkId)
  if (!target) throw new Error('Network not found')
  if (target.isDefault) throw new Error('Cannot remove a default network')
  const updated = networks.filter((n) => n.id !== networkId)
  await chrome.storage.local.set({ [NETWORK_STORAGE_KEY]: updated })
  return updated
}
