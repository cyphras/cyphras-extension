import type { NetworkConfig, ShieldedConfig } from '@constants/networks'
import type { ShieldedDeployment } from './deployments'

// The deployment a network's pool opens: one whose vault the SDK release pins, on the shipped
// network that vault lives on, by name and passphrase. So the network the wallet shows is always
// where private funds move, and a custom network never reaches a vault.
export function pinnedPool(
  net: NetworkConfig,
  pool: ShieldedConfig,
  deployments: Readonly<Record<string, ShieldedDeployment>>
): ShieldedDeployment | undefined {
  const pinned = deployments[pool.deployment]
  if (!pinned) return undefined
  const { network, networkPassphrase } = pinned.deployment
  return net.id === network && net.passphrase === networkPassphrase ? pinned : undefined
}
