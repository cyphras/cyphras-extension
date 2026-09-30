import { StellarAvatar } from '@/components/StellarAvatar'
import { useAvatarKey } from '@/hooks/useAvatarKey'

export function AddressAvatar({ address, chainIcon }: { address: string; chainIcon?: string }) {
  const avatarKey = useAvatarKey()
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <StellarAvatar publicKey={avatarKey(address)} size={32} />
      {chainIcon && (
        <span className="absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] overflow-hidden rounded-full border-[1.5px] border-card">
          <img src={chainIcon} alt="" className="h-full w-full object-cover" />
        </span>
      )}
    </span>
  )
}
