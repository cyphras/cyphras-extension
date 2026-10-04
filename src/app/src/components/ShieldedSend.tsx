import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import {
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Send as SendIcon,
  ChevronDown,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Cy1Avatar } from '@/components/Cy1Avatar'
import { StellarAvatar } from '@/components/StellarAvatar'
import { TokenStatusIcon } from '@/components/TxDetailParts'
import { AssetIcon } from '@/components/token/AssetIcon'
import { useStellarChain } from '@/hooks/useStellarChain'
import { useAvatarKey } from '@/hooks/useAvatarKey'
import {
  formatUnits,
  fractionUnits,
  parseUnits,
  sanitizeAmountInput,
  spendableUnits,
} from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import { SERVICE_TYPES, SHIELDED_REVIEW_PORT } from '@constants/services'
import type {
  ServiceResponse,
  ShieldedPlanView,
  ShieldedReceiptView,
  ShieldedReviewView,
  ShieldedStatusView,
  ShieldedStep,
} from '@ext-types/index'

export type ShieldedAction = 'send' | 'shield' | 'unshield'

interface ShieldedSendProps {
  action: ShieldedAction | null
  // A stalled payment to pay again with its own notes, never with new ones.
  retryPlan: ShieldedPlanView | null
  status: ShieldedStatusView | null
  poolId: string
  assetLabel: string
  decimals: number
  assetCode?: string
  assetIcon?: string
  native?: boolean
  accountPk: string
  publicBalance?: string | null
  subentryCount?: number
  onChangeAsset?: () => void
  onClose: () => void
  onDone: () => void
}

type Step =
  | { kind: 'form' }
  | { kind: 'retry' }
  | { kind: 'shield-review' }
  | { kind: 'preparing' }
  | { kind: 'review'; review: ShieldedReviewView }
  | { kind: 'cancelling' }
  | { kind: 'working' }
  | { kind: 'shielded'; receipt: ShieldedReceiptView }
  | { kind: 'submitted'; txHash: string | null }
  // A deposit or payment failed in a way that may still let it land.
  | { kind: 'stopped'; message: string }

const TITLES: Record<ShieldedAction, string> = {
  send: 'Private send',
  shield: 'Shield',
  unshield: 'Unshield',
}

const ACTION_ICONS: Record<ShieldedAction, typeof SendIcon> = {
  send: SendIcon,
  shield: ArrowDownToLine,
  unshield: ArrowUpFromLine,
}

// The most a transaction the account submits itself may pay the network: the SDK's caps of
// 0.01 XLM to get included and 1 XLM of resources. Shield Max keeps it back, with the account's
// minimum balance.
const NETWORK_FEE_CAP_STROOPS = 10_100_000n
const BASE_RESERVE_STROOPS = 5_000_000n

// Destinations an unshield can pay: an account, a muxed account or a contract.
const STELLAR_DESTINATION = /^([GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/

// mayLand marks a failure after which the deposit or payment may still land: it was saved
// before it failed, or the extension restarted while it ran.
type Reply<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string; mayLand: boolean }

function ask<T>(message: object, pick: (r: ServiceResponse) => T | undefined): Promise<Reply<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (r: ServiceResponse) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: 'The extension restarted. Check Private activity before trying again.',
          mayLand: true,
        })
        return
      }
      const value = r ? pick(r) : undefined
      if (value !== undefined) {
        resolve({ ok: true, value })
        return
      }
      resolve({
        ok: false,
        error: r?.error ?? 'Request failed',
        code: r?.shieldedError?.code,
        mayLand: r?.shieldedError?.mayLand === true,
      })
    })
  })
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs text-foreground">{children}</div>
    </div>
  )
}

export default function ShieldedSend({
  action,
  retryPlan,
  status,
  poolId,
  assetLabel,
  decimals,
  assetCode,
  assetIcon,
  native = false,
  accountPk,
  publicBalance = null,
  subentryCount = 0,
  onChangeAsset,
  onClose,
  onDone,
}: ShieldedSendProps) {
  const [recipient, setRecipient] = useState('')
  const [recipientFocused, setRecipientFocused] = useState(false)
  const [amount, setAmount] = useState('')
  const [selfRelay, setSelfRelay] = useState(false)
  const [shieldAnyway, setShieldAnyway] = useState(false)
  // The SDK refused a shield because a deposit is submitting, which a stale status may not show yet.
  const [refusedWhileSubmitting, setRefusedWhileSubmitting] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // Each opening of the sheet is a session. A reply from an older session, or one that arrives
  // once the sheet is closed, never paints, and a review it carries is declined.
  const sessionRef = useRef(0)
  const openRef = useRef(false)
  // The port that keeps the shown review open in the background, which declines the review when
  // the port goes, and the last review shown, which the next reply answers.
  const reviewPortRef = useRef<chrome.runtime.Port | null>(null)
  const lastReviewRef = useRef<ShieldedReviewView | null>(null)
  const stellarChain = useStellarChain()
  const avatarKey = useAvatarKey()

  // Keep the last non-null action so content stays visible during the close slide.
  const lastActionRef = useRef<ShieldedAction | null>(null)
  if (action) lastActionRef.current = action
  const a = action ?? lastActionRef.current
  const open = action !== null
  openRef.current = open
  const chipCode = native ? 'XLM' : (assetCode ?? assetLabel)
  const unit = (units: string | bigint) => `${formatUnits(units, decimals)} ${chipCode}`

  const releaseReview = useCallback(() => {
    reviewPortRef.current?.disconnect()
    reviewPortRef.current = null
  }, [])

  // Proving and submitting go on in the background whatever the sheet does, so the sheet stays
  // until they report back rather than lose their result.
  const busy = step.kind === 'preparing' || step.kind === 'working' || step.kind === 'cancelling'

  const close = useCallback(() => {
    if (busy) return
    releaseReview()
    onClose()
  }, [busy, releaseReview, onClose])

  useEffect(() => releaseReview, [releaseReview])

  // A service worker that gets no event for 30 seconds may stop, and the open review with it, so
  // a cheap status read keeps it awake while the user reads the review.
  useEffect(() => {
    if (step.kind !== 'review') return
    const timer = setInterval(() => {
      chrome.runtime.sendMessage({ type: SERVICE_TYPES.SHIELDED_STATUS, poolId })
    }, 20_000)
    return () => clearInterval(timer)
  }, [step.kind, poolId])

  // A review comes back from the background either as the first step of a spend or after a
  // relayer raised its fee; anything else ends the spend. The end of a spend whose answered review
  // was repriced is never a fresh start, since that payment is saved and may still land.
  const followStep = useCallback(
    (reply: Reply<ShieldedStep>) => {
      const answered = lastReviewRef.current
      if (!reply.ok || reply.value.kind !== 'review') lastReviewRef.current = null
      if (!reply.ok) {
        if (reply.mayLand || answered?.repriced) {
          setStep({ kind: 'stopped', message: reply.error })
          onDone()
          return
        }
        if (reply.code !== 'not_confirmed') setError(reply.error)
        setStep({ kind: retryPlan ? 'retry' : 'form' })
        onDone()
        return
      }
      if (reply.value.kind === 'review') {
        const review = reply.value.review
        const port = chrome.runtime.connect({ name: SHIELDED_REVIEW_PORT + review.reviewId })
        // The port only drops from the background's side when the service worker stopped, which
        // takes the review with it.
        port.onDisconnect.addListener(() => {
          if (reviewPortRef.current !== port) return
          reviewPortRef.current = null
          lastReviewRef.current = null
          if (review.repriced) {
            setStep({ kind: 'stopped', message: 'The extension restarted during the review.' })
            onDone()
          } else {
            setError('The review closed before it was answered. Review again.')
            setStep({ kind: retryPlan ? 'retry' : 'form' })
          }
        })
        reviewPortRef.current = port
        lastReviewRef.current = review
        setStep({ kind: 'review', review })
        return
      }
      setStep({ kind: 'submitted', txHash: reply.value.txHash })
      onDone()
    },
    [onDone, retryPlan]
  )

  // Opening starts a session. Closing ends it, from here or from the parent as on an account or
  // network switch, and declines any review it left open.
  useEffect(() => {
    sessionRef.current++
    if (!open) {
      releaseReview()
      return
    }
    setRecipient(retryPlan?.to ?? '')
    setRecipientFocused(false)
    setAmount(retryPlan ? formatUnits(retryPlan.amount, decimals) : '')
    setSelfRelay(false)
    setShieldAnyway(false)
    setRefusedWhileSubmitting(false)
    setError(null)
    setStep({ kind: retryPlan ? 'retry' : 'form' })
  }, [open, action, retryPlan, decimals, releaseReview])

  // A spend request of this session. A reply that comes after the session ended is dropped, and
  // a review in it is declined.
  const requestStep = useCallback(async (message: object): Promise<Reply<ShieldedStep> | null> => {
    const session = sessionRef.current
    const reply = await ask(message, (r) => r.shieldedStep)
    if (session === sessionRef.current && openRef.current) return reply
    if (reply.ok && reply.value.kind === 'review') {
      chrome.runtime.sendMessage({
        type: SERVICE_TYPES.SHIELDED_DECIDE,
        reviewId: reply.value.review.reviewId,
        approve: false,
      })
    }
    return null
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) close()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKey)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, close])

  // Shield spends the public balance; send and unshield spend the private one.
  const balanceUnits =
    a === 'shield'
      ? publicBalance === null
        ? null
        : spendableUnits(
            publicBalance,
            decimals,
            undefined,
            native
              ? (2n + BigInt(subentryCount)) * BASE_RESERVE_STROOPS + NETWORK_FEE_CAP_STROOPS
              : 0n
          )
      : status
        ? BigInt(status.balance.spendable)
        : null
  const units = parseUnits(amount, decimals)
  const exceedsBalance = units !== null && balanceUnits !== null && units > balanceUnits

  // The address prefix of this network, taken from the account's own private address.
  const privatePrefix = status ? status.address.slice(0, status.address.indexOf('1') + 1) : 'cy'
  const to = recipient.trim()
  const recipientValid =
    a === 'shield' || (a === 'send' ? to.startsWith(privatePrefix) : STELLAR_DESTINATION.test(to))
  const submittingDeposit =
    refusedWhileSubmitting || (status?.deposits.some((d) => d.state === 'submitting') ?? false)
  const canReview =
    step.kind === 'form' &&
    units !== null &&
    units > 0n &&
    !exceedsBalance &&
    (a === 'shield' || to !== '') &&
    recipientValid

  function fill(fraction: number) {
    if (balanceUnits === null) return
    const portion = fraction === 1 ? balanceUnits : fractionUnits(balanceUnits, fraction)
    setAmount(portion > 0n ? formatUnits(portion, decimals) : '0')
  }

  function reviewRetry() {
    if (!retryPlan) return
    setError(null)
    setStep({ kind: 'preparing' })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_RETRY,
      poolId,
      planId: retryPlan.planId,
      selfRelay: retryPlan.kind === 'unshield' && selfRelay,
    }).then((reply) => reply && followStep(reply))
  }

  function review() {
    if (!a || units === null) return
    setError(null)
    if (a === 'shield') {
      setShieldAnyway(false)
      setStep({ kind: 'shield-review' })
      return
    }
    setStep({ kind: 'preparing' })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_SPEND,
      poolId,
      kind: a,
      to,
      amount: units.toString(),
      selfRelay: a === 'unshield' && selfRelay,
    }).then((reply) => reply && followStep(reply))
  }

  // Both answers wait for what the SDK made of them: declining a repriced review still leaves its
  // saved payment, which may land.
  function answerReview(reviewId: string, approve: boolean) {
    setStep({ kind: approve ? 'working' : 'cancelling' })
    requestStep({ type: SERVICE_TYPES.SHIELDED_DECIDE, reviewId, approve }).then((reply) => {
      if (!reply) return
      // The answered review is closed in the background, so its port has nothing left to decline.
      releaseReview()
      followStep(reply)
    })
  }

  function approveShield() {
    if (units === null) return
    const session = sessionRef.current
    setStep({ kind: 'working' })
    ask(
      {
        type: SERVICE_TYPES.SHIELDED_SHIELD,
        poolId,
        amount: units.toString(),
        whileSubmitting: submittingDeposit && shieldAnyway,
      },
      (r) => r.shieldedReceipt
    ).then((reply) => {
      // A failed shield may have left its deposit submitting, which the next review must show.
      onDone()
      if (session !== sessionRef.current || !openRef.current) return
      if (!reply.ok) {
        if (reply.mayLand) {
          setStep({ kind: 'stopped', message: reply.error })
          return
        }
        // A deposit of this account is submitting, maybe one the network dropped, which stays so
        // for good; the review asks again, now offering to shield anyway.
        if (reply.code === 'deposit_submitting') {
          setRefusedWhileSubmitting(true)
          setShieldAnyway(false)
          setStep({ kind: 'shield-review' })
        } else {
          setStep({ kind: 'form' })
        }
        setError(reply.error)
        return
      }
      setStep({ kind: 'shielded', receipt: reply.value })
    })
  }

  const Icon = a ? ACTION_ICONS[a] : SendIcon
  const subtitles: Record<ShieldedAction, string> = {
    send: `Send shielded ${assetLabel} to a private address`,
    shield: `Move public ${assetLabel} into your private balance`,
    unshield: `Move private ${assetLabel} to any Stellar address`,
  }

  function recipientField() {
    if (a === 'shield') return null
    const showChip = recipientValid && to.length >= 20 && !recipientFocused
    return (
      <div className="flex flex-col gap-1.5 rounded-xl bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">To</p>
          {a === 'unshield' && to !== accountPk && (
            <button
              type="button"
              onClick={() => setRecipient(accountPk)}
              className="cursor-pointer text-xs font-medium text-primary hover:underline"
            >
              My account
            </button>
          )}
        </div>
        {showChip ? (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setRecipientFocused(true)}
              className="flex min-w-0 cursor-pointer items-center gap-2"
            >
              {a === 'send' ? (
                <Cy1Avatar address={to} size={22} />
              ) : (
                <StellarAvatar publicKey={avatarKey(to)} size={22} />
              )}
              <span className="font-mono text-sm text-foreground">
                {`${to.slice(0, 8)}...${to.slice(-6)}`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRecipient('')
                setRecipientFocused(true)
              }}
              aria-label="Clear recipient"
              className="ml-2 shrink-0 cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            onFocus={() => setRecipientFocused(true)}
            onBlur={() => setRecipientFocused(false)}
            placeholder={a === 'send' ? `${privatePrefix}...` : 'G...'}
            spellCheck={false}
            autoCapitalize="none"
            className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        )}
        {to !== '' && !recipientValid && (
          <p className="text-xs text-destructive">
            {a === 'send'
              ? `Private addresses on this network start with ${privatePrefix}`
              : 'Enter a Stellar address (G..., M... or C...)'}
          </p>
        )}
      </div>
    )
  }

  function selfRelayOption() {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-card px-4 py-3">
        <input
          type="checkbox"
          checked={selfRelay}
          onChange={(e) => setSelfRelay(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">Submit without a relayer</span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            Your account {shortAddress(accountPk)} pays the network fee and becomes publicly linked
            to this withdrawal. Use it when relayers are unavailable.
          </span>
        </span>
      </label>
    )
  }

  function form() {
    if (!a) return null
    const showChips = balanceUnits !== null
    return (
      <>
        <div
          className={`flex flex-col gap-3 rounded-xl bg-card p-4 transition-colors ${exceedsBalance ? 'ring-1 ring-destructive/60' : ''}`}
        >
          <button
            onClick={onChangeAsset}
            aria-label="Change asset"
            className="flex cursor-pointer items-center gap-2 self-start rounded-xl bg-muted px-3 py-2 transition-colors hover:bg-muted/70"
          >
            <AssetIcon icon={assetIcon} code={chipCode} />
            <span className="text-sm font-semibold text-foreground">{chipCode}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>

          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = sanitizeAmountInput(e.target.value)
              if (v !== null) setAmount(v)
            }}
            className="w-full border-none bg-transparent text-4xl font-bold text-foreground outline-none placeholder:text-muted-foreground/40"
          />

          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {balanceUnits !== null
                ? `${a === 'shield' ? 'Available' : 'Private balance'}: ${unit(balanceUnits)}`
                : 'Balance: -'}
            </p>
            {showChips && (
              <div className="flex shrink-0 items-center gap-1">
                {([0.25, 0.5, 1] as const).map((f) =>
                  // The relayer fee is only known at review, so a private Max cannot leave room
                  // for it; shield keeps its fee back from the public balance instead.
                  f === 1 && a !== 'shield' ? null : (
                    <button
                      key={f}
                      onClick={() => fill(f)}
                      className="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-muted/70"
                    >
                      {f === 1 ? 'Max' : `${f * 100}%`}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
          {exceedsBalance && <p className="text-xs text-destructive">Exceeds balance</p>}
        </div>

        {recipientField()}

        {a === 'unshield' && selfRelayOption()}

        {a !== 'shield' && (
          <p className="px-1 text-[11px] text-muted-foreground">
            {a === 'unshield' && selfRelay
              ? `No relayer fee; your account pays the network fee, at most ${unit(NETWORK_FEE_CAP_STROOPS)}.`
              : 'The relayer fee is quoted on the next step, before anything is sent.'}
          </p>
        )}

        {error && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">{error}</p>
        )}

        <Button className="w-full" disabled={!canReview} onClick={review}>
          Review
        </Button>
      </>
    )
  }

  function shieldReview() {
    if (units === null) return null
    return (
      <>
        <div className="rounded-xl bg-card px-4 py-2">
          <Row label="You shield">{unit(units)}</Row>
          <Row label="From">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <StellarAvatar publicKey={avatarKey(accountPk)} size={14} />
              {shortAddress(accountPk)}
            </span>
          </Row>
          <Row label="To">
            <span className="inline-flex items-center gap-1.5 font-mono">
              {status && <Cy1Avatar address={status.address} size={14} />}
              Your private balance
            </span>
          </Row>
          <Row label="Network fee">Up to {unit(NETWORK_FEE_CAP_STROOPS)}, from your account</Row>
        </div>
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          Deposits are screened and wait out the pool's delay before they can be spent; the pending
          deposit shows when. Your account is public as the depositor.
        </p>
        {submittingDeposit && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-amber-500/10 px-4 py-3">
            <input
              type="checkbox"
              checked={shieldAnyway}
              onChange={(e) => setShieldAnyway(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              An earlier deposit is still being submitted and may yet land. One whose transaction
              never reached the network can stay this way for good, so shielding again is allowed,
              but if the earlier one lands both are deposited. Shield anyway.
            </span>
          </label>
        )}
        {error && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">{error}</p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setStep({ kind: 'form' })}>
            Back
          </Button>
          <Button
            className="flex-1"
            disabled={submittingDeposit && !shieldAnyway}
            onClick={approveShield}
          >
            Approve
          </Button>
        </div>
      </>
    )
  }

  function spendReview(r: ShieldedReviewView) {
    const total = BigInt(r.amount) + BigInt(r.fee)
    return (
      <>
        {r.repriced && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
            The relayer raised its fee after the payment was saved. Confirm proves it again with the
            same notes; cancelling leaves the saved payment, which may still land.
          </p>
        )}
        <div className="rounded-xl bg-card px-4 py-2">
          <Row label={r.kind === 'send' ? 'You send' : 'You unshield'}>{unit(r.amount)}</Row>
          <Row label="To">
            <span className="inline-flex items-center gap-1.5 font-mono">
              {r.kind === 'send' ? (
                <Cy1Avatar address={r.to} size={14} />
              ) : (
                <StellarAvatar publicKey={avatarKey(r.to)} size={14} />
              )}
              {shortAddress(r.to)}
            </span>
          </Row>
          {r.selfRelay ? (
            <Row label="Network fee">Up to {unit(NETWORK_FEE_CAP_STROOPS)}, from your account</Row>
          ) : (
            <Row label="Relayer fee">{unit(r.fee)}</Row>
          )}
          <Row label="From private balance">{unit(total)}</Row>
        </div>
        {r.warnings.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl bg-amber-500/10 px-4 py-3">
            {r.warnings.map((w) => (
              <p
                key={w.code}
                className="flex gap-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400"
              >
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {w.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => answerReview(r.reviewId, false)}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => answerReview(r.reviewId, true)}>
            Confirm
          </Button>
        </div>
      </>
    )
  }

  function progress(text: string) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <TokenStatusIcon
          state="pending"
          code={chipCode}
          icon={assetIcon}
          chainIcon={stellarChain.icon}
        />
        <p className="text-xs leading-snug text-muted-foreground">{text}</p>
      </div>
    )
  }

  function result(title: string, note: string, hash: string | null) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <TokenStatusIcon
          state="success"
          code={chipCode}
          icon={assetIcon}
          chainIcon={stellarChain.icon}
        />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-snug text-muted-foreground">{note}</p>
        {hash && <p className="break-all font-mono text-xs text-muted-foreground">{hash}</p>}
        <Button className="mt-2 w-full" onClick={close}>
          Done
        </Button>
      </div>
    )
  }

  function retrySummary() {
    if (!retryPlan) return null
    return (
      <>
        <div className="rounded-xl bg-card px-4 py-2">
          <Row label={retryPlan.kind === 'send' ? 'Send' : 'Unshield'}>
            {unit(retryPlan.amount)}
          </Row>
          <Row label="To">
            <span className="font-mono">{shortAddress(retryPlan.to)}</span>
          </Row>
        </div>
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          The retry spends the same notes as the stalled payment, so at most one of them can land.
          Any fee is shown on the next step, before anything is sent.
        </p>
        {retryPlan.kind === 'unshield' && selfRelayOption()}
        {error && (
          <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">{error}</p>
        )}
        <Button className="w-full" onClick={reviewRetry}>
          Review retry
        </Button>
      </>
    )
  }

  function body() {
    switch (step.kind) {
      case 'form':
        return form()
      case 'retry':
        return retrySummary()
      case 'stopped':
        return (
          <div className="flex flex-col gap-3 py-4 text-center">
            <p className="text-sm font-medium text-foreground">
              {a === 'shield' ? 'The deposit may still land' : 'The payment may still land'}
            </p>
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {step.message}
            </p>
            <p className="text-xs leading-snug text-muted-foreground">
              {a === 'shield'
                ? 'Private activity follows the deposit until it lands or its deadline passes. Check there before shielding again.'
                : 'Do not send it again. If its deadline passes without it landing, Private activity offers a retry with the same notes.'}
            </p>
            <Button className="mt-2 w-full" onClick={close}>
              Done
            </Button>
          </div>
        )
      case 'shield-review':
        return shieldReview()
      case 'preparing':
        return progress('Syncing the pool and asking the relayer for a quote...')
      case 'review':
        return spendReview(step.review)
      case 'cancelling':
        return progress('Cancelling...')
      case 'working':
        return progress('Proving on this device and submitting. This can take a minute.')
      case 'shielded':
        return result(
          step.receipt.depositId === null
            ? 'Deposit submitted'
            : `Deposit #${step.receipt.depositId} submitted`,
          step.receipt.depositId === null
            ? 'Its deposit ID appears once the network confirms it. It can be spent after screening.'
            : 'It can be spent once screening admits it. Follow it under Private activity.',
          step.receipt.txHash
        )
      case 'submitted':
        return result(
          a === 'unshield' ? 'Unshield submitted' : 'Payment submitted',
          'It counts once the pool shows it landed. Follow it under Private activity.',
          step.txHash
        )
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        {a && (
          <>
            <div className="flex shrink-0 justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>

            <div className="flex shrink-0 items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Icon size={16} className="text-primary" />
                </div>
                <div className="flex flex-col">
                  <p className="text-lg font-bold leading-tight text-foreground">
                    {retryPlan ? 'Retry payment' : TITLES[a]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {retryPlan
                      ? 'Pays again with the same notes, so only one can land'
                      : subtitles[a]}
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                disabled={busy}
                aria-label="Close"
                className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 [&>*]:shrink-0">
              {body()}
            </div>
          </>
        )}
      </div>
    </>
  )
}
