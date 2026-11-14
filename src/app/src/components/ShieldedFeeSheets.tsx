import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddressValue, CopyValue, DetailRow } from '@/components/TxDetailParts'
import { formatUnits } from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import {
  FEE_REVIEW_TIMEOUT_MS,
  feeTitle,
  OPEN_PAYMENT,
  OPEN_SEND,
  RESTORE_ADVANCED,
  dropOffer,
  REVIEW_TIMED_OUT,
  entryLines,
  feeChangedText,
  feeLead,
  feeNotes,
  notEnoughText,
  restoreOutcome,
  restoreWarning,
  shortfall,
  type FeeSubject,
  type RefusalCopy,
} from '@/lib/privateFees'
import { SERVICE_TYPES } from '@constants/services'
import type { ServiceResponse, ShieldedFeeView, ShieldedScope } from '@ext-types/index'

const xlm = (stroops: string | bigint): string => formatUnits(stroops, 7)

// How long the paying button of an inline review stays off after it appears.
const PAY_DELAY_MS = 1_000

function AmberNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function MutedNote({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[11px] leading-snug text-muted-foreground">{children}</p>
}

function withFiat(text: string, fiat: string | null) {
  return (
    <span className="tabular-nums">
      {text}
      {fiat && <span className="ml-1 text-muted-foreground">{fiat}</span>}
    </span>
  )
}

// A network fee above what the wallet pays without asking, for a call the account submits itself.
// Nothing goes until the user approves the most the call may pay, which the primary button repeats
// and the background holds it to; declining sends nothing. Where the fee is as large as the payment, Not now is the
// highlighted button and takes focus; the paying button never does.
export function FeeReviewBody({
  fee,
  subject,
  account,
  available,
  payment,
  approved,
  working,
  progress,
  amountCard,
  fiatOf,
  onDecline,
  onApprove,
}: {
  fee: ShieldedFeeView
  subject: FeeSubject
  account: string
  // What the account can spend on the fee; null when its balance is not known.
  available: bigint | null
  // The payment the fee is for, to tell when the fee is as large as it.
  payment: bigint | null
  // The most the user approved before the fee changed, in stroops.
  approved: string | null
  working: boolean
  progress: string
  amountCard: ReactNode
  fiatOf: (units: bigint) => string | null
  onDecline: () => void
  onApprove: () => void
}) {
  const ceiling = BigInt(fee.most)
  const large = payment !== null && BigInt(fee.total) >= payment
  const { warning, notes } = feeNotes(fee.reason, subject, shortAddress(account), large)
  const lacking = shortfall(ceiling, available)
  const entries = fee.reason === 'network' ? [] : entryLines(fee.entries)
  const most = `${xlm(ceiling)} XLM`
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
        {approved !== null && (
          <AmberNote>{feeChangedText(xlm(fee.total), xlm(approved))}</AmberNote>
        )}
        <AmberNote>{feeLead(fee.reason, fee.paid && xlm(fee.paid))}</AmberNote>
        {amountCard}
        <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
          <DetailRow label="Paid by">
            <AddressValue address={account} />
          </DetailRow>
          <DetailRow label="Network fee">
            {withFiat(`About ${xlm(fee.total)} XLM`, fiatOf(BigInt(fee.total)))}
          </DetailRow>
          <div aria-label={`Most you will pay: ${most}`}>
            <DetailRow label="Most you will pay">
              <span className="font-semibold">{withFiat(most, fiatOf(ceiling))}</span>
            </DetailRow>
          </div>
          {entries.length > 0 && (
            <DetailRow label={fee.reason === 'restore' ? 'Brings back' : 'Renews'}>
              <span className="flex flex-col items-end">
                {entries.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </DetailRow>
          )}
        </div>
        {warning && <AmberNote>{warning}</AmberNote>}
        {lacking !== null && <AmberNote>{notEnoughText(xlm(lacking))}</AmberNote>}
        {(lacking === null ? notes : notes.slice(1)).map((note) => (
          <MutedNote key={note}>{note}</MutedNote>
        ))}
        <p aria-live="polite" className="text-center text-xs text-muted-foreground">
          {working ? progress : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button
          variant={large ? 'default' : 'outline'}
          className="flex-1"
          disabled={working}
          autoFocus={large}
          onClick={onDecline}
        >
          Not now
        </Button>
        <Button
          variant={large ? 'outline' : 'default'}
          className="flex-1"
          disabled={working || lacking !== null || fee.approval === undefined}
          onClick={onApprove}
        >
          {working ? 'Sending...' : `Pay up to ${most}`}
        </Button>
      </div>
    </>
  )
}

// The relayer did not send a payment: the network fee is above what its fee covers, or the pool
// needs a restore. Trying later sends nothing; paying from the account retries the same notes.
export function RefusalBody({
  copy,
  working,
  progress,
  advanced,
  onLater,
  onPay,
}: {
  copy: RefusalCopy
  working: boolean
  progress: string
  advanced: ReactNode
  onLater: () => void
  onPay: () => void
}) {
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
        <AmberNote>{copy.lead}</AmberNote>
        <MutedNote>{copy.note}</MutedNote>
        {advanced}
        {copy.payNote && <MutedNote>{copy.payNote}</MutedNote>}
        <p aria-live="polite" className="text-center text-xs text-muted-foreground">
          {working ? progress : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" className="flex-1" disabled={working} onClick={onLater}>
          Try later
        </Button>
        {copy.payLabel && (
          <Button className="flex-1" disabled={working} onClick={onPay}>
            {working ? 'Sending...' : copy.payLabel}
          </Button>
        )}
      </div>
    </>
  )
}

// A payment to the same destination may still land, so a new one waits for it: the way on is that
// payment's retry, with its own notes. For a private send the user may still send another payment,
// which the sheet says may arrive beside it.
export function OpenPaymentBody({
  found,
  send,
  onBack,
  onOpen,
}: {
  found: boolean
  send: boolean
  onBack: () => void
  onOpen: () => void
}) {
  const copy = send ? OPEN_SEND : OPEN_PAYMENT
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
        <AmberNote>{copy.lead}</AmberNote>
        <MutedNote>{copy.note}</MutedNote>
      </div>
      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          {send ? 'Send another payment' : 'Back'}
        </Button>
        <Button className="flex-1" onClick={onOpen}>
          {!found
            ? 'Check Private activity'
            : send
              ? 'Continue that payment'
              : 'Open pending payment'}
        </Button>
      </div>
    </>
  )
}

// A fee review in the inline box of an account action or a pool restore: the same facts and
// choices as the sheet. The paying button waits a moment after it appears, so a second tap meant
// for the button it replaced does not approve.
export function InlineFeeReview({
  fee,
  subject,
  account,
  approved,
  available,
  fiatOf,
  onDecline,
  onApprove,
}: {
  fee: ShieldedFeeView
  subject: FeeSubject
  account: string
  approved: string | null
  available: bigint | null
  fiatOf: (units: bigint) => string | null
  onDecline: (timedOut: boolean) => void
  onApprove: () => void
}) {
  const { notes } = feeNotes(fee.reason, subject, shortAddress(account), false)
  const entries = fee.reason === 'network' ? [] : entryLines(fee.entries)
  const ceiling = BigInt(fee.most)
  const lacking = shortfall(ceiling, available)
  const most = `${xlm(ceiling)} XLM`
  const total = fiatOf(BigInt(fee.total))
  const mostFiat = fiatOf(ceiling)
  const [ready, setReady] = useState(false)
  // An unanswered review is declined, however often the page around it renders.
  const declineRef = useRef(onDecline)
  useEffect(() => {
    declineRef.current = onDecline
  })
  useEffect(() => {
    setReady(false)
    const armed = setTimeout(() => setReady(true), PAY_DELAY_MS)
    const timer = setTimeout(() => declineRef.current(true), FEE_REVIEW_TIMEOUT_MS)
    return () => {
      clearTimeout(armed)
      clearTimeout(timer)
    }
  }, [fee])
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{feeTitle(fee.reason, fee.paid)}</p>
      {approved !== null && (
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          {feeChangedText(xlm(fee.total), xlm(approved))}
        </p>
      )}
      <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        {feeLead(fee.reason, fee.paid && xlm(fee.paid))}
      </p>
      <p className="text-[11px] tabular-nums text-foreground">
        Network fee about {xlm(fee.total)} XLM{total ? ` (${total})` : ''}.{' '}
        <span className="font-semibold" aria-label={`Most you will pay: ${most}`}>
          Most you will pay {most}
          {mostFiat ? ` (${mostFiat})` : ''}.
        </span>
      </p>
      {entries.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {fee.reason === 'restore' ? 'Brings back' : 'Renews'}: {entries.join(', ')}.
        </p>
      )}
      {lacking !== null && (
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          {notEnoughText(xlm(lacking))}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} className="text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      ))}
      <div className="flex gap-2">
        <button
          onClick={() => onDecline(false)}
          className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background"
        >
          Not now
        </button>
        <button
          onClick={onApprove}
          disabled={!ready || lacking !== null || fee.approval === undefined}
          className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:opacity-50"
        >
          Pay up to {most}
        </button>
      </div>
    </div>
  )
}

type RestoreState =
  | { kind: 'closed' }
  | { kind: 'confirm'; note?: string }
  | { kind: 'running' }
  | { kind: 'fee'; fee: ShieldedFeeView; approved: string | null }
  | { kind: 'done'; text: string; hash: string | null }
  | { kind: 'failed'; text: string; hash: string | null }

// Restoring the pool's archived entries, paid by the account for every user of the pool, offered
// only under Advanced with what it costs and shows. A fee above the default caps is reviewed first.
export function PoolRestore({
  poolId,
  scope,
  account,
  heldPayment,
  available,
  fiatOf,
  onChanged,
}: {
  poolId: string
  scope: ShieldedScope | null
  account: string
  // A payment waits for the restore, and can be retried after it.
  heldPayment: boolean
  // What the account can spend on the fee, null when not known, and fiat for XLM amounts.
  available: bigint | null
  fiatOf: (units: bigint) => string | null
  onChanged: () => void
}) {
  const [state, setState] = useState<RestoreState>({ kind: 'closed' })

  function run(approval?: string, approved?: string) {
    setState({ kind: 'running' })
    chrome.runtime.sendMessage(
      { type: SERVICE_TYPES.SHIELDED_RESTORE, poolId, feeApproval: approval, ...scope },
      (r: ServiceResponse) => {
        onChanged()
        if (chrome.runtime.lastError) {
          setState({
            kind: 'failed',
            text: 'The extension restarted, so it may have been sent. Try again to check.',
            hash: null,
          })
        } else if (r?.shieldedRestore) {
          setState({
            kind: 'done',
            text: restoreOutcome(r.shieldedRestore.restored, heldPayment),
            hash: r.shieldedRestore.txHash,
          })
        } else if (r?.shieldedError?.fee) {
          setState({ kind: 'fee', fee: r.shieldedError.fee, approved: approved ?? null })
        } else {
          setState({
            kind: 'failed',
            text: r?.error ?? 'Request failed',
            hash: r?.shieldedError?.hash ?? null,
          })
        }
      }
    )
  }

  if (state.kind === 'closed') {
    return (
      <button
        onClick={() => setState({ kind: 'confirm' })}
        className="inline-flex cursor-pointer items-center gap-1 self-start text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        Advanced <ChevronDown size={12} />
      </button>
    )
  }
  if (state.kind === 'fee') {
    return (
      <InlineFeeReview
        fee={state.fee}
        subject="restore"
        account={account}
        approved={state.approved}
        available={available}
        fiatOf={fiatOf}
        onDecline={(timedOut) => {
          dropOffer(state.fee.approval, scope)
          setState({ kind: 'confirm', note: timedOut ? REVIEW_TIMED_OUT : undefined })
        }}
        onApprove={() => run(state.fee.approval, state.fee.most)}
      />
    )
  }
  const outcome = state.kind === 'done' || state.kind === 'failed' ? state : null
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2">
      <p className="text-[11px] font-medium text-foreground">{RESTORE_ADVANCED}</p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {restoreWarning(shortAddress(account))}
      </p>
      {state.kind === 'confirm' && state.note && (
        <p aria-live="polite" className="text-[11px] text-muted-foreground">
          {state.note}
        </p>
      )}
      {outcome && (
        <p
          aria-live="polite"
          className={`text-[11px] ${outcome.kind === 'done' ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {outcome.text}
        </p>
      )}
      {outcome?.hash && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          Transaction <CopyValue value={outcome.hash} />
        </div>
      )}
      {state.kind !== 'done' && (
        <div className="flex gap-2">
          <button
            onClick={() => setState({ kind: 'closed' })}
            disabled={state.kind === 'running'}
            className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-background disabled:cursor-default disabled:opacity-50"
          >
            Keep
          </button>
          <button
            onClick={() => run()}
            disabled={state.kind === 'running'}
            className="cursor-pointer rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-default disabled:opacity-50"
          >
            {state.kind === 'running'
              ? 'Restoring...'
              : state.kind === 'failed'
                ? 'Try again'
                : 'Restore the pool'}
          </button>
        </div>
      )}
    </div>
  )
}
