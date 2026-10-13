import type { NetworkConfig, ShieldedConfig } from '@constants/networks'
import type { ShieldedDeployment } from './deployments'

// A pool opens only the vault the SDK pins, on its shipped network matched by name and passphrase,
// so funds move only on the network shown and a custom network never reaches a vault.
export function pinnedPool(
  net: NetworkConfig,
  pool: ShieldedConfig,
  deployments: Readonly<Record<string, ShieldedDeployment>>
): ShieldedDeployment | undefined {
  const pinned = deployments[pool.deployment]
  if (!pinned || !net.isDefault) return undefined
  const { network, networkPassphrase } = pinned.deployment
  return net.id === network && net.passphrase === networkPassphrase ? pinned : undefined
}
