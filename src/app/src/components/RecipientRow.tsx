import { AddressAvatar } from '@/components/AddressAvatar'
import { shortAddress } from '@/lib/address'

export function RecipientRow({
  address,
  label,
  networkName,
  chainIcon,
  onChange,
}: {
  address: string
  label?: string
  networkName: string
  chainIcon?: string
  onChange?: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <AddressAvatar address={address} chainIcon={chainIcon} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {label ?? shortAddress(address)}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {label ? `${shortAddress(address)} on ${networkName}` : `on ${networkName}`}
        </p>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 cursor-pointer rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
        >
          Change
        </button>
      )}
    </div>
  )
}
