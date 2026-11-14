import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronLeft, ExternalLink, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/Collapse'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { PrivateAddressAvatar } from '@/components/PrivateAddressAvatar'
import { AmountInput, QuickFillChips, SideCard } from '@/components/PairCard'
import { AddressAvatar } from '@/components/AddressAvatar'
import { RecipientRow } from '@/components/RecipientRow'
import { RecipientStepPage, SuggestionRow, SuggestionSection } from '@/components/SendRecipientStep'
import {
  FeeReviewBody,
  OpenPaymentBody,
  PoolRestore,
  RefusalBody,
} from '@/components/ShieldedFeeSheets'
import {
  AddressValue,
  CopyValue,
  DetailRow,
  NetworkValue,
  PrivateAddressValue,
  TokenStatusIcon,
  TxResultHero,
} from '@/components/TxDetailParts'
import { AssetIcon } from '@/components/token/AssetIcon'
import { VerifiedBadge } from '@/components/token/VerifiedBadge'
import { PrivatePage } from '@/components/PrivatePage'
import { useNetwork } from '@/context/NetworkContext'
import { useWallet } from '@/context/WalletContext'
import { usePreferences } from '@/context/PreferencesContext'
import { useStellarChain } from '@/hooks/useStellarChain'
import {
  formatBalanceText,
  formatUnits,
  fractionUnits,
  parseUnits,
  spendableUnits,
} from '@/lib/amount'
import { shortAddress } from '@/lib/address'
import { trimZeros, stroopsToXlm } from '@/lib/historyUtils'
import {
  depositStatus,
  planStatus,
  routeText,
  unfinishedSendTo,
  type ItemStatus,
} from '@/lib/privateActivity'
import {
  FEE_REVIEW_TIMEOUT_MS,
  OFFER_EXPIRED,
  feeTitle,
  FEE_TOO_LARGE_NOTE,
  NETWORK_FEE_CAP_STROOPS,
  NETWORK_FEE_CAP_XLM,
  OPEN_PAYMENT,
  RELAY_KEEPS_FAILING,
  RESTORE_NOT_SENT,
  REVIEW_TIMED_OUT,
  dropOffer,
  STAYS_PENDING,
  WAITING_NOTE,
  queuedCapHint,
  queuedNote,
  refusalCopy,
} from '@/lib/privateFees'
import { SERVICE_TYPES, SHIELDED_REVIEW_PORT } from '@constants/services'
import type {
  ServiceResponse,
  ShieldedDepositView,
  ShieldedErrorView,
  ShieldedFeeView,
  ShieldedLimitsView,
  ShieldedPlanView,
  ShieldedQuoteView,
  ShieldedReceiptView,
  ShieldedReviewView,
  ShieldedScope,
  ShieldedStatusView,
  ShieldedStep,
} from '@ext-types/index'

export type ShieldedAction = 'send' | 'shield' | 'unshield'

interface ShieldedSendProps {
  action: ShieldedAction | null
  // A stalled payment to pay again with its own notes, never with new ones, and whether its retry
  // starts self-relayed.
  retryPlan: ShieldedPlanView | null
  retrySelfRelay?: boolean
  status: ShieldedStatusView | null
  poolId: string
  assetLabel: string
  decimals: number
  assetCode?: string
  assetIcon?: string
  native?: boolean
  usdPrice: number | null
  accountPk: string
  publicBalance?: string | null
  subentryCount?: number
  onChangeAsset?: () => void
  // Opens the retry of a payment that is still pending, in place of a new one.
  onOpenPlan: (plan: ShieldedPlanView) => void
  onHistory: () => void
  onClose: () => void
  onDone: () => void
}

type Step =
  | { kind: 'form' }
  | { kind: 'retry' }
  | { kind: 'shield-review' }
  | { kind: 'preparing' }
  | { kind: 'review'; review: ShieldedReviewView }
  // The review being answered, absent for a shield, which has none.
  | { kind: 'cancelling'; review: ShieldedReviewView }
  | { kind: 'working'; review?: ShieldedReviewView }
  | { kind: 'shielded'; receipt: ShieldedReceiptView }
  | { kind: 'submitted'; planId: string; txHash: string | null; fee: string }
  // A deposit or payment failed in a way that may still let it land; a saved payment says which.
  | { kind: 'stopped'; message: string; planId?: string }
  // A network fee above what the wallet pays without asking, for the shield or the self-relayed
  // retry of a saved payment; approved names the most approved before the fee changed.
  | FeeStep
  // The relayer did not send a saved payment; its relayer fee in stroops, when known.
  | RefusedStep
  // A payment to the same destination may still land; for a private send the user may still send
  // another one.
  | { kind: 'open'; planId: string; send: boolean }
  // A fee review of a saved payment was declined: nothing was sent and it waits.
  | { kind: 'waiting'; planId: string; timedOut: boolean }
  // Nothing was sent and nothing can be approved now: the fee is above what one transaction
  // carries, or the restore before it failed on chain.
  | { kind: 'blocked'; code: string; message: string; planId?: string; hash?: string }

interface FeeStep {
  kind: 'fee'
  fee: ShieldedFeeView
  target: { kind: 'shield' } | { kind: 'retry'; planId: string }
  approved: string | null
  working: boolean
}

interface RefusedStep {
  kind: 'refused'
  // The background's offer to submit the withdrawal from the account; absent for a send.
  selfPay: string | undefined
  refusal: 'network_fee_high' | 'restore_needed'
  planId: string
  fee: string | null
  working: boolean
}

type ResultStep = Extract<
  Step,
  { kind: 'shielded' | 'submitted' | 'stopped' | 'waiting' | 'blocked' }
>

// The confirm sheet: a shield to approve, a payment's review, a fee to review, a relayer's refusal,
// a payment already pending, or its outcome.
type SheetView =
  | { kind: 'shield' }
  | { kind: 'spend'; review: ShieldedReviewView }
  | { kind: 'fee'; step: FeeStep }
  | { kind: 'refused'; step: RefusedStep }
  | { kind: 'open'; planId: string; send: boolean }
  | { kind: 'result'; step: ResultStep }

const TITLES: Record<ShieldedAction, string> = {
  send: 'Send privately',
  shield: 'Shield',
  unshield: 'Unshield',
}

const AMOUNT_LABELS: Record<ShieldedAction, string> = {
  send: 'You send',
  shield: 'You shield',
  unshield: 'You unshield',
}

// Shield Max keeps back the most a transaction the account submits itself pays the network
// without asking, with the account's minimum balance.
const BASE_RESERVE_STROOPS = 5_000_000n
const NETWORK_FEE_CAP = `Up to ${NETWORK_FEE_CAP_XLM} XLM, from your account`

// Destinations an unshield can pay: an account, a muxed account or a contract.
const STELLAR_DESTINATION = /^([GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/

// A payment that failed but may still land was made from the notes of this flow, so it was saved
// after the flow began; the clock of the plan and of the popup may differ by a little.
const CLOCK_SKEW_MS = 60_000

// mayLand marks a failure after which the deposit or payment may still land: it was saved
// before it failed, or the extension restarted while it ran. planId names a saved payment.
type Reply<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: string
      code?: string
      mayLand: boolean
      planId?: string
      view?: ShieldedErrorView
    }

function ask<T>(
  scope: ShieldedScope,
  message: object,
  pick: (r: ServiceResponse) => T | undefined
): Promise<Reply<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ ...message, ...scope }, (r: ServiceResponse) => {
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
        planId: r?.shieldedError?.planId,
        view: r?.shieldedError,
      })
    })
  })
}

// What a "Not sent" result adds under its message, each pointing only at what Private activity
// then offers for the payment.
function blockedNote(code: string, saved: boolean): string {
  switch (code) {
    case 'invalid_fee_approval':
      return OFFER_EXPIRED
    case 'fee_above_limit':
      return `${FEE_TOO_LARGE_NOTE}${saved ? ` ${STAYS_PENDING}` : ''}`
    case 'restore_failed':
      return saved ? RESTORE_NOT_SENT : ''
    default:
      return ''
  }
}

// The pool's admission delays are minutes on testnet and can be hours elsewhere.
function duration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`
  const hours = seconds / 3600
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

// The token in a result shows a payment pending until it lands, and a deposit until the network
// confirms it; screening and the payout of an unshield come after, and the note says so.
function planHero(p: ShieldedPlanView): 'pending' | 'success' | 'failed' {
  if (p.needsUserDecision || p.state === 'prepared' || p.state === 'submitted') return 'pending'
  if (p.state === 'dead') return 'failed'
  return p.state === 'superseded' ? 'pending' : 'success'
}

function depositHero(d: ShieldedDepositView): 'pending' | 'success' | 'failed' {
  if (d.state === 'submitting' || d.state === 'unresolved') return 'pending'
  return d.state === 'failed' ? 'failed' : 'success'
}

export default function ShieldedSend({
  action,
  retryPlan,
  retrySelfRelay = false,
  status,
  poolId,
  assetLabel,
  decimals,
  assetCode,
  assetIcon,
  native = false,
  usdPrice,
  accountPk,
  publicBalance = null,
  subentryCount = 0,
  onChangeAsset,
  onOpenPlan,
  onHistory,
  onClose,
  onDone,
}: ShieldedSendProps) {
  const [recipient, setRecipient] = useState('')
  // Send and unshield ask who first, on a page of its own, as public Send does.
  const [stage, setStage] = useState<'recipient' | 'form'>('form')
  const [amount, setAmount] = useState('')
  const [selfRelay, setSelfRelay] = useState(false)
  const [shieldAnyway, setShieldAnyway] = useState(false)
  // The SDK refused a shield because a deposit is submitting, which a stale status may not show yet.
  const [refusedWhileSubmitting, setRefusedWhileSubmitting] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)
  // The fee a new send or unshield would pay now, or why the relayer could not say.
  const [quote, setQuote] = useState<ShieldedQuoteView | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  // The pool's deposit limits for a shield, or why they could not be read.
  const [limits, setLimits] = useState<ShieldedLimitsView | null>(null)
  const [limitsError, setLimitsError] = useState<string | null>(null)
  // The network fee a shield paid, once Horizon has its transaction.
  const [shieldFee, setShieldFee] = useState<string | null>(null)
  // Each opening of the page is a session; a reply from an older session, or one that arrives once
  // the page is closed, never paints.
  const sessionRef = useRef(0)
  const openRef = useRef(false)
  // The port held for the payment in progress, whose token goes with its request: once the port
  // goes, the background declines the payment's open review and any it would still get. And the
  // last review shown, which the next reply answers.
  const flowPortRef = useRef<chrome.runtime.Port | null>(null)
  const lastReviewRef = useRef<ShieldedReviewView | null>(null)
  const stepKindRef = useRef<Step['kind']>('form')
  stepKindRef.current = step.kind
  // When the current deposit or payment began, to tell its saved payment from older ones.
  const flowStartRef = useRef(0)
  // The most the user approved in the fee review just answered, so a fee that rose past it is
  // shown as changed; any other start of a request forgets it.
  const approvedRef = useRef<string | null>(null)
  // The saved payment a fee approval or a self-paid retry continues: whatever becomes of the
  // request, the user lands on a result or a review of it, never back on an empty form.
  const heldRef = useRef<string | null>(null)
  // The most the user approved for the self-relayed retry in progress, which a review the SDK then
  // asks shows in place of the default.
  const flowMostRef = useRef<string | null>(null)
  // The user chose to send another private payment beside an unfinished one to the same address.
  const sendAnotherRef = useRef(false)
  const stellarChain = useStellarChain()
  const { accounts } = useWallet()
  const { activeNetwork } = useNetwork()
  const { formatValue, getExplorerTxUrl } = usePreferences()
  // Requests name the scope fixed when the page opened, not at click time, so a control left on
  // screen after a network or account switch elsewhere is refused.
  const shownScope: ShieldedScope = { networkId: activeNetwork.id, publicKey: accountPk }
  const shownScopeRef = useRef(shownScope)
  shownScopeRef.current = shownScope
  const sessionScopeRef = useRef(shownScope)

  // Keep the last non-null action so content stays visible during the close slide.
  const lastActionRef = useRef<ShieldedAction | null>(null)
  if (action) lastActionRef.current = action
  const a = action ?? lastActionRef.current
  const open = action !== null
  openRef.current = open
  const chipCode = native ? 'XLM' : (assetCode ?? assetLabel)
  const unit = (units: string | bigint) => `${formatUnits(units, decimals)} ${chipCode}`
  const fiatOf = (units: string | bigint): string | null =>
    usdPrice === null ? null : formatValue(Number(formatUnits(units, decimals)) * usdPrice)

  const releaseFlow = useCallback(() => {
    flowPortRef.current?.disconnect()
    flowPortRef.current = null
  }, [])

  // Proving and submitting go on in the background whatever the page does, so the page stays
  // until they report back rather than lose their result.
  const busy =
    step.kind === 'preparing' ||
    step.kind === 'working' ||
    step.kind === 'cancelling' ||
    ((step.kind === 'fee' || step.kind === 'refused') && step.working)

  const close = useCallback(() => {
    if (busy) return
    releaseFlow()
    onClose()
  }, [busy, releaseFlow, onClose])

  useEffect(() => releaseFlow, [releaseFlow])

  // A service worker that gets no event for 30 seconds may stop, and the open review with it, so
  // a cheap status read keeps it awake while the user reads the review.
  useEffect(() => {
    if (step.kind !== 'review') return
    const timer = setInterval(() => {
      chrome.runtime.sendMessage({
        type: SERVICE_TYPES.SHIELDED_STATUS,
        poolId,
        ...sessionScopeRef.current,
      })
    }, 20_000)
    return () => clearInterval(timer)
  }, [step.kind, poolId])

  // A review comes back from the background either as the first step of a spend or after a
  // relayer raised its fee; anything else ends the spend. A saved payment that waits on the user,
  // for a fee to approve or a relayer's refusal, goes on only through a retry of its plan. The end
  // of a spend whose answered review was repriced is never a fresh start, since that payment is
  // saved and may still land.
  const followStep = useCallback(
    (reply: Reply<ShieldedStep>) => {
      const answered = lastReviewRef.current
      const approved = approvedRef.current
      approvedRef.current = null
      const held = heldRef.current
      if (!reply.ok || reply.value.kind !== 'review') {
        lastReviewRef.current = null
        heldRef.current = null
        releaseFlow()
      }
      if (!reply.ok) {
        const view = reply.view
        const planId = view?.planId
        if (view?.fee && planId) {
          setStep({
            kind: 'fee',
            fee: view.fee,
            target: { kind: 'retry', planId },
            approved,
            working: false,
          })
        } else if (view?.refusal && planId) {
          setStep({
            kind: 'refused',
            refusal: view.refusal,
            selfPay: view.selfPay,
            planId,
            fee: answered && !answered.selfRelay ? answered.fee : null,
            working: false,
          })
        } else if (view?.openPlanId) {
          setStep({ kind: 'open', planId: view.openPlanId, send: false })
        } else if (planId && !reply.mayLand && view) {
          setStep({
            kind: 'blocked',
            code: view.code,
            message: reply.error,
            planId,
            hash: view.hash,
          })
        } else if (reply.mayLand || answered?.repriced) {
          // A relayed withdrawal retried after a stall that the relayer refuses again may go
          // through when the account submits it.
          const refusedAgain =
            reply.code === 'service_rejected' &&
            retryPlan?.kind === 'unshield' &&
            answered?.selfRelay === false
          setStep({
            kind: 'stopped',
            message: refusedAgain ? `${reply.error} ${RELAY_KEEPS_FAILING}` : reply.error,
            planId: reply.planId,
          })
        } else if (held) {
          setStep({
            kind: 'blocked',
            code: reply.code ?? 'unexpected',
            message:
              reply.code === 'not_confirmed'
                ? 'Nothing was sent. The payment waits in Private activity, where its retry spends the same notes.'
                : reply.error,
            planId: held,
          })
        } else {
          if (reply.code !== 'not_confirmed') {
            const kind = retryPlan?.kind ?? (a === 'send' || a === 'unshield' ? a : null)
            const hint = view?.queued && kind ? queuedCapHint(kind) : ''
            setError(reply.error + hint)
          }
          setStep({ kind: retryPlan ? 'retry' : 'form' })
        }
        onDone()
        return
      }
      if (reply.value.kind === 'review') {
        lastReviewRef.current = reply.value.review
        setStep({ kind: 'review', review: reply.value.review })
        return
      }
      const { planId, txHash, fee } = reply.value
      setStep({ kind: 'submitted', planId, txHash, fee })
      onDone()
    },
    [onDone, retryPlan, releaseFlow, a]
  )

  // Opens the port for a new payment and returns the token its request carries. The port drops
  // from the background's side only when the service worker stopped, which takes a shown review
  // with it; a request still waiting reports that itself.
  const beginFlow = useCallback((): string => {
    releaseFlow()
    flowStartRef.current = Date.now()
    const holder = crypto.randomUUID()
    const port = chrome.runtime.connect({ name: SHIELDED_REVIEW_PORT + holder })
    port.onDisconnect.addListener(() => {
      if (flowPortRef.current !== port) return
      flowPortRef.current = null
      const review = lastReviewRef.current
      if (stepKindRef.current !== 'review' || !review) return
      lastReviewRef.current = null
      if (review.repriced) {
        setStep({ kind: 'stopped', message: 'The extension restarted during the review.' })
        onDone()
      } else {
        setError('The review closed before it was answered. Review again.')
        setStep({ kind: retryPlan ? 'retry' : 'form' })
      }
    })
    flowPortRef.current = port
    return holder
  }, [releaseFlow, onDone, retryPlan])

  // Opening starts a session. Ending one, by closing the page here or from the parent as on an
  // account or network switch, or by opening it for another action, lets its payment's port go.
  useEffect(() => {
    sessionRef.current++
    releaseFlow()
    if (!open) return
    sessionScopeRef.current = shownScopeRef.current
    setRecipient(retryPlan?.to ?? '')
    setStage(retryPlan || action === 'shield' ? 'form' : 'recipient')
    setAmount(retryPlan ? formatUnits(retryPlan.amount, decimals) : '')
    setSelfRelay(retryPlan?.route.kind === 'self' || (retryPlan !== null && retrySelfRelay))
    setShieldAnyway(false)
    setRefusedWhileSubmitting(false)
    setError(null)
    approvedRef.current = null
    heldRef.current = null
    flowMostRef.current = null
    setStep({ kind: retryPlan ? 'retry' : 'form' })
  }, [open, action, retryPlan, retrySelfRelay, decimals, releaseFlow])

  // Asked again when the route changes, or when a sync changes what the notes can pay.
  const spendable = status?.balance.spendable
  useEffect(() => {
    setQuote(null)
    setQuoteError(null)
    if (!open || retryPlan || (a !== 'send' && a !== 'unshield')) return
    let current = true
    ask(
      sessionScopeRef.current,
      {
        type: SERVICE_TYPES.SHIELDED_QUOTE,
        poolId,
        kind: a,
        selfRelay: a === 'unshield' && selfRelay,
      },
      (r) => r.shieldedQuote
    ).then((reply) => {
      if (!current) return
      if (reply.ok) setQuote(reply.value)
      else setQuoteError(reply.error)
    })
    return () => {
      current = false
    }
  }, [open, a, retryPlan, poolId, selfRelay, spendable])

  useEffect(() => {
    setLimits(null)
    setLimitsError(null)
    if (!open || a !== 'shield') return
    let current = true
    ask(
      sessionScopeRef.current,
      { type: SERVICE_TYPES.SHIELDED_LIMITS, poolId },
      (r) => r.shieldedLimits
    ).then((reply) => {
      if (!current) return
      if (reply.ok) setLimits(reply.value)
      else setLimitsError(reply.error)
    })
    return () => {
      current = false
    }
  }, [open, a, poolId])

  // The account submitted the shield itself, so its fee is public anyway.
  const shieldHash = step.kind === 'shielded' ? step.receipt.txHash : null
  useEffect(() => {
    setShieldFee(null)
    if (!shieldHash) return
    let current = true
    fetch(`${activeNetwork.horizonUrl}/transactions/${shieldHash}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tx: { fee_charged?: string } | null) => {
        if (current && tx?.fee_charged) setShieldFee(trimZeros(stroopsToXlm(tx.fee_charged)))
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [shieldHash, activeNetwork.horizonUrl])

  // A payment request of this session. A reply that comes after the session ended is dropped; the
  // background declined any review in it when the session's port went.
  const requestStep = useCallback(async (message: object): Promise<Reply<ShieldedStep> | null> => {
    const session = sessionRef.current
    const reply = await ask(sessionScopeRef.current, message, (r) => r.shieldedStep)
    return session === sessionRef.current && openRef.current ? reply : null
  }, [])

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
  // What the notes cannot pay in one payment once the fee is taken.
  const maxAmount = a !== 'shield' && quote?.maxAmount ? BigInt(quote.maxAmount) : null
  const exceedsOnePayment =
    !exceedsBalance && units !== null && maxAmount !== null && units > maxAmount
  // Why the pool would refuse this deposit now, as far as its limits tell.
  const depositRefusal =
    a !== 'shield' || !limits || units === null || units <= 0n
      ? null
      : limits.depositsPaused || limits.haltedUntil !== null
        ? 'The pool is not taking deposits now.'
        : units < BigInt(limits.minDeposit)
          ? `The smallest deposit the pool takes is ${unit(limits.minDeposit)}.`
          : units > BigInt(limits.depositRoom)
            ? `The pool takes at most ${unit(limits.depositRoom)} from this account now.`
            : null
  const amountError = exceedsBalance
    ? 'Exceeds balance'
    : exceedsOnePayment && maxAmount !== null
      ? `One payment can move at most ${unit(maxAmount)} after the fee`
      : depositRefusal

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
    !exceedsOnePayment &&
    depositRefusal === null &&
    (a === 'shield' || to !== '') &&
    recipientValid

  function fill(fraction: number) {
    if (balanceUnits === null) return
    const max = maxAmount ?? balanceUnits
    const portion = fraction === 1 ? max : fractionUnits(balanceUnits, fraction)
    setAmount(portion > 0n ? formatUnits(portion, decimals) : '0')
  }

  function reviewRetry() {
    if (!retryPlan) return
    setError(null)
    approvedRef.current = null
    heldRef.current = null
    flowMostRef.current = null
    setStep({ kind: 'preparing' })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_RETRY,
      poolId,
      holder: beginFlow(),
      planId: retryPlan.planId,
      kind: retryPlan.kind,
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
    // A private send to an address an unfinished payment of this account is paying: continuing that
    // one spends its notes, so only one can arrive; another payment is the user's choice.
    const unfinished =
      a === 'send' && !sendAnotherRef.current && status
        ? unfinishedSendTo(status.plans, to)
        : undefined
    sendAnotherRef.current = false
    if (unfinished) {
      setStep({ kind: 'open', planId: unfinished.planId, send: true })
      return
    }
    approvedRef.current = null
    heldRef.current = null
    flowMostRef.current = null
    setStep({ kind: 'preparing' })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_SPEND,
      poolId,
      holder: beginFlow(),
      kind: a,
      to,
      amount: units.toString(),
      selfRelay: a === 'unshield' && selfRelay,
    }).then((reply) => reply && followStep(reply))
  }

  // Both answers wait for what the SDK made of them: declining a repriced review still leaves its
  // saved payment, which may land.
  function answerReview(r: ShieldedReviewView, approve: boolean) {
    setStep(approve ? { kind: 'working', review: r } : { kind: 'cancelling', review: r })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_DECIDE,
      reviewId: r.reviewId,
      approve,
      poolId,
      kind: r.kind,
    }).then((reply) => reply && followStep(reply))
  }

  // A shield goes with the default caps, or, after a fee review, with the background's offer the
  // user approved, which holds the shield to the most it showed. A fee above that stops it before
  // anything is signed, and the failed deposit is void: the approval proves and sends a new one.
  function approveShield(approval?: string, approved?: string) {
    if (units === null) return
    const session = sessionRef.current
    flowStartRef.current = Date.now()
    if (!approval) setStep({ kind: 'working' })
    ask(
      sessionScopeRef.current,
      {
        type: SERVICE_TYPES.SHIELDED_SHIELD,
        poolId,
        amount: units.toString(),
        whileSubmitting: submittingDeposit && shieldAnyway,
        feeApproval: approval,
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
        if (reply.view?.fee) {
          setStep({
            kind: 'fee',
            fee: reply.view.fee,
            target: { kind: 'shield' },
            approved: approved ?? null,
            working: false,
          })
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

  // Approving a fee review returns the background's offer for that call alone: the shield, or the
  // saved payment's retry with the same notes, self-relayed, held to the most the review showed.
  function approveFee(s: FeeStep) {
    setStep({ ...s, working: true })
    if (s.target.kind === 'shield') {
      approveShield(s.fee.approval, s.fee.most)
      return
    }
    approvedRef.current = s.fee.most
    heldRef.current = s.target.planId
    flowMostRef.current = s.fee.most
    requestStep({
      type: SERVICE_TYPES.SHIELDED_RETRY,
      poolId,
      holder: beginFlow(),
      planId: s.target.planId,
      kind: 'unshield',
      selfRelay: true,
      feeApproval: s.fee.approval,
    }).then((reply) => reply && followStep(reply))
  }

  // Declining sends nothing more: a shield goes back to its confirm, and a saved payment waits,
  // its notes kept, for a review from Private activity.
  function declineFee(s: FeeStep, timedOut: boolean) {
    dropOffer(s.fee.approval, sessionScopeRef.current)
    if (s.target.kind === 'shield') {
      setStep({ kind: 'shield-review' })
      if (timedOut) setError(REVIEW_TIMED_OUT)
      return
    }
    setStep({ kind: 'waiting', planId: s.target.planId, timedOut })
    onDone()
  }

  // The relayer did not send a saved withdrawal; the account submits it with the same notes, at
  // most the default caps, and a fee above them comes back as a fee review.
  function payRefused(s: RefusedStep) {
    approvedRef.current = null
    heldRef.current = s.planId
    flowMostRef.current = null
    setStep({ ...s, working: true })
    requestStep({
      type: SERVICE_TYPES.SHIELDED_RETRY,
      poolId,
      holder: beginFlow(),
      planId: s.planId,
      kind: 'unshield',
      selfRelay: true,
      feeApproval: s.selfPay,
    }).then((reply) => reply && followStep(reply))
  }

  // A fee review left unanswered is declined, as a payment review is.
  const feeTimeoutRef = useRef<FeeStep | null>(null)
  feeTimeoutRef.current = step.kind === 'fee' && !step.working ? step : null
  useEffect(() => {
    if (step.kind !== 'fee' || step.working) return
    const timer = setTimeout(() => {
      const s = feeTimeoutRef.current
      if (s) declineFee(s, true)
    }, FEE_REVIEW_TIMEOUT_MS)
    return () => clearTimeout(timer)
    // A new fee or a new answer to it starts the clock again; renders in between do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // The payment or deposit a result is about, as the latest sync shows it. A stopped payment the
  // reply does not name is found by what it was made of: one of this flow's amount, saved since
  // the flow began and still able to land; with no single match the result says what it knows
  // without it.
  function resultPlan(s: ResultStep): ShieldedPlanView | null {
    if (!status) return null
    if (s.kind === 'submitted' || s.kind === 'waiting') {
      return status.plans.find((p) => p.planId === s.planId) ?? null
    }
    if (s.kind === 'blocked') {
      return s.planId ? (status.plans.find((p) => p.planId === s.planId) ?? null) : null
    }
    if (s.kind !== 'stopped' || a === 'shield') return null
    if (s.planId) return status.plans.find((p) => p.planId === s.planId) ?? null
    if (units === null) return null
    const matches = status.plans.filter(
      (p) =>
        p.kind === a &&
        p.amount === units.toString() &&
        p.createdAt >= flowStartRef.current - CLOCK_SKEW_MS &&
        (p.state === 'prepared' || p.state === 'submitted')
    )
    return matches.length === 1 ? matches[0] : null
  }

  function resultDeposit(s: ResultStep): ShieldedDepositView | null {
    if (!status || a !== 'shield') return null
    if (s.kind === 'shielded') {
      return status.deposits.find((d) => d.txHash === s.receipt.txHash) ?? null
    }
    if (s.kind !== 'stopped' || units === null) return null
    const matches = status.deposits.filter(
      (d) => d.state === 'submitting' && d.amount === units.toString()
    )
    return matches.length === 1 ? matches[0] : null
  }

  const view: SheetView | null =
    step.kind === 'shield-review' || (step.kind === 'working' && !step.review)
      ? { kind: 'shield' }
      : step.kind === 'review' || step.kind === 'working' || step.kind === 'cancelling'
        ? step.review
          ? { kind: 'spend', review: step.review }
          : null
        : step.kind === 'fee'
          ? { kind: 'fee', step }
          : step.kind === 'refused'
            ? { kind: 'refused', step }
            : step.kind === 'open'
              ? { kind: 'open', planId: step.planId, send: step.send }
              : step.kind === 'shielded' ||
                  step.kind === 'submitted' ||
                  step.kind === 'stopped' ||
                  step.kind === 'waiting' ||
                  step.kind === 'blocked'
                ? { kind: 'result', step }
                : null
  // Keep the last view so the sheet's content stays during its close slide.
  const lastViewRef = useRef<SheetView | null>(null)
  if (open && view) lastViewRef.current = view
  const sheetView = open && view ? view : lastViewRef.current

  // A private address in the place of an account's avatar, the same size.
  function privateAvatar(address: string) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center">
        <PrivateAddressAvatar address={address} size={32} />
      </span>
    )
  }

  function accountLabel(address: string): string | undefined {
    const account = accounts.find((x) => x.publicKey === address)
    return account ? account.label || `Account ${account.index + 1}` : undefined
  }

  function recipientStep() {
    if (!a) return null
    const sending = a === 'send'
    const ready = to !== '' && recipientValid
    // The active account first: unshielding to it is the common case.
    const own = [...accounts].sort(
      (x, y) => Number(y.publicKey === accountPk) - Number(x.publicKey === accountPk)
    )
    return (
      <RecipientStepPage
        title={TITLES[a]}
        placeholder={sending ? `Private address (${privatePrefix}...)` : 'Stellar address (G...)'}
        value={recipient}
        onValue={(v) => {
          setRecipient(v)
          if (error) setError(null)
        }}
        avatar={
          ready &&
          (sending ? (
            privateAvatar(to)
          ) : (
            <AddressAvatar address={to} chainIcon={stellarChain.icon} />
          ))
        }
        hint={
          ready
            ? sending
              ? 'Private address, paid inside the pool'
              : 'Stellar address'
            : sending
              ? `Private addresses on this network start with ${privatePrefix}`
              : 'Not a Stellar address (G..., M... or C...)'
        }
        ready={ready}
        onBack={close}
        onContinue={() => setStage('form')}
      >
        {sending ? (
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            The person you pay finds their private address under Receive in private mode.
          </p>
        ) : (
          <SuggestionSection title="Your accounts">
            {own.map((account) => (
              <SuggestionRow
                key={account.publicKey}
                avatar={<AddressAvatar address={account.publicKey} chainIcon={stellarChain.icon} />}
                title={accountLabel(account.publicKey) ?? shortAddress(account.publicKey)}
                subtitle={`${shortAddress(account.publicKey)} on Stellar`}
                onPick={() => {
                  setRecipient(account.publicKey)
                  setStage('form')
                }}
              />
            ))}
          </SuggestionSection>
        )}
      </RecipientStepPage>
    )
  }

  function recipientCard() {
    if (a === 'shield') {
      return (
        status && (
          <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
            <p className="pixel-label text-[10px] text-muted-foreground">To</p>
            <RecipientRow
              address={status.address}
              label="Your private balance"
              networkName="Private pool"
              avatar={privateAvatar(status.address)}
            />
          </div>
        )
      )
    }
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3">
        <p className="pixel-label text-[10px] text-muted-foreground">To</p>
        <RecipientRow
          address={to}
          label={a === 'send' ? undefined : accountLabel(to)}
          networkName={a === 'send' ? 'Private pool' : 'Stellar'}
          chainIcon={stellarChain.icon}
          avatar={a === 'send' ? privateAvatar(to) : undefined}
          onChange={() => setStage('recipient')}
        />
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

  function formFields() {
    if (!a) return null
    const fiat = fiatOf(units ?? 0n)
    return (
      <>
        {recipientCard()}

        <SideCard
          label={AMOUNT_LABELS[a]}
          corner={
            a === 'shield'
              ? publicBalance === null
                ? 'Balance: -'
                : formatBalanceText(publicBalance, chipCode, decimals)
              : balanceUnits === null
                ? 'Available: -'
                : `Available: ${unit(balanceUnits)}`
          }
          chip={{
            code: chipCode,
            verified: true,
            icon: assetIcon,
            chainIcon: stellarChain.icon,
            subLabel: a === 'shield' ? 'Stellar' : 'Private pool',
            onPick: () => onChangeAsset?.(),
            ariaLabel: 'Change asset',
          }}
          value={<AmountInput value={amount} onChange={setAmount} />}
          footAsset={
            balanceUnits !== null ? (
              // A private Max leaves room for the quoted fee, so it waits for the quote; shield
              // keeps its fee back from the public balance instead.
              <QuickFillChips onFill={fill} max={a === 'shield' || maxAmount !== null} />
            ) : null
          }
          footAmount={fiat ?? ''}
          error={amountError}
        />

        {a === 'unshield' && selfRelayOption()}

        {a !== 'shield' && (
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            {a === 'unshield' && selfRelay
              ? `No relayer fee; your account pays the network fee, at most ${formatUnits(NETWORK_FEE_CAP_STROOPS, 7)} XLM.`
              : quote
                ? `Relayer fee ${unit(quote.fee)}, confirmed on the next step before anything is sent.`
                : quoteError
                  ? `No fee quote yet: ${quoteError} The next step asks again.`
                  : 'Asking the relayer for its fee...'}
          </p>
        )}
      </>
    )
  }

  function retrySummary() {
    if (!retryPlan) return null
    return (
      <>
        <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4">
          <AssetIcon code={chipCode} icon={assetIcon} chainIcons={[stellarChain.icon]} />
          <div className="min-w-0">
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {formatUnits(retryPlan.amount, decimals)}{' '}
              <span className="text-base font-medium text-muted-foreground">{chipCode}</span>
              <VerifiedBadge className="ml-1 inline-block h-4 w-4 align-[-2px]" />
            </p>
            {fiatOf(retryPlan.amount) && (
              <p className="text-xs text-muted-foreground">{fiatOf(retryPlan.amount)}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
          <DetailRow label="To">
            {retryPlan.kind === 'send' ? (
              <PrivateAddressValue address={retryPlan.to} />
            ) : (
              <AddressValue address={retryPlan.to} isYou={retryPlan.to === accountPk} />
            )}
          </DetailRow>
          <DetailRow label="Went through">{routeText(retryPlan)}</DetailRow>
        </div>
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          The retry spends the same notes as the stalled payment, so at most one of them can land,
          and goes the same way unless you change it. Any fee is shown on the next step, before
          anything is sent.
        </p>
        {retryPlan.kind === 'unshield' && selfRelayOption()}
      </>
    )
  }

  // The amount at the top of a confirm step, the token spinning while it is proved and submitted.
  function amountCard(value: string | bigint) {
    const fiat = fiatOf(value)
    return (
      <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-4">
        {busy ? (
          <TokenStatusIcon
            state="pending"
            code={chipCode}
            icon={assetIcon}
            chainIcon={stellarChain.icon}
            size="sm"
            className="-m-1"
          />
        ) : (
          <AssetIcon code={chipCode} icon={assetIcon} chainIcons={[stellarChain.icon]} />
        )}
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {formatUnits(value, decimals)}{' '}
            <span className="text-base font-medium text-muted-foreground">{chipCode}</span>
            <VerifiedBadge className="ml-1 inline-block h-4 w-4 align-[-2px]" />
          </p>
          {fiat && <p className="text-xs text-muted-foreground">{fiat}</p>}
        </div>
      </div>
    )
  }

  function privateBalanceValue() {
    return (
      <span className="inline-flex items-center gap-1.5">
        {status && <PrivateAddressAvatar address={status.address} size={14} />}
        Your private balance
      </span>
    )
  }

  function errorBox() {
    return (
      <Reveal show={!!error} gap={12}>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      </Reveal>
    )
  }

  function progressLine(text: string) {
    return (
      <Reveal show={busy} gap={12}>
        <p className="text-center text-xs text-muted-foreground">{text}</p>
      </Reveal>
    )
  }

  function shieldConfirm() {
    if (units === null) return null
    const working = step.kind === 'working'
    return (
      <>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
          {amountCard(units)}
          <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
            <DetailRow label="From">
              <AddressValue address={accountPk} />
            </DetailRow>
            <DetailRow label="To">{privateBalanceValue()}</DetailRow>
            <DetailRow label="Network">
              <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
            </DetailRow>
            <DetailRow label="Network fee">{NETWORK_FEE_CAP}</DetailRow>
            {limits && (
              <>
                <DetailRow label="Pool takes">
                  {unit(limits.minDeposit)} to {unit(limits.depositRoom)} now
                </DetailRow>
                <DetailRow label="Usable after">
                  Screening and{' '}
                  {duration(
                    units >= BigInt(limits.largeDepositThreshold)
                      ? limits.delayLarge
                      : limits.delaySmall
                  )}
                </DetailRow>
              </>
            )}
          </div>
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            {limits
              ? `Deposits are screened, then wait ${duration(limits.delaySmall)} before they can be spent, or ${duration(limits.delayLarge)} from ${unit(limits.largeDepositThreshold)}; the pending deposit shows when. Your account is public as the depositor.`
              : "Deposits are screened and wait out the pool's delay before they can be spent; the pending deposit shows when. Your account is public as the depositor."}
          </p>
          {limitsError && (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              The pool's limits could not be read: {limitsError}
            </p>
          )}
          {submittingDeposit && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-amber-500/10 px-4 py-3">
              <input
                type="checkbox"
                checked={shieldAnyway}
                disabled={working}
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
          {errorBox()}
          {progressLine(`Signing and submitting to ${stellarChain.name}...`)}
        </div>
        <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
          <Button
            variant="outline"
            className="flex-1"
            disabled={working}
            onClick={() => setStep({ kind: 'form' })}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={working || (submittingDeposit && !shieldAnyway) || depositRefusal !== null}
            onClick={() => approveShield()}
          >
            {working ? 'Sending...' : `Shield ${formatUnits(units, decimals)} ${chipCode}`}
          </Button>
        </div>
      </>
    )
  }

  function spendConfirm(r: ShieldedReviewView) {
    const total = BigInt(r.amount) + BigInt(r.fee)
    return (
      <>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
          {r.repriced && (
            <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
              The relayer raised its fee after the payment was saved. Sending proves it again with
              the same notes; cancelling leaves the saved payment, which may still land.
            </p>
          )}
          {amountCard(r.amount)}
          <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
            <DetailRow label="From">{privateBalanceValue()}</DetailRow>
            <DetailRow label="To">
              {r.kind === 'send' ? (
                <PrivateAddressValue address={r.to} />
              ) : (
                <AddressValue address={r.to} isYou={r.to === accountPk} />
              )}
            </DetailRow>
            <DetailRow label="Network">
              <NetworkValue name={stellarChain.name} icon={stellarChain.icon} />
            </DetailRow>
            {r.selfRelay ? (
              <DetailRow label="Network fee">
                {flowMostRef.current === null
                  ? NETWORK_FEE_CAP
                  : `Up to ${formatUnits(flowMostRef.current, 7)} XLM, from your account`}
              </DetailRow>
            ) : (
              <DetailRow label="Relayer fee">
                <span className="tabular-nums">
                  {unit(r.fee)}
                  {fiatOf(r.fee) && (
                    <span className="ml-1 text-muted-foreground">{fiatOf(r.fee)}</span>
                  )}
                </span>
              </DetailRow>
            )}
            <DetailRow label="Total">
              <span className="tabular-nums">{unit(total)}</span>
            </DetailRow>
          </div>
          {r.queued && (
            <p className="flex gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              {queuedNote(
                r.kind,
                formatUnits(r.fee, decimals),
                formatUnits(r.queued.usual, decimals)
              )}
            </p>
          )}
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
          {progressLine(
            step.kind === 'cancelling'
              ? 'Cancelling...'
              : 'Proving on this device and submitting. This can take a minute.'
          )}
        </div>
        <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => answerReview(r, false)}
          >
            {step.kind === 'cancelling' ? 'Cancelling...' : 'Cancel'}
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => answerReview(r, true)}>
            {step.kind === 'working'
              ? 'Sending...'
              : `${r.kind === 'send' ? 'Send' : 'Unshield'} ${formatUnits(r.amount, decimals)} ${chipCode}`}
          </Button>
        </div>
      </>
    )
  }

  function result(s: ResultStep) {
    const plan = resultPlan(s)
    const deposit = resultDeposit(s)
    const live: ItemStatus | null = plan
      ? planStatus(plan, unit)
      : deposit
        ? depositStatus(deposit)
        : null
    const hash =
      s.kind === 'shielded'
        ? s.receipt.txHash
        : s.kind === 'submitted'
          ? s.txHash
          : s.kind === 'blocked'
            ? (s.hash ?? null)
            : null
    const shielding = a === 'shield'
    const value = s.kind === 'submitted' && plan ? plan.amount : (units ?? 0n)
    const dest = plan?.to ?? to
    const relayed = plan ? plan.route.kind === 'relayer' : !shielding && !selfRelay
    const hero =
      s.kind === 'blocked'
        ? 'failed'
        : s.kind === 'waiting'
          ? 'pending'
          : plan
            ? planHero(plan)
            : deposit
              ? depositHero(deposit)
              : s.kind === 'shielded' && s.receipt.depositId !== null
                ? 'success'
                : 'pending'
    const fallbackNote =
      s.kind === 'waiting'
        ? `${s.timedOut ? `${REVIEW_TIMED_OUT} ` : ''}${WAITING_NOTE}`
        : s.kind === 'blocked'
          ? s.message
          : s.kind === 'shielded'
            ? s.receipt.depositId === null
              ? 'Its deposit ID appears once the network confirms it. It can be spent after screening.'
              : 'It can be spent once screening admits it. Follow it under Private activity.'
            : s.kind === 'submitted'
              ? 'It counts once the pool shows it landed. Follow it under Private activity.'
              : shielding
                ? 'Private activity follows the deposit until it lands or its deadline passes.'
                : 'Private activity follows it until it lands or its deadline passes.'
    return (
      <>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5 [&>*]:shrink-0">
          <TxResultHero
            state={hero}
            amountText={`${shielding ? '+' : '-'}${formatUnits(value, decimals)}`}
            code={chipCode}
            icon={assetIcon}
            chainIcon={stellarChain.icon}
            verified
            positive={shielding}
            subtitle={
              shielding
                ? 'to your private balance'
                : `to ${dest === accountPk ? 'your account' : shortAddress(dest)}`
            }
            note={
              s.kind === 'waiting' || s.kind === 'blocked'
                ? fallbackNote
                : (live?.detail ?? fallbackNote)
            }
          />
          {s.kind === 'blocked' && (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              {blockedNote(s.code, s.planId !== undefined)}
            </p>
          )}
          {s.kind === 'stopped' && (
            <>
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
                <p className="text-xs text-destructive">{s.message}</p>
              </div>
              <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-xs leading-snug text-amber-700 dark:text-amber-400">
                {shielding
                  ? 'Check Private activity before shielding again: if the deposit lands, it is deposited.'
                  : 'Do not send it again. If its deadline passes without it landing, Private activity offers a retry with the same notes.'}
              </p>
            </>
          )}
          <div className="flex flex-col divide-y divide-border/60 rounded-xl bg-card px-4">
            {live && <DetailRow label="Status">{live.label}</DetailRow>}
            {shielding ? (
              <DetailRow label="From">
                <AddressValue address={accountPk} />
              </DetailRow>
            ) : (
              <DetailRow label="To">
                {a === 'send' ? (
                  <PrivateAddressValue address={dest} />
                ) : (
                  <AddressValue address={dest} isYou={dest === accountPk} />
                )}
              </DetailRow>
            )}
            {shielding ? (
              <DetailRow label="Network fee">
                <span className="tabular-nums">
                  {shieldFee ? `${shieldFee} XLM` : NETWORK_FEE_CAP}
                </span>
              </DetailRow>
            ) : s.kind === 'submitted' && relayed ? (
              <DetailRow label="Relayer fee">
                <span className="tabular-nums">{unit(s.fee)}</span>
              </DetailRow>
            ) : (
              !relayed && <DetailRow label="Network fee">{NETWORK_FEE_CAP}</DetailRow>
            )}
            {plan && <DetailRow label="Route">{routeText(plan)}</DetailRow>}
            {s.kind === 'shielded' && s.receipt.depositId !== null && (
              <DetailRow label="Deposit">#{s.receipt.depositId}</DetailRow>
            )}
            {hash && (
              <DetailRow label="Transaction">
                <CopyValue value={hash} />
              </DetailRow>
            )}
          </div>
          {hash && relayed && (
            <p className="px-1 text-center text-[11px] leading-snug text-muted-foreground">
              The explorer learns that this browser looked at this transaction.
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
          {hash && (
            <Button variant="outline" className="flex-1" asChild>
              <a
                href={getExplorerTxUrl(hash, activeNetwork.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5"
              >
                View on explorer <ExternalLink size={14} />
              </a>
            </Button>
          )}
          <Button variant={hash ? 'outline' : 'default'} className="flex-1" onClick={close}>
            Done
          </Button>
        </div>
      </>
    )
  }

  const sheetTitle = !sheetView
    ? ''
    : sheetView.kind === 'shield'
      ? 'Confirm shield'
      : sheetView.kind === 'spend'
        ? sheetView.review.kind === 'send'
          ? 'Confirm private send'
          : 'Confirm unshield'
        : sheetView.kind === 'fee'
          ? feeTitle(sheetView.step.fee.reason, sheetView.step.fee.paid)
          : sheetView.kind === 'refused'
            ? refusalCopy(sheetView.step.refusal, 'send', null, '').title
            : sheetView.kind === 'open'
              ? OPEN_PAYMENT.title
              : resultTitle(sheetView.step)

  function resultTitle(s: ResultStep): string {
    switch (s.kind) {
      case 'shielded':
        return 'Deposit submitted'
      case 'submitted':
        return a === 'unshield' ? 'Unshield submitted' : 'Payment submitted'
      case 'waiting':
        return 'Waiting for your approval'
      case 'blocked':
        return s.code === 'fee_above_limit'
          ? 'Fee too large'
          : s.code === 'restore_failed'
            ? 'Restore did not go through'
            : 'Not sent'
      case 'stopped':
        return 'May still land'
    }
  }

  // XLM the account can spend on a fee, after its minimum balance and, for a shield, the deposit;
  // null when its balance is not known.
  function feeRoom(target: FeeStep['target']): bigint | null {
    if (!native || publicBalance === null) return null
    const reserve = (2n + BigInt(subentryCount)) * BASE_RESERVE_STROOPS
    const free = spendableUnits(publicBalance, decimals, undefined, reserve)
    return target.kind === 'shield' ? free - (units ?? 0n) : free
  }

  function feePayment(target: FeeStep['target']): bigint | null {
    if (target.kind === 'shield') return units
    const plan = status?.plans.find((p) => p.planId === target.planId) ?? retryPlan
    return plan ? BigInt(plan.amount) : units
  }

  function feeSheet(f: FeeStep) {
    const payment = feePayment(f.target)
    return (
      <FeeReviewBody
        fee={f.fee}
        subject={f.target.kind === 'shield' ? 'shield' : 'unshield'}
        account={accountPk}
        available={feeRoom(f.target)}
        payment={payment}
        approved={f.approved}
        working={f.working}
        progress={
          f.target.kind === 'shield'
            ? `Signing and submitting to ${stellarChain.name}...`
            : 'Proving on this device and submitting. This can take a minute.'
        }
        amountCard={payment === null ? null : amountCard(payment)}
        fiatOf={(v) => fiatOf(v)}
        onDecline={() => declineFee(f, false)}
        onApprove={() => approveFee(f)}
      />
    )
  }

  function refusedSheet(r: RefusedStep) {
    const kind = a === 'send' ? 'send' : 'unshield'
    const offered = refusalCopy(
      r.refusal,
      kind,
      r.fee === null ? null : formatUnits(r.fee, decimals),
      shortAddress(accountPk)
    )
    // Paying from the account goes only with the background's offer for this withdrawal.
    const copy = r.selfPay ? offered : { ...offered, payLabel: null, payNote: null }
    return (
      <RefusalBody
        copy={copy}
        working={r.working}
        progress="Proving on this device and submitting. This can take a minute."
        advanced={
          r.refusal === 'restore_needed' && (
            <PoolRestore
              poolId={poolId}
              scope={sessionScopeRef.current}
              account={accountPk}
              heldPayment
              available={feeRoom({ kind: 'retry', planId: r.planId })}
              fiatOf={(v) => fiatOf(v)}
              onChanged={onDone}
            />
          )
        }
        onLater={close}
        onPay={() => payRefused(r)}
      />
    )
  }

  function openSheet(planId: string, send: boolean) {
    const plan = status?.plans.find((p) => p.planId === planId) ?? null
    return (
      <OpenPaymentBody
        found={plan !== null}
        send={send}
        onBack={() => {
          if (!send) {
            setStep({ kind: 'form' })
            return
          }
          sendAnotherRef.current = true
          review()
        }}
        onOpen={() => {
          releaseFlow()
          if (plan) onOpenPlan(plan)
          else onHistory()
        }}
      />
    )
  }

  // Leaving a confirm step goes back to the form, declining a review on the way; a result closes.
  function leaveSheet() {
    if (busy || !view) return
    if (view.kind === 'shield') setStep({ kind: 'form' })
    else if (view.kind === 'spend') answerReview(view.review, false)
    else if (view.kind === 'fee') declineFee(view.step, false)
    else if (view.kind === 'open') setStep({ kind: 'form' })
    else close()
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (view) leaveSheet()
      else close()
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  })

  return (
    <>
      {a && (
        <PrivatePage
          open={open}
          navbarDisabled={busy}
          onHistory={() => {
            if (busy) return
            releaseFlow()
            onHistory()
          }}
        >
          {stage === 'recipient' && !retryPlan && a !== 'shield' ? (
            recipientStep()
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-5">
                <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4 py-4">
                  <div className="relative flex items-center justify-center">
                    <button
                      onClick={retryPlan || a === 'shield' ? close : () => setStage('recipient')}
                      aria-label="Go back"
                      className="absolute left-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <h2 className="text-lg font-bold text-foreground">
                      {retryPlan ? 'Retry payment' : TITLES[a]}
                    </h2>
                  </div>
                  {retryPlan ? retrySummary() : formFields()}
                </fieldset>
              </div>

              <div className="shrink-0 border-t border-border/40 px-5 pb-5 pt-3">
                <Reveal show={!!error && (step.kind === 'form' || step.kind === 'retry')}>
                  <p className="mb-3 text-xs text-destructive">{error}</p>
                </Reveal>
                <Reveal show={step.kind === 'preparing'}>
                  <p className="mb-3 text-center text-xs text-muted-foreground">
                    Syncing the pool and asking the relayer for a quote...
                  </p>
                </Reveal>
                <Button
                  className="w-full"
                  disabled={retryPlan ? step.kind !== 'retry' : !canReview}
                  onClick={retryPlan ? reviewRetry : review}
                >
                  {step.kind === 'preparing'
                    ? 'Preparing...'
                    : retryPlan
                      ? 'Review retry'
                      : 'Continue'}
                </Button>
              </div>
            </>
          )}
        </PrivatePage>
      )}

      <ConfirmSheet
        open={open && view !== null}
        title={sheetTitle}
        closeDisabled={busy}
        stepKey={
          !sheetView
            ? 'none'
            : sheetView.kind === 'spend'
              ? `spend:${sheetView.review.reviewId}`
              : sheetView.kind === 'result'
                ? `result:${sheetView.step.kind}`
                : sheetView.kind === 'fee'
                  ? `fee:${sheetView.step.fee.ceiling}`
                  : sheetView.kind
        }
        onClose={leaveSheet}
        onBackdrop={() => {
          if (view?.kind !== 'result') leaveSheet()
        }}
      >
        {sheetView?.kind === 'shield'
          ? shieldConfirm()
          : sheetView?.kind === 'spend'
            ? spendConfirm(sheetView.review)
            : sheetView?.kind === 'fee'
              ? feeSheet(sheetView.step)
              : sheetView?.kind === 'refused'
                ? refusedSheet(sheetView.step)
                : sheetView?.kind === 'open'
                  ? openSheet(sheetView.planId, sheetView.send)
                  : sheetView?.kind === 'result'
                    ? result(sheetView.step)
                    : null}
      </ConfirmSheet>
    </>
  )
}
