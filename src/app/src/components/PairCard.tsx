import type { ReactNode } from 'react'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { VerifiedMark } from '@/components/token/VerifiedMark'
import { ArrowUpDown, ChevronDown } from 'lucide-react'
import { AssetIcon } from '@/components/token/AssetIcon'
import { sanitizeAmountInput } from '@/lib/amount'
import { Reveal } from '@/components/Collapse'

export interface SideCardChip {
  code?: string // absent = nothing picked yet
  issuer?: string
  // Overrides the list lookup where the protocol guarantees the token.
  verified?: boolean
  icon?: string
  chainIcon?: string
  subLabel?: string
  onPick: () => void
  ariaLabel: string
}

export function SideCard({
  label,
  corner,
  chip,
  value,
  footAmount,
  footAsset,
  error,
}: {
  label: string
  corner?: ReactNode
  chip: SideCardChip
  value: ReactNode
  // Under the amount, e.g. its fiat value.
  footAmount?: ReactNode
  // Under the chip, e.g. quick fills or a minimum.
  footAsset?: ReactNode
  error?: string | null
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl bg-card px-4 py-3 ${error ? 'ring-1 ring-destructive/60' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="pixel-label text-[10px]">{label}</span>
        <span className="min-w-0 truncate">{corner}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{value}</div>
        <button
          type="button"
          onClick={chip.onPick}
          aria-label={chip.ariaLabel}
          className="group flex shrink-0 cursor-pointer items-center gap-2.5 rounded-full bg-muted py-1.5 pl-1.5 pr-3 transition-colors [--icon-ring:var(--muted)] hover:bg-[color-mix(in_oklab,var(--muted)_60%,var(--card))]"
        >
          {chip.code ? (
            <>
              <AssetIcon
                code={chip.code}
                icon={chip.icon}
                chainIcons={chip.chainIcon ? [chip.chainIcon] : []}
                size="xs"
              />
              <span className="text-left leading-tight">
                <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {chip.code}
                  {chip.verified ? (
                    <VerifiedBadge />
                  ) : (
                    <VerifiedMark code={chip.code} issuer={chip.issuer} />
                  )}
                </span>
                {chip.subLabel && (
                  <span className="block text-[10px] text-muted-foreground">
                    on {chip.subLabel}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="px-2 py-2 text-sm font-medium text-foreground">Select asset</span>
          )}
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      </div>
      <div className="flex min-h-[20px] items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{footAmount}</span>
        <span className="shrink-0">{footAsset}</span>
      </div>
      <Reveal show={!!error} gap={8}>
        <p className="text-xs text-destructive">{error}</p>
      </Reveal>
    </div>
  )
}

// Long figures (a Max with seven decimals) step the size down instead of
// clipping, so the whole amount is always readable.
function amountSize(text: string): string {
  if (text.length > 13) return 'text-lg'
  if (text.length > 10) return 'text-xl'
  if (text.length > 7) return 'text-2xl'
  return 'text-3xl'
}

// Text, not number: a number input changes value on mouse wheel and renders
// the OS locale's comma; digits and one dot are all it takes.
export function AmountInput({
  value,
  onChange,
  prefix,
}: {
  value: string
  onChange: (v: string) => void
  prefix?: string
}) {
  const size = amountSize(`${prefix ?? ''}${value}`)
  return (
    <span className="flex items-baseline">
      {prefix && (
        <span
          className={`${size} font-bold ${value ? 'text-foreground' : 'text-muted-foreground/40'}`}
        >
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        aria-label={prefix ? 'Amount in USD' : 'Amount'}
        value={value}
        onChange={(e) => {
          const v = sanitizeAmountInput(e.target.value)
          if (v !== null) onChange(v)
        }}
        className={`w-full min-w-0 border-none bg-transparent text-left ${size} font-bold tabular-nums text-foreground outline-none transition-[font-size] placeholder:text-muted-foreground/40`}
      />
    </span>
  )
}

// The other unit under the amount; tapping it swaps which one is typed.
export function FiatSwitch({
  text,
  onToggle,
  enabled,
}: {
  text: string
  onToggle: () => void
  enabled: boolean
}) {
  if (!enabled) return <>{text}</>
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Switch between token and USD amount"
      className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
    >
      {text}
      <ArrowUpDown size={11} />
    </button>
  )
}

export function AmountValue({ text, muted }: { text: string; muted: boolean }) {
  return (
    <p
      key={text}
      className={`value-enter truncate text-left ${amountSize(text)} font-bold tabular-nums ${muted ? 'text-muted-foreground/40' : 'text-foreground'}`}
    >
      {text}
    </p>
  )
}

// max: false leaves Max out until the page knows what Max is.
export function QuickFillChips({
  onFill,
  max = true,
}: {
  onFill: (fraction: number) => void
  max?: boolean
}) {
  return (
    <span className="flex gap-1">
      {([['25%', 0.25], ['50%', 0.5], ...(max ? ([['Max', 1]] as const) : [])] as const).map(
        ([label, f]) => (
          <button
            key={label}
            type="button"
            onClick={() => onFill(f)}
            className="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-muted/70"
          >
            {label}
          </button>
        )
      )}
    </span>
  )
}
