import type { ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUpDown, ChevronsRight } from 'lucide-react'
import { AssetIcon } from '@/components/token/AssetIcon'
import { BottomSheet } from '@/components/BottomSheet'
import { Button } from '@/components/ui/button'
import { formatFiat } from '@/lib/activity'
import { TokenStatusIcon } from '@/components/TxDetailParts'
import { LOSS_WARN_PCT, formatPct } from '@/lib/valueChange'

// Only a loss is shown: a "gain" against reference prices is a stale or
// mismatched price far more often than a real bargain.
export function ValueChangeText({ pct }: { pct: number | null }) {
  if (pct === null || pct > -0.01) return null
  const tone =
    pct <= -LOSS_WARN_PCT
      ? 'text-destructive'
      : pct <= -1
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground'
  return <span className={`tabular-nums ${tone}`}>({formatPct(pct)})</span>
}

export function LossWarning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 px-1 text-xs leading-snug text-destructive">
      <AlertTriangle size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function LossSheet({
  open,
  title,
  message,
  beforeUsd,
  afterUsd,
  beforeLabel = 'Before',
  afterLabel = 'After',
  proceedLabel,
  onProceed,
  onCancel,
  zIndex,
}: {
  open: boolean
  title: string
  message: ReactNode
  beforeUsd: number
  afterUsd: number
  beforeLabel?: string
  afterLabel?: string
  proceedLabel: string
  onProceed: () => void
  onCancel: () => void
  zIndex?: string
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onCancel} zIndex={zIndex}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle size={22} />
          </span>
          <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl bg-card px-3 py-3 text-center">
            <p className="text-xs text-muted-foreground">{beforeLabel}</p>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatFiat(beforeUsd)}
            </p>
          </div>
          <ChevronsRight size={20} className="shrink-0 text-muted-foreground" />
          <div className="flex-1 rounded-xl bg-card px-3 py-3 text-center">
            <p className="text-xs text-muted-foreground">{afterLabel}</p>
            <p className="text-lg font-bold tabular-nums text-destructive">
              {formatFiat(afterUsd)}
            </p>
          </div>
        </div>
        {/* the safe choice is the prominent one */}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onProceed}>
            {proceedLabel}
          </Button>
          <Button className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}

export interface TradeLeg {
  label: string
  code: string
  icon?: string
  chainIcon?: string
  amount: ReactNode
  usd: number | null
  pct?: number | null
  muted?: boolean
  positive?: boolean
  // Draws the leg's token with a status: spinning while it moves, a check once it lands.
  status?: 'pending' | 'success'
}

function LegRow({ leg }: { leg: TradeLeg }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {leg.status ? (
        <TokenStatusIcon
          state={leg.status}
          code={leg.code}
          icon={leg.icon}
          chainIcon={leg.chainIcon}
          className="-m-1"
        />
      ) : (
        <AssetIcon code={leg.code} icon={leg.icon} chainIcons={[leg.chainIcon]} size="lg" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{leg.label}</p>
        <p
          className={`truncate text-lg font-bold tabular-nums ${leg.muted ? 'text-muted-foreground' : leg.positive ? 'text-green-500' : 'text-foreground'}`}
        >
          {leg.amount} <span className="text-sm font-medium text-muted-foreground">{leg.code}</span>
        </p>
        {leg.usd !== null && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatFiat(leg.usd)} <ValueChangeText pct={leg.pct ?? null} />
          </p>
        )}
      </div>
    </div>
  )
}

export function TradeLegs({
  pay,
  receive,
  flowing = false,
  className = '',
}: {
  pay: TradeLeg
  receive: TradeLeg
  // While the trade is in flight the arrow keeps moving from pay to receive.
  flowing?: boolean
  className?: string
}) {
  return (
    <div className={`rounded-xl bg-card ${className}`}>
      <LegRow leg={pay} />
      <div className="relative">
        <div className={`mx-4 h-px ${flowing ? 'bg-primary/30' : 'bg-border'}`} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="bg-card px-1.5">
            <ArrowDown
              size={12}
              className={flowing ? 'flow-down text-primary' : 'text-muted-foreground/60'}
            />
          </span>
        </div>
      </div>
      <LegRow leg={receive} />
    </div>
  )
}

// Its own row between the two side cards, clear of their content. The whole
// pill flips the pair; the rate it shows follows the new direction.
export function RatePill({
  text,
  onFlip,
  flipDisabled = false,
}: {
  text?: string
  onFlip: () => void
  flipDisabled?: boolean
}) {
  return (
    <button
      onClick={onFlip}
      disabled={flipDisabled}
      aria-label="Swap direction"
      className="group flex max-w-full cursor-pointer items-center gap-1.5 self-center rounded-full bg-card p-0.5 shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="shrink-0 rounded-full bg-muted p-1.5 text-muted-foreground transition-all group-hover:rotate-180 group-hover:text-foreground group-disabled:rotate-0">
        <ArrowUpDown size={13} />
      </span>
      {text && (
        <span className="min-w-0 truncate pr-2.5 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors group-hover:text-foreground">
          {text}
        </span>
      )}
    </button>
  )
}
