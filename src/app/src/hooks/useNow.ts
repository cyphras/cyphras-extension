import { useEffect, useState } from 'react'

// Ticks the current time on an interval while active, so a component can advance a time-based animation
// (the delivery ETA bar) without its parent re-rendering. Stops ticking when inactive to stay idle.
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [active, intervalMs])
  return now
}
