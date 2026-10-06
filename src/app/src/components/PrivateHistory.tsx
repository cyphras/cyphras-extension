import { useEffect } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { ActivityRow } from '@/components/ActivityRow'
import { Alert } from '@/components/Alert'
import { HistoryEmpty, HistoryGroups, HistorySkeleton } from '@/components/HistoryList'
import { Button } from '@/components/ui/button'
import { PrivatePage } from '@/components/PrivatePage'
import { groupRowsByDate } from '@/lib/activity'
import type { PrivateEntry } from '@/lib/privateHistory'

// Private mode's history page: the public History page's rows, date groups, skeleton and empty
// state over the private entries. It opens over Home, which keeps private mode on beneath it.
export function PrivateHistory({
  open,
  entries,
  loading,
  error,
  icon,
  chainIcon,
  fiatOf,
  onSelect,
  onRefresh,
  onShield,
  onClose,
}: {
  open: boolean
  entries: PrivateEntry[] | null
  loading: boolean
  error: string | null
  icon?: string
  chainIcon?: string
  fiatOf: (entry: PrivateEntry) => string | null
  onSelect: (entry: PrivateEntry) => void
  onRefresh: () => void
  onShield: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  return (
    <PrivatePage open={open} onHistory={() => undefined}>
      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-5">
        <div className="flex flex-col gap-4">
          <div className="relative flex items-center justify-center">
            <button
              onClick={onClose}
              aria-label="Go back"
              className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-foreground">History</h2>
            <button
              onClick={onRefresh}
              aria-label="Refresh history"
              className="absolute right-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {entries === null && !error && <HistorySkeleton />}

          {error && <Alert message={error} onRetry={onRefresh} retrying={loading} />}

          {entries !== null && entries.length === 0 && (
            <HistoryEmpty
              title="No private activity yet"
              subtitle="Shields, payments and what you receive privately will appear here"
              action={
                <Button variant="outline" onClick={onShield}>
                  Shield
                </Button>
              }
            />
          )}

          {entries !== null && (
            <HistoryGroups
              groups={groupRowsByDate(entries)}
              groupKey={(label) => label}
              renderRow={(entry) => (
                <ActivityRow
                  key={entry.item.id}
                  view={entry.view}
                  timestamp={entry.timestamp}
                  icon={icon}
                  chainIcon={chainIcon}
                  fiat={fiatOf(entry)}
                  counterpartyText={entry.counterpartyText}
                  onClick={() => onSelect(entry)}
                />
              )}
            />
          )}
        </div>
      </div>
    </PrivatePage>
  )
}
