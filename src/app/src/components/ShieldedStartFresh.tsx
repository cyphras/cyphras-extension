import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse } from '@ext-types/index'

interface ShieldedStartFreshProps {
  poolId: string
  message: string
  onStarted: () => void
}

// The pool cannot open while the account's stored records cannot be assigned to it. Starting it
// fresh rebuilds the balance from the chain and leaves those records stored, but a payment in
// flight that only they follow drops out of sight, so it takes an explicit confirm.
export function ShieldedStartFresh({ poolId, message, onStarted }: ShieldedStartFreshProps) {
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startFresh() {
    setRunning(true)
    setError(null)
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_START_FRESH, poolId },
      (r: ServiceResponse) => {
        setRunning(false)
        if (chrome.runtime.lastError) {
          setError('The extension restarted. Try again.')
        } else if (r?.error) {
          setError(r.error)
        } else {
          setConfirming(false)
          onStarted()
        }
      }
    )
  }

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-3">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-destructive">{message}</p>
        {confirming ? (
          <>
            <p className="text-[11px] leading-snug text-muted-foreground">
              The pool starts from a fresh state and rebuilds your balance from the chain; the old
              records stay stored. A payment or deposit in flight that only they record is not
              followed here, so before paying again, wait until any such payment has landed or its
              deadline has passed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={running}
                className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background disabled:opacity-50"
              >
                Keep waiting
              </button>
              <button
                onClick={startFresh}
                disabled={running}
                className="cursor-pointer rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                {running ? 'Starting...' : 'Start fresh'}
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="cursor-pointer self-start rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            Start this pool fresh
          </button>
        )}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}
