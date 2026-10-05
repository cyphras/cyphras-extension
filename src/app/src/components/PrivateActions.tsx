import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { depositActions, needsRetry, planActions, type AccountAction } from '@/lib/privateActivity'
import type { ServiceResponse, ShieldedDepositView, ShieldedPlanView } from '@ext-types/index'

// What the user can do about a deposit or a payment. A payment that may still land, or failed only
// by the wallet's last reading of the chain, is offered a retry with the same notes and nothing
// else; a deposit or a stranded payout, the transactions the account signs itself, each behind a
// confirm that says what it costs and what it links.
export function PrivateActions({
  plan,
  deposit,
  poolId,
  onRetry,
  onChanged,
}: {
  plan: ShieldedPlanView | null
  deposit: ShieldedDepositView | null
  poolId: string
  onRetry: (plan: ShieldedPlanView) => void
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const now = Math.floor(Date.now() / 1000)

  if (plan && needsRetry(plan)) {
    return (
      <button
        onClick={() => onRetry(plan)}
        className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
      >
        <RotateCcw size={12} /> Retry with the same notes
      </button>
    )
  }
  const actions: AccountAction[] = plan
    ? planActions(plan)
    : deposit
      ? depositActions(deposit, now)
      : []
  if (actions.length === 0) return null

  function run(action: AccountAction) {
    setConfirming(null)
    setRunning(action.key)
    chrome.runtime.sendMessage(
      { type: action.type, poolId, id: action.id },
      (r: ServiceResponse) => {
        setRunning(null)
        // A restart after the request left may still have sent the transaction.
        const outcome = chrome.runtime.lastError
          ? {
              ok: true,
              text: 'The extension restarted, so it may have been sent. The next sync shows what became of it.',
            }
          : r?.error
            ? { ok: false, text: r.error }
            : { ok: true, text: 'Sent.' }
        setOutcomes((prev) => ({ ...prev, [action.key]: outcome }))
        onChanged()
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {actions.map((action) =>
        confirming === action.key ? (
          <div key={action.key} className="rounded-lg bg-muted px-3 py-2">
            <p className="text-[11px] leading-snug text-muted-foreground">{action.explain}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background"
              >
                Keep
              </button>
              <button
                onClick={() => run(action)}
                className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                {action.label}
              </button>
            </div>
          </div>
        ) : (
          <div key={action.key}>
            <button
              onClick={() => setConfirming(action.key)}
              disabled={running !== null}
              className="inline-flex cursor-pointer items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:opacity-50"
            >
              {running === action.key ? 'Sending...' : action.label}
            </button>
            {outcomes[action.key] && (
              <p
                className={`mt-1 text-[11px] ${outcomes[action.key].ok ? 'text-muted-foreground' : 'text-destructive'}`}
              >
                {outcomes[action.key].text}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}
