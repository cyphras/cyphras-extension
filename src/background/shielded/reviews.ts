import type { ConfirmSpend, SpendReview, Submission } from '@cyphras/private'
import type { ShieldedReviewView, ShieldedStep } from '@ext-types/index'
import { ShieldedRefusal } from './errors'

// A review holds the account's other private operations until the user answers it, so one left
// unanswered is declined.
const REVIEW_TIMEOUT_MS = 3 * 60_000

interface OpenReview {
  decide(approve: boolean): Promise<ShieldedStep>
}

const open = new Map<string, OpenReview>()

function reviewView(reviewId: string, review: SpendReview): ShieldedReviewView {
  return {
    reviewId,
    kind: review.kind,
    amount: review.amount.toString(),
    fee: review.fee.toString(),
    to: review.to,
    selfRelay: review.relayer === undefined,
    warnings: review.warnings.map((w) => ({ code: w.code, message: w.message })),
  }
}

// Starts a spend whose confirmations go to the popup, settling with its first review or with its
// result when it ends before asking. A relayer that raises its fee after a review makes the SDK
// ask again, so deciding one review can yield another.
export function startReviewed(
  spend: (confirm: ConfirmSpend) => Promise<Submission>
): Promise<ShieldedStep> {
  let settle: { resolve: (step: ShieldedStep) => void; reject: (err: unknown) => void }
  const nextStep = () =>
    new Promise<ShieldedStep>((resolve, reject) => {
      settle = { resolve, reject }
    })
  const first = nextStep()
  const confirm: ConfirmSpend = (review) =>
    new Promise<boolean>((answer) => {
      const reviewId = crypto.randomUUID()
      const close = (approve: boolean) => {
        clearTimeout(timer)
        open.delete(reviewId)
        answer(approve)
      }
      const timer = setTimeout(() => close(false), REVIEW_TIMEOUT_MS)
      open.set(reviewId, {
        decide(approve) {
          const after = nextStep()
          close(approve)
          return after
        },
      })
      settle.resolve({ kind: 'review', review: reviewView(reviewId, review) })
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
  if (!review) throw new ShieldedRefusal('review_expired', 'This review expired. Start again.')
  return review.decide(approve)
}

export function declineAllReviews(): void {
  for (const review of [...open.values()]) review.decide(false).catch(() => undefined)
}
