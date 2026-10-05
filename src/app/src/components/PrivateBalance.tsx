import { ArrowDownToLine, ArrowUpFromLine, Send } from 'lucide-react'
import { BottomSheet } from '@/components/BottomSheet'
import { PixelMask } from '@/components/Pixel'
import { shortAddress } from '@/lib/address'
import { depositStatus, planStatus } from '@/lib/privateActivity'
import {
  PART_EXPLANATIONS,
  PART_LABELS,
  type BalanceItem,
  type BalancePartKey,
  type PrivateBalance,
} from '@/lib/privateBalance'
import type { ShieldedStatusView } from '@ext-types/index'

const PART_DOTS: Record<BalancePartKey, string> = {
  available: 'bg-green-500',
  sending: 'bg-primary',
  returning: 'bg-sky-400',
  screening: 'bg-amber-500',
  held: 'bg-destructive',
}

// Under the private balance: each part of it in plain words, a tap away from what is behind it.
export function PrivateBreakdown({
  balance,
  format,
  masked,
  onOpen,
}: {
  balance: PrivateBalance
  format: (units: bigint) => string
  masked: boolean
  onOpen: (key: BalancePartKey) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3">
      {balance.parts.map((part) => (
        <button
          key={part.key}
          onClick={() => onOpen(part.key)}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex cursor-pointer items-center gap-1.5 rounded-md text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${PART_DOTS[part.key]}`} />
          {PART_LABELS[part.key]}
          <span className="font-medium tabular-nums text-foreground">
            {masked ? <PixelMask count={3} size="sm" /> : format(part.amount)}
          </span>
        </button>
      ))}
    </div>
  )
}

// The parts of a private balance as the rows of a card, each a tap away from what is behind it.
export function PrivatePartRows({
  balance,
  format,
  fiat,
  onOpen,
}: {
  balance: PrivateBalance
  format: (units: bigint) => string
  fiat: (units: bigint) => string | null
  onOpen: (key: BalancePartKey) => void
}) {
  return (
    <div className="mb-4 divide-y divide-border rounded-xl bg-card">
      <p className="pixel-label px-4 pt-3 pb-2 text-[10px] text-muted-foreground">Balance</p>
      {balance.parts.map((part) => {
        const value = fiat(part.amount)
        return (
          <button
            key={part.key}
            onClick={() => onOpen(part.key)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
              <span className={`h-2 w-2 rounded-full ${PART_DOTS[part.key]}`} />
              {PART_LABELS[part.key]}
            </span>
            <span className="text-right">
              <span className="block text-sm font-medium tabular-nums text-foreground">
                {format(part.amount)}
              </span>
              {value && (
                <span className="block text-xs tabular-nums text-muted-foreground">{value}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function itemTitle(item: BalanceItem, unit: (units: bigint | string) => string): string {
  if (item.kind === 'deposit') return `Shield ${unit(item.deposit.amount)}`
  const p = item.plan
  return `${p.kind === 'send' ? 'Send' : 'Unshield'} ${unit(p.amount)} to ${shortAddress(p.to)}`
}

// What one part of the private balance is, and the deposits and payments that make it up.
export function PrivatePartSheet({
  part,
  balance,
  status,
  unit,
  onClose,
  onItem,
}: {
  part: BalancePartKey | null
  balance: PrivateBalance | null
  status: ShieldedStatusView | null
  unit: (units: bigint | string) => string
  onClose: () => void
  onItem: (item: BalanceItem) => void
}) {
  const shown = part && balance ? balance.parts.find((p) => p.key === part) : undefined
  return (
    <BottomSheet
      open={!!shown}
      onClose={onClose}
      title={
        shown && (
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${PART_DOTS[shown.key]}`} />
            {PART_LABELS[shown.key]}
          </span>
        )
      }
    >
      {shown && status && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-card px-4 py-5 text-center">
            <p className="text-2xl font-bold tabular-nums text-foreground">{unit(shown.amount)}</p>
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {PART_EXPLANATIONS[shown.key]}
            </p>
          </div>
          {shown.items.length > 0 && (
            <div className="flex flex-col gap-2">
              {shown.items.map((item) => {
                const s =
                  item.kind === 'deposit'
                    ? depositStatus(item.deposit)
                    : planStatus(item.plan, unit)
                const Icon =
                  item.kind === 'deposit'
                    ? ArrowDownToLine
                    : item.plan.kind === 'send'
                      ? Send
                      : ArrowUpFromLine
                return (
                  <button
                    key={item.kind === 'deposit' ? `d:${item.deposit.txHash}` : item.plan.planId}
                    onClick={() => onItem(item)}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-xl bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {itemTitle(item, unit)}
                      </span>
                      {s.detail && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {s.detail}
                        </span>
                      )}
                    </span>
                    {item.amount > 0n && (
                      <span className="shrink-0 text-sm tabular-nums text-foreground">
                        {unit(item.amount)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
