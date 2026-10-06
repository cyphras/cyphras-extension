import { useEffect, useState } from 'react'
import { useNetwork } from '@/context/NetworkContext'
import { getChainInfo } from '@/lib/chainInfo'

// The active Stellar network as the chain registry names it ("Stellar Mainnet"): a bare
// "Mainnet" is ambiguous next to EVM networks.
export function useStellarChain(): { name: string; icon?: string } {
  const { activeNetwork } = useNetwork()
  const [info, setInfo] = useState<{ name: string; icon?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getChainInfo(activeNetwork.id).then((c) => {
      if (!cancelled) setInfo(c ? { name: c.name, icon: c.icon } : null)
    })
    return () => {
      cancelled = true
    }
  }, [activeNetwork.id])

  return info ?? { name: `Stellar ${activeNetwork.name}` }
}
