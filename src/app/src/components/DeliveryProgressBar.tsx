import { useNow } from '@/hooks/useNow'
import { deliveryProgress } from '@/lib/historyUtils'
import type { PrivateNote } from '@ext-types/index'

// One overall delivery bar: the fill advances with each split's ETA countdown so it moves during the
// wait and reaches full as the last split lands. A sheen sweeps the filled region while in flight.
export function DeliveryProgressBar({
  notes,
  className = '',
}: {
  notes: PrivateNote[]
  className?: string
}) {
  const active = notes.some(
    (n) => n.status === 'pending' || n.status === 'committed' || n.status === 'scheduled'
  )
  const now = useNow(1000, active)
  const progressRatio = deliveryProgress(notes, now)
  return (
    <div
      className={`relative flex h-1.5 w-full overflow-hidden rounded-full bg-muted ${className}`}
    >
      <div
        className="h-full bg-primary transition-[width] duration-1000 ease-linear"
        style={{
          width: `${progressRatio * 100}%`,
          minWidth: progressRatio > 0 ? '4px' : undefined,
        }}
      />
      {active && progressRatio > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-1000 ease-linear"
          style={{ width: `${progressRatio * 100}%` }}
        >
          <div className="shimmer absolute inset-0" />
        </div>
      )}
    </div>
  )
}
