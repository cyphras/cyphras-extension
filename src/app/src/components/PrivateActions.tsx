import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { InlineFeeReview, PoolRestore } from '@/components/ShieldedFeeSheets'
import { approvalOf } from '@/lib/privateFees'
import {
  depositActions,
  holdOf,
  needsRetry,
  planActions,
  type AccountAction,
} from '@/lib/privateActivity'
import type {
  ServiceResponse,
  ShieldedDepositView,
  ShieldedFeeApproval,
  ShieldedFeeView,
  ShieldedPlanView,
  ShieldedScope,
} from '@ext-types/index'

const PILL =
  'inline-flex cursor-pointer items-center gap-1.5 self-start rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20'

// What the user can do about a deposit or a payment. A payment that may still land, failed only by
// the wallet's last reading of the chain, or was never sent and waits on the user, is offered a
// retry with the same notes and nothing else; a deposit or a stranded payout, the transactions the
// account signs itself, each behind a confirm that says what it costs and what it links, and a fee
// above what the wallet pays without asking behind a review of that fee.
export function PrivateActions({
  plan,
  deposit,
  poolId,
  scope,
  onRetry,
  onChanged,
}: {
  plan: ShieldedPlanView | null
  deposit: ShieldedDepositView | null
  poolId: string
  // What the status these items come from was read for, which every action names.
  scope: ShieldedScope | null
  onRetry: (plan: ShieldedPlanView, selfRelay?: boolean) => void
  onChanged: () => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{
    key: string
    fee: ShieldedFeeView
    approved: string | null
  } | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const now = Math.floor(Date.now() / 1000)

  if (plan && needsRetry(plan)) {
    const hold = holdOf(plan)
    const account = scope?.publicKey ?? ''
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onRetry(plan)} className={PILL}>
          <RotateCcw size={12} />
          {hold === 'fee_above_cap'
            ? 'Review fee'
            : hold
              ? 'Try again'
              : 'Retry with the same notes'}
        </button>
        {plan.kind === 'unshield' && (hold === 'network_fee_high' || hold === 'restore_needed') && (
          <button onClick={() => onRetry(plan, true)} className={PILL}>
            {hold === 'network_fee_high' ? 'Pay the fee myself' : 'Pay from my account'}
          </button>
        )}
        {hold === 'restore_needed' && (
          <div className="basis-full">
            <PoolRestore
              poolId={poolId}
              scope={scope}
              account={account}
              heldPayment
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    )
  }
  const actions: AccountAction[] = plan
    ? planActions(plan)
    : deposit
      ? depositActions(deposit, now)
      : []
  if (actions.length === 0) return null

  function run(action: AccountAction, approval?: ShieldedFeeApproval) {
    setConfirming(null)
    setReviewing(null)
    setRunning(action.key)
    chrome.runtime.sendMessage(
      { type: action.type, poolId, id: action.id, feeApproval: approval, ...scope },
      (r: ServiceResponse) => {
        setRunning(null)
        if (!chrome.runtime.lastError && r?.shieldedError?.fee) {
          setReviewing({
            key: action.key,
            fee: r.shieldedError.fee,
            approved: approval?.ceiling ?? null,
          })
          return
        }
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
        reviewing?.key === action.key ? (
          <InlineFeeReview
            key={action.key}
            fee={reviewing.fee}
            subject={action.type === 'SHIELDED_CLAIM' ? 'claim' : 'cancel'}
            account={scope?.publicKey ?? ''}
            approved={reviewing.approved}
            onDecline={() => {
              setReviewing(null)
              setOutcomes((prev) => ({
                ...prev,
                [action.key]: { ok: true, text: 'Not sent. Nothing changed.' },
              }))
            }}
            onApprove={() => run(action, approvalOf(reviewing.fee))}
          />
        ) : confirming === action.key ? (
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
                aria-live="polite"
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
