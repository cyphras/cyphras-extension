import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

// The pieces of a history page: rows while it loads, the empty state, and rows under sticky date
// headers, so every history list reads the same.

export function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 px-1 py-2">
        <Skeleton className="h-2.5 w-20 rounded" />
        <div className="h-px flex-1 bg-border" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
          <div className="relative shrink-0">
            <Skeleton className="h-10 w-10 rounded-full" />
            <span className="absolute -bottom-1 -right-0.5 h-[21px] w-[21px] rounded-full border-[1.5px] border-card bg-muted" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-28 rounded" />
            <Skeleton className="h-3 w-36 rounded" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-3.5 w-16 rounded" />
            <Skeleton className="h-3 w-10 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HistoryEmpty({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Inbox size={24} className="text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

export function HistoryGroups<T>({
  groups,
  groupKey,
  renderRow,
}: {
  groups: { label: string; rows: T[] }[]
  // Keyed by the filter too, so a new filter replays the rise.
  groupKey: (label: string) => string
  renderRow: (row: T) => ReactNode
}) {
  return (
    <>
      {groups.map(({ label, rows }, gi) => (
        <div
          key={groupKey(label)}
          className="row-enter flex flex-col gap-2"
          style={{ animationDelay: `${Math.min(gi, 6) * 45}ms` }}
        >
          {/* -top-5 cancels the scroller's 20px top padding: at top-0 the header
              stuck 20px low and rows showed through the gap above it */}
          <div className="sticky -top-5 z-10 -mx-1 bg-background px-1 py-2">
            <div className="flex items-center gap-3 px-1">
              <p className="pixel-label text-[10px] text-muted-foreground whitespace-nowrap">
                {label}
              </p>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>
          {rows.map(renderRow)}
        </div>
      ))}
    </>
  )
}
