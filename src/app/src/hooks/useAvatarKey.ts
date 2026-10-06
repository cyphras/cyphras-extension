import { useCallback } from 'react'
import { useWallet } from '@/context/WalletContext'
import { identiconKeyFor } from '@/lib/address'

// Any address of a wallet account (Stellar key, EVM or Bitcoin address) draws that
// account's identicon, so one account always shows one face; other addresses get their own.
export function useAvatarKey(): (address: string) => string {
  const { accounts } = useWallet()
  return useCallback(
    (address: string) => {
      const lower = address.toLowerCase()
      const own = accounts.find(
        (a) =>
          a.publicKey === address ||
          a.addresses?.evm?.toLowerCase() === lower ||
          a.addresses?.bitcoin === lower ||
          a.addresses?.bitcoinTestnet === lower
      )
      return own ? own.publicKey : identiconKeyFor(address)
    },
    [accounts]
  )
}
