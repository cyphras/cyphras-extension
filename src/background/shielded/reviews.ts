import type { ConfirmSpend, SpendReview, Submission } from '@cyphras/private'
import { SHIELDED_REVIEW_PORT } from '@constants/services'
import type { ShieldedReviewView, ShieldedStep } from '@ext-types/index'
import { dropGrants } from './approvals'
import { ShieldedRefusal } from './errors'

// A review holds the account's other private operations until the user answers it, so one left
// unanswered is declined.
const REVIEW_TIMEOUT_MS = 3 * 60_000
// How long the outcome of a review declined without the popup's answer waits for that answer.
const OUTCOME_TTL_MS = 10 * 60_000

interface OpenReview {
  readonly holder: string
  decide(approve: boolean): Promise<ShieldedStep>
  decline(): void
}

const open = new Map<string, OpenReview>()
// Warning codes the user confirmed in a payment's flow, by the holder of its popup, and the holder
// of each review answered. An offer made after them carries the codes, so the retry it approves
// asks again only for a review that warns of something new.
const confirmedCodes = new Map<string, Set<string>>()
const reviewHolders = new Map<string, string>()

function noteConfirmed(holder: string, review: SpendReview): void {
  const codes = confirmedCodes.get(holder) ?? new Set<string>()
  for (const w of review.warnings) codes.add(w.code)
  confirmedCodes.set(holder, codes)
}

export function confirmedWarnings(holder: unknown): string[] {
  return typeof holder === 'string' ? [...(confirmedCodes.get(holder) ?? [])] : []
}

export function holderOfReview(reviewId: unknown): string | undefined {
  return typeof reviewId === 'string' ? reviewHolders.get(reviewId) : undefined
}
// Tokens of the ports popups hold for the payments they started.
const holders = new Set<string>()
// Moves on whenever the wallets close, as at a lock, so a spend that started before cannot be
// confirmed after.
let generation = 0
// Outcomes of reviews declined for the popup, as by a timeout. A late answer gets the outcome,
// with the plan a repriced spend already saved, rather than a fresh start.
const closed = new Map<string, Promise<ShieldedStep>>()

// SDK warnings whose text names the vault, in the words the wallet uses for it.
const WARNING_TEXT: Readonly<Record<string, string>> = {
  exit_will_queue:
    "The pool's daily payout limit is used up or its queue is not empty, so this payout waits in the queue.",
}

// `usual` is the relayer's fee for a payment the pool does not queue, beside which a queued fee is
// shown; unknown when its quote could not be read.
export function reviewView(
  reviewId: string,
  review: SpendReview,
  repriced: boolean,
  usual: bigint | undefined
): ShieldedReviewView {
  const queued =
    review.queued && review.relayer !== undefined && usual !== undefined && review.fee > usual
  return {
    reviewId,
    kind: review.kind,
    amount: review.amount.toString(),
    fee: review.fee.toString(),
    to: review.to,
    selfRelay: review.relayer === undefined,
    repriced,
    queued: queued ? { usual: usual.toString() } : null,
    warnings: review.warnings.map((w) => ({
      code: w.code,
      message: WARNING_TEXT[w.code] ?? w.message,
    })),
  }
}

// Starts a spend whose confirmations go to the popup holding `holder`, settling with its first
// review or with its result when it ends before asking. A relayer that raises its fee after a
// review makes the SDK ask again, so deciding one review can yield another, about a plan it
// already saved. A review `accepted` says the user already saw, in the sheet that started the
// spend, is answered yes without showing it again; any other goes to the popup.
export function startReviewed(
  holder: string,
  spend: (confirm: ConfirmSpend) => Promise<Submission>,
  usual?: bigint,
  accepted?: (review: SpendReview) => boolean
): Promise<ShieldedStep> {
  let settle: { resolve: (step: ShieldedStep) => void; reject: (err: unknown) => void }
  const nextStep = () =>
    new Promise<ShieldedStep>((resolve, reject) => {
      settle = { resolve, reject }
    })
  const first = nextStep()
  const started = generation
  let reviews = 0
  const confirm: ConfirmSpend = (review) =>
    new Promise<boolean>((answer) => {
      // A lock since the spend started, or a popup that is gone, declines it before it is shown.
      if (generation !== started || !holders.has(holder)) {
        answer(false)
        return
      }
      if (accepted?.(review)) {
        noteConfirmed(holder, review)
        answer(true)
        return
      }
      const reviewId = crypto.randomUUID()
      const decide = (approve: boolean): Promise<ShieldedStep> => {
        clearTimeout(timer)
        open.delete(reviewId)
        reviewHolders.set(reviewId, holder)
        const yes = approve && generation === started
        if (yes) noteConfirmed(holder, review)
        const after = nextStep()
        answer(yes)
        return after
      }
      const decline = () => {
        const after = decide(false)
        after.catch(() => undefined)
        closed.set(reviewId, after)
        setTimeout(() => closed.delete(reviewId), OUTCOME_TTL_MS)
      }
      const timer = setTimeout(decline, REVIEW_TIMEOUT_MS)
      open.set(reviewId, { holder, decide, decline })
      settle.resolve({
        kind: 'review',
        review: reviewView(reviewId, review, reviews++ > 0, usual),
      })
    })
  spend(confirm).then(
    (s) =>
      settle.resolve({
        kind: 'submitted',
        planId: s.planId,
        txHash: s.txHash ?? null,
        fee: s.fee.toString(),
      }),
    (err: unknown) => settle.reject(err)
  )
  return first
}

export function decideReview(reviewId: string, approve: boolean): Promise<ShieldedStep> {
  const review = open.get(reviewId)
  if (review) return review.decide(approve)
  const outcome = closed.get(reviewId)
  if (outcome) return outcome
  throw new ShieldedRefusal('review_expired', 'This review is no longer open.')
}

// The port a popup holds for a payment it started. The popup closing, or leaving the payment,
// declines its open review, and any review it would still get. Returns false for a port of
// another kind.
export function watchReviewPort(port: chrome.runtime.Port): boolean {
  if (!port.name.startsWith(SHIELDED_REVIEW_PORT)) return false
  const holder = port.name.slice(SHIELDED_REVIEW_PORT.length)
  holders.add(holder)
  port.onDisconnect.addListener(() => {
    holders.delete(holder)
    confirmedCodes.delete(holder)
    for (const [reviewId, of] of reviewHolders) if (of === holder) reviewHolders.delete(reviewId)
    for (const review of [...open.values()]) if (review.holder === holder) review.decline()
  })
  return true
}

export function declineAllReviews(): void {
  generation++
  dropGrants()
  confirmedCodes.clear()
  reviewHolders.clear()
  for (const review of [...open.values()]) review.decline()
}
