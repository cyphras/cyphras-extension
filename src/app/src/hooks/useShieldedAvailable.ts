import { useEffect, useState } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { useWallet } from '@/context/WalletContext'
import { getIconMap } from '@/hooks/useBalances'
import type { NetworkConfig, ShieldedConfig } from '@constants/networks'

export interface ShieldedPoolOption {
  poolId: string
  label: string
  decimals: number
  native: boolean
  assetCode?: string
  assetIssuer?: string
  icon?: string
}

interface ShieldedAvailability {
  available: boolean
  pools: ShieldedPoolOption[]
  // The networks private mode runs on, for a network without it to point to.
  privateNetworks: NetworkConfig[]
}

// Private mode runs where the background gives the network pools, which it does only for a vault
// the SDK release pins there, and needs an HD account since shielded spend keys derive from the
// seed phrase.
export function useShieldedAvailable(): ShieldedAvailability {
  const { activeNetwork, networks, loading } = useNetwork()
  const { accounts, activePublicKey } = useWallet()

  // Pool icons come from the curated asset list, like every other token image.
  const [icons, setIcons] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let cancelled = false
    getIconMap(activeNetwork.id).then((m) => {
      if (!cancelled) setIcons(m)
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])

  const active = accounts.find((a) => a.publicKey === activePublicKey)
  const isHdAccount = !!active && active.index >= 0 && !active.walletId.startsWith('sk:')

  // Until the background answers, the network is the shipped default with every pool it lists,
  // including ones the background would refuse.
  const shielded = !loading && Array.isArray(activeNetwork.shielded) ? activeNetwork.shielded : []
  const available = shielded.length > 0 && isHdAccount

  const pools: ShieldedPoolOption[] = shielded.map((p: ShieldedConfig) => ({
    poolId: p.poolId,
    label: p.label,
    decimals: p.decimals,
    native: p.native,
    assetCode: p.assetCode,
    assetIssuer: p.assetIssuer,
    icon: p.native ? undefined : icons.get(`${p.assetCode}:${p.assetIssuer}`),
  }))

  const privateNetworks = networks.filter((n) => (n.shielded?.length ?? 0) > 0)

  return { available, pools, privateNetworks }
}
