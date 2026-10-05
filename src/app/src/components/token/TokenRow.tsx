import { AssetIcon } from '@/components/token/AssetIcon'
import { PixelMask } from '@/components/Pixel'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { cn } from '@/lib/utils'

export interface TokenRowProps {
  code: string
  verified: boolean
  icon?: string
  chainIcons?: Array<string | undefined>
  masked: boolean
  balanceText: string
  valueText: string | null
  priceText: string | null
  changePct?: number | null
  // Replaces the balance line, e.g. "Not activated".
  note?: string
  // Under the balance line, e.g. what of a private balance is still in flight.
  detail?: string
  className?: string
  onClick: () => void
}

export function TokenRow({
  code,
  verified,
  icon,
  chainIcons,
  masked,
  balanceText,
  valueText,
  priceText,
  changePct = null,
  note,
  detail,
  className,
  onClick,
}: TokenRowProps) {
  return (
    <button
      className={cn(
        'group cursor-pointer flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 hover:bg-muted/60 transition-colors text-left',
        className
      )}
      onClick={onClick}
    >
      <div className="flex min-w-0 items-center gap-3">
        <AssetIcon code={code} icon={icon} chainIcons={chainIcons} />
        <div className="flex min-w-0 flex-col">
          <p className="flex items-center gap-1 text-[15px] font-medium text-foreground">
            <span className="truncate">{code}</span>
            {verified && <VerifiedBadge />}
          </p>
          {note ? (
            <p className="text-[13px] text-amber-600 dark:text-amber-400">{note}</p>
          ) : (
            <p className="text-[13px] text-muted-foreground tracking-wider tabular-nums">
              {masked ? <PixelMask count={4} size="sm" /> : balanceText}
            </p>
          )}
          {detail && !masked && (
            <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">{detail}</p>
          )}
        </div>
      </div>
      <div className="text-right">
        {masked ? (
          <p className="text-[15px] text-foreground">
            <PixelMask count={4} size="sm" />
          </p>
        ) : valueText !== null ? (
          <p className="text-[15px] text-foreground tabular-nums">{valueText}</p>
        ) : (
          <p className="text-[13px] text-muted-foreground">-</p>
        )}
        {priceText !== null && (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {priceText}
            {changePct !== null && (
              <span className={`ml-1.5 ${changePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
            )}
          </p>
        )}
      </div>
    </button>
  )
}
