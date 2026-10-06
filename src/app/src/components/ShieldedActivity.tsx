import { ActivityRow } from '@/components/ActivityRow'
import { PrivateActions } from '@/components/PrivateActions'
import { hasActions } from '@/lib/privateActivity'
import type { PrivateEntry } from '@/lib/privateHistory'
import type { ShieldedPlanView } from '@ext-types/index'

const SHOWN = 5

// The newest private entries on Home, in the rows of public history. One that is still on its way
// or waits on the user says what is happening beneath its row, with what the user can do about it.
export default function ShieldedActivity({
  entries,
  poolId,
  icon,
  chainIcon,
  fiatOf,
  onSelect,
  onRetry,
  onChanged,
  onSeeAll,
}: {
  entries: PrivateEntry[]
  poolId: string
  icon?: string
  chainIcon?: string
  fiatOf: (entry: PrivateEntry) => string | null
  onSelect: (entry: PrivateEntry) => void
  onRetry: (plan: ShieldedPlanView) => void
  onChanged: () => void
  onSeeAll: () => void
}) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <p className="pixel-label text-[10px] text-muted-foreground">Private activity</p>
        <button
          onClick={onSeeAll}
          className="cursor-pointer text-xs font-medium text-primary hover:underline"
        >
          See all
        </button>
      </div>
      {entries.slice(0, SHOWN).map((entry, i) => {
        const open = entry.status.stage !== 'done'
        return (
          <div
            key={entry.item.id}
            className={`row-enter ${open ? 'overflow-hidden rounded-xl bg-card' : ''}`}
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
          >
            <ActivityRow
              view={entry.view}
              timestamp={entry.timestamp}
              icon={icon}
              chainIcon={chainIcon}
              fiat={fiatOf(entry)}
              counterpartyText={entry.counterpartyText}
              className={open ? 'rounded-none' : undefined}
              onClick={() => onSelect(entry)}
            />
            {open && (entry.status.detail || hasActions(entry.plan, entry.deposit)) && (
              <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-2.5">
                {entry.status.detail && (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {entry.status.detail}
                  </p>
                )}
                <PrivateActions
                  plan={entry.plan}
                  deposit={entry.deposit}
                  poolId={poolId}
                  onRetry={onRetry}
                  onChanged={onChanged}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
