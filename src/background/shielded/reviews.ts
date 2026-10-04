import type { ConfirmSpend, SpendReview, Submission } from '@cyphras/private'
import { SHIELDED_REVIEW_PORT } from '@constants/services'
import type { ShieldedReviewView, ShieldedStep } from '@ext-types/index'
import { ShieldedRefusal } from './errors'

// A review holds the account's other private operations until the user answers it, so one left
// unanswered is declined.
const REVIEW_TIMEOUT_MS = 3 * 60_000
// How long the outcome of a review declined without the popup's answer waits for that answer.
const OUTCOME_TTL_MS = 10 * 60_000

interface OpenReview {
  decide(approve: boolean): Promise<ShieldedStep>
  decline(): void
}

const open = new Map<string, OpenReview>()
// Moves on at every lock, so a spend that started before one cannot be confirmed after it.
let generation = 0
// Outcomes of reviews declined for the popup, as by a timeout. A late answer gets the outcome,
// with the plan a repriced spend already saved, rather than a fresh start.
const closed = new Map<string, Promise<ShieldedStep>>()

function reviewView(reviewId: string, review: SpendReview, repriced: boolean): ShieldedReviewView {
  return {
    reviewId,
    kind: review.kind,
    amount: review.amount.toString(),
    fee: review.fee.toString(),
    to: review.to,
    selfRelay: review.relayer === undefined,
    repriced,
    warnings: review.warnings.map((w) => ({ code: w.code, message: w.message })),
  }
}

// Starts a spend whose confirmations go to the popup, settling with its first review or with its
// result when it ends before asking. A relayer that raises its fee after a review makes the SDK
// ask again, so deciding one review can yield another, about a plan it already saved.
export function startReviewed(
  spend: (confirm: ConfirmSpend) => Promise<Submission>
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
      if (generation !== started) {
        answer(false)
        return
      }
      const reviewId = crypto.randomUUID()
      const decide = (approve: boolean): Promise<ShieldedStep> => {
        clearTimeout(timer)
        open.delete(reviewId)
        const after = nextStep()
        answer(approve && generation === started)
        return after
      }
      const decline = () => {
        const after = decide(false)
        after.catch(() => undefined)
        closed.set(reviewId, after)
        setTimeout(() => closed.delete(reviewId), OUTCOME_TTL_MS)
      }
      const timer = setTimeout(decline, REVIEW_TIMEOUT_MS)
      open.set(reviewId, { decide, decline })
      settle.resolve({ kind: 'review', review: reviewView(reviewId, review, reviews++ > 0) })
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

// A review's port is held by the popup that shows it; the popup closing, or leaving the review,
// declines it. Returns false for a port of another kind.
export function watchReviewPort(port: chrome.runtime.Port): boolean {
  if (!port.name.startsWith(SHIELDED_REVIEW_PORT)) return false
  const reviewId = port.name.slice(SHIELDED_REVIEW_PORT.length)
  port.onDisconnect.addListener(() => open.get(reviewId)?.decline())
  return true
}

export function declineAllReviews(): void {
  generation++
  for (const review of [...open.values()]) review.decline()
}
